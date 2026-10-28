import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { createAvgDraftV1 } from '../../src/lib/avg/draft-service'
import { createAvgDraftReferenceAdapterV1, importAvgMediaV1 } from '../../src/lib/avg/editor-service'
import { freezeAvgImageRequestV1, type AvgMediaReferenceV1 } from '../../src/lib/avg/media-reference-contract'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { deleteWork } from '../../src/lib/workspace/lifecycle'
import type { ProductMediaRequestV1, MediaProviderTransportV1 } from '../../src/lib/product-production/media-adapters'

const BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const bytes = () => Uint8Array.from(atob(BASE64), c => c.charCodeAt(0)).buffer
const request: ProductMediaRequestV1 = {
  schema: 'storyforge.product-media-request', version: 1, adapterId: 'agnes.image-2.1-flash.v1', requestId: 'avg.reference.owner-test',
  requirementKey: 'avg.reference.family', artifactKey: 'avg.media.family', mediaClass: 'image', mediaKind: 'character-expression',
  prompt: '只改变表情，保留身份', negativePrompt: '', count: 1, width: 864, height: 1152, durationMs: null, inputHash: 'a'.repeat(64),
  qualityProfile: 'internal', environment: 'test', allowedDataClasses: ['avg-reference'], rightsPolicyVersion: 'avg-test-rights.v1',
}
async function setup() {
  const { scope } = await createAvgDraftV1('参考所有权测试')
  const asset = await importAvgMediaV1({ scope, data: bytes(), mimeType: 'image/png', kind: 'character-pose',
    name: '原创参考', license: 'CC0-1.0', altText: '原创人物', characterTag: 'cast.a' })
  const reference: AvgMediaReferenceV1 = { assetKey: asset.assetKey, assetVersion: asset.version, contentHash: asset.contentHash,
    mimeType: 'image/png', byteSize: asset.byteSize, purpose: 'identity', allowedChange: '仅表情', dataClass: 'avg-reference',
    license: asset.license, providerInputAllowed: true, derivativeUseAllowed: true, crop: null, mask: null }
  const frozen = await freezeAvgImageRequestV1({ request, resolutionTier: '1K', references: [reference] })
  const dispatch = vi.fn(async () => ({ status: 200, contentType: 'application/json', body: null, json: { data: [{ b64_json: BASE64 }] },
    providerRequestId: 'actual-image.1', usage: null, costUsd: null }))
  const transport: MediaProviderTransportV1 = { executionLocation: 'browser-direct', request: dispatch }
  return { scope, asset, reference, frozen, executable: { ...request, inputHash: frozen.inputHash }, dispatch, transport }
}

describe('R-AVG-BASE01 · owner-scoped actual references and portable lifecycle', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(() => db.close())
  it('真实 Work-owned Blob 经过 scope/hash 读取，外发授权不会写入正式舞台', async () => {
    const s = await setup(), adapter = await createAvgDraftReferenceAdapterV1({ scope: s.scope, frozen: s.frozen })
    const [candidate] = await adapter.generate(s.executable, s.transport, new AbortController().signal)
    expect(candidate.metadata.avgReferenceTransmission).toMatchObject({ references: [{ assetKey: s.asset.assetKey, contentHash: s.asset.contentHash }] })
    expect(await db.avgDraftMedia.count()).toBe(1)
    expect(await db.productBuildArtifacts.count()).toBe(0)
    expect(s.dispatch).toHaveBeenCalledTimes(1)
  })
  it('另一 AVG 的相同 hash 也不能通过 assetKey 偷读，授权变更在发送前失效', async () => {
    const s = await setup(), other = await createAvgDraftV1('另一作品')
    const foreign = await createAvgDraftReferenceAdapterV1({ scope: other.scope, frozen: s.frozen })
    await expect(foreign.generate(s.executable, s.transport, new AbortController().signal)).rejects.toThrow(/不存在|跨作品/)
    const local = await createAvgDraftReferenceAdapterV1({ scope: s.scope, frozen: s.frozen })
    const row = (await db.avgDraftMedia.where('workId').equals(s.scope.workId).first())!
    await db.avgDraftMedia.update(row.id!, { assetJson: JSON.stringify({ ...s.asset, license: 'reference-only-no-external-transmission' }) })
    await expect(local.generate(s.executable, s.transport, new AbortController().signal)).rejects.toThrow(/授权已 stale/)
    expect(s.dispatch).not.toHaveBeenCalled()
  })
  it('备份重映射后仍读准确字节；删除恢复作品不会删掉源作品 Blob', async () => {
    const s = await setup(), importedId = await importProjectJSON(await exportProjectJSON(s.scope.projectId))
    const restored = (await db.avgDraftMedia.where('projectId').equals(importedId).first())!
    expect(restored.workId).not.toBe(s.scope.workId); expect(restored.assetJson).toContain(s.asset.contentHash)
    const scope = { projectId: importedId, worldId: restored.worldId, workId: restored.workId }
    const adapter = await createAvgDraftReferenceAdapterV1({ scope, frozen: s.frozen })
    await expect(adapter.generate(s.executable, s.transport, new AbortController().signal)).resolves.toHaveLength(1)
    await deleteWork(importedId, restored.workId)
    await expect(adapter.generate(s.executable, s.transport, new AbortController().signal)).rejects.toThrow()
    const source = await createAvgDraftReferenceAdapterV1({ scope: s.scope, frozen: s.frozen })
    await expect(source.generate(s.executable, s.transport, new AbortController().signal)).resolves.toHaveLength(1)
  })
})
