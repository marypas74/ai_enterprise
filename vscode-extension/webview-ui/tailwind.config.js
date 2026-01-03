/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Claude Code color palette
        'claude-bg': '#151515',
        'claude-bg-secondary': '#1a1a1a',
        'claude-bg-tertiary': '#2D2D2D',
        'claude-orange': '#D97757',
        'claude-orange-hover': '#E88A6A',
        'claude-orange-dim': 'rgba(217, 119, 87, 0.15)',
        'claude-text': '#E5E5E5',
        'claude-text-secondary': '#A0A0A0',
        'claude-text-muted': '#666666',
        'claude-border': '#333333',
        'claude-border-subtle': '#2a2a2a',
        'claude-success': '#4EC9B0',
        'claude-error': '#F14C4C',
        'claude-warning': '#CCA700',
      },
      fontFamily: {
        'serif': ['Georgia', 'Times New Roman', 'Times', 'serif'],
        'sans': ['Inter', 'SF Pro', '-apple-system', 'BlinkMacSystemFont', 'sans-serif'],
        'mono': ['JetBrains Mono', 'Fira Code', 'Consolas', 'Monaco', 'monospace'],
      },
      borderRadius: {
        'xl': '12px',
        '2xl': '16px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'blink': 'blink 1s step-end infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '50%': { opacity: '0' },
        },
      },
    },
  },
  plugins: [],
};
