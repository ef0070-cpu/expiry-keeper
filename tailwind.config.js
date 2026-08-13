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
    },
  },
  plugins: [],
};
