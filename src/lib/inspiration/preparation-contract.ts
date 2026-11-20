export const INSPIRATION_PREPARATION_MODES = ['organize', 'compare', 'deepen', 'position-open', 'position-defined'] as const
export type InspirationPreparationMode = typeof INSPIRATION_PREPARATION_MODES[number]
export const INSPIRATION_PREPARATION_LABELS: Record<InspirationPreparationMode, string> = {
  organize: '轻量整理', compare: '方向比较', deepen: '局部深化',
  'position-open': '创作定位·方向未定', 'position-defined': '创作定位·方向明确',
}
export const INSPIRATION_PREPARATION_MODULES = {
  organize: 'inspiration.prepare.organize', compare: 'inspiration.prepare.compare', deepen: 'inspiration.prepare.deepen',
  'position-open': 'inspiration.prepare.position-open', 'position-defined': 'inspiration.prepare.position-defined',
} as const satisfies Record<InspirationPreparationMode, string>
export type InspirationPreparationPromptModuleKey = typeof INSPIRATION_PREPARATION_MODULES[InspirationPreparationMode]
