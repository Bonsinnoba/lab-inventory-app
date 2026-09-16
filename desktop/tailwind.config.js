/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        'surface-raised': 'var(--color-surface-raised)',
        border: 'var(--color-border)',
        'text-primary': 'var(--color-text-primary)',
        'text-secondary': 'var(--color-text-secondary)',
        accent: 'var(--color-accent)',
        'accent-dim': 'var(--color-accent-dim)',
        'status-ok': 'var(--color-status-ok)',
        'status-warn': 'var(--color-status-warn)',
        'status-warning': 'var(--color-status-warn)',
        'status-danger': 'var(--color-status-danger)',
        'status-neutral': 'var(--color-status-neutral)',
      },
      fontFamily: {
        ui: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'Monaco', 'monospace'],
      },
      fontSize: {
        caption: '12px',
        body: '14px',
        ui: '16px',
        'section-header': '20px',
        'page-title': '28px',
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
      },
    },
  },
  plugins: [],
}
