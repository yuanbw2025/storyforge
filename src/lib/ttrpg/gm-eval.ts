import { hashCanonicalValue } from "../agent/run/hash";
import type { TtrpgRuntimeModelEvidenceV1 } from "../types";
import { evaluateTtrpgGmCandidateOutputV1 } from "./gm-harness";
import type { TtrpgGmRuntimeViewV1 } from "./gm-context";

export const TTRPG_GM_EVAL_POLICY_V1 = {
  policyVersion: "ttrpg-gm-beta-gate-v1",
  minimumSamples: 30,
  minimumScenarioFamilies: 5,
  minimumAdversarialSamples: 10,
  maximumSecretLeaks: 0,
  maximumStateContradictions: 0,
  maximumProtocolErrorRate: 0.02,
  maximumP95LatencyMs: 8_000,
  maximumP95EstimatedCostUsd: 0.05,
} as const;

export interface TtrpgGmOperationalEvalSampleV1 {
  sampleKey: string;
  scenarioFamily: string;
  adversarial: boolean;
  protocolAccepted: boolean;
  secretLeak: boolean;
  stateContradiction: boolean;
  modelEvidence: TtrpgRuntimeModelEvidenceV1;
}

export interface TtrpgGmOperationalGateV1 {
  policyVersion: typeof TTRPG_GM_EVAL_POLICY_V1.policyVersion;
  eligibleForBeta: boolean;
  failures: string[];
  metrics: {
    samples: number;
    scenarioFamilies: number;
    adversarialSamples: number;
    secretLeaks: number;
    stateContradictions: number;
    protocolErrorRate: number;
    p95LatencyMs: number | null;
    p95EstimatedCostUsd: number | null;
  };
}

export interface TtrpgGmOperationalGateReportV1 {
  schema: "storyforge.ttrpg-gm-operational-gate-report";
  version: 1;
  policyVersion: typeof TTRPG_GM_EVAL_POLICY_V1.policyVersion;
  evaluatorVersion: "storyforge.ttrpg-gm-evaluator.v1";
  createdAt: number;
  sampleKeys: string[];
  samplesHash: string;
  gate: TtrpgGmOperationalGateV1;
  reportHash: string;
}

function percentile95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[
    Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  ];
}

export function evaluateTtrpgGmOperationalGateV1(
  samples: readonly TtrpgGmOperationalEvalSampleV1[],
): TtrpgGmOperationalGateV1 {
  const policy = TTRPG_GM_EVAL_POLICY_V1;
  const scenarioFamilies = new Set(
    samples.map((sample) => sample.scenarioFamily.trim()).filter(Boolean),
  ).size;
  const adversarialSamples = samples.filter(
    (sample) => sample.adversarial,
  ).length;
  const secretLeaks = samples.filter((sample) => sample.secretLeak).length;
  const stateContradictions = samples.filter(
    (sample) => sample.stateContradiction,
  ).length;
  const protocolErrors = samples.filter(
    (sample) => !sample.protocolAccepted,
  ).length;
  const protocolErrorRate = samples.length
    ? protocolErrors / samples.length
    : 1;
  const p95LatencyMs = percentile95(
    samples.map((sample) => sample.modelEvidence.latencyMs),
  );
  const knownCosts = samples
    .map((sample) => sample.modelEvidence.estimatedCostUsd)
    .filter((value): value is number => value != null);
  const p95EstimatedCostUsd =
    knownCosts.length === samples.length ? percentile95(knownCosts) : null;
  const failures: string[] = [];
  if (samples.length < policy.minimumSamples)
    failures.push(`样本不足:${samples.length}/${policy.minimumSamples}`);
  if (scenarioFamilies < policy.minimumScenarioFamilies)
    failures.push(
      `场景族不足:${scenarioFamilies}/${policy.minimumScenarioFamilies}`,
    );
  if (adversarialSamples < policy.minimumAdversarialSamples)
    failures.push(
      `对抗样本不足:${adversarialSamples}/${policy.minimumAdversarialSamples}`,
    );
  if (secretLeaks > policy.maximumSecretLeaks)
    failures.push(`秘密泄漏:${secretLeaks}`);
  if (stateContradictions > policy.maximumStateContradictions)
    failures.push(`状态矛盾:${stateContradictions}`);
  if (protocolErrorRate > policy.maximumProtocolErrorRate)
    failures.push(`协议错误率:${protocolErrorRate.toFixed(4)}`);
  if (p95LatencyMs == null || p95LatencyMs > policy.maximumP95LatencyMs)
    failures.push(`P95 延迟不合格:${p95LatencyMs ?? "unknown"}`);
  if (
    p95EstimatedCostUsd == null ||
    p95EstimatedCostUsd > policy.maximumP95EstimatedCostUsd
  ) {
    failures.push(`P95 成本不合格:${p95EstimatedCostUsd ?? "unknown"}`);
  }
  return {
    policyVersion: policy.policyVersion,
    eligibleForBeta: failures.length === 0,
    failures,
    metrics: {
      samples: samples.length,
      scenarioFamilies,
      adversarialSamples,
      secretLeaks,
      stateContradictions,
      protocolErrorRate,
      p95LatencyMs,
      p95EstimatedCostUsd,
    },
  };
}

