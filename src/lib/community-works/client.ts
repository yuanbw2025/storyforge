import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import * as tus from 'tus-js-client'
import type { CommunityPublicSnapshotV1 } from './public-snapshot'
import { assertUnchangedPublicSnapshotV1, type SealedPublicSnapshotV1 } from './snapshot-seal'

const MAX_BYTES = 32 * 1024 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export interface CommunityClientConfig {
  apiOrigin: string
  storageOrigin: string
  supabaseUrl: string
  publishableKey: string
}

/** No service-role key or private project settings may enter a client bundle. */
export function communityClientConfig(): CommunityClientConfig | null {
  if (import.meta.env.VITE_STORYFORGE_COMMUNITY_SHARING !== '1') return null
  const api = import.meta.env.VITE_STORYFORGE_COMMUNITY_API_URL
  const storage = import.meta.env.VITE_STORYFORGE_COMMUNITY_SUPABASE_URL
  const key = import.meta.env.VITE_STORYFORGE_COMMUNITY_SUPABASE_PUBLISHABLE_KEY
  if (!api || !storage || !key?.startsWith('sb_publishable_')) return null
  try {
    const apiUrl = new URL(api)
    const storageUrl = new URL(storage)
    if ([apiUrl, storageUrl].some(url => url.protocol !== 'https:' || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash)) return null
    return { apiOrigin: apiUrl.origin, storageOrigin: storageUrl.origin,
      supabaseUrl: storageUrl.origin, publishableKey: key }
  } catch { return null }
}

let authClient: SupabaseClient | null = null
export function communityAuth(): SupabaseClient | null {
  const config = communityClientConfig()
  if (!config || typeof window === 'undefined') return null
  if (!authClient) authClient = createClient(config.supabaseUrl, config.publishableKey, {
    auth: { flowType: 'pkce', detectSessionInUrl: false,
      storage: window.sessionStorage, storageKey: 'storyforge-community-auth-v1' },
  })
  return authClient
}

class CommunityRequestError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code === 'intake_paused' ? '社区投稿暂未开放。'
      : code === 'storage_capacity_paused' ? '社区存储容量接近上限，投稿暂时暂停。'
      : status === 401 ? '社区登录已过期，请重新验证邮箱。'
      : status === 413 ? '本次投稿超过服务预算。'
      : status === 429 ? '今日投稿次数已达上限，请稍后再试。'
      : `社区服务暂时无法完成请求（${code}）。`)
  }
}

async function requestJson<T>(config: CommunityClientConfig, path: string, token: string,
  body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(new URL(path, config.apiOrigin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store', signal,
  })
  let payload: unknown
  try { payload = await response.json() } catch { throw new CommunityRequestError(502, 'invalid_response') }
  if (!response.ok) {
    const error = payload as { error?: unknown }
    throw new CommunityRequestError(response.status, typeof error?.error === 'string' ? error.error : 'request_failed')
  }
  return payload as T
}

type Pending = { version: 1; sha256: string; key: string; sessionId?: string }
function pendingStorageKey(userId: string, sha256: string) {
  return `storyforge-community-pending-v1:${userId}:${sha256}`
}
function readPending(userId: string, sha256: string): Pending | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(pendingStorageKey(userId, sha256)) ?? 'null')
    const row = value as Partial<Pending> | null
    return row?.version === 1 && row.sha256 === sha256 && UUID.test(row.key ?? '') &&
      (row.sessionId === undefined || UUID.test(row.sessionId)) ? row as Pending : null
  } catch { return null }
}
function writePending(userId: string, pending: Pending) {
  localStorage.setItem(pendingStorageKey(userId, pending.sha256), JSON.stringify(pending))
}

async function submissionBySession(config: CommunityClientConfig, token: string, sessionId: string,
  signal?: AbortSignal): Promise<{ submissionId: string; status: string } | null> {
  try {
    const result = await requestJson<{ submissionId: string; status: string }>(config,
      `/api/community/v1/submission-status?sessionId=${sessionId}`, token, undefined, signal)
    if (!UUID.test(result.submissionId) || typeof result.status !== 'string') throw new Error('投稿回执格式无效')
    return result
  } catch (error) {
    if (error instanceof CommunityRequestError && error.status === 404) return null
    throw error
  }
}

