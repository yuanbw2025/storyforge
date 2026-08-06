import { db } from '../db/schema'
import {
  aggregateInventory,
  EMPTY_SIMULATION_STATE,
  SIMULATION_CANON_SOURCE_KINDS,
  type Character,
  type RuntimeEntityState,
  type SimulationCanonCandidate,
  type SimulationCanonSnapshotV1,
  type SimulationCanonSource,
  type SimulationRuntimeState,
  type WorkspaceScope,
  type WorldReleaseManifestV2,
} from '../types'
import { assertRecordInScope, readOwnedRows, resolveReadScopeLike, resolveScope } from '../world-engine/scope'

const KIND_ORDER = new Map(SIMULATION_CANON_SOURCE_KINDS.map((kind, index) => [kind, index]))

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function compact(value: string | null | undefined, max = 240): string {
  const normalized = value?.trim().replace(/\s+/g, ' ') ?? ''
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized
}

function fields(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(Object.entries(input).flatMap(([key, value]) => {
    if (value == null) return []
    const text = typeof value === 'string' ? value.trim() : stableJson(value)
    return text ? [[key, text]] : []
  }))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

async function sha256(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function sourceHashInput(source: SimulationCanonCandidate | SimulationCanonSource) {
  return {
    sourceKey: source.sourceKey,
    kind: source.kind,
    recordId: source.recordId,
    name: source.name,
    summary: source.summary,
    fields: source.fields,
    updatedAt: source.updatedAt,
  }
}

function snapshotHashInput(snapshot: Omit<SimulationCanonSnapshotV1, 'snapshotHash'>) {
  return {
    schema: snapshot.schema,
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    worldGroupId: snapshot.worldGroupId,
    worldLabel: snapshot.worldLabel,
    sources: snapshot.sources,
  }
}

function visibleCharacter(character: Character, worldGroupId: number | null): boolean {
  return !!character.isCrossWorld
    || (character.homeWorldGroupId ?? null) === worldGroupId
}

function recordKey(prefix: string, row: { id?: number; ragDocumentId?: string }): string {
  const stableId = row.ragDocumentId?.trim() || row.id
  if (stableId == null) throw new Error(`${prefix} Canon 来源缺少稳定标识。`)
  return `${prefix}:${stableId}`
}

function sortCandidates(candidates: SimulationCanonCandidate[]): SimulationCanonCandidate[] {
  return candidates.sort((left, right) => (
    (KIND_ORDER.get(left.kind) ?? 99) - (KIND_ORDER.get(right.kind) ?? 99)
    || left.name.localeCompare(right.name, 'zh-Hans-CN')
    || left.sourceKey.localeCompare(right.sourceKey)
  ))
}

export async function loadSimulationCanonCandidates(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
}): Promise<{ worldLabel: string; candidates: SimulationCanonCandidate[] }> {
  const scope = input.scope
    ? await resolveScope({ projectId: input.projectId, scope: input.scope })
    : await resolveReadScopeLike(input.projectId)
  const project = await db.projects.get(input.projectId)
  if (!project) throw new Error('Canon 冻结所属项目不存在。')
  const world = input.worldGroupId == null ? null : await db.worldGroups.get(input.worldGroupId)
  if (input.worldGroupId != null && !await assertRecordInScope(scope, 'worldGroups', world, { owner: 'world' })) {
    throw new Error('Canon 冻结所属世界不存在或不属于当前项目。')
  }
  const worldLabel = world?.name.trim() || project.name.trim() || '默认世界'
  const [worldviews, powerSystems, rules, characters, locations, itemEntries] = await Promise.all([
    readOwnedRows<any>(scope, 'worldviews', { owner: 'world' }),
    readOwnedRows<any>(scope, 'powerSystems', { owner: 'world' }),
    readOwnedRows<any>(scope, 'worldRulesProfiles', { owner: 'world' }),
    readOwnedRows<Character>(scope, 'characters', { owner: 'world' }),
    readOwnedRows<any>(scope, 'importantLocations', { owner: 'world' }),
    readOwnedRows<any>(scope, 'itemLedger', { owner: 'work' }),
  ])
  const candidates: SimulationCanonCandidate[] = []

  candidates.push({
    sourceKey: world ? `world-group:${world.id}` : `project-world:${project.id}`,
    kind: 'world',
    recordId: world?.id ?? project.id ?? null,
    name: worldLabel,
    summary: compact(world?.description || project.description || '当前项目默认世界'),
    fields: fields(world ? {
      type: world.type,
      entryCondition: world.entryCondition,
      exitCondition: world.exitCondition,
      powerRestriction: world.powerRestriction,
      takeawayRules: world.takeawayRules,
    } : {
      genre: project.genre,
      genres: project.genres,
    }),
    updatedAt: world?.updatedAt ?? project.updatedAt,
  })

  for (const worldview of worldviews) {
    if ((worldview.worldGroupId ?? null) !== input.worldGroupId) continue
    candidates.push({
      sourceKey: recordKey('worldview', worldview),
      kind: 'world',
      recordId: worldview.id ?? null,
      name: `${worldLabel}世界观`,
      summary: compact(worldview.summary || worldview.worldOrigin || worldview.worldStructure),
      fields: fields({
        summary: worldview.summary,
        worldOrigin: worldview.worldOrigin,
        worldStructure: worldview.worldStructure,
        geography: worldview.geography,
        history: worldview.historyLine || worldview.history,
        society: worldview.society,
        culture: worldview.cultureOverview || worldview.culture,
        rules: worldview.rules,
        factionLayout: worldview.factionLayout,
        itemDesign: worldview.itemDesign,
      }),
      updatedAt: worldview.updatedAt,
    })
  }

  for (const rule of rules) {
    if ((rule.worldGroupId ?? null) !== input.worldGroupId) continue
    candidates.push({
      sourceKey: `world-rules:${rule.id}`,
      kind: 'rule',
      recordId: rule.id ?? null,
      name: `${worldLabel}世界规则`,
      summary: compact(rule.globalNote || '真实与幻想规则配置'),
      fields: fields({ entries: rule.entries, customNodes: rule.customNodes, globalNote: rule.globalNote }),
      updatedAt: rule.updatedAt,
    })
  }

  for (const power of powerSystems) {
    if ((power.worldGroupId ?? null) !== input.worldGroupId) continue
    candidates.push({
      sourceKey: `power-system:${power.id}`,
      kind: 'rule',
      recordId: power.id ?? null,
      name: power.name.trim() || '未命名力量体系',
      summary: compact(power.description || power.rules),
      fields: fields({ description: power.description, levels: power.levels, rules: power.rules }),
      updatedAt: power.updatedAt,
    })
  }

  const visibleCharacters = characters.filter(character => visibleCharacter(character, input.worldGroupId))
  for (const character of visibleCharacters) {
    if (!character.name.trim()) continue
    candidates.push({
      sourceKey: recordKey('character', character),
      kind: 'character',
      recordId: character.id ?? null,
      name: character.name.trim(),
      summary: compact(character.shortDescription || character.identity || character.personality),
      fields: fields({
        roleWeight: character.roleWeight,
        identity: character.identity,
        appearance: character.appearance,
        personality: character.personality,
        background: character.background,
        motivation: character.goals || character.motivation,
        abilities: character.abilities,
        powerLevel: character.powerLevel,
        relationships: character.relationships,
        arc: character.arc,
        location: character.location,
      }),
      updatedAt: character.updatedAt,
    })
  }

  for (const location of locations) {
    if (!location.name.trim()) continue
    candidates.push({
      sourceKey: recordKey('location', location),
      kind: 'location',
      recordId: location.id ?? null,
      name: location.name.trim(),
      summary: compact(location.description || location.significance),
      fields: fields({
        tags: location.tags,
        description: location.description,
        significance: location.significance,
        parentId: location.parentId,
      }),
      updatedAt: location.updatedAt,
    })
  }

  const visibleCharacterIds = new Set(visibleCharacters.flatMap(character => (
    character.id == null ? [] : [character.id]
  )))
  const visibleCharacterNames = new Set(visibleCharacters.map(character => character.name.trim()))
  const knownCharacterNames = new Set(characters.map(character => character.name.trim()))
  for (const item of aggregateInventory(itemEntries)) {
    if (item.quantity <= 0 || !item.itemName.trim()) continue
    if (item.characterId != null && !visibleCharacterIds.has(item.characterId)) continue
    if (
      item.characterId == null
      && knownCharacterNames.has(item.heldByName.trim())
      && !visibleCharacterNames.has(item.heldByName.trim())
    ) continue
    const latest = item.entries[item.entries.length - 1]
    if (latest?.id == null) continue
    candidates.push({
      sourceKey: `item:${latest.id}`,
      kind: 'item',
      recordId: latest.id,
      name: item.itemName.trim(),
      summary: `${item.heldByName || '未指定持有人'}持有 ${item.quantity}`,
      fields: fields({
        quantity: item.quantity,
        heldByName: item.heldByName,
        characterId: item.characterId,
        latestChapter: latest.chapterTitle,
        latestNote: latest.note,
      }),
      updatedAt: latest.createdAt,
    })
  }

  return { worldLabel, candidates: sortCandidates(candidates) }
}

function runtimeEntity(
  source: SimulationCanonSource,
  selectedLocations: Map<string, SimulationCanonSource>,
): RuntimeEntityState | null {
  if (source.kind !== 'character' && source.kind !== 'location' && source.kind !== 'item') return null
  const matchedLocation = source.kind === 'character'
    ? selectedLocations.get(source.fields.location?.trim().toLocaleLowerCase() ?? '')
    : null
  const attributes = Object.fromEntries(Object.entries(source.fields).map(([key, value]) => {
    if (source.kind === 'item' && key === 'quantity') return [key, Number(value)]
    return [key, value]
  }))
  return {
    entityKey: source.sourceKey,
    kind: source.kind,
    sourceId: source.recordId,
    name: source.name,
    locationKey: source.kind === 'location' ? source.sourceKey : matchedLocation?.sourceKey ?? null,
    lifecycleStatus: 'active',
    attributes,
  }
}

export async function buildSimulationCanonSnapshot(input: {
  projectId: number
  scope?: WorkspaceScope
  worldGroupId: number | null
  sourceKeys: readonly string[]
}): Promise<{ snapshot: SimulationCanonSnapshotV1; initialState: SimulationRuntimeState }> {
  const requested = new Set(input.sourceKeys.map(key => key.trim()).filter(Boolean))
  if (requested.size === 0) throw new Error('请至少选择一个 Canon 来源。')
  const catalog = await loadSimulationCanonCandidates(input)
  const selected = catalog.candidates.filter(candidate => requested.has(candidate.sourceKey))
  const missing = [...requested].filter(key => !selected.some(candidate => candidate.sourceKey === key))
  if (missing.length > 0) throw new Error(`Canon 来源不存在或不属于当前世界: ${missing.join(', ')}`)

  const sources: SimulationCanonSource[] = []
  for (const candidate of selected) {
    sources.push({
      ...candidate,
      fields: structuredClone(candidate.fields),
      contentHash: await sha256(sourceHashInput(candidate)),
    })
  }
  const snapshotBase: Omit<SimulationCanonSnapshotV1, 'snapshotHash'> = {
    schema: 'storyforge.simulation-canon',
    version: 1,
    createdAt: Date.now(),
    worldGroupId: input.worldGroupId,
    worldLabel: catalog.worldLabel,
    sources,
  }
  const snapshot: SimulationCanonSnapshotV1 = {
    ...snapshotBase,
    snapshotHash: await sha256(snapshotHashInput(snapshotBase)),
  }
  const selectedLocations = new Map(sources
    .filter(source => source.kind === 'location')
    .map(source => [source.name.toLocaleLowerCase(), source]))
  const entities = Object.fromEntries(sources.flatMap(source => {
    const entity = runtimeEntity(source, selectedLocations)
    return entity ? [[entity.entityKey, entity]] : []
  }))
  return {
    snapshot,
    initialState: { ...structuredClone(EMPTY_SIMULATION_STATE), entities },
  }
}

/** Build a verifiable SIM Canon envelope from an immutable WORLD-2E release. */
export async function buildReleaseSimulationCanonSnapshot(
  manifest: WorldReleaseManifestV2,
  createdAt: number,
): Promise<SimulationCanonSnapshotV1> {
  const sources: SimulationCanonSource[] = []
  for (const dependency of manifest.dependencies) {
    const candidate: SimulationCanonCandidate = {
      sourceKey: `release-table:${dependency.table}`,
      kind: 'world',
      recordId: null,
      name: dependency.table,
      summary: `${dependency.rowCount} 条冻结记录`,
      fields: {
        table: dependency.table,
        rowCount: String(dependency.rowCount),
        tableHash: dependency.contentHash,
      },
      updatedAt: createdAt,
    }
    sources.push({
      ...candidate,
      contentHash: await sha256(sourceHashInput(candidate)),
    })
  }
  const snapshotBase: Omit<SimulationCanonSnapshotV1, 'snapshotHash'> = {
    schema: 'storyforge.simulation-canon',
    version: 1,
    createdAt,
    worldGroupId: null,
    worldLabel: manifest.worldName,
    sources,
  }
  return {
    ...snapshotBase,
    snapshotHash: await sha256(snapshotHashInput(snapshotBase)),
  }
}

export function parseSimulationCanonSnapshot(value: string): SimulationCanonSnapshotV1 | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!isObject(parsed)) return null
  const snapshot = parsed as unknown as Partial<SimulationCanonSnapshotV1>
  if (
    snapshot.schema !== 'storyforge.simulation-canon'
    || snapshot.version !== 1
    || !Number.isFinite(snapshot.createdAt)
    || (snapshot.worldGroupId != null && !Number.isInteger(snapshot.worldGroupId))
    || typeof snapshot.worldLabel !== 'string'
    || !Array.isArray(snapshot.sources)
    || typeof snapshot.snapshotHash !== 'string'
    || !/^[0-9a-f]{64}$/.test(snapshot.snapshotHash)
  ) return null
  const sourceKeys = new Set<string>()
  for (const source of snapshot.sources) {
    if (
      !isObject(source)
      || typeof source.sourceKey !== 'string'
      || !source.sourceKey
      || sourceKeys.has(source.sourceKey)
      || !SIMULATION_CANON_SOURCE_KINDS.includes(source.kind as never)
      || (source.recordId != null && (!Number.isInteger(source.recordId) || source.recordId <= 0))
      || typeof source.name !== 'string'
      || typeof source.summary !== 'string'
      || !isObject(source.fields)
      || Object.values(source.fields).some(field => typeof field !== 'string')
      || !Number.isFinite(source.updatedAt)
      || typeof source.contentHash !== 'string'
      || !/^[0-9a-f]{64}$/.test(source.contentHash)
    ) return null
    sourceKeys.add(source.sourceKey)
  }
  return snapshot as SimulationCanonSnapshotV1
}

export async function verifySimulationCanonSnapshot(
  snapshot: SimulationCanonSnapshotV1,
): Promise<boolean> {
  for (const source of snapshot.sources) {
    const expected = await sha256(sourceHashInput(source))
    if (expected !== source.contentHash) return false
  }
  return await sha256(snapshotHashInput(snapshot))
    === snapshot.snapshotHash
}
