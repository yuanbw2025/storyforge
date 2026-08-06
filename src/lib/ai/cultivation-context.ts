import { readOwnedRows, resolveScope } from '../world-engine/scope'
import type { WorkspaceScope } from '../types/world-ownership'
import {
  cultivationStageTiers,
  parseCultivationStages,
  type CultivationSystem,
} from '../types/cultivation'

function formatSystem(
  system: CultivationSystem,
  assignments: Array<{ name: string; stageId?: string | null }>,
): string {
  const stages = parseCultivationStages(system.stages)
  const tiers = cultivationStageTiers(stages)
  const stageById = new Map(stages.map(stage => [stage.id, stage]))
  const lines = [`[修炼流派] ${system.name}${system.description ? `：${system.description}` : ''}`]
  for (const stage of [...stages].sort((left, right) =>
    (tiers.get(left.id) ?? 0) - (tiers.get(right.id) ?? 0)
    || left.name.localeCompare(right.name, 'zh-Hans-CN'))) {
    const parents = stage.parentStageIds
      .map(parentId => stageById.get(parentId)?.name ?? parentId)
      .join(' + ')
    const annotations = [
      stage.branchLabel && `分支:${stage.branchLabel}`,
      parents && `前置:${parents}`,
      stage.features && `特征:${stage.features}`,
      stage.breakthrough && `突破:${stage.breakthrough}`,
    ].filter(Boolean)
    lines.push(`- T${tiers.get(stage.id) ?? 0} ${stage.name}${annotations.length ? `（${annotations.join('；')}）` : ''}`)
  }
  if (assignments.length) {
    lines.push(`- 已关联角色：${assignments.map(item => {
      const stage = item.stageId ? stageById.get(item.stageId) : undefined
      return `${item.name}${stage ? `@${stage.name}` : ''}`
    }).join('、')}`)
  }
  return lines.join('\n')
}

/** 修炼体系是世界级上游设定；null 只代表单世界，不跨世界泄漏。 */
export async function buildCultivationContext(
  projectId: number,
  worldGroupId?: number | null,
  scope?: WorkspaceScope,
): Promise<string> {
  const resolved = scope ?? await resolveScope({ projectId })
  const [allSystems, characters] = await Promise.all([
    readOwnedRows<CultivationSystem>(resolved, 'cultivationSystems', { owner: 'world' }),
    readOwnedRows<any>(resolved, 'characters', { owner: 'world' }),
  ])
  const systems = worldGroupId === undefined
    ? allSystems
    : allSystems.filter(system => (system.worldGroupId ?? null) === (worldGroupId ?? null))
  if (!systems.length) return ''
  const blocks = systems
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
    .map(system => formatSystem(system, characters
      .filter(character => character.cultivationSystemId === system.id)
      .map(character => ({ name: character.name, stageId: character.cultivationStageId }))))
  return `【修炼体系】（利用世界底层能量的具体流派；境界关系必须遵守）\n${blocks.join('\n')}`
}
