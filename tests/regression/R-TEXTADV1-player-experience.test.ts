import { describe, expect, it } from 'vitest'
import { createAdventureAcceptanceContent } from '../../src/lib/adventure/authoring'
import {
  parseAdventureNarrativeBlocks,
  parseAdventurePlayerCommand,
  projectAdventureTranscript,
  resolveAdventurePlayerIdentity,
} from '../../src/lib/adventure/player-experience'
import type {
  AdventureActionHistoryEntry,
  AdventureGameReleaseManifestV1,
  SimulationEvent,
} from '../../src/lib/types'

describe('TEXTADV-1 · pure-text player experience', () => {
  const content = createAdventureAcceptanceContent()
  const actions = content.actions.filter(action => action.locationKey === content.initialLocationKey).map(action => ({
    action,
    available: action.key !== 'blocked',
    reason: action.key === 'blocked' ? '尚未解锁。' : '',
  }))

  it('把自然语言、数字快捷键和系统命令映射为确定性结果', () => {
    const look = actions.find(item => item.action.kind === 'look')!
    expect(parseAdventurePlayerCommand(`我想${look.action.label}一下`, actions)).toMatchObject({
      kind: 'action', action: { key: look.action.key }, available: true,
    })
    expect(parseAdventurePlayerCommand('1', actions)).toMatchObject({ kind: 'action', action: { key: actions[0].action.key } })
    expect(parseAdventurePlayerCommand('背包', actions)).toEqual({ kind: 'system', command: 'inventory' })
    expect(parseAdventurePlayerCommand('钻进不存在的传送门', actions)).toMatchObject({ kind: 'unknown' })
  })

  it('从正式事件投影连续叙事与明确状态变化', () => {
    const action = content.actions[0]
    const manifest = {
      schema: 'storyforge.game-release', version: 1, productType: 'text-adventure',
      definition: {}, worldRelease: {}, narrative: {}, adventure: content,
      interaction: {
        playerKey: 'player',
        profiles: [{
          participantKey: 'merchant', characterKey: 'merchant', name: '潮汐商人', roleLabel: '', voiceRules: '',
          initialKnowledge: [], relationshipDimensions: [{ key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 3 }], maxMemoryEntries: 10,
        }],
        sceneTemplates: [],
      },
    } as unknown as AdventureGameReleaseManifestV1
    const base = { projectId: 1, sessionId: 1, createdAt: 1 }
    const events: SimulationEvent[] = [
      { ...base, sequence: 1, type: 'adventure.quest.accepted', payloadJson: JSON.stringify({ questKey: 'main.bell' }) },
      { ...base, sequence: 2, type: 'adventure.resource.changed', payloadJson: JSON.stringify({ resourceKey: 'stamina', before: 6, after: 5, delta: -1 }) },
      { ...base, sequence: 3, type: 'interaction.relationship.changed', payloadJson: JSON.stringify({ fromParticipantKey: 'merchant', toParticipantKey: 'player', dimensionKey: 'trust', delta: 1 }) },
      { ...base, sequence: 4, type: 'adventure.action.committed', payloadJson: '{}' },
    ]
    const history: AdventureActionHistoryEntry[] = [{
      eventSequence: 4, resultingSequence: 4, commandId: 'command-1', actionKey: action.key,
      kind: action.kind, outcome: 'success', narrative: '潮水退去，石阶下露出第一条线索。',
    }]
    const transcript = projectAdventureTranscript(manifest, history, events)
    expect(transcript).toHaveLength(1)
    expect(transcript[0]).toMatchObject({ actionLabel: action.label, narrative: history[0].narrative })
    expect(transcript[0].changes).toEqual(expect.arrayContaining([
      expect.stringContaining('接受任务'),
      '体力 -1（5）',
      '潮汐商人信任 +1',
    ]))
  })

  it('把冻结结果中的旁白、行动与多角色对白投影成可读段落', () => {
    expect(parseAdventureNarrativeBlocks([
      '雾从防波堤外翻进港湾。',
      '【余砚】十年前也晚了十三分钟。',
      '【林澈】你在密信里写的是少了四十七个人。',
      '【行动】登记册上的墨迹开始褪色。',
    ].join('\n\n'))).toEqual([
      { kind: 'narration', speaker: null, text: '雾从防波堤外翻进港湾。' },
      { kind: 'dialogue', speaker: '余砚', text: '十年前也晚了十三分钟。' },
      { kind: 'dialogue', speaker: '林澈', text: '你在密信里写的是少了四十七个人。' },
      { kind: 'action', speaker: null, text: '登记册上的墨迹开始褪色。' },
    ])
  })

  it('旧发布无需重写即可推断玩家身份，并在首次观察后补出真实剧情对白', () => {
    const look = content.actions.find(item => item.kind === 'look')!
    const legacyManifest = {
      schema: 'storyforge.game-release', version: 1, productType: 'text-adventure',
      definition: {
        source: {
          worldContentHash: 'a'.repeat(64), mappingVersion: 1,
          selection: {},
        },
      }, worldRelease: {}, adventure: content,
      narrative: {
        entryNodeKey: 'entry',
        nodes: [{ key: 'entry', title: '失潮之夜' }],
        choices: [],
        beats: [
          { beatKey: 'entry.1', nodeKey: 'entry', kind: 'narration', speakerKey: null, text: '雾从防波堤外翻进港湾。', order: 1 },
          { beatKey: 'entry.2', nodeKey: 'entry', kind: 'narration', speakerKey: null, text: '【林澈】潮没来，钟也没响。', order: 2 },
          { beatKey: 'entry.3', nodeKey: 'entry', kind: 'narration', speakerKey: null, text: '【余砚】十年前也晚了十三分钟。', order: 3 },
        ],
      },
      interaction: {
        playerKey: 'player',
        profiles: [
          { participantKey: 'character-0', characterKey: 'world-release:abc:character:0', name: '林澈', roleLabel: '巡潮员', voiceRules: '', initialKnowledge: [], relationshipDimensions: [], maxMemoryEntries: 10 },
          { participantKey: 'character-1', characterKey: 'world-release:abc:character:1', name: '余砚', roleLabel: '档案管理员', voiceRules: '', initialKnowledge: [], relationshipDimensions: [], maxMemoryEntries: 10 },
        ],
        sceneTemplates: [],
      },
    } as unknown as AdventureGameReleaseManifestV1
    expect(resolveAdventurePlayerIdentity(legacyManifest)).toMatchObject({
      name: '林澈', participantKey: 'character-0', inferred: true,
    })
    const history: AdventureActionHistoryEntry[] = [{
      eventSequence: 1, resultingSequence: 1, commandId: 'legacy-look', actionKey: look.key,
      kind: look.kind, outcome: 'success', narrative: '你观察了雾港码头。',
    }]
    const transcript = projectAdventureTranscript(legacyManifest, history, [])
    expect(transcript[0].blocks).toEqual(expect.arrayContaining([
      { kind: 'dialogue', speaker: '林澈', text: '潮没来，钟也没响。' },
      { kind: 'dialogue', speaker: '余砚', text: '十年前也晚了十三分钟。' },
    ]))
  })
})
