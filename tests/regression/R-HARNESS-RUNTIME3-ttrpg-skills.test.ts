import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import {
  completeTtrpgSessionZero,
  openTtrpgCampaignScene,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
  resolveTtrpgRuleAction,
} from '../../src/lib/ttrpg/runtime-api'
import { createDeterministicGmSynthesisFrameV2 } from '../../src/lib/ttrpg/action-feedback'
import {
  adoptTtrpgGmActorActionCandidateV1,
  generateTtrpgGmActorActionCandidateV1,
} from '../../src/lib/ttrpg/gm-actor-harness'
import {
  adoptTtrpgGmNarrationCandidateV1,
  evaluateTtrpgGmCandidateOutputV1,
  generateTtrpgGmNarrationCandidateV1,
} from '../../src/lib/ttrpg/gm-harness'
import { loadTtrpgGmRuntimeViewV1 } from '../../src/lib/ttrpg/gm-context'
import {
  configureTtrpgSessionParticipantV2,
  readTtrpgSessionParticipantsV2,
} from '../../src/lib/ttrpg/participants'
import {
  adoptTtrpgPlayerActionCandidateV1,
  generateTtrpgPlayerActionCandidateV1,
} from '../../src/lib/ttrpg/player-harness'
import { loadTtrpgPlayerRuntimeViewV1 } from '../../src/lib/ttrpg/player-context'
import type {
  ProductRuntimePackageV1,
  ProductRuntimeSession,
  WorkspaceScope,
  WorldRelease,
} from '../../src/lib/types'
import { seedCurrentProductBuild } from '../helpers/current-product-build'
import {
  loadCurrentProductWorldSourceCatalogV1,
  seedCurrentProductWorld,
} from '../helpers/current-product-world'
import { createCurrentTtrpgRuntimePackageFixture } from '../helpers/current-ttrpg-runtime-package'

interface TtrpgFixture {
  scope: WorkspaceScope
  release: WorldRelease & { id: number }
  session: ProductRuntimeSession & { id: number }
  runtimePackage: ProductRuntimePackageV1
}

async function readyFixture(input: {
  title: string
  playerController: 'human' | 'ai'
  gmMode: 'human' | 'ai'
}): Promise<TtrpgFixture> {
  const world = await seedCurrentProductWorld(input.title)
  const release = world.release as WorldRelease & { id: number }
  const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
    scope: world.scope,
    worldReleaseId: release.id,
    productType: 'ttrpg',
  })
  const runtimePackage = await createCurrentTtrpgRuntimePackageFixture({
    scope: world.scope,
    worldRelease: release,
    sourceCatalog,
    playerController: input.playerController,
    gmMode: input.gmMode,
  })
  const created = await seedCurrentProductBuild({
    scope: world.scope,
    worldRelease: release,
    runtimePackage,
    title: input.title,
  })
  const session = created.session as ProductRuntimeSession & { id: number }
  const participants = await readTtrpgSessionParticipantsV2(session.id)
  for (const participant of participants) {
    await configureTtrpgSessionParticipantV2({
      sessionId: session.id,
      seatKey: participant.seatKey,
      expectedRevision: participant.revision,
      commandId: `current.disclose.${participant.seatKey}`,
      requestedByViewerKey: 'viewer.gm',
      consent: { aiIdentityDisclosed: true },
    })
  }
  const initial = await readProductRuntimeState(session.id)
  let version = await readProductRuntimeStateVersion(session.id)
  await completeTtrpgSessionZero({
    sessionId: session.id,
    commandId: 'current.session-zero',
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    acceptedItemKeys: initial.ttrpg!.product!.sessionZero.requiredItemKeys,
    completedBy: 'gm',
  })
  version = await readProductRuntimeStateVersion(session.id)
  await openTtrpgCampaignScene({
    sessionId: session.id,
    commandId: 'current.opening',
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    sceneKey: initial.ttrpg!.product!.openingSceneKey,
  })
  return { scope: world.scope, release, session, runtimePackage }
}

