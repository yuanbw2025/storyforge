import type { AtlasSymbolStyle } from './symbols'

export type AtlasViewStyle = 'sketch' | 'illustrated' | 'painted'

/** Retain old bookmarks/preferences without presenting sprite sets as distinct art styles. */
export function resolveAtlasStyle(value: string | null, symbols: string | null = null): {
  style: AtlasViewStyle; symbols: AtlasSymbolStyle
} {
  return {
    style: value === 'painted' ? 'painted'
      : ['illustrated', 'watercolor', 'ink'].includes(value ?? '') ? 'illustrated' : 'sketch',
    symbols: value === 'watercolor' ? 'watercolor' : value === 'ink' || symbols === 'ink' ? 'ink' : 'watercolor',
  }
}
