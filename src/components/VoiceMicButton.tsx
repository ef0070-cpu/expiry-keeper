import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { memo, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, Text, View } from 'react-native';

import { cleanTranscript } from '@/lib/voice-text';

const MAX_LISTEN_MS = 12000; // 손을 떼지 않아도 이 시간이 지나면 듣기를 끝낸다
const STOP_GRACE_MS = 2500; // 손을 뗀 뒤 이 시간 안에 안 끝나면 강제로 끊는다
const NOTICE_MS = 2500; // 안내 말풍선이 저절로 사라지는 시간
const INLINE_SIZE = 54; // 검색창 안 마이크(원래 44의 약 1.25배 — 1.5배는 너무 컸다)
export const FLOAT_SIZE = 70; // 화면에 띄우는 마이크(원래 56의 1.25배)
const TAP_MS = 350; // 이보다 짧게 눌렀다 떼면 '톡' 누른 것(onTap), 길게 누르면 말하기
const ENDING_WAIT_MS = 600; // 이전 듣기의 end 이벤트를 기다리는 최대 시간

// 음성 인식을 쓸 수 있는지는 기기에서 바뀌지 않는다 — 렌더링마다 네이티브를 부르면 말하는 동안 중간 결과가 올 때마다 낭비라 한 번만 확인한다(true일 때만 저장)
let availableCache = false;
function isRecognitionAvailable(): boolean {
  if (availableCache) return true;
  try {
    availableCache = ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    availableCache = false;
  }
  return availableCache;
}

/**
 * 누르고 말하기 마이크 버튼 — 누르고 있는 동안만 듣고, 손을 떼면 들은 말을 onHeard로 넘긴다.
 * variant: 'inline'은 검색창 안 아이콘(44), 'floating'은 화면에 띄우는 둥근 버튼(56). 안내·듣는 글자는 작은 말풍선으로 보인다.
 * 말을 해석해 바로 담지 않는다: 부모가 그 글자를 검색창에 넣고, 사람이 후보 목록에서 눌러 고른다.
 * 키보드 마이크가 아니라 앱 안의 음성 인식(expo-speech-recognition)을 쓴다 — 마이크 권한이 필요하다.
 *
 * 듣기가 안 끝나는 일을 막는 장치(2026-10-29): 손을 뗀 뒤 일정 시간 안에 안 끝나면 강제 중단, 최대 듣기 시간,
 * 앱이 백그라운드로 가거나 화면을 나가면 중단, 권한 창이 뜨는 사이 손을 뗀 경우 시작되자마자 중단,
 * 그리고 "듣는 중" 말풍선을 누르면 바로 취소.
 */
