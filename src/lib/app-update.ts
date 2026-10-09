import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import { Alert, Linking } from 'react-native';
import { decideUpdate, type UpdateRow } from './app-update-rule';
import { supabase } from './supabase';

// 새 버전 안내. 사장님이 출시 후 서버 app_config에 최신 versionCode·업데이트 내용을 적으면
// 다음 실행부터 안내 창이 뜬다. min_version_code보다 낮으면 "나중에" 없이 업데이트만.
const DISMISSED_KEY = 'updateDismissed:v1';

function openStore() {
  const id = Application.applicationId ?? 'com.shlab.expirykeeper';
  Linking.openURL(`market://details?id=${id}`).catch(() =>
    Linking.openURL(`https://play.google.com/store/apps/details?id=${id}`),
  );
}

export async function checkForUpdate(): Promise<void> {
  if (!supabase) return;
  const { data, error } = await supabase
    .from('app_config')
    .select('latest_version_code, min_version_code, update_notes')
    .eq('id', 1)
    .maybeSingle();
  if (error || !data) return; // 오프라인·컬럼 없음 → 조용히 넘어감
  const r = data as UpdateRow;
  const current = Number(Application.nativeBuildVersion) || 0;
  const dismissed = Number(await AsyncStorage.getItem(DISMISSED_KEY)) || 0;
  const decision = decideUpdate(current, r, dismissed);
  if (decision === 'none') return;

  const notes = r.update_notes?.trim() || '더 좋아진 새 버전이 나왔어요.';
  const update = { text: '업데이트', onPress: openStore };
  if (decision === 'force') {
    Alert.alert('업데이트가 필요해요', `${notes}\n\n계속 쓰시려면 새 버전으로 업데이트해 주세요.`, [update], {
      cancelable: false,
    });
    return;
  }
  Alert.alert('새 버전이 나왔어요', notes, [
    { text: '나중에', style: 'cancel', onPress: () => AsyncStorage.setItem(DISMISSED_KEY, String(r.latest_version_code)) },
    update,
  ]);
}
