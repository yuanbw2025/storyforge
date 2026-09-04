export type CharacterDrivenPlanStatus = 'draft' | 'generated' | 'adopted'

/** 方案中的角色快照。characterId 是软引用；角色删除后仍保留其余字段。 */
export interface CharacterDrivenPlanArc {
  characterId: number | null
  name: string
  role: string
  initialState: string
  targetState: string
}

export interface CharacterDrivenPlotChapter {
  title: string
  summary: string
  keyCharacters: string[]
  arcProgress: string
}

export interface CharacterDrivenPlotVolume {
  volumeTitle: string
  volumeSummary: string
  characterArcs: string
  chapters: CharacterDrivenPlotChapter[]
}

export interface CharacterDrivenPlan {
  id?: number
  projectId: number
  name: string
  /** CharacterDrivenPlanArc[] JSON。 */
  arcs: string
  userHint: string
  /** CharacterDrivenPlotVolume[] JSON。 */
  generatedVolumes: string
  status: CharacterDrivenPlanStatus
  version: number
  /** 复制为新版本时指向来源方案；删除来源后置空。 */
  parentPlanId: number | null
  createdAt: number
  updatedAt: number
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null
}

function parseCurrentArray(value: unknown, label: string): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') throw new Error(`${label} 必须是当前 JSON 数组。`)
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) throw new Error(`${label} 必须是当前 JSON 数组。`)
    return parsed
  } catch {
    throw new Error(`${label} 不是有效的当前 JSON 数组。`)
  }
}

function assertExactKeys(
  row: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys)
  const missing = keys.filter(key => !Object.prototype.hasOwnProperty.call(row, key))
  const unknown = Object.keys(row).filter(key => !expected.has(key))
  if (missing.length) throw new Error(`${label} 缺少当前字段：${missing.join('、')}。`)
  if (unknown.length) throw new Error(`${label} 包含非当前字段：${unknown.join('、')}。`)
}

function requireString(value: unknown, label: string, options: { nonEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') throw new Error(`${label} 必须是字符串。`)
  if (options.nonEmpty && !value.trim()) throw new Error(`${label} 不能为空。`)
  return value
}

export function parseCharacterDrivenPlanArcs(value: unknown): CharacterDrivenPlanArc[] {
  return parseCurrentArray(value, '角色驱动方案 arcs').map((item, index) => {
    const row = asRecord(item)
    const label = `角色驱动方案 arcs[${index}]`
    if (!row) throw new Error(`${label} 必须是对象。`)
    assertExactKeys(row, ['characterId', 'name', 'role', 'initialState', 'targetState'], label)
    if (row.characterId !== null && (!Number.isInteger(row.characterId) || Number(row.characterId) <= 0)) {
      throw new Error(`${label}.characterId 必须是正整数或 null。`)
    }
    return {
      characterId: row.characterId as number | null,
      name: requireString(row.name, `${label}.name`, { nonEmpty: true }),
      role: requireString(row.role, `${label}.role`),
      initialState: requireString(row.initialState, `${label}.initialState`),
      targetState: requireString(row.targetState, `${label}.targetState`),
    }
  })
}

export function stringifyCharacterDrivenPlanArcs(arcs: CharacterDrivenPlanArc[]): string {
  return JSON.stringify(arcs)
}

export function parseCharacterDrivenPlotVolumes(value: unknown): CharacterDrivenPlotVolume[] {
  return parseCurrentArray(value, '角色驱动方案 generatedVolumes').map((item, volumeIndex) => {
    const row = asRecord(item)
    const label = `角色驱动方案 generatedVolumes[${volumeIndex}]`
    if (!row) throw new Error(`${label} 必须是对象。`)
    assertExactKeys(row, ['volumeTitle', 'volumeSummary', 'characterArcs', 'chapters'], label)
    if (!Array.isArray(row.chapters)) throw new Error(`${label}.chapters 必须是数组。`)
    const chapters = row.chapters.map((chapter, chapterIndex) => {
      const ch = asRecord(chapter)
      const chapterLabel = `${label}.chapters[${chapterIndex}]`
      if (!ch) throw new Error(`${chapterLabel} 必须是对象。`)
      assertExactKeys(ch, ['title', 'summary', 'keyCharacters', 'arcProgress'], chapterLabel)
      if (!Array.isArray(ch.keyCharacters)) throw new Error(`${chapterLabel}.keyCharacters 必须是数组。`)
      return {
        title: requireString(ch.title, `${chapterLabel}.title`, { nonEmpty: true }),
        summary: requireString(ch.summary, `${chapterLabel}.summary`),
        keyCharacters: ch.keyCharacters.map((name, index) => (
          requireString(name, `${chapterLabel}.keyCharacters[${index}]`, { nonEmpty: true })
        )),
        arcProgress: requireString(ch.arcProgress, `${chapterLabel}.arcProgress`),
      }
    })
    return {
      volumeTitle: requireString(row.volumeTitle, `${label}.volumeTitle`, { nonEmpty: true }),
      volumeSummary: requireString(row.volumeSummary, `${label}.volumeSummary`),
      characterArcs: requireString(row.characterArcs, `${label}.characterArcs`),
      chapters,
    }
  })
}

export function stringifyCharacterDrivenPlotVolumes(volumes: CharacterDrivenPlotVolume[]): string {
  return JSON.stringify(volumes)
}
