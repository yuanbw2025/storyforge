/** Admission for new Creator work; frozen briefs retain their own wire parser. */
export const TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_V1 = { minimum: 2, maximum: 12 } as const

export const TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_ERROR_V1 =
  `文字开放世界制作需要 ${TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_V1.minimum} 至 ${TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_V1.maximum} 个合规结局。如已有未发布 Build，请先停止原制作，再确认修订后的 Brief 并授权新 Build。`

export function isTextOpenWorldCreatorEndingCountV1(count: unknown): boolean {
  const { minimum, maximum } = TEXT_OPEN_WORLD_CREATOR_ENDING_COUNT_V1
  return typeof count === 'number' && Number.isInteger(count) && count >= minimum && count <= maximum
}
