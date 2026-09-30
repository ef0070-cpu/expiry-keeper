-- 보안: product-images 덮어쓰기를 올린 본인만 가능하게 (2026-09-30 보안 점검)
-- 예전 규칙은 bucket_id만 확인해서, 로그인한 누구나 남의 상품 사진(상품ID.jpg)을 같은 이름으로
-- 올려 덮어쓸 수 있었다. 새로 올리기(insert)는 그대로 둔다 — 스토어에 나간 앱(옛 경로에 올림)도
-- 계속 동작해야 하고, insert만으로는 이미 있는 파일을 바꿀 수 없다.
-- 새 앱은 사용자 폴더(auth.uid()/…)에 올려, 팀원이 서로의 상품 사진을 바꿔도 막히지 않는다.

drop policy if exists "authenticated update" on storage.objects;
create policy "authenticated update" on storage.objects
  for update to authenticated
  using (bucket_id = 'product-images' and owner_id = (select auth.uid())::text)
  with check (bucket_id = 'product-images' and owner_id = (select auth.uid())::text);
