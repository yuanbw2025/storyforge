import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import { db } from '../db/schema'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import type {
  MotionDramaAssetSubjectV1,
  MotionDramaAssetVersionV1,
  MotionDramaPromptPackMaturityV1,
  MotionDramaPromptPackV1,
  MotionDramaPromptStageV1,
  MotionDramaProviderTargetV1,
  MotionDramaShotReferenceV1,
  MotionDramaShotV1,
  MotionDramaTargetSpecV1,
  WorkspaceScope,
} from '../types'
import { scopeTransactionTables, stampNewRecord } from '../workspace/scope'
import { MOTION_DRAMA_PROMPT_STAGES_V1 } from '../types'
import { resolveMotionDramaPromptV1 } from './prompts'
import { requireMotionDramaRootsV1 } from './service'
import { assertMotionDramaPromptPackManifestV1, type MotionDramaPromptPackManifestV1 } from './prompt-pack-contracts'
export type { MotionDramaPromptPackManifestV1 } from './prompt-pack-contracts'

function visualSubjects(subjects: MotionDramaAssetSubjectV1[], shots: MotionDramaShotV1[]): MotionDramaAssetSubjectV1[] {
  const used = new Set(shots.flatMap(shot => shot.subjectKeys))
  return subjects.filter(subject => used.has(subject.stableKey) && !['voice', 'sound'].includes(subject.kind))
}

function audioSubjects(subjects: MotionDramaAssetSubjectV1[]): MotionDramaAssetSubjectV1[] {
  return subjects.filter(subject => subject.kind === 'voice' || subject.kind === 'sound')
}

function requiredSubjects(subjects: MotionDramaAssetSubjectV1[], shots: MotionDramaShotV1[]): MotionDramaAssetSubjectV1[] {
  return [...visualSubjects(subjects, shots), ...audioSubjects(subjects)]
}

function selectedActualVersion(subject: MotionDramaAssetSubjectV1, versions: MotionDramaAssetVersionV1[]): MotionDramaAssetVersionV1 | null {
  return versions.find(version => version.stableKey === subject.selectedVersionKey && version.blobObjectId != null && version.origin !== 'prompt-only') ?? null
}

function allowed(rights: { commercialUse: string; redistribution: string } | null): boolean {
  return rights?.commercialUse === 'allowed' && rights.redistribution === 'allowed'
}

export function inspectMotionDramaPackMaturityV1(input: { subjects: MotionDramaAssetSubjectV1[]; versions: MotionDramaAssetVersionV1[]; shots: MotionDramaShotV1[]; references: MotionDramaShotReferenceV1[] }): { maturity: MotionDramaPromptPackMaturityV1; missing: string[] } {
  const missing: string[] = []
  for (const subject of requiredSubjects(input.subjects, input.shots)) {
    const version = selectedActualVersion(subject, input.versions)
    const mediaLabel = subject.kind === 'voice' || subject.kind === 'sound' ? '试听音频' : '参考图'
    if (!version || !allowed(version.rights)) missing.push(`物料 ${subject.label} 缺少可商用、可再分发的已选${mediaLabel}`)
  }
  for (const shot of input.shots) {
    const start = input.references.find(reference => reference.shotKey === shot.stableKey && reference.role === 'start-frame' && reference.selected && reference.blobObjectId != null)
    if (!start || !allowed(start.rights)) missing.push(`镜头 ${shot.shotNumber} 缺少可用起始帧`)
  }
  return { maturity: missing.length ? 'prompt-only' : 'reference-ready', missing }
}

function providerNotes(provider: MotionDramaProviderTargetV1): string[] {
  if (provider === 'seedance') return [
    '多模态参考按 manifest alias 顺序上传并核对角色/场景身份；实际可用数量与时长以当前 Seedance 界面为准。',
    '优先使用起始帧约束身份与构图；关键帧/结束帧仅在当前产品入口支持对应参考时使用。',
    'providerPrompt 采用时间顺序描述动作、镜头、对白和声音，但不替代人工核对参考绑定。',
  ]
  if (provider === 'runway') return [
    '先选起始图，再把 providerPrompt 作为运动指令；静态外观尽量由参考图承担。',
    '逐镜生成并保留 handle，长序列通过最后一帧接续；界面参数以当前 Runway 模型为准。',
  ]
  if (provider === 'ltx') return [
    '将 subject references 建为 Elements，将每个镜头作为 storyboard shot；逐镜检查角色与场景映射。',
    '对白、旁白、环境声和音效按 sound 数组进入音频/时间线环节；具体模型能力以当前 LTX 版本为准。',
  ]
  return ['这是厂商中立包：逐镜复制 image/video IR，并在目标工具中重新核对时长、画幅、参考图和声音能力。']
}

