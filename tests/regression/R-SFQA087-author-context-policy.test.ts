import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedSFQA086Continuity, CONTINUITY_MARKERS } from '../helpers/sfqa086-continuity'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { canonRowResourceKeysV1, UNCACHED_CANON_RESOURCE_PROVIDER_V1 } from '../../src/lib/context-gateway/canon-provider'
import { assertContextReadPermissionV1, assertContextResourceDescriptorV1, isContextResourceDiscoverableV1 } from '../../src/lib/context-gateway/contracts'
import { selectContextResourcesV1 } from '../../src/lib/context-gateway/selector'
import { CONTEXT_SOURCE_BY_KEY } from '../../src/lib/registry/context-sources'
import { createContextAccessPolicyForExecutionV1 } from '../../src/lib/context-gateway/skill-policy'
import { resolveAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { buildRagLibrary, readRagSelectionContext, updateRagDocumentPolicy, updateRagFieldPolicy } from '../../src/lib/retrieval/rag-library'
import { prepareProseGatewayAssemblyV1 } from '../../src/lib/prose/gateway-context'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { hashChapterText } from '../../src/lib/ai/chapter-memory/text-normalization'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { resolveWorkspaceOwnership } from '../../src/lib/workspace/ownership'
import type { Chapter, Character, CodexCategory, CodexEntry, OutlineNode, RetrievalChunk, StateCard, Worldview } from '../../src/lib/types'
import type { ContextResourceDescriptorV1 } from '../../src/lib/registry/types'

const hidden = '关闭策略证据：城门只能由银铃打开。'
const publicText = '公开策略证据：城外有一条河。'
type Fixture = Awaited<ReturnType<typeof fixture>>

beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => db.close())

async function fixture() {
  const f = await seedSFQA086Continuity()
  const row = stampNewRecord<Worldview>(f.created.scope, 'worldviews', { projectId: f.created.scope.projectId, worldGroupId: null, worldOrigin: hidden, races: publicText, createdAt: 1, updatedAt: 1 }, { owner: 'world' })
  const id = await db.worldviews.add(row)
  const stored = (await db.worldviews.get(id))!
  const keys = await canonRowResourceKeysV1('worldviews', { ...stored, projectId: f.created.scope.projectId })
  return { ...f, worldviewId: id, worldviewKeys: keys }
}

async function read(f: Fixture, key: string) {
  return UNCACHED_CANON_RESOURCE_PROVIDER_V1.read({ scope: f.frozenScope, resourceKey: key, depth: 'full', maxTokens: 10000 })
}

async function prose(f: Fixture, operation: 'generate' | 'continue' = 'generate') {
  return prepareProseGatewayAssemblyV1({ projectId: f.created.scope.projectId, scope: f.created.scope, worldGroupId: null, chapterId: f.targetId, outlineNodeId: f.outlineId, operation, authorRequest: '打开蓝门', config: useAIConfigStore.getState().config })
}

function update(f: Fixture) {
  return { projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'worldviews', recordId: f.worldviewId }
}

