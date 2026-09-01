import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { loadGameProductionWorldSourceCatalogV2 } from '../../src/lib/game-production/world-source'
import {
  generateTtrpgCampaignProposalCandidateV2,
  ttrpgCampaignDesignFromProposalCandidateV2,
} from '../../src/lib/ttrpg/campaign-proposal-harness'
import {
  createAuthorGuidedTtrpgCampaignDesignV2,
  parseTtrpgCampaignDesignV2,
} from '../../src/lib/ttrpg/campaign-proposal'
import { ensureWorkspaceOwnership } from '../../src/lib/world-engine/ownership'
import { createWorldRevision, publishWorldRevision } from '../../src/lib/world-engine/releases'

async function workspace() {
  const now = Date.now()
  const projectId = await db.projects.add({
    workspacePurpose: 'world-engine', workspacePurposeDecision: 'explicit',
    name: 'TTRPG 提案 Harness', genre: 'mystery', genres: ['mystery'], status: 'drafting',
    description: '', targetWordCount: 50_000, createdAt: now, updatedAt: now,
  } as never) as number
  const owned = await ensureWorkspaceOwnership(projectId)
  await db.characters.bulkAdd([
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      isCrossWorld: true, name: '林舟', role: 'protagonist', roleWeight: 'main',
      identity: '调查失踪信号的守灯人', createdAt: now, updatedAt: now,
    },
    {
      projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
      isCrossWorld: true, name: '潮汐学者', role: 'supporting', roleWeight: 'npc',
      identity: '掌握封锁记录的学者', createdAt: now, updatedAt: now,
    },
  ] as never[])
  await db.importantLocations.add({
    projectId, worldId: owned.scope.worldId, workId: owned.scope.workId,
    parentId: null, name: '雾港潮门', type: 'harbor', description: '潮门将在暴潮前封闭。',
    createdAt: now, updatedAt: now,
  } as never)
  const revision = await createWorldRevision({ scope: owned.scope, label: '冻结提案来源', selectedNarrativeModuleIds: [] })
  const release = await publishWorldRevision(revision.id!)
  return { ...owned, release }
}

function validOutput(requiredSourceRef: string) {
  const proposal = (key: string, structure: 'linear' | 'branching' | 'node-based' | 'sandbox', focus: string) => ({
    proposalKey: key, title: focus, pitch: `${focus}的独立玩法方向。`,
    background: `雾港封锁记录引发${focus}。`, coreConflict: `玩家必须解决${focus}并承担代价。`,
    structure, opening: `潮门关闭前，${focus}首先显现。`,
    frontConcepts: [`${focus}的对手推进六格 Clock`], secretConcepts: [`${focus}背后存在可交叉验证的隐情`],
    endingConcepts: [`阻止${focus}`, `接受${focus}的局部后果`], sourceRefs: [requiredSourceRef],
  })
  return JSON.stringify({ proposals: [
    proposal('proposal.evidence', 'node-based', '证据网络'),
    proposal('proposal.factions', 'branching', '阵营冲突'),
    proposal('proposal.crisis', 'sandbox', '升级危机'),
  ] })
}

