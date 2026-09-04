import {
  calculate,
  clearAll,
  formatDisplayValue,
  GeneralCalcState,
  initialGeneralCalcState,
  inputDigit,
  inputDot,
  percent,
  setOperator,
  toggleSign,
} from './general-calculator';

// 1) 기본 사칙연산
let s: GeneralCalcState = initialGeneralCalcState;
s = inputDigit(s, '7');
s = setOperator(s, '+');
s = inputDigit(s, '8');
s = calculate(s);
console.assert(s.current === '15', `7+8 실패: ${s.current}`);

s = clearAll();
s = inputDigit(s, '2');
s = inputDigit(s, '0');
s = setOperator(s, '-');
s = inputDigit(s, '5');
s = calculate(s);
console.assert(s.current === '15', `20-5 실패: ${s.current}`);

s = clearAll();
s = inputDigit(s, '6');
s = setOperator(s, '*');
s = inputDigit(s, '7');
s = calculate(s);
console.assert(s.current === '42', `6*7 실패: ${s.current}`);

s = clearAll();
s = inputDigit(s, '2');
s = inputDigit(s, '0');
s = setOperator(s, '/');
s = inputDigit(s, '4');
s = calculate(s);
console.assert(s.current === '5', `20/4 실패: ${s.current}`);

// 2) 연속 계산 (1 + 2 + 3 =)
s = clearAll();
s = inputDigit(s, '1');
s = setOperator(s, '+');
s = inputDigit(s, '2');
s = setOperator(s, '+'); // 여기서 1+2=3이 먼저 계산되어야 함
s = inputDigit(s, '3');
s = calculate(s);
console.assert(s.current === '6', `연속계산 실패: ${s.current}`);

// 3) 0으로 나누기
s = clearAll();
s = inputDigit(s, '5');
s = setOperator(s, '/');
s = inputDigit(s, '0');
s = calculate(s);
console.assert(s.current === '오류', `0나누기 실패: ${s.current}`);
console.assert(s.operator === null, '0나누기 후 operator는 null이어야 함');

// 4) 오류 상태에서 percent/toggleSign 무시
const afterPercent = percent(s);
const afterToggle = toggleSign(s);
console.assert(afterPercent.current === '오류', 'percent가 오류 상태를 바꾸면 안 됨');
console.assert(afterToggle.current === '오류', 'toggleSign이 오류 상태를 바꾸면 안 됨');

// 5) 소수점 중복 입력 방지
s = clearAll();
s = inputDigit(s, '1');
s = inputDot(s);
s = inputDigit(s, '5');
s = inputDot(s); // 무시되어야 함
console.assert(s.current === '1.5', `소수점 중복 방지 실패: ${s.current}`);

// 6) 12자리 초과 입력 시 잘림
s = clearAll();
for (const d of '123456789012345') {
  s = inputDigit(s, d);
}
console.assert(s.current.length === 12, `12자리 제한 실패: ${s.current}`);
console.assert(s.current === '123456789012', `12자리 잘림 값 실패: ${s.current}`);

// 7) toggleSign/percent 정상 동작
s = clearAll();
s = inputDigit(s, '5');
s = toggleSign(s);
console.assert(s.current === '-5', `toggleSign 실패: ${s.current}`);
s = percent(s);
console.assert(s.current === '-0.05', `percent 실패: ${s.current}`);

// 8) 화면 표시용 콤마 포맷
console.assert(formatDisplayValue('1234567') === '1,234,567', `콤마 포맷 실패: ${formatDisplayValue('1234567')}`);
console.assert(
  formatDisplayValue('-1234.5') === '-1,234.5',
  `음수+소수 콤마 포맷 실패: ${formatDisplayValue('-1234.5')}`,
);
console.assert(formatDisplayValue('오류') === '오류', '오류 상태 포맷 실패');

console.log('general-calculator selfcheck OK');
