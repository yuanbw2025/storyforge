import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {db} from '../../src/lib/db/schema'
import {seedChatNarrativeRuntimeFixture} from '../helpers/chat-narrative-fixture'
import {saveChatComposerDraftV1, readChatComposerDraftV1, commitInteractionPlayerMessage, readProductRuntimeStateVersion, readProductRuntimeState, branchProductRuntimeSession, deleteProductRuntimeSession, leaveInteractionParticipant} from '../../src/lib/character-interaction/runtime-api'
import {ChatComposerConflictError} from '../../src/lib/character-interaction/composer-draft-contract'
import {exportProjectJSON, importProjectJSON} from '../../src/lib/export/json-export'
import {assembleContext} from '../../src/lib/registry/assemble-context'
import {useProjectStore} from '../../src/stores/project'

beforeEach(async () => {db.close(); await db.delete(); await db.open()})
afterEach(() => {vi.restoreAllMocks(); db.close()})
async function ready(text = '  尚未发送的独立想法\n保留空白。  ') {
  const f = await seedChatNarrativeRuntimeFixture()
  const draft = await saveChatComposerDraftV1({...f, expectedRevision: 0, text})
  const v = await readProductRuntimeStateVersion(f.sessionId)
  const binding = {scope: f.scope, sessionId: f.sessionId, revision: draft.revision, text: draft.text}
  const command = {sessionId: f.sessionId, commandId: 'send-draft', messageId: 'sent-draft', text: text.trim(), baseSequence: v.sequence, baseStateHash: v.stateHash, composerDraft: binding}
  return {...f, draft, command}
}

