import { fetchAll } from './paged';

(async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => i);
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => (calls.push([from, to]), { data: rows.slice(from, to + 1), error: null });
  const got = await fetchAll(page);
  console.assert(got.length === 2500 && got[2499] === 2499, '1000개 넘어도 전부');
  console.assert(calls.length === 3 && calls[2][0] === 2000, '1000개씩 3번');
  const exact = await fetchAll(async (f, t) => ({ data: rows.slice(0, 1000).slice(f, t + 1), error: null }));
  console.assert(exact.length === 1000, '딱 1000개면 빈 페이지 한 번 더 보고 끝');
  let threw = false;
  await fetchAll(async () => ({ data: null, error: { message: 'x' } })).catch(() => (threw = true));
  console.assert(threw, '오류는 숨기지 않는다');
  console.log('paged selfcheck OK');
})();
