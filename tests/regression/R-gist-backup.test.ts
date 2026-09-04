/**
 * R-GIST · 云备份(GitHub Gist)往返(FB-11 数据持久 · A)
 *
 * 把项目备份到 Gist(导出 JSON 上传)→ 从 Gist 恢复(下载解析 + 导入新项目)。
 * mock fetch 模拟 GitHub API,验证:备份上传的就是完整导出、恢复能重建项目。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useGistStore } from '../../src/stores/gist'
import { seedCurrentProject } from '../helpers/current-workspace'
import { finalizeCurrentFixtureV1 } from '../helpers/current-resource-identity'

const PAT = 'ghp_fake'

async function seedProject(): Promise<number> {
  const now = Date.now()
  const pid = await seedCurrentProject({
    name: '待备份的书', genres: [], description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
  await db.characters.add({
    projectId: pid, name: '主角甲', roleWeight: 'main', moralAxis: 'neutral',
    orderAxis: 'neutral', shortDescription: '', appearance: '', personality: '',
    background: '', motivation: '', abilities: '', relationships: '', arc: '',
    homeWorldGroupId: null, isCrossWorld: false, createdAt: now, updatedAt: now,
  } as any)
  await finalizeCurrentFixtureV1(pid)
  return pid
}

function resetGistState() {
  localStorage.clear()
  sessionStorage.clear()
  useGistStore.setState({
    pat: null,
    username: null,
    rememberPat: false,
    autoBackup: false,
    busy: false,
    error: null,
  })
}

function mockValidatePAT(login = 'tester') {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).endsWith('/user')) {
      return { ok: true, json: async () => ({ login }) }
    }
    return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
  }))
}

describe('R-GIST · PAT 存储策略', () => {
  beforeEach(() => resetGistState())
  afterEach(() => { vi.unstubAllGlobals(); resetGistState() })

  it('默认只存 sessionStorage,不落 localStorage', async () => {
    mockValidatePAT('session-user')
    const ok = await useGistStore.getState().connect(PAT)
    expect(ok).toBe(true)
    expect(sessionStorage.getItem('sf-gist-pat')).toBe(PAT)
    expect(localStorage.getItem('sf-gist-pat')).toBeNull()
    expect(useGistStore.getState().rememberPat).toBe(false)
  })

  it('显式记住本机时才写 localStorage', async () => {
    mockValidatePAT('local-user')
    const ok = await useGistStore.getState().connect(PAT, true)
    expect(ok).toBe(true)
    expect(localStorage.getItem('sf-gist-pat')).toBe(PAT)
    expect(sessionStorage.getItem('sf-gist-pat')).toBeNull()
    expect(useGistStore.getState().rememberPat).toBe(true)
  })

  it('localStorage 中已有 token 时初始化为已记住状态', async () => {
    localStorage.setItem('sf-gist-pat', PAT)
    localStorage.setItem('sf-gist-user', 'stored-user')
    vi.resetModules()
    const fresh = await import('../../src/stores/gist')
    expect(fresh.useGistStore.getState().pat).toBe(PAT)
    expect(fresh.useGistStore.getState().username).toBe('stored-user')
    expect(fresh.useGistStore.getState().rememberPat).toBe(true)
  })
})

describe('R-GIST · 云备份往返', () => {
  let cloudStore: Record<string, string> = {}  // 模拟 GitHub 上的 gist 内容

  beforeEach(async () => {
    await db.delete(); await db.open()
    cloudStore = {}
    // 重置 store 配置 + 直接给 pat(跳过真实验证)
    useGistStore.setState({ pat: PAT, username: 'tester' })

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      const u = String(url)
      // 创建 gist
      if (u.endsWith('/gists') && init?.method === 'POST') {
        const body = JSON.parse(init.body)
        const fname = Object.keys(body.files)[0]
        const id = 'gist123'
        cloudStore[id] = body.files[fname].content
        return { ok: true, json: async () => ({ id, html_url: 'https://gist.github.com/' + id, files: { [fname]: {} } }) }
      }
      // 读取 gist
      if (/\/gists\/gist123$/.test(u)) {
        return { ok: true, json: async () => ({ id: 'gist123', files: { 'storyforge-待备份的书.json': { filename: 'storyforge-待备份的书.json', content: cloudStore['gist123'], truncated: false } } }) }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    }))
  })
  afterEach(async () => { db.close(); vi.unstubAllGlobals() })

  it('备份到云端 → 从云端恢复成新项目,数据一致', async () => {
    const pid = await seedProject()

    // 备份:导出 + 上传
    const r = await useGistStore.getState().backupProject(pid)
    expect(r?.url).toContain('gist123')
    // 云端确实存了完整导出(含项目名 + 角色)
    expect(cloudStore['gist123']).toContain('待备份的书')
    expect(cloudStore['gist123']).toContain('主角甲')

    // 模拟"换设备/清空":删掉原项目
    await db.projects.delete(pid)
    expect(await db.projects.count()).toBe(0)

    // 从云端恢复
    const newId = await useGistStore.getState().restoreFromGist('gist123')
    expect(newId).toBeGreaterThan(0)
    const restored = await db.projects.get(newId!)
    expect(restored?.name).toContain('待备份的书')   // 导入会加「（导入）」后缀
    const chars = await db.characters.where('projectId').equals(newId!).toArray()
    expect(chars.map(c => c.name)).toContain('主角甲')
  })
})

describe('R-GIST · 版本历史回溯', () => {
  // 每个 sha 对应一份历史快照内容
  let snapshots: Record<string, string> = {}

  beforeEach(async () => {
    await db.delete(); await db.open()
    snapshots = {}
    useGistStore.setState({ pat: PAT, username: 'tester' })
    // 让 listRevisions 能读到「项目 → gistId」映射
    localStorage.setItem('sf-gist-proj-1', JSON.stringify({ gistId: 'gistV', lastBackupAt: Date.now() }))

    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      // 取某个历史版本快照：/gists/gistV/{sha}
      const m = u.match(/\/gists\/gistV\/([a-z0-9]+)$/i)
      if (m) {
        const sha = m[1]
        return { ok: true, json: async () => ({ id: 'gistV', files: { 'storyforge-x.json': { filename: 'storyforge-x.json', content: snapshots[sha], truncated: false } } }) }
      }
      // 读 gist 元信息 + 历史列表：/gists/gistV
      if (/\/gists\/gistV$/.test(u)) {
        return { ok: true, json: async () => ({
          id: 'gistV',
          files: { 'storyforge-x.json': { filename: 'storyforge-x.json', content: snapshots['shaNew'], truncated: false } },
          history: [
            { version: 'shaNew', committed_at: '2026-06-13T10:00:00Z', change_status: { additions: 3, deletions: 1, total: 4 } },
            { version: 'shaOld', committed_at: '2026-06-12T09:00:00Z', change_status: { additions: 10, deletions: 0, total: 10 } },
          ],
        }) }
      }
      return { ok: false, status: 404, json: async () => ({ message: 'not found' }) }
    }))
  })
  afterEach(async () => { db.close(); vi.unstubAllGlobals(); localStorage.clear() })

  it('列出历史版本(最新在前) + 恢复指定旧版本', async () => {
    // 造两份合法的导出快照(新/旧版本，项目名不同以便区分)
    const pid = await seedCurrentProject({
      name: '版本书', genres: [], description: '', targetWordCount: 0,
      enableMultiWorld: false, createdAt: Date.now(), updatedAt: Date.now(),
    } as any) as number
    const { exportProjectJSON } = await import('../../src/lib/export/json-export')
    const base = await exportProjectJSON(pid)
    snapshots['shaNew'] = JSON.stringify({ ...base, project: { ...base.project, name: '新版本' } })
    snapshots['shaOld'] = JSON.stringify({ ...base, project: { ...base.project, name: '旧版本' } })

    // 列历史版本：两条，最新在前
    const revs = await useGistStore.getState().listRevisions(1)
    expect(revs.map(r => r.version)).toEqual(['shaNew', 'shaOld'])
    expect(revs[0].additions).toBe(3)
    expect(revs[0].deletions).toBe(1)

    // 恢复「旧版本」那一版 → 新建项目,拿到的是旧快照
    const newId = await useGistStore.getState().restoreFromGist('gistV', 'shaOld')
    expect(newId).toBeGreaterThan(0)
    const restored = await db.projects.get(newId!)
    expect(restored?.name).toContain('旧版本')
  })
})
