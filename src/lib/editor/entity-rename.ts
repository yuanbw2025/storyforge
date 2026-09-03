import { db } from '../db/schema'
import type {
  Character,
  CodexCategory,
  CodexEntry,
  ImportantLocation,
  StateCategory,
} from '../types'
import { adopt } from '../registry/adopt'
import { transactionTablesFor } from '../registry/lifecycle'
import type { WorkspaceScope } from '../types/world-ownership'
import { resolveScope } from '../workspace/scope'
import {
  buildChapterSearchTargets,
  findChapterMatches,
  replaceChapterContent,
  type ChapterMatchPreview,
} from './find-replace'

export type RenamableEntityKind = 'character' | 'location' | 'codexEntry'

export interface RenamableEntity {
  kind: RenamableEntityKind
  id: number
  name: string
  label: string
  detail: string
}

export interface EntityRenameTarget {
  kind: RenamableEntityKind
  id: number
}

export interface EntityRenameRecordChange {
  target:
    | 'characters'
    | 'importantLocations'
    | 'codexEntries'
    | 'chapters'
    | 'stateCards'
    | 'temporalFacts'
    | 'knowledgeLedger'
    | 'cultivationProgress'
    | 'itemLedger'
  id: number
  before: Record<string, unknown>
  after: Record<string, unknown>
}

export interface EntityRenameManualReview {
  source: string
  label: string
  detail: string
}

export interface EntityRenamePreview {
  entity: RenamableEntity
  newName: string
  blockers: string[]
  warnings: string[]
  chapterMatches: ChapterMatchPreview[]
  chapterReplacementCount: number
  structuredCounts: Array<{ label: string; count: number }>
  manualReview: EntityRenameManualReview[]
  changes: EntityRenameRecordChange[]
  baseline: string
}

export interface EntityRenameUndoPatch {
  label: string
  snapshotId: number
  projectId: number
  entity: EntityRenameTarget
  oldName: string
  newName: string
  changes: EntityRenameRecordChange[]
}

export interface ExecuteEntityRenameArgs {
  projectId: number
  entity: EntityRenameTarget
  newName: string
  expectedBaseline: string
  createSnapshot: (projectId: number, label: string, type: 'auto' | 'manual') => Promise<number>
  label: string
}

export interface ExecuteEntityRenameResult {
  snapshotId: number
  changedRecords: number
  chapterReplacements: number
  undoPatch: EntityRenameUndoPatch
}

const ENTITY_KIND_LABELS: Record<RenamableEntityKind, string> = {
  character: '角色',
  location: '地点',
  codexEntry: '词条',
}

const TARGET_TABLE: Record<RenamableEntityKind, EntityRenameRecordChange['target']> = {
  character: 'characters',
  location: 'importantLocations',
  codexEntry: 'codexEntries',
}

function normalizedName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase()
}

