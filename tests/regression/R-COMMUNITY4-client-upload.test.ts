import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@supabase/supabase-js'
import { actOnMySubmission, communityClientConfig, readMySubmissions, submitSelectedSnapshot } from '../../src/lib/community-works/client'
import { sealPublicSnapshotV1 } from '../../src/lib/community-works/snapshot-seal'
import type { NovelPublicSnapshotV1 } from '../../src/lib/community-works/public-snapshot'

const userId = '11111111-1111-4111-8111-111111111111'
const uploadId = '22222222-2222-4222-8222-222222222222'
const submissionId = '33333333-3333-4333-8333-333333333333'
const session = { access_token: 'x'.repeat(80), user: { id: userId } } as Session
const snapshot: NovelPublicSnapshotV1 = {
  schemaVersion: 1, kind: 'novel', title: '小说', description: '公开简介', genres: [],
  chapters: [{ title: '第一章', content: '只选择这一章的正文' }],
}

beforeEach(() => {
  localStorage.clear()
  vi.stubEnv('VITE_STORYFORGE_COMMUNITY_SHARING', '1')
  vi.stubEnv('VITE_STORYFORGE_COMMUNITY_API_URL', 'https://gallery.example/')
  vi.stubEnv('VITE_STORYFORGE_COMMUNITY_SUPABASE_URL', 'https://auth.example/')
  vi.stubEnv('VITE_STORYFORGE_COMMUNITY_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test')
  vi.stubEnv('VITE_STORYFORGE_COMMUNITY_R2_ORIGIN', `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/`)
  vi.stubEnv('VITE_STORYFORGE_COMMUNITY_R2_BUCKET', 'storyforge-intake')
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })

describe('community upload client', () => {
  it('stays disabled unless all explicit public endpoint settings are present', () => {
    expect(communityClientConfig()?.apiOrigin).toBe('https://gallery.example')
    vi.stubEnv('VITE_STORYFORGE_COMMUNITY_SHARING', '0')
    expect(communityClientConfig()).toBeNull()
  })

  it('refuses a local edit after preview before sending any data', async () => {
    const seal = await sealPublicSnapshotV1(snapshot)
    const network = vi.spyOn(globalThis, 'fetch')
    await expect(submitSelectedSnapshot({ seal, currentSnapshot: async () => ({
      ...snapshot, chapters: [{ title: '第一章', content: '修改后的正文' }],
    }), session, publicPenName: '作者', license: 'all-rights-reserved' })).rejects.toThrow('重新预览')
    expect(network).not.toHaveBeenCalled()
  })

  it('sends only a manifest through Vercel, uploads the selected bytes privately, then receives a pending receipt', async () => {
    const seal = await sealPublicSnapshotV1(snapshot)
    const uploaded: string[] = []
    vi.stubGlobal('XMLHttpRequest', class {
      status = 200
      upload = { onprogress: (_event: ProgressEvent) => {} }
      onload = () => {}
      onerror = () => {}
      onabort = () => {}
      open(method: string, url: string) {
        expect(method).toBe('PUT')
        expect(url).toContain(`/storyforge-intake/${userId}/${uploadId}/snapshot.json`)
      }
      setRequestHeader(name: string, value: string) {
        expect([name, value]).toEqual(['Content-Type', 'application/json'])
      }
      send(body: Blob) { void body.text().then(text => { uploaded.push(text); this.onload() }) }
      abort() { this.onabort() }
    })
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/upload-sessions')) {
        expect(String(init?.body)).not.toContain('只选择这一章的正文')
        expect(JSON.parse(String(init?.body)).sha256).toBe(seal.sha256)
        return Response.json({ sessionId: uploadId,
          signedUrl: `https://${'a'.repeat(32)}.r2.cloudflarestorage.com/storyforge-intake/${userId}/${uploadId}/snapshot.json?X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=private`,
          uploadMethod: 'PUT', contentType: 'application/json',
          objectPath: `${userId}/${uploadId}/snapshot.json`, sha256: seal.sha256, byteLength: seal.byteLength }, { status: 201 })
      }
      if (url.pathname.endsWith('/submissions')) {
        expect(String(init?.body)).not.toContain('只选择这一章的正文')
        return Response.json({ submissionId, status: 'submitted' }, { status: 201 })
      }
      throw new Error(`unexpected ${url.pathname}`)
    })
    const result = await submitSelectedSnapshot({ seal, currentSnapshot: async () => structuredClone(snapshot),
      session, publicPenName: '作者', license: 'all-rights-reserved' })
    expect(result).toEqual({ submissionId, status: 'submitted' })
    expect(uploaded).toEqual([JSON.stringify(snapshot)])
    expect(network).toHaveBeenCalledTimes(2)
    expect(localStorage.length).toBe(0)
  })

  it('reads only the current account listing and binds withdrawal to the recorded revision', async () => {
    const row = { id: submissionId, kind: 'novel' as const, status: 'published',
      sha256: 'a'.repeat(64), created_at: '2026-10-29T00:00:00Z', updated_at: '2026-10-29T00:00:00Z' }
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input))
      expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${session.access_token}`)
      if (url.pathname.endsWith('/my-submissions')) return Response.json({ items: [row] })
      expect(url.pathname).toContain('/submission-action')
      expect(String(init?.body)).not.toContain('只选择这一章的正文')
      expect(JSON.parse(String(init?.body)).revisionSha256).toBe(row.sha256)
      return Response.json({ submissionId, status: 'withdrawn' })
    })
    const items = await readMySubmissions(session)
    expect(items).toEqual([row])
    expect(await actOnMySubmission(session, items[0], 'withdraw')).toEqual({ submissionId, status: 'withdrawn' })
    expect(network).toHaveBeenCalledTimes(2)
  })
})
