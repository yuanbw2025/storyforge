export type Sfqa089UsageCaseV1 = 'direct' | 'edited' | 'ignored' | 'repair' | 'manual' | 'rejected'

const synthesis = JSON.stringify({
  suggestedTitle: '潮汐边界',
  understandingSummary: '作者希望以受保护的顺序主线承载成长，并用地区故事填充探索。',
  playerFantasy: '成为能够穿行多地、逐步揭开核心冲突的冒险者。',
  experiencePromise: '清晰主线与丰富但有边界的地区冒险并行。',
  primaryConflict: '长期目标与持续变化的地区问题互相牵引。',
  recommendedOpening: '从港区的失踪调查开始第一项明确任务。',
  protagonistFit: '作者设定的主角需要拥有进入调查和持续成长的动机。',
  experiencePillars: ['长期主线成长', '地区故事探索'],
  sourceUsePlan: ['只把已给来源摘要作为定位，正文留待正式冻结阶段读取。'],
  unresolvedQuestions: [], assumptions: ['首版使用标准难度。'], risks: ['没有足够的具体人物事实。'],
})

export function sfqa089UsagePlanV1(kind: Sfqa089UsageCaseV1) {
  if (kind === 'manual') return { responses: [], input: 0, output: 0, knownCost: true }
  if (kind === 'repair') return { responses: [
    { content: synthesis, input: 120, output: 21 },
    { content: '无效 JSON', input: 130, output: 22 },
    { content: synthesis, input: 140, output: 23 },
  ], input: 390, output: 66, knownCost: true }
  if (kind === 'rejected') return { responses: [
    { content: '仍然不是 JSON', input: 81, output: 11 },
    { content: '第二次也不是 JSON', input: 70, output: 12 },
  ], input: 151, output: 23, knownCost: false }
  return { responses: [{ content: synthesis, input: 113, output: 17 }],
    input: 113, output: 17, knownCost: kind !== 'ignored' }
}

export async function readSfqa089UsageFootprintV1() {
  const [{ db }, { hashCanonicalValue }] = await Promise.all([
    import('../../src/lib/db/schema'), import('../../src/lib/agent/run/hash'),
  ])
  const rows = await Promise.all([db.agentRuns.toArray(), db.agentRunEvents.toArray(),
    db.agentRunArtifacts.toArray(), db.agentEvents.toArray(), db.aiUsageLog.toArray(),
    db.productProductionBriefs.toArray(), db.productBuilds.toArray(), db.productProductionCommands.toArray()])
  return { hash: await hashCanonicalValue(rows), counts: rows.map(items => items.length) }
}

/** Uses the public generation/confirmation path. The browser test intercepts
 * only the declared synthetic HTTP endpoint, not any durable writer or reader. */
export async function seedSfqa089UsageCaseV1(kind: Sfqa089UsageCaseV1) {
  const [{ db }, briefApi, { inspectTextOpenWorldCreatorWorldSourceV1 },
    { useAIConfigStore }, { seedCurrentProductWorld }] = await Promise.all([
    import('../../src/lib/db/schema'), import('../../src/lib/open-world/creator-brief'),
    import('../../src/lib/open-world/creator-source'), import('../../src/stores/ai-config'),
    import('./current-product-world'),
  ])
  if (await db.projects.count()) throw new Error('SFQA089 requires an empty isolated browser database')
  const config = { provider: 'openai' as const, apiKey: 'synthetic-sfqa089-fixture-only', model: 'gpt-4o-mini',
    baseUrl: 'https://sfqa089-fixture.invalid/v1', maxTokens: 2000, contextWindow: 128000, temperature: 0.2 }
  useAIConfigStore.setState({ presets: [], taskRoutes: {} })
  useAIConfigStore.getState().setRememberApiKey(false)
  useAIConfigStore.getState().setConfig(config)
  const owned = await seedCurrentProductWorld(`089 native ${kind}`)
  const preview = await inspectTextOpenWorldCreatorWorldSourceV1({ scope: owned.scope,
    localReleaseRecordId: owned.release.id!, expectedReleaseHash: owned.release.contentHash })
  const begun = await briefApi.startTextOpenWorldCreatorBriefSessionV1({
    selection: { sourceKind: 'world-release', sourceScope: owned.scope,
      localReleaseRecordId: owned.release.id!, expectedReleaseHash: owned.release.contentHash, preview },
    sessionKey: 'primary',
  })
  let selected = begun
  let draft = begun.draft
  if (kind === 'rejected') {
    let rejected = false
    try { await briefApi.generateTextOpenWorldCreatorBriefCandidateV1({ session: begun, draft, aiConfig: config }) }
    catch { rejected = true }
    if (!rejected) throw new Error('SFQA089 invalid responses unexpectedly produced a candidate')
  } else if (kind !== 'manual') {
    const suggested = await briefApi.generateTextOpenWorldCreatorBriefCandidateV1({ session: begun, draft,
      aiConfig: kind === 'ignored' ? { ...config, model: 'synthetic-unknown-price-model' } : config })
    if (kind !== 'ignored') {
      selected = kind === 'repair'
        ? await briefApi.generateTextOpenWorldCreatorBriefCandidateV1({ session: suggested, draft: suggested.draft,
            followUp: '增加明确的盐港开场。', aiConfig: config }) : suggested
      draft = kind === 'direct' ? selected.draft
        : { ...briefApi.applyTextOpenWorldCreatorBriefSynthesisV1(selected.draft, selected.candidate!.synthesis),
            gameTitle: `潮汐边界：作者修订 ${kind}` }
    }
  }
  const confirmed = await briefApi.confirmTextOpenWorldCreatorBriefV1({ session: selected, draft,
    acknowledgements: { sourceIdentityReviewed: true, productBoundaryReviewed: true,
      unresolvedItemsClosed: true, directPublishWorkflowReviewed: true } })
  return { scope: confirmed.scope, productionId: confirmed.production.id, briefHash: confirmed.confirmedBrief!.briefHash,
    confirmedOrigin: confirmed.confirmedBrief!.candidateEvidence.origin, before: await readSfqa089UsageFootprintV1() }
}
