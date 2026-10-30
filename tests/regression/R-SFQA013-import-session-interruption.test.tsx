/** Real importer/controller and Panel handlers; provider replies and upload input
 * are synthetic. The real confirmation/discard buttons and stores are retained.
 */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Blob as NativeBlob } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createWorkspace } from '../../src/lib/workspace/create-workspace'
import { quickHash } from '../../src/lib/import/chunker'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'
import { useImportSessionStore } from '../../src/stores/import-session'
import { useImportStatusStore } from '../../src/stores/import-status'
import { useAIConfigStore } from '../../src/stores/ai-config'
import { usePromptStore } from '../../src/stores/prompt'
import { runSession, registerChunkTexts, clearChunkTexts, hasChunkTexts, isPipelineRunning, cancelPipeline } from '../../src/lib/import/pipeline'
import { DialogProvider } from '../../src/components/shared/Dialog'
import { ToastProvider } from '../../src/components/shared/Toast'
import ImportDocPanel from '../../src/components/system/ImportDocPanel'
import type { ImportSession, Project } from '../../src/lib/types'

const upload = vi.hoisted(() => ({ showConfirm: false, sourceBlob: () => ({ blob: null as Blob | null, filename: 'fixture.txt' }) }))
vi.mock('../../src/components/system/import/useImportDocumentPreparation', async () => {
  const { useState } = await import('react')
  return { default: function useSyntheticImportPreparation() {
    const [showConfirm, setShowConfirm] = useState(upload.showConfirm)
    const text = '海港的灯塔照亮归航的人。'
    const plans = [{ index: 0, startChar: 0, endChar: text.length, charCount: text.length, text }]
    return { filename: 'fixture.txt', rawText: text, fileError: '', loadingFile: false,
      extractInfo: null, plans, chunkSize: 1000, showConfirm, volumeDetect: null,
      previewPlans: plans, handleFile: () => {}, handleRawTextChange: () => {},
      prepareConfirmation: () => setShowConfirm(true), handleChunkSizeChange: () => {},
      closeConfirm: () => setShowConfirm(false), sourceBlob: upload.sourceBlob }
  } }
})

const text = '海港的灯塔照亮归航的人。'
const store = () => useImportSessionStore.getState()
const ids: number[] = []
let project: Project
let projectId: number
let request: ReturnType<typeof vi.fn>
const completion = () => new Response(JSON.stringify({ choices: [{ message: { content: '{}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 } }), { status: 200 })
async function makeSession(status: ImportSession['status'] = 'pending') {
  const id = await store().create({ projectId, filename: 'fixture.txt', fileHash: quickHash(text),
    totalChars: text.length, totalChunks: 1, chunkSize: 1000,
    chunks: [{ index: 0, startChar: 0, endChar: text.length, charCount: text.length, status: 'pending', attempts: 0 }],
    merged: {}, rollingContext: '', importTarget: 'project', status })
  ids.push(id)
  registerChunkTexts(id, [{ index: 0, text }])
  return id
}
async function capture(label: string) {
  const files = await Promise.all((await db.importFiles.toArray()).map(async row => ({ ...row,
    blob: row.blob instanceof NativeBlob ? { native: true, bytesHex: Buffer.from(await row.blob.arrayBuffer()).toString('hex') } : row.blob })))
  if (process.env.SFQA013_EVIDENCE_DIR) {
    fs.mkdirSync(process.env.SFQA013_EVIDENCE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.SFQA013_EVIDENCE_DIR, `${label}.json`), JSON.stringify({
      projects: await db.projects.toArray(), sessions: await db.importSessions.toArray(),
      logs: await db.importLogs.toArray(), files, status: useImportStatusStore.getState(),
      running: isPipelineRunning(), syntheticFetchCalls: request.mock.calls.length, dom: document.body.innerHTML,
    }, null, 2) + '\n')
  }
}
// Use the repository's existing React/DOM dependencies; no testing library is required.
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mounted: Array<{ host: HTMLDivElement; root: ReturnType<typeof createRoot> }> = []
async function mount() {
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host); mounted.push({ host, root })
  await act(async () => { root.render(<ToastProvider><DialogProvider><ImportDocPanel project={project} /></DialogProvider></ToastProvider>) })
}
function button(name: string | RegExp) {
  const found = Array.from(document.querySelectorAll('button')).filter(item => typeof name === 'string'
    ? item.textContent?.trim() === name : name.test(item.textContent ?? ''))
  expect(found, `actual button ${String(name)}`).toHaveLength(1)
  return found[0]!
}
function textMatch(expression: RegExp) {
  const found = Array.from(document.querySelectorAll('span,p,div')).find(item => !item.children.length && expression.test(item.textContent ?? ''))
  expect(found, `visible text ${expression}`).toBeDefined()
  return found
}
async function eventually(check: () => unknown | Promise<unknown>) {
  let failure: unknown
  for (let i = 0; i < 50; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)) })
    try { await check(); return } catch (error) { failure = error }
  }
  throw failure
}
async function findButton(name: string | RegExp) {
  await eventually(() => button(name))
  return button(name)
}
async function click(target: HTMLButtonElement) { await act(async () => { target.click() }) }

