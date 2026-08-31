import { nanoid } from 'nanoid'
import { AUTHORING_NODE_BY_ID, defaultConfigForTemplate } from './catalog'
import { buildAuthoringCreationChainGraph } from './creation-chain'
import type { AuthoringEdge, AuthoringNodeGraph, AuthoringNodeInstance } from './contracts'
import { autoLayoutAuthoringGraph } from './productivity'
import { deriveShortNovelStructure, SHORT_NOVEL_DEFAULT_WORDS } from '../world-engine/work-kind'
import { assertOfficialAuthoringGraphUsesFormalActionsV1 } from './domain-action-registry'

export const AUTHORING_OFFICIAL_TEMPLATE_IDS = [
  'world-foundation',
  'long-novel',
  'short-novel',
  'character-driven',
  'multi-line-narrative',
  'chapter-continuation-review',
] as const

export type AuthoringOfficialTemplateId = typeof AUTHORING_OFFICIAL_TEMPLATE_IDS[number]

export interface AuthoringOfficialTemplate {
  id: AuthoringOfficialTemplateId
  name: string
  description: string
  build(): AuthoringNodeGraph
}

function node(
  templateId: string,
  id: string,
  config: Record<string, unknown> = {},
): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`官方模板缺少节点：${templateId}`)
  return {
    id,
    templateId,
    templateVersion: template.version,
    title: template.label,
    x: 0,
    y: 0,
    config: { ...defaultConfigForTemplate(template), ...config },
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  }
}

function edge(
  source: AuthoringNodeInstance,
  target: AuthoringNodeInstance,
  targetPortId = 'context',
  sourcePortId = source.outputs[0]?.id ?? 'candidate',
): AuthoringEdge {
  return {
    id: `template-edge-${nanoid(8)}`,
    sourceNodeId: source.id,
    sourcePortId,
    targetNodeId: target.id,
    targetPortId,
    mapping: { mode: 'full', missingPolicy: 'block', refreshPolicy: 'live' },
  }
}

function graph(nodes: AuthoringNodeInstance[], edges: AuthoringEdge[], groups: AuthoringNodeGraph['groups'] = []) {
  return autoLayoutAuthoringGraph({
    version: 2,
    nodes,
    edges,
    viewport: { x: 0, y: 0, zoom: 0.8 },
    groups,
  })
}

function projectContext(id: string, sourceKeys: string[]): AuthoringNodeInstance {
  return node('source.project-context', id, {
    sourceKeys,
    ragEntryKeys: [],
    contextBudget: 24_000,
  })
}

function worldFoundationGraph(): AuthoringNodeGraph {
  const context = projectContext('world-template-context', ['worldview', 'worldRules', 'codex', 'locations'])
  const worldNodes = [
    'world.origin', 'world.structure', 'world.terrain', 'world.waterways', 'world.climate',
    'world.races', 'world.factions', 'world.politics', 'world.economy', 'world.culture',
    'world.power', 'world.items',
  ].map((templateId, index) => node(templateId, `world-template-${index}`))
  return graph(
    [context, ...worldNodes],
    worldNodes.map(item => edge(context, item)),
    [
      { id: 'world-natural', title: '自然环境', color: '#2d8777' },
      { id: 'world-humanity', title: '人文环境', color: '#42759a' },
      { id: 'world-rules', title: '规则与器物', color: '#b77731' },
    ],
  )
}

function configureCreationChain(input: {
  chapterCount: number
  volumeCount: number
  wordCount: number
  namePrefix: string
}): AuthoringNodeGraph {
  const { graph: base } = buildAuthoringCreationChainGraph()
  return {
    ...base,
    nodes: base.nodes.map(item => {
      const config = { ...item.config }
      if (item.templateId === 'control.chapter-count') config.value = input.chapterCount
      if (item.templateId === 'control.volume-count') config.value = input.volumeCount
      if (item.templateId === 'control.word-count') config.value = input.wordCount
      return { ...item, id: `${input.namePrefix}-${item.id}`, config }
    }),
    edges: base.edges.map(item => ({
      ...item,
      id: `${input.namePrefix}-${item.id}`,
      sourceNodeId: `${input.namePrefix}-${item.sourceNodeId}`,
      targetNodeId: `${input.namePrefix}-${item.targetNodeId}`,
    })),
  }
}

function characterDrivenGraph(): AuthoringNodeGraph {
  const base = configureCreationChain({ chapterCount: 18, volumeCount: 3, wordCount: 2800, namePrefix: 'character' })
  const context = base.nodes.find(item => item.templateId === 'source.project-context')!
  const character = base.nodes.find(item => item.templateId === 'character.profile')!
  const volume = base.nodes.find(item => item.templateId === 'outline.volume')!
  const arc = node('story.arc', 'character-story-arc', { request: '围绕角色欲望、代价与变化建立角色驱动故事线。' })
  const relation = node('character.relation', 'character-relation', { request: '围绕关键角色建立会推动剧情变化的关系。' })
  const expanded = {
    ...base,
    nodes: [...base.nodes, arc, relation],
    edges: [
      ...base.edges,
      edge(context, arc),
      edge(context, relation),
      edge(character, arc),
      edge(character, relation),
      edge(arc, volume),
    ],
  }
  return autoLayoutAuthoringGraph(expanded)
}