function uploadSignedSnapshot(config: CommunityClientConfig, input: {
  endpoint: string; path: string; token: string; bytes: Uint8Array; sha256: string;
  onProgress?: (percentage: number) => void; signal?: AbortSignal
}): Promise<void> {
  const endpoint = new URL(input.endpoint)
  if (endpoint.origin !== config.storageOrigin || endpoint.pathname !== '/storage/v1/upload/resumable' ||
      !/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){2}snapshot\.json$/.test(input.path) ||
      !/^[0-9a-f]{64}$/.test(input.sha256) || !input.token) throw new Error('私有上传目标无效')
  const file = new File([input.bytes as BlobPart], `${input.sha256}.json`, { type: 'application/json' })
  return new Promise((resolve, reject) => {
    let stopped = false
    const upload = new tus.Upload(file, {
      endpoint: endpoint.toString(), chunkSize: 6 * 1024 * 1024,
      retryDelays: [0, 3000, 10000], uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      fingerprint: async () => `storyforge-community-v1:${input.path}:${input.sha256}:${endpoint.origin}`,
      headers: { 'x-signature': input.token },
      metadata: { bucketName: 'community-intake', objectName: input.path, contentType: 'application/json' },
      onProgress: (sent, total) => input.onProgress?.(Math.round(sent / total * 100)),
      onSuccess: () => { input.signal?.removeEventListener('abort', abort); resolve() },
      onError: error => { input.signal?.removeEventListener('abort', abort); reject(error) },
    })
    const abort = () => {
      if (stopped) return
      stopped = true
      void upload.abort(false).finally(() => reject(new DOMException('投稿已暂停', 'AbortError')))
    }
    if (input.signal?.aborted) return abort()
    input.signal?.addEventListener('abort', abort, { once: true })
    void upload.findPreviousUploads().then(previous => {
      if (stopped) return
      if (previous.length) upload.resumeFromPreviousUpload(previous[0])
      upload.start()
    }).catch(reject)
  })
}

/** The caller re-reads owned local rows after preview. Only the selected public snapshot leaves the device. */
export async function submitSelectedSnapshot(input: {
  seal: SealedPublicSnapshotV1
  currentSnapshot: () => Promise<CommunityPublicSnapshotV1>
  session: Session
  publicPenName: string
  license: 'all-rights-reserved' | 'cc-by-4.0'
  onProgress?: (percentage: number) => void
  signal?: AbortSignal
}): Promise<{ submissionId: string; status: string }> {
  const config = communityClientConfig()
  if (!config) throw new Error('社区投稿服务尚未配置。')
  if (!input.session.access_token || !UUID.test(input.session.user.id)) throw new Error('请先登录社区账号。')
  if (!input.publicPenName.trim() || input.publicPenName.length > 120) throw new Error('请填写公开笔名。')
  await assertUnchangedPublicSnapshotV1(input.seal, await input.currentSnapshot())
  const bytes = new TextEncoder().encode(JSON.stringify(input.seal.snapshot))
  if (bytes.byteLength !== input.seal.byteLength || bytes.byteLength > MAX_BYTES) throw new Error('公开内容超出单份投稿预算。')
  const userId = input.session.user.id
  let pending = readPending(userId, input.seal.sha256)
  if (!pending) {
    pending = { version: 1, sha256: input.seal.sha256, key: crypto.randomUUID() }
    writePending(userId, pending)
  }
  if (pending.sessionId) {
    const already = await submissionBySession(config, input.session.access_token, pending.sessionId, input.signal)
    if (already) { localStorage.removeItem(pendingStorageKey(userId, pending.sha256)); return already }
    // A completed upload can outlive the browser's lost success callback.
    // Ask the verifier about the known session before attempting a second transfer.
    try {
      const recovered = await requestJson<{ submissionId: string; status: string }>(config,
        '/api/community/v1/submissions', input.session.access_token, {
          sessionId: pending.sessionId, publicPenName: input.publicPenName.trim(),
          license: input.license, rightsConfirmed: true,
        }, input.signal)
      if (!UUID.test(recovered.submissionId) || !['submitted', 'human_review', 'approved', 'published'].includes(recovered.status)) {
        throw new Error('投稿回执格式无效')
      }
      localStorage.removeItem(pendingStorageKey(userId, pending.sha256))
      return recovered
    } catch (error) {
      if (!(error instanceof CommunityRequestError && error.status === 409 && error.code === 'upload_not_complete')) throw error
    }
  }
  const allocation = await requestJson<{ sessionId: string; signedUrl: string; token: string;
    tusEndpoint: string; objectPath: string; sha256: string; byteLength: number }>(config,
      '/api/community/v1/upload-sessions', input.session.access_token, {
        kind: input.seal.snapshot.kind, sha256: input.seal.sha256,
        byteLength: bytes.byteLength, idempotencyKey: pending.key,
      }, input.signal)
  const signed = new URL(allocation.signedUrl)
  if (!UUID.test(allocation.sessionId) || allocation.sha256 !== pending.sha256 ||
      allocation.byteLength !== bytes.byteLength ||
      allocation.objectPath !== `${userId}/${allocation.sessionId}/snapshot.json` ||
      signed.origin !== config.storageOrigin ||
      signed.pathname !== `/storage/v1/object/upload/sign/community-intake/${allocation.objectPath}` ||
      signed.searchParams.get('token') !== allocation.token) {
    throw new Error('社区服务返回的上传会话不匹配。')
  }
  pending.sessionId = allocation.sessionId
  writePending(userId, pending)
  await uploadSignedSnapshot(config, { endpoint: allocation.tusEndpoint, path: allocation.objectPath,
    token: allocation.token, bytes, sha256: pending.sha256, onProgress: input.onProgress, signal: input.signal })
  try {
    const result = await requestJson<{ submissionId: string; status: string }>(config,
      '/api/community/v1/submissions', input.session.access_token, {
        sessionId: allocation.sessionId, publicPenName: input.publicPenName.trim(),
        license: input.license, rightsConfirmed: true,
      }, input.signal)
    if (!UUID.test(result.submissionId) || result.status !== 'submitted') throw new Error('投稿回执格式无效')
    localStorage.removeItem(pendingStorageKey(userId, pending.sha256))
    return result
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    const found = await submissionBySession(config, input.session.access_token, allocation.sessionId, input.signal)
    if (found) { localStorage.removeItem(pendingStorageKey(userId, pending.sha256)); return found }
    throw error
  }
}

