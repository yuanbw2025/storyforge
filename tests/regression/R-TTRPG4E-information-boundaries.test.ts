import { describe, expect, it } from 'vitest'
import { assertTtrpgNoRestrictedTextV1 } from '../../src/lib/ttrpg/information-boundary'
import { createOnlineTtrpgNpcDecisionViewV1, createOnlineTtrpgPublicNarrationViewV1 } from '../../src/lib/online/ttrpg-ai-views'
import type { TtrpgViewerProjectionV1 } from '../../src/lib/ttrpg/viewer-projection'
import { assertTtrpgCompleteContextV1 } from '../../src/lib/ttrpg/prompt-context'
import type { AssembleContextResult } from '../../src/lib/registry/types'

describe('R-TTRPG4E · safe public disclosure', () => {
  it('完整结构来源可以调用模型，被截断的 JSON 即使是 protected source 也必须停止', () => {
    const assembled: AssembleContextResult = { text: '{}', segments: [], included: ['ttrpgPlayerRuntime'], omitted: [], trimmed: [],
      totalInputTokens: 1, inputBudget: 100, overBudgetBeforeTrim: false, overBudgetAfterTrim: false,
      sourceEvidence: [{ key: 'ttrpgPlayerRuntime', status: 'included', delivery: 'full', originalTokens: 1, inputTokens: 1 }] }
    expect(() => assertTtrpgCompleteContextV1(assembled, 'ttrpgPlayerRuntime')).not.toThrow()
    assembled.sourceEvidence![0].delivery = 'truncated'
    expect(() => assertTtrpgCompleteContextV1(assembled, 'ttrpgPlayerRuntime')).toThrow('完整上下文预算')
  })
  it('禁止未授权片段和标点规避，允许具有正式公开证据的同一事实', () => {
    const secret = '十年前港务官调换了灯塔透镜，保管员把订单藏在地下室。'
    const exposed = '十年前港务官调换了灯塔透镜'
    expect(() => assertTtrpgNoRestrictedTextV1(exposed, [secret])).toThrow('私密信息')
    expect(() => assertTtrpgNoRestrictedTextV1('十 年 前，港 务 官 调 换 了 灯 塔 透 镜', [secret])).toThrow('私密信息')
    expect(() => assertTtrpgNoRestrictedTextV1(exposed, [secret], [`已发现的订单证实：${exposed}。`])).not.toThrow()
    expect(() => assertTtrpgNoRestrictedTextV1(secret, [secret], [exposed])).toThrow('私密信息')
  })
  it('即使误传完整 GM 投影，在线 NPC 只得到本人资料，公开渲染不获得私密事实', () => {
    const projection = { turn: { activeActorKey: 'npc.1' },
      scenes: [{ sceneKey: 'scene.1', title: '港口', status: 'current', description: '海风吹过堤岸', gmSecret: '港长是幕后凶手' }],
      actors: [
        { actorKey: 'npc.1', name: '守灯人', role: 'npc', privateProfile: { secret: '我换过灯油' }, attributes: {}, resources: [] },
        { actorKey: 'pc.1', name: '调查者', role: 'player', privateProfile: { secret: '我偷了私账' } },
      ], availableActions: [], visibleClues: [
        { title: '公开灯号', description: '红色三闪', visibility: 'party' },
        { title: '私人来信', description: '欠款尚未偿还', visibility: 'private' },
      ], recentNarrations: [{ text: '海雾渐浓' }], gmControls: { hidden: '全场真相' },
    } as unknown as TtrpgViewerProjectionV1
    const npc = JSON.stringify(createOnlineTtrpgNpcDecisionViewV1(projection, 'npc.1'))
    expect(npc).toContain('我换过灯油')
    for (const phrase of ['我偷了私账', '港长是幕后凶手', '欠款尚未偿还', '全场真相']) expect(npc).not.toContain(phrase)
    const publicView = JSON.stringify(createOnlineTtrpgPublicNarrationViewV1(projection))
    expect(publicView).toContain('红色三闪')
    for (const phrase of ['我换过灯油', '我偷了私账', '港长是幕后凶手', '欠款尚未偿还', '全场真相']) expect(publicView).not.toContain(phrase)
  })
})
