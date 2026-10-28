# 출시 후 문제 기록 — 유통기한 매니저

> `/issue <문제>`로 대응할 때마다 맨 위에 한 건씩 추가. 상태: 조사중 / 수정완료(빌드대기) / 해결 / 보류

<!-- 형식
## 2026-10-09 [P1] 증상 한 줄
- 버전·기기: v30 / 갤럭시 폴드
- 원인: ...
- 조치: ... (파일, 커밋)
- 상태: 수정완료(빌드대기)
- 사장님 결정 대기: ...
-->

## 2026-10-28 [P3] 서버 상품 카테고리를 사장님 편집본으로 교체 (엑셀 → 서버)
- 버전·기기: 서버(Supabase) — 앱은 v33(1.2.1)부터 새 분류와 짝이 맞음
- 내용: 서버 `order_catalog`를 엑셀로 내보내 사장님이 카테고리·이름·가격을 고친 뒤 다시 반영. 398건 수정·17건 삭제(테스트 3건 포함) → 683건, 카테고리 16종. 백업 표 `order_catalog_backup_20261028`(700건) 생성 후 한 트랜잭션, 수정·삭제 건수가 어긋나면 전체 취소. 사진(`image_uri`)은 유지
- 겪은 일: 첫 시도는 삭제 목록 SQL에 괄호가 빠져 문법 오류로 중단(트랜잭션 취소로 서버 변화 없음), 고쳐서 재실행. 대시보드 탭 하나가 응답 없이 멈춤(새 탭에서 처리)
- 주의: 앱 내장 기본 목록(`order-seed-data.ts`)은 옛 카테고리 기준이라 새로 설치한 폰·오프라인에서는 옛 분류가 먼저 보일 수 있음. 이미 폰에 저장된 옛 상품은 앱이 지우지 않음
- 되돌리기: 백업 표에서 복구(`begin; delete from public.order_catalog; insert into public.order_catalog select * from public.order_catalog_backup_20261028; commit;`). 이상 없음을 확인한 뒤 백업 표 `20261024`·`20261028`은 사장님이 삭제
- 상태: 해결(서버 반영 완료) — 폰에서 카테고리 칩 확인은 아직

## 2026-10-27 [P3] 서버 기본 발주 목록 교체 (881c893)
- 버전·기기: 서버(Supabase)
- 내용: 기본 발주 상품 388→689건, 카테고리 8개. 서버 `order_catalog` 교체 SQL `supabase/migration-order-catalog-replace-2026-10-24.sql` (백업 표 `order_catalog_backup_20261024` 생성, 옛 시드에만 있던 54건 삭제, 사용자가 올린 사진은 유지, 한 트랜잭션)
- 결과: 10/27 대시보드 SQL Editor에서 실행. 431→700건(새 688 + 승인돼 들어온 12), 옛 시드만 남은 행 0. 10/28 편집본으로 다시 교체(위 항목)
- 상태: 해결

## 2026-10-27 [P3] 발주 이력 읽기가 한 번 실패하면 기존 이력이 새 1건으로 덮어써질 수 있음 (출시 전 검토 지적)
- 버전·기기: v32 개발 중 코드 — 출시 전에 발견, 사용자 영향 없음
- 원인: `listOrderHistory`가 읽기 예외를 빈 목록으로 삼키고 `addOrderHistory`가 그 빈 목록에 1건을 붙여 통째로 저장. 한 키에 500건을 두면 Android 저장소 한 행 용량(약 2MB)에도 닿을 수 있었음
- 조치: 읽기 실패면 저장하지 않음(호출부는 실패를 무시하고 발주 계속), 보관 상한 200건, 깨진 항목 걸러냄, 음성 입력 500자 제한 (`94ee3d6`, `src/lib/order-history.ts`, `src/components/VoiceOrderModal.tsx`)
- 상태: 수정완료(빌드대기)

## 2026-10-21 [P3] RLS 정책 30개 성능 경고(Auth RLS Initialization Plan)
- 원인: public 정책 안의 `auth.uid()`가 행마다 다시 계산됨
- 조치: 원래 정의를 `backup.rls_policies_20261021`(RLS 켬, 비공개 스키마)에 저장 후 `(select auth.uid())`로 일괄 변경. 정책 의미는 동일
- 확인: backed_up 30 / remaining 0, Advisor에서 해당 경고 0건
- 되돌리기: 백업 테이블의 qual·with_check로 `alter policy` 재실행
- 상태: 해결 — 앱 동작(발주·팀 공유) 폰 확인은 아직

## 2026-10-21 [P1] 관리자용 뷰 order_product_reports_with_user가 공개 키로 조회됨
- 버전·기기: 서버(Supabase) — 앱 버전 무관
- 원인: 대시보드에서 직접 만든 뷰(신고 + auth.users 제출자 정보)가 security definer로 실행되고 anon/authenticated에 SELECT 권한이 있었음. Advisor CRITICAL 2건(Exposed Auth Users, Security Definer View)
- 확인: 로그인 없이 공개 키로 REST 조회 시 88행 응답(행 수만 확인, 내용은 받지 않음)
- 조치: `supabase/migration-fix-reports-with-user-exposure.sql` — 공개 권한 회수 + security_invoker. 앱 코드는 이 뷰를 안 씀
- 상태: 해결 — 10/21 대시보드 SQL Editor에서 실행. 남은 권한은 postgres·service_role뿐, 공개 키 재조회 시 401 `permission denied`, Advisor CRITICAL 2건 사라짐
- 남은 확인: 조치 전 외부 조회가 있었는지는 Supabase API 로그로만 확인 가능(미확인)