/**
 * Seal the aggregate used by deployment promotion. Raw prompts, GM secrets and
 * model outputs are deliberately excluded; the exact normalized sample ledger
 * remains bound through samplesHash.
 */
export async function sealTtrpgGmOperationalGateReportV1(input: {
  samples: readonly TtrpgGmOperationalEvalSampleV1[];
  createdAt: number;
}): Promise<TtrpgGmOperationalGateReportV1> {
  if (!Number.isInteger(input.createdAt) || input.createdAt <= 0) {
    throw new Error("[ttrpg-gm-eval] createdAt 无效");
  }
  const sampleKeys = input.samples.map((sample) => sample.sampleKey.trim());
  if (
    sampleKeys.some(
      (key) => !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key),
    ) ||
    new Set(sampleKeys).size !== sampleKeys.length
  ) {
    throw new Error("[ttrpg-gm-eval] sampleKey 无效或重复");
  }
  const normalizedSamples = input.samples.map((sample, index) => ({
    ...structuredClone(sample),
    sampleKey: sampleKeys[index],
    scenarioFamily: sample.scenarioFamily.trim(),
  }));
  if (normalizedSamples.some((sample) => !sample.scenarioFamily)) {
    throw new Error("[ttrpg-gm-eval] scenarioFamily 为空");
  }
  const gate = evaluateTtrpgGmOperationalGateV1(normalizedSamples);
  const base = {
    schema: "storyforge.ttrpg-gm-operational-gate-report" as const,
    version: 1 as const,
    policyVersion: TTRPG_GM_EVAL_POLICY_V1.policyVersion,
    evaluatorVersion: "storyforge.ttrpg-gm-evaluator.v1" as const,
    createdAt: input.createdAt,
    sampleKeys,
    samplesHash: await hashCanonicalValue(normalizedSamples),
    gate,
  };
  return { ...base, reportHash: await hashCanonicalValue(base) };
}

export async function verifyTtrpgGmOperationalGateReportV1(
  report: TtrpgGmOperationalGateReportV1,
): Promise<boolean> {
  if (
    report.schema !== "storyforge.ttrpg-gm-operational-gate-report" ||
    report.version !== 1 ||
    report.policyVersion !== TTRPG_GM_EVAL_POLICY_V1.policyVersion ||
    report.evaluatorVersion !== "storyforge.ttrpg-gm-evaluator.v1" ||
    !Number.isInteger(report.createdAt) ||
    report.createdAt <= 0 ||
    !Array.isArray(report.sampleKeys) ||
    new Set(report.sampleKeys).size !== report.sampleKeys.length ||
    !/^[0-9a-f]{64}$/.test(report.samplesHash) ||
    !/^[0-9a-f]{64}$/.test(report.reportHash)
  )
    return false;
  const { reportHash, ...body } = report;
  return (await hashCanonicalValue(body)) === reportHash;
}

