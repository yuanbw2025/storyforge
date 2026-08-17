import type { Project } from '../types'
import { PROJECT_TABLES } from '../registry/project-tables'
import type { WorldDomainArea } from '../registry/types'

/**
 * 世界引擎当前阶段的兼容领域投影。
 *
 * 这是从现有 Project + 已登记业务表派生的只读视图，不是新的持久化根对象。
 * WORLD-2C 再把它迁移为显式 World/Work 关系前，旧 Project 仍是本地存储边界。
 */
export interface WorldProjection {
  kind: 'world'
  id: string
  projectId: number
  code: string
  version: number
  name: string
  description: string
  completeness: number
  readiness: 'empty' | 'building' | 'usable'
  domains: Record<WorldDomainArea, WorldDomainSummary>
  work: WorkProjection
  runtime: RuntimeProjection
}

export interface WorkProjection {
  kind: 'work'
  id: string
  projectId: number
  title: string
  sourceWorldId: string
  currentWordCount: number
}

export interface RuntimeProjection {
  instanceCount: number
  eventCount: number
  checkpointCount: number
}

export interface WorldDomainSummary {
  key: WorldDomainArea
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
  key: WorldDomainArea
  label: string
  description: string
  requiredTables: readonly string[]
}> = [
  {
    key: 'foundation',
    label: '世界基础 Canon',
    description: '规则、起源、自然、人文、空间、历史与能力体系。',
    requiredTables: ['worldviews', 'worldRulesProfiles'],
  },
  {
    key: 'assets',
    label: '世界资产',
    description: '角色、关系、地点、物品、词条和可复用实体。',
    requiredTables: ['characters'],
  },
  {
    key: 'narrative',
    label: '叙事设计',
    description: '故事核心、主线、支线、故事弧、大纲、细纲和伏笔。',
    requiredTables: ['storyCores', 'outlineNodes'],
  },
  {
    key: 'structure',
    label: '世界结构',
    description: '单世界区域、多位面、多世界和通道关系。',
    requiredTables: ['worldGroups'],
  },
  {
    key: 'runtime',
    label: '状态与实例',
    description: '事件、状态机、检查点和独立运行实例。',
    requiredTables: ['simulationSessions'],
  },
]

const COMPLETENESS_WEIGHTS: Readonly<Record<'foundation' | 'assets' | 'narrative', number>> = {
  foundation: 0.45,
  assets: 0.25,
  narrative: 0.3,
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function getProjectId(row: unknown): number | undefined {
  if (!row || typeof row !== 'object') return undefined
  const projectId = (row as { projectId?: unknown }).projectId
  return typeof projectId === 'number' ? projectId : undefined
}

function summarizeDomain(
  projectId: number,
  definition: (typeof DOMAIN_DEFINITIONS)[number],
  countsByProject: ReadonlyMap<number, ReadonlyMap<string, number>>,
): WorldDomainSummary {
  const specs = PROJECT_TABLES.filter(spec => spec.worldDomains?.includes(definition.key))
  const projectCounts = countsByProject.get(projectId)
  const tables = specs.map(spec => ({ name: spec.name, rowCount: projectCounts?.get(spec.name) ?? 0 }))
  const activeTableCount = tables.filter(table => table.rowCount > 0).length
  const coverage = specs.length === 0 ? 0 : clampPercent((activeTableCount / specs.length) * 100)
  const activeTableNames = new Set(tables.filter(table => table.rowCount > 0).map(table => table.name))
  const hasRequiredContent = definition.requiredTables.every(table => activeTableNames.has(table))
  const status = activeTableCount === 0
    ? 'empty'
    : hasRequiredContent
      ? 'ready'
      : 'partial'
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    tableCount: specs.length,
    activeTableCount,
    rowCount: tables.reduce((sum, table) => sum + table.rowCount, 0),
    coverage,
    status,
    tables,
  }
}

