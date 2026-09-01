import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CURRENT_TTRPG_COMPLETION_ATTESTATION_V2,
  GAME_PLATFORM_CAPABILITIES_V1,
  evaluateGamePlatformCapabilityV1,
  validateAiGmBetaDeploymentAttestationV1,
  validateTtrpgCompletionEvidenceV2,
} from '../../src/lib/game-platform/capability-status'
import { db } from '../../src/lib/db/schema'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { seedFullProject } from '../helpers/seed-full-project'

const productionContext = {
  environment: 'production' as const,
  experimentalProject: false,
  authorOptIn: false,
  onlineServiceConfigured: false,
  aiGmBetaGatePassed: false,
}

function receiptHash(index: number): string {
  return index.toString(16).padStart(64, '0')
}

function completionReport(index: number, details: Record<string, unknown>) {
  return {
    status: 'passed',
    reportHash: receiptHash(index),
    reviewerReceiptHash: receiptHash(index + 100),
    sealedAt: '2026-08-22T00:00:00.000Z',
    environment: 'staging',
    realBrowser: true,
    fixtureFree: true,
    details,
  }
}

function validTtrpgCompletionAttestationV2() {
  const goldenDetails = (index: number) => ({
    browserJourneyReceiptHash: receiptHash(index),
    gameReleaseHash: receiptHash(index + 1),
    participantReceiptHashes: [receiptHash(index + 2), receiptHash(index + 3), receiptHash(index + 4)],
    providerReceiptHashes: [receiptHash(index + 5)],
  })
  return {
    policyVersion: 'ttrpg-completion-gate-v2',
    evidence: {
      'golden-turn': completionReport(1, {
        actionReceiptCount: 1,
        replayReceiptHash: receiptHash(201),
        viewerProjectionReceiptHash: receiptHash(202),
      }),
      'golden-a': completionReport(2, goldenDetails(210)),
      'golden-b': completionReport(3, goldenDetails(220)),
      'golden-c': completionReport(4, goldenDetails(230)),
      'requirements-u01-u21': completionReport(5, {
        checklistReceiptHash: receiptHash(240), passedRequirementCount: 21,
      }),
      'non-fixture-browser-path': completionReport(6, {
        browserJourneyReceiptHash: receiptHash(241), fixtureScanReceiptHash: receiptHash(242),
      }),
      'human-gm-full-session': completionReport(7, {
        branchRestoreCount: 1,
        durationMinutes: 90,
        humanParticipantReceiptHashes: [receiptHash(250), receiptHash(251), receiptHash(252)],
        itemTransferCount: 1,
        privateClueCount: 1,
        rewardPenaltyCount: 1,
        ruleEncounterCount: 1,
        sceneCount: 3,
        usageExhaustionRecoveryCount: 1,
      }),
      'ai-gm-real-model-eval': completionReport(8, {
        adversarialSampleCount: 10,
        providerReceiptHashes: [receiptHash(260)],
        sampleCount: 30,
        scenarioFamilyCount: 5,
      }),
      'commercial-media-set': completionReport(9, {
        assetReceiptHash: receiptHash(270),
        characterCount: 3,
        expressionCount: 12,
        handoutCount: 3,
        itemOrClueCount: 6,
        mapCount: 1,
        providerReceiptHashes: [receiptHash(271), receiptHash(272)],
        runtimeGeneratedCount: 1,
        sceneCount: 3,
      }),
      'external-identity-multidevice-recovery': completionReport(10, {
        conformanceReceiptHash: receiptHash(280),
        deviceReceiptHashes: [receiptHash(281), receiptHash(282), receiptHash(283)],
        identitySubjectHashes: [receiptHash(284), receiptHash(285), receiptHash(286)],
        networkIsolationReceiptHash: receiptHash(287),
        restartRecoveryReceiptHash: receiptHash(288),
      }),
      'unassisted-new-users': completionReport(11, {
        assistanceIncidentCount: 0,
        completedParticipantReceiptHashes: [
          receiptHash(290), receiptHash(291), receiptHash(292), receiptHash(293), receiptHash(294),
        ],
        studyProtocolReceiptHash: receiptHash(295),
      }),
    },
  }
}

