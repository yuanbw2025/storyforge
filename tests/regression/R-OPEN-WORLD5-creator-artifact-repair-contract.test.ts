import { describe, expect, it } from 'vitest'
import {
  parseTextOpenWorldCreatorRepairAuthorizationV1,
  parseTextOpenWorldCreatorRepairImpactPlanV1,
  type TextOpenWorldCreatorRepairAuthorizationV1,
  type TextOpenWorldCreatorRepairImpactPlanV1,
} from '../../src/lib/open-world/creator-artifact-repair-contract'
import { textOpenWorldProductionTaskDescendantsV1 } from '../../src/lib/open-world/production-contract'
import { hashProductProductionValueV2 } from '../../src/lib/product-production/hash'
import { parseProductProductionCommandV1 } from '../../src/lib/product-production/contracts'

const H = (value: string) => value.repeat(64)

async function impactPlan(): Promise<TextOpenWorldCreatorRepairImpactPlanV1> {
  const body = {
    schema: 'storyforge.text-open-world-creator-repair-impact-plan' as const,
    version: 1 as const,
    portable: true as const,
    productType: 'text-open-world' as const,
    productionKey: 'tow.repair.fixture',
    baseBuild: {
      buildNumber: 4,
      stateRevision: 8,
      controlEpoch: 2,
      briefRevision: 1,
      briefHash: H('1'),
      planHash: H('2'),
      manifestHash: H('3'),
      rootTerminalReceiptHash: H('4'),
    },
    targetBuildNumber: 5,
    handoffSetHash: H('5'),
    handoffs: [{
      ownerTaskKey: 'p4.player-build',
      target: { artifactKey: 'text-open-world.player-build', entityIdentity: 'character:hero' },
      impactHandoffHash: H('6'),
      intentHash: H('7'),
      candidateHash: H('8'),
      terminalReceiptHash: H('9'),
      verificationReceiptHash: H('a'),
      baseGroupHash: H('b'),
      artifacts: [{
        artifactKey: 'text-open-world.player-build',
        baseContentHash: H('c'),
        contentHash: H('d'),
      }],
    }],
    targetTaskKeys: ['p4.player-build'],
    staleTaskKeys: ['p4.player-build', 'p5.mainline', 'qa.release'],
    reuseTaskKeys: ['p0.source-lock', 'p1.source-curation'],
    estimatedRerunBudget: {
      modelCalls: 1,
      inputTokens: 2_000,
      outputTokens: 1_000,
      mediaCalls: 0,
      maximumCostUsd: 0.5,
      durationMs: 60_000,
      storageBytes: 8_192,
    },
  }
  return parseTextOpenWorldCreatorRepairImpactPlanV1({
    ...body,
    impactPlanHash: await hashProductProductionValueV2(body),
  })
}

async function authorization(): Promise<TextOpenWorldCreatorRepairAuthorizationV1> {
  const impact = await impactPlan()
  const body = {
    schema: 'storyforge.text-open-world-creator-repair-authorization' as const,
    version: 1 as const,
    portable: true as const,
    impactPlan: impact,
    impactPlanHash: impact.impactPlanHash,
    targetPlanHash: H('e'),
    expectedStateRevision: 12,
    authorizationNonceHash: H('f'),
    authorizedAt: 1_800_000_000_000,
  }
  return parseTextOpenWorldCreatorRepairAuthorizationV1({
    ...body,
    authorizationHash: await hashProductProductionValueV2(body),
  })
}

