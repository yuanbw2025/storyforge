import { marked } from 'marked'
import TurndownService from 'turndown'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { db } from '../db/schema'
import { hashCanonicalValue } from '../agent/run/hash'
import { sha256Text } from '../ai/chapter-memory/text-normalization'
import { PROJECT_TABLES } from '../registry/project-tables'
import { adopt, hashAdoptRecordFieldsV1 } from '../registry/adopt'
import type { WorkspaceProjectionSpecV1 } from '../registry/types'
import { countWords, htmlToPlainText } from '../utils/html'
import { exportProjectJSON, importProjectJSON, type ProjectExportData } from '../export/json-export'
import { assertTrustedProjectBackup } from '../export/backup-trust'
import { cascadeDeleteProject } from '../registry/lifecycle'
import { cascadeDeleteChapterRecords } from '../chapters/lifecycle'
import { propagateChapterEditStale } from '../consistency/impact-analysis'
import { buildWorkspaceImpactPlanV1 } from './workspace-impact'
import { buildMemoryArtifactIndexV1 } from './settlement'
import type {
  Chapter,
  CreativeRules,
  Project,
  StoryCore,
  Work,
  WorkspaceDocumentBindingV1,
  WorkspaceDocumentChangeKindV1,
  WorkspaceDocumentIdentityV1,
  WorkspaceFileAdoptionCandidateV1,
  WorkspaceFileCandidateSetV1,
  WorkspaceManifestV1,
  WorkspacePackageV1,
  WorkspaceSelfCheckActionV1,
  WorkspaceSelfCheckItemV1,
  WorkspaceSelfCheckPlanV1,
  WorkspaceSelfCheckReportV1,
  WorkspaceSyncReceiptV1,
  World,
} from '../types'
import type { WorkspaceScope } from '../types/world-ownership'
import { ensureWorkspaceOwnership } from '../world-engine/ownership'
import {
  generateDocumentId,
  generateWorkspaceUid,
  generateWorkCode,
  isWorkspaceUid,
  isWorkspaceDocumentId,
  isWorkCode,
} from './identity'

const turndown = new TurndownService({
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
})

export const WORKSPACE_FILE_SCAN_MAX_BYTES_V1 = 64 * 1024 * 1024
export const WORKSPACE_SCAN_MAX_TOTAL_BYTES_V1 = 256 * 1024 * 1024
const WORKSPACE_PACKAGE_MAX_FILE_BYTES_V1 = WORKSPACE_FILE_SCAN_MAX_BYTES_V1
const WORKSPACE_PACKAGE_MAX_TOTAL_BYTES_V1 = WORKSPACE_SCAN_MAX_TOTAL_BYTES_V1

interface ProjectionDocumentV1 {
  binding: WorkspaceDocumentBindingV1
  identity: WorkspaceDocumentIdentityV1
  semanticValue: Record<string, unknown>
  canonicalHash: string
  text: string
}

interface ParsedWorkspaceDocumentV1 {
  semanticValue: Record<string, unknown>
  canonicalHash: string
}

interface StoryforgeDocumentEnvelopeV1 {
  storyforge: WorkspaceDocumentIdentityV1 & {
    tableName: string
    schemaVersion: 1
  }
  data: Record<string, unknown>
}

interface StoryforgeRecoveryEnvelopeV1 {
  storyforge: WorkspaceDocumentIdentityV1 & {
    tableName: '__recovery__'
    schemaVersion: 1
  }
  backup: ProjectExportData
}

interface StoryforgeMemoryIndexEnvelopeV1 {
  storyforge: WorkspaceDocumentIdentityV1 & {
    tableName: '__memory_index__'
    schemaVersion: 1
  }
  index: Awaited<ReturnType<typeof buildMemoryArtifactIndexV1>>
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

export function chapterHtmlToWorkspaceMarkdownV1(content: string): string {
  if (!content) return ''
  if (!/<\/?[a-z][\s\S]*>/i.test(content)) return normalizeLineEndings(content)
  return normalizeLineEndings(turndown.turndown(content))
}

export function workspaceMarkdownToChapterHtmlV1(markdown: string): string {
  if (!markdown) return ''
  return marked.parse(normalizeLineEndings(markdown), { async: false }) as string
}

function portableSegment(value: string): string {
  return encodeURIComponent(value).replace(/%/g, '_')
}

function assertRelativePath(relativePath: string): string[] {
  if (!relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) {
    throw new Error(`[memory-workspace] 非法相对路径: ${relativePath}`)
  }
  const parts = relativePath.split('/')
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes('\0'))) {
    throw new Error(`[memory-workspace] 非法相对路径: ${relativePath}`)
  }
  return parts
}

async function directoryAt(
  root: FileSystemDirectoryHandle,
  parts: readonly string[],
  create: boolean,
): Promise<FileSystemDirectoryHandle> {
  let current = root
  for (const part of parts) current = await current.getDirectoryHandle(part, { create })
  return current
}

async function readTextAt(root: FileSystemDirectoryHandle, relativePath: string): Promise<string | null> {
  const parts = assertRelativePath(relativePath)
  try {
    const directory = await directoryAt(root, parts.slice(0, -1), false)
    const fileHandle = await directory.getFileHandle(parts[parts.length - 1])
    return await (await fileHandle.getFile()).text()
  } catch (error) {
    if ((error as { name?: string })?.name === 'NotFoundError') return null
    throw error
  }
}

async function fileAt(root: FileSystemDirectoryHandle, relativePath: string): Promise<File | null> {
  const parts = assertRelativePath(relativePath)
  try {
    const directory = await directoryAt(root, parts.slice(0, -1), false)
    return await (await directory.getFileHandle(parts[parts.length - 1])).getFile()
  } catch (error) {
    if ((error as { name?: string })?.name === 'NotFoundError') return null
    throw error
  }
}

async function writeTextAt(root: FileSystemDirectoryHandle, relativePath: string, text: string): Promise<void> {
  const parts = assertRelativePath(relativePath)
  const directory = await directoryAt(root, parts.slice(0, -1), true)
  const fileHandle = await directory.getFileHandle(parts[parts.length - 1], { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(text)
  } finally {
    await writable.close()
  }
}

function projectionSpec(tableName: string): WorkspaceProjectionSpecV1 {
  const spec = PROJECT_TABLES.find(candidate => candidate.name === tableName)?.workspaceProjection
  if (!spec || spec.classification !== 'editable') {
    throw new Error(`[memory-workspace] ${tableName} 未登记可编辑文件投影`)
  }
  return spec
}

async function ensurePortableRoots(projectId: number): Promise<{
  project: Project
  worlds: World[]
  works: Work[]
}> {
  await ensureWorkspaceOwnership(projectId)
  return db.transaction('rw', db.projects, db.worlds, db.works, async () => {
    const project = await db.projects.get(projectId)
    if (!project) throw new Error('[memory-workspace] LocalWorkspace 不存在')
    let workspaceUid = project.workspaceUid
    if (!isWorkspaceUid(workspaceUid)) {
      workspaceUid = generateWorkspaceUid()
      await db.projects.update(projectId, { workspaceUid })
    }
    const worlds = await db.worlds.where('projectId').equals(projectId).toArray()
    const works = await db.works.where('projectId').equals(projectId).toArray()
    const used = new Set<string>()
    for (const work of works) {
      if (!isWorkCode(work.code) || used.has(work.code)) {
        let code = generateWorkCode()
        while (used.has(code)) code = generateWorkCode()
        await db.works.update(work.id!, { code })
        work.code = code
      }
      used.add(work.code!)
    }
    return { project: { ...project, workspaceUid }, worlds, works }
  })
}

function identityFor(
  workspaceUid: string,
  binding: WorkspaceDocumentBindingV1,
): WorkspaceDocumentIdentityV1 {
  return {
    version: 1,
    workspaceUid,
    documentId: binding.documentId,
    documentKind: binding.documentKind,
    ...(binding.worldCode ? { worldCode: binding.worldCode } : {}),
    ...(binding.workCode ? { workCode: binding.workCode } : {}),
  }
}

async function ensureBinding(input: {
  projectId: number
  workspaceUid: string
  tableName: string
  recordId: number
  documentKind: string
  codec: WorkspaceDocumentBindingV1['codec']
  editPolicy: WorkspaceDocumentBindingV1['editPolicy']
  worldCode?: string
  workCode?: string
  pathFor: (documentId: string) => string
}): Promise<WorkspaceDocumentBindingV1> {
  const existing = await db.workspaceDocuments
    .where('[projectId+tableName+recordId]')
    .equals([input.projectId, input.tableName, input.recordId])
    .first()
  if (existing) return existing
  const now = Date.now()
  const documentId = generateDocumentId()
  const binding: WorkspaceDocumentBindingV1 = {
    projectId: input.projectId,
    workspaceUid: input.workspaceUid,
    documentId,
    documentKind: input.documentKind,
    tableName: input.tableName,
    recordId: input.recordId,
    ...(input.worldCode ? { worldCode: input.worldCode } : {}),
    ...(input.workCode ? { workCode: input.workCode } : {}),
    relativePath: input.pathFor(documentId),
    codec: input.codec,
    editPolicy: input.editPolicy,
    schemaVersion: 1,
    baselineCanonicalHash: null,
    databaseCanonicalHash: null,
    fileCanonicalHash: null,
    lastSyncRevision: 0,
    createdAt: now,
    updatedAt: now,
  }
  const id = await db.workspaceDocuments.add(binding) as number
  return { ...binding, id }
}

function envelope(
  identity: WorkspaceDocumentIdentityV1,
  tableName: string,
  data: Record<string, unknown>,
): StoryforgeDocumentEnvelopeV1 {
  return { storyforge: { ...identity, tableName, schemaVersion: 1 }, data }
}

function structuredText(codec: 'json' | 'yaml', value: StoryforgeDocumentEnvelopeV1): string {
  if (codec === 'json') return `${JSON.stringify(value, null, 2)}\n`
  return stringifyYaml(value, { lineWidth: 0, sortMapEntries: true })
}

function chapterText(
  identity: WorkspaceDocumentIdentityV1,
  metadata: Record<string, unknown>,
  contentMarkdown: string,
): string {
  const frontmatter = stringifyYaml({
    storyforge: { ...identity, tableName: 'chapters', schemaVersion: 1 },
    data: metadata,
  }, { lineWidth: 0, sortMapEntries: true })
  return `---\n${frontmatter}---\n${contentMarkdown}`
}

function projectSemantic(project: Project, activeWorld?: World, activeWork?: Work): Record<string, unknown> {
  void activeWorld
  void activeWork
  return {
    name: project.name,
    description: project.description,
    genres: [...project.genres],
    status: project.status,
    targetWordCount: project.targetWordCount,
    creativeMode: project.creativeMode ?? null,
    enableMultiWorld: project.enableMultiWorld ?? false,
  }
}

function worldSemantic(world: World): Record<string, unknown> {
  return {
    name: world.name,
    description: world.description,
  }
}

function workSemantic(work: Work, world: World): Record<string, unknown> {
  void world
  return {
    title: work.title,
    description: work.description,
    genres: [...work.genres],
    status: work.status,
    targetWordCount: work.targetWordCount,
    writingStyleId: work.writingStyleId ?? null,
    methodologyId: work.methodologyId ?? null,
  }
}

const PROJECT_WORKSPACE_FIELDS = [
  'name', 'description', 'genres', 'status', 'targetWordCount', 'creativeMode', 'enableMultiWorld',
] as const
const WORLD_WORKSPACE_FIELDS = ['name', 'description'] as const
const WORK_WORKSPACE_FIELDS = [
  'title', 'description', 'genres', 'status', 'targetWordCount', 'writingStyleId', 'methodologyId',
] as const
const CHAPTER_WORKSPACE_FIELDS = ['title', 'status', 'order', 'notes', 'content'] as const
const STORY_CORE_DISK_FIELDS = [
  '一句话故事', '故事概念', '主题', '核心冲突', '情节模式', '故事主线', '故事复线',
] as const
const STORY_CORE_FIELD_MAP = {
  一句话故事: 'logline',
  故事概念: 'concept',
  主题: 'theme',
  核心冲突: 'centralConflict',
  情节模式: 'plotPattern',
  故事主线: 'mainPlot',
  故事复线: 'subPlots',
} as const
const CREATIVE_RULES_DISK_FIELDS = [
  '写作风格', '叙事视角', '基调与氛围', '禁止事项', '一致性规则', '特殊要求',
] as const
const CREATIVE_RULES_FIELD_MAP = {
  写作风格: 'writingStyle',
  叙事视角: 'narrativePOV',
  基调与氛围: 'atmosphere',
  禁止事项: 'prohibitions',
  一致性规则: 'consistencyRules',
  特殊要求: 'specialRequirements',
} as const
const POV_FROM_DISK: Readonly<Record<string, CreativeRules['narrativePOV']>> = {
  第一人称: 'first-person',
  第三人称有限: 'third-limited',
  第三人称全知: 'third-omniscient',
  多视角: 'multi-pov',
}
const POV_TO_DISK: Readonly<Record<CreativeRules['narrativePOV'], string>> = {
  'first-person': '第一人称',
  'third-limited': '第三人称有限',
  'third-omniscient': '第三人称全知',
  'multi-pov': '多视角',
}
const PROJECT_STATUSES = new Set(['drafting', 'ongoing', 'paused', 'completed'])
const CHAPTER_STATUSES = new Set(['outline', 'draft', 'revised', 'polished', 'final'])

function assertExactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedSet = new Set(expected)
  const unknown = Object.keys(value).filter(key => !expectedSet.has(key))
  const missing = expected.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  if (unknown.length || missing.length) {
    throw new Error(`${label} 字段不匹配（未知: ${unknown.join(',') || '无'}；缺少: ${missing.join(',') || '无'}）`)
  }
}

