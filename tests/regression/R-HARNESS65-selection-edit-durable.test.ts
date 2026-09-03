import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import type { WorkspaceScope } from '../../src/lib/types'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { usePromptStore } from '../../src/stores/prompt'
import {
  abandonSelectionEditRunV1,
  acknowledgeSelectionCheckReportV1,
  adoptSelectionEditCandidateV1,
  generateSelectionEditCandidateV1,
  parseSelectionModelOutputV1,
  readPendingSelectionEditCandidateV1,
  readRecoverableSelectionEditRunV1,
  rejectSelectionEditCandidateV1,
  type SelectionEditBoundaryV1,
} from '../../src/lib/agent/run/selection-edit-durable'

const SOURCE_HTML = '<p>雨落在旧钟楼上。阿澜握紧钥匙。她没有回头。</p>'
const SELECTED = '阿澜握紧钥匙。'
const OUTPUT = '阿澜将冰凉的钥匙攥得更紧。'
const EXPECTED_HTML = '<p>雨落在旧钟楼上。阿澜将冰凉的钥匙攥得更紧。她没有回头。</p>'

async function seed(suffix = '') {
  const now = Date.now()
  const projectId = await db.projects.add({
    name: `局部编辑${suffix}`, genre: 'fantasy', genres: ['fantasy'], status: 'drafting', description: '',
    targetWordCount: 80_000,
    createdAt: now, updatedAt: now,
  } as any) as number
  const worldId = await db.worlds.add({
    projectId, code: `selection-${now}-${suffix}`, name: '潮钟世界', description: '', currentVersion: 1,
    createdAt: now, updatedAt: now,
  }) as number
  const workId = await db.works.add({
    projectId, worldId, title: `局部编辑${suffix}`, description: '', genres: ['fantasy'], status: 'drafting',
    targetWordCount: 80_000, createdAt: now, updatedAt: now,
  } as any) as number
  await db.projects.update(projectId, { activeWorldId: worldId, activeWorkId: workId, ownershipSchemaVersion: 1 })
  const worldGroupId = await db.worldGroups.add({
    projectId, worldId, name: '主世界', order: 0, createdAt: now, updatedAt: now,
  }) as number
  const outlineNodeId = await db.outlineNodes.add({
    projectId, workId, worldGroupId, parentId: null, type: 'chapter', title: '钟楼夜雨', summary: '',
    order: 0, createdAt: now, updatedAt: now,
  } as any) as number
  const chapterId = await db.chapters.add({
    projectId, workId, outlineNodeId, title: '钟楼夜雨', content: SOURCE_HTML,
    wordCount: SOURCE_HTML.replace(/<[^>]+>/g, '').length, status: 'draft', order: 0, notes: '',
    createdAt: now, updatedAt: now,
  } as any) as number
  return {
    scope: { projectId, worldId, workId } satisfies WorkspaceScope,
    projectId, worldId, workId, worldGroupId, outlineNodeId, chapterId,
  }
}

function selection(sourceHtml = SOURCE_HTML) {
  return { from: 10, to: 18, text: SELECTED, sourceHtml }
}

function preview({ outputText }: { outputText: string }) {
  return SOURCE_HTML.replace(SELECTED, outputText)
}

async function generateEdit(fixture: Awaited<ReturnType<typeof seed>>, options: {
  boundary?: SelectionEditBoundaryV1
  output?: string
} = {}) {
  return generateSelectionEditCandidateV1({
    scope: fixture.scope,
    worldGroupId: fixture.worldGroupId,
    chapterId: fixture.chapterId,
    action: 'rewrite',
    selection: selection(),
    previewReplacement: preview,
    runAI: async messages => {
      const prompt = messages.map(message => message.content).join('\n')
      expect(prompt).toContain(SELECTED)
      expect(prompt).not.toContain('雨落在旧钟楼上')
      expect(prompt).not.toContain('她没有回头')
      return options.output ?? OUTPUT
    },
    onDurableBoundary: options.boundary ? boundary => {
      if (boundary === options.boundary) throw new Error(`interrupt:${boundary}`)
    } : undefined,
  })
}