describe('MASTER-0 · game platform status dictionary', () => {
  beforeEach(async () => {
    await db.delete()
    await db.open()
  })

  afterEach(() => db.close())

  it('每项能力只有一个 ID，并明确证据、开放阶段与环境', () => {
    expect(new Set(GAME_PLATFORM_CAPABILITIES_V1.map(item => item.id)).size).toBe(GAME_PLATFORM_CAPABILITIES_V1.length)
    expect(GAME_PLATFORM_CAPABILITIES_V1.every(item => item.reason.length > 10 && item.allowedEnvironments.length > 0)).toBe(true)
  })

  it('生产只开放证据成立的能力，未过 Golden 的 TTRPG、在线、支付和 AI GM fail-closed', () => {
    expect(evaluateGamePlatformCapabilityV1('playable-world-bundle', productionContext).enabled).toBe(true)
    expect(evaluateGamePlatformCapabilityV1('ttrpg-formal-local', productionContext)).toMatchObject({
      enabled: false,
      capability: { rollout: 'developer', evidence: 'partial' },
    })
    expect(evaluateGamePlatformCapabilityV1('game-production-v3', productionContext)).toMatchObject({
      enabled: false, blockers: ['作者尚未显式启用'],
    })
    expect(evaluateGamePlatformCapabilityV1('ttrpg-ai-gm', productionContext).enabled).toBe(false)
    expect(evaluateGamePlatformCapabilityV1('online-authoritative-room', productionContext).enabled).toBe(false)
    expect(evaluateGamePlatformCapabilityV1('commerce-payments', productionContext).enabled).toBe(false)
  })

  it('满足实验/评测或作者授权时只开放对应能力，不扩大其他权限', () => {
    expect(evaluateGamePlatformCapabilityV1('ttrpg-ai-gm', {
      ...productionContext, experimentalProject: true, aiGmBetaGatePassed: true,
    }).enabled).toBe(true)
    expect(evaluateGamePlatformCapabilityV1('game-production-v3', {
      ...productionContext, authorOptIn: true,
    }).enabled).toBe(true)
    expect(evaluateGamePlatformCapabilityV1('release-catalog', {
      ...productionContext, environment: 'development', onlineServiceConfigured: true,
    }).enabled).toBe(true)
    expect(evaluateGamePlatformCapabilityV1('release-catalog', {
      ...productionContext, onlineServiceConfigured: true,
    }).enabled).toBe(false)
  })

  it('开发环境允许显式加入实验的项目收集样本，但生产仍必须通过真实模型门', () => {
    expect(evaluateGamePlatformCapabilityV1('ttrpg-formal-local', {
      ...productionContext, environment: 'development',
    })).toMatchObject({ enabled: true, blockers: [] })
    expect(evaluateGamePlatformCapabilityV1('ttrpg-ai-gm', {
      ...productionContext, environment: 'development', experimentalProject: true,
    })).toMatchObject({ enabled: true, blockers: [] })
    expect(evaluateGamePlatformCapabilityV1('ttrpg-ai-gm', {
      ...productionContext, experimentalProject: true,
    })).toMatchObject({ enabled: false, blockers: ['AI GM 真实样本门未通过'] })
  })

  it('生产 AI GM 晋级声明必须同时绑定 exact policy 与密封报告 hash', () => {
    expect(validateAiGmBetaDeploymentAttestationV1({
      gate: 'passed', policyVersion: 'ttrpg-gm-beta-gate-v1', reportHash: 'a'.repeat(64),
    })).toBe(true)
    expect(validateAiGmBetaDeploymentAttestationV1({
      gate: 'passed', policyVersion: undefined, reportHash: 'a'.repeat(64),
    })).toBe(false)
    expect(validateAiGmBetaDeploymentAttestationV1({
      gate: 'passed', policyVersion: 'ttrpg-gm-beta-gate-v1', reportHash: 'not-a-report',
    })).toBe(false)
  })

  it('完整跑团完成声明必须绑定全部真实世界出口门，旧版 hash-only 声明不能升格', () => {
    expect(validateTtrpgCompletionEvidenceV2(CURRENT_TTRPG_COMPLETION_ATTESTATION_V2)).toBe(false)
    const attestation = validTtrpgCompletionAttestationV2()
    expect(validateTtrpgCompletionEvidenceV2(attestation)).toBe(true)
    const oldEvidence = Object.fromEntries([
      'golden-turn', 'golden-a', 'golden-b', 'golden-c', 'requirements-u01-u21', 'non-fixture-browser-path',
    ].map((key, index) => [key, {
      status: 'passed', reportHash: receiptHash(index + 1), realBrowser: true, fixtureFree: true,
    }]))
    expect(validateTtrpgCompletionEvidenceV2({
      policyVersion: 'ttrpg-completion-gate-v1', evidence: oldEvidence,
    })).toBe(false)
    const { 'golden-turn': _, ...missingGoldenTurn } = attestation.evidence
    expect(validateTtrpgCompletionEvidenceV2({
      ...attestation, evidence: missingGoldenTurn,
    })).toBe(false)
  })

  it('真人整场、真实模型、商业媒资、外部多设备和五名无协助用户任一不足都 fail-closed', () => {
    const make = () => structuredClone(validTtrpgCompletionAttestationV2())
    const shortSession = make()
    shortSession.evidence['human-gm-full-session'].details.durationMinutes = 89
    expect(validateTtrpgCompletionEvidenceV2(shortSession)).toBe(false)

    const shortAiEval = make()
    shortAiEval.evidence['ai-gm-real-model-eval'].details.sampleCount = 29
    expect(validateTtrpgCompletionEvidenceV2(shortAiEval)).toBe(false)

    const incompleteMedia = make()
    incompleteMedia.evidence['commercial-media-set'].details.expressionCount = 11
    expect(validateTtrpgCompletionEvidenceV2(incompleteMedia)).toBe(false)

    const twoDevices = make()
    twoDevices.evidence['external-identity-multidevice-recovery'].details.deviceReceiptHashes.pop()
    expect(validateTtrpgCompletionEvidenceV2(twoDevices)).toBe(false)

    const fourUsers = make()
    fourUsers.evidence['unassisted-new-users'].details.completedParticipantReceiptHashes.pop()
    expect(validateTtrpgCompletionEvidenceV2(fourUsers)).toBe(false)
    const assisted = make()
    assisted.evidence['unassisted-new-users'].details.assistanceIncidentCount = 1
    expect(validateTtrpgCompletionEvidenceV2(assisted)).toBe(false)
  })

  it('正式生产与作者 UI 不得重新接回固定战役 fixture 编译器', () => {
    const productionExecutor = readFileSync(resolve(process.cwd(), 'src/lib/game-production/production-executor.ts'), 'utf8')
    const productStudio = readFileSync(resolve(process.cwd(), 'src/components/text-game/GameProductionStudio.tsx'), 'utf8')
    const productHub = readFileSync(resolve(process.cwd(), 'src/pages/ProductHubPage.tsx'), 'utf8')
    expect(productionExecutor).not.toContain('compileTtrpgCampaignDraftV1')
    expect(productionExecutor).toContain('TTRPG 固定四场景 fallback 已停用')
    expect(productStudio).not.toContain('compileWorldReleaseToTtrpgCampaignDraftV1')
    expect(productStudio).toContain('createGameProductionWithBriefV1')
    expect(productStudio).toContain('export default function GameProductionStudio')
    expect(productHub).toContain('冻结来源制作与试玩')
    expect(productHub).toContain('GameProductionStudio')
    expect(productHub).toContain('ttrpg-production-contract-boundary')
    expect(productHub).toContain('跑团只通过统一产品生产链读取冻结世界资源')
    expect(productHub).not.toContain('formalPublicationLocked')
    expect(productHub).not.toContain('单机战役已可用')
  })

  it('项目授权随完整备份往返，不会在导入时丢失或扩大', async () => {
    const source = await seedFullProject()
    await db.projects.update(source.projectId, {
      gamePlatformOptIns: { gameProductionV3: true, ttrpgAiGmExperimental: true },
    })
    const backup = await exportProjectJSON(source.projectId)
    expect(backup.project.gamePlatformOptIns).toEqual({
      gameProductionV3: true, ttrpgAiGmExperimental: true,
    })
    const importedProjectId = await importProjectJSON(backup)
    expect((await db.projects.get(importedProjectId))?.gamePlatformOptIns).toEqual({
      gameProductionV3: true, ttrpgAiGmExperimental: true,
    })
  })
})
