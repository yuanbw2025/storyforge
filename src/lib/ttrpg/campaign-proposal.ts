import type {
  TtrpgCampaignContentV1,
  TtrpgCampaignDesignV2,
  TtrpgCampaignProposalSectionV2,
  TtrpgCampaignProposalV2,
} from '../types'
import { isSha256Hash } from '../product-production/hash'

const KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
export const TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2 = [
  'background', 'coreConflict', 'opening', 'fronts', 'secrets', 'endings',
] as const satisfies readonly TtrpgCampaignProposalSectionV2[]

function fail(message: string): never { throw new Error(`[ttrpg-campaign-proposal] ${message}`) }
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort(); const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} 字段不精确:${actual.join(',')}`)
}
function text(value: unknown, label: string, maximum = 10_000, allowEmpty = false): string {
  if (typeof value !== 'string') fail(`${label} 必须是字符串`)
  const parsed = value.trim().normalize('NFC')
  if ((!allowEmpty && !parsed) || parsed.length > maximum) fail(`${label} 为空或过长`)
  return parsed
}
function key(value: unknown, label: string): string {
  const parsed = text(value, label, 200)
  if (!KEY.test(parsed)) fail(`${label} 不是稳定 key`)
  return parsed
}
function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是 boolean`)
  return value
}
function texts(value: unknown, label: string, minimum = 0, maximum = 20): string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) fail(`${label} 数量无效`)
  const parsed = value.map((item, index) => text(item, `${label}[${index}]`, 2_000))
  if (new Set(parsed).size !== parsed.length) fail(`${label} 不允许重复`)
  return parsed
}

function parseProposal(value: unknown, index: number): TtrpgCampaignProposalV2 {
  const row = record(value, `proposals[${index}]`)
  exact(row, [
    'proposalKey', 'title', 'pitch', 'background', 'coreConflict', 'structure', 'opening',
    'frontConcepts', 'secretConcepts', 'endingConcepts', 'sourceRefs',
  ], `proposals[${index}]`)
  const structure = text(row.structure, 'proposal.structure', 40)
  if (!['linear', 'branching', 'node-based', 'sandbox'].includes(structure)) fail('proposal.structure 枚举无效')
  const sourceRefs = texts(row.sourceRefs, 'proposal.sourceRefs', 1, 100)
  sourceRefs.forEach((source, sourceIndex) => key(source, `proposal.sourceRefs[${sourceIndex}]`))
  return {
    proposalKey: key(row.proposalKey, 'proposal.proposalKey'),
    title: text(row.title, 'proposal.title', 300), pitch: text(row.pitch, 'proposal.pitch', 2_000),
    background: text(row.background, 'proposal.background'), coreConflict: text(row.coreConflict, 'proposal.coreConflict'),
    structure: structure as TtrpgCampaignProposalV2['structure'], opening: text(row.opening, 'proposal.opening'),
    frontConcepts: texts(row.frontConcepts, 'proposal.frontConcepts', 1, 8),
    secretConcepts: texts(row.secretConcepts, 'proposal.secretConcepts', 1, 12),
    endingConcepts: texts(row.endingConcepts, 'proposal.endingConcepts', 2, 8), sourceRefs,
  }
}