describe.sequential('R-HARNESS65 · 正文局部编辑 durable 候选与精确采纳', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
    usePromptStore.setState({ templates: [], loaded: false })
  })
  afterEach(() => db.close())

  it('Skill 只读 manualText；编辑写 chapters，查漏零写', async () => {
    expect(getAgentSkillV1('prose.selection-edit')).toMatchObject({
      agentId: 'prose', executionMode: 'selection-edit', contextSourceKeys: ['manualText'],
      writeTargets: [{ table: 'chapters', fields: ['content', 'wordCount'] }],
    })
    expect(getAgentSkillV1('prose.selection-check')).toMatchObject({
      executionMode: 'selection-check', contextSourceKeys: ['manualText'], writeTargets: [],
    })
    const fixture = await seed()
    const generated = await generateEdit(fixture)
    expect(generated.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(generated.candidate.expectedContentHtml).toBe(EXPECTED_HTML)
    expect((await db.chapters.get(fixture.chapterId))?.content).toBe(SOURCE_HTML)
    expect(generated.snapshot.events.find(event => event.type === 'context.assembled')).toBeTruthy()
    expect(generated.snapshot.events.some(event => event.type === 'adoption.started')).toBe(false)
  })

  it('刷新恢复同一候选，作者确认才写正文并签发 terminal receipt', async () => {
    const fixture = await seed()
    const generated = await generateEdit(fixture)
    const recovered = await readPendingSelectionEditCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })
    expect(recovered?.snapshot.run.id).toBe(generated.snapshot.run.id)
    expect(recovered?.candidate).toEqual(generated.candidate)
    const adopted = await adoptSelectionEditCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(adopted.snapshot.projection.state).toBe('completed')
    expect(adopted.receiptHash).toHaveLength(64)
    const chapter = await db.chapters.get(fixture.chapterId)
    expect(chapter?.content).toBe(EXPECTED_HTML)
    expect(chapter?.wordCount).toBe(EXPECTED_HTML.replace(/<[^>]+>/g, '').length)
    await expect(readPendingSelectionEditCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
  })

  it('查漏保持只读候选，作者关闭后成为 terminal report 且不能采纳', async () => {
    const fixture = await seed()
    const checked = await generateSelectionEditCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, chapterId: fixture.chapterId,
      action: 'check', selection: selection(), runAI: async messages => {
        expect(messages.map(message => message.content).join('\n')).toContain(SELECTED)
        return '- “握紧”可补充触感，但不是语法错误。'
      },
    })
    expect(checked.snapshot.projection.state).toBe('awaiting_confirmation')
    expect(checked.candidate.mode).toBe('check')
    expect(checked.candidate.expectedContentHtml).toBeNull()
    expect((await db.chapters.get(fixture.chapterId))?.content).toBe(SOURCE_HTML)
    await expect(adoptSelectionEditCandidateV1({
      scope: fixture.scope, runId: checked.snapshot.run.id,
    })).rejects.toThrow('不能采纳')
    const acknowledged = await acknowledgeSelectionCheckReportV1({
      scope: fixture.scope, runId: checked.snapshot.run.id,
    })
    expect(acknowledged.snapshot.projection.state).toBe('completed')
    expect(acknowledged.receiptHash).toHaveLength(64)
    await expect(readPendingSelectionEditCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
  })

  it('严格输出门拒绝空、同值、围栏与动作级长度越界', () => {
    expect(() => parseSelectionModelOutputV1('rewrite', SELECTED, '')).toThrow('为空')
    expect(() => parseSelectionModelOutputV1('rewrite', SELECTED, SELECTED)).toThrow('完全相同')
    expect(() => parseSelectionModelOutputV1('rewrite', SELECTED, '```\n改写\n```')).toThrow('代码围栏')
    expect(() => parseSelectionModelOutputV1('condense', SELECTED, `${SELECTED}补充`)).toThrow('更短')
    expect(() => parseSelectionModelOutputV1('expand', SELECTED, '更短')).toThrow('更长')
    expect(() => parseSelectionModelOutputV1('polish', SELECTED, '字')).toThrow('保真边界')
  })

  it('预演器若改变选区外正文，模型调用后协议失败且正式正文零写', async () => {
    const fixture = await seed()
    await expect(generateSelectionEditCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, chapterId: fixture.chapterId,
      action: 'rewrite', selection: selection(), runAI: async () => OUTPUT,
      previewReplacement: () => `<p>越界修改。${OUTPUT}</p>`,
    })).rejects.toThrow('选区之外')
    expect((await db.chapters.get(fixture.chapterId))?.content).toBe(SOURCE_HTML)
  })

  it('model.requested 后结果未知以及 model.responded 后未 checkpoint 都不自动重试', async () => {
    const first = await seed('requested')
    let firstCalls = 0
    await expect(generateSelectionEditCandidateV1({
      scope: first.scope, worldGroupId: first.worldGroupId, chapterId: first.chapterId,
      action: 'rewrite', selection: selection(), previewReplacement: preview,
      runAI: async () => { firstCalls++; throw new Error('provider-lost') },
    })).rejects.toThrow('provider-lost')
    const firstRecovery = await readRecoverableSelectionEditRunV1({
      scope: first.scope, chapterId: first.chapterId, worldGroupId: first.worldGroupId,
    })
    expect(firstCalls).toBe(1)
    expect(firstRecovery?.safeToResume).toBe(false)
    expect((await db.agentRuns.get(firstRecovery!.snapshot.run.id))?.status).toBe('paused')

    const second = await seed('responded')
    await expect(generateEdit(second, { boundary: 'model.responded' })).rejects.toThrow('interrupt:model.responded')
    const secondRecovery = await readRecoverableSelectionEditRunV1({
      scope: second.scope, chapterId: second.chapterId, worldGroupId: second.worldGroupId,
    })
    expect(secondRecovery?.safeToResume).toBe(false)
    expect((await db.chapters.get(second.chapterId))?.content).toBe(SOURCE_HTML)
    await abandonSelectionEditRunV1({ scope: second.scope, runId: secondRecovery!.snapshot.run.id })
    expect((await db.agentRuns.get(secondRecovery!.snapshot.run.id))?.status).toBe('cancelled')
  })

  it('候选 checkpoint 后、candidate event 前中断可恢复同一输出且不重复模型调用', async () => {
    const fixture = await seed()
    let calls = 0
    await expect(generateSelectionEditCandidateV1({
      scope: fixture.scope, worldGroupId: fixture.worldGroupId, chapterId: fixture.chapterId,
      action: 'rewrite', selection: selection(), previewReplacement: preview,
      runAI: async () => { calls++; return OUTPUT },
      onDurableBoundary: boundary => { if (boundary === 'candidate.checkpoint') throw new Error('interrupt:candidate.checkpoint') },
    })).rejects.toThrow('interrupt:candidate.checkpoint')
    const recovered = await readPendingSelectionEditCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })
    expect(calls).toBe(1)
    expect(recovered?.candidate.outputText).toBe(OUTPUT)
    expect(recovered?.snapshot.projection.state).toBe('awaiting_confirmation')
  })

  it('正文文本或纯格式变化都会使候选 stale，且不覆盖作者当前内容', async () => {
    const textFixture = await seed('text')
    const textCandidate = await generateEdit(textFixture)
    await db.chapters.update(textFixture.chapterId, { content: '<p>作者已改正文。</p>' })
    await expect(adoptSelectionEditCandidateV1({
      scope: textFixture.scope, runId: textCandidate.snapshot.run.id,
    })).rejects.toThrow('正文或格式已变化')
    expect((await db.chapters.get(textFixture.chapterId))?.content).toBe('<p>作者已改正文。</p>')

    const formatFixture = await seed('format')
    const formatCandidate = await generateEdit(formatFixture)
    const formatOnly = '<p>雨落在旧钟楼上。<strong>阿澜握紧钥匙。</strong>她没有回头。</p>'
    await db.chapters.update(formatFixture.chapterId, { content: formatOnly })
    await expect(adoptSelectionEditCandidateV1({
      scope: formatFixture.scope, runId: formatCandidate.snapshot.run.id,
    })).rejects.toThrow('正文或格式已变化')
    expect((await db.chapters.get(formatFixture.chapterId))?.content).toBe(formatOnly)
  })

  it('Prompt 改变会使候选 stale，不写正文', async () => {
    const fixture = await seed()
    const generated = await generateEdit(fixture)
    const template = (await db.promptTemplates.where('moduleKey').equals('chapter.rewrite').toArray())[0]
    if (template?.id) {
      await db.promptTemplates.update(template.id, { systemPrompt: `${template.systemPrompt}\n作者已调整。`, updatedAt: Date.now() + 1 })
    } else {
      // getActive fallback is code seed; place an active user override to change current evidence.
      await db.promptTemplates.add({
        scope: 'user', moduleKey: 'chapter.rewrite', promptType: 'edit', name: '测试改写', description: '',
        systemPrompt: '新的改写规则', userPromptTemplate: '{{text}}', variables: ['text'], isActive: true,
        createdAt: Date.now(), updatedAt: Date.now(),
      } as any)
    }
    const { usePromptStore } = await import('../../src/stores/prompt')
    await usePromptStore.getState().reload()
    await expect(adoptSelectionEditCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('Prompt 已变化')
    expect((await db.chapters.get(fixture.chapterId))?.content).toBe(SOURCE_HTML)
  })

  it('作者拒绝后候选不再恢复，正文保持不变', async () => {
    const fixture = await seed()
    const generated = await generateEdit(fixture)
    const rejected = await rejectSelectionEditCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(rejected.projection.state).toBe('cancelled')
    expect((await db.chapters.get(fixture.chapterId))?.content).toBe(SOURCE_HTML)
    await expect(readPendingSelectionEditCandidateV1({
      scope: fixture.scope, chapterId: fixture.chapterId, worldGroupId: fixture.worldGroupId,
    })).resolves.toBeNull()
  })

  it.each<SelectionEditBoundaryV1>([
    'intent.checkpoint', 'confirmation.recorded', 'adoption.started', 'formal.written',
    'adoption.committed', 'step.succeeded', 'verification.started', 'verification.accepted',
  ])('采纳在 %s 中断后沿冻结意图幂等收敛', async boundary => {
    const fixture = await seed(boundary)
    const generated = await generateEdit(fixture)
    await expect(adoptSelectionEditCandidateV1({
      scope: fixture.scope,
      runId: generated.snapshot.run.id,
      onDurableBoundary: current => { if (current === boundary) throw new Error(`interrupt:${boundary}`) },
    })).rejects.toThrow(`interrupt:${boundary}`)
    const completed = await adoptSelectionEditCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    expect(completed.snapshot.projection.state).toBe('completed')
    expect((await db.chapters.get(fixture.chapterId))?.content).toBe(EXPECTED_HTML)
    expect(completed.snapshot.events.filter(event => event.type === 'adoption.committed')).toHaveLength(1)
  })

  it('终验后正文改变会撤销旧 receipt，不冒充当前完成', async () => {
    const fixture = await seed()
    const generated = await generateEdit(fixture)
    await adoptSelectionEditCandidateV1({ scope: fixture.scope, runId: generated.snapshot.run.id })
    await db.chapters.update(fixture.chapterId, { content: '<p>作者终验后继续修改。</p>', updatedAt: Date.now() + 1 })
    await expect(adoptSelectionEditCandidateV1({
      scope: fixture.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow('完成回执已过期')
    const run = await db.agentRuns.get(generated.snapshot.run.id)
    expect(run?.status).toBe('paused')
    expect(run?.terminalReceiptHash).toBeNull()
  })

  it('未完成局部选区候选导入后取消，不在新 Work 复活', async () => {
    const fixture = await seed()
    await generateEdit(fixture)
    const importedId = await importProjectJSON(await exportProjectJSON(fixture.projectId))
    const imported = (await db.agentRuns.where('projectId').equals(importedId).toArray())
      .find(run => run.contractJson.includes('prose.selection-edit'))!
    expect(imported.status).toBe('cancelled')
    expect(imported.terminalReceiptHash).toBeNull()
  })

  it('Work 与章节作用域隔离，旧 FloatingToolbar 直调和直接替换旁路已下线', async () => {
    const first = await seed('one')
    const generated = await generateEdit(first)
    const second = await seed('two')
    await expect(readPendingSelectionEditCandidateV1({
      scope: second.scope, chapterId: second.chapterId, worldGroupId: second.worldGroupId,
    })).resolves.toBeNull()
    await expect(adoptSelectionEditCandidateV1({
      scope: second.scope, runId: generated.snapshot.run.id,
    })).rejects.toThrow()

    const toolbar = readFileSync(resolve(process.cwd(), 'src/components/editor/FloatingToolbar.tsx'), 'utf8')
    expect(toolbar).not.toContain('useAIStream')
    expect(toolbar).not.toContain('replaceSelectedText')
    expect(toolbar).not.toMatch(/\bchat\s*\(/)
    expect(toolbar).toContain('generateSelectionEditCandidateV1')
    expect(toolbar).toContain('adoptSelectionEditCandidateV1')
    const registry = JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/agent/ai-entry-registry.json'), 'utf8'))
    expect(registry.entries.some((entry: any) => entry.allowedCallers
      ?.some((file: string) => file.endsWith('FloatingToolbar.tsx')))).toBe(false)
  })
})
