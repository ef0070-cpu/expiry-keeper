@echo off
rem 게시하는 날(월·수·금) 오전 9시: 그날 인스타·스레드 1세트를 만들고(/promo 하루치 모드), 조건을 통과하면 자동 승인·푸시한다.
rem 게시는 publish-promo.mjs가 오후 4시(publish.json의 at)에 한다. 커밋·푸시는 auto-approve.mjs만 한다(승인된 그날 폴더의 카드·계획만).
rem 예약: schtasks /Create /SC WEEKLY /D MON,WED,FRI /ST 09:00 /TN "ExpiryKeeperDailyPromo" /TR "C:\Users\USER\expiry-keeper\scripts\daily-promo.cmd"
rem 끄기:  schtasks /Delete /TN "ExpiryKeeperDailyPromo" /F
cd /d C:\Users\USER\expiry-keeper
set LOG=%TEMP%\expiry-daily-promo.log
echo ===== %DATE% %TIME% 하루치 /promo 시작 >> "%LOG%"
call claude -p "/promo 하루치 모드로 진행한다. 오늘 날짜 폴더에 인스타그램 1개와 스레드 1개(같은 주제 1세트)만 만든다(블로그·쇼츠·커뮤니티는 만들지 않는다). 주제는 docs/marketing/PLAN.md의 요일별 순서를 따른다(월 매장 발주, 수 가격표·계산기, 금 가정 냉장고). publish.json의 at은 오늘 날짜 16:00 (+09:00)로 한다. 카드 이미지는 앱 화면 캡처 없이 만들 수 있는 글자·도형 카드로 만든다. 법무 검토와 팀장 심사까지 하고 REVIEW.md 맨 위에 '판정: **통과**' 또는 '판정: **반려**' 한 줄을 쓴다. 게시·커밋·푸시는 하지 말고 approved는 false로 둔다. 스레드는 BRAND-VOICE 4-1장(설치 링크 1개+주제 태그 1개), 인스타는 검색 문구와 해시태그 5개 이하로 쓴다." --permission-mode acceptEdits --allowedTools "Read Write Edit Glob Grep Agent WebSearch WebFetch Bash(node scripts/make-promo-cards.mjs:*)" >> "%LOG%" 2>&1
echo ----- 자동 승인 검사 >> "%LOG%"
node scripts\auto-approve.mjs --apply >> "%LOG%" 2>&1
echo ===== %DATE% %TIME% 종료 >> "%LOG%"