describe('SFQA-087 · author context switches govern every automatic projection', () => {
  it('omits a closed field from the record while retaining the exact field in the author library', async () => {
    const f = await fixture()
    await updateRagFieldPolicy({ ...update(f), fieldKey: 'worldOrigin', patch: { enabled: false } })
    const record = await read(f, f.worldviewKeys.record!)
    expect(record.content).not.toContain(hidden)
    expect(record.content).toContain(publicText)
    const field = await read(f, f.worldviewKeys.fields.worldOrigin)
    const policy = createContextAccessPolicyForExecutionV1(resolveAgentSkillV1('prose', 'prose.generate'))
    expect(isContextResourceDiscoverableV1({ descriptor: field.descriptor, policy, explicitResourceKey: field.descriptor.resourceKey })).toBe(false)
    expect(() => assertContextReadPermissionV1({ descriptor: field.descriptor, policy, depth: 'full', explicitResourceKey: field.descriptor.resourceKey })).toThrow(/forbidden|停用|关闭/)
    const entry = (await buildRagLibrary({ projectId: f.created.scope.projectId, scope: f.created.scope })).find(item => item.recordId === f.worldviewId && item.tableName === 'worldviews' && item.fieldKey === 'worldOrigin')
    expect(entry).toMatchObject({ enabled: false, content: hidden })
    expect((await db.worldviews.get(f.worldviewId))?.worldOrigin).toBe(hidden)
  })

  it.each(['generate', 'continue'] as const)('a closed document never enters the actual %s packet; reopening restores policy values', async operation => {
    const f = await fixture()
    await updateRagDocumentPolicy({ ...update(f), patch: { enabled: false, weight: 2.5, tokenCap: 1600, priority: 'pinned' } })
    const closed = await prose(f, operation)
    expect(closed.text).not.toContain(hidden)
    expect(closed.text).not.toContain(publicText)
    await updateRagDocumentPolicy({ ...update(f), patch: { enabled: true } })
    const open = await prose(f, operation)
    expect(open.text).toContain(hidden)
    expect((await read(f, f.worldviewKeys.fields.worldOrigin)).descriptor).toMatchObject({ retrievalWeight: 2.5, tokenCap: 1600, priority: 'pinned' })
  })

  it('a closed optional summary cannot return through continuity-tail', async () => {
    const f = await fixture()
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'chapters', recordId: f.priorId, fieldKey: 'summary', patch: { enabled: false } })
    const continuity = await read(f, f.key)
    expect(continuity.content).not.toContain(CONTINUITY_MARKERS.summary)
    expect(continuity.content).toContain(CONTINUITY_MARKERS.continuityHandoff)
    expect((await prose(f)).text).not.toContain(CONTINUITY_MARKERS.summary)
  })

  it('a closed required source stops before a model call and explains how to restore its permission', async () => {
    const f = await fixture()
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'chapters', recordId: f.priorId, fieldKey: 'content', patch: { enabled: false } })
    await expect(prose(f)).rejects.toThrow(/停用|关闭/)
    expect(await db.agentRuns.count()).toBe(0)
    expect((await db.chapters.get(f.priorId))?.content).toContain('当前作者原文')
  })

  it('does not invent a required body read for the empty target chapter while keeping its real dossier obligations', async () => {
    const f = await fixture()
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'chapters', recordId: f.targetId, fieldKey: 'content', patch: { enabled: false } })
    const result = await prose(f)
    expect(result.text).toContain('当前作者原文')
    expect(result.contextGatewayExecution.retrievalTrace.mandatory.some(item => item.resourceKey.endsWith(':consistency-dossier'))).toBe(true)
  })

  it('the mandatory dossier cannot bypass a closed state field or treat the partial packet as sufficient', async () => {
    const f = await fixture()
    const stateId = await db.stateCards.add(stampNewRecord<StateCard>(f.created.scope, 'stateCards', { projectId: f.created.scope.projectId, category: 'character', entityName: '林', fields: JSON.stringify([{ key: '暗号', value: hidden }]), lastChapterId: f.priorId, createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    expect((await prose(f)).text).toContain(hidden)
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'stateCards', recordId: stateId, fieldKey: 'fields', patch: { enabled: false } })
    await expect(prose(f)).rejects.toThrow(/停用|关闭/)
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'stateCards', recordId: stateId, fieldKey: 'fields', patch: { enabled: true } })
    expect((await prose(f)).text).toContain(hidden)
    expect(await db.agentRuns.count()).toBe(0)
  })

  it('a closed custom field cannot return through its raw JSON container; other custom fields remain usable', async () => {
    const f = await fixture()
    const categoryId = await db.codexCategories.add(stampNewRecord<CodexCategory>(f.created.scope, 'codexCategories', { projectId: f.created.scope.projectId, domain: 'humanity', name: '线索', order: 0, parentId: null, fieldSchema: JSON.stringify([{ key: 'secret', label: '暗号', type: 'text' }, { key: 'public', label: '传闻', type: 'text' }]), createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    const id = await db.codexEntries.add(stampNewRecord<CodexEntry>(f.created.scope, 'codexEntries', { projectId: f.created.scope.projectId, categoryId, name: '铜片', summary: '一枚铜片', description: '', fields: JSON.stringify({ secret: hidden, public: publicText }), tags: '[]', origin: 'manual', sourceEvidenceQuotes: '[]', sourceContentHash: '', producerRunId: null, producerCandidateHash: null, order: 0, createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    const keys = await canonRowResourceKeysV1('codexEntries', { ...(await db.codexEntries.get(id))!, projectId: f.created.scope.projectId })
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'codexEntries', recordId: id, fieldKey: 'custom.secret', patch: { enabled: false } })
    const record = await read(f, keys.record!)
    expect(record.content).not.toContain(hidden)
    expect(record.content).toContain(publicText)
    const rawContainer = await read(f, keys.fields.fields)
    const openField = await read(f, keys.fields['custom.public'])
    const policy = createContextAccessPolicyForExecutionV1(resolveAgentSkillV1('prose', 'prose.generate'))
    expect(isContextResourceDiscoverableV1({ descriptor: rawContainer.descriptor, policy })).toBe(false)
    expect(isContextResourceDiscoverableV1({ descriptor: openField.descriptor, policy })).toBe(true)
    expect(openField.content).toContain(publicText)
    const library = await buildRagLibrary({ projectId: f.created.scope.projectId, scope: f.created.scope })
    const rawEntry = library.find(entry => entry.tableName === 'codexEntries' && entry.recordId === id && entry.fieldKey === 'fields')!
    const publicEntry = library.find(entry => entry.tableName === 'codexEntries' && entry.recordId === id && entry.fieldKey === 'custom.public')!
    expect(await readRagSelectionContext({ projectId: f.created.scope.projectId, scope: f.created.scope, entryKeys: [rawEntry.key] })).toBe('')
    const node = await readRagSelectionContext({ projectId: f.created.scope.projectId, scope: f.created.scope, entryKeys: [publicEntry.key] })
    expect(node).toContain(publicText)
    expect(node).not.toContain(hidden)
    // An open synthetic field shares the exact raw JSON source with its closed
    // sibling. Original-evidence capabilities must not expose that container.
    await expect(UNCACHED_CANON_RESOURCE_PROVIDER_V1.readOriginal!({ scope: f.frozenScope, resourceKey: openField.descriptor.resourceKey, sourceRef: openField.descriptor.sourceRefs[0], maxTokens: 10000 })).rejects.toThrow(/停用|关闭/)
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'codexEntries', recordId: id, fieldKey: 'custom.secret', patch: { enabled: true } })
    const original = await UNCACHED_CANON_RESOURCE_PROVIDER_V1.readOriginal!({ scope: f.frozenScope, resourceKey: openField.descriptor.resourceKey, sourceRef: openField.descriptor.sourceRefs[0], maxTokens: 10000 })
    expect(original.content).toContain(hidden)
    expect(original.content).toContain(publicText)
  })

  it('a closed name cannot leak through the title of another open field', async () => {
    const f = await fixture()
    const id = await db.characters.add(stampNewRecord<Character>(f.created.scope, 'characters', { projectId: f.created.scope.projectId, name: hidden, homeWorldGroupId: null, isCrossWorld: false, roleWeight: 'secondary', moralAxis: 'neutral', orderAxis: 'neutral', shortDescription: '', appearance: '', personality: publicText, background: '', motivation: '', abilities: '', relationships: '[]', arc: '', createdAt: 1, updatedAt: 1 }, { owner: 'world' }))
    const keys = await canonRowResourceKeysV1('characters', { ...(await db.characters.get(id))!, projectId: f.created.scope.projectId })
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'characters', recordId: id, fieldKey: 'name', patch: { enabled: false } })
    const openField = await read(f, keys.fields.personality)
    expect(openField.descriptor.title).not.toContain(hidden)
    expect((await read(f, keys.record!)).content).not.toContain(hidden)
    expect(openField.content).toContain(publicText)
  })

  it('the selector preserves a required omission instead of delivering a disabled explicitly named resource', async () => {
    const f = await fixture()
    const original = (await read(f, f.worldviewKeys.fields.worldOrigin)).descriptor
    const closed = { ...original, automaticSelectionEnabled: false }
    const skill = resolveAgentSkillV1('prose', 'prose.generate')
    const policy = createContextAccessPolicyForExecutionV1(skill)
    const result = await selectContextResourcesV1({ taskKind: skill.contextTaskKind, scope: f.frozenScope, accessPolicy: policy, descriptors: [closed], mandatoryResourceKeys: [closed.resourceKey], budgetTokens: 10000, readsAllowed: false })
    expect(result.selected).not.toEqual(expect.arrayContaining([expect.objectContaining({ resourceKey: closed.resourceKey })]))
    expect(result.sufficiency.obligations).toContainEqual(expect.objectContaining({ id: `mandatory-resource:${closed.resourceKey}`, required: true, status: 'missing' }))
    const malformed = { ...original, automaticSelectionEnabled: 'false' } as unknown as ContextResourceDescriptorV1
    expect(() => assertContextResourceDescriptorV1({ descriptor: malformed, source: CONTEXT_SOURCE_BY_KEY.get('ragSelection')! })).toThrow()
    expect(isContextResourceDiscoverableV1({ descriptor: original, policy })).toBe(true)
  })

  it('checks required dossier dependencies beyond the bounded 64-source evidence sample', async () => {
    const f = await fixture()
    const ids = await db.stateCards.bulkAdd(Array.from({ length: 66 }, (_, index) => stampNewRecord<StateCard>(f.created.scope, 'stateCards', { projectId: f.created.scope.projectId, category: 'character', entityName: `角色${index}`, fields: JSON.stringify([{ key: '位置', value: `门${index}` }]), lastChapterId: f.priorId, createdAt: 1, updatedAt: 1 }, { owner: 'work' })), { allKeys: true })
    const targetRow = (await db.chapters.get(f.targetId))!
    const targetKeys = await canonRowResourceKeysV1('chapters', { ...targetRow, projectId: f.created.scope.projectId })
    const dossierKey = `${targetKeys.record}:consistency-dossier`
    const before = await read(f, dossierKey)
    expect(before.descriptor.sourceRefs).toHaveLength(64)
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'stateCards', recordId: ids[ids.length - 1], fieldKey: 'fields', patch: { enabled: false } })
    const after = await read(f, dossierKey)
    const policy = createContextAccessPolicyForExecutionV1(resolveAgentSkillV1('prose', 'prose.generate'))
    expect(isContextResourceDiscoverableV1({ descriptor: after.descriptor, policy })).toBe(false)
    expect(after.descriptor.policyHash).not.toBe(before.descriptor.policyHash)
    expect(after.descriptor.sourceRefs).toHaveLength(64)
  })

  it('optional keyword evidence cannot reconstruct a closed remote chapter through its cache', async () => {
    const f = await fixture()
    const prior = (await db.outlineNodes.get(f.priorRow.outlineNodeId))!
    const outlineId = await db.outlineNodes.add(stampNewRecord<OutlineNode>(f.created.scope, 'outlineNodes', { projectId: f.created.scope.projectId, parentId: prior.parentId, type: 'chapter', title: '历史章', summary: '远章', order: -1, createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    const text = '历史缓存关闭事实：红门位于月面。'
    const chapterId = await db.chapters.add(stampNewRecord<Chapter>(f.created.scope, 'chapters', { projectId: f.created.scope.projectId, outlineNodeId: outlineId, title: '历史章', content: `<p>${text}</p>`, wordCount: 18, status: 'final', order: -1, notes: '', createdAt: 1, updatedAt: 1 }, { owner: 'work' }))
    await db.retrievalChunks.add(stampNewRecord<RetrievalChunk>(f.created.scope, 'retrievalChunks', { projectId: f.created.scope.projectId, sourceChapterId: chapterId, chunkIndex: 0, text, keywords: ['第二章'], sourceTextHash: await hashChapterText(`<p>${text}</p>`), createdAt: 1 }, { owner: 'work' }))
    expect((await prose(f)).text).toContain(text)
    await updateRagFieldPolicy({ projectId: f.created.scope.projectId, scope: f.created.scope, tableName: 'chapters', recordId: chapterId, fieldKey: 'content', patch: { enabled: false } })
    expect((await prose(f)).text).not.toContain(text)
    expect((await db.chapters.get(chapterId))?.content).toContain(text)
  })

  it('keeps the policy identity and disabled fields through portable import while local row IDs change', async () => {
    const f = await fixture()
    await updateRagFieldPolicy({ ...update(f), fieldKey: 'worldOrigin', patch: { enabled: false } })
    const before = await read(f, f.worldviewKeys.fields.races)
    const importedId = await importProjectJSON(await exportProjectJSON(f.created.scope.projectId))
    const ownership = await resolveWorkspaceOwnership(importedId)
    const scope = { ...ownership.scope, worldGroupId: null }
    const after = await UNCACHED_CANON_RESOURCE_PROVIDER_V1.read({ scope, resourceKey: f.worldviewKeys.fields.races, depth: 'full', maxTokens: 10000 })
    expect(after.descriptor.sourceRefs[0].recordId).not.toBe(before.descriptor.sourceRefs[0].recordId)
    expect(after.descriptor.policyHash).toBe(before.descriptor.policyHash)
    expect(after.content).toBe(publicText)
    const closed = await UNCACHED_CANON_RESOURCE_PROVIDER_V1.read({ scope, resourceKey: f.worldviewKeys.fields.worldOrigin, depth: 'full', maxTokens: 10000 })
    const policy = createContextAccessPolicyForExecutionV1(resolveAgentSkillV1('prose', 'prose.generate'))
    expect(isContextResourceDiscoverableV1({ descriptor: closed.descriptor, policy })).toBe(false)
    expect(closed.content).toBe(hidden)
  })
})
