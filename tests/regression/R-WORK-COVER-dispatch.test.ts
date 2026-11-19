import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { seedCurrentWorkspace } from '../helpers/current-workspace'
import { encodeFixtureRasterV1, installRasterDecoderForVitestV1 } from '../helpers/raster-decoder-vitest'
import { saveWorkCoverDraftV1 } from '../../src/lib/work-cover/drafts'
import { prepareCoverRunV1, submitCoverImageOnceV1, observeCoverResponseV1, acknowledgeExpiredCoverWaitV1, WORK_COVER_RESPONSE_WAIT_MS_V1 } from '../../src/lib/work-cover/run'
import type { CoverImageConnectionV1 } from '../../src/lib/work-cover/run'
import { materializeCoverCandidateV1 } from '../../src/lib/work-cover/materialize'
import { binaryDataUrlV1 } from '../../src/lib/media/blob-store'
import { adoptWorkCoverV1, prepareWorkCoverAdoptionV1 } from '../../src/lib/work-cover/adoption'
import { readAgentRunV1 } from '../../src/lib/agent/run/event-store'
import { resolveWorkCoverImageRouteV1 } from '../../src/lib/work-cover/image-recipes'
import { aiCredentialFingerprintV1 } from '../../src/lib/ai/credential-fingerprint'
import { getAgentSkillV1 } from '../../src/lib/agent/skill-registry'
import { executeFrozenFormalImageEntryV1, executeFrozenFormalImagePreviewV1, freezeFormalAIEntryBindingV1 } from '../../src/lib/agent/formal-ai-entry'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { readWorkCoverCardStateV1 } from '../../src/lib/work-cover/card-state'
import { selectReturnedWorkCoverCandidateV1 } from '../../src/lib/work-cover/select-candidate'

