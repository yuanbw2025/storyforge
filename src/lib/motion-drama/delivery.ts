import JSZip from 'jszip'
import { db } from '../db/schema'
import { prepareAudioBlobV1, prepareMediaBlobV1 } from '../media/blob-store'
import { readMediaBlobObjectData } from '../product-production/media-blob-store'
import type { CreationReleaseAssetV1, MotionDramaReleaseManifestV1, WorkspaceScope } from '../types'
import { assertMotionDramaPromptPackManifest } from './prompt-pack-contracts'
import { readMotionDramaReleaseManifestV1 } from './release'

function requiredReferences(manifest: MotionDramaReleaseManifestV1) {
  const required = new Map<string, { contentHash: string; mimeType: string; role: CreationReleaseAssetV1['role'] }>()
  for (const pack of manifest.promptPacks) {
    assertMotionDramaPromptPackManifest(pack)
    for (const reference of pack.references) {
      if (reference.contentHash == null || reference.mimeType == null) {
        if (manifest.tier === 'reference-ready') throw new Error('冻结参考包缺少实际素材证据')
        continue
      }
      const expected = { contentHash: reference.contentHash, mimeType: reference.mimeType,
        role: reference.kind === 'subject' ? 'motion-subject-reference' as const : 'motion-shot-reference' as const }
      const prior = required.get(reference.stableKey)
      if (prior && (prior.contentHash !== expected.contentHash || prior.mimeType !== expected.mimeType || prior.role !== expected.role)) {
        throw new Error(`冻结参考包的素材证据冲突：${reference.stableKey}`)
      }
      required.set(reference.stableKey, expected)
    }
  }
  return required
}

/** Export only the frozen release and its pinned bytes, never current draft assets. */
export async function exportMotionMaterialBundle(scopeInput: WorkspaceScope, releaseId: number): Promise<Blob> {
  const scope = { ...scopeInput }
  const manifest = await readMotionDramaReleaseManifestV1(scope, releaseId)
  const required = requiredReferences(manifest)
  const zip = new JSZip()
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  const assets = await db.creationReleaseAssets.where('releaseId').equals(releaseId).toArray()
  const pinned = new Set<string>()
  for (const asset of assets) {
    if (asset.projectId !== scope.projectId || asset.worldId !== scope.worldId || asset.workId !== scope.workId) throw new Error('交付素材归属不匹配')
    if (pinned.has(asset.assetKey)) throw new Error(`冻结素材pin重复：${asset.assetKey}`)
    pinned.add(asset.assetKey)
  }
  if (manifest.tier === 'reference-ready') for (const key of required.keys()) {
    if (!pinned.has(key)) throw new Error(`冻结素材pin缺失：${key}`)
  }
  const index: Array<{key:string;file:string;hash:string}> = []
  for (const asset of assets) {
    const expected = required.get(asset.assetKey)
    let audio: boolean
    if (expected) {
      if (asset.role !== expected.role || asset.contentHash !== expected.contentHash) throw new Error('冻结素材pin与参考包不匹配')
      audio = expected.mimeType.startsWith('audio/')
    } else {
      // Earlier publishers also pinned selected, unused voice/sound material. Preserve those
      // bytes only when the same immutable manifest proves the exact selected version.
      const extra = manifest.assets.filter(row => typeof row.selectedVersionKey === 'string' && row.selectedVersionKey === asset.assetKey)
      if (extra.length !== 1 || asset.role !== 'motion-subject-reference') throw new Error('附加素材缺少唯一冻结选择证据')
      audio = extra[0].kind === 'voice' || extra[0].kind === 'sound'
    }
    const blob = await db.mediaBlobObjects.get(asset.blobObjectId)
    if (!blob || blob.projectId !== scope.projectId || blob.worldId !== scope.worldId || blob.workId !== scope.workId || blob.contentHash !== asset.contentHash
      || (expected && blob.mimeType !== expected.mimeType)) throw new Error('冻结素材缺失、类型或版本不匹配')
    const data = await readMediaBlobObjectData({scope,blobObjectId:asset.blobObjectId,expected:{contentHash:asset.contentHash,byteSize:blob.byteSize,mimeType:blob.mimeType}})
    const prepared = audio ? await prepareAudioBlobV1(data) : await prepareMediaBlobV1(data)
    if (prepared.mimeType !== blob.mimeType || prepared.contentHash !== asset.contentHash) throw new Error('冻结素材实际格式或字节不匹配')
    const extension: Record<string,string> = {'image/png':'png','image/jpeg':'jpg','image/webp':'webp','audio/wav':'wav','audio/mpeg':'mp3','audio/ogg':'ogg','audio/mp4':'m4a'}
    const file=`references/${asset.contentHash}.${extension[blob.mimeType]??'bin'}`
    zip.file(file,data);index.push({key:asset.assetKey,file,hash:asset.contentHash})
  }
  zip.file('references.json',JSON.stringify(index,null,2))
  for(const pack of manifest.promptPacks){
    const label=`EP${pack.episodeNumber}-${pack.provider}`
    zip.file(`${label}/pack.json`,JSON.stringify(pack,null,2))
    const shots=pack.shots as Array<{shotKey:string;providerPrompt:string}>
    zip.file(`${label}/提示词.txt`,shots.map(shot=>`${shot.shotKey}\n${shot.providerPrompt}`).join('\n\n'))
  }
  zip.file('使用说明.txt',`漫剧素材 · 前期交付包\n此包不包含视频成片。\n按各集 pack.json 的逐镜输入槽位核对 references.json 与参考素材，然后复制提示词至 Seedance 或所选工具。\n${manifest.tier==='prompt-only'?'本包仅为提示词准备阶段；未包含实际参考媒资，不代表可直接投喂。':'本包包含已冻结的参考素材。'}\n请在外部工具中核对实际版本与支持能力。`)
  return zip.generateAsync({type:'blob'})
}
