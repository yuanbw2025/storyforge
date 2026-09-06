import { AI_TOWN_DAY_SLOTS, type AiTownProductionBriefV1, type AiTownWorldSourceSelectionV1 } from '../types'
import { hashProductProductionValueV2 } from '../product-production/hash'

function fail(message: string): never {
  throw new Error(`[ai-town-contract] ${message}`)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} 必须是对象`)
  return value as Record<string, unknown>
}

function exact(row: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(row).sort()
  const keys = [...expected].sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) fail(`${label} 字段不符合合同:${actual.join(',')}`)
}

function text(value: unknown, label: string, maximum = 4_000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail(`${label} 无效`)
  return value.trim().normalize('NFC')
}

function hash(value: unknown, label: string): string {
  const result = text(value, label, 64)
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${label} 不是 sha256`)
  return result
}

function id(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail(`${label} 不是正整数`)
  return Number(value)
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) fail(`${label} 必须是 ${minimum}..${maximum}`)
  return Number(value)
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') fail(`${label} 必须是布尔值`)
  return value
}

function stringArray(value: unknown, label: string, maximum: number, allowEmpty = true): string[] {
  if (!Array.isArray(value) || value.length > maximum || (!allowEmpty && value.length === 0)) fail(`${label} 必须是有界数组`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 1_000))
  if (new Set(result).size !== result.length) fail(`${label} 不得重复`)
  return result
}

function sourceKeys(value: unknown, label: string, maximum: number, allowEmpty = true): string[] {
  const result = stringArray(value, label, maximum, allowEmpty)
  if (result.some(key => !key.startsWith('world-release:') || /\s/.test(key))) fail(`${label} 含非便携世界资源 key`)
  return result.sort()
}

export function parseAiTownWorldSourceSelectionV1(value: unknown): AiTownWorldSourceSelectionV1 {
  const row = record(value, 'sourceSelection')
  exact(row, [
    'schema', 'version', 'productType', 'worldReleaseId', 'worldReferenceHash', 'worldContentHash',
    'sourceMappingVersion', 'endingResourceKeys', 'residentResourceKeys', 'relationSubgraphResourceKeys',
    'locationResourceKeys', 'ruleAndLoreResourceKeys', 'artifactResourceKeys',
    'dependencyClosureResourceKeys', 'selectionHash',
  ], 'sourceSelection')
  if (row.schema !== 'storyforge.ai-town-world-source-selection' || row.version !== 1 || row.productType !== 'ai-town' || row.sourceMappingVersion !== 1) fail('sourceSelection identity 无效')
  const endingResourceKeys = sourceKeys(row.endingResourceKeys, 'endingResourceKeys', 100, false)
  const residentResourceKeys = sourceKeys(row.residentResourceKeys, 'residentResourceKeys', 8, false)
  if (residentResourceKeys.length < 4) fail('AI 小镇至少需要 4 名居民')
  const relationSubgraphResourceKeys = sourceKeys(row.relationSubgraphResourceKeys, 'relationSubgraphResourceKeys', 128)
  const locationResourceKeys = sourceKeys(row.locationResourceKeys, 'locationResourceKeys', 80)
  const ruleAndLoreResourceKeys = sourceKeys(row.ruleAndLoreResourceKeys, 'ruleAndLoreResourceKeys', 300)
  const artifactResourceKeys = sourceKeys(row.artifactResourceKeys, 'artifactResourceKeys', 100)
  const dependencyClosureResourceKeys = sourceKeys(row.dependencyClosureResourceKeys, 'dependencyClosureResourceKeys', 1_000, false)
  const expectedClosure = [...new Set([
    ...endingResourceKeys, ...residentResourceKeys, ...relationSubgraphResourceKeys,
    ...locationResourceKeys, ...ruleAndLoreResourceKeys, ...artifactResourceKeys,
  ])].sort()
  if (expectedClosure.length !== dependencyClosureResourceKeys.length
    || expectedClosure.some((key, index) => key !== dependencyClosureResourceKeys[index])) {
    fail('dependency closure 必须精确等于已验证来源闭包')
  }
  return {
    schema: 'storyforge.ai-town-world-source-selection', version: 1, productType: 'ai-town',
    worldReleaseId: id(row.worldReleaseId, 'worldReleaseId'),
    worldReferenceHash: hash(row.worldReferenceHash, 'worldReferenceHash'),
    worldContentHash: hash(row.worldContentHash, 'worldContentHash'), sourceMappingVersion: 1,
    endingResourceKeys, residentResourceKeys, relationSubgraphResourceKeys, locationResourceKeys,
    ruleAndLoreResourceKeys, artifactResourceKeys, dependencyClosureResourceKeys,
    selectionHash: hash(row.selectionHash, 'selectionHash'),
  }
}

export function aiTownWorldSourceSelectionHashPayloadV1(selection: AiTownWorldSourceSelectionV1) {
  const { worldReleaseId: _localWorldReleaseId, selectionHash: _selectionHash, ...portable } = selection
  return portable
}

export async function assertAiTownWorldSourceSelectionHashV1(value: unknown): Promise<AiTownWorldSourceSelectionV1> {
  const selection = parseAiTownWorldSourceSelectionV1(value)
  const expected = await hashProductProductionValueV2(aiTownWorldSourceSelectionHashPayloadV1(selection))
  if (selection.selectionHash !== expected) fail('sourceSelection selectionHash 与便携来源内容不一致')
  return selection
}