function hasText(value: unknown, query: string): boolean {
  const normalizedQuery = normalizedName(query)
  if (!normalizedQuery) return false
  if (typeof value === 'string') return value.normalize('NFKC').toLocaleLowerCase().includes(normalizedQuery)
  if (Array.isArray(value)) return value.some(item => hasText(item, query))
  if (value && typeof value === 'object') return Object.values(value).some(item => hasText(item, query))
  return false
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function sortedChanges(changes: EntityRenameRecordChange[]): EntityRenameRecordChange[] {
  return [...changes].sort((left, right) =>
    left.target.localeCompare(right.target)
    || left.id - right.id
    || JSON.stringify(left.before).localeCompare(JSON.stringify(right.before)),
  )
}

function buildBaseline(input: {
  entity: RenamableEntity
  newName: string
  blockers: string[]
  changes: EntityRenameRecordChange[]
}): string {
  return JSON.stringify({
    entity: { kind: input.entity.kind, id: input.entity.id, name: input.entity.name },
    newName: input.newName,
    blockers: [...input.blockers].sort(),
    changes: sortedChanges(input.changes),
  })
}

async function projectEntities(projectId: number): Promise<{
  entities: RenamableEntity[]
  characters: Character[]
  categories: CodexCategory[]
  codexEntries: CodexEntry[]
  locations: ImportantLocation[]
}> {
  const [characters, locations, categories, codexEntries] = await Promise.all([
    db.characters.where('projectId').equals(projectId).toArray(),
    db.importantLocations.where('projectId').equals(projectId).toArray(),
    db.codexCategories.where('projectId').equals(projectId).toArray(),
    db.codexEntries.where('projectId').equals(projectId).toArray(),
  ])
  const categoryById = new Map(categories.map(category => [category.id, category]))
  const entities: RenamableEntity[] = [
    ...characters
      .filter(character => character.id != null)
      .map(character => ({
        kind: 'character' as const,
        id: character.id!,
        name: character.name,
        label: character.name,
        detail: `角色 · ${character.homeWorldGroupId == null ? '主世界/未分组' : `世界组 #${character.homeWorldGroupId}`}`,
      })),
    ...locations
      .filter(location => location.id != null)
      .map(location => ({
        kind: 'location' as const,
        id: location.id!,
        name: location.name,
        label: location.name,
        detail: '重要地点',
      })),
    ...codexEntries
      .filter(entry => entry.id != null)
      .map(entry => ({
        kind: 'codexEntry' as const,
        id: entry.id!,
        name: entry.name,
        label: entry.name,
        detail: `词条 · ${categoryById.get(entry.categoryId)?.name ?? `分类 #${entry.categoryId}`}`,
      })),
  ]
  return { entities, characters, categories, codexEntries, locations }
}

export async function listRenamableEntities(projectId: number): Promise<RenamableEntity[]> {
  const { entities } = await projectEntities(projectId)
  return entities.sort((left, right) =>
    left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name, 'zh-CN'),
  )
}

function targetEntity(
  entities: RenamableEntity[],
  target: EntityRenameTarget,
): RenamableEntity | undefined {
  return entities.find(entity => entity.kind === target.kind && entity.id === target.id)
}

function addChange(
  changes: EntityRenameRecordChange[],
  target: EntityRenameRecordChange['target'],
  id: number | undefined,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): void {
  if (id == null || sameValue(before, after)) return
  changes.push({ target, id, before, after })
}

function expectedStateCategory(
  entity: RenamableEntity,
  categories: CodexCategory[],
  codexEntries: CodexEntry[],
): StateCategory | null {
  if (entity.kind === 'character') return 'character'
  if (entity.kind === 'location') return 'location'
  const entry = codexEntries.find(item => item.id === entity.id)
  const category = categories.find(item => item.id === entry?.categoryId)
  return category?.builtInKey === 'faction' ? 'faction' : null
}

function structuredCounts(changes: EntityRenameRecordChange[]): Array<{ label: string; count: number }> {
  const labels: Partial<Record<EntityRenameRecordChange['target'], string>> = {
    characters: '角色主档',
    importantLocations: '地点主档',
    codexEntries: '词条主档',
    stateCards: '状态卡',
    temporalFacts: '时序事实显示名',
    knowledgeLedger: '角色认知账本',
    cultivationProgress: '修炼进度',
    itemLedger: '物品流水持有人',
  }
  return Object.entries(labels)
    .map(([target, label]) => ({
      label: label!,
      count: changes.filter(change => change.target === target).length,
    }))
    .filter(item => item.count > 0)
}

function pushManualReview(
  output: EntityRenameManualReview[],
  source: string,
  label: string,
  detail: string,
): void {
  if (output.some(item => item.source === source && item.label === label && item.detail === detail)) return
  output.push({ source, label, detail })
}

