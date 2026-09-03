import type { Transaction } from 'dexie'

type Row = Record<string, any>

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function mergeText(current: unknown, additions: readonly unknown[]): string {
  const blocks: string[] = []
  for (const value of [current, ...additions]) {
    const block = text(value)
    if (!block || blocks.some(existing => existing === block || existing.includes(block))) continue
    blocks.push(block)
  }
  return blocks.join('\n\n')
}

function sameWorld(left: Row, right: Row): boolean {
  return left.projectId === right.projectId
    && (left.worldGroupId ?? null) === (right.worldGroupId ?? null)
}

function scopedSeed(source: Row, now: number): Row {
  return {
    projectId: source.projectId,
    ...(source.worldId == null ? {} : { worldId: source.worldId }),
    worldGroupId: source.worldGroupId ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

function createLinearWorkflowGraph(steps: Row[]): Row {
  return {
    version: 1,
    nodes: steps.map((step, index) => ({
      stepId: String(step.stepId),
      x: 40 + (index % 4) * 348,
      y: 40 + Math.floor(index / 4) * 252,
    })),
    edges: steps.slice(1).map((step, index) => ({
      edgeId: `edge-${String(steps[index].stepId)}-${String(step.stepId)}`,
      sourceStepId: String(steps[index].stepId),
      targetStepId: String(step.stepId),
      targetVariable: text(step.inputMapping?.previousOutput) || 'worldContext',
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
  }
}

function migrateParsedContent(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const content = value as Row
  const worldview = content.worldview
  if (!worldview || typeof worldview !== 'object' || Array.isArray(worldview)) return
  const foundation = worldview as Row
  const geographyOverview = text(foundation.geography)
  const historyOverview = mergeText(content.history?.overview, [
    foundation.history,
    foundation.historyLine,
    foundation.worldEvents,
  ])
  if (geographyOverview) {
    content.geography = {
      ...(content.geography && typeof content.geography === 'object' ? content.geography : {}),
      overview: mergeText(content.geography?.overview, [geographyOverview]),
    }
  }
  if (historyOverview) content.history = { overview: historyOverview }
  foundation.politicsOverview = mergeText(foundation.politicsOverview, [
    foundation.society,
    foundation.politicsEconomyCulture,
  ])
  foundation.economyOverview = mergeText(foundation.economyOverview, [foundation.economy])
  foundation.cultureOverview = mergeText(foundation.cultureOverview, [foundation.culture])
  for (const field of [
    'geography', 'history', 'society', 'culture', 'economy', 'rules',
    'historyLine', 'worldEvents', 'politicsEconomyCulture',
  ]) delete foundation[field]
}

async function migrateReferenceAnalysisRuns(tx: Transaction, now: number): Promise<void> {
  const references = await tx.table('references').toArray() as Row[]
  const runs = await tx.table('referenceAnalysisRuns').toArray() as Row[]
  const chunks = await tx.table('referenceChunkAnalysis').toArray() as Row[]

  for (const reference of references) {
    if (reference.id == null || reference.analysisStatus !== 'done') continue
    if (runs.some(run => run.referenceId === reference.id)) continue
    const unattached = chunks.filter(chunk => (
      chunk.referenceId === reference.id && chunk.analysisRunId == null
    ))
    if (unattached.length === 0) continue
    const run = {
      projectId: reference.projectId,
      ...(reference.worldId == null ? {} : { worldId: reference.worldId }),
      ...(reference.workId == null ? {} : { workId: reference.workId }),
      referenceId: reference.id,
      version: 1,
      status: 'active',
      depth: reference.analysisDepth ?? 'quick',
      sourceFilename: reference.importedData?.sourceFilename ?? reference.title,
      fileHash: reference.fileHash ?? `migrated-reference-${reference.id}`,
      totalChars: reference.totalChars ?? 0,
      sourceKind: 'unknown',
      usageScope: 'analysis-only',
      rightsNote: '迁移时未找到来源授权声明，请作者重新确认。',
      rightsConfirmed: false,
      rightsDeclaredAt: now,
      expectedChunks: unattached.length,
      completedChunks: unattached.length,
      progress: 100,
      analysisSummary: reference.analysisSummary,
      mergedCharacters: reference.mergedCharacters,
      completedAt: now,
      activatedAt: now,
      createdAt: reference.createdAt ?? now,
      updatedAt: now,
    }
    const runId = await tx.table('referenceAnalysisRuns').add(run) as number
    runs.push({ ...run, id: runId })
    for (const chunk of unattached) {
      chunk.analysisRunId = runId
      await tx.table('referenceChunkAnalysis').put(chunk)
    }
  }
}

/**
 * v93 -> v94 canonical content cutover.
 *
 * The migration preserves author text while removing superseded storage
 * locations. After it completes, current code has one writable home for
 * geography, history, world rules, social overviews, story intent and node
 * workflow topology.
 */
export async function migrateCanonicalAuthoringContentV94(tx: Transaction): Promise<void> {
  const now = Date.now()
  await migrateReferenceAnalysisRuns(tx, now)
  const obsoleteCandidateIds = new Set<number>()
  for (const event of await tx.table('agentEvents').toArray() as Row[]) {
    if (event.kind !== 'candidate' || event.id == null) continue
    let payload: Row | null = null
    try {
      const parsed = JSON.parse(event.payload)
      payload = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
    } catch {
      payload = null
    }
    if (
      event.durableRunId == null
      || payload?.runId !== event.durableRunId
      || typeof payload?.runStepId !== 'string'
      || typeof payload?.candidateHash !== 'string'
    ) obsoleteCandidateIds.add(event.id)
  }
  if (obsoleteCandidateIds.size > 0) {
    await tx.table('agentEvents').bulkDelete([...obsoleteCandidateIds])
  }
  await tx.table('temporalFacts').toCollection().modify((row: Row) => {
    if (row.predicate === 'legacyState') row.predicate = 'migratedStateCard'
    if (row.sourceRecordTable === 'legacy-state-card') row.sourceRecordTable = 'migrated-state-card'
    if (typeof row.sourceQuote === 'string' && row.sourceQuote.startsWith('旧状态卡/')) {
      row.sourceQuote = `迁移状态卡/${row.sourceQuote.slice('旧状态卡/'.length)}`
    }
  })
  const worldviews = await tx.table('worldviews').toArray() as Row[]
  const geographies = await tx.table('geographies').toArray() as Row[]
  const histories = await tx.table('histories').toArray() as Row[]
  const rulesProfiles = await tx.table('worldRulesProfiles').toArray() as Row[]

  for (const worldview of worldviews) {
    const geographyText = text(worldview.geography)
    if (geographyText) {
      const existing = geographies.find(row => sameWorld(row, worldview))
      if (existing?.id != null) {
        const overview = mergeText(existing.overview, [geographyText])
        await tx.table('geographies').update(existing.id, { overview, updatedAt: now })
        existing.overview = overview
      } else {
        const row = {
          ...scopedSeed(worldview, now),
          overview: geographyText,
          locations: '[]',
          worldMapData: '',
        }
        const id = await tx.table('geographies').add(row) as number
        geographies.push({ ...row, id })
      }
    }

    const historyParts = [worldview.history, worldview.historyLine, worldview.worldEvents]
    const historyText = mergeText('', historyParts)
    if (historyText) {
      const existing = histories.find(row => sameWorld(row, worldview))
      if (existing?.id != null) {
        const overview = mergeText(existing.overview, historyParts)
        await tx.table('histories').update(existing.id, { overview, updatedAt: now })
        existing.overview = overview
      } else {
        const row = {
          ...scopedSeed(worldview, now),
          overview: historyText,
          eraSystem: '',
          events: '[]',
        }
        const id = await tx.table('histories').add(row) as number
        histories.push({ ...row, id })
      }
    }

    const rulesText = text(worldview.rules)
    if (rulesText) {
      const existing = rulesProfiles.find(row => sameWorld(row, worldview))
      if (existing?.id != null) {
        const globalNote = mergeText(existing.globalNote, [rulesText])
        await tx.table('worldRulesProfiles').update(existing.id, { globalNote, updatedAt: now })
        existing.globalNote = globalNote
      } else {
        const row = {
          ...scopedSeed(worldview, now),
          entries: {},
          customNodes: [],
          globalNote: rulesText,
        }
        const id = await tx.table('worldRulesProfiles').add(row) as number
        rulesProfiles.push({ ...row, id })
      }
    }

    worldview.politicsOverview = mergeText(worldview.politicsOverview, [
      worldview.society,
      worldview.politicsEconomyCulture,
    ])
    worldview.economyOverview = mergeText(worldview.economyOverview, [worldview.economy])
    worldview.cultureOverview = mergeText(worldview.cultureOverview, [worldview.culture])
    for (const field of [
      'geography', 'history', 'society', 'culture', 'economy', 'rules',
      'historyLine', 'worldEvents', 'politicsEconomyCulture',
    ]) delete worldview[field]
    worldview.updatedAt = now
    await tx.table('worldviews').put(worldview)
  }

  await tx.table('storyCores').toCollection().modify((row: Row) => {
    row.mainPlot = mergeText(row.mainPlot, [row.storyLines])
    delete row.storyLines
    row.updatedAt = now
  })

  await tx.table('promptWorkflows').toCollection().modify((row: Row) => {
    if (!row.graph && Array.isArray(row.steps)) {
      row.graph = createLinearWorkflowGraph(row.steps)
      row.updatedAt = now
    }
  })

  await tx.table('importSessions').toCollection().modify((row: Row) => {
    migrateParsedContent(row.merged)
  })

  await tx.table('references').toCollection().modify((row: Row) => {
    migrateParsedContent(row.importedData)
  })

  // 旧候选结果遵循已经删除的输出 schema；保留作者灵感碎片，要求按当前
  // Skill 重新生成候选，避免旧结构从草稿恢复入口重新进入正式写回。
  await tx.table('inspirationWorkspaces').toCollection().modify((row: Row) => {
    row.versions = '[]'
    row.updatedAt = now
  })
}
