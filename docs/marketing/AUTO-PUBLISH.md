# 인스타그램·스레드 자동 게시 설정

흐름: `/promo` → 원고·법무 검토·`publish.json`·카드 이미지 → **사장님 확인 후 `"approved": true`** → 작업 스케줄러가 30분마다 `node scripts/publish-promo.mjs --live` → 게시 시각이 된 것만 올리고 링크를 `publish-state.json`에 기록.

| 파일 | 역할 |
|---|---|
| `scripts/make-promo-cards.mjs` | `publish.json`의 slides → 1080×1350 카드 JPEG(`images/`) |
| `scripts/publish-promo.mjs` | 게시. 인자 없이 실행하면 미리보기(검사만), `--live`면 실제 게시 |
| `scripts/publish-promo.selfcheck.mjs` | 게시 판단 로직 자가검사 |
| `docs/marketing/<날짜>/publish.json` | 게시 계획(채널·시각·글·카드) |
| `docs/marketing/<날짜>/publish-state.json` | 게시 결과(시각·링크·마지막 오류) — 자동 생성 |

## 안전장치
- `approved`가 정확히 `true`일 때만 올린다. 에이전트는 이 값을 바꾸지 않는다.
- 예정 시각이 지나고 **3시간 안**일 때만 올린다(PC가 꺼져 있다 켜져도 새벽에 밤 글이 나가지 않음 — 놓친 글은 시각을 고쳐 다시 승인).
- 이미 올린 항목은 다시 올리지 않는다. 실패한 항목은 다음 회차(30분 뒤)에 다시 시도.
- 사진이 없거나, JPEG가 아니거나, GitHub에 푸시 안 됐거나, 글에 `[촬영 필요]`가 남아 있으면 그 항목은 보류.
- 인스타는 사진 1~10장 필수, 글 2,200자·해시태그 30개까지. 스레드는 글 500자까지(사진 없이 글만 가능).

## 1. 인스타그램 토큰 (한 번만, 약 15분)
메뉴 이름은 Meta가 자주 바꾼다 — 비슷한 이름을 찾으면 된다.
1. 인스타 앱 → 설정 → 계정 유형 → **프로페셔널 계정**(크리에이터 또는 비즈니스)으로 전환
2. https://developers.facebook.com → 내 앱 → **앱 만들기** → 사용 사례 "Instagram에서 메시지 및 콘텐츠 관리" 선택
3. 앱 대시보드 → Instagram → **Instagram 로그인을 사용한 API 설정** → "액세스 토큰 생성" → 계정 추가(인스타 로그인)
   - 권한: `instagram_business_basic`, `instagram_business_content_publish`
4. 화면에 나온 **인스타 사용자 ID**와 **토큰**을 `.env`에:
   ```
   IG_USER_ID=...
   IG_ACCESS_TOKEN=...
   ```

## 2. 스레드 토큰 (한 번만)
1. 같은 앱 → 사용 사례 추가 → **"Threads API 액세스"**
2. 앱 역할 → **Threads 테스터**에 내 스레드 계정 추가 → 스레드 앱 → 설정 → 계정 → 웹사이트 권한 → 초대 수락
3. 권한 `threads_basic`, `threads_content_publish`로 사용자 토큰 생성(그래프 API 탐색기에서 `threads.net` 선택)
4. 사용자 ID 확인: 브라우저에서 `https://graph.threads.net/v1.0/me?fields=id&access_token=토큰`
5. `.env`에:
   ```
   THREADS_USER_ID=...
   THREADS_ACCESS_TOKEN=...
   ```

`.env`는 git에 안 올라간다(`.gitignore`). 저장소가 공개라 **토큰을 다른 파일에 적지 말 것.**

## 3. 토큰 갱신 (60일마다)
장기 토큰은 60일 뒤 만료된다. 만료 전에 브라우저로 열면 새 토큰이 나온다 → `.env`의 값 교체.
- 인스타: `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=지금토큰`
- 스레드: `https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=지금토큰`

## 4. 매주 하는 일
1. `/promo` 결과 확인 → 없는 스크린샷을 `<날짜>/shots/`에 넣기
2. `node scripts/make-promo-cards.mjs docs/marketing/<날짜>` → `images/` 카드 확인
3. 커밋·푸시(카드가 GitHub에 있어야 Meta가 가져감)
4. `node scripts/publish-promo.mjs` 로 미리보기 → 전부 ✓이면 `publish.json`의 `"approved": true`
5. 프로필 링크를 그 주 UTM 링크로 교체(API로 못 바꿈)

## 5. 자동 실행 등록 (한 번만, 토큰 넣은 뒤)
명령 프롬프트(cmd)에서:
```
schtasks /Create /SC MINUTE /MO 30 /TN "ExpiryKeeperPromo" /TR "cmd /c cd /d C:\Users\USER\expiry-keeper && node scripts\publish-promo.mjs --live >> %TEMP%\expiry-promo.log 2>&1"
```
- 기록 보기: `%TEMP%\expiry-promo.log`
- 끄기: `schtasks /Delete /TN "ExpiryKeeperPromo" /F`
- PC가 켜져 있어야 실행된다.

## 처음 한 번 시험
승인 전 `node scripts/publish-promo.mjs`(미리보기)로 ✓를 확인하고, 첫 실제 게시는 스레드 글 하나로 시험하는 것을 권장(시각을 몇 분 뒤로 둔 항목 하나만 `approved: true` → `node scripts/publish-promo.mjs --live` 직접 실행 → 링크 확인).
