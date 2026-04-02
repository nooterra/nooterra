/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Core palette — deep, cool, precise
        surface: {
          0: '#0a0a0f',      // deepest background
          1: '#0f1017',      // primary background
          2: '#161822',      // elevated surfaces (cards, panels)
          3: '#1e2130',      // secondary elevated
          4: '#282c3e',      // tertiary / hover states
        },
        edge: {
          DEFAULT: '#2a2d3d', // default borders
          subtle: '#1e2130',  // subtle dividers
          strong: '#3d4155',  // prominent borders
        },
        text: {
          primary: '#e8e9ed',   // primary text
          secondary: '#8b8fa3', // secondary / muted text
          tertiary: '#5a5e72',  // disabled / placeholder
          inverse: '#0a0a0f',   // text on light backgrounds
        },
        // Accent — one sharp color, used sparingly
        accent: {
          DEFAULT: '#4f8ff7',  // primary accent (actions, links)
          hover: '#6ba0f9',
          muted: '#4f8ff720',  // for subtle backgrounds
        },
        // Semantic — state communicates through color
        status: {
          healthy: '#34d399',      // green — autonomous, success
          'healthy-muted': '#34d39920',
          attention: '#f59e0b',    // amber — needs review
          'attention-muted': '#f59e0b20',
          blocked: '#ef4444',      // red — denied, error, incident
          'blocked-muted': '#ef444420',
          predicted: '#a78bfa',    // purple — estimates, predictions
          'predicted-muted': '#a78bfa20',
          info: '#4f8ff7',         // blue — informational
          'info-muted': '#4f8ff720',
        },
        // Legacy compat
        nooterra: {
          dark: '#0f1017',
          card: '#161822',
          border: '#2a2d3d',
          accent: '#4f8ff7',
          success: '#34d399',
          warning: '#f59e0b',
          error: '#ef4444',
        },
      },
      fontFamily: {
        sans: ['"Geist"', '"Inter"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"Geist Mono"', '"JetBrains Mono"', '"IBM Plex Mono"', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],   // 10px
        'xs': ['0.6875rem', { lineHeight: '1rem' }],       // 11px
        'sm': ['0.75rem', { lineHeight: '1.125rem' }],     // 12px
        'base': ['0.8125rem', { lineHeight: '1.25rem' }],  // 13px
        'md': ['0.875rem', { lineHeight: '1.375rem' }],    // 14px
        'lg': ['1rem', { lineHeight: '1.5rem' }],          // 16px
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],      // 20px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],         // 24px
        '3xl': ['2rem', { lineHeight: '2.5rem' }],         // 32px
        '4xl': ['2.5rem', { lineHeight: '3rem' }],         // 40px
        '5xl': ['3.5rem', { lineHeight: '1.1' }],          // 56px
        '6xl': ['4.5rem', { lineHeight: '1.05' }],         // 72px
      },
      spacing: {
        '4.5': '1.125rem',
        '18': '4.5rem',
        '88': '22rem',
        '128': '32rem',
      },
      borderRadius: {
        'sm': '4px',
        'DEFAULT': '6px',
        'md': '8px',
        'lg': '12px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0,0,0,0.3)',
        'DEFAULT': '0 2px 8px rgba(0,0,0,0.25)',
        'md': '0 4px 16px rgba(0,0,0,0.3)',
        'lg': '0 8px 32px rgba(0,0,0,0.4)',
        'glow-accent': '0 0 20px rgba(79,143,247,0.15)',
        'glow-healthy': '0 0 20px rgba(52,211,153,0.15)',
        'glow-attention': '0 0 20px rgba(245,158,11,0.15)',
        'glow-blocked': '0 0 20px rgba(239,68,68,0.15)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.15s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
