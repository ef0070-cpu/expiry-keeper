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
        warn: '#E8890C',
        ok: '#1B9C57',
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
