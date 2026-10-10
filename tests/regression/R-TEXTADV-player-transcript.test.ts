import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { projectAdventureTranscript } from '../../src/lib/adventure/player-experience'
import { db } from '../../src/lib/db/schema'
import type { AdventureActionHistoryEntry, AdventureProductRuntimePackageV1 } from '../../src/lib/types'
import { loadCurrentProductWorldSourceCatalogV1, seedCurrentProductWorld } from '../helpers/current-product-world'
import { createTextAdventureFoundationRuntimePackageV2 } from '../helpers/text-adventure-v2-foundation'

describe('TEXTADV · 行动正文只读取明确绑定的叙事场景', () => {
  let fixture: AdventureProductRuntimePackageV1
  let manifest: AdventureProductRuntimePackageV1

  beforeAll(async () => {
    await db.delete()
    await db.open()
    const owned = await seedCurrentProductWorld('行动正文场景边界')
    const sourceCatalog = await loadCurrentProductWorldSourceCatalogV1({
      scope: owned.scope, worldReleaseId: owned.release.id!, productType: 'text-adventure',
    })
    fixture = createTextAdventureFoundationRuntimePackageV2({
      worldRelease: owned.release as typeof owned.release & { id: number }, sourceCatalog,
    }) as AdventureProductRuntimePackageV1
  })
  afterAll(() => db.close())
  beforeEach(() => { manifest = structuredClone(fixture) })

  function transcript(actionKey: string, outcome: AdventureActionHistoryEntry['outcome'] = 'success') {
    const action = manifest.adventure.actions.find(item => item.key === actionKey)!
    const history: AdventureActionHistoryEntry = {
      eventSequence: 10, resultingSequence: 10, commandId: 'test:scene-bound-result',
      actionKey, kind: action.kind, outcome, narrative: '本次行动的正式结算。',
    }
    return projectAdventureTranscript(manifest, [history], [])[0].blocks
  }

  function bindCurrentScene(actionKey: string, nodeKey = 'opening') {
    const action = manifest.adventure.actions.find(item => item.key === actionKey)!
    action.requirements = [{ narrativePath: '__storyforge.currentNarrativeNodeKey', narrativeEquals: nodeKey }]
    return action
  }

  it('道具行动只展示本次结算，不重复入场或泄露同一道具在后续幕的剧情', () => {
    const action = bindCurrentScene('action.equip.cloak')
    action.targetKey = 'item.storm-cloak'
    manifest.narrative.beats.unshift({
      beatKey: 'future.prop', nodeKey: 'ending.rescue', kind: 'narration', speakerKey: null,
      text: '守灯披风在终章码头飘动，尚未发生的航行已经结束。', order: 0,
    })
    const blocks = transcript(action.key)
    expect(blocks).toEqual([{ kind: 'narration', speaker: null, text: '本次行动的正式结算。' }])
  })

  it('同一角色跨场景出场时，不按全局首次对白补充后续剧情', () => {
    const action = bindCurrentScene('action.talk.keeper')
    const profile = manifest.interaction.profiles.find(item => item.participantKey === action.interaction!.participantKey)!
    manifest.narrative.beats.unshift(
      { beatKey: 'future.dialogue', nodeKey: 'ending.rescue', kind: 'dialogue', speakerKey: profile.characterKey, text: '终章的秘密。', order: 0 },
      { beatKey: 'current.dialogue', nodeKey: 'opening', kind: 'dialogue', speakerKey: profile.characterKey, text: '开场的提醒。', order: 2 },
    )
    const blocks = transcript(action.key)
    expect(blocks).toContainEqual({ kind: 'dialogue', speaker: profile.name, text: '开场的提醒。' })
    expect(blocks.map(block => block.text)).not.toContain('终章的秘密。')
  })

  it.each(['success', 'costly-success'] as const)('已成功推进的选择读取目标节点：%s', outcome => {
    const blocks = transcript('action.choose.rescue', outcome)
    expect(blocks.map(block => block.text)).toContain('你把光束推向海面。第一声归航汽笛穿透浓雾。')
    expect(blocks.map(block => block.text)).not.toContain('新透镜嵌入灯芯。两条互相冲突的光路同时亮起。')
  })

  it.each(['failure', 'not-attempted'] as const)('没有完成的选择只展示实际结算，不泄露选择目标：%s', outcome => {
    expect(transcript('action.choose.rescue', outcome)).toEqual([
      { kind: 'narration', speaker: null, text: '本次行动的正式结算。' },
    ])
  })

  it.each(['action.talk.keeper', 'action.equip.cloak', 'action.look.harbor'])('旧包没有场景绑定时保留原始结果：%s', actionKey => {
    const action = manifest.adventure.actions.find(item => item.key === actionKey)!
    action.requirements = []
    const profile = manifest.interaction.profiles[0]
    manifest.narrative.beats.unshift({
      beatKey: 'future.unbound', nodeKey: 'ending.rescue', kind: 'dialogue', speakerKey: profile.characterKey,
      text: '守灯披风揭示终章的秘密。', order: 0,
    })
    expect(transcript(actionKey)).toEqual([{ kind: 'narration', speaker: null, text: '本次行动的正式结算。' }])
  })

  it('重访开场地点时，观察遵从当前场景绑定，不退回开场正文', () => {
    const action = bindCurrentScene('action.look.harbor', 'crossroads')
    const blocks = transcript(action.key)
    expect(blocks.map(block => block.text)).toContain('新透镜嵌入灯芯。两条互相冲突的光路同时亮起。')
    expect(blocks.map(block => block.text)).not.toContain('雾潮已经漫过外港石阶，废弃灯塔仍在远处一明一灭。')
  })
})
