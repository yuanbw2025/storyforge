import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── 字体（新增 serif / mono）─────────────────────────
      fontFamily: {
        sans:  ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono:  ['var(--font-mono)'],
      },

      // ── 颜色（完全兼容现有 + 扩展）──────────────────────
      colors: {
        bg: {
          base:    'var(--bg-base)',
          surface: 'var(--bg-surface)',
          elevated:'var(--bg-elevated)',
          hover:   'var(--bg-hover)',
        },
        text: {
          primary:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          hover:   'var(--accent-hover)',
          muted:   'var(--accent-muted)',
          soft:    'var(--accent-soft)',
        },
        border: {
          DEFAULT: 'var(--border)',
          hover:   'var(--border-hover)',
          subtle:  'var(--border-subtle)',
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        error:   'var(--error)',
        info:    'var(--info)',
      },

      // ── 阴影（按 theme 自动调）────────────────────────────
      boxShadow: {
        'theme-sm': 'var(--shadow-sm)',
        'theme-md': 'var(--shadow-md)',
        'theme-lg': 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
} satisfies Config
