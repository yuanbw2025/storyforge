import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope, ChatComposerDraftV1} from '../../lib/types'
import {readChatComposerDraftV1, saveChatComposerDraftV1, type ChatComposerSendBindingV1} from '../../lib/character-interaction/runtime-api'
import {ChatComposerConflictError, chatComposerContentEqualV1} from '../../lib/character-interaction/composer-draft-contract'

type Entry = {
  scope: WorkspaceScope; sessionId: number; text: string; saved: ChatComposerDraftV1 | null
  audienceKeys?: string[] | null
  loading: boolean; pending: number; sending: boolean; error: string
  conflict: ChatComposerDraftV1 | null | undefined; queue: Promise<void>; writeEpoch: number
}
const message = (cause: unknown) => cause instanceof Error ? cause.message : '草稿保存失败，请保留页面中的文字后重试。'

/** UI cache only. Every durable write uses the session-owned CAS boundary. */
export function useChatComposerDraft(scope: WorkspaceScope | undefined, sessionId: number | null) {
  const entries = useRef(new Map<string, Entry>()).current
  const mounted = useRef(false)
  const [, redraw] = useState(0)
  const key = scope && sessionId != null ? `${scope.projectId}:${scope.worldId}:${scope.workId}:${sessionId}` : ''
  const notify = () => {if (mounted.current) redraw(value => value + 1)}
  useEffect(() => {
    mounted.current = true
    const warn = (event: BeforeUnloadEvent) => {
      if ([...entries.values()].some(row => row.pending || !chatComposerContentEqualV1(row, row.saved))) {
        event.preventDefault(); event.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', warn)
    return () => {mounted.current = false; window.removeEventListener('beforeunload', warn)}
  }, [entries])
  useEffect(() => {
    if (!scope || sessionId == null || entries.has(key)) return
    const row: Entry = {scope: {...scope}, sessionId, text: '', saved: null, loading: true, pending: 0, sending: false, error: '', conflict: undefined, queue: Promise.resolve(), writeEpoch: 0}
    entries.set(key, row)
    row.queue = readChatComposerDraftV1(row.scope, row.sessionId).then(saved => {row.saved = saved; row.text = saved?.text ?? ''; row.audienceKeys = saved?.audienceKeys == null ? saved?.audienceKeys : [...saved.audienceKeys]})
      .catch(cause => {row.error = message(cause)}).finally(() => {row.loading = false; if (mounted.current) redraw(value => value + 1)})
    redraw(value => value + 1)
    // The stable key contains all scope fields and the session identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, key])
  const entry = entries.get(key)
  const enqueue = (row: Entry) => {
    const text = row.text, epoch = row.writeEpoch
    const audience = row.audienceKeys === undefined ? {} : {audienceKeys: row.audienceKeys === null ? null : [...row.audienceKeys]}
    row.pending++
    row.queue = row.queue.then(async () => {
      if (epoch !== row.writeEpoch || row.error || row.conflict !== undefined) return
      row.saved = await saveChatComposerDraftV1({scope: row.scope, sessionId: row.sessionId, text, ...audience, expectedRevision: row.saved?.revision ?? 0})
    }).catch(cause => {
      row.writeEpoch++
      if (cause instanceof ChatComposerConflictError) row.conflict = cause.current
      row.error = message(cause)
    }).finally(() => {row.pending--; notify()})
    notify()
  }
  const change = (text: string) => {if (entry && !entry.loading && !entry.sending) {entry.text = text; enqueue(entry)}}
  const changeAudience = (audienceKeys: string[] | null) => {
    if (entry && !entry.loading && !entry.sending) {entry.audienceKeys = audienceKeys === null ? null : [...audienceKeys]; enqueue(entry)}
  }
  const resolve = (keepLocal: boolean) => {
    if (!entry || entry.conflict === undefined) return
    entry.writeEpoch++
    entry.saved = entry.conflict; entry.conflict = undefined; entry.error = ''
    if (keepLocal) enqueue(entry)
    else {entry.text = entry.saved?.text ?? ''; entry.audienceKeys = entry.saved?.audienceKeys == null ? entry.saved?.audienceKeys : [...entry.saved.audienceKeys]; notify()}
  }
  const retry = async () => {
    if (!entry) return
    await entry.queue
    entry.writeEpoch++
    entry.loading = true; notify()
    try {
      const current = await readChatComposerDraftV1(entry.scope, entry.sessionId)
      if ((current?.revision ?? 0) !== (entry.saved?.revision ?? 0) && !chatComposerContentEqualV1(entry, current)) {
        entry.conflict = current; entry.error = new ChatComposerConflictError(current).message
      } else {
        entry.saved = current; entry.error = ''; entry.conflict = undefined
        if (!chatComposerContentEqualV1(entry, current)) enqueue(entry)
      }
    } catch (cause) {entry.error = message(cause)}
    finally {entry.loading = false; notify()}
  }
  const prepareSend = async () => {
    const row = entry
    if (!row || row.loading || row.sending) throw new Error('请等待输入草稿读取或保存完成。')
    row.sending = true; notify()
    try {
      await row.queue
      if (row.error || row.conflict !== undefined) throw new Error(row.error || '请先选择要发送的草稿版本。')
      if (!row.saved || !chatComposerContentEqualV1(row, row.saved) || !row.text.trim()) throw new Error('草稿尚未保存，不能发送。')
      const binding: ChatComposerSendBindingV1 = {scope: row.scope, sessionId: row.sessionId, text: row.text, revision: row.saved.revision,
        ...(row.saved.audienceKeys !== undefined ? {audienceKeys: row.saved.audienceKeys === null ? null : [...row.saved.audienceKeys]} : {})}
      return {binding, onCommitted: () => {
        row.saved = {...row.saved!, text: '', revision: binding.revision + 1, updatedAt: Date.now()}; row.text = ''; notify()
      }, onFailed: (cause: unknown) => {
        if (!(cause instanceof ChatComposerConflictError)) return false
        row.writeEpoch++; row.conflict = cause.current; row.error = cause.message; notify(); return true
      }, finish: () => {row.sending = false; notify()}}
    } catch (cause) {row.sending = false; notify(); throw cause}
  }
  return {text: entry?.text ?? '', audienceKeys: entry?.audienceKeys, loading: !entry || entry.loading, saving: !!entry?.pending, sending: !!entry?.sending,
    saved: !!entry?.saved && !entry.error && entry.conflict === undefined && !entry.pending && chatComposerContentEqualV1(entry, entry.saved),
    error: entry?.error ?? '', conflict: entry?.conflict, change, changeAudience, retry, resolve, prepareSend}
}
