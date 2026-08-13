# 유통기한 지킴이 (Expiry Keeper)

바코드 스캔으로 상품을 3초 만에 등록하고, 유통기한이 임박한 순서로 관리하는 소매점 재고 관리 앱입니다.

## 주요 기능

- **바코드 스캔 등록** — 스캔하면 상품명·이미지를 자동 조회 (Open Food Facts + 식품안전나라)
- **사진 직접 촬영** — 자동 조회에 이미지가 없으면 카메라로 촬영해 등록
- **유통기한 D-day 관리** — 만료 / 오늘까지 / 3일 이내 / 7일 이내 / 여유 있음 자동 그룹핑, 임박순 정렬
- **컬러 배지** — 만료(검정), 오늘·내일(빨강), 7일 이내(주황), 여유(초록)
- **검색·카테고리 필터** — 상품명, 바코드, 메모 검색 + 매장 위치별 필터
- **유통기한 알림** — 하루 전(D-1)과 당일 오전 9시 푸시 알림
- **로컬 우선 저장** — 설정 없이 바로 사용 가능. Supabase 키를 넣으면 클라우드 동기화 + 로그인 활성화

## 바로 실행하기 (로컬 모드)

1. 휴대폰에 **Expo Go** 앱을 설치합니다 (Play 스토어 / App Store에서 "Expo Go" 검색).
2. PC에서 실행:

```powershell
Set-Location C:\Users\Samsung\Desktop\expiry-keeper
npx expo start
```

3. 터미널에 뜨는 QR 코드를 휴대폰 카메라(또는 Expo Go 앱)로 스캔하면 앱이 열립니다.
   - PC와 휴대폰이 **같은 Wi-Fi**에 연결되어 있어야 합니다.

> 이 상태에서는 데이터가 휴대폰에만 저장됩니다(로컬 모드). 그래도 모든 기능이 동작합니다.

## Supabase 연동 (클라우드 모드, 선택)

여러 기기에서 같은 데이터를 보거나 팀원과 공유 기반을 만들려면:

1. https://supabase.com 에서 무료 프로젝트를 만듭니다.
2. **SQL Editor**에 `supabase/schema.sql` 내용을 붙여넣고 실행합니다.
3. **Project Settings > API**에서 `URL`과 `anon public` 키를 복사합니다.
4. 프로젝트 루트에 `.env` 파일을 만들고 채웁니다 (`.env.example` 참고):

```
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

5. `npx expo start`를 다시 실행하면 로그인 화면이 나타납니다.

> `anon` 키는 프런트엔드 공개용으로 설계된 키이며, 실제 데이터 보호는 서버의 RLS(행 수준 보안) 정책이 담당합니다. `service_role` 키는 절대 앱에 넣지 마세요. `.env`는 `.gitignore`에 포함되어 GitHub에 올라가지 않습니다.

## 한국 상품 바코드 조회 / 이미지 자동 검색

식품안전나라(바코드→상품명)와 네이버/카카오(상품 사진 검색) API 키는 **클라이언트(.env)가 아니라 Supabase Edge Function의 secrets**로 저장합니다. 앱 번들에 키가 평문으로 들어가는 것을 막기 위함입니다. 앱은 `supabase.functions.invoke()`로 `barcode-lookup` / `image-search` 함수를 호출하고, 실제 외부 API 호출은 서버(Edge Function)에서 일어납니다.

키 발급 및 배포 방법은 `supabase/functions/README.md` 참고.

## Google Play 배포 빌드

Expo의 EAS Build를 사용합니다:

```powershell
npm install -g eas-cli
eas login          # Expo 계정 필요 (무료)
eas build:configure
eas build --platform android --profile production
```

빌드가 끝나면 `.aab` 파일 링크가 나옵니다. 이 파일을 [Google Play Console](https://play.google.com/console)(개발자 계정 등록비 $25)에 업로드하면 됩니다.

> 참고: 푸시 알림은 Expo Go에서는 제한될 수 있습니다. `eas build --profile development`로 개발 빌드를 만들면 모든 기능이 완전하게 동작합니다.

## 프로젝트 구조

```
src/
  app/                # 화면 (expo-router 파일 기반 라우팅)
    index.tsx         # 대시보드 (상품 목록, 검색, 필터, 요약)
    scan.tsx          # 바코드 스캔
    product-form.tsx  # 상품 등록/수정
    login.tsx         # 로그인 (클라우드 모드에서만)
  components/         # ProductCard, DdayBadge, SummaryHeader, Fab
  lib/
    repo.ts           # 데이터 저장 (로컬 AsyncStorage ↔ Supabase 자동 전환)
    barcode-lookup.ts # 바코드 → 상품 정보 자동 조회
    notifications.ts  # 유통기한 알림 예약
    dates.ts          # D-day 계산, 날짜 유틸
    supabase.ts       # Supabase 클라이언트 (.env 없으면 null)
supabase/schema.sql   # DB 테이블 + 보안 정책 + Storage 버킷
```

## 기술 스택

- React Native + Expo SDK 57 (expo-router)
- NativeWind (Tailwind CSS)
- Supabase (인증 + PostgreSQL + Storage)
- expo-camera (바코드 스캔), expo-image-picker (사진 촬영), expo-notifications (알림)
