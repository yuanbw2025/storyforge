import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // ── 字体（新增 serif / mono）─────────────────────────
      fontFamily: {
        sans: ['var(--font-sans)'],
        serif: ['var(--font-serif)'],
        mono: ['var(--font-mono)'],
      },

      // ── 颜色（兼容现有 + 扩展）──────────────────────────
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
          soft: 'var(--accent-soft)',     // 新增
        },
        border: {
          DEFAULT: 'var(--border)',
          hover: 'var(--border-hover)',
          subtle: 'var(--border-subtle)', // 新增
        },
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',

        // 品牌色（直接用，不走 theme 切换）
        brand: {
          flame: '#D97757',
          'flame-deep': '#B85C3F',
          gold: '#C8A155',
          ember: '#8B3E1F',
        },
      },

      // ── 阴影（走 CSS 变量，按 theme 自动调）───────────────
      boxShadow: {
        'theme-sm': 'var(--shadow-sm)',
        'theme-md': 'var(--shadow-md)',
        'theme-lg': 'var(--shadow-lg)',
      },

      // ── 字号阶梯（与 tokens.css 同步）─────────────────────
      fontSize: {
        'xs-sf':  ['11px', { lineHeight: '1.45' }],
        'sm-sf':  ['12px', { lineHeight: '1.45' }],
        'base-sf': ['14px', { lineHeight: '1.6' }],
        'lg-sf':  ['17px', { lineHeight: '1.6' }],
        'xl-sf':  ['20px', { lineHeight: '1.3' }],
        '2xl-sf': ['24px', { lineHeight: '1.3' }],
        '3xl-sf': ['32px', { lineHeight: '1.2' }],
        '4xl-sf': ['44px', { lineHeight: '1.1' }],
        '5xl-sf': ['64px', { lineHeight: '1.05' }],
      },

      // ── 行高（中文正文特殊需求）────────────────────────────
      lineHeight: {
        'prose-zh': '2.1',
      },
    },
  },
  plugins: [],
} satisfies Config
