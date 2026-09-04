export type GeneralCalcOperator = '+' | '-' | '*' | '/';

export interface GeneralCalcState {
  current: string;
  previous: string;
  operator: GeneralCalcOperator | null;
  shouldResetScreen: boolean;
  expression: string;
}

export const initialGeneralCalcState: GeneralCalcState = {
  current: '0',
  previous: '',
  operator: null,
  shouldResetScreen: false,
  expression: '',
};

const OPERATOR_SYMBOLS: Record<GeneralCalcOperator, string> = {
  '+': '+',
  '-': '−',
  '*': '×',
  '/': '÷',
};

export function inputDigit(state: GeneralCalcState, digit: string): GeneralCalcState {
  let current: string;
  if (state.shouldResetScreen) {
    current = digit;
  } else {
    current = state.current === '0' ? digit : state.current + digit;
  }
  if (current.length > 12) current = current.slice(0, 12);
  return { ...state, current, shouldResetScreen: false };
}

export function inputDot(state: GeneralCalcState): GeneralCalcState {
  if (state.shouldResetScreen) {
    return { ...state, current: '0.', shouldResetScreen: false };
  }
  if (state.current.includes('.')) return state;
  return { ...state, current: state.current + '.' };
}

export function setOperator(state: GeneralCalcState, op: GeneralCalcOperator): GeneralCalcState {
  const base = state.operator && !state.shouldResetScreen ? calculate(state, true) : state;
  return {
    ...base,
    previous: base.current,
    operator: op,
    shouldResetScreen: true,
    expression: `${base.current} ${OPERATOR_SYMBOLS[op]}`,
  };
}

export function calculate(state: GeneralCalcState, chain = false): GeneralCalcState {
  if (!state.operator || state.shouldResetScreen) return state;
  const a = parseFloat(state.previous);
  const b = parseFloat(state.current);
  let result: number;
  switch (state.operator) {
    case '+':
      result = a + b;
      break;
    case '-':
      result = a - b;
      break;
    case '*':
      result = a * b;
      break;
    case '/':
      if (b === 0) {
        return {
          current: '오류',
          previous: state.previous,
          operator: null,
          shouldResetScreen: false,
          expression: '',
        };
      }
      result = a / b;
      break;
  }
  let current = parseFloat(result.toFixed(10)).toString();
  if (current.length > 12) current = parseFloat(result.toPrecision(8)).toString();
  const expression = chain
    ? state.expression
    : `${state.previous} ${OPERATOR_SYMBOLS[state.operator]} ${state.current} =`;
  return {
    current,
    previous: state.previous,
    operator: chain ? state.operator : null,
    shouldResetScreen: true,
    expression,
  };
}

export function clearAll(): GeneralCalcState {
  return { ...initialGeneralCalcState };
}

export function toggleSign(state: GeneralCalcState): GeneralCalcState {
  if (state.current === '오류') return state;
  return { ...state, current: (parseFloat(state.current) * -1).toString() };
}

export function percent(state: GeneralCalcState): GeneralCalcState {
  if (state.current === '오류') return state;
  return { ...state, current: (parseFloat(state.current) / 100).toString() };
}

export function formatDisplayValue(current: string): string {
  if (current === '오류') return current;
  const negative = current.startsWith('-');
  const unsigned = negative ? current.slice(1) : current;
  const [intPart, decPart] = unsigned.split('.');
  const withCommas = Number(intPart || '0').toLocaleString('ko-KR');
  return (negative ? '-' : '') + withCommas + (decPart !== undefined ? '.' + decPart : '');
}