it('keeps unsent text out of story state, events, source contexts and new branches, and survives database reopen', async () => {
  const f = await seedChatNarrativeRuntimeFixture(), before = await readProductRuntimeStateVersion(f.sessionId)
  const worlds = await db.worldReleases.toArray(), events = await db.productRuntimeEvents.toArray()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toBeNull()
  const draft = await saveChatComposerDraftV1({...f, expectedRevision: 0, text: '只写在输入框里的话\n还没发给任何人'})
  expect(await readProductRuntimeStateVersion(f.sessionId)).toEqual(before)
  expect(await db.productRuntimeEvents.toArray()).toEqual(events)
  const context = await assembleContext({scope: f.scope, projectId: f.scope.projectId, productRuntimeSessionId: f.sessionId, interactionParticipantKey: 'guard', sourceKeys: ['interactionRuntime'], inputBudgetMaxTokens: 20000})
  expect(context.included).toContain('interactionRuntime')
  expect(context.text).not.toContain(draft.text)
  const branch = await branchProductRuntimeSession({parentSessionId: f.sessionId, throughSequence: before.sequence, title: '未带入输入草稿的分支'})
  expect(await readChatComposerDraftV1(f.scope, branch.id!)).toBeNull()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(draft)
  db.close(); await db.open()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(draft)
  expect(await db.worldReleases.toArray()).toEqual(worlds)
})
it('uses a compare-and-swap revision so concurrent editors cannot silently overwrite each other', async () => {
  const f = await ready(), results = await Promise.allSettled([
    saveChatComposerDraftV1({...f, expectedRevision: 1, text: '来自页面一'}),
    saveChatComposerDraftV1({...f, expectedRevision: 1, text: '来自页面二'}),
  ])
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
  const failure = results.find(r => r.status === 'rejected') as PromiseRejectedResult
  expect(failure.reason).toBeInstanceOf(ChatComposerConflictError)
  const current = (await readChatComposerDraftV1(f.scope, f.sessionId))!
  expect(current.revision).toBe(2)
  expect(failure.reason.current).toEqual(current)
})
it('freezes caller input across async writes and rejects oversized text or ended sessions without replacing the last draft', async () => {
  const f = await ready(), input = {scope: {...f.scope}, sessionId: f.sessionId, expectedRevision: 1, text: '已提交的保存意图'}
  const pending = saveChatComposerDraftV1(input)
  input.scope.workId = 999; input.expectedRevision = 99; input.text = '后来改掉的参数'
  const saved = await pending
  expect(saved).toMatchObject({text: '已提交的保存意图', revision: 2})
  await expect(saveChatComposerDraftV1({...f, expectedRevision: 2, text: 'x'.repeat(12001)})).rejects.toThrow('长度')
  await db.productRuntimeSessions.update(f.sessionId, {status: 'archived'})
  await expect(saveChatComposerDraftV1({...f, expectedRevision: 2, text: '不能写入'})).rejects.toThrow('归档')
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(saved)
})
it('consumes exactly the saved revision in the same transaction as the message, with idempotent repeat and no loss of a newer draft', async () => {
  const f = await ready(), event = await commitInteractionPlayerMessage(f.command)
  expect((await readChatComposerDraftV1(f.scope, f.sessionId))!).toMatchObject({text: '', revision: 2})
  const next = await saveChatComposerDraftV1({...f, expectedRevision: 2, text: '下一条尚未发送的文字'})
  expect(await commitInteractionPlayerMessage(f.command)).toEqual(event)
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(next)
  const messages = (await readProductRuntimeState(f.sessionId)).interaction!.messages
  expect(messages.filter(row => row.messageId === f.command.messageId)).toHaveLength(1)
  expect(messages.find(row => row.messageId === f.command.messageId)!.text).toBe(f.draft.text.trim())
})
it('rejects outdated, foreign and mismatched send bindings before recording a message or clearing a draft', async () => {
  const f = await ready(), foreign = await seedChatNarrativeRuntimeFixture()
  for (const command of [
    {...f.command, composerDraft: {...f.command.composerDraft, revision: 999}},
    {...f.command, composerDraft: {...f.command.composerDraft, scope: foreign.scope}},
    {...f.command, composerDraft: {...f.command.composerDraft, sessionId: foreign.sessionId}},
    {...f.command, text: '替换了准备发送的文字'},
  ]) await expect(commitInteractionPlayerMessage(command)).rejects.toThrow()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(f.draft)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  await expect(readChatComposerDraftV1(foreign.scope, f.sessionId)).rejects.toThrow()
  await expect(saveChatComposerDraftV1({...f, scope: foreign.scope, expectedRevision: 1, text: 'foreign'})).rejects.toThrow()
})
it('rolls back message insertion when draft consumption cannot persist, retaining the original text for retry', async () => {
  const f = await ready(), update = db.productRuntimeSessions.update.bind(db.productRuntimeSessions)
  const spy = vi.spyOn(db.productRuntimeSessions, 'update').mockImplementation(async (key, changes) => {
    if (typeof changes === 'object' && 'chatComposerDraft' in changes && changes.chatComposerDraft?.text === '') throw new Error('isolated disk failure')
    return update(key, changes)
  })
  await expect(commitInteractionPlayerMessage(f.command)).rejects.toThrow('isolated disk failure')
  spy.mockRestore()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(f.draft)
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  await commitInteractionPlayerMessage(f.command)
  expect((await readChatComposerDraftV1(f.scope, f.sessionId))!.text).toBe('')
})
it('keeps drafts with their remapped session through backups and deletes them with the session or project', async () => {
  const f = await ready(), projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  const scope = {projectId, worldId: session.worldId, workId: session.workId}
  expect(session.id).not.toBe(f.sessionId)
  expect(await readChatComposerDraftV1(scope, session.id!)).toEqual(f.draft)
  await deleteProductRuntimeSession(session.id!)
  await expect(readChatComposerDraftV1(scope, session.id!)).rejects.toThrow()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(f.draft)
  await useProjectStore.getState().deleteProject(f.scope.projectId)
  expect(await db.productRuntimeSessions.get(f.sessionId)).toBeUndefined()
})
it.each([null, {version: 1, text: 'bad', revision: 0, updatedAt: 0}, {version: 1, text: 'x'.repeat(12001), revision: 1, updatedAt: 0}])('rejects a malformed imported draft without changing the existing project: case %#', async invalid => {
  const f = await ready(), backup = await exportProjectJSON(f.scope.projectId)
  Object.assign(backup.productRuntimeSessions[0], {chatComposerDraft: invalid})
  const count = await db.projects.count()
  await expect(importProjectJSON(backup)).rejects.toThrow('草稿')
  expect(await db.projects.count()).toBe(count)
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(f.draft)
})
it('imports older backups without inventing drafts and rejects cross-product draft injection', async () => {
  const f = await ready(), backup = await exportProjectJSON(f.scope.projectId)
  const foreign = structuredClone(backup)
  Object.assign(foreign.productRuntimeSessions[0], {kind: 'ai-town'})
  await expect(importProjectJSON(foreign)).rejects.toThrow('聊天输入草稿不能归入其他产品')
  delete backup.productRuntimeSessions[0].chatComposerDraft
  const projectId = await importProjectJSON(backup)
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  expect(await readChatComposerDraftV1({projectId, workId: session.workId, worldId: session.worldId}, session.id!)).toBeNull()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(f.draft)
})

