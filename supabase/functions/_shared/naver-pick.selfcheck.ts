// 실행: npx tsx supabase/functions/_shared/naver-pick.selfcheck.ts
import assert from 'node:assert/strict';
import { rankNaverItems } from './naver-pick';

const titles = (items: { title?: string }[]) => items.map((i) => i.title);

// 묶음 판매글보다 단품, 단품보다 가격비교 카탈로그(productType 1)가 앞
assert.deepEqual(
  titles(rankNaverItems([
    { title: '<b>신라면</b> 120g x 40개', image: 'a', productType: '2' },
    { title: '농심 신라면 5개입 멀티팩 1박스', image: 'b', productType: '2' },
    { title: '농심 신라면 120g', image: 'c', productType: '2' },
    { title: '농심 신라면 120g', image: 'd', productType: '1' },
  ])).map((t, i) => `${i}:${t}`),
  ['0:농심 신라면 120g', '1:농심 신라면 120g', '2:<b>신라면</b> 120g x 40개', '3:농심 신라면 5개입 멀티팩 1박스'],
);
assert.equal(rankNaverItems([
  { title: '농심 신라면 120g', image: 'c', productType: '2' },
  { title: '농심 신라면 120g', image: 'd', productType: '1' },
])[0].image, 'd');

// 단품 표기("1개", "500ml", "2L")는 묶음으로 보지 않음 → 원래 순서 유지
assert.deepEqual(
  titles(rankNaverItems([
    { title: '서울우유 1L 1개', image: 'a', productType: 2 },
    { title: '코카콜라 500ml', image: 'b', productType: 2 },
    { title: '제주삼다수 2L', image: 'c', productType: 2 },
  ])),
  ['서울우유 1L 1개', '코카콜라 500ml', '제주삼다수 2L'],
);

// 중고(4~6)·사진 없음·한글 없는 제목은 제외
assert.deepEqual(
  titles(rankNaverItems([
    { title: '중고 오뚜기 진라면', image: 'a', productType: 5 },
    { title: '오뚜기 진라면', productType: 2 },
    { title: 'Ottogi Jin Ramen', image: 'c', productType: 2 },
    { title: '오뚜기 진라면 순한맛', image: 'd', productType: 2 },
  ])),
  ['오뚜기 진라면 순한맛'],
);

assert.deepEqual(rankNaverItems([]), []);
console.log('naver-pick selfcheck OK');
