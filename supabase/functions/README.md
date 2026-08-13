# Edge Functions

`barcode-lookup`, `image-search` — 식품안전나라/네이버/카카오 API 키를 서버에만 보관하기 위한 프록시. 클라이언트는 `src/lib/barcode-lookup.ts`에서 `supabase.functions.invoke()`로 호출한다.

## 배포

```
npx supabase login
npx supabase link --project-ref ocbwjiziwzkgkwzzkvvf
npx supabase secrets set FOODSAFETY_API_KEY=... KAKAO_REST_KEY=...
# 네이버를 쓸 경우: NAVER_CLIENT_ID=... NAVER_CLIENT_SECRET=...
npx supabase functions deploy barcode-lookup
npx supabase functions deploy image-search
```

## 로컬 테스트 (선택)

```
npx supabase functions serve
```

`.env.local`(supabase/functions 폴더 기준)에 위 secrets를 넣으면 로컬에서도 동작한다.
