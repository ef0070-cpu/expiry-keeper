import { refreshEntitlement } from './entitlement';
import { supabase } from './supabase';

// 구글 플레이 결제. 금액은 플레이 콘솔에서 정하고 여기선 받아서 보여 주기만 한다.
// 순서: 결제 → 서버(verify-purchase)가 구글에 영수증 확인·권한 기록 → 그 뒤에만 finishTransaction(구매 확정).
// 서버 확인이 실패하면 확정하지 않고 남겨 두고, 다음 앱 실행 때 restorePurchases()가 다시 확인한다
// (확정 안 된 구매는 구글이 3일 뒤 자동 환불 — 돈만 나가고 권한 못 받는 일이 없게).
export const LIFETIME = 'ad_free_lifetime';
export const MONTHLY = 'retail_monthly';
export type ProductKey = typeof LIFETIME | typeof MONTHLY;

// 결제 모듈이 없는 예전 개발용 앱에서도 죽지 않게 늦게 불러온다
let Iap: typeof import('expo-iap') | null = null;
try {
  Iap = require('expo-iap');
} catch {
  Iap = null;
}
export const billingAvailable = Iap !== null;

let connected: Promise<boolean> | null = null;
const connect = () => (connected ??= Iap ? Iap.initConnection().catch(() => ((connected = null), false)) : Promise.resolve(false));

type AnyPurchase = { productId: string; purchaseToken?: string; purchaseTokenAndroid?: string };

async function verifyAndFinish(purchase: AnyPurchase): Promise<boolean> {
  const purchaseToken = purchase.purchaseToken ?? purchase.purchaseTokenAndroid;
  if (!Iap || !supabase || !purchaseToken) return false;
  const { data, error } = await supabase.functions.invoke('verify-purchase', {
    body: { productId: purchase.productId, purchaseToken },
  });
  if (error || !data?.ok) return false;
  await Iap.finishTransaction({ purchase: purchase as never, isConsumable: false }).catch(() => {});
  return true;
}

let listening = false;
function listen() {
  if (!Iap || listening) return;
  listening = true;
  Iap.purchaseUpdatedListener(async (p) => {
    if (await verifyAndFinish(p as AnyPurchase)) await refreshEntitlement();
  });
}

/** 플레이 콘솔에 등록한 현지 가격 문자열(예: ₩2,900). 못 받으면 null. */
export async function getPrice(key: ProductKey): Promise<string | null> {
  if (!(await connect()) || !Iap) return null;
  try {
    if (key === LIFETIME) {
      const [p] = (await Iap.fetchProducts({ skus: [LIFETIME], type: 'inapp' })) as { displayPrice?: string }[];
      return p?.displayPrice ?? null;
    }
    const [s] = (await Iap.fetchProducts({ skus: [MONTHLY], type: 'subs' })) as {
      subscriptionOfferDetailsAndroid?: { pricingPhases: { pricingPhaseList: { formattedPrice: string }[] } }[];
      displayPrice?: string;
    }[];
    return s?.subscriptionOfferDetailsAndroid?.[0]?.pricingPhases.pricingPhaseList.at(-1)?.formattedPrice ?? s?.displayPrice ?? null;
  } catch {
    return null;
  }
}

/** 결제창을 띄운다. 결과는 purchaseUpdatedListener에서 검증·반영된다. */
export async function buy(key: ProductKey): Promise<void> {
  if (!(await connect()) || !Iap) throw new Error('결제를 준비하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
  listen();
  if (key === LIFETIME) {
    await Iap.requestPurchase({ request: { android: { skus: [LIFETIME] } }, type: 'inapp' });
    return;
  }
  const [s] = (await Iap.fetchProducts({ skus: [MONTHLY], type: 'subs' })) as {
    subscriptionOfferDetailsAndroid?: { offerToken: string }[];
  }[];
  const offerToken = s?.subscriptionOfferDetailsAndroid?.[0]?.offerToken;
  if (!offerToken) throw new Error('구독 상품 정보를 받지 못했어요.');
  await Iap.requestPurchase({
    request: { android: { skus: [MONTHLY], subscriptionOffers: [{ sku: MONTHLY, offerToken }] } },
    type: 'subs',
  });
}

/** 보유 구매를 전부 다시 확인한다(구매 복원·앱 시작 시·구독 갱신 반영). 확인된 건수를 돌려준다. */
export async function restorePurchases(): Promise<number> {
  if (!(await connect()) || !Iap) return 0;
  listen();
  try {
    const purchases = (await Iap.getAvailablePurchases()) as AnyPurchase[];
    let ok = 0;
    for (const p of purchases) if (await verifyAndFinish(p)) ok++;
    await refreshEntitlement();
    return ok;
  } catch {
    return 0;
  }
}