describe('Text Open World G5-07 · repair contract', () => {
  it('accepts a portable hash-closed impact plan and authorization', async () => {
    const impact = await impactPlan()
    const auth = await authorization()
    expect(impact).toMatchObject({
      portable: true,
      targetBuildNumber: 5,
      targetTaskKeys: ['p4.player-build'],
    })
    expect(auth.impactPlanHash).toBe(impact.impactPlanHash)
    expect(auth.authorizationHash).toMatch(/^[a-f0-9]{64}$/)

    const withUnchangedSibling = structuredClone(impact)
    withUnchangedSibling.handoffs[0]!.artifacts.push({
      artifactKey: 'text-open-world.unchanged-sibling',
      baseContentHash: H('e'),
      contentHash: H('e'),
    })
    const { impactPlanHash: _oldHash, ...body } = withUnchangedSibling
    withUnchangedSibling.impactPlanHash = await hashProductProductionValueV2(body)
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1(withUnchangedSibling))
      .resolves.toEqual(withUnchangedSibling)
  })

  it('rejects unknown fields, stale/reuse overlap, target order drift and non-adjacent Build', async () => {
    const valid = await impactPlan()
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1({ ...valid, unexpected: true }))
      .rejects.toThrow(/字段不精确/)
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1({
      ...valid,
      reuseTaskKeys: [...valid.reuseTaskKeys, 'qa.release'],
    })).rejects.toThrow(/target\/stale\/reuse 分区不闭合/)
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1({
      ...valid,
      targetTaskKeys: ['p5.mainline'],
    })).rejects.toThrow(/target\/stale\/reuse 分区不闭合/)
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1({
      ...valid,
      targetBuildNumber: 7,
    })).rejects.toThrow(/必须紧接 base Build/)
  })

  it('rejects content, budget and nested authorization tampering even when outer shape remains valid', async () => {
    const valid = await impactPlan()
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1({
      ...valid,
      estimatedRerunBudget: { ...valid.estimatedRerunBudget, modelCalls: 2 },
    })).rejects.toThrow(/ImpactPlan Hash 不匹配/)
    const auth = await authorization()
    await expect(parseTextOpenWorldCreatorRepairAuthorizationV1({
      ...auth,
      targetPlanHash: H('0'),
    })).rejects.toThrow(/Authorization Hash 不匹配/)
    await expect(parseTextOpenWorldCreatorRepairAuthorizationV1({
      ...auth,
      impactPlanHash: H('0'),
    })).rejects.toThrow(/ImpactPlan Hash 不一致/)
  })

  it('rejects no-op Artifact deltas and malformed canonical hashes', async () => {
    const valid = await impactPlan()
    const noOp = structuredClone(valid)
    noOp.handoffs[0]!.artifacts[0]!.contentHash = noOp.handoffs[0]!.artifacts[0]!.baseContentHash
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1(noOp))
      .rejects.toThrow(/没有实际内容变化/)
    await expect(parseTextOpenWorldCreatorRepairImpactPlanV1({
      ...valid,
      handoffSetHash: 'not-a-hash',
    })).rejects.toThrow(/不是 SHA-256/)
  })

  it('computes one deterministic transitive stale closure in frozen plan order', () => {
    const tasks = [
      { taskKey: 'source', dependsOn: [] },
      { taskKey: 'left', dependsOn: ['source'] },
      { taskKey: 'right', dependsOn: ['source'] },
      { taskKey: 'join', dependsOn: ['left', 'right'] },
      { taskKey: 'qa', dependsOn: ['join'] },
    ]
    expect(textOpenWorldProductionTaskDescendantsV1('left', tasks))
      .toEqual(['left', 'join', 'qa'])
    expect(textOpenWorldProductionTaskDescendantsV1('right', tasks))
      .toEqual(['right', 'join', 'qa'])
    expect(() => textOpenWorldProductionTaskDescendantsV1('missing', tasks))
      .toThrow(/起点不存在/)
  })

  it('strictly parses the formal repair command and rejects loose or malformed hashes', () => {
    const command = {
      type: 'authorize-text-open-world-creator-repair',
      commandId: 'repair.command.1',
      expectedStateRevision: 12,
      baseBuildNumber: 4,
      expectedBasePlanHash: H('1'),
      expectedHandoffSetHash: H('2'),
      expectedImpactPlanHash: H('3'),
      expectedTargetPlanHash: H('4'),
      authorizationNonce: 'repair.nonce.1',
      authorizedAt: 1_800_000_000_000,
    }
    expect(parseProductProductionCommandV1(command)).toEqual(command)
    expect(() => parseProductProductionCommandV1({ ...command, unexpected: true }))
      .toThrow(/字段不精确/)
    expect(() => parseProductProductionCommandV1({ ...command, expectedImpactPlanHash: 'bad' }))
      .toThrow(/expectedImpactPlanHash 无效/)
  })
})
