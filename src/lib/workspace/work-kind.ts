import type { NovelWorkflowProfile, Work, WorkKind } from '../types/world-ownership'

export const SHORT_NOVEL_MIN_WORDS = 5_000
export const SHORT_NOVEL_MAX_WORDS = 25_000
export const SHORT_NOVEL_DEFAULT_WORDS = 10_000

export function effectiveWorkKind(work: Pick<Work, 'kind'>): WorkKind {
  return work.kind ?? 'novel'
}

export function effectiveNovelProfile(
  work: Pick<Work, 'kind' | 'novelProfile'>,
): NovelWorkflowProfile | null {
  return effectiveWorkKind(work) === 'novel' ? (work.novelProfile ?? 'long') : null
}

export function assertShortNovelTargetWords(targetWordCount: number): void {
  if (
    !Number.isInteger(targetWordCount)
    || targetWordCount < SHORT_NOVEL_MIN_WORDS
    || targetWordCount > SHORT_NOVEL_MAX_WORDS
  ) {
    throw new Error(`短篇目标字数必须是 ${SHORT_NOVEL_MIN_WORDS.toLocaleString()}～${SHORT_NOVEL_MAX_WORDS.toLocaleString()} 的整数`)
  }
}

export function normalizeNewWorkClassification(input: {
  kind?: WorkKind
  novelProfile?: NovelWorkflowProfile | null
  targetWordCount: number
}): { kind: WorkKind; novelProfile: NovelWorkflowProfile | null } {
  const kind = input.kind ?? 'novel'
  if (kind !== 'novel') {
    if (input.novelProfile != null) throw new Error('剧本或漫画 Work 不能携带小说 Profile')
    return { kind, novelProfile: null }
  }
  const novelProfile = input.novelProfile ?? 'long'
  if (novelProfile === 'short') assertShortNovelTargetWords(input.targetWordCount)
  return { kind, novelProfile }
}

export function assertStoredWorkClassification(
  work: Pick<Work, 'kind' | 'novelProfile'> & Partial<Pick<Work, 'targetWordCount'>>,
): void {
  if (work.kind != null && !(['novel', 'screenplay', 'comic'] as const).includes(work.kind)) {
    throw new Error(`未知 Work kind：${String(work.kind)}`)
  }
  if (work.novelProfile != null && !(['short', 'long'] as const).includes(work.novelProfile)) {
    throw new Error(`未知小说 Profile：${String(work.novelProfile)}`)
  }
  const kind = effectiveWorkKind(work)
  const profile = effectiveNovelProfile(work)
  if (kind === 'novel' && profile == null) throw new Error('小说 Work 必须解析出 short 或 long Profile')
  if (kind !== 'novel' && work.novelProfile != null) throw new Error('剧本或漫画 Work 不能携带小说 Profile')
  if (kind === 'novel' && profile === 'short') assertShortNovelTargetWords(work.targetWordCount ?? Number.NaN)
}

export function deriveShortNovelStructure(
  targetWordCount: number,
  preferredChapterCount?: number,
): { volumeCount: 1; chapterCount: number; targetWordsPerChapter: number } {
  assertShortNovelTargetWords(targetWordCount)
  if (preferredChapterCount != null && (!Number.isInteger(preferredChapterCount) || preferredChapterCount <= 0)) {
    throw new Error('短篇建议章数必须是正整数')
  }
  const chapterCount = preferredChapterCount ?? (
    targetWordCount < 8_000 ? 2
      : targetWordCount < 13_000 ? 3
        : targetWordCount < 18_000 ? 4
          : targetWordCount < 22_000 ? 5
            : 6
  )
  return {
    volumeCount: 1,
    chapterCount,
    targetWordsPerChapter: Math.ceil(targetWordCount / chapterCount),
  }
}