installRasterDecoderForVitestV1()
beforeEach(async () => { await db.delete(); await db.open() })
afterEach(() => vi.unstubAllGlobals())
const connection: CoverImageConnectionV1 = { presetId: 'test-image-preset', imageModel: 'agnes-image-2.1-flash',
  config: { provider: 'agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: 'fixture-provider-key', model: 'agnes-text-model-not-an-image-model', temperature: 0.7, maxTokens: 0 } }
const payload = () => JSON.stringify({ data: [{ b64_json: binaryDataUrlV1(encodeFixtureRasterV1(12, 18), 'image/png').split(',')[1] }] })
async function prepared(currentConnection = () => connection) {
  const { scope, work } = await seedCurrentWorkspace('隔离图片流程')
  const draft = await saveWorkCoverDraftV1({ scope, prompt: '海上灯塔，星空，无文字', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
  const authorization = await prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, connection, currentConnection })
  return { scope, work, draft, authorization }
}

describe('035 image one-shot dispatch/materialization', () => {
  it('retains a late stale candidate for explicit review with a new CAS, without adopting or resending', async () => {
    const post = vi.fn(async () => new Response(payload(), { status: 200 })); vi.stubGlobal('fetch', post)
    const fixture = await prepared(); await submitCoverImageOnceV1(fixture.authorization)
    const updatedAt = fixture.work.updatedAt + 10
    await db.works.update(fixture.work.id!, { title: '作者后来修改的作品名', updatedAt })
    const newer = await saveWorkCoverDraftV1({ scope: fixture.scope, prompt: '作者后来修改的提示词',
      expectedRevision: fixture.draft.revision, expectedWorkUpdatedAt: updatedAt })
    const asset = await materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })
    const snapshot = await readWorkCoverCardStateV1(fixture.scope, true)
    expect(snapshot.asset).toBeNull(); expect(snapshot.returnedAsset?.id).toBe(asset.id)
    const input = { scope: fixture.scope, draftId: newer.id, expectedDraftRevision: newer.revision,
      expectedWorkUpdatedAt: updatedAt, assetId: asset.id }
    await expect(selectReturnedWorkCoverCandidateV1({ ...input, expectedWorkUpdatedAt: fixture.work.updatedAt })).rejects.toThrow('已变化')
    const other = await seedCurrentWorkspace('不能借用迟到图片')
    await expect(selectReturnedWorkCoverCandidateV1({ ...input, scope: other.scope })).rejects.toThrow('不属于')
    expect((await db.workCoverDrafts.get(newer.id))!.selectedAssetId).toBeNull()
    await selectReturnedWorkCoverCandidateV1(input)
    const reviewed = await readWorkCoverCardStateV1(fixture.scope, true)
    expect(reviewed.asset?.id).toBe(asset.id); expect(reviewed.returnedAsset).toBeNull()
    expect(reviewed.brief?.prompt).toBe('作者后来修改的提示词')
    expect(reviewed.work.coverImage ?? '').toBe(''); expect(await db.workCoverAdoptions.count()).toBe(0)
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('refuses oversized sources before creating a run and terminalizes a pre-dispatch preparation failure', async () => {
    const post = vi.fn(); vi.stubGlobal('fetch', post)
    const { scope, work } = await seedCurrentWorkspace('超限原料')
    await db.works.update(work.id!, { description: '完整资料不得截断。'.repeat(10_000) })
    const draft = await saveWorkCoverDraftV1({ scope, prompt: '灯塔', expectedRevision: null, expectedWorkUpdatedAt: work.updatedAt })
    await expect(prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, connection,
      currentConnection: () => connection })).rejects.toThrow()
    expect(await db.agentRuns.count()).toBe(0); expect(post).not.toHaveBeenCalled()
    await db.works.update(work.id!, { description: '' })
    const write = vi.spyOn(db.workCoverResponseBuffers, 'add').mockRejectedValueOnce(new DOMException('quota-before-send', 'QuotaExceededError'))
    try {
      await expect(prepareCoverRunV1({ scope, draftId: draft.id, expectedDraftRevision: draft.revision, connection,
        currentConnection: () => connection })).rejects.toThrow('quota-before-send')
    } finally { write.mockRestore() }
    const run = (await db.agentRuns.toArray())[0]
    expect((await readAgentRunV1(scope, run.id!)).projection.state).toBe('failed')
    expect(await db.workCoverResponseBuffers.count()).toBe(0); expect(post).not.toHaveBeenCalled()
  })

  it('explicitly ends an expired waiting page without another POST and can still save the original late response', async () => {
    let complete!: (response: Response) => void
    const post = vi.fn(() => new Promise<Response>(resolve => { complete = resolve })); vi.stubGlobal('fetch', post)
    const fixture = await prepared(), sending = submitCoverImageOnceV1(fixture.authorization)
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    await expect(acknowledgeExpiredCoverWaitV1(fixture.scope, fixture.authorization.runId)).rejects.toThrow('等待窗口')
    const buffer = (await db.workCoverResponseBuffers.where('runId').equals(fixture.authorization.runId).first())!
    const clock = vi.spyOn(Date, 'now').mockReturnValue(buffer.updatedAt + WORK_COVER_RESPONSE_WAIT_MS_V1 + 1)
    try {
      await acknowledgeExpiredCoverWaitV1(fixture.scope, fixture.authorization.runId)
      await acknowledgeExpiredCoverWaitV1(fixture.scope, fixture.authorization.runId)
    } finally { clock.mockRestore() }
    expect((await readAgentRunV1(fixture.scope, fixture.authorization.runId)).projection.state).toBe('paused')
    expect((await db.workCoverResponseBuffers.get(buffer.id!))!.state).toBe('outcome-unknown')
    expect(post).toHaveBeenCalledTimes(1)
    complete(new Response(payload(), { status: 200 })); await sending
    await materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })
    expect((await readAgentRunV1(fixture.scope, fixture.authorization.runId)).projection.state).toBe('completed')
    expect(post).toHaveBeenCalledTimes(1)
  }, 20_000)

  it('keeps durable cover and temporary map-preview execution authorities separate', async () => {
    const invoke = vi.fn(async () => 'fixture-only')
    const cover = await freezeFormalAIEntryBindingV1('work-cover.image.generate'), coverSkill = getAgentSkillV1('inspiration.work-cover-image-v1')
    await expect(executeFrozenFormalImagePreviewV1('work-cover.image.generate', cover, coverSkill,
      'src/lib/work-cover/run.ts', invoke, { category: 'work-cover.image.generate' })).rejects.toThrow('图片预览入口')
    const preview = await freezeFormalAIEntryBindingV1('world.map.paint-preview'), previewSkill = getAgentSkillV1('world-origin.map-config')
    await expect(executeFrozenFormalImageEntryV1('world.map.paint-preview', preview, previewSkill,
      'src/lib/world-map/atlas/paint-preview.ts', invoke, { category: 'geography.world-map-paint' })).rejects.toThrow('封面图片入口')
    expect(invoke).not.toHaveBeenCalled()
    expect(await executeFrozenFormalImagePreviewV1('world.map.paint-preview', preview, previewSkill,
      'src/lib/world-map/atlas/paint-preview.ts', invoke, { category: 'geography.world-map-paint' })).toBe('fixture-only')
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('prepares from prompt-only sources without querying chapters and emits only the Agnes recipe once', async () => {
    const post = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(payload(), { status: 200, headers: { 'x-request-id': 'cover-fixture-1' } }))
    vi.stubGlobal('fetch', post)
    const fixture = await prepared()
    expect(post).not.toHaveBeenCalled()
    const get = vi.spyOn(db.chapters, 'get'), where = vi.spyOn(db.chapters, 'where')
    const auth = await prepareCoverRunV1({ scope: fixture.scope, draftId: fixture.draft.id,
      expectedDraftRevision: fixture.draft.revision, connection, currentConnection: () => connection })
    expect(get).not.toHaveBeenCalled(); expect(where).not.toHaveBeenCalled()
    get.mockRestore(); where.mockRestore()
    await submitCoverImageOnceV1(auth)
    expect(post).toHaveBeenCalledTimes(1)
    const request = JSON.parse(post.mock.calls[0][1]!.body as string)
    expect(request).toMatchObject({ model: 'agnes-image-2.1-flash', size: '1K', ratio: '2:3', return_base64: true })
    expect(Object.keys(request).sort()).toEqual(['model', 'prompt', 'ratio', 'return_base64', 'size'])
    expect(request.prompt).toContain('海上灯塔')
    await expect(submitCoverImageOnceV1(auth)).rejects.toThrow('不会重复发送')
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('persists original response before decode, then atomically freezes candidate/receipt and recovers with zero extra POST', async () => {
    const post = vi.fn(async () => new Response(payload(), { status: 200, headers: { 'x-request-id': connection.config.apiKey } })); vi.stubGlobal('fetch', post)
    const fixture = await prepared()
    await submitCoverImageOnceV1(fixture.authorization)
    const original = (await db.workCoverResponseBuffers.where('runId').equals(fixture.authorization.runId).first())!
    expect(original.state).toBe('response-observed'); expect(original.payload).toBeInstanceOf(ArrayBuffer)
    expect(original.requestId).toBeNull(); expect(JSON.stringify(original)).not.toContain(connection.config.apiKey)
    expect(await db.workCoverAssets.count()).toBe(0)
    const asset = await materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })
    expect(asset.sourceRunId).toBe(fixture.authorization.runId)
    expect(asset.candidateJson).toContain('storyforge.work-cover.image-candidate@1')
    expect((await db.workCoverResponseBuffers.get(original.id!))!.payload).toBeNull()
    const run = await readAgentRunV1(fixture.scope, fixture.authorization.runId)
    expect(run.projection.state).toBe('completed'); expect(run.projection.terminalReceiptHash).toMatch(/^[a-f0-9]{64}$/)
    expect(await materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })).toEqual(asset)
    expect(post).toHaveBeenCalledTimes(1)
    expect((await db.works.get(fixture.work.id!))!.coverImage ?? '').toBe('')
    const draft = (await db.workCoverDrafts.get(fixture.draft.id))!
    const confirmation = await prepareWorkCoverAdoptionV1({ scope: fixture.scope, draftId: draft.id!, expectedDraftRevision: draft.revision,
      assetId: asset.id, expectedWorkUpdatedAt: fixture.work.updatedAt })
    await adoptWorkCoverV1(fixture.scope, confirmation)
    expect((await db.works.get(fixture.work.id!))!.coverImage).toMatch(/^data:image\/png;base64,/)
    const backup = await exportProjectJSON(fixture.scope.projectId), imported = await importProjectJSON(backup)
    expect(await db.workCoverAssets.where('projectId').equals(imported).count()).toBe(1)
    expect(await db.workCoverResponseBuffers.where('projectId').equals(imported).count()).toBe(0)
    const importedRun = (await db.agentRuns.where('projectId').equals(imported).first())!
    const importedWork = (await db.works.where('projectId').equals(imported).first())!
    await expect(materializeCoverCandidateV1({ scope: { projectId: imported, worldId: importedWork.worldId, workId: importedWork.id! }, runId: importedRun.id! })).rejects.toThrow('没有本机原答')
    expect(post).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('quota failure during materialization keeps the original buffer and old cover, and recovery never calls the provider again', async () => {
    const post = vi.fn(async () => new Response(payload(), { status: 200 })); vi.stubGlobal('fetch', post)
    const fixture = await prepared(); await submitCoverImageOnceV1(fixture.authorization)
    const spy = vi.spyOn(db.workCoverAssets, 'add').mockRejectedValueOnce(new DOMException('quota', 'QuotaExceededError'))
    try { await expect(materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })).rejects.toThrow('quota') } finally { spy.mockRestore() }
    expect(await db.mediaBlobObjects.count()).toBe(0)
    expect((await db.workCoverResponseBuffers.where('runId').equals(fixture.authorization.runId).first())!.payload).toBeInstanceOf(ArrayBuffer)
    await materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })
    expect(post).toHaveBeenCalledTimes(1)
    expect((await db.works.get(fixture.work.id!))!.coverImage ?? '').toBe('')
  }, 20_000)

  it.each([
    { data: [{ url: 'https://example.invalid/paid-image.png' }] },
    { data: [{ b64_json: 'AAAA' }, { b64_json: 'AAAA' }] },
    { data: [{ b64_json: 'AAAA' }], status: 'queued' },
    { ...JSON.parse(payload()), task_id: 'synthetic-async-task' },
    { ...JSON.parse(payload()), status: 'pending' },
  ])('rejects URL/async/multiple results without download or replacement POST', async response => {
    const post = vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })); vi.stubGlobal('fetch', post)
    const fixture = await prepared(); await submitCoverImageOnceV1(fixture.authorization)
    await expect(materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })).rejects.toThrow('重发')
    expect(post).toHaveBeenCalledTimes(1); expect(await db.workCoverAssets.count()).toBe(0)
  })

  it('does not dispatch after a preset/key/authority change and fingerprints remain salted and secret-free', async () => {
    let current = connection
    const fixture = await prepared(() => current)
    const first = await aiCredentialFingerprintV1(connection.config)
    expect(first).toBe(await aiCredentialFingerprintV1(connection.config)); expect(first).not.toContain(connection.config.apiKey)
    current = { ...connection, presetId: 'other-preset' }
    const post = vi.fn(); vi.stubGlobal('fetch', post)
    await expect(submitCoverImageOnceV1(fixture.authorization)).rejects.toThrow('连接已变化')
    expect(post).not.toHaveBeenCalled()
    await expect(resolveWorkCoverImageRouteV1({ ...connection, config: { ...connection.config, baseUrl: 'https://apihub.agnes-ai.com.attacker.invalid/v1' } })).rejects.toThrow('官方连接')
    const buffer = (await db.workCoverResponseBuffers.where('runId').equals(fixture.authorization.runId).first())!
    expect(JSON.stringify(buffer)).not.toContain(connection.config.apiKey)
  })

  it('pauses an unknown outcome without resending; a subsequently observed original response can materialize locally', async () => {
    const post = vi.fn(async () => { throw new TypeError('connection lost after dispatch') }); vi.stubGlobal('fetch', post)
    const fixture = await prepared()
    await expect(submitCoverImageOnceV1(fixture.authorization)).rejects.toThrow('结果未知')
    const buffer = (await db.workCoverResponseBuffers.where('runId').equals(fixture.authorization.runId).first())!
    expect(buffer.state).toBe('outcome-unknown')
    await expect(submitCoverImageOnceV1(fixture.authorization)).rejects.toThrow('不会重复发送')
    await observeCoverResponseV1({ scope: fixture.scope, bufferId: buffer.id!, dispatchKey: buffer.dispatchKey, status: 200,
      requestId: 'late-original', payload: new TextEncoder().encode(payload()).buffer })
    await materializeCoverCandidateV1({ scope: fixture.scope, runId: fixture.authorization.runId })
    expect(post).toHaveBeenCalledTimes(1)
  }, 20_000)
})
