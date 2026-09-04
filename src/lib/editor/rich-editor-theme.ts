import { Extension } from '@tiptap/core'

export type PendingTextStyle = {
  backgroundColor?: string
  color?: string
  fontFamily?: string
  fontSize?: string
}

const BLOCK_SPACING_NODE_TYPES = new Set(['paragraph', 'heading'])

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
