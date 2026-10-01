import { RECIPES } from './recipes';
import { RECIPE_SHOPPING, missingIngredients } from './recipe-shopping';

// 모든 레시피에 쇼핑 재료가 있어야 한다(레시피를 추가하고 빠뜨리면 여기서 걸린다)
for (const r of RECIPES) console.assert(!!RECIPE_SHOPPING[r.name],`쇼핑 재료 없음: ${r.name}`);

// 두부만 있으면 양파·대파가 앞, 기본 양념(간장)은 뒤
const m = missingIngredients('두부조림', ['국산 두부 300g']);
console.assert(JSON.stringify(m.map((x) => x.name)) === JSON.stringify(['양파', '대파', '간장']), `두부조림: ${JSON.stringify(m)}`);
console.assert(m[2].staple && !m[0].staple, '기본 양념 표시');

// 이미 있는 재료(표기 변형 포함: 특란 → 계란)는 부족 재료에서 빠진다
const f = missingIngredients('프렌치토스트', ['특란 30구', '서울우유 1L']).map((x) => x.name);
console.assert(!f.includes('계란') && !f.includes('우유') && f.includes('식빵'), `프렌치토스트: ${f}`);

// 띄어 쓴 검색어는 첫 단어로 비교
console.assert(!missingIngredients('미역국', ['한우 소고기']).some((x) => x.name === '소고기 국거리'), '소고기 국거리');

console.log('recipe-shopping selfcheck OK');