export async function buildEntityRenamePreview(
  projectId: number,
  target: EntityRenameTarget,
  requestedName: string,
): Promise<EntityRenamePreview> {
  const newName = requestedName.normalize('NFKC').trim()
  const { entities, characters, categories, codexEntries, locations } = await projectEntities(projectId)
  const entity = targetEntity(entities, target)
  if (!entity) throw new Error('目标实体不存在或不属于当前项目')

  const blockers: string[] = []
  const warnings: string[] = []
  const changes: EntityRenameRecordChange[] = []
  const manualReview: EntityRenameManualReview[] = []
  const oldKey = normalizedName(entity.name)
  const newKey = normalizedName(newName)

  if (!newName) blockers.push('新名称不能为空')
  if (newKey === oldKey) blockers.push('新名称与当前名称相同')

  const itemRows = await db.itemLedger.where('projectId').equals(projectId).toArray()
  const itemNames = Array.from(new Set(itemRows.map(row => row.itemName.trim()).filter(Boolean)))
  const oldEntityCollisions = entities.filter(item =>
    !(item.kind === entity.kind && item.id === entity.id)
    && normalizedName(item.name) === oldKey,
  )
  const newEntityCollisions = entities.filter(item =>
    !(item.kind === entity.kind && item.id === entity.id)
    && normalizedName(item.name) === newKey,
  )
  if (oldEntityCollisions.length || itemNames.some(name => normalizedName(name) === oldKey)) {
    blockers.push(`旧名称「${entity.name}」同时属于其他实体或物品，正文命中无法可靠判定归属`)
  }
  if (newName && (newEntityCollisions.length || itemNames.some(name => normalizedName(name) === newKey))) {
    blockers.push(`新名称「${newName}」已被其他实体或物品使用`)
  }

  addChange(changes, TARGET_TABLE[entity.kind], entity.id, { name: entity.name }, { name: newName })

  const [
    chapters,
    outlineNodes,
    stateCards,
    temporalFacts,
    knowledgeRows,
    cultivationRows,
    storyCores,
    detailedOutlines,
  ] = await Promise.all([
    db.chapters.where('projectId').equals(projectId).toArray(),
    db.outlineNodes.where('projectId').equals(projectId).toArray(),
    db.stateCards.where('projectId').equals(projectId).toArray(),
    db.temporalFacts.where('projectId').equals(projectId).toArray(),
    db.knowledgeLedger.where('projectId').equals(projectId).toArray(),
    db.cultivationProgress.where('projectId').equals(projectId).toArray(),
    db.storyCores.where('projectId').equals(projectId).toArray(),
    db.detailedOutlines.where('projectId').equals(projectId).toArray(),
  ])

  const protectedTerms = Array.from(new Set([
    ...entities.map(item => item.name.trim()),
    ...itemNames,
  ].filter(Boolean)))
  const searchOptions = {
    query: entity.name,
    replacement: newName,
    wholeWord: true,
    protectedTerms,
  }
  const chapterTargets = buildChapterSearchTargets(chapters, outlineNodes)
  const chapterMatches = chapterTargets
    .map(chapter => findChapterMatches(chapter, searchOptions))
    .filter((match): match is ChapterMatchPreview => !!match)
  for (const chapterTarget of chapterTargets) {
    const replacement = replaceChapterContent(chapterTarget.content, searchOptions)
    if (!replacement.count) continue
    const chapter = chapters.find(item => item.id === chapterTarget.id)
    if (!chapter) continue
    addChange(
      changes,
      'chapters',
      chapter.id,
      { content: chapter.content || '', wordCount: chapter.wordCount || 0 },
      { content: replacement.html, wordCount: replacement.wordCount },
    )
  }

  const canonicalChapterIds = new Set(chapterTargets.map(chapter => chapter.id))
  for (const chapter of chapters) {
    if (chapter.id != null && !canonicalChapterIds.has(chapter.id) && hasText(chapter.content, entity.name)) {
      pushManualReview(manualReview, '章节正文', chapter.title || `章节 #${chapter.id}`, '非规范/重复章节未自动修改')
    }
  }

  const stateCategory = expectedStateCategory(entity, categories, codexEntries)
  if (stateCategory) {
    if (stateCards.some(card =>
      card.category === stateCategory
      && normalizedName(card.entityName) === newKey
      && normalizedName(card.entityName) !== oldKey,
    )) {
      blockers.push(`新名称「${newName}」已有同类型状态卡，无法证明两张卡应当合并`)
    }
    for (const card of stateCards.filter(card =>
      card.category === stateCategory && normalizedName(card.entityName) === oldKey,
    )) {
      addChange(changes, 'stateCards', card.id, { entityName: card.entityName }, { entityName: newName })
    }
  } else if (stateCards.some(card => normalizedName(card.entityName) === oldKey)) {
    warnings.push('该词条没有可证明的状态卡类型映射，同名状态卡仅列入人工复核')
  }

  if (entity.kind === 'character') {
    for (const fact of temporalFacts.filter(row => row.characterId === entity.id)) {
      addChange(changes, 'temporalFacts', fact.id, { subjectName: fact.subjectName }, { subjectName: newName })
    }
    for (const row of knowledgeRows.filter(item => item.characterId === entity.id)) {
      addChange(changes, 'knowledgeLedger', row.id, { characterName: row.characterName }, { characterName: newName })
    }
    for (const row of cultivationRows.filter(item => item.characterId === entity.id)) {
      addChange(changes, 'cultivationProgress', row.id, { characterName: row.characterName }, { characterName: newName })
    }
    for (const row of itemRows.filter(item => item.characterId === entity.id)) {
      addChange(changes, 'itemLedger', row.id, { heldByName: row.heldByName }, { heldByName: newName })
    }
  } else if (entity.kind === 'location') {
    for (const fact of temporalFacts.filter(row => row.locationId === entity.id)) {
      addChange(changes, 'temporalFacts', fact.id, { subjectName: fact.subjectName }, { subjectName: newName })
    }
  } else {
    for (const fact of temporalFacts.filter(row => row.codexEntryId === entity.id)) {
      addChange(changes, 'temporalFacts', fact.id, { subjectName: fact.subjectName }, { subjectName: newName })
    }
  }

  for (const node of outlineNodes) {
    if (hasText(node.title, entity.name) || hasText(node.summary, entity.name)) {
      pushManualReview(manualReview, '大纲', node.title || `大纲节点 #${node.id}`, '标题或摘要含旧名称')
    }
  }
  for (const row of detailedOutlines) {
    if (hasText(row, entity.name)) {
      pushManualReview(manualReview, '详细大纲', `大纲节点 #${row.outlineNodeId}`, '自由文本或场景内容含旧名称')
    }
  }
  for (const row of storyCores) {
    if (hasText(row, entity.name)) {
      pushManualReview(manualReview, '故事核心', `记录 #${row.id}`, '主线、概念或其他自由文本含旧名称')
    }
  }
  for (const fact of temporalFacts) {
    if (hasText(fact.value, entity.name) || hasText(fact.sourceQuote, entity.name)) {
      pushManualReview(manualReview, '事实账本', `事实 #${fact.id}`, '事实值或证据引文含旧名称')
    }
  }
  for (const card of stateCards) {
    if (hasText(card.fields, entity.name)) {
      pushManualReview(manualReview, '状态卡内容', `${card.entityName} · ${card.category}`, '状态字段值含旧名称')
    }
  }
  const descriptiveEntities = [
    ...characters.map(row => ({ kind: 'character' as const, row })),
    ...locations.map(row => ({ kind: 'location' as const, row })),
    ...codexEntries.map(row => ({ kind: 'codexEntry' as const, row })),
  ]
  for (const item of descriptiveEntities) {
    if (item.kind === entity.kind && item.row.id === entity.id) continue
    if (hasText(item.row, entity.name)) {
      pushManualReview(
        manualReview,
        `${ENTITY_KIND_LABELS[item.kind]}档案`,
        item.row.name,
        '描述性字段含旧名称',
      )
    }
  }

  if (manualReview.length) {
    warnings.push(`另有 ${manualReview.length} 条自由文本或非规范记录需人工复核，未自动改写`)
  }
  warnings.push('角色设计方案等历史快照继续保留当时名称，不随本次改名重写')

  const sorted = sortedChanges(changes)
  const preview: EntityRenamePreview = {
    entity,
    newName,
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    chapterMatches,
    chapterReplacementCount: chapterMatches.reduce((sum, match) => sum + match.count, 0),
    structuredCounts: structuredCounts(sorted),
    manualReview,
    changes: sorted,
    baseline: '',
  }
  preview.baseline = buildBaseline(preview)
  return preview
}