const VoiceMicButton = memo(function VoiceMicButton({
  onHeard,
  variant = 'inline',
  disabled = false,
  bubbleAlign = 'right',
  onTap,
  active = false,
}: {
  onHeard: (text: string) => void;
  variant?: 'inline' | 'floating';
  /** 위치를 옮기는 중에는 듣지 않는다(듣던 것도 취소) */
  disabled?: boolean;
  /** 말풍선을 버튼의 어느 쪽 끝에 맞출지(버튼이 화면 왼쪽에 있으면 left) */
  bubbleAlign?: 'left' | 'right';
  /** 주면: 짧게 톡 누르면 말하기 대신 이 동작을 한다(검색창 마이크로 화면 마이크를 켜고 끄는 데 쓴다) */
  onTap?: () => void;
  /** onTap이 가리키는 기능이 켜져 있는지(아이콘을 빨갛게) */
  active?: boolean;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [notice, setNotice] = useState('');
  const holding = useRef(false);
  const pressAt = useRef(0);
  const delivered = useRef(false);
  const errored = useRef(false);
  const lastText = useRef('');
  const listeningRef = useRef(false);
  const permOk = useRef(false); // 마이크 권한을 이미 받았는지 — 누를 때마다 확인하면 몇 초씩 걸려 말하기가 시작도 못 한다
  const owner = useRef(false); // 이 버튼이 시작한 듣기인지 — 화면에 마이크가 둘이라(검색창·둥근 버튼) 서로의 이벤트를 받지 않게
  const ending = useRef(false); // 시작한 듣기의 end/error 이벤트가 아직 안 온 상태 — 이때 새로 시작하면 늦게 온 옛 end가 새 듣기를 지워 먹통이 된다
  const maxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = () => {
    if (maxTimer.current) clearTimeout(maxTimer.current);
    if (graceTimer.current) clearTimeout(graceTimer.current);
    maxTimer.current = null;
    graceTimer.current = null;
  };

  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), NOTICE_MS);
  };

  /** 듣기를 지금 끝낸다(들은 말은 버린다) */
  const cancel = () => {
    holding.current = false;
    delivered.current = true;
    clearTimers();
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // 이미 끝난 상태 — 무시
    }
    listeningRef.current = false;
    owner.current = false;
    setListening(false);
    setInterim('');
  };

  useEffect(() => {
    ExpoSpeechRecognitionModule.getPermissionsAsync()
      .then((r) => {
        permOk.current = r.granted;
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') cancel();
    });
    return () => {
      sub.remove();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (listeningRef.current || holding.current) cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 위치를 옮기기 시작하면(disabled) 듣던 것을 취소한다
  useEffect(() => {
    if (disabled && (listeningRef.current || holding.current)) cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const deliver = (raw: string) => {
    if (delivered.current) return;
    delivered.current = true;
    const text = cleanTranscript(raw);
    if (text) onHeard(text);
    else showNotice('잘 못 들었어요. 다시 눌러 말해 주세요');
  };

  const askSettings = () => {
    Alert.alert('마이크 권한이 필요해요', '상품 이름을 말로 검색하려면 마이크 권한을 허용해 주세요.', [
      { text: '닫기', style: 'cancel' },
      { text: '설정 열기', onPress: () => Linking.openSettings().catch(() => {}) },
    ]);
  };

  useSpeechRecognitionEvent('start', () => {
    if (!owner.current) return;
    listeningRef.current = true;
    setListening(true);
    // 권한 창이 뜨는 사이 이미 손을 뗐다면 시작되자마자 끝낸다
    if (!holding.current) cancel();
  });
  useSpeechRecognitionEvent('result', (e) => {
    if (!owner.current) return;
    const t = e.results?.[0]?.transcript ?? '';
    lastText.current = t;
    setInterim(t);
    if (e.isFinal) deliver(t);
  });
  useSpeechRecognitionEvent('end', () => {
    ending.current = false;
    if (!owner.current) return;
    owner.current = false;
    clearTimers();
    listeningRef.current = false;
    setListening(false);
    setInterim('');
    if (!delivered.current && !errored.current) {
      if (lastText.current) deliver(lastText.current);
      else showNotice('잘 못 들었어요. 다시 눌러 말해 주세요');
    }
  });
  useSpeechRecognitionEvent('error', (e) => {
    ending.current = false;
    if (!owner.current) return;
    owner.current = false;
    errored.current = true;
    clearTimers();
    listeningRef.current = false;
    setListening(false);
    setInterim('');
    if (e.error === 'aborted') return; // 사용자가 취소했거나 우리가 끊은 것 — 오류 안내를 띄우지 않는다
    if (e.error === 'not-allowed') askSettings();
    else if (e.error === 'no-speech' || e.error === 'speech-timeout') showNotice('잘 못 들었어요. 다시 눌러 말해 주세요');
    else showNotice('음성 인식을 쓸 수 없어요. 글자로 검색해 주세요');
  });

  const end = () => {
    if (onTap && Date.now() - pressAt.current < TAP_MS) {
      cancel(); // 짧게 눌렀으면 듣기를 접고 톡 누름으로 처리(begin이 아직 안 끝났어도 holding이 false라 시작하지 않는다)
      onTap();
      return;
    }
    holding.current = false;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // 시작 전에 손을 뗀 경우 등 — 무시
    }
    // 손을 뗐는데도 듣기가 안 끝나면 강제로 끊는다
    if (graceTimer.current) clearTimeout(graceTimer.current);
    graceTimer.current = setTimeout(() => {
      if (listeningRef.current) cancel();
    }, STOP_GRACE_MS);
  };

  const begin = async () => {
    if (disabled) return;
    pressAt.current = Date.now();
    holding.current = true;
    delivered.current = false;
    errored.current = false;
    lastText.current = '';
    setNotice('');
    try {
      if (!permOk.current) {
        const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
        if (!perm.granted) {
          holding.current = false;
          askSettings();
          return;
        }
        permOk.current = true;
      }
      if (!holding.current) return; // 권한 창이 뜨는 사이 손을 뗐다
      if (ending.current) {
        // 방금 전 듣기가 아직 끝나는 중이다 — 끝났다는 신호(end/error)를 잠깐 기다린 뒤 시작한다(안 기다리면 그 신호가 새 듣기를 지운다)
        try {
          ExpoSpeechRecognitionModule.abort();
        } catch {
          // 이미 끝난 상태 — 무시
        }
        const waitUntil = Date.now() + ENDING_WAIT_MS;
        while (ending.current && Date.now() < waitUntil) await new Promise((r) => setTimeout(r, 40));
        ending.current = false;
        if (!holding.current) return; // 기다리는 사이 손을 뗐다
      }
      owner.current = true;
      ending.current = true;
      ExpoSpeechRecognitionModule.start({ lang: 'ko-KR', interimResults: true, continuous: false, maxAlternatives: 1 });
      if (maxTimer.current) clearTimeout(maxTimer.current);
      maxTimer.current = setTimeout(end, MAX_LISTEN_MS);
    } catch {
      holding.current = false;
      ending.current = false;
      owner.current = false;
      showNotice('음성 인식을 쓸 수 없어요. 글자로 검색해 주세요');
    }
  };

  if (!isRecognitionAvailable()) return null;

  const floating = variant === 'floating';
  const size = floating ? FLOAT_SIZE : INLINE_SIZE;
  const bubble = listening ? interim || '듣고 있어요… 상품 이름을 말해 보세요' : notice;

  return (
    <View style={{ zIndex: 15 }}>
      <Pressable
        onPressIn={begin}
        onPressOut={end}
        disabled={disabled}
        // 누른 채 말하는 동안 손가락이 밀려도 누름이 풀리지 않게(기본 20px) 넉넉히 잡는다. 둥근 버튼은 주변에 다른 버튼이 없어 터치 영역도 넓힌다
        pressRetentionOffset={{ top: 100, bottom: 100, left: 100, right: 100 }}
        hitSlop={floating ? 10 : undefined}
        className={floating ? 'items-center justify-center rounded-full' : 'items-center justify-center rounded-lg'}
        style={{
          width: size,
          height: size,
          backgroundColor: listening ? '#CC2222' : floating ? '#FFFFFF' : undefined,
          ...(floating ? { borderWidth: 2, borderColor: '#CC2222', elevation: 6 } : null),
        }}
        accessibilityRole="button"
        accessibilityLabel="누르고 말하기. 누르고 있는 동안 상품 이름을 말하면 검색해요"
      >
        <MaterialCommunityIcons
          name="microphone"
          size={floating ? 35 : 28}
          color={listening ? '#FFFFFF' : floating || active ? '#CC2222' : '#1A1A1A'}
        />
      </Pressable>
      {bubble ? (
        <View
          pointerEvents={listening ? 'auto' : 'none'}
          style={{
            position: 'absolute',
            width: 260,
            ...(floating ? { bottom: size + 8 } : { top: size + 4 }),
            ...(bubbleAlign === 'left' ? { left: 0, alignItems: 'flex-start' } : { right: 0, alignItems: 'flex-end' }),
          }}
        >
          <Pressable
            onPress={listening ? cancel : undefined}
            className="rounded-2xl bg-paper px-4 py-3"
            style={{ elevation: 6, maxWidth: '100%' }}
            accessibilityRole="button"
            accessibilityLabel={listening ? '듣기 취소' : undefined}
          >
            <Text className="text-ink text-base font-bold" numberOfLines={2}>
              {bubble}
            </Text>
            {listening ? <Text className="text-muted mt-0.5 text-xs">여기를 누르면 취소돼요</Text> : null}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
});

export default VoiceMicButton;