function strictString(value: unknown, field: string, nonEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串`)
  const normalized = value.trim()
  if (nonEmpty && !normalized) throw new Error(`${field} 不得为空`)
  return normalized
}

function strictNullableString(value: unknown, field: string): string | null {
  return value == null ? null : strictString(value, field)
}

function strictGenres(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${field} 必须是字符串数组`)
  }
  return [...value]
}

function strictStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`${field} 必须是字符串列表`)
  }
  return value.map(item => item.trim()).filter(Boolean)
}

function parseStoredStringList(value: string | undefined, field: string): string[] {
  try {
    return strictStringList(JSON.parse(value || '[]'), field)
  } catch (error) {
    throw new Error(`[memory-workspace] ${field} 不是有效字符串列表：${(error as Error).message}`)
  }
}

function strictNumber(value: unknown, field: string, integer = false): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) {
    throw new Error(`${field} 必须是${integer ? '非负整数' : '非负数字'}`)
  }
  return value
}

function strictEnum(value: unknown, field: string, allowed: ReadonlySet<string>): string {
  if (typeof value !== 'string' || !allowed.has(value)) {
    throw new Error(`${field} 不是允许的枚举值`)
  }
  return value
}

function normalizeWorkspaceSemanticV1(
  tableName: string,
  semanticValue: Record<string, unknown>,
): { semanticValue: Record<string, unknown>; patch: Record<string, unknown>; compareAndSetFields: readonly string[] } {
  if (tableName === 'projects') {
    assertExactObjectKeys(semanticValue, PROJECT_WORKSPACE_FIELDS, 'LocalWorkspace')
    const normalized = {
      name: strictString(semanticValue.name, 'name', true),
      description: strictString(semanticValue.description, 'description'),
      genres: strictGenres(semanticValue.genres, 'genres'),
      status: strictEnum(semanticValue.status, 'status', PROJECT_STATUSES),
      targetWordCount: strictNumber(semanticValue.targetWordCount, 'targetWordCount', true),
      creativeMode: semanticValue.creativeMode == null
        ? null
        : strictEnum(semanticValue.creativeMode, 'creativeMode', new Set(['fantasy', 'historical'])),
      enableMultiWorld: (() => {
        if (typeof semanticValue.enableMultiWorld !== 'boolean') throw new Error('enableMultiWorld 必须是布尔值')
        return semanticValue.enableMultiWorld
      })(),
    }
    return { semanticValue: normalized, patch: normalized, compareAndSetFields: PROJECT_WORKSPACE_FIELDS }
  }
  if (tableName === 'worlds') {
    assertExactObjectKeys(semanticValue, WORLD_WORKSPACE_FIELDS, 'World')
    const normalized = {
      name: strictString(semanticValue.name, 'name', true),
      description: strictString(semanticValue.description, 'description'),
    }
    return { semanticValue: normalized, patch: normalized, compareAndSetFields: WORLD_WORKSPACE_FIELDS }
  }
  if (tableName === 'works') {
    assertExactObjectKeys(semanticValue, WORK_WORKSPACE_FIELDS, 'Work')
    const normalized = {
      title: strictString(semanticValue.title, 'title', true),
      description: strictString(semanticValue.description, 'description'),
      genres: strictGenres(semanticValue.genres, 'genres'),
      status: strictEnum(semanticValue.status, 'status', PROJECT_STATUSES),
      targetWordCount: strictNumber(semanticValue.targetWordCount, 'targetWordCount', true),
      writingStyleId: strictNullableString(semanticValue.writingStyleId, 'writingStyleId'),
      methodologyId: strictNullableString(semanticValue.methodologyId, 'methodologyId'),
    }
    return { semanticValue: normalized, patch: normalized, compareAndSetFields: WORK_WORKSPACE_FIELDS }
  }
  if (tableName === 'chapters') {
    const diskFields = ['title', 'status', 'order', 'notes', 'contentMarkdown'] as const
    assertExactObjectKeys(semanticValue, diskFields, 'Chapter')
    const contentMarkdown = chapterHtmlToWorkspaceMarkdownV1(
      workspaceMarkdownToChapterHtmlV1(strictString(semanticValue.contentMarkdown, 'contentMarkdown')),
    )
    const content = workspaceMarkdownToChapterHtmlV1(contentMarkdown)
    const normalized = {
      title: strictString(semanticValue.title, 'title', true),
      status: strictEnum(semanticValue.status, 'status', CHAPTER_STATUSES),
      order: strictNumber(semanticValue.order, 'order', true),
      notes: strictString(semanticValue.notes, 'notes'),
      contentMarkdown,
    }
    return {
      semanticValue: normalized,
      patch: {
        title: normalized.title,
        status: normalized.status,
        order: normalized.order,
        notes: normalized.notes,
        content,
        wordCount: countWords(htmlToPlainText(content)),
      },
      compareAndSetFields: [...CHAPTER_WORKSPACE_FIELDS, 'wordCount'],
    }
  }
  if (tableName === 'storyCores') {
    assertExactObjectKeys(semanticValue, STORY_CORE_DISK_FIELDS, '故事核心')
    const normalized = Object.fromEntries(STORY_CORE_DISK_FIELDS.map(field => [
      field,
      strictString(semanticValue[field], field),
    ]))
    return {
      semanticValue: normalized,
      patch: Object.fromEntries(STORY_CORE_DISK_FIELDS.map(field => [
        STORY_CORE_FIELD_MAP[field],
        normalized[field],
      ])),
      compareAndSetFields: Object.values(STORY_CORE_FIELD_MAP),
    }
  }
  if (tableName === 'creativeRules') {
    assertExactObjectKeys(semanticValue, CREATIVE_RULES_DISK_FIELDS, '创作规则')
    const povLabel = strictString(semanticValue.叙事视角, '叙事视角', true)
    const narrativePOV = POV_FROM_DISK[povLabel]
    if (!narrativePOV) throw new Error('叙事视角必须是第一人称、第三人称有限、第三人称全知或多视角')
    const normalized = {
      写作风格: strictString(semanticValue.写作风格, '写作风格'),
      叙事视角: povLabel,
      基调与氛围: strictString(semanticValue.基调与氛围, '基调与氛围'),
      禁止事项: strictStringList(semanticValue.禁止事项, '禁止事项'),
      一致性规则: strictStringList(semanticValue.一致性规则, '一致性规则'),
      特殊要求: strictString(semanticValue.特殊要求, '特殊要求'),
    }
    return {
      semanticValue: normalized,
      patch: {
        writingStyle: normalized.写作风格,
        narrativePOV,
        atmosphere: normalized.基调与氛围,
        prohibitions: JSON.stringify(normalized.禁止事项),
        consistencyRules: JSON.stringify(normalized.一致性规则),
        specialRequirements: normalized.特殊要求,
      },
      compareAndSetFields: Object.values(CREATIVE_RULES_FIELD_MAP),
    }
  }
  throw new Error(`[memory-workspace] ${tableName} 没有登记反向字段映射`)
}