function providerPrompt(provider: MotionDramaProviderTargetV1, shot: MotionDramaShotV1, aliases: string[]): string {
  const refs = aliases.length ? `参考绑定：${aliases.join('、')}。` : ''
  const sound = shot.soundPlan.map(cue => `${cue.timing} ${cue.kind}: ${cue.cue}`).join('；')
  if (provider === 'seedance') return [
    refs,
    `0.0s：${shot.firstFramePrompt}`,
    `0.0-${Math.max(1, Math.floor(shot.targetSeconds * 0.7))}.0s：${shot.videoPrompt}`,
    `${shot.targetSeconds}.0s：${shot.lastFramePrompt}`,
    shot.dialogue ? `对白：${shot.dialogue}` : '', shot.narration ? `旁白：${shot.narration}` : '', sound ? `声音：${sound}` : '',
    `保持角色身份、服装、道具、空间方位与画风连续。避免：${shot.negativeVideoPrompt}`,
  ].filter(Boolean).join('\n')
  if (provider === 'runway') return [refs, `主体动作：${shot.videoPrompt}`, `摄影机：${shot.cameraMovement}；${shot.cameraAngle}；${shot.shotSize}`, `结束状态：${shot.lastFramePrompt}`, `保持项：身份、服装、场景结构、光线方向。避免：${shot.negativeVideoPrompt}`].filter(Boolean).join('\n')
  if (provider === 'ltx') return [refs, `SHOT ${shot.shotNumber} / ${shot.targetSeconds}s / ${shot.shotSize}`, `视觉：${shot.imagePrompt}`, `动作与摄影机：${shot.videoPrompt}`, shot.dialogue ? `DIALOGUE: ${shot.dialogue}` : '', shot.narration ? `NARRATION: ${shot.narration}` : '', sound ? `SOUND: ${sound}` : '', `NEGATIVE: ${shot.negativeVideoPrompt}`].filter(Boolean).join('\n')
  return [refs, shot.videoPrompt, `首帧：${shot.firstFramePrompt}`, `尾帧：${shot.lastFramePrompt}`, sound ? `声音：${sound}` : '', `避免：${shot.negativeVideoPrompt}`].filter(Boolean).join('\n')
}