describe('TTRPG-3M · durable campaign proposal Harness', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('只读冻结 WorldRelease，协议失败仅修复一次，产出三种有来源候选与终端运行证据', async () => {
    const owned = await workspace()
    const catalog = await loadGameProductionWorldSourceCatalogV2({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const requiredSourceRef = `world-reference:${catalog.worldReference.referenceHash}`
    let calls = 0
    const generated = await generateTtrpgCampaignProposalCandidateV2({
      scope: owned.scope, worldReleaseId: owned.release.id!,
      objective: '做一场以失踪信号为核心、调查多于战斗的短团。',
      seed: {
        title: '潮门失踪案', background: '暴潮前的雾港已经封锁。',
        coreConflict: '公开信号还是先救居民', opening: '守灯人收到失踪船队信号。', structure: 'node-based',
      },
      runAI: async () => {
        calls += 1
        return calls === 1 ? JSON.stringify({ proposals: [] }) : validOutput(requiredSourceRef)
      },
    })
    expect(calls).toBe(2)
    expect(generated.candidate).toMatchObject({
      worldReleaseId: owned.release.id, worldContentHash: owned.release.contentHash,
      repairApplied: true, modelCalls: [{ provider: 'test-adapter' }, { provider: 'test-adapter' }],
    })
    expect(generated.candidate.candidateHash).toMatch(/^[0-9a-f]{64}$/)
    expect(generated.candidate.proposals).toHaveLength(3)
    expect(new Set(generated.candidate.proposals.map(item => item.structure)).size).toBe(3)
    expect(generated.candidate.proposals.every(item => item.sourceRefs.includes(requiredSourceRef))).toBe(true)
    expect(generated.snapshot.projection.state).toBe('completed')
    expect(generated.snapshot.projection.terminalReceiptHash).toMatch(/^[0-9a-f]{64}$/)
    expect(await db.agentRuns.count()).toBe(1)
    expect(await db.agentRunCheckpoints.count()).toBeGreaterThan(0)

    const design = ttrpgCampaignDesignFromProposalCandidateV2(generated.candidate)
    expect(design).toMatchObject({
      origin: 'ai-candidate', sourceWorldContentHash: owned.release.contentHash,
      selection: { confirmed: false },
      candidateEvidence: { runId: generated.candidate.runId, candidateHash: generated.candidate.candidateHash },
    })
    design.selection.sectionSources.fronts = 'proposal.factions'
    design.selection.sectionSources.secrets = 'proposal.crisis'
    design.selection.lockedSections = ['fronts', 'secrets']
    design.selection.confirmed = true
    expect(parseTtrpgCampaignDesignV2(design).selection).toMatchObject({
      sectionSources: { fronts: 'proposal.factions', secrets: 'proposal.crisis' },
      lockedSections: ['fronts', 'secrets'], confirmed: true,
    })
  })

  it('只重生成指定分区，并由代码保留其它分区、锁定来源和作者说明', async () => {
    const owned = await workspace()
    const catalog = await loadGameProductionWorldSourceCatalogV2({ scope: owned.scope, worldReleaseId: owned.release.id! })
    const requiredSourceRef = `world-reference:${catalog.worldReference.referenceHash}`
    const prior = createAuthorGuidedTtrpgCampaignDesignV2({
      sourceWorldContentHash: owned.release.contentHash,
      title: '潮门失踪案', background: '作者冻结的旧背景', coreConflict: '作者冻结的旧冲突',
      opening: '作者冻结的旧开场', structure: 'node-based',
      sourceRefs: [requiredSourceRef],
    })
    prior.selection.sectionSources.fronts = 'proposal.faction-pressure'
    prior.selection.lockedSections = ['fronts']
    prior.selection.authorNotes = 'Front 已经审定，只改秘密。'
    prior.selection.confirmed = true
    const generated = await generateTtrpgCampaignProposalCandidateV2({
      scope: owned.scope, worldReleaseId: owned.release.id!,
      objective: '保留既有结构，只重新提出秘密。',
      seed: {
        title: '潮门失踪案', background: '作者冻结的旧背景', coreConflict: '作者冻结的旧冲突',
        opening: '作者冻结的旧开场', structure: 'node-based',
      },
      priorDesign: prior, regenerateSections: ['secrets'],
      runAI: async () => validOutput(requiredSourceRef),
    })
    expect(generated.candidate.regeneratedSections).toEqual(['secrets'])
    expect(generated.candidate.preservedSections).toEqual(['background', 'coreConflict', 'opening', 'fronts', 'endings'])
    expect(generated.design.selection).toMatchObject({
      lockedSections: ['fronts'], authorNotes: 'Front 已经审定，只改秘密。', confirmed: false,
    })
    generated.design.proposals.forEach((proposal, index) => {
      expect(proposal.background).toBe(prior.proposals[index].background)
      expect(proposal.frontConcepts).toEqual(prior.proposals[index].frontConcepts)
      expect(proposal.endingConcepts).toEqual(prior.proposals[index].endingConcepts)
      expect(proposal.secretConcepts).not.toEqual(prior.proposals[index].secretConcepts)
    })
    const frontDonor = generated.design.proposals.find(proposal => (
      proposal.proposalKey === generated.design.selection.sectionSources.fronts
    ))!
    expect(frontDonor.frontConcepts).toEqual(prior.proposals[1].frontConcepts)
  }, 10_000)
})
