import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import {
  beginProseGenerationGatewayStepV1, createProseGenerationDurableRunV1,
  failProseGenerationStepV1, readLatestInterruptedProseGenerationV1,
  recordInterruptedProseGenerationV1, readLatestProseGenerationCandidateV1,
} from '../../src/lib/agent/run/prose-generation-durable'

async function started() {
  const f = await seedCurrentWorkspace('中断正文', { genres: ['realism'] })
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(f.scope, 'outlineNodes', { projectId: f.scope.projectId, parentId: null, type: 'chapter', title: '收店', summary: '收好工具后关灯', order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', { projectId: f.scope.projectId, outlineNodeId, title: '收店', content: '<p>原稿。</p>', wordCount: 3, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' })) as number
  await db.detailedOutlines.add(stampNewRecord(f.scope, 'detailedOutlines', { projectId: f.scope.projectId, outlineNodeId, scenes: [{ sceneId: 'closing', title: '收店', summary: '收好工具后关灯', characterIds: [], conflict: '', location: '小店', pace: 'slow', estimatedWords: 500, notes: '' }], createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
  const assembly = await prepareProseGatewayAssemblyV1({ projectId: f.scope.projectId, scope: f.scope, chapterId, outlineNodeId, worldGroupId: null, operation: 'generate', authorRequest: '重写收店章', config: useAIConfigStore.getState().config })
  const messages = [{ role: 'user' as const, content: assembly.text }]
  const initial = await createProseGenerationDurableRunV1({ scope: f.scope, worldGroupId: null, chapterId, operation: 'generate' })
  const begun = await beginProseGenerationGatewayStepV1({ scope: f.scope, snapshot: initial, worldGroupId: null, chapterId, outlineNodeId, assembled: assembly, messages, binding: { operation: 'generate', sourceTextHash: await hashChapterText('<p>原稿。</p>'), promptHash: await hashCanonicalValue(messages), informationBoundaryHash: 'a'.repeat(64) } })
  return { ...f, chapterId, snapshot: begun.snapshot }
}

describe('LFQ6 · 中断片段持久留痕与只读恢复', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())

  it('保留字面标签和收到的完整片段，刷新可读，无候选、无正文写入，隔离其它 Work', async () => {
    const f = await started()
    const response = { version: 'prose-interrupted-response-v1' as const, outputText: '收到 <tag> 与 & 字面片段。', completion: 'unknown' as const, message: '未收到完成确认，未自动重发。' }
    const recorded = await recordInterruptedProseGenerationV1({ scope: f.scope, snapshot: f.snapshot, response })
    await failProseGenerationStepV1({ scope: f.scope, snapshot: recorded, code: 'stream-unconfirmed', retryable: false })
    expect(await readLatestInterruptedProseGenerationV1({ scope: f.scope, chapterId: f.chapterId })).toEqual({ ...response, operation: 'generate' })
    expect(await readLatestProseGenerationCandidateV1({ scope: f.scope, chapterId: f.chapterId })).toBeNull()
    expect((await db.chapters.get(f.chapterId))!.content).toBe('<p>原稿。</p>')
    const foreign = await seedCurrentWorkspace('另一部作品', { genres: ['realism'] })
    expect(await readLatestInterruptedProseGenerationV1({ scope: foreign.scope, chapterId: f.chapterId })).toBeNull()
    await createProseGenerationDurableRunV1({ scope: f.scope, worldGroupId: null, chapterId: f.chapterId, operation: 'generate' })
    expect(await readLatestInterruptedProseGenerationV1({ scope: f.scope, chapterId: f.chapterId })).toBeNull()
  })

  it('损坏的片段证据拒绝恢复，不能把伪造内容显示成原响应', async () => {
    const f = await started()
    const recorded = await recordInterruptedProseGenerationV1({ scope: f.scope, snapshot: f.snapshot, response: { version: 'prose-interrupted-response-v1', outputText: '原片段。', completion: 'cancelled', message: '作者停止。' } })
    await failProseGenerationStepV1({ scope: f.scope, snapshot: recorded, code: 'cancelled', retryable: false })
    const artifact = await db.agentRunArtifacts.toCollection().filter(row => row.artifactKind === 'raw-response').first()
    await db.agentRunArtifacts.update(artifact!.id!, { content: '{"version":"prose-interrupted-response-v1","outputText":"篡改片段"}' })
    await expect(readLatestInterruptedProseGenerationV1({ scope: f.scope, chapterId: f.chapterId })).rejects.toThrow()
  })
})