export function parseAiTownProductionBriefV1(value: unknown): AiTownProductionBriefV1 {
  const row = record(value, 'aiTown')
  exact(row, ['schema', 'version', 'sourceSelection', 'player', 'continuity', 'town', 'clock', 'autonomy', 'management', 'safety', 'media', 'authorConfirmed'], 'aiTown')
  if (row.schema !== 'storyforge.ai-town-production-brief' || row.version !== 1) fail('aiTown schema/version 无效')
  const sourceSelection = parseAiTownWorldSourceSelectionV1(row.sourceSelection)
  const player = record(row.player, 'aiTown.player')
  exact(player, ['role', 'name', 'homeConcept'], 'aiTown.player')
  if (!['new-resident', 'caretaker'].includes(String(player.role))) fail('player.role 无效')
  const continuity = record(row.continuity, 'aiTown.continuity')
  exact(continuity, ['mode', 'elapsedDays', 'romance'], 'aiTown.continuity')
  if (continuity.mode !== 'strict-post-canon' || !['off', 'canon-only', 'opt-in'].includes(String(continuity.romance))) fail('continuity 无效')
  const town = record(row.town, 'aiTown.town')
  exact(town, ['title', 'premise', 'majorLocationTarget', 'residentTarget'], 'aiTown.town')
  const clock = record(row.clock, 'aiTown.clock')
  exact(clock, ['slots', 'actionsPerDay'], 'aiTown.clock')
  const slots = stringArray(clock.slots, 'aiTown.clock.slots', 6, false)
  if (slots.join(',') !== AI_TOWN_DAY_SLOTS.join(',')) fail('AI 小镇必须使用固定六时段')
  const autonomy = record(row.autonomy, 'aiTown.autonomy')
  exact(autonomy, ['level', 'offlineEnabled', 'offlineMaximumDays'], 'aiTown.autonomy')
  if (autonomy.level !== 'observational-high') fail('autonomy.level 无效')
  const management = record(row.management, 'aiTown.management')
  exact(management, ['resourceKeys', 'startingMoney', 'sharedProjectConcept'], 'aiTown.management')
  const resourceKeys = stringArray(management.resourceKeys, 'aiTown.management.resourceKeys', 3, false)
  if (resourceKeys.some(key => !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key))) fail('management.resourceKeys 无效')
  const safety = record(row.safety, 'aiTown.safety')
  exact(safety, ['boundaries', 'majorChangeConfirmation', 'privateMindPlayerAccess'], 'aiTown.safety')
  if (safety.majorChangeConfirmation !== true || safety.privateMindPlayerAccess !== 'none') fail('AI 小镇重大变化和私密心智边界不可放宽')
  const media = record(row.media, 'aiTown.media')
  exact(media, ['portraits', 'expressions', 'locationCards', 'map', 'ambientAudio'], 'aiTown.media')
  if (media.map !== true) fail('AI 小镇地图是必需能力')
  const residentTarget = integer(town.residentTarget, 'aiTown.town.residentTarget', 4, 8)
  if (residentTarget !== sourceSelection.residentResourceKeys.length) fail('AI 小镇居民目标必须等于冻结居民选择数量')
  return {
    schema: 'storyforge.ai-town-production-brief', version: 1, sourceSelection,
    player: { role: player.role as 'new-resident' | 'caretaker', name: text(player.name, 'aiTown.player.name', 100), homeConcept: text(player.homeConcept, 'aiTown.player.homeConcept', 500) },
    continuity: { mode: 'strict-post-canon', elapsedDays: integer(continuity.elapsedDays, 'aiTown.continuity.elapsedDays', 1, 100_000), romance: continuity.romance as 'off' | 'canon-only' | 'opt-in' },
    town: { title: text(town.title, 'aiTown.town.title', 200), premise: text(town.premise, 'aiTown.town.premise'), majorLocationTarget: integer(town.majorLocationTarget, 'aiTown.town.majorLocationTarget', 4, 12), residentTarget },
    clock: { slots: slots as AiTownProductionBriefV1['clock']['slots'], actionsPerDay: integer(clock.actionsPerDay, 'aiTown.clock.actionsPerDay', 1, 6) },
    autonomy: { level: 'observational-high', offlineEnabled: bool(autonomy.offlineEnabled, 'aiTown.autonomy.offlineEnabled'), offlineMaximumDays: integer(autonomy.offlineMaximumDays, 'aiTown.autonomy.offlineMaximumDays', 1, 3) },
    management: { resourceKeys, startingMoney: integer(management.startingMoney, 'aiTown.management.startingMoney', 0, 1_000_000_000), sharedProjectConcept: text(management.sharedProjectConcept, 'aiTown.management.sharedProjectConcept') },
    safety: { boundaries: stringArray(safety.boundaries, 'aiTown.safety.boundaries', 100), majorChangeConfirmation: true, privateMindPlayerAccess: 'none' },
    media: { portraits: bool(media.portraits, 'aiTown.media.portraits'), expressions: bool(media.expressions, 'aiTown.media.expressions'), locationCards: bool(media.locationCards, 'aiTown.media.locationCards'), map: true, ambientAudio: bool(media.ambientAudio, 'aiTown.media.ambientAudio') },
    authorConfirmed: bool(row.authorConfirmed, 'aiTown.authorConfirmed'),
  }
}
