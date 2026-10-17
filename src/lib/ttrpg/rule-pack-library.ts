import Dexie from 'dexie'
import { db } from '../db/schema'
import { hashProductProductionValueV2 } from '../product-production/hash'
import type { TtrpgRulePackRecordV1, RulePackV1, WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope, scopeTransactionTables } from '../workspace/scope'
import { parseRulePackV1, runRulePackFixturesV1 } from './rule-pack'
import { createD100InvestigationRulePackV1 } from './d100-investigation-rule-pack'
import { createD20FantasyRulePackV1 } from './d20-fantasy-rule-pack'
import { createRankLiteRulePackV1 } from './rank-lite-rule-pack'
import { createStoryForgeRulePackV1 } from './storyforge-rule-pack'
import type { RulePackV2 } from './open-contract'
import { parseRulePackV2, projectTtrpgRulePackMechanicalCoreV1 } from './rule-pack-v2'
import { applyTtrpgHouseRuleOverlayV3, parseTtrpgHouseRuleOverlayV3 } from './house-rule-v2'

type SaveRulePackInput = {
  scope: WorkspaceScope
  rulePack: RulePackV1 | unknown
  status?: TtrpgRulePackRecordV1['status']
  /** Immutable package imports cannot overwrite another implementation at the same identity. */
  immutable?: boolean
}

function parseVersionedRulePack(value: unknown): RulePackV1 | RulePackV2 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('[ttrpg-rule-pack] RulePack 必须是对象')
  }
  const version = (value as Record<string, unknown>).version
  if (version === 1) return parseRulePackV1(value)
  if (version === 2) return parseRulePackV2(value)
  throw new Error('[ttrpg-rule-pack] RulePack version 无效')
}

async function verifyRulePackRow(scope: WorkspaceScope, row: TtrpgRulePackRecordV1): Promise<RulePackV1 | RulePackV2> {
  if (!await assertRecordInScope(scope, 'ttrpgRulePacks', row, { owner: 'work' })
    || row.worldId !== scope.worldId) throw new Error('[ttrpg-rule-pack] 规则行作用域不匹配')
  const rulePack = parseVersionedRulePack(JSON.parse(row.rulePackJson))
  if (row.ruleSystemId !== rulePack.ruleSystemId || row.ruleSystemVersion !== rulePack.ruleSystemVersion
    || row.title !== rulePack.title) throw new Error('[ttrpg-rule-pack] 规则行身份不匹配')
  // Keep only WebCrypto alive across the transaction; database reads must not
  // themselves be inside waitFor (Dexie pauses those operations while waiting).
  if (await Dexie.waitFor(hashProductProductionValueV2(rulePack)) !== row.contentHash) {
    throw new Error('[ttrpg-rule-pack] contentHash 校验失败')
  }
  if (rulePack.version === 2 && (await db.works.get(scope.workId))?.kind !== 'ttrpg') {
    throw new Error('[ttrpg-rule-pack] V2 规则只允许读取 ttrpg 作品')
  }
  return rulePack
}

export async function saveTtrpgRulePackV1(input: SaveRulePackInput): Promise<TtrpgRulePackRecordV1> {
  return saveRulePack(input, parseRulePackV1(input.rulePack))
}

export async function saveTtrpgRulePackV2(input: SaveRulePackInput): Promise<TtrpgRulePackRecordV1> {
  return saveRulePack(input, parseRulePackV2(input.rulePack))
}

