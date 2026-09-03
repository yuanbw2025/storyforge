import { nanoid } from 'nanoid'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from './catalog'
import type {
  AuthoringEdge,
  AuthoringNodeGraph,
  AuthoringNodeInstance,
} from './contracts'

export const AUTHORING_CREATION_CHAIN_NODE_IDS = Object.freeze({
  context: 'chain-source-context',
  geography: 'chain-source-geography',
  history: 'chain-source-history',
  worldRules: 'chain-source-world-rules',
  world: 'chain-world-origin',
  concept: 'chain-story-concept',
  conflict: 'chain-story-conflict',
  character: 'chain-character-profile',
  volume: 'chain-outline-volume',
  chapter: 'chain-outline-chapter',
  detail: 'chain-outline-plan',
  prose: 'chain-chapter-prose',
  volumeCount: 'chain-control-volume-count',
  chapterCount: 'chain-control-chapter-count',
  candidateCount: 'chain-control-candidate-count',
  wordCount: 'chain-control-word-count',
  temperature: 'chain-control-temperature',
  maxTokens: 'chain-control-max-tokens',
})

type ChainNodeKey = keyof typeof AUTHORING_CREATION_CHAIN_NODE_IDS

function node(
  key: ChainNodeKey,
  templateId: string,
  x: number,
  y: number,
  config: Record<string, unknown> = {},
): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`完整创作链缺少节点模板：${templateId}`)
  return {
    id: AUTHORING_CREATION_CHAIN_NODE_IDS[key],
    templateId,
    templateVersion: template.version,
    title: template.label,
    x,
    y,
    config: { ...defaultConfigForTemplate(template), ...config },
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  }
}

function edge(
  source: AuthoringNodeInstance,
  target: AuthoringNodeInstance,
  targetPortId: string,
  sourcePortId = source.outputs[0]?.id ?? 'candidate',
): AuthoringEdge {
  return {
    id: `chain-edge-${nanoid(8)}`,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    mapping: { mode: 'full', missingPolicy: 'block', refreshPolicy: 'live' },
  }
}

function connectContext(source: AuthoringNodeInstance, target: AuthoringNodeInstance): AuthoringEdge {
  return edge(source, target, 'context', source.outputs[0]?.id ?? 'candidate')
}

/**
 * 官方的世界到正文起始图。图只保存节点编排和控制参数，Canon 仍由现有领域执行器和 adopt() 管理。
 */
export function buildAuthoringCreationChainGraph(): {
  graph: AuthoringNodeGraph
  nodeIds: typeof AUTHORING_CREATION_CHAIN_NODE_IDS
} {
  const context = node('context', 'source.project-context', 40, 100, {
    sourceKeys: ['worldview', 'storyCore', 'characters', 'existingVolumeOutlines'],
    ragEntryKeys: [],
    contextBudget: 24_000,
  })
  const world = node('world', 'world.origin', 360, 40)
  const geography = node('geography', 'source.world-geography', 360, 180, { contextBudget: 12_000 })
  const history = node('history', 'source.world-history', 360, 320, { contextBudget: 12_000 })
  const worldRules = node('worldRules', 'source.world-rules', 360, 460, { contextBudget: 12_000 })
  const concept = node('concept', 'story.concept', 680, 40, { request: '明确这个世界最适合承载的故事概念。' })
  const conflict = node('conflict', 'story.conflict', 680, 260, { request: '从世界设定和故事概念中提炼核心冲突。' })
  const character = node('character', 'character.profile', 1010, 40, { request: '根据世界和核心冲突创建一名关键角色。' })
  const volume = node('volume', 'outline.volume', 1010, 300, { request: '根据世界、故事和角色规划第一批卷纲。' })
  const chapter = node('chapter', 'outline.chapter', 1340, 300, { request: '根据所属卷生成章节大纲。' })
  const detail = node('detail', 'outline.plan', 1670, 300, { request: '为目标章节生成可执行的场景细纲。' })
  const prose = node('prose', 'chapter.prose', 2000, 300, { request: '根据章纲和细纲生成正文候选。' })
  const volumeCount = node('volumeCount', 'control.volume-count', 680, 520)
  const chapterCount = node('chapterCount', 'control.chapter-count', 1010, 520)
  const candidateCount = node('candidateCount', 'control.candidate-count', 1340, 520)
  const wordCount = node('wordCount', 'control.word-count', 1670, 520)
  const temperature = node('temperature', 'control.temperature', 2000, 40)
  const maxTokens = node('maxTokens', 'control.max-tokens', 2000, 170)

  const nodes = [context, world, geography, history, worldRules, concept, conflict, character, volume, chapter, detail, prose, volumeCount, chapterCount, candidateCount, wordCount, temperature, maxTokens]
  const canonicalWorldSources = [geography, history, worldRules]
  const worldAwareTargets = [concept, conflict, character, volume, chapter, detail, prose]
  const edges = [
    connectContext(context, world),
    connectContext(context, concept),
    connectContext(context, conflict),
    connectContext(context, character),
    connectContext(context, volume),
    connectContext(context, chapter),
    connectContext(context, detail),
    connectContext(context, prose),
    connectContext(world, concept),
    connectContext(world, conflict),
    connectContext(world, character),
    connectContext(world, volume),
    ...canonicalWorldSources.flatMap(source => worldAwareTargets.map(target => connectContext(source, target))),
    connectContext(concept, conflict),
    connectContext(concept, volume),
    connectContext(concept, chapter),
    connectContext(conflict, character),
    connectContext(conflict, volume),
    connectContext(character, volume),
    edge(volume, chapter, 'volume'),
    edge(chapter, detail, 'chapter'),
    edge(chapter, prose, 'context'),
    edge(detail, prose, 'plan'),
    edge(volumeCount, volume, 'volume-count'),
    edge(chapterCount, chapter, 'chapter-count'),
    edge(candidateCount, character, 'candidate-count'),
    edge(candidateCount, volume, 'candidate-count'),
    edge(candidateCount, chapter, 'candidate-count'),
    edge(candidateCount, detail, 'candidate-count'),
    edge(candidateCount, prose, 'candidate-count'),
    edge(wordCount, prose, 'word-count'),
    ...[character, volume, chapter, detail, prose].map(target => edge(temperature, target, 'temperature')),
    ...[character, volume, chapter, detail, prose].map(target => edge(maxTokens, target, 'max-tokens')),
  ]

  return {
    graph: {
      version: 2,
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 0.8 },
      groups: [
        { id: 'chain-world-story', title: '世界与故事', color: '#7c3aed' },
        { id: 'chain-outline-prose', title: '大纲到正文', color: '#0284c7' },
        { id: 'chain-controls', title: '执行控制', color: '#d97706' },
      ],
    },
    nodeIds: AUTHORING_CREATION_CHAIN_NODE_IDS,
  }
}
