/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        sand: {
          DEFAULT: '#E8DCC8',
          light: '#F2EBE0',
          dark: '#D4C4A8',
        },
        brown: {
          DEFAULT: '#6d5537',
          dark: '#5C4A32',
          darker: '#3D2E1C',
        },
        charcoal: '#2A2318',
        cream: '#FAF6F0',
        accent: {
          orange: '#a44200',
          glow: '#E8863E',
          red: '#ba4135',
          green: '#2c701d',
          'green-light': '#6DBF5A',
          blue: '#4A7FB5',
        },
      },
      fontFamily: {
        pixel: ['"Press Start 2P"', 'monospace'],
        mono: ['"Space Mono"', 'monospace'],
        sans: ['"DM Sans"', 'sans-serif'],
      },
      animation: {
        blink: 'blink 2s infinite',
      },
      keyframes: {
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
      },
    },
  },
  plugins: [],
};
