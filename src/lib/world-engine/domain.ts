import { db } from '../db/schema'
import { isShareableWorld } from '../product/world-identity'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { WorldCapabilityArea } from '../registry/types'
import type { Project, Work, World, WorkspaceScope } from '../types'
import { assertRecordInScope } from './scope'

/** ARCH-07A: semantic-only capability projection for one explicit world draft. */
export interface WorldProjection {
  kind: 'world'
  id: string
  projectId: number
  worldId: number
  code: string
  version: number
  name: string
  description: string
  completeness: number
  readiness: 'empty' | 'building' | 'usable'
  domains: Record<WorldCapabilityArea, WorldDomainSummary>
  work: WorkProjection
}

export interface WorkProjection {
  kind: 'work'
  id: string
  projectId: number
  title: string
  sourceWorldId: string
  currentWordCount: number
}

export interface WorldDomainSummary {
  key: WorldCapabilityArea
  label: string
  description: string
  tableCount: number
  activeTableCount: number
  rowCount: number
  coverage: number
  status: 'empty' | 'partial' | 'ready'
  tables: WorldTableSummary[]
}

export interface WorldTableSummary {
  name: string
  rowCount: number
}

const DOMAIN_DEFINITIONS: ReadonlyArray<{
  key: WorldCapabilityArea
  label: string
  description: string
  requiredTables: readonly string[]
}> = [
  { key: 'foundation', label: '世界基础', description: '自然、人文、历史、规则和力量体系。', requiredTables: ['worldviews'] },
  { key: 'story', label: '故事语义', description: '故事核心、年表、事实、伏笔与演化证据。', requiredTables: ['storyCores'] },
  { key: 'characters', label: '角色', description: '角色身份、状态和人物设定。', requiredTables: ['characters'] },
  { key: 'relations', label: '关系与认知', description: '角色关系及已确认的角色认知。', requiredTables: [] },
  { key: 'entities', label: '实体与地点', description: '地点、物品、组织、词条和空间节点。', requiredTables: [] },
  { key: 'storylines', label: '主线与支线', description: '故事线、推进状态和交汇关系。', requiredTables: ['storyArcs'] },
  { key: 'outline', label: '大纲', description: '卷纲、章纲和稳定叙事结构。', requiredTables: ['outlineNodes'] },
  { key: 'detailed-outline', label: '细纲', description: '场景级细纲、人物出场与伏笔绑定。', requiredTables: ['detailedOutlines'] },
  { key: 'manuscript', label: '正文', description: '作者确认的章节与正文原文。', requiredTables: ['chapters'] },
  { key: 'multi-world', label: '多世界关系', description: '子世界、位面和显式通道规则。', requiredTables: [] },
]

const COMPLETENESS_WEIGHTS: Readonly<Record<WorldCapabilityArea, number>> = {
  foundation: 0.2,
  story: 0.15,
  characters: 0.15,
  relations: 0.05,
  entities: 0.1,
  storylines: 0.1,
  outline: 0.1,
  'detailed-outline': 0.05,
  manuscript: 0.1,
  'multi-world': 0,
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getProjectId(row: unknown): number | undefined {
  if (!row || typeof row !== 'object') return undefined
  const projectId = (row as { projectId?: unknown }).projectId
  return typeof projectId === 'number' ? projectId : undefined
}

function scopeKey(scope: WorkspaceScope): string {
  return `${scope.projectId}:${scope.worldId}:${scope.workId}`
}

function summarizeDomain(
  scope: WorkspaceScope,
  definition: (typeof DOMAIN_DEFINITIONS)[number],
  countsByScope: ReadonlyMap<string, ReadonlyMap<string, number>>,
): WorldDomainSummary {
  const specs = PROJECT_TABLES.filter(spec => spec.worldSemantic?.area === definition.key)
  const scopeCounts = countsByScope.get(scopeKey(scope))
  const tables = specs.map(spec => ({ name: spec.name, rowCount: scopeCounts?.get(spec.name) ?? 0 }))
  const activeTableCount = tables.filter(table => table.rowCount > 0).length
  const coverage = specs.length === 0 ? 0 : clampPercent((activeTableCount / specs.length) * 100)
  const activeTableNames = new Set(tables.filter(table => table.rowCount > 0).map(table => table.name))
  const hasRequiredContent = definition.requiredTables.length === 0
    ? activeTableCount > 0
    : definition.requiredTables.every(table => activeTableNames.has(table))
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    tableCount: specs.length,
    activeTableCount,
    rowCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
    coverage,
    status: activeTableCount === 0 ? 'empty' : hasRequiredContent ? 'ready' : 'partial',
    tables,
  }
}