async function resolveActiveManually(fixture: TtrpgFixture, commandId: string): Promise<void> {
  const state = await readProductRuntimeState(fixture.session.id)
  const actorKey = state.ttrpg?.activeActorKey
  const sceneKey = state.ttrpg?.scene?.sceneKey
  if (!actorKey || !sceneKey) throw new Error('现行 TTRPG 会话没有活动行动者或场景')
  const campaign = fixture.runtimePackage.ttrpg!.campaign
  const rulePack = fixture.runtimePackage.ttrpg!.rulePack.content
  const actor = campaign.characterTemplates.find(template => template.characterKey === actorKey)
  const scene = campaign.scenes.find(candidate => candidate.sceneKey === sceneKey)
  if (!actor || !scene) throw new Error('现行 TTRPG 包无法解析活动行动闭集')
  const action = rulePack.actions.find(candidate => (
    actor.actionKeys.includes(candidate.key) && scene.actionKeys.includes(candidate.key)
  ))
  if (!action) throw new Error('活动行动者没有合法 RulePack 行动')
  const targetKey = action.target === 'single'
    ? state.ttrpg!.turnOrder.find(candidate => candidate !== actorKey) ?? null
    : null
  const version = await readProductRuntimeStateVersion(fixture.session.id)
  await resolveTtrpgRuleAction({
    sessionId: fixture.session.id,
    commandId,
    baseSequence: version.sequence,
    baseStateHash: version.stateHash,
    actorKey,
    actionKey: action.key,
    targetKey,
    difficulty: 8,
    declaredIntent: {
      intentKey: `${commandId}.intent`,
      rawInput: '依据当前已知事实检查现场，并推进调查。',
      goal: '获得可继续调查的信息',
      method: '现场检查',
    },
  })
}

async function advanceUntil(input: {
  fixture: TtrpgFixture
  predicate: (actorKey: string) => boolean
  commandPrefix: string
}): Promise<string> {
  for (let guard = 0; guard < 8; guard += 1) {
    const state = await readProductRuntimeState(input.fixture.session.id)
    const actorKey = state.ttrpg?.activeActorKey
    if (!actorKey) throw new Error('现行 TTRPG 会话没有活动行动者')
    if (input.predicate(actorKey)) return actorKey
    await resolveActiveManually(input.fixture, `${input.commandPrefix}.${guard}`)
  }
  throw new Error('未能推进到目标 TTRPG 行动者')
}

function targetForAction(input: {
  target: 'self' | 'single-ally' | 'single-enemy' | 'scene'
  actorKey: string
  actors: Array<{ actorKey: string; role: 'player' | 'npc' }>
  actorRole: 'player' | 'npc'
}): string | null {
  if (input.target === 'scene') return null
  if (input.target === 'self') return input.actorKey
  const wantedRole = input.target === 'single-ally' ? input.actorRole
    : input.actorRole === 'player' ? 'npc' : 'player'
  return input.actors.find(actor => actor.actorKey !== input.actorKey && actor.role === wantedRole)?.actorKey
    ?? null
}

