export interface AvgReaderPreferencesV1 {
  muted: boolean; reducedMotion: boolean; images: boolean; auto: boolean; fast: boolean; textSpeed: number; volume: number
  bgmVolume: number; ambienceVolume: number; sfxVolume: number; voiceVolume: number; autoDelayMs: number | null
}
const KEY = 'storyforge.avg.reader-preferences.v1'
const DEFAULTS: AvgReaderPreferencesV1 = { muted: false, reducedMotion: false, images: true, auto: false, fast: false, textSpeed: 35, volume: .8,
  bgmVolume: 1, ambienceVolume: 1, sfxVolume: 1, voiceVolume: 1, autoDelayMs: null }
/** Browser reader preferences own neither Work nor runtime facts. Automatic
 * playback/fast-forward never restart merely because the page was reopened. */
export function loadAvgReaderPreferencesV1(): AvgReaderPreferencesV1 {
  const result = { ...DEFAULTS, reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches }
  try {
    const r = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null
    if (!r || r.version !== 1) return result
    for (const key of ['muted','reducedMotion','images'] as const) if (typeof r[key] === 'boolean') result[key] = r[key]
    for (const key of ['volume','bgmVolume','ambienceVolume','sfxVolume','voiceVolume','textSpeed','autoDelayMs'] as const) {
      const value = r[key], max = key === 'textSpeed' ? 200 : key === 'autoDelayMs' ? 5000 : 1
      if (typeof value === 'number' && Number.isFinite(value) && value >= (key === 'textSpeed' ? 1 : 0) && value <= max) result[key] = value
    }
  } catch { /* A corrupt/unavailable preference store cannot block a save. */ }
  return result
}
export function saveAvgReaderPreferencesV1(preferences: AvgReaderPreferencesV1): void {
  const { auto: _auto, fast: _fast, ...persistent } = preferences
  try { localStorage.setItem(KEY, JSON.stringify({ version: 1, ...persistent })) } catch { /* Runtime data is stored independently in IndexedDB. */ }
}