export function parseTtrpgCampaignDesignV2(value: unknown): TtrpgCampaignDesignV2 {
  const row = record(value, 'campaignDesign')
  exact(row, ['schema', 'version', 'origin', 'sourceWorldContentHash', 'proposals', 'selection', 'candidateEvidence'], 'campaignDesign')
  if (row.schema !== 'storyforge.ttrpg-campaign-design' || row.version !== 2) fail('schema/version 无效')
  const origin = text(row.origin, 'origin', 40)
  if (!['author-guided', 'ai-candidate'].includes(origin)) fail('origin 无效')
  if (!isSha256Hash(row.sourceWorldContentHash)) fail('sourceWorldContentHash 无效')
  if (!Array.isArray(row.proposals) || row.proposals.length < 2 || row.proposals.length > 3) fail('必须有 2～3 个战役提案')
  const proposals = row.proposals.map(parseProposal)
  const proposalKeys = proposals.map(proposal => proposal.proposalKey)
  if (new Set(proposalKeys).size !== proposalKeys.length) fail('proposalKey 重复')
  const selection = record(row.selection, 'selection')
  exact(selection, ['baseProposalKey', 'sectionSources', 'lockedSections', 'authorNotes', 'confirmed'], 'selection')
  const baseProposalKey = key(selection.baseProposalKey, 'selection.baseProposalKey')
  if (!proposalKeys.includes(baseProposalKey)) fail('baseProposalKey 不属于提案集')
  const sectionSourcesRow = record(selection.sectionSources, 'selection.sectionSources')
  exact(sectionSourcesRow, TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2, 'selection.sectionSources')
  const sectionSources = Object.fromEntries(TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2.map(section => {
    const proposalKey = key(sectionSourcesRow[section], `selection.sectionSources.${section}`)
    if (!proposalKeys.includes(proposalKey)) fail(`sectionSources.${section} 不属于提案集`)
    return [section, proposalKey]
  })) as Record<TtrpgCampaignProposalSectionV2, string>
  const lockedSections = texts(selection.lockedSections, 'selection.lockedSections', 0, TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2.length)
    .map(section => {
      if (!TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2.includes(section as TtrpgCampaignProposalSectionV2)) fail(`未知锁定分区:${section}`)
      return section as TtrpgCampaignProposalSectionV2
    })
  let candidateEvidence: TtrpgCampaignDesignV2['candidateEvidence'] = null
  if (row.candidateEvidence != null) {
    const evidence = record(row.candidateEvidence, 'candidateEvidence')
    exact(evidence, ['runId', 'candidateHash', 'contextManifestHash'], 'candidateEvidence')
    if (!Number.isInteger(evidence.runId) || Number(evidence.runId) < 1
      || !isSha256Hash(evidence.candidateHash) || !isSha256Hash(evidence.contextManifestHash)) fail('candidateEvidence 无效')
    candidateEvidence = { runId: Number(evidence.runId), candidateHash: String(evidence.candidateHash), contextManifestHash: String(evidence.contextManifestHash) }
  }
  if ((origin === 'ai-candidate') !== (candidateEvidence != null)) fail('AI 提案与 durable candidate evidence 不闭合')
  return {
    schema: 'storyforge.ttrpg-campaign-design', version: 2,
    origin: origin as TtrpgCampaignDesignV2['origin'], sourceWorldContentHash: String(row.sourceWorldContentHash),
    proposals, selection: {
      baseProposalKey, sectionSources, lockedSections,
      authorNotes: text(selection.authorNotes, 'selection.authorNotes', 4_000, true),
      confirmed: bool(selection.confirmed, 'selection.confirmed'),
    },
    candidateEvidence,
  }
}

export interface ResolvedTtrpgCampaignDesignV2 {
  background: string
  coreConflict: string
  opening: string
  frontConcepts: string[]
  secretConcepts: string[]
  endingConcepts: string[]
  lockedSections: TtrpgCampaignProposalSectionV2[]
}

export function resolveTtrpgCampaignDesignV2(value: TtrpgCampaignDesignV2 | unknown): ResolvedTtrpgCampaignDesignV2 {
  const design = parseTtrpgCampaignDesignV2(value)
  const donor = (section: TtrpgCampaignProposalSectionV2) => (
    design.proposals.find(proposal => proposal.proposalKey === design.selection.sectionSources[section]) ?? fail(`分区来源缺失:${section}`)
  )
  return {
    background: donor('background').background,
    coreConflict: donor('coreConflict').coreConflict,
    opening: donor('opening').opening,
    frontConcepts: [...donor('fronts').frontConcepts],
    secretConcepts: [...donor('secrets').secretConcepts],
    endingConcepts: [...donor('endings').endingConcepts],
    lockedSections: [...design.selection.lockedSections],
  }
}

