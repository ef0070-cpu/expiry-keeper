// Supabase는 한 번에 최대 1000행(max_rows)만 돌려주고 넘치는 건 오류 없이 잘라 버린다.
// 상품이 1000개를 넘는 매장도 전부 받도록 1000개씩 끝까지 받아 합친다.
// page(from, to)는 순서가 고정된 쿼리여야 한다(.order(..., 'id') — 같은 값끼리 순서가 흔들리면 빠지거나 겹친다).
export const PAGE_SIZE = 1000;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, size = PAGE_SIZE): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < size) return all;
  }
}