async function loadWorldDomainCounts(scopes: readonly WorkspaceScope[]): Promise<Map<string, Map<string, number>>> {
  const countsByScope = new Map<string, Map<string, number>>()
  const scopesByProject = new Map<number, WorkspaceScope[]>()
  for (const scope of scopes) {
    countsByScope.set(scopeKey(scope), new Map())
    const projectScopes = scopesByProject.get(scope.projectId) ?? []
    projectScopes.push(scope)
    scopesByProject.set(scope.projectId, projectScopes)
  }
  if (scopes.length === 0) return countsByScope
  const specs = PROJECT_TABLES.filter(spec => spec.worldSemantic)
  const rowsByTable = await Promise.all(specs.map(async spec => ({ spec, rows: await spec.table.toArray() })))
  for (const { spec, rows } of rowsByTable) {
    for (const row of rows) {
      const projectId = getProjectId(row)
      const candidateScopes = projectId == null ? undefined : scopesByProject.get(projectId)
      if (!candidateScopes?.length) continue
      const matches = await Promise.all(candidateScopes.map(scope => assertRecordInScope(scope, spec.name, row)))
      for (let index = 0; index < candidateScopes.length; index += 1) {
        if (!matches[index]) continue
        const counts = countsByScope.get(scopeKey(candidateScopes[index]))!
        counts.set(spec.name, (counts.get(spec.name) ?? 0) + 1)
      }
    }
  }
  return countsByScope
}

function calculateCompleteness(domains: Record<WorldCapabilityArea, WorldDomainSummary>): number {
  return clampPercent(Object.entries(COMPLETENESS_WEIGHTS).reduce(
    (sum, [area, weight]) => sum + domains[area as WorldCapabilityArea].coverage * weight,
    0,
  ))
}

function calculateReadiness(domains: Record<WorldCapabilityArea, WorldDomainSummary>): WorldProjection['readiness'] {
  if (domains.foundation.status === 'empty'
    && domains.story.status === 'empty'
    && domains.characters.status === 'empty') return 'empty'
  if (domains.foundation.status !== 'empty'
    && (domains.story.status !== 'empty' || domains.characters.status !== 'empty')) return 'usable'
  return 'building'
}

function createWorldProjection(
  project: Project & { id: number },
  world: World & { id: number },
  work: Work & { id: number },
  countsByScope: ReadonlyMap<string, ReadonlyMap<string, number>>,
): WorldProjection {
  const scope = { projectId: project.id, worldId: world.id, workId: work.id }
  const summaries = DOMAIN_DEFINITIONS.map(definition => summarizeDomain(scope, definition, countsByScope))
  const domains = Object.fromEntries(summaries.map(summary => [summary.key, summary])) as Record<WorldCapabilityArea, WorldDomainSummary>
  return {
    kind: 'world',
    id: `world:${world.id}`,
    projectId: project.id,
    worldId: world.id,
    code: world.code,
    version: world.currentVersion,
    name: world.name,
    description: world.description || '这个世界还没有写下简介。',
    completeness: calculateCompleteness(domains),
    readiness: calculateReadiness(domains),
    domains,
    work: {
      kind: 'work',
      id: `project:${project.id}:work:${work.id}`,
      projectId: project.id,
      title: work.title,
      sourceWorldId: `world:${world.id}`,
      currentWordCount: work.currentWordCount ?? project.currentWordCount ?? 0,
    },
  }
}

/** Only explicitly classified world-draft roots enter the catalog. */
export async function loadWorldProjections(projects: readonly Project[]): Promise<WorldProjection[]> {
  const persisted = projects.map(project => {
    if (!project.id) throw new Error('世界投影需要有效的项目 ID。')
    return project as Project & { id: number }
  })
  const roots = await Promise.all(persisted.map(async project => {
    if (project.activeWorldId == null || project.activeWorkId == null) return null
    const [world, work] = await Promise.all([
      db.worlds.get(project.activeWorldId),
      db.works.get(project.activeWorkId),
    ])
    return world && work
      && world.projectId === project.id
      && work.projectId === project.id
      && work.worldId === world.id
      && isShareableWorld(world)
      ? {
          project,
          world: world as World & { id: number },
          work: work as Work & { id: number },
        }
      : null
  }))
  const visible = roots.filter((row): row is NonNullable<typeof row> => row != null)
  const counts = await loadWorldDomainCounts(visible.map(({ project, world, work }) => ({
    projectId: project.id,
    worldId: world.id,
    workId: work.id,
  })))
  return visible.map(({ project, world, work }) => createWorldProjection(project, world, work, counts))
}

export async function loadWorldProjection(project: Project): Promise<WorldProjection> {
  const projection = (await loadWorldProjections([project]))[0]
  if (!projection) throw new Error('该工作区没有经作者确认的世界身份。')
  return projection
}