async function getRecord(
  target: EntityRenameRecordChange['target'],
  id: number,
): Promise<Record<string, unknown> | undefined> {
  return await db[target].get(id) as Record<string, unknown> | undefined
}

async function assertRecordState(change: EntityRenameRecordChange, side: 'before' | 'after'): Promise<void> {
  const current = await getRecord(change.target, change.id)
  if (!current) throw new Error(`记录已不存在：${change.target} #${change.id}`)
  const expected = change[side]
  for (const [field, value] of Object.entries(expected)) {
    if (!sameValue(current[field], value)) {
      throw new Error(`记录已被修改：${change.target} #${change.id}.${field}，请重新预览`)
    }
  }
}

async function applyChange(
  projectId: number,
  scope: WorkspaceScope,
  change: EntityRenameRecordChange,
  side: 'before' | 'after',
): Promise<void> {
  const data = change[side]
  if (change.target === 'temporalFacts') {
    await db.temporalFacts.update(change.id, { ...data, updatedAt: Date.now() })
    return
  }
  const result = await adopt({
    projectId,
    scope,
    target: change.target,
    recordId: change.id,
    mode: 'replace',
    data,
  })
  if (result.written.length !== 1 || result.skipped.length || result.typeErrors.length || result.fkErrors.length) {
    throw new Error(`注册表拒绝更新 ${change.target} #${change.id}`)
  }
}