beforeEach(async () => {
  await db.delete(); await db.open()
  store().clear(); useImportStatusStore.getState().reset(); ids.length = 0
  upload.showConfirm = false
  upload.sourceBlob = () => ({ blob: new NativeBlob([Buffer.from(text, 'utf8')], { type: 'text/plain' }) as unknown as Blob, filename: 'fixture.txt' })
  const created = await createWorkspace({ name: '合成导入中断', description: '', genres: [], status: 'drafting', targetWordCount: 1000 })
  project = created.project; projectId = created.scope.projectId
  usePromptStore.setState({ loaded: false, templates: [] }); await usePromptStore.getState().init()
  useAIConfigStore.setState({ config: { provider: 'custom', contextWindow: 131072, model: 'synthetic-model', baseUrl: 'https://test.invalid/v1', apiKey: 'synthetic-test-only', maxTokens: 4096, temperature: 0 }, taskRoutes: {} })
  request = vi.fn().mockImplementation(async () => completion()); vi.stubGlobal('fetch', request)
  vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(async context => {
  await capture(`case-${context.task.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 150)}`)
  for (const item of mounted.splice(0)) { await act(async () => item.root.unmount()); item.host.remove() }
  cancelPipeline(); ids.forEach(clearChunkTexts)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); store().clear(); useImportStatusStore.getState().reset()
  await db.delete()
})

describe('SFQA013 actual pipeline interruption', () => {
  it('keeps a valid one-chunk pipeline working with a synthetic response and no real provider call', async () => {
    const id = await makeSession()
    await runSession({ projectId, sessionId: id })
    expect((await store().load(id))?.status).toBe('done')
    expect(useImportStatusStore.getState().phase).toBe('done')
    expect(isPipelineRunning()).toBe(false); expect(request).toHaveBeenCalledTimes(1)
  })

  it('releases its controller and reports startup persistence failure without sending a request', async () => {
    const id = await makeSession()
    vi.spyOn(store(), 'patch').mockRejectedValueOnce(new Error('synthetic startup write failure'))
    const outcome = await runSession({ projectId, sessionId: id }).then(() => null, error => error)
    await capture('pipeline-startup-write-failure')
    expect(outcome).toBeNull()
    expect(isPipelineRunning()).toBe(false)
    expect(useImportStatusStore.getState()).toMatchObject({ phase: 'failed', fatalError: expect.stringContaining('synthetic startup write failure') })
    expect(request).not.toHaveBeenCalled()
  })

  it('does not recreate logs when its Project disappears immediately after the public load', async () => {
    const id = await makeSession(), load = store().load
    vi.spyOn(store(), 'load').mockImplementationOnce(async sid => { const row = await load(sid); await cascadeDeleteProject(projectId); return row })
    const outcome = await runSession({ projectId, sessionId: id }).then(() => null, error => error)
    await capture('pipeline-root-deleted-after-load')
    expect(outcome).toBeNull(); expect(isPipelineRunning()).toBe(false)
    expect(useImportStatusStore.getState().phase).toBe('failed')
    expect(request).not.toHaveBeenCalled()
    expect(await db.importLogs.count()).toBe(0); expect(await db.importSessions.count()).toBe(0)
  })

  it('stops visibly when the Session disappears just before the first public log', async () => {
    const id = await makeSession(), log = store().log
    vi.spyOn(store(), 'log').mockImplementationOnce(async (...args) => { await store().deleteSession(id); return log(...args) })
    const outcome = await runSession({ projectId, sessionId: id }).then(() => null, error => error)
    await capture('pipeline-session-deleted-before-log')
    expect(outcome).toBeNull(); expect(isPipelineRunning()).toBe(false)
    expect(useImportStatusStore.getState().phase).toBe('failed')
    expect(request).not.toHaveBeenCalled(); expect(await db.importLogs.count()).toBe(0)
  })

  it.each(['before-chunk', 'before-final-report'] as const)('reports disappearance at %s instead of silently leaving a running UI', async boundary => {
    const id = await makeSession(), load = store().load
    let reads = 0
    vi.spyOn(store(), 'load').mockImplementation(async sid => {
      if (++reads === (boundary === 'before-chunk' ? 2 : 3)) await store().deleteSession(id)
      return load(sid)
    })
    const outcome = await runSession({ projectId, sessionId: id }).then(() => null, error => error)
    await capture(`pipeline-disappearance-${boundary}`)
    expect(outcome).toBeNull(); expect(isPipelineRunning()).toBe(false)
    expect(useImportStatusStore.getState().phase).toBe('failed')
    expect(request).toHaveBeenCalledTimes(boundary === 'before-chunk' ? 0 : 1)
    expect(await db.importLogs.count()).toBe(0)
  })

  it.each(['project', 'session'] as const)('rejects a synthetic empty response completing after %s deletion without a retry or orphan', async deletion => {
    const id = await makeSession()
    let reached!: () => void, finish!: () => void
    const started = new Promise<void>(done => { reached = done }), gate = new Promise<void>(done => { finish = done })
    request.mockImplementationOnce(async () => { reached(); await gate; return completion() })
    const running = runSession({ projectId, sessionId: id }).then(() => null, error => error)
    try {
      await Promise.race([started, running.then(() => { throw new Error('synthetic fixture did not reach its fetch gate') })])
      if (deletion === 'project') await cascadeDeleteProject(projectId)
      else await store().deleteSession(id)
    } finally { finish() }
    const outcome = await running
    await capture(`pipeline-response-after-${deletion}-delete`)
    expect(outcome).toBeNull(); expect(isPipelineRunning()).toBe(false)
    expect(useImportStatusStore.getState().phase).toBe('failed')
    expect(request).toHaveBeenCalledTimes(1)
    expect(await db.importLogs.count()).toBe(0); expect(await db.importFiles.count()).toBe(0)
    expect(await db.importSessions.count()).toBe(0)
  })
})

describe('SFQA013 real Panel buttons with real session persistence', () => {
  it('shows deleted Project refusal after the actual confirm button and does not create an orphan Session', async () => {
    upload.showConfirm = true
    await mount(); await cascadeDeleteProject(projectId)
    await click(button(/导入当前项目（1 块）/))
    await eventually(() => expect(useImportStatusStore.getState().phase).toBe('failed'))
    await capture('panel-start-deleted-project')
    expect(await db.importSessions.count()).toBe(0); expect(await db.importLogs.count()).toBe(0); expect(await db.importFiles.count()).toBe(0)
    expect(textMatch(/无法|不存在|已删除/)).toBeTruthy(); expect(request).not.toHaveBeenCalled()
  })

  it('keeps normal start possible after an optional Blob-storage failure, with the raw text still in memory', async () => {
    upload.showConfirm = true
    vi.spyOn(db.importFiles, 'put').mockRejectedValueOnce(new Error('synthetic optional quota failure'))
    await mount(); await click(button(/导入当前项目（1 块）/))
    await eventually(() => expect(useImportStatusStore.getState().phase).toBe('done'))
    const sessions = await db.importSessions.toArray(); ids.push(...sessions.map(s => s.id!))
    expect(sessions).toHaveLength(1); expect(sessions[0]?.status).toBe('done')
    expect(hasChunkTexts(sessions[0]!.id!)).toBe(true); expect(request).toHaveBeenCalledTimes(1)
    expect(await db.importFiles.count()).toBe(0)
  })

  it('shows a refusal when a cached unfinished Session was deleted before the actual resume button', async () => {
    const id = await makeSession('paused'); await mount()
    const button = await findButton(/立即续跑/)
    await act(async () => { await store().deleteSession(id) })
    await click(button)
    await eventually(() => expect(textMatch(/已删除|不存在|无法续跑/)).toBeTruthy())
    await capture('panel-resume-deleted-session')
    expect(request).not.toHaveBeenCalled(); expect(await db.importLogs.count()).toBe(0)
  })

  it('does not claim a deleted cached Session has a restored Blob after the actual reupload-resume button', async () => {
    const id = await makeSession('paused'); clearChunkTexts(id); await mount()
    const button = await findButton(/用当前文件续跑/)
    await act(async () => { await store().deleteSession(id) })
    await click(button)
    await eventually(() => expect(textMatch(/已删除|不存在|无法续跑/)).toBeTruthy())
    await capture('panel-reupload-deleted-session')
    expect(await db.importFiles.get(id)).toBeUndefined(); expect(request).not.toHaveBeenCalled()
    expect(hasChunkTexts(id)).toBe(false)
  })

  it.each(['normal', 'source-failure'] as const)('uses the actual unfinished discard/confirm buttons with %s and keeps failed abandonment recoverable', async mode => {
    const id = await makeSession('paused')
    await store().saveBlob(id, 'fixture.txt', upload.sourceBlob().blob!, quickHash(text))
    await store().log(id, 0, 'info', '保留的原始日志')
    const originalFile = await db.importFiles.get(id)
    if (mode === 'source-failure') vi.spyOn(db.importFiles, 'delete').mockRejectedValueOnce(new Error('synthetic UI source delete failure'))
    await mount(); await click(await findButton('放弃'))
    await click(await findButton('放弃任务'))
    if (mode === 'normal') {
      await eventually(async () => expect(await db.importSessions.get(id)).toBeUndefined())
      expect(await db.importFiles.get(id)).toBeUndefined(); expect(await db.importLogs.count()).toBe(0)
      expect(hasChunkTexts(id)).toBe(false)
    } else {
      await eventually(() => expect(textMatch(/synthetic UI source delete failure/)).toBeTruthy())
      expect(await db.importSessions.get(id)).toBeDefined(); expect(await db.importLogs.count()).toBe(1)
      expect(Buffer.from(await (await db.importFiles.get(id))!.blob.arrayBuffer())).toEqual(Buffer.from(await originalFile!.blob.arrayBuffer()))
      expect(hasChunkTexts(id)).toBe(true)
    }
    await capture(`panel-discard-${mode}`)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['normal', 'source-failure'] as const)('keeps the real report discard path atomic with %s', async mode => {
    const id = await makeSession('failed')
    await store().saveBlob(id, 'fixture.txt', upload.sourceBlob().blob!, quickHash(text))
    await store().log(id, 0, 'info', '报告原始日志')
    useImportStatusStore.getState().attachSession({ sessionId: id, filename: 'fixture.txt', totalChunks: 1, phase: 'failed' })
    if (mode === 'source-failure') vi.spyOn(db.importFiles, 'delete').mockRejectedValueOnce(new Error('synthetic report source delete failure'))
    await mount(); await click(await findButton('清理会话')); await click(await findButton('清理'))
    if (mode === 'normal') {
      await eventually(async () => expect(await db.importSessions.get(id)).toBeUndefined())
      expect(await db.importFiles.get(id)).toBeUndefined(); expect(await db.importLogs.count()).toBe(0)
    } else {
      await eventually(() => expect(textMatch(/synthetic report source delete failure/)).toBeTruthy())
      expect(await db.importSessions.get(id)).toBeDefined(); expect(await db.importFiles.get(id)).toBeDefined()
      expect(await db.importLogs.count()).toBe(1); expect(hasChunkTexts(id)).toBe(true)
    }
    await capture(`panel-report-discard-${mode}`)
    expect(request).not.toHaveBeenCalled()
  })

  it.each(['normal', 'source-failure'] as const)('retains completed reusable analysis while the real report closes with %s source cleanup', async mode => {
    const id = await makeSession('done')
    await store().patch(id, { merged: { worldview: { summary: '可以复用的解析结果' } } })
    await store().saveBlob(id, 'fixture.txt', upload.sourceBlob().blob!, quickHash(text))
    useImportStatusStore.getState().attachSession({ sessionId: id, filename: 'fixture.txt', totalChunks: 1, phase: 'done' })
    if (mode === 'source-failure') vi.spyOn(db.importFiles, 'delete').mockRejectedValueOnce(new Error('synthetic completed source delete failure'))
    await mount(); await click(await findButton('完成'))
    if (mode === 'normal') await eventually(async () => expect(await db.importFiles.get(id)).toBeUndefined())
    else {
      await eventually(() => expect(textMatch(/synthetic completed source delete failure/)).toBeTruthy())
      expect(await db.importFiles.get(id)).toBeDefined()
    }
    expect((await store().findReusableCompleted(projectId))?.id).toBe(id)
    expect(request).not.toHaveBeenCalled()
    await capture(`panel-report-close-${mode}`)
  })
})
