/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eefbff',
          100: '#d8f5ff',
          200: '#b9edff',
          300: '#89e3ff',
          400: '#50d0ff',
          500: '#28b5ff',
          600: '#0f97ff',
          700: '#0a7deb',
          800: '#0f64be',
          900: '#135595',
          950: '#11345a',
        },
        surface: {
          DEFAULT: '#0c0e14',
          raised: '#12151e',
          overlay: '#181c28',
        },
      },
      fontFamily: {
        display: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        sans: ['"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
      },
      animation: {
        'scan-pulse': 'scan-pulse 2s ease-in-out infinite',
      },
      keyframes: {
        'scan-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
};
