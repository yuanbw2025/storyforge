import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { readyAiKpSession } from '../helpers/ready-ttrpg-session'
import { adoptTtrpgPrivateGuidanceV1, captureTtrpgPrivateGuidanceViewV1, generateTtrpgPrivateGuidanceV1 } from '../../src/lib/ttrpg/private-guidance'
import { createTtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import { changeTtrpgSafetyStatus, readProductRuntimeStateVersion, readProductRuntimeState, replayProductRuntimeEvents } from '../../src/lib/ttrpg/runtime-api'
import { readTtrpgSessionParticipantsV2 } from '../../src/lib/ttrpg/participants'

describe('R-TTRPG4B · role-private guidance', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('只读本人知情范围，指引持久化且不进入公开投影，重放不改变结果', async () => {
    const fixture = await readyAiKpSession('私密指引')
    const campaign = fixture.runtimePackage.ttrpg!.campaign
    const actor = campaign.characterTemplates.find(actor => actor.role === 'player')!
    const input = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId, actorKey: actor.characterKey }
    const view = (await captureTtrpgPrivateGuidanceViewV1(input)).view
    expect(view.self.profile?.secret).toBe(actor.playerProfile!.secret)
    const npc = campaign.characterTemplates.find(actor => actor.role === 'npc')!
    expect(JSON.stringify(view)).not.toContain(npc.gmProfile!.secret)
    const advice = '先保管好你袖子里的便条，选择是否向伙伴透露由你决定。'
    let calls = 0
    const generated = await generateTtrpgPrivateGuidanceV1({ ...input, objective: '我该怎样兼顾自己的秘密目标？', runAI: async messages => {
      calls++
      expect(messages.map(message => message.content).join('\n')).not.toContain(npc.gmProfile!.secret)
      return JSON.stringify({ actorKey: actor.characterKey, advice, suggestedActionKey: null })
    } })
    const adopted = await adoptTtrpgPrivateGuidanceV1({ scope: fixture.scope, actorKey: actor.characterKey, runId: generated.candidate.runId })
    const again = await adoptTtrpgPrivateGuidanceV1({ scope: fixture.scope, actorKey: actor.characterKey, runId: generated.candidate.runId })
    expect(again.event.id).toBe(adopted.event.id)
    expect(calls).toBe(1)
    const state = await readProductRuntimeState(fixture.sessionId)
    expect(state.ttrpg!.product!.privateGuidance).toHaveLength(1)
    expect(state.ttrpg!.product!.privateGuidance![0].advice).toBe(advice)
    const spectator = createTtrpgViewerProjectionV1({ state, campaign, rulePack: fixture.runtimePackage.ttrpg!.rulePack.content, role: 'spectator' })
    expect(JSON.stringify(spectator)).not.toContain(advice)
    const events = await db.productRuntimeEvents.where('sessionId').equals(fixture.sessionId).sortBy('sequence')
    const session = await db.productRuntimeSessions.get(fixture.sessionId)
    expect(replayProductRuntimeEvents(JSON.parse(session!.initialStateJson), events)).toEqual(state)
  })
  it('NPC 不能发起指引，暂停后旧候选不能继续采纳', async () => {
    const fixture = await readyAiKpSession('私密权限')
    const seats = await readTtrpgSessionParticipantsV2(fixture.sessionId)
    const player = seats.find(seat => seat.role === 'player')!
    const base = { scope: fixture.scope, productRuntimeSessionId: fixture.sessionId }
    const npc = fixture.runtimePackage.ttrpg!.campaign.characterTemplates.find(actor => actor.role === 'npc')!
    await expect(captureTtrpgPrivateGuidanceViewV1({ ...base, actorKey: npc.characterKey })).rejects.toThrow('未授权')
    const candidate = await generateTtrpgPrivateGuidanceV1({ ...base, actorKey: player.actorKey!, objective: '有什么建议？',
      runAI: async () => JSON.stringify({ actorKey: player.actorKey, advice: '继续检查已知线索。', suggestedActionKey: null }) })
    const version = await readProductRuntimeStateVersion(fixture.sessionId)
    await changeTtrpgSafetyStatus({ sessionId: fixture.sessionId, commandId: 'pause.advice', baseSequence: version.sequence,
      baseStateHash: version.stateHash, status: 'paused', reason: '暂停私密询问', changedBy: player.actorKey! })
    await expect(adoptTtrpgPrivateGuidanceV1({ scope: fixture.scope, actorKey: player.actorKey!, runId: candidate.candidate.runId })).rejects.toThrow()
    expect((await readProductRuntimeState(fixture.sessionId)).ttrpg!.product!.privateGuidance).toHaveLength(0)
  })
})
