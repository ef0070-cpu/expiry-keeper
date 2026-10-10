-- 매장용 무료 상품 한도 30 → 50 (2026-10-09 사장님 결정). 앱 기본값(plan-limits.ts)도 50.
-- 상품별 알림 횟수 제한은 없앰 — 앱이 alert_limit을 더 이상 읽지 않는다(칸은 남겨 둠, 옛 버전 호환).
-- 옛 버전(v30 이하)은 아직 alert_limit을 읽어 무료 사용자 알림을 막으니 최대치(7)로 올려 제한을 푼다.
alter table public.app_config alter column product_limit set default 50;
alter table public.app_config alter column alert_limit set default 7;
update public.app_config set product_limit = 50, alert_limit = 7 where id = 1;
