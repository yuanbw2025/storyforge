import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import type {ChatComposerDraftV1} from '../../src/lib/types'
import {ChatComposerConflictError} from '../../src/lib/character-interaction/composer-draft-contract'
import {useChatComposerDraft} from '../../src/components/character-interaction/useChatComposerDraft'

const mocks = vi.hoisted(() => ({read: vi.fn(), save: vi.fn()}))
vi.mock('../../src/lib/character-interaction/runtime-api', () => ({readChatComposerDraftV1: mocks.read, saveChatComposerDraftV1: mocks.save}))
let root: Root, host: HTMLDivElement, api: ReturnType<typeof useChatComposerDraft>
const scope = {projectId: 1, worldId: 2, workId: 3}
const draft = (text: string, revision: number): ChatComposerDraftV1 => ({version: 1, text, revision, updatedAt: 1})
function Harness({sessionId = 4}: {sessionId?: number}) {api = useChatComposerDraft(scope, sessionId); return createElement('span', null, api.text)}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void
  const promise = new Promise<T>((yes, no) => {resolve = yes; reject = no})
  return {promise, resolve, reject}
}
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  mocks.read.mockReset().mockResolvedValue(null)
  mocks.save.mockReset().mockImplementation(async ({text, expectedRevision, audienceKeys}) => ({...draft(text, expectedRevision + 1), ...(audienceKeys !== undefined ? {audienceKeys} : {})}))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => {root.render(createElement(Harness))})
})
afterEach(async () => {await act(async () => {root.unmount()}); host.remove(); vi.unstubAllGlobals()})

it.each([false, true])('queued edits cannot overwrite a conflict choice (keep local: %s)', async keepLocal => {
  const save = deferred<ChatComposerDraftV1>(); mocks.save.mockImplementationOnce(() => save.promise)
  await act(async () => {api.change('先输入的字'); api.change('最后选择的本地文字')})
  expect(mocks.save).toHaveBeenCalledTimes(1); expect(api.text).toBe('最后选择的本地文字')
  const remote = draft('另一页保存的字', 8)
  await act(async () => {save.reject(new ChatComposerConflictError(remote))})
  expect(api.conflict).toEqual(remote); expect(api.error).toContain('另一页面')
  await act(async () => {api.resolve(keepLocal)})
  expect(api.error).toBe(''); expect(api.saved).toBe(true)
  expect(api.text).toBe(keepLocal ? '最后选择的本地文字' : remote.text)
  expect(mocks.save).toHaveBeenCalledTimes(keepLocal ? 2 : 1)
  if (keepLocal) expect(mocks.save).toHaveBeenLastCalledWith({scope, sessionId: 4, text: '最后选择的本地文字', expectedRevision: 8})
})
it('does not clear input before a commit acknowledgment and clears it even if later page refresh fails', async () => {
  await act(async () => {api.change('  正式准备发送  ')})
  let send!: Awaited<ReturnType<typeof api.prepareSend>>
  await act(async () => {send = await api.prepareSend()})
  expect(api.sending).toBe(true); expect(api.text).toBe('  正式准备发送  ')
  expect(send.binding).toMatchObject({scope, sessionId: 4, text: api.text, revision: 1})
  await act(async () => {send.onCommitted(); send.onFailed(new Error('page refresh failed')); send.finish()})
  expect(api.text).toBe(''); expect(api.sending).toBe(false)
  expect(mocks.save).toHaveBeenCalledTimes(1) // Clearing belongs to the atomic message transaction.
})
it('retains text when persistence fails, checks the current revision on explicit retry, and does not issue blind retries', async () => {
  mocks.save.mockRejectedValueOnce(new Error('disk unavailable'))
  await act(async () => {api.change('失败时保留的文字')})
  expect(api.error).toBe('disk unavailable'); expect(api.text).toBe('失败时保留的文字')
  await act(async () => {api.change('失败后继续编辑的文字')})
  expect(mocks.save).toHaveBeenCalledTimes(1)
  mocks.read.mockResolvedValueOnce(draft('另一个页面的新内容', 3))
  await act(async () => {await api.retry()})
  expect(api.conflict?.text).toBe('另一个页面的新内容'); expect(api.text).toBe('失败后继续编辑的文字')
  expect(mocks.save).toHaveBeenCalledTimes(1)
})
it('keeps late loads and queued saves attached to their original session', async () => {
  const read = deferred<ChatComposerDraftV1 | null>(), save = deferred<ChatComposerDraftV1>()
  mocks.save.mockImplementationOnce(() => save.promise)
  await act(async () => {api.change('原存档草稿')})
  mocks.read.mockImplementationOnce(() => read.promise)
  await act(async () => {root.render(createElement(Harness, {sessionId: 5}))})
  expect(api.loading).toBe(true); expect(api.text).toBe('')
  await act(async () => {save.resolve(draft('原存档草稿', 1)); read.resolve(draft('另一个存档草稿', 2))})
  expect(api.text).toBe('另一个存档草稿')
  await act(async () => {root.render(createElement(Harness, {sessionId: 4}))})
  expect(api.text).toBe('原存档草稿'); expect(api.saved).toBe(true)
  expect(mocks.save).toHaveBeenCalledWith({scope, sessionId: 4, text: '原存档草稿', expectedRevision: 0})
})
it('restores and freezes private recipients with text through queued saves and a committed send', async () => {
  mocks.read.mockResolvedValueOnce({...draft('私聊草稿', 4), audienceKeys: ['guard']})
  await act(async () => {root.render(createElement(Harness, {sessionId: 6}))})
  expect(api.audienceKeys).toEqual(['guard'])
  const save = deferred<ChatComposerDraftV1>(); mocks.save.mockImplementationOnce(() => save.promise)
  await act(async () => {api.change('仍然私聊'); api.changeAudience(null)})
  expect(mocks.save.mock.calls[0][0]).toMatchObject({text: '仍然私聊', audienceKeys: ['guard']})
  await act(async () => {save.resolve({...draft('仍然私聊', 5), audienceKeys: ['guard']})})
  expect(mocks.save.mock.calls[1][0]).toMatchObject({text: '仍然私聊', audienceKeys: null})
  await act(async () => {api.changeAudience(['guard'])})
  let send!: Awaited<ReturnType<typeof api.prepareSend>>
  await act(async () => {send = await api.prepareSend()})
  expect(send.binding.audienceKeys).toEqual(['guard'])
  await act(async () => {api.changeAudience(null); send.onCommitted(); send.finish()})
  expect(api.audienceKeys).toEqual(['guard']); expect(api.text).toBe('')
})
it.each([false, true])('resolves recipient-only conflicts even when the text matches (keep local: %s)', async keepLocal => {
  await act(async () => {api.change('相同文字')})
  mocks.save.mockRejectedValueOnce(new Error('disk unavailable'))
  await act(async () => {api.changeAudience(['guard'])})
  mocks.read.mockResolvedValueOnce({...draft('相同文字', 9), audienceKeys: ['artisan']})
  await act(async () => {await api.retry()})
  expect(api.conflict?.audienceKeys).toEqual(['artisan'])
  expect(api.audienceKeys).toEqual(['guard'])
  await act(async () => {api.resolve(keepLocal)})
  expect(api.audienceKeys).toEqual(keepLocal ? ['guard'] : ['artisan'])
  expect(api.saved).toBe(true)
})
