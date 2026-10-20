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