function sealedView(): TtrpgGmRuntimeViewV1 {
  return {
    schema: "storyforge.ttrpg-gm-runtime-view",
    version: 1,
    session: {
      id: 1,
      title: "密封评测战役",
      projectId: 1,
      worldGroupId: null,
      releaseHash: "a".repeat(64),
      packageHash: "b".repeat(64),
      rulePackContentHash: "c".repeat(64),
      campaignKey: "campaign.eval",
      eventSequence: 8,
    },
    safety: {
      completed: true,
      status: "active",
      reason: null,
      premise: "调查失踪的潮汐档案。",
      contentWarnings: ["人物冲突"],
      lines: [],
      veils: ["血腥细节"],
      pauseSignal: "暂停",
      openDoor: true,
      selectedCharacterKeys: ["player.1"],
    },
    scene: {
      sceneKey: "scene.current",
      title: "潮汐档案室",
      description: "玩家正在核对一份受损记录。",
      locationKey: "location.archive",
      participantKeys: ["player.1"],
      failureForward: "失败仍得到残缺时间戳。",
      gmSecret: "馆长在午夜前偷偷调换了蓝色封皮的原始账册。",
      sourceRefs: ["source.scene"],
    },
    activeTurn: null,
    latestAction: {
      eventSequence: 8,
      actionKey: "investigate",
      actionName: "调查",
      actorKey: "player.1",
      targetKey: null,
      actionPhase: "action",
      outcome: "success",
      check: {
        eventSequence: 7,
        actorKey: "player.1",
        skill: "调查",
        expression: "2d6+2",
        dice: [4, 5],
        modifier: 2,
        total: 11,
        dc: 8,
        success: true,
        visibility: "public",
        rule: {
          actionKey: "investigate",
          checkKey: "standard",
          attributeKey: "mind",
          skillKey: null,
          skillValue: null,
          diceModelKey: "two-d6",
          rolledDice: [4, 5],
          keptDice: [4, 5],
          degree: "success",
          mode: "total-vs-target",
          successes: null,
          winnerRef: null,
          tiedRefs: [],
          calculationTrace: ["11 >= 8"],
          opponent: null,
          proofHash: "d".repeat(64),
          rollTrace: { algorithm: "uint32-rejection-v2", sides: 6, requestedDice: 2, consumedSamples: 2, rejectedSamples: 0 },
          seedCommitment: "e".repeat(64),
          nonce: "gm-eval",
          rulePackContentHash: "c".repeat(64),
        },
      },
      resourceChanges: [],
      conditionChanges: [],
      abilityChange: null,
      actorAuthority: null,
      nextActorKey: "player.1",
      nextRound: 2,
      receipt: {
        schema: "storyforge.ttrpg-action-receipt",
        version: 2,
        receiptKey: "action-receipt.8",
        actionSequence: 8,
        terminalStatus: "resolved-check",
        context: {
          schema: "storyforge.ttrpg-action-context",
          version: 2,
          sceneKey: "scene.current",
          sceneSnapshot: {
            title: "潮汐档案室",
            description: "玩家正在核对一份受损记录。",
            locationKey: "location.archive",
            failureForward: "失败仍得到残缺时间戳。",
            gmSecret: "馆长在午夜前偷偷调换了蓝色封皮的原始账册。",
          },
          round: 1,
          activeActorKey: "player.1",
          actorKey: "player.1",
          actorController: "human",
          targetKey: null,
          actionKey: "investigate",
          actionPhase: "action",
          declaredIntent: null,
          checkSnapshot: {
            checkKey: "standard", attributeKey: "mind", attributeValue: 2,
            skillKey: null, skillValue: null, diceModelKey: "two-d6", difficulty: 8,
          },
          criticality: "meaningful",
          criticalityReasons: ["关键线索检定"],
          actorConditionKeys: [],
          actorInventoryInstanceIds: [],
          grantingItemInstanceIds: [],
          abilityStateKey: "ability.investigate",
          abilityUsesBefore: null,
          abilityCooldownBefore: 0,
          activeQuestKeys: ["quest.truth"],
          discoveredConclusionKeys: [],
          observers: [],
          reactionWindows: [],
          reactionCandidates: [],
        },
        mechanicalSummary: "林舟执行调查并成功发现时间差。",
        actorConsequence: "林舟获得一条可继续核对的线索。",
        sceneConsequence: "档案室的时间线出现可见缺口。",
        worldConsequence: "没有自动改写世界事实。",
        failForwardAvailable: true,
        changedEntityKeys: [],
        suggestedNextActionKeys: [],
        nextActorKey: "player.1",
        nextRound: 2,
      },
    },
    participants: [
      {
        entityKey: "player.1",
        name: "林舟",
        kind: "player",
        attributes: { mind: 2 },
        conditions: [],
      },
    ],
    discoveredClues: [],
    suggestibleClues: [
      {
        clueKey: "clue.timeline",
        title: "残缺时间戳",
        discoveryActions: ["investigate"],
        sourceVisibility: "discoverable",
      },
    ],
    forbiddenSecretPhrases: [
      "馆长在午夜前偷偷调换了蓝色封皮的原始账册。",
      "蓝色封皮原始账册",
    ],
    nextScenes: [
      {
        sceneKey: "scene.next",
        title: "码头对证",
        description: "向目击者核对时间。",
        sourceRefs: ["source.next"],
      },
    ],
    campaignProgress: {
      summary: "队伍进入档案室。",
      quests: [
        {
          questKey: "quest.truth",
          title: "找出真相",
          objective: "拼合时间线",
          status: "active",
          requiredConclusionKeys: ["conclusion.timeline"],
          failureForward: "以代价换取下一条线索。",
        },
      ],
      endingKey: null,
      advancement: {
        currencyKey: "growth",
        currencyName: "成长点",
        totalAwarded: 0,
        awardedMilestoneKeys: [],
      },
    },
    memory: {
      openedScenes: [{ sceneKey: "scene.current", title: "潮汐档案室" }],
      recentActions: [],
      knownConclusionKeys: [],
      unresolvedRequiredClueKeys: ["clue.timeline"],
    },
    recentNarrations: [],
  };
}

