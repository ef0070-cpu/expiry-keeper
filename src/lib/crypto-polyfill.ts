// 로그인 PKCE 보안(2026-09-30 보안 점검). React Native에는 WebCrypto(crypto)가 없어서 Supabase가
// ① 코드 검증값을 Math.random으로 만들고 ② challenge를 plain(해시 없음)으로 보냈다 — 폰 안의 다른
// 앱이 로그인 콜백을 가로챌 때 막는 힘이 약하다. expo-crypto(네이티브)로 안전한 난수와 SHA-256을
// 채워 S256 방식이 되게 한다. supabase-js를 불러오기 전에 import해야 한다.
// 네이티브 모듈이 없는 옛 빌드(개발용 앱 포함)에서는 조용히 넘어가 예전 방식 그대로 동작한다.
type DigestFn = (algorithm: string, data: BufferSource) => Promise<ArrayBuffer>;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExpoCrypto = require('expo-crypto') as {
    getRandomValues: <T extends ArrayBufferView>(a: T) => T;
    digest: DigestFn;
  };
  const g = globalThis as { crypto?: { getRandomValues?: unknown; subtle?: unknown } };
  g.crypto ??= {};
  g.crypto.getRandomValues ??= ExpoCrypto.getRandomValues;
  g.crypto.subtle ??= {
    // Supabase는 digest('SHA-256', …)만 쓴다 — expo-crypto의 알고리즘 이름도 'SHA-256'
    digest: (algorithm: string, data: BufferSource) => ExpoCrypto.digest(algorithm, data),
  };
} catch {
  // expo-crypto 네이티브 모듈 없음(새 빌드 전) — 예전 방식(plain)으로 동작
}

export {};
