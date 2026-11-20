import { feedbackStoreSchema, type FeedbackRecord } from './followup-contract'

export const FEEDBACK_FOLLOWUP_KEY = 'storyforge_feedback_followup_v1'
export const FEEDBACK_FOLLOWUP_EVENT = 'storyforge-feedback-followup-change'
type Snapshot = { entries: FeedbackRecord[]; error: string }
let rawCache: string | null | undefined
let snapshot: Snapshot = { entries: [], error: '' }
export function feedbackSnapshot(): Snapshot {
  try {
    const raw = localStorage.getItem(FEEDBACK_FOLLOWUP_KEY)
    if (raw === rawCache) return snapshot
    rawCache = raw
    snapshot = { entries: raw ? feedbackStoreSchema.parse(JSON.parse(raw)).entries : [], error: '' }
  } catch { rawCache = undefined; if (!snapshot.error) snapshot = { entries: [], error: '本机反馈记录无法读取，原记录未覆盖。请检查浏览器存储。' } }
  return snapshot
}
export function subscribeFeedback(listener: () => void) {
  const storage = (event: StorageEvent) => { if (!event.key || event.key === FEEDBACK_FOLLOWUP_KEY) { rawCache = undefined; listener() } }
  window.addEventListener(FEEDBACK_FOLLOWUP_EVENT, listener)
  window.addEventListener('storage', storage)
  return () => { window.removeEventListener(FEEDBACK_FOLLOWUP_EVENT, listener); window.removeEventListener('storage', storage) }
}
/** The dedicated metadata key never contains works, screenshots or operator credentials. */
export async function changeFeedback(change: (entries: FeedbackRecord[]) => FeedbackRecord[]) {
  if (!navigator.locks?.request) throw new Error('当前环境不支持安全保存反馈跟进。可取消接收进展后提交反馈。')
  await navigator.locks.request('storyforge-feedback-metadata-v1', async () => {
    const raw = localStorage.getItem(FEEDBACK_FOLLOWUP_KEY)
    const entries = raw ? feedbackStoreSchema.parse(JSON.parse(raw)).entries : []
    const next = feedbackStoreSchema.parse({ version: 1, entries: change(entries) })
    localStorage.setItem(FEEDBACK_FOLLOWUP_KEY, JSON.stringify(next))
    rawCache = undefined
    window.dispatchEvent(new Event(FEEDBACK_FOLLOWUP_EVENT))
  })
}
export function createFeedbackToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('')
}
export async function rememberFeedback(id: string, token: string, title: string) {
  await changeFeedback(entries => {
    const current = entries.find(row => row.id === id)
    if (current) {
      if (current.token !== token) throw new Error('反馈凭据不一致，原记录已保留。')
      return entries
    }
    if (entries.length >= 50) throw new Error('本机反馈记录已满，请先清理已结束的记录。')
    return [...entries, { id, token, title, createdAt: Date.now(), state: 'pending', readRevision: 0, notifiedRevision: 0, failures: 0, nextCheckAt: 0 }]
  })
}
export async function acknowledgeFeedback(id: string) {
  await changeFeedback(entries => entries.map(row => row.id === id && row.state === 'pending' ? { ...row, state: 'active', nextCheckAt: 0 } : row))
}
export async function rememberFeedbackNotices(notices: { id: string; revision: number }[]) {
  await changeFeedback(entries => entries.map(row => {
    const notice = notices.find(item => item.id === row.id)
    return notice ? { ...row, notifiedRevision: Math.max(row.notifiedRevision, notice.revision) } : row
  }))
}