describe('R-HARNESS-RUNTIME3 · current Product Build TTRPG Skills', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('可信 GM 叙述 Skill 只解释 Build 中已结算的 RulePack 行动', async () => {
    const fixture = await readyFixture({
      title: '现行可信 GM Harness', playerController: 'human', gmMode: 'human',
    })
    await resolveActiveManually(fixture, 'current.gm-narration.action')
    const view = await loadTtrpgGmRuntimeViewV1({
      scope: fixture.scope,
      productRuntimeSessionId: fixture.session.id,
    })
    const receipt = view.latestAction?.receipt
    if (!receipt) throw new Error('现行 Build 行动缺少 ActionReceipt')
    expect(evaluateTtrpgGmCandidateOutputV1(JSON.stringify({
      narration: '缺少结构化综合反馈的文本。',
      offeredClueKeys: [],
      recommendedNextSceneKeys: [],
    }), view)).toMatchObject({ accepted: false })
    const generated = await generateTtrpgGmNarrationCandidateV1({
      scope: fixture.scope,
      productRuntimeSessionId: fixture.session.id,
      objective: '只叙述刚才已经结算的调查结果',
      runAI: async () => JSON.stringify({
        narration: '潮声之中，已经完成的检查留下了可供下一步判断的明确痕迹。',
        synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        offeredClueKeys: [],
        recommendedNextSceneKeys: [],
      }),
    })
    const adopted = await adoptTtrpgGmNarrationCandidateV1({
      scope: fixture.scope,
      runId: generated.candidate.runId,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await readProductRuntimeState(fixture.session.id)).ttrpg!.product!.gmNarrations)
      .toContainEqual(expect.objectContaining({ candidateHash: generated.candidate.candidateHash }))
    expect(fixture.session).toMatchObject({ productBuildId: expect.any(Number), productReleaseId: null })
  })

  it('AI 玩家 Skill 从本人可见闭集选行动，并由 Build 的 RulePack 正式结算', async () => {
    const fixture = await readyFixture({
      title: '现行 AI 玩家 Harness', playerController: 'ai', gmMode: 'human',
    })
    const player = (await readTtrpgSessionParticipantsV2(fixture.session.id))
      .find(participant => participant.role === 'player')
    if (!player?.actorKey) throw new Error('现行 TTRPG Build 缺少玩家席位')
    await advanceUntil({
      fixture,
      predicate: actorKey => actorKey === player.actorKey,
      commandPrefix: 'current.player.advance',
    })
    const view = await loadTtrpgPlayerRuntimeViewV1({
      scope: fixture.scope,
      productRuntimeSessionId: fixture.session.id,
      actorKey: player.actorKey,
    })
    const action = view.projection.availableActions[0]
    const targetKey = targetForAction({
      target: action.target,
      actorKey: player.actorKey,
      actors: view.projection.actors,
      actorRole: 'player',
    })
    const generated = await generateTtrpgPlayerActionCandidateV1({
      scope: fixture.scope,
      productRuntimeSessionId: fixture.session.id,
      actorKey: player.actorKey,
      objective: '依据角色目标选择一个合法调查行动',
      runAI: async () => JSON.stringify({
        actionKey: action.actionKey,
        targetKey,
        approach: '沿着当前可见痕迹逐项核对，寻找彼此矛盾的细节。',
        spokenIntent: null,
      }),
    })
    const adopted = await adoptTtrpgPlayerActionCandidateV1({
      scope: fixture.scope,
      runId: generated.candidate.runId,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await readProductRuntimeState(fixture.session.id)).ttrpg!.product!.actionHistory.at(-1)!.actorAuthority)
      .toMatchObject({ source: 'ai-player', candidateHash: generated.candidate.candidateHash })
  })

  it('AI GM 角色 Skill 只在 NPC 回合选择闭集行动，并由 Build 的 RulePack 结算', async () => {
    const fixture = await readyFixture({
      title: '现行 AI GM 角色 Harness', playerController: 'human', gmMode: 'ai',
    })
    await advanceUntil({
      fixture,
      predicate: actorKey => (readEntityKind(fixture, actorKey) === 'npc'),
      commandPrefix: 'current.gm-actor.advance',
    })
    const view = await loadTtrpgGmRuntimeViewV1({
      scope: fixture.scope,
      productRuntimeSessionId: fixture.session.id,
    })
    const turn = view.activeTurn
    if (!turn) throw new Error('现行 TTRPG Build 未进入 NPC 回合')
    const action = turn.availableActions[0]
    const targetKey = targetForAction({
      target: action.target,
      actorKey: turn.actorKey,
      actors: turn.visibleTargets,
      actorRole: 'npc',
    })
    const generated = await generateTtrpgGmActorActionCandidateV1({
      scope: fixture.scope,
      productRuntimeSessionId: fixture.session.id,
      objective: '依据 NPC 已知目标合理推进当前回合',
      runAI: async () => JSON.stringify({
        actionKey: action.actionKey,
        targetKey,
        approach: '依据当前掌握的现场事实检查痕迹，并对调查者的推进形成回应。',
        spokenIntent: null,
      }),
    })
    const adopted = await adoptTtrpgGmActorActionCandidateV1({
      scope: fixture.scope,
      runId: generated.candidate.runId,
    })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect((await readProductRuntimeState(fixture.session.id)).ttrpg!.product!.actionHistory.at(-1)!.actorAuthority)
      .toMatchObject({ source: 'ai-gm-npc', candidateHash: generated.candidate.candidateHash })
  })
})

function readEntityKind(fixture: TtrpgFixture, actorKey: string): 'player' | 'npc' | null {
  return fixture.runtimePackage.ttrpg!.campaign.characterTemplates
    .find(template => template.characterKey === actorKey)?.role ?? null
}