export async function compileMotionDramaPromptPackV1(input: { scope: WorkspaceScope; episodeNumber: number; provider: MotionDramaProviderTargetV1; expectedProductionRevision: number }): Promise<MotionDramaPromptPackV1 & { id: number }> {
  const roots = await requireMotionDramaRootsV1(input.scope, true)
  if (roots.production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama-pack] 生产内容已变化，请刷新')
  const [subjects, versions, shots, references] = await Promise.all([
    db.motionDramaAssetSubjects.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaAssetVersions.where('adaptationProjectId').equals(roots.adaptation.id).toArray(),
    db.motionDramaShots.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber).sortBy('order'),
    db.motionDramaShotReferences.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.selected).toArray(),
  ])
  if (!shots.length || shots.some(shot => !shot.imagePrompt.trim() || !shot.videoPrompt.trim())) throw new Error('[motion-drama-pack] 请先完整确认当前集的分镜、画面 IR 与视频 IR')
  const maturity = inspectMotionDramaPackMaturityV1({ subjects, versions, shots, references })
  const refRows: MotionDramaPromptPackManifestV1['references'] = []
  const aliasByStableKey = new Map<string, string>()
  for (const subject of requiredSubjects(subjects, shots)) {
    const version = selectedActualVersion(subject, versions)
    const blob = version?.blobObjectId == null ? null : await db.mediaBlobObjects.get(version.blobObjectId)
    if (version && (!blob || blob.contentHash !== version.contentHash || blob.workId !== roots.scope.workId
      || (subject.kind === 'voice' || subject.kind === 'sound' ? !blob.mimeType.startsWith('audio/') : !blob.mimeType.startsWith('image/')))) {
      throw new Error(`[motion-drama-pack] 物料 ${subject.label} 的参考文件类型、hash 或作用域无效`)
    }
    if (version && blob) await readMediaBlobObjectData({ scope: roots.scope, blobObjectId: blob.id!, expected: { contentHash: blob.contentHash, byteSize: blob.byteSize, mimeType: blob.mimeType } })
    const alias = `subject_${refRows.length + 1}`
    aliasByStableKey.set(subject.stableKey, alias)
    refRows.push({ alias, kind: 'subject', stableKey: version?.stableKey ?? subject.stableKey, role: subject.kind, subjectKey: subject.stableKey, contentHash: version?.contentHash ?? null, mimeType: blob?.mimeType ?? null })
  }
  for (const reference of references.filter(row => shots.some(shot => shot.stableKey === row.shotKey) && row.blobObjectId != null)) {
    const blob = await db.mediaBlobObjects.get(reference.blobObjectId!)
    if (!blob?.id || blob.workId !== roots.scope.workId || !blob.mimeType.startsWith('image/')) throw new Error('[motion-drama-pack] 分镜参考图不存在、越界或类型错误')
    await readMediaBlobObjectData({ scope: roots.scope, blobObjectId: blob.id, expected: { contentHash: blob.contentHash, byteSize: blob.byteSize, mimeType: blob.mimeType } })
    const alias = `frame_${refRows.length + 1}`
    aliasByStableKey.set(reference.stableKey, alias)
    refRows.push({ alias, kind: 'frame', stableKey: reference.stableKey, role: reference.role, subjectKey: reference.subjectKey, contentHash: blob.contentHash, mimeType: blob.mimeType })
  }
  const promptVersions = Object.fromEntries(await Promise.all(MOTION_DRAMA_PROMPT_STAGES_V1.map(async stage => [stage, (await resolveMotionDramaPromptV1(roots.scope, stage, input.episodeNumber)).contentHash]))) as Record<MotionDramaPromptStageV1, string>
  const createdAt = Date.now()
  const manifest: MotionDramaPromptPackManifestV1 = {
    schema: 'storyforge.motion-drama-prompt-pack', version: 1, provider: input.provider, episodeNumber: input.episodeNumber, maturity: maturity.maturity,
    target: structuredClone(roots.adaptation.targetSpec as MotionDramaTargetSpecV1), providerNotes: providerNotes(input.provider), references: refRows,
    shots: shots.map(shot => {
      const referenceAliases = [
        ...shot.subjectKeys.map(key => aliasByStableKey.get(key)),
        ...shot.soundPlan.flatMap(cue => cue.subjectKey ? [aliasByStableKey.get(cue.subjectKey)] : []),
        ...references.filter(row => row.shotKey === shot.stableKey).map(row => aliasByStableKey.get(row.stableKey)),
      ].filter((value): value is string => Boolean(value))
      return { shotKey: shot.stableKey, durationSeconds: shot.targetSeconds, imagePrompt: shot.imagePrompt, negativeImagePrompt: shot.negativeImagePrompt, firstFramePrompt: shot.firstFramePrompt, keyFramePrompt: shot.keyFramePrompt, lastFramePrompt: shot.lastFramePrompt, videoPrompt: shot.videoPrompt, negativeVideoPrompt: shot.negativeVideoPrompt, providerPrompt: providerPrompt(input.provider, shot, referenceAliases), referenceAliases, dialogue: shot.dialogue, narration: shot.narration, sound: shot.soundPlan.map(cue => `${cue.timing} ${cue.kind}: ${cue.cue}`) }
    }), createdAt,
  }
  const manifestJson = canonicalStringify(manifest)
  const contentHash = await hashCanonicalValue(manifest)
  return db.transaction('rw', scopeTransactionTables(db.motionDramaPromptPacks, db.motionDramaProductions), async () => {
    const production = await db.motionDramaProductions.get(roots.production.id)
    if (!production || production.revision !== input.expectedProductionRevision) throw new Error('[motion-drama-pack] 编译 CAS 失败：生产内容已变化')
    const existing = await db.motionDramaPromptPacks.where('adaptationProjectId').equals(roots.adaptation.id).filter(row => row.episodeNumber === input.episodeNumber && row.provider === input.provider).toArray()
    const version = Math.max(0, ...existing.map(row => row.version)) + 1
    const row: MotionDramaPromptPackV1 = stampNewRecord(roots.scope, 'motionDramaPromptPacks', { projectId: roots.scope.projectId, workId: roots.scope.workId, adaptationProjectId: roots.adaptation.id, episodeNumber: input.episodeNumber, provider: input.provider, version, maturity: maturity.maturity, sourceManifestVersion: roots.adaptation.activeSourceManifestVersion, sourceRevision: production.revision, promptVersions, manifestJson, contentHash, createdAt }, { owner: 'work' })
    const id = await db.motionDramaPromptPacks.add(row) as number
    await db.motionDramaProductions.update(production.id!, { phase: 'review', revision: production.revision + 1, updatedAt: createdAt })
    return { ...row, id }
  })
}

export function parseMotionDramaPromptPackManifestV1(row: MotionDramaPromptPackV1): MotionDramaPromptPackManifestV1 {
  let value: MotionDramaPromptPackManifestV1
  try { value = JSON.parse(row.manifestJson) as MotionDramaPromptPackManifestV1 } catch { throw new Error('[motion-drama-pack] manifest 不是 JSON') }
  assertMotionDramaPromptPackManifestV1(value)
  if (value.schema !== 'storyforge.motion-drama-prompt-pack' || value.version !== 1 || value.provider !== row.provider || value.episodeNumber !== row.episodeNumber || value.maturity !== row.maturity) throw new Error('[motion-drama-pack] manifest 身份不匹配')
  return value
}

export async function verifyMotionDramaPromptPackV1(row: MotionDramaPromptPackV1): Promise<MotionDramaPromptPackManifestV1> {
  const manifest = parseMotionDramaPromptPackManifestV1(row)
  if (await hashCanonicalValue(manifest) !== row.contentHash) throw new Error('[motion-drama-pack] manifest hash 不匹配')
  return manifest
}
