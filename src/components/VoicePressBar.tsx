import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { memo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, Text, View } from 'react-native';

import { cleanTranscript } from '@/lib/voice-text';

/**
 * 누르고 말하기 바(2026-10-28 C안) — 누르고 있는 동안만 듣고, 손을 떼면 들은 말을 onHeard로 넘긴다.
 * 말을 해석해 바로 담지 않는다: 부모가 그 글자를 검색창에 넣고, 사람이 후보 목록에서 눌러 고른다.
 * 키보드 마이크가 아니라 앱 안의 음성 인식(expo-speech-recognition)을 쓴다 — 마이크 권한이 필요하다.
 */
const VoicePressBar = memo(function VoicePressBar({
  bottom,
  onHeard,
}: {
  bottom: number;
  onHeard: (text: string) => void;
}) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [notice, setNotice] = useState('');
  const holding = useRef(false);
  const delivered = useRef(false);
  const errored = useRef(false);
  const lastText = useRef('');

  const deliver = (raw: string) => {
    if (delivered.current) return;
    delivered.current = true;
    const text = cleanTranscript(raw);
    if (text) onHeard(text);
    else setNotice('잘 못 들었어요. 다시 눌러 말해 주세요');
  };

  const askSettings = () => {
    Alert.alert('마이크 권한이 필요해요', '상품 이름을 말로 검색하려면 마이크 권한을 허용해 주세요.', [
      { text: '닫기', style: 'cancel' },
      { text: '설정 열기', onPress: () => Linking.openSettings().catch(() => {}) },
    ]);
  };

  useSpeechRecognitionEvent('start', () => setListening(true));
  useSpeechRecognitionEvent('result', (e) => {
    const t = e.results?.[0]?.transcript ?? '';
    lastText.current = t;
    setInterim(t);
    if (e.isFinal) deliver(t);
  });
  useSpeechRecognitionEvent('end', () => {
    setListening(false);
    setInterim('');
    if (!delivered.current && !errored.current) {
      if (lastText.current) deliver(lastText.current);
      else setNotice('잘 못 들었어요. 다시 눌러 말해 주세요');
    }
  });
  useSpeechRecognitionEvent('error', (e) => {
    errored.current = true;
    setListening(false);
    setInterim('');
    if (e.error === 'not-allowed') askSettings();
    else if (e.error === 'no-speech' || e.error === 'speech-timeout') setNotice('잘 못 들었어요. 다시 눌러 말해 주세요');
    else setNotice('음성 인식을 쓸 수 없어요. 글자로 검색해 주세요');
  });

  const begin = async () => {
    holding.current = true;
    delivered.current = false;
    errored.current = false;
    lastText.current = '';
    setNotice('');
    try {
      const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!perm.granted) {
        holding.current = false;
        askSettings();
        return;
      }
      if (!holding.current) return; // 권한 창이 뜨는 사이 손을 뗐다
      ExpoSpeechRecognitionModule.start({ lang: 'ko-KR', interimResults: true, continuous: false, maxAlternatives: 1 });
    } catch {
      holding.current = false;
      setNotice('음성 인식을 쓸 수 없어요. 글자로 검색해 주세요');
    }
  };

  const end = () => {
    holding.current = false;
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // 시작 전에 손을 뗀 경우 등 — 무시
    }
  };

  let available = false;
  try {
    available = ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    available = false;
  }
  if (!available) return null;

  const bubble = listening ? interim || '듣고 있어요… 상품 이름을 말해 보세요' : notice;

  return (
    <View pointerEvents="box-none" className="absolute left-4 right-4" style={{ bottom, zIndex: 15 }}>
      {bubble ? (
        <View
          className="mb-2 items-center self-center rounded-2xl bg-paper px-4 py-3"
          style={{ elevation: 6, maxWidth: '100%' }}
        >
          <Text className="text-ink text-base font-bold" numberOfLines={2}>
            {bubble}
          </Text>
        </View>
      ) : null}
      <Pressable
        onPressIn={begin}
        onPressOut={end}
        className="h-16 flex-row items-center justify-center rounded-full"
        style={{
          backgroundColor: listening ? '#FFFFFF' : '#CC2222',
          borderWidth: 3,
          borderColor: '#CC2222',
          elevation: 6,
          gap: 10,
        }}
        accessibilityRole="button"
        accessibilityLabel="누르고 말하기. 누르고 있는 동안 상품 이름을 말하면 검색해요"
      >
        <MaterialCommunityIcons name="microphone" size={26} color={listening ? '#CC2222' : '#FFFFFF'} />
        <Text style={{ color: listening ? '#CC2222' : '#FFFFFF', fontSize: 17, fontWeight: 'bold' }}>
          {listening ? '듣는 중… 손을 떼면 검색해요' : '누르고 말하기'}
        </Text>
      </Pressable>
    </View>
  );
});

export default VoicePressBar;