function chapterSemantic(chapter: Chapter): Record<string, unknown> {
  return {
    title: chapter.title,
    status: chapter.status,
    order: chapter.order,
    notes: chapter.notes ?? '',
    contentMarkdown: chapterHtmlToWorkspaceMarkdownV1(chapter.content),
  }
}

function storyCoreSemantic(row: StoryCore): Record<string, unknown> {
  return {
    一句话故事: row.logline ?? '',
    故事概念: row.concept ?? '',
    主题: row.theme ?? '',
    核心冲突: row.centralConflict ?? '',
    情节模式: row.plotPattern ?? '',
    故事主线: row.mainPlot ?? row.storyLines ?? '',
    故事复线: row.subPlots ?? '',
  }
}

function creativeRulesSemantic(row: CreativeRules): Record<string, unknown> {
  const pov = POV_TO_DISK[row.narrativePOV]
  if (!pov) throw new Error(`[memory-workspace] creativeRules#${row.id ?? '?'} 叙事视角无效`)
  return {
    写作风格: row.writingStyle ?? '',
    叙事视角: pov,
    基调与氛围: row.atmosphere ?? row.toneAndMood ?? '',
    禁止事项: parseStoredStringList(row.prohibitions, '禁止事项'),
    一致性规则: parseStoredStringList(row.consistencyRules, '一致性规则'),
    特殊要求: row.specialRequirements ?? '',
  }
}

async function createProjectionDocument(input: {
  projectId: number
  workspaceUid: string
  tableName: 'projects' | 'worlds' | 'works' | 'chapters' | 'storyCores' | 'creativeRules'
  recordId: number
  semanticValue: Record<string, unknown>
  worldCode?: string
  workCode?: string
  pathFor: (documentId: string) => string
}): Promise<ProjectionDocumentV1> {
  const spec = projectionSpec(input.tableName)
  const normalized = normalizeWorkspaceSemanticV1(input.tableName, input.semanticValue)
  const binding = await ensureBinding({
    ...input,
    documentKind: spec.documentKind,
    codec: spec.codec,
    editPolicy: spec.editPolicy,
  })
  const identity = identityFor(input.workspaceUid, binding)
  const canonicalHash = await hashCanonicalValue(normalized.semanticValue)
  let text: string
  if (spec.mapper === 'chapter-markdown-v1') {
    const { contentMarkdown, ...metadata } = normalized.semanticValue
    text = chapterText(identity, metadata, String(contentMarkdown ?? ''))
  } else {
    text = structuredText(spec.codec as 'json' | 'yaml', envelope(identity, input.tableName, normalized.semanticValue))
  }
  return {
    binding: { ...binding, databaseCanonicalHash: canonicalHash },
    identity,
    semanticValue: normalized.semanticValue,
    canonicalHash,
    text,
  }
}

async function createRecoveryProjectionDocumentV1(
  projectId: number,
  workspaceUid: string,
): Promise<ProjectionDocumentV1> {
  const backup = await exportProjectJSON(projectId)
  // Export time is transport metadata, not project state. Keeping it fixed makes
  // repeated self-checks deterministic when no registered content changed.
  backup.exportedAt = 0
  const binding = await ensureBinding({
    projectId,
    workspaceUid,
    tableName: '__recovery__',
    recordId: projectId,
    documentKind: 'recovery-capsule',
    codec: 'json',
    editPolicy: 'machine-readonly',
    pathFor: () => '.storyforge/recovery/project.json',
  })
  const identity = identityFor(workspaceUid, binding)
  const semanticValue = backup as unknown as Record<string, unknown>
  const canonicalHash = await hashCanonicalValue(semanticValue)
  const text = `${JSON.stringify({
    storyforge: { ...identity, tableName: '__recovery__', schemaVersion: 1 },
    backup,
  } satisfies StoryforgeRecoveryEnvelopeV1, null, 2)}\n`
  return {
    binding: { ...binding, databaseCanonicalHash: canonicalHash },
    identity,
    semanticValue,
    canonicalHash,
    text,
  }
}

async function createMemoryIndexProjectionDocumentV1(
  projectId: number,
  workspaceUid: string,
): Promise<ProjectionDocumentV1> {
  // The projected file describes the state after this manual sync commits.
  // Persisting the pre-sync dirty bit would make the index invalidate itself
  // forever, so the transaction's intended postcondition is explicitly clean.
  const index = await buildMemoryArtifactIndexV1(projectId, { projectedWorkspaceDirty: false })
  const binding = await ensureBinding({
    projectId,
    workspaceUid,
    tableName: '__memory_index__',
    recordId: projectId,
    documentKind: 'memory-artifact-index',
    codec: 'json',
    editPolicy: 'machine-readonly',
    pathFor: () => '.storyforge/runs/memory-index.json',
  })
  const identity = identityFor(workspaceUid, binding)
  const semanticValue = index as unknown as Record<string, unknown>
  const canonicalHash = await hashCanonicalValue(semanticValue)
  const text = `${JSON.stringify({
    storyforge: { ...identity, tableName: '__memory_index__', schemaVersion: 1 },
    index,
  } satisfies StoryforgeMemoryIndexEnvelopeV1, null, 2)}\n`
  return {
    binding: { ...binding, databaseCanonicalHash: canonicalHash },
    identity,
    semanticValue,
    canonicalHash,
    text,
  }
}

export async function buildWorkspaceProjectionV1(projectId: number): Promise<ProjectionDocumentV1[]> {
  const { project, worlds, works } = await ensurePortableRoots(projectId)
  const workspaceUid = project.workspaceUid!
  const worldById = new Map(worlds.map(world => [world.id!, world]))
  const workById = new Map(works.map(work => [work.id!, work]))
  const activeWorld = project.activeWorldId == null ? undefined : worldById.get(project.activeWorldId)
  const activeWork = project.activeWorkId == null ? undefined : workById.get(project.activeWorkId)
  const documents: ProjectionDocumentV1[] = []

  documents.push(await createProjectionDocument({
    projectId, workspaceUid, tableName: 'projects', recordId: projectId,
    semanticValue: projectSemantic(project, activeWorld, activeWork),
    pathFor: () => 'storyforge.workspace.json',
  }))

  for (const world of worlds.sort((left, right) => left.code.localeCompare(right.code))) {
    documents.push(await createProjectionDocument({
      projectId, workspaceUid, tableName: 'worlds', recordId: world.id!, worldCode: world.code,
      semanticValue: worldSemantic(world),
      pathFor: () => `worlds/${portableSegment(world.code)}/world.yaml`,
    }))
  }

  for (const work of works.sort((left, right) => left.code!.localeCompare(right.code!))) {
    const world = worldById.get(work.worldId)
    if (!world) throw new Error(`[memory-workspace] Work ${work.id} 缺少同项目 World`)
    documents.push(await createProjectionDocument({
      projectId, workspaceUid, tableName: 'works', recordId: work.id!,
      worldCode: world.code, workCode: work.code,
      semanticValue: workSemantic(work, world),
      pathFor: () => `works/${portableSegment(work.code!)}/work.yaml`,
    }))
  }

  const [storyCores, creativeRules] = await Promise.all([
    db.storyCores.where('projectId').equals(projectId).toArray(),
    db.creativeRules.where('projectId').equals(projectId).toArray(),
  ])
  for (const [tableName, rows] of [
    ['storyCores', storyCores],
    ['creativeRules', creativeRules],
  ] as const) {
    const seenWorkIds = new Set<number>()
    for (const row of [...rows].sort((left, right) => (left.id ?? 0) - (right.id ?? 0))) {
      const workId = (row as typeof row & { workId?: number }).workId
      const work = workId == null ? undefined : workById.get(workId)
      if (!row.id || !work) {
        throw new Error(`[memory-workspace] ${tableName}#${row.id ?? '?'} 缺少明确 Work owner`)
      }
      if (seenWorkIds.has(work.id!)) {
        throw new Error(`[memory-workspace] Work ${work.id} 存在多份 ${tableName} 单例，拒绝生成歧义文件`)
      }
      seenWorkIds.add(work.id!)
      const world = worldById.get(work.worldId)
      if (!world) throw new Error(`[memory-workspace] ${tableName}#${row.id} 的 World owner 无效`)
      documents.push(await createProjectionDocument({
        projectId,
        workspaceUid,
        tableName,
        recordId: row.id,
        worldCode: world.code,
        workCode: work.code,
        semanticValue: tableName === 'storyCores'
          ? storyCoreSemantic(row as StoryCore)
          : creativeRulesSemantic(row as CreativeRules),
        pathFor: () => `works/${portableSegment(work.code!)}/memory/${
          tableName === 'storyCores' ? 'story-core.yaml' : 'creative-rules.yaml'
        }`,
      }))
    }
  }

  const chapters = await db.chapters.where('projectId').equals(projectId).toArray()
  for (const chapter of chapters.sort((left, right) => left.order - right.order || (left.id ?? 0) - (right.id ?? 0))) {
    const workId = (chapter as Chapter & { workId?: number }).workId ?? project.activeWorkId
    const work = workId == null ? undefined : workById.get(workId)
    if (!work) throw new Error(`[memory-workspace] Chapter ${chapter.id} 缺少 Work owner`)
    const world = worldById.get(work.worldId)
    if (!world) throw new Error(`[memory-workspace] Chapter ${chapter.id} 的 World owner 无效`)
    documents.push(await createProjectionDocument({
      projectId, workspaceUid, tableName: 'chapters', recordId: chapter.id!,
      worldCode: world.code, workCode: work.code,
      semanticValue: chapterSemantic(chapter),
      pathFor: documentId => `works/${portableSegment(work.code!)}/chapters/${documentId}.md`,
    }))
  }
  // A registry-derived, read-only recovery capsule mirrors every exportable
  // formal/evidence table, including Harness ledgers. It is not a fourth write
  // authority: external edits are quarantined and never adopted.
  documents.push(await createRecoveryProjectionDocumentV1(projectId, workspaceUid))
  documents.push(await createMemoryIndexProjectionDocumentV1(projectId, workspaceUid))
  return documents
}

