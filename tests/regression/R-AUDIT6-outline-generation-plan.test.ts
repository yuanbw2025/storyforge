import { describe, expect, it } from 'vitest'
import {
  buildOutlineGenerationPlan,
  findGenerationTargetVolume,
  outlineGenerationTargetError,
} from '../../src/lib/outline/generation-plan'
import type { AssembleContextResult } from '../../src/lib/registry/types'
import type { OutlineNode, Project } from '../../src/lib/types'

function node(
  id: number,
  type: OutlineNode['type'],
  parentId: number | null,
  title: string,
  summary = '',
  order = id,
): OutlineNode {
  return {
    id,
    projectId: 1,
    type,
    parentId,
    title,
    summary,
    order,
    createdAt: 1,
    updatedAt: 1,
  }
}

const project: Project = {
  id: 1,
  name: '计划测试',
  genre: '玄幻',
  description: '',
  targetWordCount: 500_000,
  enableMultiWorld: false,
  createdAt: 1,
  updatedAt: 1,
}

function context(): AssembleContextResult {
  return {
    text: '【世界观】九州\n【本卷已写正文进度 · 第一卷】第一章已完成',
    included: ['storyCore', 'characters', 'worldRules', 'existingVolumeOutlines'],
    segments: [
      { label: '故事核心', layer: 'L1', content: '【故事核心】统一九州', tokens: 2, trimmable: true },
      { label: '角色档案', layer: 'L1', content: '【角色档案】林舟', tokens: 2, trimmable: true },
      { label: '世界规则', layer: 'L1', content: '【世界规则】不可越级', tokens: 2, trimmable: true },
      { label: '已有卷纲', layer: 'L1', content: '【已有卷大纲】第一卷：入世', tokens: 2, trimmable: true },
    ],
    omitted: [],
    trimmed: [],
    totalInputTokens: 8,
    inputBudget: 48_000,
    overBudgetBeforeTrim: false,
    overBudgetAfterTrim: false,
  }
}

const firstVolume = node(1, 'volume', null, '第一卷', '主角入世', 0)
const secondVolume = node(2, 'volume', null, '第二卷', '宗门大战', 1)
const block = node(10, 'storyBlock', 2, '起', '', 0)
const targetChapter = node(11, 'chapter', 10, '第三章 夜探', '', 1)
const siblingChapter = node(12, 'chapter', 10, '第二章 入门', '拜入宗门', 0)
const otherChapter = node(13, 'chapter', 1, '第一卷章节', '不得串入', 0)
const volumes = [firstVolume, secondVolume]
const nodes = [firstVolume, secondVolume, block, targetChapter, siblingChapter, otherChapter]

describe('AUDIT-6 · 大纲生成纯计划', () => {
  it('卷请求读取注册表上下文片段并构造 volume category', () => {
    const plan = buildOutlineGenerationPlan({
      request: { kind: 'volumes' },
      project,
      nodes,
      volumes,
      assembled: context(),
      hint: '保留悬念',
      options: { parameterValues: { volumeCount: 4 } },
    })
    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') return
    expect(plan.category).toBe('outline.volume')
    const prompt = plan.messages.map(message => message.content).join('\n')
    expect(prompt).toContain('统一九州')
    expect(prompt).toContain('林舟')
    expect(prompt).toContain('不可越级')
    expect(prompt).toContain('只生成后续缺少的 2 卷')
  })

  it('卷数已满足和目标卷缺失时返回明确 skip，不构造 AI 请求', () => {
    const satisfied = buildOutlineGenerationPlan({
      request: { kind: 'volumes' }, project, nodes, volumes, assembled: context(), hint: '',
      options: { parameterValues: { volumeCount: 2 } },
    })
    expect(satisfied).toEqual({ status: 'skip', reason: '当前已有 2 卷，已达到你设定的 2 卷，无需继续生成。' })

    const missing = buildOutlineGenerationPlan({
      request: { kind: 'single-volume', volumeId: 999 }, project, nodes, volumes, assembled: context(), hint: '', options: {},
    })
    expect(missing).toEqual({ status: 'skip', reason: '要补全的卷不存在，请重新选择。' })
  })

  it('整卷章纲使用指定卷和前卷摘要', () => {
    const plan = buildOutlineGenerationPlan({
      request: { kind: 'chapters', volumeId: 2 },
      project,
      nodes,
      volumes,
      assembled: context(),
      hint: '',
      options: { parameterValues: { chaptersPerVolume: 12 } },
    })
    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') return
    expect(plan.category).toBe('outline.chapter')
    const prompt = plan.messages.map(message => message.content).join('\n')
    expect(prompt).toContain('第二卷')
    expect(prompt).toContain('宗门大战')
    expect(prompt).toContain('主角入世')
  })

  it('故事块下单章解析所属卷，只注入同父级章节并固定一章', () => {
    const normalizedVolumeCopies = volumes.map(volume => ({ ...volume }))
    expect(findGenerationTargetVolume({ kind: 'single-chapter', chapterId: 11 }, nodes, normalizedVolumeCopies)?.id).toBe(2)
    const plan = buildOutlineGenerationPlan({
      request: { kind: 'single-chapter', chapterId: 11 },
      project,
      nodes,
      volumes: normalizedVolumeCopies,
      assembled: context(),
      hint: '',
      options: { parameterValues: { chaptersPerVolume: 30 } },
    })
    expect(plan.status).toBe('ready')
    if (plan.status !== 'ready') return
    const prompt = plan.messages.map(message => message.content).join('\n')
    expect(prompt).toContain('第三章 夜探')
    expect(prompt).toContain('第二章 入门：拜入宗门')
    expect(prompt).not.toContain('第一卷章节')
    expect(prompt).toContain('只输出 1 个 JSON 元素')
    expect(prompt).toContain('主角入世')
  })

  it('缺失章节或无法归属卷时安全跳过', () => {
    expect(outlineGenerationTargetError({ kind: 'single-chapter', chapterId: 999 }, nodes, volumes))
      .toBe('要生成章纲的卷不存在，请重新选择。')
    const plan = buildOutlineGenerationPlan({
      request: { kind: 'single-chapter', chapterId: 999 },
      project,
      nodes,
      volumes,
      assembled: context(),
      hint: '',
      options: {},
    })
    expect(plan).toEqual({ status: 'skip', reason: '要生成章纲的卷不存在，请重新选择。' })
  })
})
