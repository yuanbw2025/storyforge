import { nanoid } from 'nanoid'
import { inspectAdaptationFreshness } from '../adaptation/source-manifest'
import { hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import type {
  AIConfig,
  ComicMediaAsset,
  ComicMediaAssetRole,
  ComicPanel,
  ComicVisualSubject,
  MediaRightsV1,
  WorkspaceScope,
} from '../types'
import { resolveScope, scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { assertComicMediaAssetV1 } from './contracts'
import { imageBindingFromAIConfigV1, createMediaProviderReceiptV1, OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1, resolveOpenAICompatibleImageSizeV1 } from '../media/capability'
import {
  finalizePendingMediaBlobDeletionV1,
  markUnreferencedMediaBlobForDeletionV1,
  mediaBlobDataUrlV1,
  prepareMediaBlobV1,
  putPreparedMediaBlobV1,
  readVerifiedMediaBlobV1,
} from '../media/blob-store'
import { requestOpenAICompatibleImagesV1 } from '../media/transport'
import { assertMediaRightsV1 } from '../media/rights'

async function requireComicRoot(scope: WorkspaceScope, requireEditable = false) {
  const root = await db.adaptationProjects.where('workId').equals(scope.workId).first()
  if (!root?.id || root.medium !== 'comic' || root.projectId !== scope.projectId || root.worldId !== scope.worldId) throw new Error('[media] 当前 Work 不是有效漫画改编')
  if (requireEditable && root.status === 'complete') throw new Error('[media] 漫画已正式完稿；请先重新打开审校')
  return root
}

function roleForSubject(subject: ComicVisualSubject): ComicMediaAssetRole {
  if (subject.kind === 'character') return 'character-sheet'
  if (subject.kind === 'location') return 'location-sheet'
  if (subject.kind === 'prop') return 'prop-sheet'
  return 'style-reference'
}

export async function listComicMediaAssets(scopeInput: WorkspaceScope): Promise<ComicMediaAsset[]> {
  const scope = await resolveScope({ scope: scopeInput })
  const root = await requireComicRoot(scope)
  return (await db.comicMediaAssets.where('adaptationProjectId').equals(root.id!).toArray()).filter(asset => asset.projectId === scope.projectId && asset.workId === scope.workId)
}

export async function commitUploadedComicAssetV1(input: {
  scope: WorkspaceScope
  data: ArrayBuffer
  panelId?: number
  subjectId?: number
  rights: MediaRightsV1
}): Promise<ComicMediaAsset> {
  assertMediaRightsV1(input.rights)
  if (input.rights.source !== 'author-upload') throw new Error('[media] 上传图片 rights.source 必须是 author-upload')
  if ((input.panelId == null) === (input.subjectId == null)) throw new Error('[media] 上传图片必须且只能绑定一个格或视觉条目')
  const scope = await resolveScope({ scope: input.scope })
  const root = await requireComicRoot(scope, true)
  const image = await prepareMediaBlobV1(input.data)
  return db.transaction('rw', scopeTransactionTables(db.comicMediaAssets, db.mediaBlobObjects, db.comicPanels, db.comicVisualSubjects), async () => {
    const panel = input.panelId == null ? null : await db.comicPanels.get(input.panelId)
    const subject = input.subjectId == null ? null : await db.comicVisualSubjects.get(input.subjectId)
    if (panel && (panel.workId !== scope.workId || panel.status === 'locked')) throw new Error('[media] 格越界或已锁定')
    if (subject && (subject.workId !== scope.workId || subject.adaptationProjectId !== root.id || subject.status === 'locked')) throw new Error('[media] 视觉条目越界或已锁定')
    if (!panel && !subject) throw new Error('[media] 媒体 owner 不存在')
    const blob = await putPreparedMediaBlobV1(scope, image)
    const now = Date.now()
    const role: ComicMediaAssetRole = panel ? 'panel-render' : roleForSubject(subject!)
    const asset: ComicMediaAsset = stampNewRecord(scope, 'comicMediaAssets', {
      projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id!, stableKey: `upload_${nanoid(20)}`,
      role, panelId: panel?.id ?? null, subjectKey: subject?.stableKey ?? null, blobObjectId: blob.id,
      origin: 'uploaded', candidateIndex: 0, requestHash: null, promptHash: null, referenceAssetKeys: [], providerReceipt: null,
      rights: structuredClone(input.rights), quality: { width: blob.width, height: blob.height, mimeType: blob.mimeType, hasTextWarning: false, continuityWarnings: [], cropWarnings: [] },
      disposition: 'available', createdAt: now, updatedAt: now,
    }, { owner: 'work' })
    assertComicMediaAssetV1(asset)
    const id = await db.comicMediaAssets.add(asset) as number
    return { ...asset, id }
  })
}

export async function generateComicPanelCandidatesV1(input: {
  scope: WorkspaceScope
  panelId: number
  expectedPanelRevision: number
  aiConfig: AIConfig
  imageModel?: string
  count: 2 | 3 | 4
  rights: MediaRightsV1
  allowLimitedConsistency?: boolean
  regenerateNonce?: string
  signal?: AbortSignal
}): Promise<{ assets: ComicMediaAsset[]; requestHash: string; reused: boolean; capabilityWarnings: string[] }> {
  assertMediaRightsV1(input.rights)
  if (input.rights.source !== 'provider-generated') throw new Error('[media] 生成图片 rights.source 必须是 provider-generated')
  const scope = await resolveScope({ scope: input.scope })
  const [root, panel] = await Promise.all([requireComicRoot(scope, true), db.comicPanels.get(input.panelId)])
  if (!panel || panel.workId !== scope.workId || panel.revision !== input.expectedPanelRevision) throw new Error('[media] 格不存在、越界或已变化')
  if (panel.status === 'locked') throw new Error('[media] 锁定格不能生成新候选')
  if ((await inspectAdaptationFreshness(root.id!)).status !== 'unchanged') throw new Error('[media] 来源 stale 时不能生成新图片')
  if (root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion || !root.visualBible) throw new Error('[media] 当前来源版本的视觉圣经尚未确认')
  const page = await db.comicPages.get(panel.pageId)
  if (!page || page.adaptationProjectId !== root.id) throw new Error('[media] 格的父页不存在')
  const subjects = await db.comicVisualSubjects.where('adaptationProjectId').equals(root.id!).toArray()
  const subjectByKey = new Map(subjects.map(subject => [subject.stableKey, subject]))
  const continuitySubjects = panel.continuityRefs.map(ref => subjectByKey.get(ref.subjectKey)).filter(Boolean) as ComicVisualSubject[]
  if (continuitySubjects.some(subject => subject.status !== 'reviewed' && subject.status !== 'locked')) throw new Error('[media] 连续性视觉条目尚未审定')
  const referenceAssetKeys = continuitySubjects.flatMap(subject => subject.selectedMediaAssetKey ? [subject.selectedMediaAssetKey] : [])
  const binding = imageBindingFromAIConfigV1(input.aiConfig, input.imageModel)
  const capabilityWarnings: string[] = []
  if (root.targetSpec.imageCapabilityRequirement.commercialUseRequired && input.rights.commercialUse !== 'allowed') throw new Error('[media] 目标规格要求可商用权利声明')
  if (root.targetSpec.imageCapabilityRequirement.referenceImage && !OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1.referenceImage) capabilityWarnings.push('目标规格要求参考图，但当前 provider 未声明参考图能力')
  if (root.targetSpec.imageCapabilityRequirement.deterministicSeed && !OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1.deterministicSeed) capabilityWarnings.push('目标规格要求确定性 seed，但当前 provider 未声明 seed 能力')
  if (referenceAssetKeys.length && !OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1.referenceImage) capabilityWarnings.push('当前 provider 不支持参考图，角色/场景一致性能力有限')
  if (capabilityWarnings.length && !input.allowLimitedConsistency) throw new Error(`[media] ${capabilityWarnings.join('；')}；请显式确认后继续`)
  const visualBibleHash = await hashCanonicalValue(root.visualBible)
  const prompt = [
    root.visualBible.artDirection, root.visualBible.linework, root.visualBible.lighting,
    `palette: ${root.visualBible.palette.join(', ')}`, `camera: ${root.visualBible.cameraLanguage.join(', ')}`,
    ...continuitySubjects.map(subject => `${subject.label}: ${subject.design.description}; ${subject.design.distinguishingMarks.join(', ')}`),
    panel.visualPrompt || `${panel.shot.size}, ${panel.shot.angle}, ${panel.action}`,
    'clean comic illustration, no text, no letters, no speech bubbles, no captions, no watermark',
    panel.negativePrompt ? `negative: ${panel.negativePrompt}` : '',
  ].filter(Boolean).join('\n')
  const promptHash = await hashCanonicalValue({ prompt })
  const requestHash = await hashCanonicalValue({
    version: 1, workId: scope.workId, panelStableKey: panel.stableKey, panelRevision: panel.revision,
    sourceManifestVersion: root.activeSourceManifestVersion, visualBibleHash, referenceAssetKeys,
    provider: binding.provider, model: binding.model, count: input.count, promptHash,
    regenerateNonce: input.regenerateNonce?.trim() || null,
  })
  const existing = await db.comicMediaAssets.where('requestHash').equals(requestHash).toArray()
  if (existing.length) {
    const available = existing.filter(asset => asset.disposition === 'available').sort((left, right) => left.candidateIndex - right.candidateIndex)
    if (available.length !== input.count || available.some(asset => asset.panelId !== panel.id || asset.workId !== scope.workId)) throw new Error('[media] 同 requestHash 候选集不完整或越界')
    return { assets: available, requestHash, reused: true, capabilityWarnings }
  }
  const width = Math.max(256, Math.min(1536, Math.round(root.targetSpec.pageSize.width * panel.frame.width)))
  const height = Math.max(256, Math.min(1536, Math.round(root.targetSpec.pageSize.height * panel.frame.height)))
  const providerSize = resolveOpenAICompatibleImageSizeV1(width, height)
  const response = await requestOpenAICompatibleImagesV1({ binding, prompt, count: input.count, ...providerSize, signal: input.signal })
  const prepared = await Promise.all(response.images.map(prepareMediaBlobV1))
  if (prepared.some(image => image.width < root.targetSpec.imageCapabilityRequirement.minimumWidth || image.height < root.targetSpec.imageCapabilityRequirement.minimumHeight)) throw new Error('[media] provider 图片低于目标规格最小尺寸，候选不落库')
  const receipt = await createMediaProviderReceiptV1({ binding, requestId: response.requestId })
  const assets = await db.transaction('rw', scopeTransactionTables(db.comicMediaAssets, db.mediaBlobObjects, db.comicPanels, db.adaptationProjects), async () => {
    const [currentRoot, currentPanel] = await Promise.all([db.adaptationProjects.get(root.id!), db.comicPanels.get(panel.id!)])
    if (!currentRoot || currentRoot.revision !== root.revision || currentRoot.activeSourceManifestHash !== root.activeSourceManifestHash || !currentPanel || currentPanel.revision !== panel.revision) throw new Error('[media] 图片返回后目标格或改编根已变化，候选不落库')
    const concurrent = await db.comicMediaAssets.where('requestHash').equals(requestHash).toArray()
    if (concurrent.length) return concurrent.sort((left, right) => left.candidateIndex - right.candidateIndex)
    const now = Date.now(); const rows: ComicMediaAsset[] = []
    for (const [candidateIndex, image] of prepared.entries()) {
      const blob = await putPreparedMediaBlobV1(scope, image)
      const asset: ComicMediaAsset = stampNewRecord(scope, 'comicMediaAssets', {
        projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id!,
        stableKey: `render_${requestHash.slice(0, 32)}_${candidateIndex}`, role: 'panel-render', panelId: panel.id!, subjectKey: null,
        blobObjectId: blob.id, origin: 'generated', candidateIndex, requestHash, promptHash, referenceAssetKeys,
        providerReceipt: receipt, rights: structuredClone(input.rights),
        quality: { width: blob.width, height: blob.height, mimeType: blob.mimeType, hasTextWarning: false, continuityWarnings: capabilityWarnings, cropWarnings: [] },
        disposition: 'available', createdAt: now, updatedAt: now,
      }, { owner: 'work' })
      assertComicMediaAssetV1(asset); rows.push(asset)
    }
    const ids = await db.comicMediaAssets.bulkAdd(rows, { allKeys: true }) as number[]
    return rows.map((row, index) => ({ ...row, id: ids[index] }))
  })
  return { assets, requestHash, reused: false, capabilityWarnings }
}

export async function generateComicSubjectCandidatesV1(input: {
  scope: WorkspaceScope
  subjectId: number
  expectedSubjectRevision: number
  aiConfig: AIConfig
  imageModel?: string
  count: 2 | 3 | 4
  rights: MediaRightsV1
  allowLimitedConsistency?: boolean
  regenerateNonce?: string
  signal?: AbortSignal
}): Promise<{ assets: ComicMediaAsset[]; requestHash: string; reused: boolean; capabilityWarnings: string[] }> {
  assertMediaRightsV1(input.rights)
  if (input.rights.source !== 'provider-generated') throw new Error('[media] 生成图片 rights.source 必须是 provider-generated')
  const scope = await resolveScope({ scope: input.scope })
  const [root, subject] = await Promise.all([requireComicRoot(scope, true), db.comicVisualSubjects.get(input.subjectId)])
  if (!subject || subject.workId !== scope.workId || subject.adaptationProjectId !== root.id || subject.revision !== input.expectedSubjectRevision) throw new Error('[media] 视觉条目不存在、越界或已变化')
  if (!['reviewed', 'locked'].includes(subject.status)) throw new Error('[media] 视觉条目须先审定，再生成设定图候选')
  if ((await inspectAdaptationFreshness(root.id!)).status !== 'unchanged') throw new Error('[media] 来源 stale 时不能生成新图片')
  if (root.visualBibleSourceManifestVersion !== root.activeSourceManifestVersion || !root.visualBible) throw new Error('[media] 当前来源版本的视觉圣经尚未确认')
  const binding = imageBindingFromAIConfigV1(input.aiConfig, input.imageModel)
  const capabilityWarnings: string[] = []
  if (root.targetSpec.imageCapabilityRequirement.commercialUseRequired && input.rights.commercialUse !== 'allowed') throw new Error('[media] 目标规格要求可商用权利声明')
  if (root.targetSpec.imageCapabilityRequirement.referenceImage && !OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1.referenceImage) capabilityWarnings.push('目标规格要求参考图，但当前 provider 未声明参考图能力')
  if (root.targetSpec.imageCapabilityRequirement.deterministicSeed && !OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1.deterministicSeed) capabilityWarnings.push('目标规格要求确定性 seed，但当前 provider 未声明 seed 能力')
  const referenceAssetKeys = subject.selectedMediaAssetKey ? [subject.selectedMediaAssetKey] : []
  if (referenceAssetKeys.length && !OPENAI_COMPATIBLE_IMAGE_CAPABILITY_V1.referenceImage) capabilityWarnings.push('当前 provider 不支持参考图，新候选无法直接继承已选设定图')
  if (capabilityWarnings.length && !input.allowLimitedConsistency) throw new Error(`[media] ${capabilityWarnings.join('；')}；请显式确认后继续`)
  const prompt = [
    root.visualBible.artDirection, root.visualBible.linework, root.visualBible.lighting,
    `palette: ${root.visualBible.palette.join(', ')}`, `period/materials: ${root.visualBible.periodAndMaterials}`,
    `${subject.kind} reference sheet for ${subject.label}`,
    subject.design.description, subject.design.silhouette, subject.design.facialFeatures, subject.design.hairAndCostume,
    `subject palette: ${subject.design.palette.join(', ')}`, `materials: ${subject.design.materials.join(', ')}`,
    `distinguishing marks: ${subject.design.distinguishingMarks.join(', ')}`,
    `never change: ${subject.design.prohibitedChanges.join(', ')}`,
    'clean comic production reference sheet, multiple consistent views, plain background, no text, no letters, no watermark',
  ].filter(Boolean).join('\n')
  const promptHash = await hashCanonicalValue({ prompt })
  const requestHash = await hashCanonicalValue({
    version: 1, workId: scope.workId, subjectStableKey: subject.stableKey, subjectRevision: subject.revision,
    sourceManifestVersion: root.activeSourceManifestVersion, visualBibleHash: await hashCanonicalValue(root.visualBible), referenceAssetKeys,
    provider: binding.provider, model: binding.model, count: input.count, promptHash,
    regenerateNonce: input.regenerateNonce?.trim() || null,
  })
  const existing = await db.comicMediaAssets.where('requestHash').equals(requestHash).toArray()
  if (existing.length) {
    const available = existing.filter(asset => asset.disposition === 'available').sort((left, right) => left.candidateIndex - right.candidateIndex)
    if (available.length !== input.count || available.some(asset => asset.subjectKey !== subject.stableKey || asset.workId !== scope.workId)) throw new Error('[media] 同 requestHash 设定图候选集不完整或越界')
    return { assets: available, requestHash, reused: true, capabilityWarnings }
  }
  const response = await requestOpenAICompatibleImagesV1({ binding, prompt, count: input.count, width: 1024, height: 1536, signal: input.signal })
  const prepared = await Promise.all(response.images.map(prepareMediaBlobV1))
  if (prepared.some(image => image.width < root.targetSpec.imageCapabilityRequirement.minimumWidth || image.height < root.targetSpec.imageCapabilityRequirement.minimumHeight)) throw new Error('[media] provider 设定图低于目标规格最小尺寸，候选不落库')
  const receipt = await createMediaProviderReceiptV1({ binding, requestId: response.requestId })
  const assets = await db.transaction('rw', scopeTransactionTables(db.comicMediaAssets, db.mediaBlobObjects, db.comicVisualSubjects, db.adaptationProjects), async () => {
    const [currentRoot, currentSubject] = await Promise.all([db.adaptationProjects.get(root.id!), db.comicVisualSubjects.get(subject.id!)])
    if (!currentRoot || currentRoot.revision !== root.revision || currentRoot.activeSourceManifestHash !== root.activeSourceManifestHash || !currentSubject || currentSubject.revision !== subject.revision) throw new Error('[media] 图片返回后视觉条目或改编根已变化，候选不落库')
    const concurrent = await db.comicMediaAssets.where('requestHash').equals(requestHash).toArray()
    if (concurrent.length) return concurrent.sort((left, right) => left.candidateIndex - right.candidateIndex)
    const now = Date.now(); const rows: ComicMediaAsset[] = []
    for (const [candidateIndex, image] of prepared.entries()) {
      const blob = await putPreparedMediaBlobV1(scope, image)
      const asset: ComicMediaAsset = stampNewRecord(scope, 'comicMediaAssets', {
        projectId: scope.projectId, workId: scope.workId, adaptationProjectId: root.id!,
        stableKey: `render_${requestHash.slice(0, 32)}_${candidateIndex}`, role: roleForSubject(subject), panelId: null, subjectKey: subject.stableKey,
        blobObjectId: blob.id, origin: 'generated', candidateIndex, requestHash, promptHash, referenceAssetKeys,
        providerReceipt: receipt, rights: structuredClone(input.rights),
        quality: { width: blob.width, height: blob.height, mimeType: blob.mimeType, hasTextWarning: false, continuityWarnings: capabilityWarnings, cropWarnings: [] },
        disposition: 'available', createdAt: now, updatedAt: now,
      }, { owner: 'work' })
      assertComicMediaAssetV1(asset); rows.push(asset)
    }
    const ids = await db.comicMediaAssets.bulkAdd(rows, { allKeys: true }) as number[]
    return rows.map((row, index) => ({ ...row, id: ids[index] }))
  })
  return { assets, requestHash, reused: false, capabilityWarnings }
}

export async function selectComicMediaAssetV1(input: { scope: WorkspaceScope; assetKey: string; panelId?: number; subjectId?: number; expectedRevision: number }): Promise<ComicPanel | ComicVisualSubject> {
  if ((input.panelId == null) === (input.subjectId == null)) throw new Error('[media] 选择图片必须且只能指定格或视觉条目')
  const scope = await resolveScope({ scope: input.scope })
  await requireComicRoot(scope, true)
  return db.transaction('rw', db.comicMediaAssets, db.comicPanels, db.comicVisualSubjects, async () => {
    const asset = await db.comicMediaAssets.where('[workId+stableKey]').equals([scope.workId, input.assetKey]).first()
    if (!asset || asset.disposition !== 'available') throw new Error('[media] 候选不存在、已拒绝或越界')
    if (input.panelId != null) {
      const panel = await db.comicPanels.get(input.panelId)
      if (!panel || panel.workId !== scope.workId || panel.status === 'locked' || panel.revision !== input.expectedRevision || asset.role !== 'panel-render' || asset.panelId !== panel.id) throw new Error('[media] 候选不属于当前格、格已变化或已锁定')
      const next = { ...panel, selectedMediaAssetKey: asset.stableKey, revision: panel.revision + 1, updatedAt: Date.now() }
      await db.comicPanels.put(next); return next
    }
    const subject = await db.comicVisualSubjects.get(input.subjectId!)
    if (!subject || subject.workId !== scope.workId || subject.status === 'locked' || subject.revision !== input.expectedRevision || asset.subjectKey !== subject.stableKey || asset.role !== roleForSubject(subject)) throw new Error('[media] 候选不属于当前视觉条目、条目已变化或已锁定')
    const next = { ...subject, selectedMediaAssetKey: asset.stableKey, revision: subject.revision + 1, updatedAt: Date.now() }
    await db.comicVisualSubjects.put(next); return next
  })
}

export async function removeComicMediaAssetV1(input: { scope: WorkspaceScope; assetKey: string; clearReferences?: boolean }): Promise<{ blobObjectId: number; blobDeleted: boolean }> {
  const scope = await resolveScope({ scope: input.scope })
  await requireComicRoot(scope, true)
  const blobObjectId = await db.transaction('rw', db.comicMediaAssets, db.comicPanels, db.comicVisualSubjects, async () => {
    const asset = await db.comicMediaAssets.where('[workId+stableKey]').equals([scope.workId, input.assetKey]).first()
    if (!asset) throw new Error('[media] asset 不存在或越界')
    const [panels, subjects, referencingAssets] = await Promise.all([
      db.comicPanels.where('workId').equals(scope.workId).filter(panel => panel.selectedMediaAssetKey === asset.stableKey).toArray(),
      db.comicVisualSubjects.where('workId').equals(scope.workId).filter(subject => subject.selectedMediaAssetKey === asset.stableKey).toArray(),
      db.comicMediaAssets.where('workId').equals(scope.workId).filter(row => row.referenceAssetKeys.includes(asset.stableKey)).toArray(),
    ])
    if ((panels.length || subjects.length || referencingAssets.length) && !input.clearReferences) throw new Error('[media] asset 仍被选择或作为参考图使用，请显式清理引用')
    if (panels.some(panel => panel.status === 'locked') || subjects.some(subject => subject.status === 'locked')) throw new Error('[media] asset 被锁定格或视觉条目引用，请先解锁')
    const now = Date.now()
    await db.comicPanels.bulkPut(panels.map(panel => ({ ...panel, selectedMediaAssetKey: null, revision: panel.revision + 1, updatedAt: now })))
    await db.comicVisualSubjects.bulkPut(subjects.map(subject => ({ ...subject, selectedMediaAssetKey: null, revision: subject.revision + 1, updatedAt: now })))
    await db.comicMediaAssets.bulkPut(referencingAssets.map(row => ({ ...row, referenceAssetKeys: row.referenceAssetKeys.filter(key => key !== asset.stableKey), updatedAt: now })))
    await db.comicMediaAssets.delete(asset.id!)
    return asset.blobObjectId
  })
  const remaining = await db.comicMediaAssets.where('blobObjectId').equals(blobObjectId).count()
  if (remaining) return { blobObjectId, blobDeleted: false }
  const pending = await markUnreferencedMediaBlobForDeletionV1({ scope, blobObjectId })
  if (!pending?.deleteReceiptHash) return { blobObjectId, blobDeleted: false }
  return {
    blobObjectId,
    blobDeleted: await finalizePendingMediaBlobDeletionV1({ scope, blobObjectId, receiptHash: pending.deleteReceiptHash }),
  }
}

export async function readComicAssetDataUrlV1(input: { scope: WorkspaceScope; assetKey: string }): Promise<{ asset: ComicMediaAsset; dataUrl: string }> {
  const scope = await resolveScope({ scope: input.scope })
  const asset = await db.comicMediaAssets.where('[workId+stableKey]').equals([scope.workId, input.assetKey]).first()
  if (!asset || asset.disposition !== 'available') throw new Error('[media] asset 不存在、已拒绝或越界')
  const blob = await readVerifiedMediaBlobV1({ scope, blobObjectId: asset.blobObjectId })
  if (blob.width !== asset.quality.width || blob.height !== asset.quality.height || blob.mimeType !== asset.quality.mimeType) throw new Error('[media] asset 与 Blob 质量元数据不一致')
  return { asset, dataUrl: await mediaBlobDataUrlV1({ scope, blobObjectId: blob.id }) }
}
