// 스캔 화면에서 바코드만 읽어 이전 화면으로 돌려줄 때 쓰는 한 칸짜리 전달함.
// expo-router는 뒤로 가기에 값을 실어 보낼 수 없어서, 스캔 화면이 여기 넣고
// 돌아간 화면이 포커스될 때 꺼내 쓴다(꺼내면 비워져 한 번만 적용됨).
let picked: string | null = null;

export function setPickedBarcode(value: string): void {
  picked = value;
}

export function takePickedBarcode(): string | null {
  const v = picked;
  picked = null;
  return v;
}