export function createAuthorGuidedTtrpgCampaignDesignV2(input: {
  sourceWorldContentHash: string
  title: string
  background: string
  coreConflict: string
  opening: string
  structure: TtrpgCampaignProposalV2['structure']
  sourceRefs: string[]
}): TtrpgCampaignDesignV2 {
  if (!isSha256Hash(input.sourceWorldContentHash)) fail('世界 hash 无效')
  const sourceRefs = [...new Set(input.sourceRefs.length ? input.sourceRefs : [`world:${input.sourceWorldContentHash}`])]
  const proposals: TtrpgCampaignProposalV2[] = [
    {
      proposalKey: 'proposal.evidence-web', title: `${input.title} · 证据网`,
      pitch: '从多条可失败前进的调查路径拼出真相，再决定公开、交换或保护。',
      background: input.background, coreConflict: input.coreConflict, structure: 'node-based',
      opening: input.opening,
      frontConcepts: [`掌握关键证据的一方试图抢先定义“${input.coreConflict}”`, '时间与资源压力迫使队伍在查证和行动之间取舍'],
      secretConcepts: ['公开事实背后还存在一个改变动机判断的隐情', '一名关键人物只掌握局部真相且会保护自己的利益'],
      endingConcepts: ['公开完整真相并承担后果', '以部分真相换取眼前保护'], sourceRefs,
    },
    {
      proposalKey: 'proposal.faction-pressure', title: `${input.title} · 阵营压力`,
      pitch: '把核心冲突拆成多个目标相斥的 Front，让关系、声望和承诺决定终局。',
      background: `${input.background} 各方已经围绕这一局势形成互不兼容的利益。`,
      coreConflict: `谁有权决定并承担“${input.coreConflict}”的结果`, structure: 'branching',
      opening: `${input.opening}；第一位来访者要求队伍立刻选边。`,
      frontConcepts: ['强势阵营扩大控制并吸纳中立者', '弱势阵营以秘密和人情争取生存空间'],
      secretConcepts: ['两个公开敌对阵营曾有一项未履行的共同承诺', '看似中立的见证者正在等待最有利的揭示时机'],
      endingConcepts: ['重建一份代价明确的新协议', '拒绝所有阵营并开辟危险的第三条道路'], sourceRefs,
    },
    {
      proposalKey: 'proposal.escalating-crisis', title: `${input.title} · 升级危机`,
      pitch: '以可见与隐藏 Clock 推动局势，即使行动失败也产生新场景、代价与机会。',
      background: `${input.background} 一个正在升级的危机让既有矛盾无法继续搁置。`,
      coreConflict: `${input.coreConflict}，同时必须阻止不可逆的局势升级`, structure: input.structure,
      opening: `${input.opening}；第一个危险 Clock 已经推进一格。`,
      frontConcepts: ['直接威胁沿着六格 Clock 逐步兑现后果', '幕后推动者利用每次撤退和失败扩大优势'],
      secretConcepts: ['危机并非自然发生，而是某个目标的副产品', '完成 Clock 不等于团灭，而会永久改变下一阶段局势'],
      endingConcepts: ['及时阻止危机并保留调查成果', '接受局部灾变以换取更重要的人或真相'], sourceRefs,
    },
  ]
  const baseProposalKey = proposals[0].proposalKey
  return parseTtrpgCampaignDesignV2({
    schema: 'storyforge.ttrpg-campaign-design', version: 2, origin: 'author-guided',
    sourceWorldContentHash: input.sourceWorldContentHash, proposals,
    selection: {
      baseProposalKey,
      sectionSources: Object.fromEntries(TTRPG_CAMPAIGN_PROPOSAL_SECTIONS_V2.map(section => [section, baseProposalKey])),
      lockedSections: [], authorNotes: '', confirmed: false,
    },
    candidateEvidence: null,
  })
}

/** Proves that later compilation did not silently rewrite any author-locked proposal section. */
export function validateTtrpgCampaignDesignLocksV2(input: {
  design: TtrpgCampaignDesignV2 | unknown
  campaign: TtrpgCampaignContentV1
}): string[] {
  const design = parseTtrpgCampaignDesignV2(input.design)
  const resolved = resolveTtrpgCampaignDesignV2(design)
  const locked = new Set(design.selection.lockedSections)
  const errors: string[] = []
  if (locked.has('background') && input.campaign.bible?.background !== resolved.background) errors.push('锁定 background 被改写')
  if (locked.has('coreConflict') && input.campaign.bible?.coreConflict !== resolved.coreConflict) errors.push('锁定 coreConflict 被改写')
  const opening = input.campaign.scenes.find(scene => scene.sceneKey === input.campaign.openingSceneKey)
  if (locked.has('opening') && !opening?.description.includes(resolved.opening)) errors.push('锁定 opening 被改写')
  const frontText = (input.campaign.fronts ?? []).flatMap(front => [front.goal, ...front.escalation, ...front.defeatConditions])
  if (locked.has('fronts')) {
    for (const concept of resolved.frontConcepts) if (!frontText.some(value => value.includes(concept))) errors.push(`锁定 Front 未落地:${concept}`)
  }
  const secretText = (input.campaign.secrets ?? []).flatMap(secret => [secret.truth, secret.revealRule])
  if (locked.has('secrets')) {
    for (const concept of resolved.secretConcepts) if (!secretText.some(value => value.includes(concept))) errors.push(`锁定 Secret 未落地:${concept}`)
  }
  const endingText = input.campaign.endings.flatMap(ending => [ending.title, ending.epilogue])
  if (locked.has('endings')) {
    for (const concept of resolved.endingConcepts) if (!endingText.some(value => value.includes(concept))) errors.push(`锁定 Ending 未落地:${concept}`)
  }
  return errors
}