function assertDocumentIdentity(
  raw: unknown,
  expected: ProjectionDocumentV1,
): asserts raw is StoryforgeDocumentEnvelopeV1['storyforge'] {
  if (!raw || typeof raw !== 'object') throw new Error('缺少 storyforge 文档身份')
  const identity = raw as Record<string, unknown>
  if (
    identity.version !== 1
    || identity.schemaVersion !== 1
    || identity.workspaceUid !== expected.identity.workspaceUid
    || identity.documentId !== expected.identity.documentId
    || identity.documentKind !== expected.identity.documentKind
    || identity.tableName !== expected.binding.tableName
    || (expected.identity.worldCode != null && identity.worldCode !== expected.identity.worldCode)
    || (expected.identity.workCode != null && identity.workCode !== expected.identity.workCode)
  ) throw new Error('storyforge 文档身份、作用域或 schema 不匹配')
}

async function parseProjectionDocument(
  expected: ProjectionDocumentV1,
  text: string,
): Promise<ParsedWorkspaceDocumentV1> {
  let semanticValue: Record<string, unknown>
  if (expected.binding.documentKind === 'memory-artifact-index') {
    const decoded = JSON.parse(text) as Partial<StoryforgeMemoryIndexEnvelopeV1>
    assertDocumentIdentity(decoded.storyforge, expected)
    if (!decoded.index || decoded.index.version !== 1
      || decoded.index.workspaceUid !== expected.identity.workspaceUid
      || typeof decoded.index.workspaceDirty !== 'boolean'
      || await hashCanonicalValue({
        version: decoded.index.version,
        workspaceUid: decoded.index.workspaceUid,
        workspaceDirty: decoded.index.workspaceDirty,
        runs: decoded.index.runs,
      }) !== decoded.index.indexHash) {
      throw new Error('记忆产物索引格式或 hash 无效')
    }
    semanticValue = decoded.index as unknown as Record<string, unknown>
    return { semanticValue, canonicalHash: await hashCanonicalValue(semanticValue) }
  }
  if (expected.binding.documentKind === 'recovery-capsule') {
    const decoded = JSON.parse(text) as Partial<StoryforgeRecoveryEnvelopeV1>
    assertDocumentIdentity(decoded.storyforge, expected)
    assertTrustedProjectBackup(decoded.backup)
    const backupWorkspaceUid = (decoded.backup.project as Project).workspaceUid
    if (backupWorkspaceUid !== expected.identity.workspaceUid) {
      throw new Error('恢复胶囊 workspaceUid 与工作区身份不匹配')
    }
    semanticValue = decoded.backup as unknown as Record<string, unknown>
    return { semanticValue, canonicalHash: await hashCanonicalValue(semanticValue) }
  }
  if (expected.binding.codec === 'markdown-frontmatter') {
    const normalized = normalizeLineEndings(text)
    if (!normalized.startsWith('---\n')) throw new Error('Markdown 缺少 YAML front matter')
    const marker = normalized.indexOf('\n---\n', 4)
    if (marker < 0) throw new Error('Markdown front matter 未闭合')
    const header = parseYaml(normalized.slice(4, marker)) as Partial<StoryforgeDocumentEnvelopeV1>
    assertDocumentIdentity(header?.storyforge, expected)
    if (!header.data || typeof header.data !== 'object') throw new Error('Markdown 缺少 data 元数据')
    semanticValue = {
      ...header.data,
      contentMarkdown: normalized.slice(marker + 5),
    }
  } else {
    const decoded = expected.binding.codec === 'json'
      ? JSON.parse(text) as Partial<StoryforgeDocumentEnvelopeV1>
      : parseYaml(text) as Partial<StoryforgeDocumentEnvelopeV1>
    assertDocumentIdentity(decoded?.storyforge, expected)
    if (!decoded.data || typeof decoded.data !== 'object' || Array.isArray(decoded.data)) {
      throw new Error('结构化文档缺少 data 对象')
    }
    semanticValue = decoded.data
  }
  const normalized = normalizeWorkspaceSemanticV1(expected.binding.tableName, semanticValue)
  return {
    semanticValue: normalized.semanticValue,
    canonicalHash: await hashCanonicalValue(normalized.semanticValue),
  }
}

export function classifyWorkspaceDocumentChangeV1(input: {
  baselineCanonicalHash: string | null
  databaseCanonicalHash: string | null
  fileCanonicalHash: string | null
  fileInvalid?: boolean
}): WorkspaceDocumentChangeKindV1 {
  if (input.fileInvalid) return 'invalid'
  const { baselineCanonicalHash: baseline, databaseCanonicalHash: database, fileCanonicalHash: file } = input
  if (baseline == null) {
    if (database != null && file == null) return 'project-changed'
    if (database == null && file != null) return 'file-extra'
    if (database != null && file != null) return database === file ? 'same-change' : 'conflict'
    return 'clean'
  }
  if (database == null && file == null) return 'clean'
  if (database != null && file == null) return 'file-missing'
  if (database == null && file != null) return 'file-extra'
  if (database === baseline && file === baseline) return 'clean'
  if (database !== baseline && file === baseline) return 'project-changed'
  if (database === baseline && file !== baseline) return 'file-changed'
  if (database === file) return 'same-change'
  return 'conflict'
}

function actionFor(changeKind: WorkspaceDocumentChangeKindV1): WorkspaceSelfCheckActionV1 {
  switch (changeKind) {
    case 'clean': return 'none'
    case 'project-changed': return 'write-file'
    case 'file-changed': return 'stage-adoption'
    case 'same-change': return 'accept-same-change'
    case 'conflict': return 'resolve-conflict'
    case 'file-missing': return 'restore-file'
    case 'file-extra': return 'review-extra-file'
    case 'invalid': return 'quarantine'
  }
}

function summarize(items: readonly WorkspaceSelfCheckItemV1[]): WorkspaceSelfCheckReportV1['summary'] {
  const count = (kind: WorkspaceDocumentChangeKindV1) => items.filter(item => item.changeKind === kind).length
  return {
    clean: count('clean'),
    projectChanged: count('project-changed'),
    fileChanged: count('file-changed'),
    sameChange: count('same-change'),
    conflict: count('conflict'),
    missing: count('file-missing'),
    extra: count('file-extra'),
    invalid: count('invalid'),
  }
}

async function readManifest(root: FileSystemDirectoryHandle): Promise<WorkspaceManifestV1 | null> {
  const raw = await readTextAt(root, '.storyforge/manifest.json')
  if (raw == null) return null
  const parsed = JSON.parse(raw) as WorkspaceManifestV1
  const { manifestHash, ...body } = parsed
  if (parsed.version !== 1 || await hashCanonicalValue(body) !== manifestHash) {
    throw new Error('[memory-workspace] manifest 完整性校验失败')
  }
  return parsed
}

export async function buildWorkspaceSelfCheckReportV1(
  projectId: number,
  root: FileSystemDirectoryHandle,
): Promise<WorkspaceSelfCheckReportV1> {
  const documents = await buildWorkspaceProjectionV1(projectId)
  const items: WorkspaceSelfCheckItemV1[] = []
  let scannedBytes = 0
  for (const document of documents) {
    const file = await fileAt(root, document.binding.relativePath)
    let fileCanonicalHash: string | null = null
    let fileInvalid = false
    const issues: string[] = []
    if (file != null) {
      const declaredBytes = Number.isFinite(file.size) ? file.size : 0
      const declaredLastModified = Number.isFinite(file.lastModified) ? file.lastModified : 0
      if (declaredBytes > WORKSPACE_FILE_SCAN_MAX_BYTES_V1) {
        fileInvalid = true
        issues.push(`[memory-workspace] 文件超过单文件扫描上限: ${document.binding.relativePath}`)
      } else if (
        declaredBytes > 0
        && declaredLastModified > 0
        && document.binding.fileByteLength === declaredBytes
        && document.binding.fileLastModified === declaredLastModified
        && document.binding.fileCanonicalHash != null
      ) {
        // MEMORY-10 incremental scan: unchanged browser metadata reuses the
        // previously committed semantic hash. Changed files parse fully.
        fileCanonicalHash = document.binding.fileCanonicalHash
      } else {
        try {
          const text = await file.text()
          const actualBytes = declaredBytes || new TextEncoder().encode(text).byteLength
          scannedBytes += actualBytes
          if (actualBytes > WORKSPACE_FILE_SCAN_MAX_BYTES_V1 || scannedBytes > WORKSPACE_SCAN_MAX_TOTAL_BYTES_V1) {
            throw new Error(`[memory-workspace] 工作区本次扫描超过大小上限: ${document.binding.relativePath}`)
          }
          fileCanonicalHash = (await parseProjectionDocument(document, text)).canonicalHash
        } catch (error) {
          fileInvalid = true
          issues.push((error as Error).message)
        }
      }
    }
    let changeKind = classifyWorkspaceDocumentChangeV1({
      baselineCanonicalHash: document.binding.baselineCanonicalHash,
      databaseCanonicalHash: document.canonicalHash,
      fileCanonicalHash,
      fileInvalid,
    })
    if (document.binding.editPolicy === 'machine-readonly'
      && !['clean', 'project-changed', 'same-change', 'file-missing'].includes(changeKind)) {
      changeKind = 'invalid'
      issues.push('只读恢复证据已在硬盘变化；拒绝反向采纳，可由项目重新生成')
    }
    items.push({
      identity: document.identity,
      relativePath: document.binding.relativePath,
      codec: document.binding.codec,
      editPolicy: document.binding.editPolicy,
      baselineCanonicalHash: document.binding.baselineCanonicalHash,
      databaseCanonicalHash: document.canonicalHash,
      fileCanonicalHash,
      changeKind,
      proposedAction: actionFor(changeKind),
      issues,
    })
  }

  const manifest = await readManifest(root)
  const knownIds = new Set(documents.map(document => document.identity.documentId))
  for (const entry of manifest?.documents ?? []) {
    if (knownIds.has(entry.documentId)) continue
    const identity: WorkspaceDocumentIdentityV1 = {
      version: 1,
      workspaceUid: manifest!.workspaceUid,
      documentId: entry.documentId,
      documentKind: entry.documentKind,
    }
    items.push({
      identity,
      relativePath: entry.relativePath,
      codec: entry.codec,
      editPolicy: entry.editPolicy,
      baselineCanonicalHash: entry.canonicalHash,
      databaseCanonicalHash: null,
      fileCanonicalHash: entry.canonicalHash,
      changeKind: 'file-extra',
      proposedAction: 'review-extra-file',
      issues: ['manifest 中的文档在当前 IndexedDB 不存在'],
    })
  }

  const planBody = {
    version: 1 as const,
    projectId,
    workspaceUid: documents[0]?.identity.workspaceUid ?? '',
    modelPolicy: 'none' as const,
    items,
  }
  const planHash = await hashCanonicalValue(planBody)
  const plan: WorkspaceSelfCheckPlanV1 = {
    ...planBody,
    planId: `CHECK-${planHash.slice(0, 20)}`,
    createdAt: Date.now(),
    planHash,
  }
  return { version: 1, plan, summary: summarize(items), checkedAt: Date.now(), zeroModelCalls: true }
}

