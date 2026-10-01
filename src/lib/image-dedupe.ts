// 사진 후보 정리: 같은 사진을 여러 번 올리면 주소만 다른 후보가 쌓이고(서버는 내용을 비교하지
// 않음), 깨진 주소는 빈 칸으로 보였다. 실제로 내려받아 내용이 같으면 하나만, 못 받거나 이미지가
// 아니면 빼고 보여 준다. 후보는 보통 몇 장이라 전부 받아도 부담이 작다.
// ponytail: 바이트가 완전히 같은 사진만 합친다 — 같은 상품을 따로 찍은 사진(바이트가 다름)은 그대로

/** 바이트 내용 지문(FNV-1a 32비트 + 길이). 보안용이 아니라 같은 파일인지 가리는 용도. */
export function contentKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${bytes.length}:${h.toString(16)}`;
}

/** 순서를 지키며 key가 처음 나온 것만 남긴다. key가 null인 항목(못 받은 사진)은 뺀다. */
export function uniqueByKey<T>(items: T[], keys: (string | null)[]): T[] {
  const seen = new Set<string>();
  return items.filter((_, i) => {
    const k = keys[i];
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function fetchKey(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type && !type.startsWith('image/')) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    return bytes.length > 0 ? contentKey(bytes) : null;
  } catch {
    return null;
  }
}

/** items 중 사진(url)이 같은 내용인 것은 첫 번째만, 받을 수 없는 사진은 빼고 돌려준다. */
export async function dedupeByImage<T>(items: T[], url: (item: T) => string): Promise<T[]> {
  const keys = await Promise.all(items.map((it) => fetchKey(url(it))));
  return uniqueByKey(items, keys);
}
