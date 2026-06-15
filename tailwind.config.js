/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // opencue accent palette — refined later in Phase 1 overlay design.
        cue: {
          50: '#f5f7ff',
          100: '#e8ecff',
          200: '#cdd5ff',
          300: '#a4b1ff',
          400: '#7585ff',
          500: '#4f5cff',
          600: '#3a3df0',
          700: '#2f2dca',
          800: '#2728a2',
          900: '#1e1f7a',
        },
      },
    },
  },
  plugins: [],
};