function multiLineNarrativeGraph(): AuthoringNodeGraph {
  const context = projectContext('multiline-context', ['worldview', 'storyCore', 'characters', 'storyArcs', 'existingVolumeOutlines'])
  const concept = node('story.concept', 'multiline-concept')
  const conflict = node('story.conflict', 'multiline-conflict')
  const arcs = ['主线', '角色支线', '世界支线'].map((title, index) => ({
    ...node('story.arc', `multiline-arc-${index}`, { request: `设计${title}的阶段、交汇点和收束条件。` }),
    title,
  }))
  const volume = node('outline.volume', 'multiline-volume', { request: '按故事线交汇与阶段推进规划卷纲。' })
  const volumeCount = node('control.volume-count', 'multiline-volume-count', { value: 5 })
  return graph(
    [context, concept, conflict, ...arcs, volume, volumeCount],
    [
      edge(context, concept),
      edge(context, conflict),
      ...arcs.flatMap(arc => [edge(context, arc), edge(concept, arc), edge(conflict, arc), edge(arc, volume)]),
      edge(context, volume),
      edge(volumeCount, volume, 'volume-count'),
    ],
    [{ id: 'multiline-arcs', title: '多线叙事', color: '#7c3aed' }],
  )
}

function chapterContinuationReviewGraph(): AuthoringNodeGraph {
  const context = projectContext('continuation-context', ['chapterOutline', 'detailedOutline', 'chapterContent', 'characters', 'worldview'])
  const previous = node('context.previous-ending', 'continuation-previous')
  const handoff = node('context.handoff', 'continuation-handoff')
  const summaries = node('context.recent-summaries', 'continuation-summaries')
  const related = node('context.related-passages', 'continuation-related')
  const report = node('context.consistency-report', 'continuation-report')
  const prose = node('chapter.prose', 'continuation-prose', { request: '承接已有正文并遵守连续性证据，生成下一段正文候选。' })
  const organize = node('chapter.organize', 'continuation-organize')
  const wordCount = node('control.word-count', 'continuation-word-count', { value: 2200 })
  const sources = [context, previous, handoff, summaries, related, report]
  return graph(
    [...sources, prose, organize, wordCount],
    [
      ...sources.map(source => edge(source, prose)),
      edge(wordCount, prose, 'word-count'),
      edge(prose, organize, 'chapter'),
    ],
    [
      { id: 'continuation-evidence', title: '连续性证据', color: '#42759a' },
      { id: 'continuation-output', title: '续写与审校', color: '#2d8777' },
    ],
  )
}

export const AUTHORING_OFFICIAL_TEMPLATES: readonly AuthoringOfficialTemplate[] = Object.freeze([
  {
    id: 'world-foundation',
    name: '基础世界构建',
    description: '从自然、人文、规则和器物建立可复用世界基座。',
    build: worldFoundationGraph,
  },
  {
    id: 'long-novel',
    name: '长篇小说',
    description: '世界、故事、角色、卷章、细纲和正文的完整长篇链路。',
    build: () => configureCreationChain({ chapterCount: 20, volumeCount: 5, wordCount: 3000, namePrefix: 'long' }),
  },
  {
    id: 'short-novel',
    name: '短篇小说',
    description: '按作品目标动态生成单卷创作链，保留同一套确认写回边界。',
    build: () => {
      const structure = deriveShortNovelStructure(SHORT_NOVEL_DEFAULT_WORDS)
      return configureCreationChain({
        chapterCount: structure.chapterCount,
        volumeCount: structure.volumeCount,
        wordCount: structure.targetWordsPerChapter,
        namePrefix: 'short',
      })
    },
  },
  {
    id: 'character-driven',
    name: '角色驱动',
    description: '让角色、关系和角色故事线先于卷章结构进入规划。',
    build: characterDrivenGraph,
  },
  {
    id: 'multi-line-narrative',
    name: '多线叙事',
    description: '并列规划主线、角色支线和世界支线，再汇入卷纲。',
    build: multiLineNarrativeGraph,
  },
  {
    id: 'chapter-continuation-review',
    name: '章节续写与审校',
    description: '显式汇集前章、handoff、摘要、相关前文和一致性报告。',
    build: chapterContinuationReviewGraph,
  },
])

export const AUTHORING_OFFICIAL_TEMPLATE_BY_ID = new Map(
  AUTHORING_OFFICIAL_TEMPLATES.map(template => [template.id, template] as const),
)

export function buildOfficialAuthoringTemplate(
  id: AuthoringOfficialTemplateId,
  options: { targetWordCount?: number; preferredChapterCount?: number } = {},
): AuthoringNodeGraph {
  const template = AUTHORING_OFFICIAL_TEMPLATE_BY_ID.get(id)
  if (!template) throw new Error(`未知官方节点模板：${id}`)
  let built: AuthoringNodeGraph
  if (id === 'short-novel') {
    const structure = deriveShortNovelStructure(
      options.targetWordCount ?? SHORT_NOVEL_DEFAULT_WORDS,
      options.preferredChapterCount,
    )
    built = configureCreationChain({
      chapterCount: structure.chapterCount,
      volumeCount: structure.volumeCount,
      wordCount: structure.targetWordsPerChapter,
      namePrefix: 'short',
    })
  } else {
    built = template.build()
  }
  assertOfficialAuthoringGraphUsesFormalActionsV1({
    templateId: id,
    nodes: built.nodes,
    catalog: AUTHORING_NODE_BY_ID,
  })
  return built
}