async function saveRulePack(input: SaveRulePackInput, rulePack: RulePackV1 | RulePackV2): Promise<TtrpgRulePackRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  runRulePackFixturesV1(rulePack.version === 1 ? rulePack : projectTtrpgRulePackMechanicalCoreV1(rulePack))
  const status = input.status ?? 'validated'
  if (status !== 'draft' && status !== 'validated' && status !== 'archived') {
    throw new Error('[ttrpg-rule-pack] status 无效')
  }
  if (status === 'validated' && (!rulePack.license.commercialUse || !rulePack.license.attribution.trim())) {
    throw new Error('[ttrpg-rule-pack] validated RulePack 必须声明商业使用权和署名')
  }
  const contentHash = await hashProductProductionValueV2(rulePack)
  const rulePackJson = JSON.stringify(rulePack)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.ttrpgRulePacks), async () => {
    await resolveScope({ scope })
    if (rulePack.version === 2 && (await db.works.get(scope.workId))?.kind !== 'ttrpg') {
      throw new Error('[ttrpg-rule-pack] V2 规则只允许保存到 ttrpg 作品')
    }
    const existing = await db.ttrpgRulePacks
      .where('[workId+ruleSystemId+ruleSystemVersion]')
      .equals([scope.workId, rulePack.ruleSystemId, rulePack.ruleSystemVersion])
      .first()
    if (existing) {
      const previous = await verifyRulePackRow(scope, existing)
      if (previous.version !== rulePack.version) throw new Error('[ttrpg-rule-pack] 相同规则身份不允许跨版本替换')
      if (existing.status === 'validated') {
        if (existing.contentHash !== contentHash || existing.status !== status) {
          throw new Error('[ttrpg-rule-pack] validated 规则不可修改，请创建新规则版本')
        }
        // Preserve original JSON, timestamps and identity even on explicit repeat saves.
        return existing
      }
      if (input.immutable && existing.contentHash !== contentHash) throw new Error('[ttrpg-rule-pack] 相同规则版本已有不同内容，拒绝替换')
      const next = { ...existing, title: rulePack.title, status, rulePackJson, contentHash, updatedAt: now }
      await db.ttrpgRulePacks.put(next)
      return next
    }
    const row: TtrpgRulePackRecordV1 = {
      projectId: scope.projectId,
      worldId: scope.worldId,
      workId: scope.workId,
      ruleSystemId: rulePack.ruleSystemId,
      ruleSystemVersion: rulePack.ruleSystemVersion,
      title: rulePack.title,
      status,
      rulePackJson,
      contentHash,
      createdAt: now,
      updatedAt: now,
    }
    const id = await db.ttrpgRulePacks.add(row) as number
    return { ...row, id }
  })
}

export async function installBuiltInTtrpgRulePacksV1(scope: WorkspaceScope): Promise<TtrpgRulePackRecordV1[]> {
  const packs = [
    createStoryForgeRulePackV1(),
    createRankLiteRulePackV1(),
    createD20FantasyRulePackV1(),
    createD100InvestigationRulePackV1(),
  ]
  return Promise.all(packs.map(rulePack => saveTtrpgRulePackV1({ scope, rulePack, status: 'validated' })))
}

export async function listValidatedTtrpgRulePacksV1(scopeInput: WorkspaceScope): Promise<TtrpgRulePackRecordV1[]> {
  return listValidatedRulePacks(scopeInput, 1)
}

export async function listValidatedTtrpgRulePacksV2(scopeInput: WorkspaceScope): Promise<TtrpgRulePackRecordV1[]> {
  return listValidatedRulePacks(scopeInput, 2)
}

async function listValidatedRulePacks(scopeInput: WorkspaceScope, version: 1 | 2): Promise<TtrpgRulePackRecordV1[]> {
  const scope = await resolveScope({ scope: scopeInput })
  const rows = (await db.ttrpgRulePacks.where('workId').equals(scope.workId).toArray())
    .filter(row => row.status === 'validated')
  const verified = await Promise.all(rows.map(async row => ({ row, rule: await verifyRulePackRow(scope, row) })))
  return verified.filter(item => item.rule.version === version)
    .map(item => item.row).sort((left, right) => right.updatedAt - left.updatedAt)
}

/** Read original content after scope, identity and hash validation; never persist a view. */
export async function readTtrpgRulePackVersionedV1(input: {
  scope: WorkspaceScope
  rulePackId: number
}): Promise<{ record: TtrpgRulePackRecordV1; rulePack: RulePackV1 | RulePackV2 }> {
  const scope = await resolveScope({ scope: input.scope })
  const row = await db.ttrpgRulePacks.get(input.rulePackId)
  if (!row || row.status !== 'validated') throw new Error('[ttrpg-rule-pack] 缺少 validated 规则')
  const rulePack = await verifyRulePackRow(scope, row)
  return { record: row, rulePack }
}

/** Prepare a reviewed-rule candidate. Persist only through an explicit saveTtrpgRulePackV2 call. */
export async function prepareTtrpgRulePackOverlayV2(input: {
  scope: WorkspaceScope
  rulePackId: number
  overlay: unknown
  newRuleSystemVersion: string
}) {
  const base = await readTtrpgRulePackVersionedV1(input)
  if (base.rulePack.version !== 2) throw new Error('[ttrpg-rule-pack] V2 overlay 必须使用 validated V2 规则')
  const applied = await applyTtrpgHouseRuleOverlayV3({
    baseRulePack: base.rulePack,
    overlay: parseTtrpgHouseRuleOverlayV3(input.overlay),
  })
  const rulePack = parseRulePackV2({ ...applied.rulePack, ruleSystemVersion: input.newRuleSystemVersion })
  if (rulePack.ruleSystemVersion === base.rulePack.ruleSystemVersion) {
    throw new Error('[ttrpg-rule-pack] Overlay 候选必须使用新规则版本')
  }
  return {
    baseRecord: base.record,
    rulePack,
    contentHash: await hashProductProductionValueV2(rulePack),
    diff: applied.diff,
  }
}
