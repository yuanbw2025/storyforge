import type { AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { hashProductProductionValueV2 } from '../product-production/hash'
import { avgKey, avgList, avgProtocolBody, avgRecord } from './protocol-validation'
import { assertAvgVoiceDeclarationRequestsV1, avgVoiceRouteBindingHashV1, parseAvgVoiceProductionDeclarationV1,
  type AvgVoiceProductionDeclarationV1 } from './voice-assembly-contract'
import { decodeAvgVoiceExactStorageV1, encodeAvgVoiceExactStorageV1, parseAvgVoiceExactStorageV1,
  type AvgVoiceExactStorageV1 } from './voice-exact-storage'
import { hashAvgVoiceTextV1, type AvgVoicePerformanceV1, type AvgVoicePresetV1 } from './voice-production-contract'
import { hashAvgSpeechProtocolV1, parseAvgSpeechProtocolV1, type AvgSpeechProtocolV1 } from './voice-request-contract'
import { hashAvgVoiceSourceInputV1, validateAvgVoiceProductionSourcesV1 } from './voice-production-source'

export interface AvgVoiceDraftLineV1 {
  requirementKey: string; assetKey: string; sceneKey: string; lineKey: string; presetKey: string
  maximumDurationMs: number; performance: AvgVoicePerformanceV1
}

/** One exact declaration in the existing editor JSON, never a second decoded
 * persisted copy. The packet survives canonical NFC serializers unchanged.
 * This structural read grants no account, Work, start or producer authority.
 */
export function readAvgVoiceDraftV1(value: unknown) {
  const { packet, payload } = parseAvgVoiceExactStorageV1(value, 'assembly-voice')
  const r = avgRecord(payload, ['schema', 'version', 'batch', 'protocol', 'binding'], 'voice draft packet')
  return { packet, voice: parseAvgVoiceProductionDeclarationV1({ batch: r.batch, protocol: r.protocol, binding: r.binding }) }
}

export async function assertAvgVoiceDraftV1(value: unknown) {
  const result = readAvgVoiceDraftV1(value)
  await decodeAvgVoiceExactStorageV1(result.packet, 'assembly-voice')
  const { requests } = await assertAvgVoiceDeclarationRequestsV1(result.voice)
  return { ...result, requests }
}

export async function encodeAvgVoiceDraftV1(value: AvgVoiceProductionDeclarationV1): Promise<AvgVoiceExactStorageV1> {
  const { voice } = await assertAvgVoiceDeclarationRequestsV1(value)
  return encodeAvgVoiceExactStorageV1('assembly-voice', { schema: 'storyforge.avg.assembly-voice', version: 1, ...voice })
}

/** Inert source proposal for a *new* Build. Its first script adoption is
 * explicitly declared as revision 1; execution later proves the actual
 * adopted same-Work row and rejects any mismatch. No accepted row is forged.
 */
export async function validateAvgVoiceDraftSourcesV1(value: unknown, workspace: AvgAuthorWorkspaceV1) {
  const result = await assertAvgVoiceDraftV1(value), needed = new Set(result.voice.batch.requirements.map(r => r.script.artifactKey))
  const scripts = await Promise.all(workspace.scripts.filter(s => needed.has(`avg.content.scene-script.${s.sceneKey}`)).map(async payload => ({
    artifactKey: `avg.content.scene-script.${payload.sceneKey}`, version: 1,
    contentHash: await hashProductProductionValueV2(payload), payload,
  })))
  await validateAvgVoiceProductionSourcesV1(result.voice.batch, workspace, scripts)
  const reading = workspace.presentation.reading
  if (!reading) throw new Error('[avg-voice] 请先明确设置阅读、配音失败与等待策略')
  if (result.voice.batch.requirements.some(r => r.maximumDurationMs >= reading.maximumVoiceWaitMs)) {
    throw new Error('[avg-voice] 每句音频时长上限必须小于明确的阅读等待上限')
  }
  const imageKeys = new Set(workspace.mediaBatch?.requirements.map(r => r.assetKey) ?? [])
  if (result.voice.batch.requirements.some(r => imageKeys.has(r.assetKey))) throw new Error('[avg-voice] 图片与配音不能占用同一媒资身份')
  return result
}

/** Select exact saved script lines. Text, speaker, hash and source versions
 * are derived, not editable alternate copies. Unknown options/oversize
 * batches fail visibly; they are never clipped or silently approximated.
 */
export async function prepareAvgVoiceDraftV1(input: {
  workspace: AvgAuthorWorkspaceV1; protocol: AvgSpeechProtocolV1; presets: AvgVoicePresetV1[]; lines: AvgVoiceDraftLineV1[]
}) {
  const protocol = parseAvgSpeechProtocolV1(input.protocol), capabilityHash = await hashAvgSpeechProtocolV1(protocol)
  const selections = avgList(input.lines, 'voice draft lines', value => {
    const row = avgRecord(avgProtocolBody(value), ['requirementKey', 'assetKey', 'sceneKey', 'lineKey', 'presetKey', 'maximumDurationMs', 'performance'], 'voice draft line')
    return { ...row, requirementKey: avgKey(row.requirementKey, 'voice requirement'), assetKey: avgKey(row.assetKey, 'voice asset'),
      sceneKey: avgKey(row.sceneKey, 'voice scene'), lineKey: avgKey(row.lineKey, 'voice line'), presetKey: avgKey(row.presetKey, 'voice preset') }
  }, 8)
  const requirements = await Promise.all(selections.map(async selection => {
    const script = input.workspace.scripts.find(s => s.sceneKey === selection.sceneKey)
    const line = script?.lines.find(l => l.lineKey === selection.lineKey)
    const preset = input.presets.find(p => p.presetKey === selection.presetKey)
    if (!script || !line) throw new Error('[avg-voice] 所选准确台词不存在于已保存的规范脚本中')
    if (!preset) throw new Error('[avg-voice] 所选音色预设不存在于本批声明中')
    return { ...selection, presetRevision: preset.revision, locale: 'zh-CN', text: line.text, textHash: await hashAvgVoiceTextV1(line.text),
      textRevision: 1, speakerKey: line.speakerKey,
      script: { artifactKey: `avg.content.scene-script.${script.sceneKey}`, version: 1, contentHash: await hashProductProductionValueV2(script) } }
  }))
  const voice = parseAvgVoiceProductionDeclarationV1({ protocol,
    batch: { schema: 'storyforge.avg.voice-production-batch', version: 1, outputFormat: 'wav',
      sourceInputHash: await hashAvgVoiceSourceInputV1(input.workspace), presets: input.presets, requirements },
    binding: { requirementKey: 'avg.media.voice', adapterId: protocol.adapterId, endpointRouteHash: protocol.endpointRouteHash,
      bindingHash: await avgVoiceRouteBindingHashV1({ requirementKey: 'avg.media.voice', adapterId: protocol.adapterId,
        capabilityHash, endpointRouteHash: protocol.endpointRouteHash }) } })
  const packet = await encodeAvgVoiceDraftV1(voice)
  await validateAvgVoiceDraftSourcesV1(packet, input.workspace)
  return packet
}