function candidatePatchForSemanticChanges(
  tableName: string,
  databaseSemantic: Record<string, unknown>,
  fileSemantic: Record<string, unknown>,
  fullPatch: Record<string, unknown>,
): Record<string, unknown> {
  const changed = Object.keys(fileSemantic).filter(key => (
    JSON.stringify(databaseSemantic[key]) !== JSON.stringify(fileSemantic[key])
  ))
  if (tableName === 'chapters') {
    const patch: Record<string, unknown> = {}
    for (const key of changed) {
      if (key === 'contentMarkdown') {
        patch.content = fullPatch.content
        patch.wordCount = fullPatch.wordCount
      } else {
        patch[key] = fullPatch[key]
      }
    }
    return patch
  }
  if (tableName === 'storyCores' || tableName === 'creativeRules') {
    const fieldMap: Readonly<Record<string, string>> = tableName === 'storyCores'
      ? STORY_CORE_FIELD_MAP
      : CREATIVE_RULES_FIELD_MAP
    return Object.fromEntries(changed.map(key => {
      const internalField = fieldMap[key]
      if (!internalField) throw new Error(`[memory-workspace] ${tableName} 磁盘字段 ${key} 没有 FIELD_REGISTRY 映射`)
      return [internalField, fullPatch[internalField]]
    }))
  }
  return Object.fromEntries(changed.map(key => [key, fullPatch[key]]))
}

async function readProjectionRecord(document: ProjectionDocumentV1): Promise<Record<string, unknown>> {
  const table = PROJECT_TABLES.find(spec => spec.name === document.binding.tableName)?.table
  if (!table) throw new Error(`[memory-workspace] ${document.binding.tableName} 未登记`)
  const record = await table.get(document.binding.recordId)
  if (!record) throw new Error(`[memory-workspace] ${document.binding.tableName}#${document.binding.recordId} 已不存在`)
  return record as Record<string, unknown>
}

/**
 * Parse disk edits into frozen, author-reviewable candidates. This is a pure
 * inspection step: it performs no adoption, file write, or model call.
 */
export async function buildWorkspaceFileAdoptionCandidatesV1(input: {
  projectId: number
  root: FileSystemDirectoryHandle
  expectedPlanHash?: string
  includeConflicts?: boolean
}): Promise<WorkspaceFileCandidateSetV1> {
  const report = await buildWorkspaceSelfCheckReportV1(input.projectId, input.root)
  if (input.expectedPlanHash != null && report.plan.planHash !== input.expectedPlanHash) {
    throw new Error('[memory-workspace] 自检后项目或硬盘已变化，请重新检查')
  }
  const documents = await buildWorkspaceProjectionV1(input.projectId)
  const byId = new Map(documents.map(document => [document.identity.documentId, document]))
  const candidates: WorkspaceFileAdoptionCandidateV1[] = []
  for (const item of report.plan.items) {
    const adoptable = item.changeKind === 'file-changed'
      || (input.includeConflicts === true && item.changeKind === 'conflict')
    if (!adoptable) continue
    const document = byId.get(item.identity.documentId)
    if (!document) throw new Error(`[memory-workspace] 候选文档 ${item.identity.documentId} 已不存在`)
    const text = await readTextAt(input.root, document.binding.relativePath)
    if (text == null) throw new Error(`[memory-workspace] 候选文件 ${document.binding.relativePath} 已不存在`)
    const parsed = await parseProjectionDocument(document, text)
    const normalized = normalizeWorkspaceSemanticV1(document.binding.tableName, parsed.semanticValue)
    const patch = candidatePatchForSemanticChanges(
      document.binding.tableName,
      document.semanticValue,
      normalized.semanticValue,
      normalized.patch,
    )
    if (Object.keys(patch).length === 0) continue
    const record = await readProjectionRecord(document)
    const compareAndSetExpectedHash = await hashAdoptRecordFieldsV1(record, normalized.compareAndSetFields)
    const candidateBody = {
      version: 1 as const,
      planHash: report.plan.planHash,
      identity: item.identity,
      tableName: document.binding.tableName as WorkspaceFileAdoptionCandidateV1['tableName'],
      recordId: document.binding.recordId,
      relativePath: document.binding.relativePath,
      changedFields: Object.keys(patch).sort(),
      patch,
      compareAndSetFields: [...normalized.compareAndSetFields].sort(),
      compareAndSetExpectedHash,
      baselineCanonicalHash: item.baselineCanonicalHash,
      databaseCanonicalHash: item.databaseCanonicalHash,
      fileCanonicalHash: item.fileCanonicalHash,
    }
    const candidateHash = await hashCanonicalValue(candidateBody)
    candidates.push({
      ...candidateBody,
      candidateId: `MEMORY-CANDIDATE-${candidateHash.slice(0, 20)}`,
      candidateHash,
      createdAt: Date.now(),
    })
  }
  const blockedDocumentIds = report.plan.items
    .filter(item => ['conflict', 'file-extra', 'invalid'].includes(item.changeKind))
    .filter(item => !(input.includeConflicts && item.changeKind === 'conflict'))
    .map(item => item.identity.documentId)
  return {
    version: 1,
    projectId: input.projectId,
    planHash: report.plan.planHash,
    candidates,
    blockedDocumentIds,
    createdAt: Date.now(),
    zeroModelCalls: true,
  }
}

async function scopeForWorkspaceCandidateV1(
  projectId: number,
  candidate: WorkspaceFileAdoptionCandidateV1,
): Promise<WorkspaceScope> {
  const fallback = (await ensureWorkspaceOwnership(projectId)).scope
  if (candidate.tableName === 'works') {
    const work = await db.works.get(candidate.recordId)
    if (!work) throw new Error(`[memory-workspace] Work ${candidate.recordId} 已不存在`)
    return { projectId, worldId: work.worldId, workId: candidate.recordId }
  }
  if (candidate.tableName === 'chapters') {
    const chapter = await db.chapters.get(candidate.recordId) as (Chapter & { workId?: number }) | undefined
    const workId = chapter?.workId
    const work = workId == null ? undefined : await db.works.get(workId)
    if (!chapter || !work) throw new Error(`[memory-workspace] Chapter ${candidate.recordId} 缺少有效 Work owner`)
    return { projectId, worldId: work.worldId, workId: workId! }
  }
  if (candidate.tableName === 'storyCores' || candidate.tableName === 'creativeRules') {
    const table = candidate.tableName === 'storyCores' ? db.storyCores : db.creativeRules
    const record = await table.get(candidate.recordId) as ({ workId?: number } & Record<string, unknown>) | undefined
    const work = record?.workId == null ? undefined : await db.works.get(record.workId)
    if (!record || !work || work.projectId !== projectId) {
      throw new Error(`[memory-workspace] ${candidate.tableName}#${candidate.recordId} 缺少有效 Work owner`)
    }
    return { projectId, worldId: work.worldId, workId: work.id! }
  }
  return fallback
}

/**
 * Author-confirmed disk→IndexedDB adoption. Every candidate crosses the same
 * FIELD_REGISTRY/AdoptionSchema/adopt() boundary as Harness output and is
 * protected by the frozen field-set CAS. Conflicts require explicit file-wins.
 */
export async function adoptWorkspaceFileChangesV1(input: {
  projectId: number
  root: FileSystemDirectoryHandle
  expectedPlanHash: string
  conflictResolution?: 'reject' | 'file-wins'
}): Promise<WorkspaceSyncReceiptV1> {
  const includeConflicts = input.conflictResolution === 'file-wins'
  const candidateSet = await buildWorkspaceFileAdoptionCandidatesV1({
    projectId: input.projectId,
    root: input.root,
    expectedPlanHash: input.expectedPlanHash,
    includeConflicts,
  })
  if (candidateSet.blockedDocumentIds.length) {
    throw new Error(`[memory-workspace] 仍有 ${candidateSet.blockedDocumentIds.length} 个冲突、额外或损坏文档待处理`)
  }
  if (candidateSet.candidates.length === 0) {
    throw new Error('[memory-workspace] 没有可采纳的本地改动')
  }
  const impactPlan = await buildWorkspaceImpactPlanV1({
    projectId: input.projectId,
    candidateSet,
  })

  for (const candidate of candidateSet.candidates) {
    const scope = await scopeForWorkspaceCandidateV1(input.projectId, candidate)
    const result = await adopt({
      projectId: input.projectId,
      scope,
      recordId: candidate.recordId,
      target: candidate.tableName,
      mode: 'replace',
      data: { ...candidate.patch },
      compareAndSet: {
        kind: 'record-fields-value-hash',
        fields: candidate.compareAndSetFields,
        expectedHash: candidate.compareAndSetExpectedHash,
      },
    })
    if (result.written.length !== 1 || result.skipped.length || result.unknown.length || result.typeErrors.length) {
      throw new Error(`[memory-workspace] 候选 ${candidate.candidateId} 采纳失败或已过期，请重新检查`)
    }
    if (candidate.tableName === 'chapters' && candidate.changedFields.includes('content')) {
      await propagateChapterEditStale(scope, candidate.recordId)
    }
  }

  const postAdoption = await buildWorkspaceSelfCheckReportV1(input.projectId, input.root)
  const unresolved = postAdoption.plan.items.filter(item => (
    ['file-changed', 'conflict', 'file-extra', 'invalid'].includes(item.changeKind)
  ))
  if (unresolved.length) {
    throw new Error(`[memory-workspace] 已安全停止：采纳后仍有 ${unresolved.length} 项需重新核对`)
  }
  const receipt = await synchronizeProjectChangesToFolderV1({
    projectId: input.projectId,
    root: input.root,
    expectedPlanHash: postAdoption.plan.planHash,
  })
  const receiptBody = {
    ...receipt,
    databaseAdoptionReceiptHashes: [
      ...candidateSet.candidates.map(candidate => candidate.candidateHash),
      impactPlan.planHash,
    ],
  }
  const { receiptHash: _oldReceiptHash, ...hashable } = receiptBody
  return { ...receiptBody, receiptHash: await hashCanonicalValue(hashable) }
}

