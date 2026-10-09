-- 새 버전 안내 (src/lib/app-update.ts)
--  출시가 플레이스토어에 실제로 공개된 뒤에 latest_version_code·update_notes를 바꿀 것
--  (먼저 바꾸면 스토어에 아직 새 버전이 없는데 안내가 뜬다).
--  min_version_code: 이보다 낮은 버전은 "나중에" 없이 업데이트만 가능(심각한 버그 때만).
alter table public.app_config
  add column if not exists latest_version_code int not null default 0,
  add column if not exists min_version_code int not null default 0,
  add column if not exists update_notes text not null default '';
