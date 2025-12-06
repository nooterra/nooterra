import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

const config: Config = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      borderRadius: {
        lg: '0px',
        md: '0px',
        sm: '0px',
        DEFAULT: '0px',
      },
      colors: {
        background: '#000000', // Absolute Void
        foreground: '#FFFFFF', // Absolute Light
        muted: '#1A1A1A',
        border: '#333333',
        accent: {
          DEFAULT: '#FFFFFF', // In brutalism, accent is often just high contrast white
          inverse: '#000000',
        },
        surface: {
          50: '#111',
          100: '#222',
          900: '#000',
        }
      },
      fontFamily: {
        sans: ['Geist Sans', 'Helvetica Neue', 'Arial', 'sans-serif'], // Standard, hard
        mono: ['Geist Mono', 'Menlo', 'Monaco', 'Courier New', 'monospace'],
      },
      animation: {
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        'blink': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [animate],
} satisfies Config;

export default config;
