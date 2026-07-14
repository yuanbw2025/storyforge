import { Extension } from '@tiptap/core'

export type PendingTextStyle = {
  backgroundColor?: string
  color?: string
  fontFamily?: string
  fontSize?: string
}

const BLOCK_SPACING_NODE_TYPES = new Set(['paragraph', 'heading'])

const LEGACY_THEME_COLOR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/(#f5e6d3|rgb\(\s*245\s*,\s*230\s*,\s*211\s*\))/gi, 'var(--editor-ink-cream)'],
  [/(#ffffff|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))/gi, 'var(--editor-ink-strong)'],
  [/(#d6b98c|rgb\(\s*214\s*,\s*185\s*,\s*140\s*\))/gi, 'var(--editor-ink-muted)'],
  [/(#d97757|rgb\(\s*217\s*,\s*119\s*,\s*87\s*\))/gi, 'var(--editor-ink-orange)'],
  [/(#60a5fa|rgb\(\s*96\s*,\s*165\s*,\s*250\s*\))/gi, 'var(--editor-ink-blue)'],
  [/(#4ade80|rgb\(\s*74\s*,\s*222\s*,\s*128\s*\))/gi, 'var(--editor-ink-green)'],
  [/(#ef4444|rgb\(\s*239\s*,\s*68\s*,\s*68\s*\))/gi, 'var(--editor-ink-red)'],
  [/(#3a2418|rgb\(\s*58\s*,\s*36\s*,\s*24\s*\))/gi, 'var(--editor-mark-ink)'],
  [/(#4a3326|rgb\(\s*74\s*,\s*51\s*,\s*38\s*\))/gi, 'var(--editor-mark-brown)'],
  [/(#5c3b2d|rgb\(\s*92\s*,\s*59\s*,\s*45\s*\))/gi, 'var(--editor-mark-red)'],
  [/(#1f2937|rgb\(\s*31\s*,\s*41\s*,\s*55\s*\))/gi, 'var(--editor-mark-blue)'],
  [/(#3f2f08|rgb\(\s*63\s*,\s*47\s*,\s*8\s*\))/gi, 'var(--editor-mark-yellow)'],
  [/(#14532d|rgb\(\s*20\s*,\s*83\s*,\s*45\s*\))/gi, 'var(--editor-mark-green)'],
]

export function normalizeThemeAdaptiveColorHtml(html: string): string {
  return LEGACY_THEME_COLOR_REPLACEMENTS.reduce(
    (next, [pattern, replacement]) => next.replace(pattern, replacement),
    html,
  )
}

function rgbToHex(color: string): string | null {
  const match = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!match) return null

  return `#${[match[1], match[2], match[3]]
    .map(part => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, '0'))
    .join('')}`
}

export function resolveColorForInput(color: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color
  const rgb = rgbToHex(color)
  if (rgb) return rgb

  const varName = color.match(/var\((--[^),\s]+)/)?.[1]
  if (varName && typeof window !== 'undefined') {
    const resolved = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
    if (/^#[0-9a-f]{6}$/i.test(resolved)) return resolved
    const resolvedRgb = rgbToHex(resolved)
    if (resolvedRgb) return resolvedRgb
  }

  return fallback
}

export const BlockSpacing = Extension.create({
  name: 'blockSpacing',

  addGlobalAttributes() {
    return [
      {
        types: Array.from(BLOCK_SPACING_NODE_TYPES),
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: element => element.style.lineHeight || null,
            renderHTML: attributes => {
              if (!attributes.lineHeight) return {}
              return { style: `line-height: ${attributes.lineHeight}` }
            },
          },
          paragraphSpacing: {
            default: null,
            parseHTML: element => element.style.marginBottom || null,
            renderHTML: attributes => {
              if (!attributes.paragraphSpacing) return {}
              return { style: `margin-bottom: ${attributes.paragraphSpacing}` }
            },
          },
        },
      },
    ]
  },
})
