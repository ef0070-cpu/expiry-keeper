# 인수인계 — 유통기한 매니저 (2026-10-18 기준)

> 다음 작업자(개발자·Claude 세션)와 사장님이 함께 보는 문서. 맨 위 "지금 상태"와 "남은 일"부터 읽으면 된다.
> 이전판(10/9 기준)은 git 기록에 있다: `git show 06a97c9:docs/HANDOFF.md`

## 1. 지금 상태 한눈에

| 항목 | 상태 |
|---|---|
| 앱 이름 | **유통기한 매니저** (바꾸지 말 것 — 예전에 "지킴이"로 바꿨다가 빌드 1회 낭비) |
| 패키지 | `com.shlab.expirykeeper`, 저장소 `C:\Users\USER\expiry-keeper` (main 브랜치) |
| 최신 빌드 | **v31 (versionCode 31, versionName 1.1.0)** — 내부 테스트 트랙 출시. 10/13 폴드에 플레이스토어로 설치 성공 확인 |
| 프로덕션 트랙 | v30 출시 진행(AD_ID 오류는 "권한 없이 출시"로 처리). **v31을 프로덕션에 올렸는지는 미확인** — 플레이 콘솔에서 확인 |
| 스토어 공개 | 10/16 로그인 없는 상태로 스토어 페이지 열림·"설치" 버튼 확인 → 일반 공개됨 |
| 버전 이름 | v30·v31 모두 1.1.0 → **다음 빌드는 1.1.1 이상으로** (`app.json` `expo.version`) |
| 유료화 스위치 | 서버 `app_config.paywall_enabled = false` → 매장 기능 전부 무료 |
| 결제 확인 서버 | `verify-purchase` **미배포**(10/9 확인, 이후 바뀐 기록 없음). 이 상태로 유료화 스위치 켜면 안 됨 |
| 홍보 | 10/16 첫 주간 홍보 묶음 완성(`docs/marketing/`), **아직 게시 안 함** |

### 사용자 수 (10/18, Supabase `auth.users` 조회)

| 구분 | 가입 | 상품 등록 | 최근 7일 로그인 | 최근 7일 신규 |
|---|---|---|---|---|
| 일반 | 18 | 8 | 7 | 7 |
| 테스터(`tester_emails` 일치) | 16 | 9 | 3 | 0 |
| 합계 | **34** | 17 | 10 | 7 |

- 일반 18명에 사장님 본인·카카오 로그인 테스터(이메일 불일치)가 섞였을 수 있음 → 실제 외부 사용자는 조금 적을 수 있음
- 설치 수·로그인 없이 쓰는 사용자는 플레이 콘솔에서만 확인 가능
- 다시 조회하는 SQL은 7장 참고

## 2. 커밋 안 된 작업 (이어서 할 것)

- **네이버 쇼핑 사진 고르기 개선** — 묶음·박스·중고 판매글을 뒤로, 네이버 가격비교 대표 사진을 앞으로
  - 새 파일 `supabase/functions/_shared/naver-pick.ts` + 자가검사 `naver-pick.selfcheck.ts` (`npx tsx supabase/functions/_shared/naver-pick.selfcheck.ts`)
  - 수정 `supabase/functions/barcode-lookup/index.ts`, `_shared/image-search.ts` (네이버 결과를 2배 받아 정렬)
  - 할 일: 자가검사 통과 확인 → 커밋 → `barcode-lookup`·`image-search` 함수 배포 (서버 함수라 앱 빌드 불필요)
- `kakao-app-icon-128.png` 변경 — 무엇 때문인지 확인 후 커밋 여부 결정
- `docs/marketing/` 전체 — 커밋 안 함

## 3. v31에 들어간 변경 (10/9 이후 추가분)

10/9판의 v31 목록(수량 직접 입력, 날짜 표기 순서, 바코드 국가 추천, 중국 제품 제조일+기간 팝업, 붙은 8자리 날짜 인식, 바코드 다시 촬영, 새 버전 안내 창, 새 아이콘)에 더해:

