import { hashProductProductionValueV2 } from '../product-production/hash'
import type {
  TextOpenWorldPlayerCharacterDefinitionV1,
  TextOpenWorldRuntimePackageV1,
  WorkspaceScope,
} from '../types'
import {
  openWorldSemanticResourceCatalogV1,
  readWorldSemanticResourceV1,
} from '../context-gateway/world-release-client'
import { parseTextOpenWorldModulesV1, parseTextOpenWorldPlayerCharacterDefinitionV1 } from './modules'
import { parseTextOpenWorldRuntimePackageV1 } from './runtime-package'

type PlayerIdentityV1 = TextOpenWorldPlayerCharacterDefinitionV1['identity']
type PlayerBuildV1 = TextOpenWorldPlayerCharacterDefinitionV1['build']
export type TextOpenWorldPlayerIdentityDraftV1 = Omit<PlayerIdentityV1, 'sourceRefs'>

export type TextOpenWorldPlayerDefinitionOriginV1 =
  | { kind: 'creator-authored' }
  | { kind: 'ai-candidate'; candidateKey: string; authorConfirmed: boolean }
  | { kind: 'preset'; presetKey: string }

const STABLE_KEY = /^[a-z][a-z0-9._:-]{0,199}$/

function fail(message: string): never {
  throw new Error(`[text-open-world-player] ${message}`)
}

function stableKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !STABLE_KEY.test(value)) fail(`${label}不是稳定key`)
  return value
}

function sourceRefs(origin: TextOpenWorldPlayerDefinitionOriginV1): string[] {
  if (!origin || typeof origin !== 'object') fail('主角来源无效')
  if (origin.kind === 'creator-authored') return ['text-open-world:creator-authored']
  if (origin.kind === 'preset') return [`text-open-world:preset:${stableKey(origin.presetKey, 'presetKey')}`]
  if (origin.kind === 'ai-candidate') {
    if (origin.authorConfirmed !== true) fail('AI主角候选必须经作者确认后才能进入Build')
    return [`text-open-world:ai-candidate:${stableKey(origin.candidateKey, 'candidateKey')}`]
  }
  return fail('主角来源无效')
}

/**
 * Converts creator input, a confirmed AI candidate, or a selected preset into
 * the one Release-owned protagonist contract. It performs no model call and
 * cannot write runtime state.
 */
export function compileTextOpenWorldPlayerDefinitionV1(input: {
  origin: TextOpenWorldPlayerDefinitionOriginV1
  identity: TextOpenWorldPlayerIdentityDraftV1
  build: PlayerBuildV1
}): TextOpenWorldPlayerCharacterDefinitionV1 {
  return parseTextOpenWorldPlayerCharacterDefinitionV1({
    key: 'player',
    identity: { ...structuredClone(input.identity), sourceRefs: sourceRefs(input.origin) },
    build: structuredClone(input.build),
  })
}

function sourceText(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  return typeof value === 'string' ? value.trim().normalize('NFC') : ''
}

function joinSourceText(record: Record<string, unknown>, fields: readonly string[]): string {
  return [...new Set(fields.map(field => sourceText(record, field)).filter(Boolean))].join('\n')
}

/**
 * Reads a character only from an immutable WorldRelease and freezes a product
 * copy. The source record is never retained as a live database dependency.
 */
export async function compileTextOpenWorldPlayerFromWorldReleaseV1(input: {
  scope: WorkspaceScope
  worldReleaseId: number
  resourceId: string
  runtimePackage: TextOpenWorldRuntimePackageV1
  build: PlayerBuildV1
  identityOverrides?: Partial<TextOpenWorldPlayerIdentityDraftV1>
}): Promise<TextOpenWorldPlayerCharacterDefinitionV1> {
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(input.runtimePackage)
  if (runtimePackage.sourceManifest.kind !== 'world-release') fail('运行包来源不是WorldRelease')
  const catalog = await openWorldSemanticResourceCatalogV1({
    localReleaseRecordId: input.worldReleaseId,
    expectedProjectId: input.scope.projectId,
    expectedWorldId: input.scope.worldId,
  })
  const descriptor = catalog.resources.find(item => item.resourceKey === input.resourceId)
  if (!descriptor) fail('冻结WorldRelease角色资源不可用')
  if (descriptor.kind !== 'character') fail('所选WorldRelease资源不是角色')
  if (runtimePackage.sourceManifest.contentHash !== catalog.scope.worldReleaseHash
    || runtimePackage.sourceManifest.sourceVersion !== catalog.description.identity.releaseVersion) {
    fail('运行包与所选WorldRelease版本不一致')
  }
  const evidence = runtimePackage.sourceManifest.resourceHashes.find(item => item.resourceId === descriptor.resourceKey)
  if (!evidence || evidence.contentHash !== descriptor.contentHash) {
    fail('运行包没有冻结所选角色的资源Hash证据')
  }
  const source = await readWorldSemanticResourceV1({ scope: catalog.scope, descriptor })

  const identity: TextOpenWorldPlayerIdentityDraftV1 = {
    name: sourceText(source.value, 'name'),
    pronouns: '',
    appearance: sourceText(source.value, 'appearance'),
    background: sourceText(source.value, 'background'),
    personality: sourceText(source.value, 'personality'),
    publicKnowledge: joinSourceText(source.value, ['shortDescription', 'identity']),
    privateKnowledge: joinSourceText(source.value, ['innerConflict', 'fears']),
    shortGoal: sourceText(source.value, 'motivation'),
    longGoal: sourceText(source.value, 'goals'),
    portrayal: joinSourceText(source.value, ['speechStyle', 'habits']),
    ...structuredClone(input.identityOverrides ?? {}),
  }
  return parseTextOpenWorldPlayerCharacterDefinitionV1({
    key: 'player',
    identity: { ...identity, sourceRefs: [descriptor.resourceKey] },
    build: structuredClone(input.build),
  })
}

/**
 * Replaces the actor module's protagonist and recalculates its content hash.
 * Full module validation then rejects invalid initial levels, skills or items.
 */
export async function installTextOpenWorldPlayerDefinitionV1(input: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  player: TextOpenWorldPlayerCharacterDefinitionV1
}): Promise<TextOpenWorldRuntimePackageV1> {
  const runtimePackage = parseTextOpenWorldRuntimePackageV1(input.runtimePackage)
  const player = parseTextOpenWorldPlayerCharacterDefinitionV1(input.player)
  const actorPayload = structuredClone(runtimePackage.modules.actors.payload) as Record<string, unknown>
  actorPayload.player = player
  const result = structuredClone(runtimePackage)
  result.modules.actors = {
    ...result.modules.actors,
    payload: actorPayload,
    contentHash: await hashProductProductionValueV2(actorPayload),
  }
  parseTextOpenWorldModulesV1(result)
  return parseTextOpenWorldRuntimePackageV1(result)
}