async function loadWorldDomainCounts(projectIds: ReadonlySet<number>): Promise<Map<number, Map<string, number>>> {
  const countsByProject = new Map<number, Map<string, number>>()
  for (const projectId of projectIds) countsByProject.set(projectId, new Map())
  if (projectIds.size === 0) return countsByProject

  const worldSpecs = PROJECT_TABLES.filter(spec => spec.worldDomains?.length)
  const uniqueSpecs = [...new Map(worldSpecs.map(spec => [spec.name, spec])).values()]
  const rowsByTable = await Promise.all(uniqueSpecs.map(async spec => ({
    name: spec.name,
    rows: await spec.table.toArray(),
  })))

  for (const { name, rows } of rowsByTable) {
    for (const row of rows) {
      const projectId = getProjectId(row)
      if (projectId == null || !projectIds.has(projectId)) continue
      const projectCounts = countsByProject.get(projectId)!
      projectCounts.set(name, (projectCounts.get(name) ?? 0) + 1)
    }
  }
  return countsByProject
}

function calculateCompleteness(domains: Record<WorldDomainArea, WorldDomainSummary>): number {
  return clampPercent(
    (domains.foundation.coverage * COMPLETENESS_WEIGHTS.foundation)
      + (domains.assets.coverage * COMPLETENESS_WEIGHTS.assets)
      + (domains.narrative.coverage * COMPLETENESS_WEIGHTS.narrative),
  )
}

function calculateReadiness(domains: Record<WorldDomainArea, WorldDomainSummary>): WorldProjection['readiness'] {
  if (domains.foundation.status === 'empty' && domains.narrative.status === 'empty') return 'empty'
  if (domains.foundation.status === 'ready' && domains.assets.status !== 'empty' && domains.narrative.status !== 'empty') return 'usable'
  return 'building'
}

function createWorldProjection(
  project: Project & { id: number },
  countsByProject: ReadonlyMap<number, ReadonlyMap<string, number>>,
): WorldProjection {
  const summaries = DOMAIN_DEFINITIONS.map(definition => summarizeDomain(project.id, definition, countsByProject))
  const domains = Object.fromEntries(summaries.map(summary => [summary.key, summary])) as Record<WorldDomainArea, WorldDomainSummary>
  const runtime = domains.runtime
  return {
    kind: 'world',
    id: `project:${project.id}`,
    projectId: project.id,
    code: project.worldCode ?? '待分配编号',
    version: project.worldVersion ?? 1,
    name: project.name,
    description: project.description || '这个世界还没有写下简介。',
    completeness: calculateCompleteness(domains),
    readiness: calculateReadiness(domains),
    domains,
    work: {
      kind: 'work',
      id: `project:${project.id}:work:default`,
      projectId: project.id,
      title: project.name,
      sourceWorldId: `project:${project.id}`,
      currentWordCount: project.currentWordCount ?? 0,
    },
    runtime: {
      instanceCount: runtime.tables.find(table => table.name === 'simulationSessions')?.rowCount ?? 0,
      eventCount: runtime.tables.find(table => table.name === 'simulationEvents')?.rowCount ?? 0,
      checkpointCount: runtime.tables.find(table => table.name === 'simulationCheckpoints')?.rowCount ?? 0,
    },
  }
}

/**
 * 从现有三注册表批量派生世界引擎首页需要的只读投影。
 * 每张登记表只扫描一次，世界库中的项目数量不会放大表扫描次数。
 */
export async function loadWorldProjections(projects: readonly Project[]): Promise<WorldProjection[]> {
  const persistedProjects = projects.map(project => {
    if (!project.id) throw new Error('世界投影需要有效的项目 ID。')
    return project as Project & { id: number }
  })
  const countsByProject = await loadWorldDomainCounts(new Set(persistedProjects.map(project => project.id)))
  return persistedProjects.map(project => createWorldProjection(project, countsByProject))
}

/** 从现有三注册表派生单个世界的兼容只读投影。 */
export async function loadWorldProjection(project: Project): Promise<WorldProjection> {
  return (await loadWorldProjections([project]))[0]
}
