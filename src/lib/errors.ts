/** 예외에서 사용자에게 보여줄 메시지를 뽑는다. Alert에 그대로 넣어 쓴다. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return '알 수 없는 오류';
}
