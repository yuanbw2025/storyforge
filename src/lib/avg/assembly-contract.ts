import { avgHash, avgKeys, avgProtocolBody, avgRecord, avgText } from './protocol-validation'

/** Frozen output domain for author assembly. Canonical rules/text remain adopted artifacts. */
export interface AvgAssemblyBriefV1 {
  schema: 'storyforge.avg.assembly-brief'
  version: 1
  title: string
  sceneKeys: string[]
  mediaAssetKeys: string[]
  basePackageHash: string | null
}
export const AVG_ASSEMBLY_GATE_IDS_V1 = [
  'avg.rules.confirmed','avg.scripts.confirmed','avg.stage.confirmed',
  'runtime.package.valid','avg.media.bytes.valid','avg.rights.declared',
] as const
export function parseAvgAssemblyBriefV1(value: unknown): AvgAssemblyBriefV1 {
  const row = avgRecord(avgProtocolBody(value), ['schema','version','title','sceneKeys','mediaAssetKeys','basePackageHash'], 'AVG assembly Brief')
  if (row.schema !== 'storyforge.avg.assembly-brief' || row.version !== 1) throw new Error('[avg] 组装 Brief 版本无效')
  const sceneKeys = avgKeys(row.sceneKeys, 'sceneKeys'), mediaAssetKeys = avgKeys(row.mediaAssetKeys, 'mediaAssetKeys')
  // Existing shared production protocol permits 100 tasks: four joins plus scene inputs.
  if (!sceneKeys.length || sceneKeys.length > 96 || mediaAssetKeys.length > 128) throw new Error('[avg] 当前组装需 1～96 个场景、最多 128 项媒资')
  return { schema: row.schema, version: 1, title: avgText(row.title, 'title', 200), sceneKeys, mediaAssetKeys,
    basePackageHash: row.basePackageHash === null ? null : avgHash(row.basePackageHash, 'basePackageHash') }
}