function assertProjectToFileSafe(
  report: WorkspaceSelfCheckReportV1,
  approvedDatabaseWins = new Set<string>(),
  approvedRemovedDocuments = new Set<string>(),
  approvedRecoveryDocuments = new Set<string>(),
): void {
  const blocked = report.plan.items.filter(item => ![
    'clean', 'project-changed', 'same-change', 'file-missing',
  ].includes(item.changeKind) && !(
    item.changeKind === 'conflict' && approvedDatabaseWins.has(item.identity.documentId)
  ) && !(
    item.changeKind === 'file-extra' && approvedRemovedDocuments.has(item.identity.documentId)
  ) && !(
    item.changeKind === 'invalid' && approvedRecoveryDocuments.has(item.identity.documentId)
  ))
  if (blocked.length) {
    throw new Error(`[memory-workspace] 存在 ${blocked.length} 个硬盘改动、冲突或损坏项，拒绝覆盖`)
  }
}

async function buildManifest(
  documents: readonly ProjectionDocumentV1[],
  revision: number,
): Promise<WorkspaceManifestV1> {
  const body = {
    version: 1 as const,
    workspaceUid: documents[0]?.identity.workspaceUid ?? '',
    revision,
    writtenAt: Date.now(),
    hashAlgorithm: 'sha256-canonical-v1' as const,
    documents: documents.map(document => ({
      documentId: document.identity.documentId,
      documentKind: document.identity.documentKind,
      tableName: document.binding.tableName,
      relativePath: document.binding.relativePath,
      codec: document.binding.codec,
      editPolicy: document.binding.editPolicy,
      canonicalHash: document.canonicalHash,
      schemaVersion: document.binding.schemaVersion,
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath)),
  }
  return { ...body, manifestHash: await hashCanonicalValue(body) }
}

export async function synchronizeProjectChangesToFolderV1(input: {
  projectId: number
  root: FileSystemDirectoryHandle
  expectedPlanHash: string
  /** Internal conflict resolution proof; ordinary project sync never supplies it. */
  approvedDatabaseWinsDocumentIds?: readonly string[]
  /** Internal proof for an explicitly confirmed registered deletion. */
  approvedRemovedDocumentIds?: readonly string[]
  /** Internal proof that an invalid file is a target of the pending write saga. */
  approvedRecoveryDocumentIds?: readonly string[]
}): Promise<WorkspaceSyncReceiptV1> {
  const currentReport = await buildWorkspaceSelfCheckReportV1(input.projectId, input.root)
  if (currentReport.plan.planHash !== input.expectedPlanHash) {
    throw new Error('[memory-workspace] 自检后项目或硬盘已变化，请重新检查')
  }
  const approvedDatabaseWins = new Set(input.approvedDatabaseWinsDocumentIds ?? [])
  const approvedRemovedDocuments = new Set(input.approvedRemovedDocumentIds ?? [])
  const approvedRecoveryDocuments = new Set(input.approvedRecoveryDocumentIds ?? [])
  assertProjectToFileSafe(currentReport, approvedDatabaseWins, approvedRemovedDocuments, approvedRecoveryDocuments)
  const documents = await buildWorkspaceProjectionV1(input.projectId)
  const byId = new Map(documents.map(document => [document.identity.documentId, document]))
  await writeTextAt(input.root, '.storyforge/transactions/pending.json', `${JSON.stringify({
    version: 1,
    state: 'filesystem-pending',
    plan: currentReport.plan,
  }, null, 2)}\n`)

  for (const item of currentReport.plan.items) {
    if (!['project-changed', 'file-missing'].includes(item.changeKind)
      && !approvedDatabaseWins.has(item.identity.documentId)
      && !approvedRecoveryDocuments.has(item.identity.documentId)) continue
    const document = byId.get(item.identity.documentId)
    if (!document) throw new Error(`[memory-workspace] 计划文档 ${item.identity.documentId} 已不存在`)
    const previous = await readTextAt(input.root, document.binding.relativePath)
    if (previous != null) {
      await writeTextAt(
        input.root,
        `.storyforge/history/${currentReport.plan.planId}/${document.binding.relativePath}`,
        previous,
      )
    }
    await writeTextAt(input.root, document.binding.relativePath, document.text)
    const readBack = await readTextAt(input.root, document.binding.relativePath)
    if (readBack == null || (await parseProjectionDocument(document, readBack)).canonicalHash !== document.canonicalHash) {
      throw new Error(`[memory-workspace] 写后回读失败: ${document.binding.relativePath}`)
    }
  }

  const revision = Math.max(0, ...documents.map(document => document.binding.lastSyncRevision)) + 1
  const nextBindings = await Promise.all(documents.map(async document => {
    const file = await fileAt(input.root, document.binding.relativePath)
    return {
      ...document.binding,
      baselineCanonicalHash: document.canonicalHash,
      databaseCanonicalHash: document.canonicalHash,
      fileCanonicalHash: document.canonicalHash,
      ...(file && Number.isFinite(file.size) && file.size > 0 ? { fileByteLength: file.size } : {}),
      ...(file && Number.isFinite(file.lastModified) && file.lastModified > 0 ? { fileLastModified: file.lastModified } : {}),
      lastSyncRevision: revision,
      updatedAt: Date.now(),
    }
  }))
  const portableBindings = nextBindings.map(binding => ({
    version: 1,
    workspaceUid: binding.workspaceUid,
    documentId: binding.documentId,
    documentKind: binding.documentKind,
    tableName: binding.tableName,
    relativePath: binding.relativePath,
    worldCode: binding.worldCode ?? null,
    workCode: binding.workCode ?? null,
    schemaVersion: binding.schemaVersion,
    canonicalHash: binding.baselineCanonicalHash,
  }))
  await writeTextAt(input.root, '.storyforge/bindings.json', `${JSON.stringify(portableBindings, null, 2)}\n`)
  const manifest = await buildManifest(documents, revision)
  // Commit marker is deliberately the final disk write.
  await writeTextAt(input.root, '.storyforge/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  await db.workspaceDocuments.bulkPut(nextBindings)

  const receiptBody = {
    version: 1 as const,
    receiptId: `SYNC-${currentReport.plan.planHash.slice(0, 20)}-${revision}`,
    planId: currentReport.plan.planId,
    projectId: input.projectId,
    workspaceUid: currentReport.plan.workspaceUid,
    state: 'completed' as const,
    databaseAdoptionReceiptHashes: [] as string[],
    writtenDocumentHashes: Object.fromEntries(documents.map(document => [document.identity.documentId, document.canonicalHash])),
    manifestHash: manifest.manifestHash,
    completedAt: Date.now(),
  }
  return { ...receiptBody, receiptHash: await hashCanonicalValue(receiptBody) }
}

/** Explicit whole-document database-wins conflict resolution. */
export async function resolveWorkspaceConflictsUsingDatabaseV1(input: {
  projectId: number
  root: FileSystemDirectoryHandle
  expectedPlanHash: string
}): Promise<WorkspaceSyncReceiptV1> {
  const report = await buildWorkspaceSelfCheckReportV1(input.projectId, input.root)
  if (report.plan.planHash !== input.expectedPlanHash) {
    throw new Error('[memory-workspace] 自检后项目或硬盘已变化，请重新检查')
  }
  const conflicts = report.plan.items.filter(item => item.changeKind === 'conflict')
  if (!conflicts.length) throw new Error('[memory-workspace] 没有需要选择项目版本的冲突')
  const independentDiskChanges = report.plan.items.filter(item => (
    ['file-changed', 'file-extra', 'invalid'].includes(item.changeKind)
  ))
  if (independentDiskChanges.length) {
    throw new Error('[memory-workspace] 另有独立本地改动或损坏项，请先分别处理')
  }
  return synchronizeProjectChangesToFolderV1({
    ...input,
    approvedDatabaseWinsDocumentIds: conflicts.map(item => item.identity.documentId),
  })
}

/**
 * Treat missing chapter files as deletions only after an explicit author action.
 * The current database rendering is copied to trash first; reference-aware
 * chapter lifecycle rules run next; a new recovery capsule and manifest commit
 * make the deletion durable. Workspace/World/Work roots fail closed.
 */
export async function confirmMissingChapterFileDeletionsV1(input: {
  projectId: number
  root: FileSystemDirectoryHandle
  expectedPlanHash: string
}): Promise<WorkspaceSyncReceiptV1> {
  const report = await buildWorkspaceSelfCheckReportV1(input.projectId, input.root)
  if (report.plan.planHash !== input.expectedPlanHash) {
    throw new Error('[memory-workspace] 自检后项目或硬盘已变化，请重新检查')
  }
  const missing = report.plan.items.filter(item => item.changeKind === 'file-missing')
  if (!missing.length) throw new Error('[memory-workspace] 没有待确认的缺失文件')
  const documents = await buildWorkspaceProjectionV1(input.projectId)
  const byId = new Map(documents.map(document => [document.identity.documentId, document]))
  const chapterDocuments = missing.map(item => byId.get(item.identity.documentId))
  if (chapterDocuments.some(document => document?.binding.tableName !== 'chapters')) {
    throw new Error('[memory-workspace] Workspace/World/Work、语义单例和恢复证据缺失只能恢复，不允许按文件删除根记录或语义正式记录')
  }
  const otherDiskRisks = report.plan.items.filter(item => (
    ['file-changed', 'conflict', 'file-extra', 'invalid'].includes(item.changeKind)
  ))
  if (otherDiskRisks.length) {
    throw new Error('[memory-workspace] 另有本地改动、冲突或损坏项，删除前必须先处理')
  }
  const chapterIds: number[] = []
  for (const document of chapterDocuments as ProjectionDocumentV1[]) {
    await writeTextAt(
      input.root,
      `.storyforge/trash/${report.plan.planId}/${document.binding.relativePath}`,
      document.text,
    )
    chapterIds.push(document.binding.recordId)
  }
  await cascadeDeleteChapterRecords(chapterIds)
  const bindingIds = (chapterDocuments as ProjectionDocumentV1[])
    .map(document => document.binding.id)
    .filter((id): id is number => id != null)
  if (bindingIds.length) await db.workspaceDocuments.bulkDelete(bindingIds)

  const afterDelete = await buildWorkspaceSelfCheckReportV1(input.projectId, input.root)
  return synchronizeProjectChangesToFolderV1({
    projectId: input.projectId,
    root: input.root,
    expectedPlanHash: afterDelete.plan.planHash,
    approvedRemovedDocumentIds: missing.map(item => item.identity.documentId),
  })
}

interface PortableWorkspaceBindingV1 {
  version: 1
  workspaceUid: string
  documentId: string
  documentKind: string
  tableName: string
  relativePath: string
  worldCode: string | null
  workCode: string | null
  schemaVersion: number
  canonicalHash: string
}

function parsePortableBindingsV1(raw: string, workspaceUid: string): PortableWorkspaceBindingV1[] {
  const decoded = JSON.parse(raw) as unknown
  if (!Array.isArray(decoded)) throw new Error('[memory-workspace] bindings.json 不是数组')
  const documentIds = new Set<string>()
  const paths = new Set<string>()
  return decoded.map((value, index) => {
    if (!value || typeof value !== 'object') throw new Error(`[memory-workspace] binding #${index} 非法`)
    const binding = value as PortableWorkspaceBindingV1
    assertRelativePath(binding.relativePath)
    if (
      binding.version !== 1
      || binding.workspaceUid !== workspaceUid
      || !isWorkspaceDocumentId(binding.documentId)
      || typeof binding.documentKind !== 'string'
      || typeof binding.tableName !== 'string'
      || binding.schemaVersion !== 1
      || !/^[a-f0-9]{64}$/.test(binding.canonicalHash)
      || documentIds.has(binding.documentId)
      || paths.has(binding.relativePath)
    ) throw new Error(`[memory-workspace] binding #${index} 身份、路径或 hash 非法/重复`)
    documentIds.add(binding.documentId)
    paths.add(binding.relativePath)
    return binding
  })
}

async function restoredRecordIdForBindingV1(input: {
  projectId: number
  root: FileSystemDirectoryHandle
  binding: PortableWorkspaceBindingV1
  worldsByCode: ReadonlyMap<string, World>
  worksByCode: ReadonlyMap<string, Work>
}): Promise<number> {
  const { binding } = input
  if (binding.tableName === '__recovery__' || binding.tableName === '__memory_index__') return input.projectId
  if (binding.tableName === 'projects') return input.projectId
  if (binding.tableName === 'worlds') {
    const world = binding.worldCode == null ? undefined : input.worldsByCode.get(binding.worldCode)
    if (!world?.id) throw new Error(`[memory-workspace] 无法重绑 World ${binding.worldCode ?? ''}`)
    return world.id
  }
  if (binding.tableName === 'works') {
    const work = binding.workCode == null ? undefined : input.worksByCode.get(binding.workCode)
    if (!work?.id) throw new Error(`[memory-workspace] 无法重绑 Work ${binding.workCode ?? ''}`)
    return work.id
  }
  if (binding.tableName === 'chapters') {
    const work = binding.workCode == null ? undefined : input.worksByCode.get(binding.workCode)
    if (!work?.id) throw new Error(`[memory-workspace] 章节 ${binding.documentId} 缺少 Work owner`)
    const raw = await readTextAt(input.root, binding.relativePath)
    if (raw == null) throw new Error(`[memory-workspace] 章节文件 ${binding.relativePath} 缺失`)
    const normalized = normalizeLineEndings(raw)
    const marker = normalized.indexOf('\n---\n', 4)
    if (!normalized.startsWith('---\n') || marker < 0) throw new Error(`[memory-workspace] 章节文件 ${binding.relativePath} front matter 非法`)
    const header = parseYaml(normalized.slice(4, marker)) as Partial<StoryforgeDocumentEnvelopeV1>
    const data = header.data as Record<string, unknown> | undefined
    if (header.storyforge?.documentId !== binding.documentId || !data) {
      throw new Error(`[memory-workspace] 章节文件 ${binding.relativePath} 身份非法`)
    }
    const candidates = (await db.chapters.where('projectId').equals(input.projectId).toArray())
      .filter(chapter => (chapter as Chapter & { workId?: number }).workId === work.id)
      .filter(chapter => chapter.order === data.order && chapter.title.trim() === String(data.title ?? '').trim())
    if (candidates.length !== 1 || candidates[0].id == null) {
      throw new Error(`[memory-workspace] 章节 ${binding.documentId} 无法唯一重绑`)
    }
    return candidates[0].id
  }
  if (binding.tableName === 'storyCores' || binding.tableName === 'creativeRules') {
    const work = binding.workCode == null ? undefined : input.worksByCode.get(binding.workCode)
    if (!work?.id) throw new Error(`[memory-workspace] ${binding.tableName} ${binding.documentId} 缺少 Work owner`)
    const table = binding.tableName === 'storyCores' ? db.storyCores : db.creativeRules
    const candidates = (await table.where('projectId').equals(input.projectId).toArray())
      .filter(row => (row as typeof row & { workId?: number }).workId === work.id)
    if (candidates.length !== 1 || candidates[0].id == null) {
      throw new Error(`[memory-workspace] ${binding.tableName} ${binding.documentId} 无法唯一重绑`)
    }
    return candidates[0].id
  }
  throw new Error(`[memory-workspace] 不支持恢复 binding 目标 ${binding.tableName}`)
}

/**
 * Restore a complete isolated LocalWorkspace from the registry-derived capsule,
 * then rebind readable documents to newly remapped numeric IDs and prove the
 * restored database is clean against the existing disk manifest.
 */
export async function restoreWorkspaceFromFolderV1(
  root: FileSystemDirectoryHandle,
): Promise<{ projectId: number; report: WorkspaceSelfCheckReportV1 }> {
  const [recoveryRaw, bindingsRaw] = await Promise.all([
    readTextAt(root, '.storyforge/recovery/project.json'),
    readTextAt(root, '.storyforge/bindings.json'),
  ])
  if (recoveryRaw == null || bindingsRaw == null) {
    throw new Error('[memory-workspace] 工作区缺少恢复胶囊或 bindings.json')
  }
  const recovery = JSON.parse(recoveryRaw) as Partial<StoryforgeRecoveryEnvelopeV1>
  assertTrustedProjectBackup(recovery.backup)
  const workspaceUid = (recovery.backup.project as Project).workspaceUid
  if (!isWorkspaceUid(workspaceUid)
    || recovery.storyforge?.workspaceUid !== workspaceUid
    || recovery.storyforge?.tableName !== '__recovery__') {
    throw new Error('[memory-workspace] 恢复胶囊稳定身份不匹配')
  }
  if (await db.projects.where('workspaceUid').equals(workspaceUid).first()) {
    throw new Error('[memory-workspace] 该 LocalWorkspace 已存在；恢复只用于浏览器数据丢失后的重建')
  }
  const manifest = await readManifest(root)
  if (!manifest || manifest.workspaceUid !== workspaceUid) {
    throw new Error('[memory-workspace] manifest 缺失或与恢复胶囊身份不匹配')
  }
  const recoveryEntry = manifest.documents.find(entry => entry.documentId === recovery.storyforge?.documentId)
  if (!recoveryEntry || recoveryEntry.canonicalHash !== await hashCanonicalValue(recovery.backup)) {
    throw new Error('[memory-workspace] 恢复胶囊与 manifest hash 不一致')
  }
  const portableBindings = parsePortableBindingsV1(bindingsRaw, workspaceUid)
  const originalProject = recovery.backup.project as Project
  let projectId: number | null = null
  try {
    projectId = await importProjectJSON(recovery.backup)
    await db.projects.update(projectId, {
      name: originalProject.name,
      createdAt: originalProject.createdAt,
      updatedAt: originalProject.updatedAt,
    })
    await ensureWorkspaceOwnership(projectId)
    const [worlds, works] = await Promise.all([
      db.worlds.where('projectId').equals(projectId).toArray(),
      db.works.where('projectId').equals(projectId).toArray(),
    ])
    const worldsByCode = new Map(worlds.map(world => [world.code, world]))
    const worksByCode = new Map(works.map(work => [work.code!, work]))
    const manifestById = new Map(manifest.documents.map(entry => [entry.documentId, entry]))
    const now = Date.now()
    const restoredBindings: WorkspaceDocumentBindingV1[] = []
    for (const binding of portableBindings) {
      const manifestEntry = manifestById.get(binding.documentId)
      if (!manifestEntry
        || manifestEntry.relativePath !== binding.relativePath
        || manifestEntry.canonicalHash !== binding.canonicalHash) {
        throw new Error(`[memory-workspace] binding ${binding.documentId} 与 manifest 不一致`)
      }
      const recordId = await restoredRecordIdForBindingV1({
        projectId, root, binding, worldsByCode, worksByCode,
      })
      restoredBindings.push({
        projectId,
        workspaceUid,
        documentId: binding.documentId,
        documentKind: binding.documentKind,
        tableName: binding.tableName,
        recordId,
        ...(binding.worldCode ? { worldCode: binding.worldCode } : {}),
        ...(binding.workCode ? { workCode: binding.workCode } : {}),
        relativePath: binding.relativePath,
        codec: manifestEntry.codec,
        editPolicy: manifestEntry.editPolicy,
        schemaVersion: binding.schemaVersion,
        baselineCanonicalHash: binding.canonicalHash,
        databaseCanonicalHash: binding.canonicalHash,
        fileCanonicalHash: binding.canonicalHash,
        lastSyncRevision: manifest.revision,
        createdAt: now,
        updatedAt: now,
      })
    }
    await db.workspaceDocuments.bulkAdd(restoredBindings)
    const report = await buildWorkspaceSelfCheckReportV1(projectId, root)
    const divergent = report.plan.items.filter(item => item.changeKind !== 'clean')
    if (report.summary.clean !== restoredBindings.length || divergent.length) {
      const details = divergent.slice(0, 5).map(item => `${item.relativePath}:${item.changeKind}`).join('；')
      const currentBackup = await exportProjectJSON(projectId)
      currentBackup.exportedAt = 0
      const recoveryBackup = recovery.backup as unknown as Record<string, unknown>
      const currentRecord = currentBackup as unknown as Record<string, unknown>
      const changedSections: string[] = []
      for (const key of Object.keys(currentRecord)) {
        if (await hashCanonicalValue(currentRecord[key]) !== await hashCanonicalValue(recoveryBackup[key])) {
          changedSections.push(key)
          if (changedSections.length === 8) break
        }
      }
      const sectionDetails = changedSections.length
        ? `；差异分区:${changedSections.join(',')}`
        : ''
      throw new Error(`[memory-workspace] 恢复后回读核对未收敛，已撤销新项目${details ? `（${details}${sectionDetails}）` : ''}`)
    }
    return { projectId, report }
  } catch (error) {
    if (projectId != null) await cascadeDeleteProject(projectId)
    throw error
  }
}

/**
 * Resume a DB→disk saga after permission loss or a partial multi-file write.
 * The fresh deterministic report treats already-written files as same-change,
 * writes only the remaining project-changed/missing documents, and never calls
 * a model or repeats a database adoption.
 */
export async function recoverPendingWorkspaceSyncV1(
  projectId: number,
  root: FileSystemDirectoryHandle,
): Promise<WorkspaceSyncReceiptV1> {
  const report = await buildWorkspaceSelfCheckReportV1(projectId, root)
  const pendingRaw = await readTextAt(root, '.storyforge/transactions/pending.json')
  const pending = pendingRaw == null ? null : JSON.parse(pendingRaw) as {
    version?: number
    state?: string
    plan?: WorkspaceSelfCheckPlanV1
  }
  const pendingItems = new Map((pending?.plan?.items ?? []).map(item => [item.identity.documentId, item]))
  const recoverableInvalidIds = report.plan.items
    .filter(item => item.changeKind === 'invalid')
    .filter(item => {
      const planned = pendingItems.get(item.identity.documentId)
      return pending?.version === 1
        && pending.state === 'filesystem-pending'
        && pending.plan?.projectId === projectId
        && pending.plan.workspaceUid === report.plan.workspaceUid
        && planned?.databaseCanonicalHash === item.databaseCanonicalHash
        && ['project-changed', 'file-missing'].includes(planned?.changeKind ?? '')
    })
    .map(item => item.identity.documentId)
  assertProjectToFileSafe(report, new Set(), new Set(), new Set(recoverableInvalidIds))
  return synchronizeProjectChangesToFolderV1({
    projectId,
    root,
    expectedPlanHash: report.plan.planHash,
    approvedRecoveryDocumentIds: recoverableInvalidIds,
  })
}

export async function hashWorkspaceFileTextV1(value: string): Promise<string> {
  return sha256Text(normalizeLineEndings(value))
}

async function workspacePackageFromFilesV1(
  workspaceUid: string,
  inputFiles: readonly { relativePath: string; text: string }[],
): Promise<WorkspacePackageV1> {
  const files = [] as Array<{ relativePath: string; text: string; textHash: string }>
  let totalBytes = 0
  for (const { relativePath, text } of [...inputFiles].sort((left, right) => left.relativePath.localeCompare(right.relativePath))) {
    assertRelativePath(relativePath)
    const bytes = new TextEncoder().encode(text).byteLength
    if (bytes > WORKSPACE_PACKAGE_MAX_FILE_BYTES_V1) {
      throw new Error(`[memory-workspace] 单文件超过工作区包上限: ${relativePath}`)
    }
    totalBytes += bytes
    if (totalBytes > WORKSPACE_PACKAGE_MAX_TOTAL_BYTES_V1) {
      throw new Error('[memory-workspace] 工作区包超过总大小上限')
    }
    files.push({ relativePath, text, textHash: await hashWorkspaceFileTextV1(text) })
  }
  const body = {
    format: 'storyforge-workspace-package' as const,
    version: 1 as const,
    workspaceUid,
    files,
  }
  return { ...body, packageHash: await hashCanonicalValue(body) }
}

/** Manual package export path for browsers without File System Access API. */
export async function exportWorkspacePackageFromProjectV1(projectId: number): Promise<WorkspacePackageV1> {
  const documents = await buildWorkspaceProjectionV1(projectId)
  if (!documents.length) throw new Error('[memory-workspace] 没有可导出的工作区文档')
  const revision = Math.max(0, ...documents.map(document => document.binding.lastSyncRevision)) + 1
  const manifest = await buildManifest(documents, revision)
  const portableBindings = documents.map(document => ({
    version: 1,
    workspaceUid: document.binding.workspaceUid,
    documentId: document.binding.documentId,
    documentKind: document.binding.documentKind,
    tableName: document.binding.tableName,
    relativePath: document.binding.relativePath,
    worldCode: document.binding.worldCode ?? null,
    workCode: document.binding.workCode ?? null,
    schemaVersion: document.binding.schemaVersion,
    canonicalHash: document.canonicalHash,
  }))
  const files = new Map(documents.map(document => [document.binding.relativePath, document.text]))
  files.set('.storyforge/bindings.json', `${JSON.stringify(portableBindings, null, 2)}\n`)
  files.set('.storyforge/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`)
  return workspacePackageFromFilesV1(
    documents[0].identity.workspaceUid,
    [...files].map(([relativePath, text]) => ({ relativePath, text })),
  )
}

/** Build an explicit, self-verifying transport package from a clean workspace. */
export async function exportWorkspacePackageV1(
  projectId: number,
  root: FileSystemDirectoryHandle,
): Promise<WorkspacePackageV1> {
  const report = await buildWorkspaceSelfCheckReportV1(projectId, root)
  if (report.plan.items.some(item => item.changeKind !== 'clean')) {
    throw new Error('[memory-workspace] 导出工作区包前必须先完成核对同步')
  }
  const manifestRaw = await readTextAt(root, '.storyforge/manifest.json')
  const bindingsRaw = await readTextAt(root, '.storyforge/bindings.json')
  const recoveryRaw = await readTextAt(root, '.storyforge/recovery/project.json')
  const manifest = await readManifest(root)
  if (!manifestRaw || !bindingsRaw || !recoveryRaw || !manifest) {
    throw new Error('[memory-workspace] 工作区缺少 manifest、bindings 或恢复胶囊')
  }
  const paths = [...new Set([
    ...manifest.documents.map(entry => entry.relativePath),
    '.storyforge/manifest.json',
    '.storyforge/bindings.json',
    '.storyforge/recovery/project.json',
  ])].sort()
  const files = [] as Array<{ relativePath: string; text: string }>
  for (const relativePath of paths) {
    const text = await readTextAt(root, relativePath)
    if (text == null) throw new Error(`[memory-workspace] 工作区包文件缺失: ${relativePath}`)
    files.push({ relativePath, text })
  }
  return workspacePackageFromFilesV1(manifest.workspaceUid, files)
}

async function validateWorkspacePackageV1(input: unknown): Promise<WorkspacePackageV1> {
  if (!input || typeof input !== 'object') throw new Error('[memory-workspace] 工作区包不是对象')
  const pkg = input as WorkspacePackageV1
  if (pkg.format !== 'storyforge-workspace-package' || pkg.version !== 1 || !isWorkspaceUid(pkg.workspaceUid)
    || !Array.isArray(pkg.files) || !/^[a-f0-9]{64}$/.test(pkg.packageHash)) {
    throw new Error('[memory-workspace] 工作区包格式或身份无效')
  }
  const paths = new Set<string>()
  let totalBytes = 0
  for (const file of pkg.files) {
    assertRelativePath(file.relativePath)
    const bytes = new TextEncoder().encode(file.text).byteLength
    totalBytes += bytes
    if (paths.has(file.relativePath)
      || bytes > WORKSPACE_PACKAGE_MAX_FILE_BYTES_V1
      || totalBytes > WORKSPACE_PACKAGE_MAX_TOTAL_BYTES_V1
      || await hashWorkspaceFileTextV1(file.text) !== file.textHash) {
      throw new Error(`[memory-workspace] 工作区包文件重复、超限或 hash 错误: ${file.relativePath}`)
    }
    paths.add(file.relativePath)
  }
  const { packageHash, ...body } = pkg
  if (await hashCanonicalValue(body) !== packageHash) throw new Error('[memory-workspace] 工作区包完整性校验失败')
  return pkg
}

function packageDirectoryHandleV1(pkg: WorkspacePackageV1): FileSystemDirectoryHandle {
  const files = new Map(pkg.files.map(file => [file.relativePath, file.text]))
  const makeDirectory = (prefix: string): FileSystemDirectoryHandle => {
    const parts = prefix.split('/').filter(Boolean)
    return ({
    kind: 'directory',
    name: parts[parts.length - 1] ?? 'StoryForgeWorkspacePackage',
    async getDirectoryHandle(name: string) {
      const nextPrefix = `${prefix}${name}/`
      if (![...files.keys()].some(path => path.startsWith(nextPrefix))) {
        throw new DOMException('not found', 'NotFoundError')
      }
      return makeDirectory(nextPrefix)
    },
    async getFileHandle(name: string) {
      const path = `${prefix}${name}`
      const text = files.get(path)
      if (text == null) throw new DOMException('not found', 'NotFoundError')
      return {
        kind: 'file', name,
        async getFile() { return { async text() { return text } } as File },
      } as FileSystemFileHandle
    },
    } as FileSystemDirectoryHandle)
  }
  return makeDirectory('')
}

/** Validate and restore an explicit package without requiring FSA support. */
export async function importWorkspacePackageV1(
  input: unknown,
): Promise<{ projectId: number; report: WorkspaceSelfCheckReportV1 }> {
  const pkg = await validateWorkspacePackageV1(input)
  return restoreWorkspaceFromFolderV1(packageDirectoryHandleV1(pkg))
}
