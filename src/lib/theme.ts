export const DEFAULT_THEME = 'warm'

export const THEME_OPTIONS = [
  { value: 'warm', label: '暖白编辑室', emoji: '☕', desc: '长时间写作 · 层级清楚 · 默认推荐', swatches: ['#F4EFE7', '#965A3A', '#2B2620'] },
  { value: 'jade', label: '墨玉青', emoji: '墨', desc: '深色沉浸 · 暗绿书房 · 白纸正文', swatches: ['#101A17', '#65BFA8', '#F7F1E5'] },
  { value: 'slate', label: '冷灰银蓝', emoji: '◈', desc: '生产力管理 · 冷静清晰 · 适合设定库', swatches: ['#EEF2F6', '#3F6F96', '#172033'] },
  { value: 'forge', label: '熔炉', emoji: '🔥', desc: '暗夜琥珀 · 火光余烬', swatches: ['#1A0F0A', '#D97757', '#C8A155'] },
  { value: 'scroll', label: '古卷', emoji: '📜', desc: '旧纸染黄 · 铁胆墨香', swatches: ['#E5D5A8', '#7B3A1A', '#8B5E1A'] },
  { value: 'paper', label: '纸与墨', emoji: '🖊', desc: '素纸如雪 · 墨迹清朗', swatches: ['#FAF7F0', '#A04E35', '#8A7E6A'] },
] as const

export type StoryForgeTheme = typeof THEME_OPTIONS[number]['value']

const THEME_VALUES = new Set<string>(THEME_OPTIONS.map(theme => theme.value))

const THEME_MIGRATE: Record<string, StoryForgeTheme> = {
  work: 'forge',
  midnight: 'forge',
  ocean: 'forge',
  graphite: 'forge',
  mist: 'paper',
  parchment: 'paper',
}

export function resolveStoryForgeTheme(savedTheme: string | null): StoryForgeTheme {
  if (!savedTheme) return DEFAULT_THEME
  const migrated = THEME_MIGRATE[savedTheme]
  if (migrated) return migrated
  if (THEME_VALUES.has(savedTheme)) return savedTheme as StoryForgeTheme
  return DEFAULT_THEME
}

export function applyStoryForgeTheme(theme: StoryForgeTheme) {
  localStorage.setItem('storyforge-theme', theme)
  document.documentElement.setAttribute('data-theme', theme)
  window.dispatchEvent(new Event('themechange'))
}