it('binds private recipients to the saved text, rejects widened or stale sends and preserves the recipient after send', async () => {
  const f = await ready('只对守卫说的话')
  const audienceKeys = ['guard']
  const saving = saveChatComposerDraftV1({...f, expectedRevision: 1, text: f.draft.text, audienceKeys})
  audienceKeys.push('artisan')
  const saved = await saving
  expect(saved.audienceKeys).toEqual(['guard'])
  const binding = {...f.command.composerDraft, revision: 2, audienceKeys: ['guard']}
  for (const command of [f.command, {...f.command, composerDraft: binding},
    {...f.command, audienceKeys: ['guard'], composerDraft: {...binding, audienceKeys: null}}]) {
    await expect(commitInteractionPlayerMessage(command)).rejects.toBeInstanceOf(ChatComposerConflictError)
  }
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages).toHaveLength(0)
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(saved)
  await commitInteractionPlayerMessage({...f.command, audienceKeys: ['guard'], composerDraft: binding})
  expect((await readProductRuntimeState(f.sessionId)).interaction!.messages[0].audienceKeys).toEqual(['player', 'guard'])
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toMatchObject({text: '', audienceKeys: ['guard'], revision: 3})
})
it('does not widen a private draft through a text-only save and requires an explicit public selection', async () => {
  const f = await ready()
  await saveChatComposerDraftV1({...f, expectedRevision: 1, text: '私聊内容', audienceKeys: ['guard']})
  expect(await saveChatComposerDraftV1({...f, expectedRevision: 2, text: '修改私聊内容'})).toMatchObject({audienceKeys: ['guard']})
  expect(await saveChatComposerDraftV1({...f, expectedRevision: 3, text: '改为在场人可见', audienceKeys: null})).toMatchObject({audienceKeys: null})
})
it('retains private drafts through absence, reopening and import without granting an absent role a message', async () => {
  const f = await ready(), v = await readProductRuntimeStateVersion(f.sessionId)
  await leaveInteractionParticipant({sessionId: f.sessionId, commandId: 'draft-recipient-leaves', baseSequence: v.sequence, baseStateHash: v.stateHash, participantKey: 'guard'})
  const saved = await saveChatComposerDraftV1({...f, expectedRevision: 1, text: '等守卫回来再说', audienceKeys: ['guard']})
  const version = await readProductRuntimeStateVersion(f.sessionId)
  await expect(commitInteractionPlayerMessage({...f.command, baseSequence: version.sequence, baseStateHash: version.stateHash,
    text: saved.text, audienceKeys: ['guard'], composerDraft: {...f.command.composerDraft, text: saved.text, revision: 2, audienceKeys: ['guard']}})).rejects.toThrow('当前在场')
  db.close(); await db.open()
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(saved)
  const projectId = await importProjectJSON(await exportProjectJSON(f.scope.projectId))
  const session = (await db.productRuntimeSessions.where('projectId').equals(projectId).first())!
  expect(await readChatComposerDraftV1({projectId, worldId: session.worldId, workId: session.workId}, session.id!)).toEqual(saved)
  expect((await readProductRuntimeState(session.id!)).interaction!.messages).toHaveLength(0)
})
it.each([[], ['guard', 'guard'], ['player'], ['foreign'], [' guard']].map(audienceKeys => ({audienceKeys})))('rejects invalid draft recipients in saves and imports without partial writes: $audienceKeys', async ({audienceKeys}) => {
  const f = await ready()
  await expect(saveChatComposerDraftV1({...f, expectedRevision: 1, text: 'bad', audienceKeys})).rejects.toThrow('草稿')
  const backup = await exportProjectJSON(f.scope.projectId), count = await db.projects.count()
  backup.productRuntimeSessions[0].chatComposerDraft = {...f.draft, audienceKeys}
  await expect(importProjectJSON(backup)).rejects.toThrow('草稿')
  expect(await db.projects.count()).toBe(count)
  expect(await readChatComposerDraftV1(f.scope, f.sessionId)).toEqual(f.draft)
})
