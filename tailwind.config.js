/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        primary: '#CC2222',
        ink: '#1A1A1A',
        muted: '#888888',
        line: '#E5E5E5',
        // 흰 바탕·흰 글자 모두 4.5:1 이상(WCAG AA) — 예전 #E8890C(2.6:1)·#1B9C57(3.5:1)은
        // '임박' 숫자와 D-day 배지 글자가 잘 안 보였다 (2026-09-30)
        warn: '#B45309',
        ok: '#1B7F47',
        // 유통기한 상태 표시 전용(대시보드 카드·D-day 배지·캘린더 점) — 앱 대표색(primary)과 분리 (2026-09-30 지정)
        'sig-red': '#FF002B', // 만료·7일 이내
        'sig-yellow': '#FB8500', // 임박(한달 이내)
        'sig-green': '#008000', // 여유(한달 이상)
        paper: '#FFFFFF',
        bg: '#F7F7F7',
      },
      // 글씨가 작다는 사용자 클레임 반영 — 기본 스케일 대비 한 단계씩 키움 (2026-08-29)
      fontSize: {
        xs: ['13px', { lineHeight: '18px' }],
        sm: ['15px', { lineHeight: '21px' }],
        base: ['17px', { lineHeight: '25px' }],
        lg: ['19px', { lineHeight: '27px' }],
        xl: ['21px', { lineHeight: '29px' }],
        '2xl': ['25px', { lineHeight: '31px' }],
        '3xl': ['31px', { lineHeight: '37px' }],
      },
    },
  },
  plugins: [],
};