- 매장 무료 한도 상품 30→**50개**, 발주서·가격표 쓸 때마다 남은 횟수 안내창, 상품별 알림 횟수 제한 없앰 (`ff5ad2a`)
- 매장 무료 사용자 하단 배너 — 발주 관리·계산기 화면에도 (`fae6b23`)
- 사용자 증가 대비: 목록 1000개씩 끝까지 받기(넘으면 잘리던 문제), 손대지 않은 공용 발주 상품은 서버에 안 올림, 인덱스 SQL (`edb1a38`)
- 발주: 신규·수정 표시 하루 유지, 직접 등록한 상품 맨 위, 검색 목록 성능(개선 후 재측정 안 함) (`6035a86`, `d2f74ba`, `214ebce`)
- v31 출시 전 점검 수정 묶음 (`3f36591`)
- **가정용 전면 광고 단위 ID 연결** `src/lib/interstitial.ts` — 새 상품 저장 직후·하루 1회·설치 3일 후, 광고 제거·매장 유료·테스터 제외 (`032a91b`)
- 안드로이드 알림 아이콘(흰 로봇 실루엣) (`8b20b52`)
- 출시 후 대응 에이전트 팀 `/issue`·`/promo`·`/team` (`a61c4d0`, 5장)

**폰에서 아직 직접 안 눌러 본 것**: 중국 제품 확인 창→팝업, 바코드 다시 촬영, 수량 직접 입력, 붙은 날짜 사진 인식, 전면 광고 노출 조건

## 4. 사장님이 하실 일 (순서대로)

1. **플레이 콘솔 확인** — v31이 프로덕션에 나갔는지, 스토어 등록정보 검토(10/8 제출) 결과
2. **결제 상품 등록** — 인앱 상품 `ad_free_lifetime` 1,900원 / 정기 결제 `retail_monthly` 월 3,900원
3. **결제 확인 서버** — 구글 클라우드 서비스 계정 → 플레이 콘솔 권한 부여 → 키를 Supabase 비밀값으로 → `verify-purchase` 배포. (같은 서비스 계정으로 나중에 리뷰 자동 수집도 가능)
4. **라이선스 테스트 계정**으로 내부 테스트판 결제·복원·해지 시험
5. **홍보 게시 시작** — `docs/marketing/2026-10-16/CHECKLIST.md` 순서대로 (6장)
6. **유료화 스위치는 아직 끄고 둠** — 켜는 조건: 결제 시험 통과 + 꾸준히 쓰는 매장 30곳 이상 + 상당수가 50개 한도 근처. 켤 때 2주 전 앱 공지·얼리버드 혜택. 비수기(10~2월)에 매장을 모으고 1~2월 전환, 3월 성수기부터 본격 홍보하는 일정 제안
7. 미결 결정: 얼리버드 보상(유료화 때 6개월 무료) 여부, 매장 가격 3,900원 vs 4,900원, 스토어 짧은 설명 교체(`docs/marketing/PLAN.md` 6장 — 지금 문구의 "끝판왕"은 최상급 표현)

## 5. 출시 후 운영 — 에이전트 팀

`expiry-keeper` 폴더를 **작업 폴더로 열고** Claude Code를 시작해야 `.claude/agents/`의 `ek-*` 에이전트와 명령이 등록된다(홈 폴더에서 시작하면 안 잡힘 — 10/16 실제로 겪음. 그때는 general-purpose 에이전트에 `ek-*.md`를 읽고 따르라고 지시해 대신함).

| 명령 | 쓰임 |
|---|---|
| `/issue <문제>` | 리뷰·오류·콘솔 경고 → triage → fixer/backend/store-ops → reviewer. 기록은 `docs/INCIDENTS.md` |
| `/promo [지난주 결과]` | 주간 홍보 묶음 → `docs/marketing/<날짜>/` |
| `/team <일>` | 지표 분석, 법무 점검, 빌드 준비 등 |

모든 에이전트는 초안만 만든다. 게시·빌드·배포·운영 DB 변경은 사장님.

## 6. 홍보 (10/16 첫 실행 결과)

- `docs/marketing/PLAN.md` — 4주 계획(10/19 주~11/9 주), 목표(4주 설치 100·매장 30곳), 채널별 UTM 링크, ASO 개선안, 결과 기록표
- `docs/marketing/2026-10-16/` — 1주차 "찬바람 불 때, 냉동고·냉장고 유통기한 대점검"
  - `naver-blog.md`(+ 붙여넣기용 `naver-blog-paste.txt`, 사진 `images/`), `instagram-threads.md`, `youtube-shorts.md`, `community.md`
  - `LEGAL-REVIEW.md`(높음 0·중간 4·낮음 6, 문장 수정은 반영 완료), `CHECKLIST.md`(요일별 게시 순서·기록표)
