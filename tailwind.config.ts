import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base: 'var(--bg-base)',
          surface: 'var(--bg-surface)',
          elevated: 'var(--bg-elevated)',
          hover: 'var(--bg-hover)',
        },
        text: {
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover: 'var(--accent-hover)',
          muted: 'var(--accent-muted)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hover: 'var(--border-hover)',
        },
        // 新 token（设计系统语义名）
        'bg-active': 'var(--bg-active)',
        'text-inverse': 'var(--text-inverse)',
        'border-subtle': 'var(--border-subtle)',
        'border-strong': 'var(--border-strong)',
        brand: {
          flame: 'var(--brand-flame)',
          gold:  'var(--brand-gold)',
          ember: 'var(--brand-ember)',
        },
        // 语义色
        success: 'var(--color-success)',
        warning: 'var(--color-warning)',
        error:   'var(--color-error)',
        info:    'var(--color-info)',
      },
    },
  },
  plugins: [],
} satisfies Config
