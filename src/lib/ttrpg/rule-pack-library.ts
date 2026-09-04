import { db } from '../db/schema'
import { hashProductProductionValueV2 } from '../product-production/hash'
import type { TtrpgRulePackRecordV1, RulePackV1, WorkspaceScope } from '../types'
import { resolveScope, scopeTransactionTables } from '../workspace/scope'
import { parseRulePackV1, runRulePackFixturesV1 } from './rule-pack'
import { createD100InvestigationRulePackV1 } from './d100-investigation-rule-pack'
import { createD20FantasyRulePackV1 } from './d20-fantasy-rule-pack'
import { createRankLiteRulePackV1 } from './rank-lite-rule-pack'
import { createStoryForgeRulePackV1 } from './storyforge-rule-pack'

export async function saveTtrpgRulePackV1(input: {
  scope: WorkspaceScope
  rulePack: RulePackV1 | unknown
  status?: TtrpgRulePackRecordV1['status']
}): Promise<TtrpgRulePackRecordV1> {
  const scope = await resolveScope({ scope: input.scope })
  const rulePack = parseRulePackV1(input.rulePack)
  runRulePackFixturesV1(rulePack)
  const status = input.status ?? 'validated'
  if (status === 'validated' && (!rulePack.license.commercialUse || !rulePack.license.attribution.trim())) {
    throw new Error('[ttrpg-rule-pack] validated RulePack 必须声明商业使用权和署名')
  }
  const contentHash = await hashProductProductionValueV2(rulePack)
  const rulePackJson = JSON.stringify(rulePack)
  const now = Date.now()
  return db.transaction('rw', scopeTransactionTables(db.ttrpgRulePacks), async () => {
    const existing = await db.ttrpgRulePacks
      .where('[workId+ruleSystemId+ruleSystemVersion]')
      .equals([scope.workId, rulePack.ruleSystemId, rulePack.ruleSystemVersion])
      .first()
    if (existing) {
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
  const scope = await resolveScope({ scope: scopeInput })
  return (await db.ttrpgRulePacks.where('workId').equals(scope.workId).toArray())
    .filter(row => row.status === 'validated')
    .sort((left, right) => right.updatedAt - left.updatedAt)
}
