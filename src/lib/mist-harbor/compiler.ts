import type {
  AdventureActionDefinition,
  AvgPresentationCue,
  FrozenRuntimeMediaAssetV2,
  ProductProductionBriefV3,
  ProductRuntimePackageV1,
} from '../types'
import { parseProductRuntimePackageV1 } from '../product-production/runtime-package'
import {
  MIST_HARBOR_ROADSHOW_NODES as NODES,
  MIST_HARBOR_ROADSHOW_BEATS as BEATS,
  MIST_HARBOR_ROADSHOW_CHOICES as CHOICES,
} from '../../content/mist-harbor/story'

export type MistHarborEdition = 'adventure' | 'avg'
export const mistProductType = (edition: MistHarborEdition) =>
  edition === 'avg' ? ('avg' as const) : ('text-adventure' as const)
export const mistProductKey = (edition: MistHarborEdition) => `storyforge.mist-harbor.${edition}.v1`
export const mistTitle = (edition: MistHarborEdition) =>
  `雾港：失潮钟声 · ${edition === 'avg' ? '视觉小说' : '文字冒险'}`
const CAST = { 林澈: 'lin', 余砚: 'yu', 顾潮生: 'gu' } as const
const BACKGROUNDS: Record<string, string> = {
  entry: 'harbor',
  archive: 'archive',
  vault: 'archive',
  market: 'market',
  patrol: 'market',
  undercity: 'bell',
  pump: 'bell',
  shrine: 'bell',
  'north-tower': 'lighthouse',
  'father-log': 'lighthouse',
  'council-seal': 'lighthouse',
  bell: 'bell',
  'public-square': 'market',
  'sealed-engine': 'bell',
  'outbound-dock': 'harbor',
}
const CLUES = [
  {
    key: 'calibration',
    node: 'vault',
    name: '黑潮校准带',
    text: '校准带记录着十年前的过载波形。四十七个名字并非凭空消失，而是被当成了稳定钟机的代价。',
  },
  {
    key: 'witness',
    node: 'patrol',
    name: '潮灯证词',
    text: '你收起写满姓名的灯罩。即使账册继续褪色，这些互相认识的人仍能证明彼此存在。',
  },
  {
    key: 'seal',
    node: 'bell',
    name: '三枚接管印记',
    text: '你把守灯徽章、档案校准码与议会封缄印逐一核对。三方共同授权，主轴控制台才会打开。',
  },
]
function action(
  key: string,
  locationKey: string,
  label: string,
  kind: AdventureActionDefinition['kind'],
): AdventureActionDefinition {
  return {
    key,
    locationKey,
    label,
    description: label,
    kind,
    targetKey: null,
    requirements: [],
    rule: { kind: 'automatic' },
    successEffects: [],
    costlySuccessEffects: [],
    failureEffects: [],
    successText: label,
    costlySuccessText: '先停下来核对证据。',
    failureText: '没有发生改变。',
    unavailableText: '请先完成当前地点的调查。',
    repeatable: false,
    narrativeChoiceKey: null,
  }
}
export function compileMistHarbor(
  edition: MistHarborEdition,
  brief: ProductProductionBriefV3,
  assets: FrozenRuntimeMediaAssetV2[] = [],
): ProductRuntimePackageV1 {
  if (brief.intent.productType !== mistProductType(edition)) throw new Error('雾港作品与 Brief 身份不匹配')
  const choices = CHOICES.map((choice, order) => {
    const clue = edition === 'adventure' ? CLUES.find((item) => item.node === choice.sourceNodeKey) : null
    return {
      ...choice,
      order,
      effectsJson: choice.effectsJson ?? '[]',
      displayConditionJson: '{}',
      availableConditionJson: clue
        ? JSON.stringify({ path: `adventure.inventory.${clue.key}`, eq: 1 })
        : '{}',
      unavailableReason: clue ? `请先取得${clue.name}。` : '',
      tags: edition === 'adventure' ? [`adventure-action:choose.${choice.choiceKey}`] : [],
    }
  })
  const pkg: ProductRuntimePackageV1 = {
    schema: 'storyforge.product-runtime-package',
    version: 1,
    productType: mistProductType(edition),
    definition: {
      productKey: mistProductKey(edition),
      title: mistTitle(edition),
      description:
        '潮汐迟到十三分钟，港民的姓名正从记忆中消失。成为守灯人林澈，在真相、安全与远航之间作出选择。',
      enabledCapabilities:
        edition === 'avg' ? ['narrative', 'presentation'] : ['narrative', 'interaction', 'adventure'],
      rulesetVersion: 1,
      initialVariables: { scene: 'entry' },
    },
    sourceWorld: { contentHash: brief.source.worldContentHash, selection: brief.source.selection },
    narrative: {
      moduleKind: 'main',
      moduleTitle: mistTitle(edition),
      entryNodeKey: 'entry',
      nodes: NODES.map((node) => ({
        key: node.key,
        kind: node.kind,
        title: node.title,
        summary: node.summary,
        successorKeys: node.successors,
        conditionJson: '{}',
        effectsJson: JSON.stringify([{ op: 'set', path: 'scene', value: node.key }]),
      })),
      beats: BEATS.map((beat, order) => ({
        beatKey: beat.beatKey,
        nodeKey: beat.nodeKey,
        kind: beat.kind,
        speakerKey: beat.speaker ? CAST[beat.speaker] : null,
        text: beat.speaker ? `【${beat.speaker}】${beat.text}` : beat.text,
        order,
      })),
      choices,
    },
  }
  if (edition === 'avg') {
    const cues: AvgPresentationCue[] = []
    const cue = (
      beatKey: string,
      type: AvgPresentationCue['type'],
      extra: Partial<AvgPresentationCue> = {},
    ) =>
      cues.push({
        cueKey: `cue.${cues.length}`,
        beatKey,
        phase: 'before',
        type,
        durationMs: 0,
        easing: 'ease-in-out',
        order: cues.length,
        ...extra,
      })
    for (const node of NODES) {
      const beats = BEATS.filter((beat) => beat.nodeKey === node.key)
      const first = beats[0].beatKey
      for (const actorKey of Object.values(CAST)) cue(first, 'hide-actor', { actorKey })
      cue(first, 'clear-cg')
      if (node.kind === 'ending') cue(first, 'show-cg', { assetKey: `mist.cg.${node.key}` })
      else cue(first, 'set-background', { assetKey: `mist.bg.${BACKGROUNDS[node.key]}` })
      for (const beat of beats) {
        if (!beat.speaker || node.kind === 'ending') continue
        const actor = CAST[beat.speaker]
        const expression =
          actor === 'lin'
            ? ['bell', 'sealed-engine', 'outbound-dock'].includes(node.key)
              ? 'resolve'
              : node.key === 'entry'
                ? 'tense'
                : 'neutral'
            : actor === 'yu'
              ? node.key === 'entry'
                ? 'alarm'
                : ['council-seal', 'public-square'].includes(node.key)
                  ? 'resolve'
                  : 'neutral'
              : node.key === 'patrol'
                ? 'anger'
                : node.key === 'north-tower'
                  ? 'conflict'
                  : 'neutral'
        cue(beat.beatKey, 'show-actor', {
          actorKey: actor,
          assetKey: `mist.actor.${actor}${expression === 'neutral' ? '' : `.${expression}`}`,
          slot: actor === 'lin' ? 'left' : 'right',
          layer: 'actor-front',
          x: actor === 'lin' ? 0.25 : 0.75,
          y: 1,
          scale: 1,
          opacity: 1,
        })
        // One interlocutor at a time on the right; preserve Lin's place on the left.
        if (actor !== 'lin') cue(beat.beatKey, 'hide-actor', { actorKey: actor === 'yu' ? 'gu' : 'yu' })
      }
    }
    pkg.presentation = { version: 1, assets, cues }
  } else {
    const actions: AdventureActionDefinition[] = NODES.filter((node) => node.kind !== 'ending').map(
      (node) => ({
        ...action(`look.${node.key}`, node.key, '观察周围', 'look'),
        repeatable: true,
        successText: node.summary,
      }),
    )
    for (const clue of CLUES)
      actions.push({
        ...action(`take.${clue.key}`, clue.node, `取得${clue.name}`, 'take'),
        targetKey: clue.key,
        successText: clue.text,
        successEffects: [{ op: 'gain-item', itemKey: clue.key, quantity: 1, claimKey: `claim.${clue.key}` }],
      })
    for (const choice of choices)
      actions.push({
        ...action(`choose.${choice.choiceKey}`, choice.sourceNodeKey, choice.text, 'move'),
        requirements: [
          { narrativePath: 'scene', narrativeEquals: choice.sourceNodeKey },
          ...CLUES.filter((clue) => clue.node === choice.sourceNodeKey).map((clue) => ({
            itemKey: clue.key,
            itemQuantity: 1,
          })),
        ],
        targetKey: choice.targetNodeKey,
        narrativeChoiceKey: choice.choiceKey,
        successText: choice.description,
        successEffects: [
          { op: 'enter-location', locationKey: choice.targetNodeKey },
          ...(choice.sourceNodeKey === 'bell'
            ? [{ op: 'complete-objective' as const, questKey: 'save-harbor', objectiveKey: 'decide' }]
            : []),
        ],
      })
    actions.push({
      ...action('talk.yu', 'archive', '询问余砚：为什么记录会消失？', 'talk'),
      successText: '【余砚】钟机覆盖的不只是纸上的墨水。先保存原件，我们才有资格要求全港相信。',
      interaction: { participantKey: 'yu', sceneKey: 'archive', ruleKey: 'ask' },
    })
    pkg.interaction = {
      playerKey: 'player',
      profiles: [
        {
          participantKey: 'yu',
          characterKey: 'yu',
          name: '余砚',
          roleLabel: '档案员',
          voiceRules: '以记录与证据说话。',
          initialKnowledge: [
            { key: 'blacktide', content: '十年前的黑潮档案遭到删改。', visibility: 'public', importance: 5 },
          ],
          relationshipDimensions: [
            { key: 'trust', label: '信任', minimum: -10, maximum: 10, initial: 0, largeChangeThreshold: 5 },
          ],
          maxMemoryEntries: 60,
        },
      ],
      sceneTemplates: [
        {
          sceneKey: 'archive',
          title: '档案馆问询',
          purpose: '核对证据',
          location: '旧档案馆',
          timeLabel: '失潮之夜',
          participantKeys: ['yu'],
          publicKnowledgeKeys: ['blacktide'],
          goals: ['保存黑潮原始记录'],
          endingConditions: ['玩家离开'],
          safetyBoundaries: ['不隐瞒选择的代价'],
          relationshipRules: [
            {
              ruleKey: 'ask',
              label: '询问记录',
              playerText: '为什么记录会消失？',
              fromParticipantKey: 'yu',
              toParticipantKey: 'player',
              dimensionKey: 'trust',
              delta: 1,
              reason: '愿意核对证据',
              significantEventKey: null,
            },
          ],
          openingNodeKey: null,
          endingNodeKey: null,
          maxTurns: 20,
          directorBudget: 1,
          order: 0,
        },
      ],
    }
    pkg.adventure = {
      version: 1,
      playerKey: 'player',
      playerIdentity: { name: '林澈', description: '雾港守灯人，追寻父亲留下的第七码。' },
      initialLocationKey: 'entry',
      locations: NODES.map((node) => ({
        key: node.key,
        title: node.title,
        description: node.summary,
        tags: [],
      })),
      objects: CLUES.map((clue) => ({
        key: `object.${clue.key}`,
        locationKey: clue.node,
        title: clue.name,
        description: clue.text,
        tags: ['evidence'],
      })),
      items: CLUES.map((clue) => ({
        key: clue.key,
        title: clue.name,
        description: clue.text,
        tags: ['evidence'],
        stackable: false,
        consumable: false,
      })),
      abilities: [
        {
          key: 'reason',
          title: '推理',
          description: '核对记录与证词。',
          initial: 3,
          minimum: 0,
          maximum: 10,
        },
      ],
      resources: [{ key: 'resolve', title: '决心', initial: 10, minimum: 0, maximum: 10 }],
      conditions: [],
      initialInventory: [],
      actions,
      quests: [
        {
          key: 'save-harbor',
          title: '让雾港渡过失潮之夜',
          description: '查明旧案，取得共同接管权限，决定钟楼的命运。',
          initialStatus: 'active',
          prerequisites: [],
          objectives: [
            {
              key: 'decide',
              title: '在失声钟楼作出决定',
              optional: false,
              alternativeActionKeys: choices
                .filter((choice) => choice.sourceNodeKey === 'bell')
                .map((choice) => `choose.${choice.choiceKey}`),
            },
          ],
          rewardEffects: [],
          completionNodeKey: null,
          failureNodeKey: null,
        },
      ],
    }
  }
  return parseProductRuntimePackageV1(pkg)
}