- 홍보 원칙: 개발자 본인 표시, 최상급·수치 효과 주장 금지, "지금은 매장 무료, 나중에 월 구독으로 바뀔 수 있음, 데이터는 남음"까지만. **"유료화 전 미리 알림"은 약속하지 않음**(지킬 장치 없음)
- 남은 문제
  - **스크린샷**: `store-assets/screenshots/` 01·02는 옛 이름 "지킴이"와 타사 상품 사진, 05는 타사 상품 사진 → 01·02 빼고 05는 흐림 처리 사본(`images/05-calendar-blur.jpg`) 사용 중. **테스트 계정**(직접 찍은 사진·"1호 매장" 같은 일반 이름)으로 다시 캡처 필요. 지금 폴드 앱은 실제 매장 데이터(지점 위치·상품 사진)가 보여 홍보 촬영 불가
  - **쇼츠 영상**: 아직 없음. 테스트 계정 준비 후 `adb shell screenrecord`로 녹화 → 유튜브 스튜디오에 비공개 업로드 예정. 자막을 영상에 넣으려면 ffmpeg 필요(이 PC에 없음)
  - **아이스크림 날짜 표시 확인 필요**: 국내 기준상 아이스크림류는 소비기한 생략·제조연월만 표시할 수 있는 것으로 앎(식약처 식품표시기준으로 확인). 맞다면 메시지 중심을 과자·음료·냉장 상품 날짜로 옮길 것
  - 점주 카페 후보는 검색으로 존재·규칙 확인 못 함 → 실제 가입한 카페의 홍보 게시판 규칙 확인 후 게시
  - 법무 "전문가 확인 권장": 기본 발주 목록(icemoa 기반) 데이터베이스 권리, 지인 메시지의 정보통신망법 제50조 적용
- 다음 주: 게시 결과를 `CHECKLIST.md` 기록표에 적고 `/promo 지난주 결과: ...` 실행. 설치 수는 플레이 콘솔 → 사용자 획득 → 획득 보고서 → 캠페인 `wk1019`

## 7. 개발·테스트·조회 방법

- **폰 테스트(빌드 없이)**: 폴드 USB 연결·USB 디버깅 허용 → 개발용 앱 설치
  `adb install -r "%TEMP%\expiry-dev-e6ce0141.apk"` (versionCode 27 개발 클라이언트 — 네이티브 모듈이 안 바뀌는 한 재사용 가능)
  → `npx expo start --dev-client --localhost --port 8081` → `adb reverse tcp:8081 tcp:8081`
  → `adb shell am start -a android.intent.action.VIEW -d "exp+expiry-keeper://expo-development-client/?url=http%3A%2F%2Flocalhost%3A8081"`
- 스토어판과 개발용 앱은 서명이 달라 **같이 설치 불가**(지우고 설치). **10/13 현재 폴드에는 스토어판 v31**이 깔려 있음
- 스토어 빌드를 폴드에 직접: `bundletool build-apks --connected-device` + 테스트 키 → `install-apks` (R8 문제는 스토어 빌드에서만 보임 — v29 로그인 거부 원인)
- 검사: `npx tsc --noEmit` (login.tsx 115행 기존 경고 1건 무시), 자가검사 `npx tsx src/lib/*.selfcheck.ts`
- 화면 캡처: `adb exec-out screencap -p -d 4630947194243491972` (폴드 바깥 화면 ID). Git Bash에서 adb 쓸 땐 `export MSYS_NO_PATHCONV=1` (안 하면 `/data` 같은 경로가 Windows 경로로 바뀜)
- 설치 실패 원인 보기: `adb logcat -d | grep -i expirykeeper` — 10/13 내부 테스트 직후 `statusCode:1010`(설치 정보 받기 단계 실패)은 출시 직후 반영 지연이었고 4분 뒤 재시도로 해결
- **사용자 수 조회**: Supabase 대시보드 → SQL Editor (읽기 전용 SELECT만)
  ```sql
  select case when lower(u.email) in (select lower(email) from public.tester_emails) then 'tester' else 'general' end as kind,
   count(*) as users,
   count(*) filter (where exists (select 1 from public.products p where p.user_id = u.id)) as has_products,
   count(*) filter (where u.last_sign_in_at > now() - interval '7 days') as signin_7d,
   count(*) filter (where u.created_at > now() - interval '7 days') as new_7d
  from auth.users u group by 1 order by 1;
  ```
