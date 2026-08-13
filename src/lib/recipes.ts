import { Product } from './types';
import { daysUntil } from './dates';

// 가정용 모드 전용 레시피 추천.
// 임박 상품명에 keywords 중 하나라도 포함되면 그 레시피를 추천한다.

export interface Recipe {
  name: string;
  keywords: string[]; // 재료 매칭용 핵심 키워드
  ingredients: string; // 표시용 전체 재료
  tip: string; // 간단 조리 설명
}

export const RECIPES: Recipe[] = [
  {
    name: '계란말이',
    keywords: ['계란', '달걀', '대파'],
    ingredients: '계란 3개, 대파, 당근, 소금',
    tip: '계란을 풀어 잘게 썬 채소를 섞고, 약불에서 여러 번 말아가며 부치면 폭신해요.',
  },
  {
    name: '계란찜',
    keywords: ['계란', '달걀', '새우젓'],
    ingredients: '계란 3개, 물 또는 육수, 새우젓(또는 소금), 파',
    tip: '계란과 물을 1:1로 섞고 뚝배기에 약불로 익히면 부드러운 계란찜 완성.',
  },
  {
    name: '김치찌개',
    keywords: ['김치', '돼지', '삼겹', '목살', '두부'],
    ingredients: '신김치, 돼지고기, 두부, 대파, 고춧가루',
    tip: '김치와 돼지고기를 먼저 볶다가 물을 붓고 끓이면 국물 맛이 진해져요.',
  },
  {
    name: '된장찌개',
    keywords: ['두부', '애호박', '감자', '버섯', '대파'],
    ingredients: '된장, 두부, 애호박, 감자, 버섯, 대파',
    tip: '멸치육수에 된장을 풀고 단단한 채소부터 넣어 끓이면 실패가 없어요.',
  },
  {
    name: '제육볶음',
    keywords: ['돼지', '삼겹', '목살', '앞다리'],
    ingredients: '돼지고기, 양파, 대파, 고추장, 고춧가루, 마늘',
    tip: '양념에 15분만 재웠다가 센 불에 빠르게 볶으면 불맛이 살아나요.',
  },
  {
    name: '카레라이스',
    keywords: ['감자', '당근', '양파', '카레'],
    ingredients: '카레가루, 감자, 당근, 양파, 고기(선택)',
    tip: '채소를 먼저 볶은 뒤 물을 넣고 익히고, 마지막에 카레가루를 풀어요.',
  },
  {
    name: '콩나물국',
    keywords: ['콩나물'],
    ingredients: '콩나물, 대파, 마늘, 소금(또는 새우젓)',
    tip: '뚜껑을 처음부터 끝까지 열거나 닫거나 한쪽으로만 — 중간에 열면 비린내가 나요.',
  },
  {
    name: '프렌치토스트',
    keywords: ['식빵', '계란', '달걀', '우유'],
    ingredients: '식빵, 계란, 우유, 설탕, 버터',
    tip: '계란+우유 물에 식빵을 적셔 버터 두른 팬에 약불로 구우면 끝.',
  },
  {
    name: '부대찌개',
    keywords: ['햄', '소시지', '스팸', '김치'],
    ingredients: '햄, 소시지, 김치, 두부, 라면사리, 대파',
    tip: '재료를 다 넣고 육수를 부어 끓이기만 하면 되는 초간단 메뉴예요.',
  },
  {
    name: '어묵볶음',
    keywords: ['어묵', '오뎅'],
    ingredients: '어묵, 양파, 당근, 간장, 올리고당',
    tip: '어묵을 뜨거운 물에 한 번 헹구면 기름기가 빠져 더 깔끔해요.',
  },
  {
    name: '소고기무국',
    keywords: ['소고기', '한우', '무'],
    ingredients: '소고기(국거리), 무, 대파, 국간장, 마늘',
    tip: '소고기를 참기름에 볶다가 무를 넣고 같이 볶은 뒤 물을 부으면 국물이 뽀얘져요.',
  },
  {
    name: '닭볶음탕',
    keywords: ['닭'],
    ingredients: '닭, 감자, 당근, 양파, 고추장 양념',
    tip: '닭을 끓는 물에 한 번 데친 뒤 조리하면 잡내 없이 깔끔해요.',
  },
  {
    name: '고등어조림',
    keywords: ['고등어', '갈치', '생선'],
    ingredients: '고등어, 무, 대파, 고춧가루 양념장',
    tip: '무를 냄비 바닥에 깔고 생선을 올려 조리면 무에 맛이 배어 더 맛있어요.',
  },
  {
    name: '애호박전',
    keywords: ['애호박', '호박'],
    ingredients: '애호박, 계란, 부침가루, 소금',
    tip: '애호박을 소금에 5분 절였다 물기를 닦고 부치면 눅눅해지지 않아요.',
  },
  {
    name: '시금치나물',
    keywords: ['시금치'],
    ingredients: '시금치, 마늘, 참기름, 소금, 깨',
    tip: '끓는 물에 30초만 데치고 찬물에 헹구면 색이 선명하게 살아요.',
  },
  {
    name: '두부조림',
    keywords: ['두부'],
    ingredients: '두부, 양파, 대파, 간장 양념장',
    tip: '두부를 살짝 구운 뒤 양념장을 끼얹어 조리면 겉은 쫄깃 속은 부드러워요.',
  },
  {
    name: '감자볶음',
    keywords: ['감자'],
    ingredients: '감자, 당근, 양파, 소금',
    tip: '채 썬 감자를 물에 헹궈 전분을 빼면 팬에 들러붙지 않아요.',
  },
  {
    name: '오이무침',
    keywords: ['오이'],
    ingredients: '오이, 양파, 고춧가루, 식초, 설탕',
    tip: '오이를 소금에 10분 절였다 무치면 물이 안 생기고 아삭해요.',
  },
  {
    name: '바나나 스무디',
    keywords: ['바나나', '우유', '요거트', '요구르트'],
    ingredients: '바나나, 우유(또는 요거트), 꿀',
    tip: '살짝 검게 변한 바나나가 오히려 더 달아서 스무디에 딱이에요.',
  },
  {
    name: '김치볶음밥',
    keywords: ['김치', '햄', '스팸', '계란', '달걀'],
    ingredients: '밥, 김치, 햄, 계란, 대파, 참기름',
    tip: '김치를 먼저 충분히 볶은 뒤 밥을 넣어야 맛이 겉돌지 않아요.',
  },
  {
    name: '크림파스타',
    keywords: ['우유', '생크림', '베이컨', '버섯', '치즈'],
    ingredients: '파스타면, 우유(또는 생크림), 베이컨, 버섯, 양파, 치즈',
    tip: '생크림이 없어도 우유+치즈로 충분히 고소한 크림소스가 돼요.',
  },
  {
    name: '치즈 토스트',
    keywords: ['식빵', '치즈', '햄'],
    ingredients: '식빵, 치즈, 햄, 계란, 버터',
    tip: '팬에 버터를 녹여 식빵을 굽고 치즈를 얹어 뚜껑을 덮으면 잘 녹아요.',
  },
  {
    name: '만둣국',
    keywords: ['만두'],
    ingredients: '만두, 계란, 대파, 김가루, 육수',
    tip: '냉동만두 그대로 육수에 넣고 떠오르면 익은 거예요. 계란물로 마무리.',
  },
  {
    name: '미역국',
    keywords: ['미역', '소고기'],
    ingredients: '미역, 소고기(국거리), 국간장, 참기름, 마늘',
    tip: '불린 미역을 소고기와 함께 참기름에 볶은 뒤 끓이면 국물이 진해져요.',
  },
  {
    name: '요거트볼',
    keywords: ['요거트', '요구르트', '바나나', '딸기', '사과', '블루베리'],
    ingredients: '요거트, 과일(바나나·딸기·사과 등), 그래놀라, 꿀',
    tip: '남은 과일 처리에 최고. 그래놀라 대신 시리얼도 잘 어울려요.',
  },
  {
    name: '김치전',
    keywords: ['김치', '부침가루'],
    ingredients: '신김치, 부침가루, 김칫국물',
    tip: '반죽에 김칫국물을 넣으면 색과 감칠맛이 살고, 얇게 부쳐야 바삭해요.',
  },
  {
    name: '새우볶음밥',
    keywords: ['새우'],
    ingredients: '밥, 새우, 계란, 대파, 굴소스',
    tip: '대파를 기름에 먼저 볶아 파기름을 내면 풍미가 확 올라가요.',
  },
  {
    name: '샐러드',
    keywords: ['양상추', '상추', '토마토', '오이', '파프리카'],
    ingredients: '양상추, 토마토, 오이, 치즈, 드레싱',
    tip: '채소를 찬물에 10분 담갔다 물기를 털면 훨씬 아삭해요.',
  },
];

export interface RecipeMatch {
  recipe: Recipe;
  /** 이 레시피와 매칭된 임박 상품들 */
  matchedProducts: Product[];
}

/** 유통기한 7일 이내(오늘 포함, 만료 제외)인 보관 중 상품 */
export function urgentProducts(products: Product[]): Product[] {
  return products.filter((p) => {
    if (p.status !== 'active') return false;
    const d = daysUntil(p.expiryDate);
    return d >= 0 && d <= 7;
  });
}

/** 임박 상품과 재료 키워드가 겹치는 레시피를 많이 겹치는 순으로 돌려준다. */
export function matchRecipes(urgent: Product[]): RecipeMatch[] {
  return RECIPES.map((recipe) => {
    const matched = urgent.filter((p) =>
      recipe.keywords.some((k) => p.name.includes(k)),
    );
    return { recipe, matchedProducts: matched };
  })
    .filter((m) => m.matchedProducts.length > 0)
    .sort((a, b) => b.matchedProducts.length - a.matchedProducts.length);
}