export async function executeEntityRename(
  args: ExecuteEntityRenameArgs,
): Promise<ExecuteEntityRenameResult> {
  const workspaceScope = await resolveScope({ projectId: args.projectId })
  const preview = await buildEntityRenamePreview(args.projectId, args.entity, args.newName)
  if (preview.baseline !== args.expectedBaseline) throw new Error('项目数据已变化，请重新预览后再执行')
  if (preview.blockers.length) throw new Error(preview.blockers.join('；'))

  const snapshotId = await args.createSnapshot(args.projectId, args.label, 'manual')
  await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const current = await buildEntityRenamePreview(args.projectId, args.entity, args.newName)
    if (current.baseline !== args.expectedBaseline || current.blockers.length) {
      throw new Error('创建快照后项目数据发生变化，已取消改名，请重新预览')
    }
    for (const change of current.changes) await assertRecordState(change, 'before')
    for (const change of current.changes) await applyChange(args.projectId, workspaceScope, change, 'after')
  })

  return {
    snapshotId,
    changedRecords: preview.changes.length,
    chapterReplacements: preview.chapterReplacementCount,
    undoPatch: {
      label: `${args.label} · 快照 #${snapshotId}`,
      snapshotId,
      projectId: args.projectId,
      entity: args.entity,
      oldName: preview.entity.name,
      newName: preview.newName,
      changes: preview.changes,
    },
  }
}

export async function undoEntityRename(patch: EntityRenameUndoPatch): Promise<number> {
  const workspaceScope = await resolveScope({ projectId: patch.projectId })
  await db.transaction('rw', transactionTablesFor('importProject'), async () => {
    const reversePreview = await buildEntityRenamePreview(
      patch.projectId,
      patch.entity,
      patch.oldName,
    )
    if (reversePreview.blockers.length) {
      throw new Error(`${reversePreview.blockers.join('；')}，请改用项目快照恢复`)
    }
    const changeShape = (change: EntityRenameRecordChange) => JSON.stringify({
      target: change.target,
      id: change.id,
      fields: Array.from(new Set([
        ...Object.keys(change.before),
        ...Object.keys(change.after),
      ])).sort(),
    })
    const expectedShapes = patch.changes.map(changeShape).sort()
    const currentShapes = reversePreview.changes.map(changeShape).sort()
    if (!sameValue(expectedShapes, currentShapes)) {
      throw new Error('改名后新增了相关正文或结构化记录，请改用项目快照恢复')
    }
    for (const change of patch.changes) await assertRecordState(change, 'after')
    for (const change of [...patch.changes].reverse()) {
      await applyChange(patch.projectId, workspaceScope, change, 'before')
    }
  })
  return patch.changes.length
}