- **Supabase CLI 로그인 만료**(10/18 "Invalid access token") → `npx supabase login` 한 번 하면 터미널에서 `npx supabase db query --linked "..."`로 조회 가능
- **Claude in Chrome 제한**(10/16~18 확인): 네이버 블로그·카페, 스레드, 플레이 콘솔은 확장의 안전 제한으로 접근 불가. 유튜브 스튜디오·Supabase 대시보드는 가능. 인스타그램은 열리지만 로그아웃 상태

## 8. 주의할 점 (겪은 문제)

- **빌드 전 반드시 사장님 승인** (EAS 무료 빌드 한도). 이름·아이콘 같은 네이티브 변경은 빌드해야만 반영
- **C 드라이브 공간** — 한때 0.11GB까지 떨어져 작업이 멈춤. 빌드·설치 전 여유 공간 확인
- node 스크립트로 코드 패치할 때 템플릿 문자열 안 `\d`, `\D`가 `d`, `D`로 깨지는 일이 두 번 → 정규식은 Edit 도구로 넣고 자가검사로 확인
- 플레이 콘솔: AD_ID 오류는 활성으로 남은 옛 빌드(v20/24/25) 때문 → **"권한 없이 출시"**("선언 업데이트" 누르지 말 것) / 아이콘·그래픽 교체 시 삭제가 늦게 반영돼 2개가 되는 경우 / 저장 버튼이 화면 밖이면 ⋮ → 저장 / "임시보관함에 저장"만으론 게시 개요에 안 올라감 → 다음 → 저장 / 새 애셋은 AI 생성 라벨 다시 체크
- 앱 번들 상세의 "최적화·축소 비율 –" 와 "AGP 9.0 업그레이드" 권장은 조치 불필요(AGP는 Expo SDK가 정함, R8 설정 건드리면 v29 같은 문제 위험)
- 사장님 테스트 팀 계정 발주 상품 중복 — 10/6 서버 정리 완료(5,631→3,200개). 남은 이름 중복 1건 "포도젤로바"

## 9. 핵심 파일

| 파일 | 내용 |
|---|---|
| `src/app/product-form.tsx` | 상품 등록·수정 (날짜 순서, 수량, 바코드 재촬영, 중국 팝업) |
| `src/lib/date-ocr.ts` | 날짜 인식 규칙, 바코드 국가 추천 (`date-ocr.selfcheck.ts`) |
| `src/lib/dates.ts` | 날짜 계산·순서 변환·제조일 계산 (`dates.selfcheck.ts`) |
| `src/lib/mfg-period.ts` | 바코드별 보존기간 기억 |
| `src/lib/plan-limits.ts`, `entitlement.ts`, `billing.ts` | 무료 한도·유료 권한·결제 |
| `src/lib/interstitial.ts` | 가정용 전면 광고 조건 |
| `src/lib/app-update.ts` | 새 버전 안내 창 (`app_config.latest_version_code`·`min_version_code`) |
| `src/components/ExpiryLiveScanCamera.tsx` | 실시간 인식 (`preferPast` = 제조일 모드) |
| `supabase/functions/` | `barcode-lookup`·`image-search`·`delete-account`(배포됨), `verify-purchase`(미배포) |
| `supabase/migration-entitlements.sql` | 권한·테스터·이벤트 코드·`app_config` |
| `docs/monetization.md` | 유료화 결정 문서 (3-3 초안에 "상품 30개" 남아 있음 → 50개로 고칠 것) |
| `docs/marketing/` | 홍보 계획·주간 묶음 |
| `docs/INCIDENTS.md` | 출시 후 문제 기록 (`/issue`) |
| `.claude/agents/`, `.claude/commands/` | 에이전트 팀 정의 |
| `store-assets/` | 스토어 아이콘 512, 그래픽 1024×500, 스크린샷(01·02·05 교체 필요) |
