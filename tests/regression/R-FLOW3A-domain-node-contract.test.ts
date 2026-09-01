import { describe, expect, it } from 'vitest'
import { NOVEL_CONTENT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-novel'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import {
  AUTHORING_NODE_BY_ID,
  AUTHORING_NODE_CATALOG,
  authoringPortsCompatible,
  parseAuthoringGraph,
  suggestAuthoringConnections,
  topologicalAuthoringOrder,
  validateAuthoringGraph,
  validateAuthoringNodeCatalog,
  type AuthoringNodeGraph,
  type AuthoringNodeInstance,
} from '../../src/lib/node-authoring'

function node(templateId: string, id = templateId): AuthoringNodeInstance {
  const template = AUTHORING_NODE_BY_ID.get(templateId)
  if (!template) throw new Error(`missing template ${templateId}`)
  return {
    id,
    templateId,
    templateVersion: 1,
    title: template.label,
    x: 0,
    y: 0,
    config: {},
    inputs: structuredClone(template.inputs),
    outputs: structuredClone(template.outputs),
  }
}

describe('FLOW-3A · 领域节点合同与三注册表守卫', () => {
  it('领域目录覆盖世界、故事、角色、大纲、正文和控制节点，且所有治理引用有效', () => {
    const promptKeys = new Set([
      ...SYSTEM_PROMPT_SEEDS.map(seed => seed.moduleKey),
      ...NOVEL_CONTENT_PROMPT_SEEDS.map(seed => seed.moduleKey),
    ])
    expect(AUTHORING_NODE_CATALOG.length).toBeGreaterThanOrEqual(60)
    expect(AUTHORING_NODE_CATALOG.some(template => template.id === 'world.waterways')).toBe(true)
    expect(AUTHORING_NODE_CATALOG.some(template => template.id === 'story.theme')).toBe(true)
    expect(AUTHORING_NODE_CATALOG.some(template => template.id === 'character.field.motivation')).toBe(true)
    expect(AUTHORING_NODE_CATALOG.some(template => template.id === 'outline.volume')).toBe(true)
    expect(AUTHORING_NODE_CATALOG.some(template => template.id === 'chapter.prose')).toBe(true)
    expect(AUTHORING_NODE_CATALOG.some(template => template.id === 'control.ai-profile')).toBe(true)
    expect(validateAuthoringNodeCatalog(AUTHORING_NODE_CATALOG, { availablePromptKeys: promptKeys })).toEqual([])
  })

  it('拒绝未登记上下文、字段、表、Prompt 和推荐节点', () => {
    const base = AUTHORING_NODE_BY_ID.get('world.origin')!
    const broken = {
      ...base,
      id: 'broken',
      reads: { sourceKeys: ['not-registered'] },
      writes: { target: 'missingTable', fields: ['missingField'], mode: 'replace' as const },
      promptModuleKey: 'story.core' as const,
      recommendedAfter: ['missing-template'],
    }
    const issues = validateAuthoringNodeCatalog([broken], { availablePromptKeys: new Set() })
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'unknown-source',
      'unknown-table',
      'unknown-field',
      'missing-prompt',
      'unknown-recommendation',
    ]))
  })

  it('语义端口阻止控制值接入内容，并允许单个角色提升为角色列表', () => {
    const world = AUTHORING_NODE_BY_ID.get('world.origin')!.outputs[0]
    const storyContext = AUTHORING_NODE_BY_ID.get('story.concept')!.inputs.find(port => port.id === 'context')!
    const temperature = AUTHORING_NODE_BY_ID.get('control.temperature')!.outputs[0]
    const character = AUTHORING_NODE_BY_ID.get('character.profile')!.outputs[0]
    const characterList = { ...character, semantic: 'character.list' as const, cardinality: 'many' as const }

    expect(authoringPortsCompatible(world, storyContext)).toBe(true)
    expect(authoringPortsCompatible(temperature, storyContext)).toBe(false)
    expect(authoringPortsCompatible(character, characterList)).toBe(true)
    expect(authoringPortsCompatible({ ...characterList, cardinality: 'many' }, { ...character, cardinality: 'one' })).toBe(false)
  })

  it('从世界来源向后拉线时优先推荐故事概念，并只返回兼容端口', () => {
    const origin = AUTHORING_NODE_BY_ID.get('world.origin')!
    const suggestions = suggestAuthoringConnections({
      catalog: AUTHORING_NODE_CATALOG,
      anchorTemplate: origin,
      anchorPort: origin.outputs[0],
      direction: 'after',
      query: '故事概念',
    })
    expect(suggestions[0].template.id).toBe('story.concept')
    expect(suggestions[0].reason).toBe('recommended')
    expect(suggestions.every(item => authoringPortsCompatible(origin.outputs[0], item.port))).toBe(true)
  })

  it('只接受当前领域节点图合同，旧 FLOW-2 图必须先由数据库清场迁移删除', () => {
    const retiredGraph = {
      version: 1,
      viewport: { x: 10, y: 20, zoom: 0.8 },
      nodes: [
        { id: 'source', kind: 'input.text', title: '作者输入', x: 0, y: 0, config: { text: '河流源于北境。' }, inputSlots: [] },
        {
          id: 'compose', kind: 'transform.compose', title: '整理', x: 300, y: 0, config: { template: '{{设定}}' },
          inputSlots: [{ id: 'material', label: '设定', type: 'text', required: true, priority: 80, maxTokens: 2000 }],
        },
      ],
      edges: [{ id: 'edge', sourceNodeId: 'source', targetNodeId: 'compose', targetSlotId: 'material' }],
    }
    expect(() => parseAuthoringGraph(JSON.stringify(retiredGraph))).toThrow('不支持的节点图版本：1')

    const current: AuthoringNodeGraph = {
      version: 2,
      viewport: { x: 10, y: 20, zoom: 0.8 },
      nodes: [node('world.origin', 'origin')],
      edges: [],
    }
    expect(parseAuthoringGraph(JSON.stringify(current))).toEqual({ ...current, groups: [] })
    expect(validateAuthoringGraph(current)).toEqual([])
  })

  it('验证必需输入、类型和环路，并支持目标祖先闭包与下游顺序', () => {
    const origin = node('world.origin', 'origin')
    const story = node('story.concept', 'story')
    const graph: AuthoringNodeGraph = {
      version: 2,
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [origin, story],
      edges: [{
        id: 'edge',
        sourceNodeId: origin.id,
        sourcePortId: origin.outputs[0].id,
        targetNodeId: story.id,
        targetPortId: 'context',
      }],
    }
    expect(validateAuthoringGraph(graph)).toEqual([])
    expect(topologicalAuthoringOrder(graph, 'story').map(item => item.id)).toEqual(['origin', 'story'])

    const cycle = {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: 'back',
          sourceNodeId: story.id,
          sourcePortId: story.outputs[0].id,
          targetNodeId: origin.id,
          targetPortId: 'context',
        },
      ],
    }
    expect(validateAuthoringGraph(cycle).some(issue => issue.code === 'cycle')).toBe(true)
  })
})
