import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { listProducts } from './repo';
import { ALERT_OFFSETS, ALL_OFFSET_DAYS, getAlertSettings } from './settings';
import { Product } from './types';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

let channelReady = false;

async function ensureChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('expiry', {
    name: '유통기한 알림',
    importance: Notifications.AndroidImportance.HIGH,
  });
  channelReady = true;
}

export async function ensureNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

function alertBody(name: string, offset: number): string {
  if (offset === 0) return `[${name}] 유통기한이 오늘까지입니다!`;
  if (offset === 1) return `[${name}] 유통기한이 내일까지입니다.`;
  return `[${name}] 유통기한이 ${offset}일 남았습니다.`;
}

/** 상품 저장 시 호출: 설정된 횟수·시간에 맞춰 유통기한 알림을 예약한다 */
export async function scheduleExpiryAlerts(p: Product): Promise<void> {
  try {
    const ok = await ensureNotificationPermission();
    if (!ok) return;
    await ensureChannel();
    await cancelExpiryAlerts(p.id);

    const { count, hour, minute } = await getAlertSettings();
    const offsets = ALERT_OFFSETS[count - 1];
    const [y, m, d] = p.expiryDate.split('-').map(Number);

    for (const offset of offsets) {
      const date = new Date(y, m - 1, d - offset, hour, minute, 0);
      if (date.getTime() <= Date.now()) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${p.id}-o${offset}`,
        content: { title: '유통기한 지킴이', body: alertBody(p.name, offset) },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date,
          channelId: 'expiry',
        },
      });
    }
  } catch {
    // 알림 실패는 저장을 막지 않는다
  }
}

export async function cancelExpiryAlerts(productId: string): Promise<void> {
  try {
    await Promise.all([
      ...ALL_OFFSET_DAYS.map((offset) =>
        Notifications.cancelScheduledNotificationAsync(`${productId}-o${offset}`),
      ),
      // 구버전(고정 D-1/D-DAY)에 예약된 알림 정리
      Notifications.cancelScheduledNotificationAsync(`${productId}-d1`),
      Notifications.cancelScheduledNotificationAsync(`${productId}-d0`),
    ]);
  } catch {
    // 예약이 없으면 무시
  }
}

/** 알림 설정(횟수·시간)이 바뀌었을 때 보관 중인 모든 상품의 알림을 다시 예약한다 */
export async function rescheduleAllExpiryAlerts(): Promise<void> {
  try {
    const items = await listProducts('active');
    for (const p of items) {
      await scheduleExpiryAlerts(p);
    }
  } catch {
    // 재예약 실패는 무시 (다음 상품 저장 시 다시 예약됨)
  }
}
