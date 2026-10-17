import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgVisualProductionRequirementV1, parseAvgAuthorMediaChoice,
  type AvgVisualProductionRequirementV1, type AvgVisualProductionBatchV1, type AvgAuthorMediaChoice } from './media-production-contract'
import { validateAvgVisualProductionBatchSourceV1 } from './media-source'

/** Undo only the unconsumed image-slot proposals made by a previous batch.
 * Authored predicates, unrelated bindings and actually selected assets stay
 * owned by their existing draft; this is not a delete/adoption operation. */
export function resetAvgUnconsumedMediaDeclarationsV1(value: AvgAuthorWorkspaceV1) {
  const next = parseAvgAuthorWorkspaceV1(value)
  for (const r of next.mediaBatch?.requirements ?? []) {
    if (!['inventory', 'evidence'].includes(r.consumer.domain) || next.presentation.stage.assets.some(a => a.assetKey === r.assetKey)) continue
    const item = next.systemPlan.version === 2 ? next.systemPlan.inventory.items.find(i => i.key === r.consumer.subjectKey) : undefined
    const view = r.itemVariantKey === null ? item : item?.variants.find(v => v.key === r.itemVariantKey)
    const key = r.consumer.domain === 'inventory' ? 'iconAssetKey' : 'detailAssetKey'
    if (view?.[key] === r.assetKey) view[key] = null
  }
  return next
}

/** A reviewable draft proposal before source freeze. It only declares existing
 * item display slots; predicates, gameplay states and actions remain authored. */
export function prepareAvgMediaConsumerDeclarationsV1(value: AvgAuthorWorkspaceV1, requirements: AvgVisualProductionRequirementV1[]) {
  const next = parseAvgAuthorWorkspaceV1(value)
  for (const raw of requirements) {
    const r = parseAvgVisualProductionRequirementV1(raw), c = r.consumer
    if (c.domain !== 'inventory' && c.domain !== 'evidence') continue
    const item = next.systemPlan.version === 2 ? next.systemPlan.inventory.items.find(item => item.key === c.subjectKey) : undefined
    const view = r.itemVariantKey === null ? item : item?.variants.find(v => v.key === r.itemVariantKey)
    if (!view) throw new Error('[avg-media] 没有准确的物件显示槽，不能自动创建玩法条件')
    const key = c.domain === 'inventory' ? 'iconAssetKey' : 'detailAssetKey'
    if (view[key] !== null && view[key] !== r.assetKey) throw new Error('[avg-media] 物件显示槽已绑定其他图片，请先明确修订')
    view[key] = r.assetKey
  }
  return next
}

/** Pure candidate configuration. Callers must obtain adopted choices through
 * the authority service; final stage adoption independently rechecks them. */
export async function applyAvgMediaChoicesToDraftV1(input: { workspace: AvgAuthorWorkspaceV1; batch: AvgVisualProductionBatchV1; choices: AvgAuthorMediaChoice[];replaceablePlaceholders?:Array<{assetKey:string;contentHash:string}> }) {
  const next = parseAvgAuthorWorkspaceV1(input.workspace)
  const batch = await validateAvgVisualProductionBatchSourceV1(input.batch, next)
  const choices = input.choices.map(parseAvgAuthorMediaChoice)
  if (choices.length !== batch.requirements.length || new Set(choices.map(choice => choice.requirementKey)).size !== choices.length) throw new Error('[avg-media] 自动配置需要全部准确且唯一的作者选择')
  for (const r of batch.requirements) {
    const choice = choices.find(choice => choice.requirementKey === r.requirementKey)
    if (!choice || choice.requirementRevision !== r.revision || choice.asset.assetKey !== r.assetKey || choice.referenceOnly !== (r.consumer.domain === 'reference')) {
      throw new Error('[avg-media] 自动配置的选择与冻结需求不一致')
    }
    const existing = next.presentation.stage.assets.find(asset => asset.assetKey === r.assetKey)
    if (choice.referenceOnly) {
      if (existing) throw new Error('[avg-media] 参考图已出现在运行目录，请先明确移除')
      continue
    }
    const inherited=next.presentation.inheritedImages?.find(entry=>entry.assetKey===r.assetKey)
    if (existing && canonicalProductProductionJsonV2(existing) !== canonicalProductProductionJsonV2(choice.asset)) {
      const inheritedHash=inherited?.source.processing?.contentHash??inherited?.source.raw.contentHash
      if(inheritedHash!==existing.contentHash&&!input.replaceablePlaceholders?.some(p=>p.assetKey===existing.assetKey&&p.contentHash===existing.contentHash))throw new Error('[avg-media] 同 key 已有其他图像版本，请先明确修订')
      next.presentation.stage.assets[next.presentation.stage.assets.indexOf(existing)]=choice.asset
    }
    if (!existing) next.presentation.stage.assets.push(choice.asset)
    if(inherited){
      next.presentation.inheritedImages=next.presentation.inheritedImages!.filter(entry=>entry.assetKey!==r.assetKey)
      if(!next.presentation.inheritedImages.length)delete next.presentation.inheritedImages
    }
    if (r.consumer.domain === 'stage') {
      const type = r.consumer.slot === 'actor' ? 'show-actor' : r.consumer.slot === 'background' ? 'set-background' : 'show-cg'
      const cue = next.presentation.stage.cues.find(cue => cue.type === type && cue.beatKey === r.triggerBeatKey
        && (type !== 'show-actor' || cue.actorKey === r.consumer.subjectKey))
      if (cue) {
        if (cue.assetKey !== r.assetKey) throw new Error('[avg-media] 演出消费槽已有其他图片，请先明确修订')
      } else {
        const cueKey = `avg.media.${r.requirementKey}`
        if (next.presentation.stage.cues.some(cue => cue.cueKey === cueKey)) throw new Error('[avg-media] 自动配置 Cue key 与现有演出冲突')
        next.presentation.stage.cues.push({ cueKey, type, assetKey: r.assetKey, beatKey: r.triggerBeatKey!, phase: 'before', durationMs: 0,
          order: next.presentation.stage.cues.reduce((max, cue) => Math.max(max, cue.order ?? 0), -1) + 1, easing: 'linear',
          ...(type === 'show-actor' ? { actorKey: r.consumer.subjectKey, slot: 'center' as const } : {}) })
      }
    } else {
      const item = next.systemPlan.version === 2 ? next.systemPlan.inventory.items.find(item => item.key === r.consumer.subjectKey) : undefined
      const view = r.itemVariantKey === null ? item : item?.variants.find(view => view.key === r.itemVariantKey)
      if (!view || (r.consumer.domain === 'inventory' ? view.iconAssetKey : view.detailAssetKey) !== r.assetKey) throw new Error('[avg-media] 物件图片必须在生成前声明准确的显示槽')
    }
  }
  return parseAvgAuthorWorkspaceV1(next)
}