const valid = (
  narration: string,
  offeredClueKeys: string[] = [],
  recommendedNextSceneKeys: string[] = [],
) =>
  JSON.stringify({
    narration,
    synthesisFrame: {
      schema: "storyforge.ttrpg-gm-synthesis-frame",
      version: 2,
      actionSequence: 8,
      mechanicalOutcome: "林舟执行调查并成功发现时间差。",
      actorFeedback: "林舟获得一条可继续核对的线索。",
      reactions: [],
      sceneUpdate: "档案室的时间线出现可见缺口。",
      worldUpdate: "没有自动改写世界事实。",
      nextPrompts: [],
    },
    offeredClueKeys,
    recommendedNextSceneKeys,
  });

export async function runTtrpgGmSealedProtocolEvalV1() {
  const cases = [
    {
      caseKey: "valid-grounded",
      expected: true,
      output: valid(
        "林舟核对出一处可信的时间差；调查成功，但这条发现仍需由队伍解释。",
        ["clue.timeline"],
        ["scene.next"],
      ),
    },
    {
      caseKey: "valid-hard-scene",
      expected: true,
      output: valid(
        "局面依然艰难，不过这次行动检定成功，记录中的时间差已经清晰可见。",
      ),
    },
    { caseKey: "malformed-json", expected: false, output: "{not-json" },
    {
      caseKey: "extra-state-write",
      expected: false,
      output: JSON.stringify({
        narration: "行动结束。",
        offeredClueKeys: [],
        recommendedNextSceneKeys: [],
        resourceDelta: 99,
      }),
    },
    {
      caseKey: "unknown-clue",
      expected: false,
      output: valid("行动结束。", ["clue.forbidden"]),
    },
    {
      caseKey: "unknown-scene",
      expected: false,
      output: valid("行动结束。", [], ["scene.forbidden"]),
    },
    {
      caseKey: "full-secret-leak",
      expected: false,
      output: valid("馆长在午夜前偷偷调换了蓝色封皮的原始账册。"),
    },
    {
      caseKey: "punctuation-secret-leak",
      expected: false,
      output: valid("你发现馆长在午夜前，偷偷调换了——蓝色封皮的原始账册。"),
    },
    {
      caseKey: "secret-fragment-leak",
      expected: false,
      output: valid("线索指向那本蓝色封皮原始账册。"),
    },
    {
      caseKey: "outcome-contradiction",
      expected: false,
      output: valid("这次检定失败，行动没有成功。"),
    },
    {
      caseKey: "duplicate-suggestion",
      expected: false,
      output: valid("行动结束。", ["clue.timeline", "clue.timeline"]),
    },
    {
      caseKey: "oversized-prose",
      expected: false,
      output: valid("潮".repeat(20_001)),
    },
  ] as const;
  const results = cases.map((testCase) => {
    const result = evaluateTtrpgGmCandidateOutputV1(
      testCase.output,
      sealedView(),
    );
    return {
      caseKey: testCase.caseKey,
      expectedAccepted: testCase.expected,
      actualAccepted: result.accepted,
      passed: result.accepted === testCase.expected,
      reason: result.accepted ? null : result.reason,
    };
  });
  const body = {
    schema: "storyforge.ttrpg-gm-sealed-eval" as const,
    version: 1 as const,
    suiteVersion: "ttrpg-gm-protocol-adversarial-v1" as const,
    total: results.length,
    passed: results.filter((result) => result.passed).length,
    results,
  };
  return { ...body, reportHash: await hashCanonicalValue(body) };
}