export async function readMySubmissionStatus(session: Session, id: string) {
  const config = communityClientConfig()
  if (!config || !UUID.test(id)) throw new Error('投稿状态查询不可用。')
  return requestJson<{ submissionId: string; status: string }>(config,
    `/api/community/v1/submission-status?id=${id}`, session.access_token)
}

export interface CommunitySubmissionRow {
  id: string
  kind: 'novel' | 'book-analysis'
  status: string
  sha256: string
  created_at: string
  updated_at: string
}

export async function readMySubmissions(session: Session): Promise<CommunitySubmissionRow[]> {
  const config = communityClientConfig()
  if (!config) throw new Error('社区投稿服务尚未配置。')
  const result = await requestJson<{ items: unknown }>(config,
    '/api/community/v1/my-submissions', session.access_token)
  if (!Array.isArray(result.items) || result.items.length > 50 || result.items.some(row =>
    !row || !UUID.test(row.id) || !['novel', 'book-analysis'].includes(row.kind) ||
    typeof row.status !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256) ||
    typeof row.created_at !== 'string' || typeof row.updated_at !== 'string')) {
    throw new Error('社区投稿列表格式无效。')
  }
  return result.items as CommunitySubmissionRow[]
}

export async function actOnMySubmission(session: Session, row: CommunitySubmissionRow,
  action: 'withdraw' | 'appeal', reason?: string): Promise<{ status: string }> {
  const config = communityClientConfig()
  if (!config || !UUID.test(row.id) || !/^[0-9a-f]{64}$/.test(row.sha256)) {
    throw new Error('社区投稿操作不可用。')
  }
  if (action === 'appeal' && (!reason?.trim() || reason.length > 2000)) {
    throw new Error('请填写不超过 2000 字的申诉理由。')
  }
  const result = await requestJson<{ status: string }>(config,
    '/api/community/v1/submission-action', session.access_token, {
      submissionId: row.id, revisionSha256: row.sha256, action,
      ...(action === 'appeal' ? { reason: reason!.trim() } : {}),
    })
  if (result.status !== (action === 'appeal' ? 'open' : 'withdrawn')) {
    throw new Error('社区操作回执格式无效。')
  }
  return result
}
