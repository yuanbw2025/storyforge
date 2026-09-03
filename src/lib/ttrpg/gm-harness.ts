import { chat, resolveRequestConfig, type ChatResult } from "../ai/client";
import { estimateTokens } from "../ai/context-budget";
import { computeKnownCostUsd } from "../ai/usage-log";
import { createAgentSkillExecutionBindingV1 } from "../agent/execution-binding";
import { getAgentSkillV1 } from "../agent/skill-registry";
import {
  createAgentRunCheckpointV1,
  readLatestVerifiedAgentRunCheckpointV1,
} from "../agent/run/checkpoint";
import { createContextManifestFromAssemblyV1 } from "../agent/run/context-manifest";
import {
  appendAgentRunEventV1,
  appendRuntimeCandidateAdoptedV1,
  createAgentRunV1,
  readInstanceAgentRunV1,
  type AgentRunSnapshotV1,
} from "../agent/run/event-store";
import { hashCanonicalValue } from "../agent/run/hash";
import {
  assertTtrpgGmRuntimeHarnessFreshV1,
  captureTtrpgGmRuntimeHarnessBoundaryV1,
} from "../agent/run/runtime-scope";
import { createVerificationReceiptV1 } from "../agent/run/verification-receipt";
import { db } from "../db/schema";
import { assembleContext } from "../registry/assemble-context";
import {
  commitTtrpgGmNarrationFromHarnessV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from "./runtime-api";
import type {
  AIConfig,
  ChatMessage,
  TtrpgRuntimeGmSynthesisFrameV2,
  TtrpgRuntimeModelEvidenceV1,
  WorkspaceScope,
} from "../types";
import {
  loadTtrpgGmRuntimeViewV1,
  type TtrpgGmRuntimeViewV1,
} from "./gm-context";
import {
  assertTtrpgFeedbackOutcomeConsistentV2,
  parseTtrpgGmSynthesisFrameV2,
} from "./action-feedback";

export const TTRPG_GM_RUNTIME_STEP_ID_V1 =
  "ttrpg:gm-narration-candidate" as const;
export const TTRPG_GM_RUNTIME_VERIFIER_SET_V1 =
  "ttrpg-gm-runtime-terminal-v1" as const;

export interface TtrpgGmNarrationCandidateV1 {
  schema: "storyforge.ttrpg-gm-candidate";
  version: 1;
  portable: false;
  runId: number;
  productRuntimeSessionId: number;
  baseSequence: number;
  stateHash: string;
  visibilityHash: string;
  releaseHash: string;
  contextManifestHash: string;
  sceneKey: string;
  actionSequence: number;
  narration: string;
  synthesisFrame: TtrpgRuntimeGmSynthesisFrameV2;
  offeredClueKeys: string[];
  recommendedNextSceneKeys: string[];
  modelEvidence?: TtrpgRuntimeModelEvidenceV1;
  modelCalls?: TtrpgRuntimeModelEvidenceV1[];
  repairEvidence?: {
    initialIssue: string;
    initialOutputHash: string;
    repairedOutputHash: string;
  };
  candidateHash: string;
}

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

function fail(message: string): never {
  throw new Error(`[ttrpg-gm-harness] ${message}`);
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(`${label}必须是对象`);
  return value as Record<string, unknown>;
}
function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  ) {
    fail(`${label}字段不在允许闭集`);
  }
}
function parseJson(output: string): Record<string, unknown> {
  let source = output.trim();
  const fenced = source.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) source = fenced[1];
  try {
    return record(JSON.parse(source), "模型输出");
  } catch (error) {
    if (error instanceof SyntaxError) fail("模型输出不是有效 JSON");
    throw error;
  }
}
function uniqueKeys(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 64)
    fail(`${label}必须是有界数组`);
  const keys = value.map((item, index) => {
    if (
      typeof item !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(item.trim())
    ) {
      fail(`${label}[${index}] 无效`);
    }
    return item.trim();
  });
  if (new Set(keys).size !== keys.length) fail(`${label}不得重复`);
  return keys;
}

function messages(objective: string, context: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 StoryForge 可信 AI GM 的候选叙事生成器。",
        "你只解释已经由 RulePack 结算完成的最近行动；骰点、难度、成功等级、资源、状态、回合、线索可见性和场景推进全部不可修改。",
        "叙事不得泄露 gmSecret 或未发现线索内容。offeredClueKeys 只能从 suggestibleClues 选择，它只是给真人 GM 的建议，绝不代表线索已公开。",
        "recommendedNextSceneKeys 只能从 nextScenes 选择，它只是建议，绝不推进场景。遵守 Session Zero 的 lines、veils、暂停信号和内容提醒。",
        "必须返回 GmSynthesisFrame：mechanicalOutcome 原样复制 latestAction.receipt.mechanicalSummary；worldUpdate 原样复制 receipt.worldConsequence。reactions 只覆盖 receipt 中 relevant/primary 且非行动者的观察者。",
        "responsePolicy 必须原样复制。prompt-human 的 text 必须是 null，绝不能替真人玩家说话、做决定或描述其内心；ai-eligible 与 gm-eligible 必须给出符合该角色目标、已知信息和当前场景的反应。",
        "只输出严格 JSON，不要 Markdown、解释或额外字段：",
        '{"narration":"面向玩家的行动结果叙事","synthesisFrame":{"schema":"storyforge.ttrpg-gm-synthesis-frame","version":2,"actionSequence":1,"mechanicalOutcome":"原样复制机械摘要","actorFeedback":"行动者后果","reactions":[],"sceneUpdate":"当前场景如何响应","worldUpdate":"原样复制世界后果边界","nextPrompts":[]},"offeredClueKeys":[],"recommendedNextSceneKeys":[]}',
      ].join("\n"),
    },
    {
      role: "user",
      content: `【主持目标】${objective}\n\n【冻结主持上下文】\n${context}`,
    },
  ];
}

function validateDraftAgainstView(input: {
  draft: Pick<
    TtrpgGmNarrationCandidateV1,
    | "narration"
    | "offeredClueKeys"
    | "recommendedNextSceneKeys"
    | "actionSequence"
    | "sceneKey"
  > & {
    synthesisFrame?: TtrpgRuntimeGmSynthesisFrameV2;
  };
  view: TtrpgGmRuntimeViewV1;
}): void {
  const { draft, view } = input;
  if (
    !view.safety.completed ||
    view.safety.status !== "active" ||
    !view.scene ||
    !view.latestAction
  ) {
    fail("正式 GM 上下文尚未就绪或已由安全工具暂停");
  }
  if (
    draft.sceneKey !== view.scene.sceneKey ||
    draft.actionSequence !== view.latestAction.eventSequence
  ) {
    fail("候选与当前场景或最近规则行动不一致");
  }
  if (draft.synthesisFrame) {
    const receipt =
      view.latestAction.receipt ?? fail("综合反馈缺少 ActionReceipt");
    if (draft.synthesisFrame.mechanicalOutcome !== receipt.mechanicalSummary) {
      fail("候选综合帧修改了机械结果摘要");
    }
    if (draft.synthesisFrame.worldUpdate !== receipt.worldConsequence) {
      fail("候选综合帧越权修改了世界事实边界");
    }
  }
  const allowedClues = new Set(
    view.suggestibleClues.map((item) => item.clueKey),
  );
  if (draft.offeredClueKeys.some((key) => !allowedClues.has(key)))
    fail("候选建议了未授权线索");
  const allowedScenes = new Set(view.nextScenes.map((item) => item.sceneKey));
  if (draft.recommendedNextSceneKeys.some((key) => !allowedScenes.has(key)))
    fail("候选建议了非后继场景");
  const synthesisText = draft.synthesisFrame
    ? [
        draft.synthesisFrame.actorFeedback,
        draft.synthesisFrame.sceneUpdate,
        draft.synthesisFrame.worldUpdate,
        ...draft.synthesisFrame.nextPrompts,
        ...draft.synthesisFrame.reactions.flatMap((reaction) =>
          reaction.text == null ? [] : [reaction.text],
        ),
      ].join("\n")
    : "";
  const combinedNarration = `${draft.narration}\n${synthesisText}`;
  const normalizedNarration = combinedNarration
    .normalize("NFC")
    .toLocaleLowerCase();
  const compact = (value: string) =>
    value
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[\s\p{P}\p{S}]/gu, "");
  const compactNarration = compact(combinedNarration);
  const leaksSecret = view.forbiddenSecretPhrases.some((phrase) => {
    const compactPhrase = compact(phrase);
    if (!compactPhrase) return false;
    if (compactNarration.includes(compactPhrase)) return true;
    if (compactPhrase.length < 12) return false;
    for (let index = 0; index <= compactPhrase.length - 10; index += 1) {
      if (compactNarration.includes(compactPhrase.slice(index, index + 10)))
        return true;
    }
    return false;
  });
  if (leaksSecret) {
    fail("候选叙事直接泄露 GM 私密提示或未发现线索");
  }
  assertTtrpgFeedbackOutcomeConsistentV2(
    normalizedNarration,
    view.latestAction.outcome,
  );
}

function parseDraft(output: string, view: TtrpgGmRuntimeViewV1) {
  const source = parseJson(output);
  exact(
    source,
    [
      "narration",
      "synthesisFrame",
      "offeredClueKeys",
      "recommendedNextSceneKeys",
    ],
    "AI GM 候选",
  );
  if (
    typeof source.narration !== "string" ||
    !source.narration.trim() ||
    source.narration.trim().length > 20_000
  )
    fail("AI GM 叙事无效");
  const receipt = view.latestAction?.receipt ?? null;
  const synthesisFrame = receipt
    ? parseTtrpgGmSynthesisFrameV2(source.synthesisFrame, receipt)
    : fail("综合反馈缺少 ActionReceipt");
  const draft = {
    sceneKey: view.scene?.sceneKey ?? fail("当前没有正式场景"),
    actionSequence:
      view.latestAction?.eventSequence ?? fail("当前没有正式规则行动"),
    narration: source.narration.trim().normalize("NFC"),
    synthesisFrame,
    offeredClueKeys: uniqueKeys(source.offeredClueKeys, "offeredClueKeys"),
    recommendedNextSceneKeys: uniqueKeys(
      source.recommendedNextSceneKeys,
      "recommendedNextSceneKeys",
    ),
  };
  validateDraftAgainstView({ draft, view });
  return draft;
}

/** Pure protocol/security evaluation entrypoint. It performs no model call and
 * no persistence, so sealed fixtures and provider evals use the exact same
 * parser that gates production candidates. */
export function evaluateTtrpgGmCandidateOutputV1(
  output: string,
  view: TtrpgGmRuntimeViewV1,
):
  | { accepted: true; draft: ReturnType<typeof parseDraft> }
  | { accepted: false; reason: string } {
  try {
    return { accepted: true, draft: parseDraft(output, view) };
  } catch (error) {
    return {
      accepted: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function contract(input: {
  objective: string;
  boundary: Awaited<ReturnType<typeof captureTtrpgGmRuntimeHarnessBoundaryV1>>;
  runtimeBindingHash: string;
}) {
  const skill = getAgentSkillV1("prose.ttrpg-gm-narrator");
  return {
    version: 1 as const,
    objective: input.objective,
    workflowKind: "direct-generation" as const,
    scope: input.boundary.scope,
    permissions: { contextSourceKeys: ["ttrpgRuntime"], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [
      {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        ...createAgentSkillExecutionBindingV1(skill),
      },
    ],
    budget: {
      maxModelCalls: 2,
      maxToolCalls: 0,
      maxInputTokens: 36_000,
      maxOutputTokens: skill.maxOutputTokens * 2,
      maxAttemptsPerStep: 2,
    },
    acceptance: [
      {
        id: "runtime.candidate",
        kind: "output-present" as const,
        required: true,
      },
      {
        id: "runtime.freshness",
        kind: "deterministic-check" as const,
        required: true,
      },
      {
        id: "runtime.author-confirmed",
        kind: "author-confirmed" as const,
        required: true,
      },
      {
        id: "runtime.prose-only",
        kind: "post-state-matches" as const,
        required: true,
      },
    ],
    verificationPlan: [
      {
        id: "runtime.terminal",
        kind: "terminal" as const,
        verifier: TTRPG_GM_RUNTIME_VERIFIER_SET_V1,
        criterionIds: [
          "runtime.candidate",
          "runtime.freshness",
          "runtime.author-confirmed",
          "runtime.prose-only",
        ],
      },
    ],
    failurePolicy: {
      onProtocolError: "retry" as const,
      onVerificationFailure: "fail" as const,
      onStaleInput: "pause-for-author" as const,
    },
  };
}

async function append(
  scope: WorkspaceScope,
  snapshot: AgentRunSnapshotV1,
  type: Parameters<typeof appendAgentRunEventV1>[0]["type"],
  payload: unknown,
) {
  return appendAgentRunEventV1({
    scope,
    runId: snapshot.run.id,
    productRuntimeSessionId:
      snapshot.run.productRuntimeSessionId ?? fail("运行时事件缺少 Instance owner"),
    type,
    payload,
    expectedLastSequence: snapshot.projection.lastSequence,
  } as Parameters<typeof appendAgentRunEventV1>[0]);
}

function repairableProtocolIssue(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /不是有效 JSON|字段不在允许闭集|叙事无效|必须是有界数组|不得重复|\[\d+\] 无效/u.test(
    message,
  );
}

function repairPrompt(
  original: ChatMessage[],
  output: string,
  issue: string,
): ChatMessage[] {
  return [
    ...original,
    { role: "assistant", content: output.slice(0, 24_000) },
    {
      role: "user",
      content: [
        "上一次输出未通过确定性协议校验。只修复 JSON 结构和允许字段，不要添加新事实，不要改变已提交规则结果。",
        `校验问题：${issue.slice(0, 1_000)}`,
        "重新只输出 narration、synthesisFrame、offeredClueKeys、recommendedNextSceneKeys 四个字段的严格 JSON。",
      ].join("\n"),
    },
  ];
}

function aggregateModelEvidence(
  calls: TtrpgRuntimeModelEvidenceV1[],
): TtrpgRuntimeModelEvidenceV1 {
  const first = calls[0] ?? fail("AI GM 缺少模型调用证据");
  const inputTokens = calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0);
  const knownCosts = calls.map((call) => call.estimatedCostUsd);
  return {
    provider: first.provider,
    model: first.model,
    usageSource: calls.every((call) => call.usageSource === "provider")
      ? "provider"
      : "estimated",
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
    estimatedCostUsd: knownCosts.every((cost): cost is number => cost != null)
      ? knownCosts.reduce((sum, cost) => sum + cost, 0)
      : null,
  };
}

export async function generateTtrpgGmNarrationCandidateV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
  objective: string;
  aiConfig?: AIConfig;
  runAI?: RunAI;
  signal?: AbortSignal;
  onRunCreated?: (runId: number) => void | Promise<void>;
}): Promise<{
  snapshot: AgentRunSnapshotV1;
  candidate: TtrpgGmNarrationCandidateV1;
}> {
  const objective = input.objective.trim();
  if (!objective || objective.length > 4_000) fail("主持目标无效");
  if (!input.runAI && !input.aiConfig) fail("缺少 AI 配置");
  const preflightView = await loadTtrpgGmRuntimeViewV1(input);
  if (preflightView.safety.status !== "active")
    fail("战役已由安全工具暂停，禁止调用模型");
  const skill = getAgentSkillV1("prose.ttrpg-gm-narrator");
  const boundary = await captureTtrpgGmRuntimeHarnessBoundaryV1(input);
  const callMeta = {
    category: "runtime.ttrpg-gm",
    projectId: input.scope.projectId,
    contextOverflowPolicy: "reject" as const,
  };
  const resolvedConfig = input.aiConfig
    ? resolveRequestConfig(input.aiConfig, callMeta)
    : null;
  const modelIdentity = input.runAI
    ? { provider: "test-adapter", model: "injected", transport: "chat-v1" }
    : {
        provider:
          resolvedConfig?.config.provider ?? fail("缺少已解析 AI provider"),
        model: resolvedConfig?.config.model ?? fail("缺少已解析 AI model"),
        transport: "chat-v1",
      };
  const runtimeBindingHash = await hashCanonicalValue({
    executionBinding: createAgentSkillExecutionBindingV1(skill),
    modelIdentity,
  });
  let snapshot = await createAgentRunV1({
    scope: input.scope,
    productRuntimeSessionId: input.productRuntimeSessionId,
    worldGroupId: boundary.scope.worldGroupId,
    contract: contract({ objective, boundary, runtimeBindingHash }),
  });
  let activeAttempt: 1 | 2 = 1;
  await input.onRunCreated?.(snapshot.run.id);
  snapshot = await append(input.scope, snapshot, "step.scheduled", {
    stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
  });
  snapshot = await append(input.scope, snapshot, "step.started", {
    stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
    attempt: 1,
  });
  try {
    const assembled = await assembleContext({
      projectId: input.scope.projectId,
      scope: input.scope,
      worldGroupId: boundary.scope.worldGroupId,
      productRuntimeSessionId: input.productRuntimeSessionId,
      sourceKeys: ["ttrpgRuntime"],
      provider: input.aiConfig?.provider,
      model: input.aiConfig?.model,
      inputBudgetMaxTokens: 18_000,
    });
    if (!assembled.included.includes("ttrpgRuntime"))
      fail("正式 TTRPG 主持人上下文为空");
    await assertTtrpgGmRuntimeHarnessFreshV1({
      scope: input.scope,
      contractScope: snapshot.contract.scope,
    });
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
      attempt: 1,
      projectId: input.scope.projectId,
      worldGroupId: boundary.scope.worldGroupId,
      declaredSourceKeys: ["ttrpgRuntime"],
      assembled,
      readerVersion: "ttrpg-gm-runtime-view-v1",
    });
    snapshot = await append(input.scope, snapshot, "context.assembled", {
      stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    });
    const prompt = messages(objective, assembled.text);
    const callAttempt = async (
      attemptPrompt: ChatMessage[],
      attempt: 1 | 2,
    ) => {
      snapshot = await append(input.scope, snapshot, "model.requested", {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        attempt,
        bindingHash: await hashCanonicalValue({
          runtimeBindingHash,
          manifestHash: manifest.manifestHash,
          messages: attemptPrompt,
        }),
      });
      const chatResult: ChatResult = {};
      const startedAt = Date.now();
      const output = input.runAI
        ? await input.runAI(attemptPrompt, input.signal)
        : await chat(
            attemptPrompt,
            input.aiConfig!,
            {
              category: "runtime.ttrpg-gm",
              projectId: input.scope.projectId,
              contextOverflowPolicy: "reject",
            },
            input.signal,
            chatResult,
            undefined,
            resolvedConfig!,
          );
      const latencyMs = Math.max(0, Date.now() - startedAt);
      const estimatedInputTokens = attemptPrompt.reduce(
        (sum, message) => sum + estimateTokens(message.content),
        0,
      );
      const inputTokens = chatResult.usage?.inputTokens ?? estimatedInputTokens;
      const outputTokens =
        chatResult.usage?.outputTokens ?? estimateTokens(output);
      const evidence: TtrpgRuntimeModelEvidenceV1 = {
        provider: modelIdentity.provider,
        model: modelIdentity.model,
        usageSource: chatResult.usage ? "provider" : "estimated",
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        latencyMs,
        estimatedCostUsd: computeKnownCostUsd(
          modelIdentity.model,
          inputTokens,
          outputTokens,
        ),
      };
      snapshot = await append(input.scope, snapshot, "model.responded", {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        attempt,
        outputHash: await hashCanonicalValue(output),
      });
      return { output, evidence };
    };
    const firstCall = await callAttempt(prompt, 1);
    const view = await loadTtrpgGmRuntimeViewV1(input);
    const modelCalls = [firstCall.evidence];
    let draft: ReturnType<typeof parseDraft>;
    let repairEvidence: TtrpgGmNarrationCandidateV1["repairEvidence"];
    try {
      draft = parseDraft(firstCall.output, view);
    } catch (error) {
      if (!repairableProtocolIssue(error)) throw error;
      await assertTtrpgGmRuntimeHarnessFreshV1({
        scope: input.scope,
        contractScope: snapshot.contract.scope,
      });
      const issue = error instanceof Error ? error.message : String(error);
      snapshot = await append(input.scope, snapshot, "step.failed", {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        attempt: 1,
        code: "ttrpg-gm-repairable-protocol",
        retryable: true,
        category: "protocol",
        action: "retry",
      });
      snapshot = await append(input.scope, snapshot, "step.started", {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        attempt: 2,
      });
      activeAttempt = 2;
      const secondCall = await callAttempt(
        repairPrompt(prompt, firstCall.output, issue),
        2,
      );
      modelCalls.push(secondCall.evidence);
      draft = parseDraft(secondCall.output, view);
      repairEvidence = {
        initialIssue: issue.slice(0, 1_000),
        initialOutputHash: await hashCanonicalValue(firstCall.output),
        repairedOutputHash: await hashCanonicalValue(secondCall.output),
      };
    }
    const modelEvidence = aggregateModelEvidence(modelCalls);
    const synthesisFrame =
      draft.synthesisFrame ?? fail("正式候选缺少 GmSynthesisFrame");
    const body = {
      schema: "storyforge.ttrpg-gm-candidate" as const,
      version: 1 as const,
      portable: false as const,
      runId: snapshot.run.id,
      ...boundary.scope.runtime,
      contextManifestHash: manifest.manifestHash,
      modelEvidence,
      modelCalls,
      ...(repairEvidence ? { repairEvidence } : {}),
      ...draft,
      synthesisFrame,
    };
    const candidate = {
      ...body,
      candidateHash: await hashCanonicalValue(body),
    };
    snapshot = await append(input.scope, snapshot, "candidate.persisted", {
      stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
      attempt: repairEvidence ? 2 : 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: true,
    });
    const saved = await createAgentRunCheckpointV1({
      scope: input.scope,
      runId: snapshot.run.id,
      productRuntimeSessionId: input.productRuntimeSessionId,
      resumePayload: candidate,
      expectedLastSequence: snapshot.projection.lastSequence,
    });
    return { snapshot: saved.snapshot, candidate };
  } catch (error) {
    const current = await readInstanceAgentRunV1(input.scope, snapshot.run.id);
    if (
      current.projection.steps[TTRPG_GM_RUNTIME_STEP_ID_V1]?.status ===
      "running"
    ) {
      snapshot = await append(input.scope, current, "step.failed", {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        attempt: activeAttempt,
        code: input.signal?.aborted
          ? "ttrpg-gm-cancelled"
          : "ttrpg-gm-generation-failed",
        retryable: false,
        category: input.signal?.aborted ? "cancelled" : "protocol",
        action: "fail",
      });
    }
    if (!["failed", "cancelled"].includes(snapshot.projection.state)) {
      await append(
        input.scope,
        snapshot,
        input.signal?.aborted ? "run.cancelled" : "run.failed",
        input.signal?.aborted
          ? { reason: "ttrpg-gm-cancelled" }
          : { code: "ttrpg-gm-generation-failed", retryable: false },
      );
    }
    throw error;
  }
}

function candidateBody(candidate: TtrpgGmNarrationCandidateV1) {
  const { candidateHash: _candidateHash, ...body } = candidate;
  return body;
}

function isCandidate(value: unknown): value is TtrpgGmNarrationCandidateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<TtrpgGmNarrationCandidateV1>;
  return (
    row.schema === "storyforge.ttrpg-gm-candidate" &&
    row.version === 1 &&
    row.portable === false &&
    Number.isInteger(row.runId) &&
    Number.isInteger(row.productRuntimeSessionId) &&
    Number.isInteger(row.baseSequence) &&
    Number.isInteger(row.actionSequence) &&
    typeof row.stateHash === "string" &&
    typeof row.visibilityHash === "string" &&
    typeof row.releaseHash === "string" &&
    typeof row.contextManifestHash === "string" &&
    typeof row.sceneKey === "string" &&
    typeof row.narration === "string" &&
    !!row.synthesisFrame &&
    typeof row.synthesisFrame === "object" &&
    Array.isArray(row.offeredClueKeys) &&
    Array.isArray(row.recommendedNextSceneKeys) &&
    typeof row.candidateHash === "string"
  );
}

function commandId(candidate: TtrpgGmNarrationCandidateV1): string {
  return `ttrpg-ai-gm:${candidate.runId}:${candidate.candidateHash.slice(0, 32)}`;
}

export async function adoptTtrpgGmNarrationCandidateV1(input: {
  scope: WorkspaceScope;
  runId: number;
}): Promise<{
  snapshot: AgentRunSnapshotV1;
  candidate: TtrpgGmNarrationCandidateV1;
  receiptHash: string;
}> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(
    input.scope,
    input.runId,
    { owner: "instance" },
  );
  if (!saved || !isCandidate(saved.resumePayload))
    fail("运行缺少可恢复的 AI GM 候选");
  let { snapshot } = saved;
  const candidate = saved.resumePayload;
  if (
    candidate.runId !== input.runId ||
    (await hashCanonicalValue(candidateBody(candidate))) !==
      candidate.candidateHash
  ) {
    fail("候选哈希或运行绑定不匹配");
  }
  const priorAdoption = snapshot.events.find(
    (event) => event.type === "runtime.candidate.adopted",
  );
  if (
    priorAdoption?.type === "runtime.candidate.adopted" &&
    snapshot.projection.state === "completed"
  ) {
    return {
      snapshot,
      candidate,
      receiptHash:
        snapshot.projection.terminalReceiptHash ??
        fail("已采用运行缺少终验回执"),
    };
  }
  const stableCommandId = commandId(candidate);
  let committed = await db.productRuntimeEvents
    .where("sessionId")
    .equals(candidate.productRuntimeSessionId)
    .and((event) => event.commandId === stableCommandId)
    .first();
  if (!committed) {
    try {
      await assertTtrpgGmRuntimeHarnessFreshV1({
        scope: input.scope,
        contractScope: snapshot.contract.scope,
      });
      const view = await loadTtrpgGmRuntimeViewV1({
        scope: input.scope,
        productRuntimeSessionId: candidate.productRuntimeSessionId,
      });
      validateDraftAgainstView({ draft: candidate, view });
    } catch (error) {
      if (
        snapshot.projection.steps[TTRPG_GM_RUNTIME_STEP_ID_V1]?.status ===
        "awaiting_confirmation"
      ) {
        snapshot = await append(input.scope, snapshot, "candidate.staled", {
          stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
          candidateHash: candidate.candidateHash,
          reason:
            error instanceof Error
              ? error.message.slice(0, 1_000)
              : "runtime-input-stale",
        });
      }
      throw Object.assign(
        error instanceof Error ? error : new Error("AI GM 候选已过期"),
        { snapshot },
      );
    }
    const step = snapshot.projection.steps[TTRPG_GM_RUNTIME_STEP_ID_V1];
    if (step?.status === "awaiting_confirmation") {
      snapshot = await append(input.scope, snapshot, "confirmation.recorded", {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        decision: "adopt",
      });
    } else if (step?.confirmation !== "adopt") {
      fail("AI GM 候选当前不等待作者确认");
    }
    committed = await commitTtrpgGmNarrationFromHarnessV1({
      sessionId: candidate.productRuntimeSessionId,
      commandId: stableCommandId,
      baseSequence: candidate.baseSequence,
      baseStateHash: candidate.stateHash,
      runId: candidate.runId,
      candidateHash: candidate.candidateHash,
      actionSequence: candidate.actionSequence,
      text: candidate.narration,
      synthesisFrame: candidate.synthesisFrame,
    });
  }
  const payload = JSON.parse(committed.payloadJson) as Record<string, unknown>;
  const committedFrameHash = await hashCanonicalValue(payload.synthesisFrame);
  const candidateFrameHash = await hashCanonicalValue(candidate.synthesisFrame);
  if (
    committed.type !== "ttrpg.gm.response.recorded" ||
    payload.candidateHash !== candidate.candidateHash ||
    payload.runId !== candidate.runId ||
    payload.actionSequence !== candidate.actionSequence ||
    payload.text !== candidate.narration ||
    committedFrameHash !== candidateFrameHash
  ) {
    fail("已提交的 GM 叙事与候选不一致");
  }
  const [version, state] = await Promise.all([
    readProductRuntimeStateVersion(candidate.productRuntimeSessionId),
    readProductRuntimeState(candidate.productRuntimeSessionId),
  ]);
  const narration = state.ttrpg?.product?.gmNarrations.find(
    (item) => item.candidateHash === candidate.candidateHash,
  );
  if (
    !narration ||
    narration.eventSequence !== committed.sequence ||
    narration.text !== candidate.narration
  ) {
    fail("GM 叙事提交后状态验证失败");
  }
  const adoptionHash = await hashCanonicalValue({
    candidateHash: candidate.candidateHash,
    commandId: stableCommandId,
    eventId: committed.id,
    resultingSequence: version.sequence,
    resultingStateHash: version.stateHash,
  });
  snapshot = await readInstanceAgentRunV1(input.scope, snapshot.run.id);
  if (
    !snapshot.events.some((event) => event.type === "runtime.candidate.adopted")
  ) {
    snapshot = await appendRuntimeCandidateAdoptedV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      payload: {
        stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        adoptionHash,
        commandIds: [stableCommandId],
        baseSequence: candidate.baseSequence,
        resultingSequence: version.sequence,
      },
    });
  }
  if (
    snapshot.projection.steps[TTRPG_GM_RUNTIME_STEP_ID_V1]?.status !==
    "succeeded"
  ) {
    const attempt =
      snapshot.projection.steps[TTRPG_GM_RUNTIME_STEP_ID_V1]?.attempt ?? 1;
    snapshot = await append(input.scope, snapshot, "step.succeeded", {
      stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
      attempt,
      outputHash: adoptionHash,
    });
  }
  if (
    snapshot.projection.state !== "verifying" &&
    snapshot.projection.state !== "completed"
  ) {
    snapshot = await append(input.scope, snapshot, "verification.started", {
      verifierSetVersion: TTRPG_GM_RUNTIME_VERIFIER_SET_V1,
    });
  }
  if (snapshot.projection.state === "completed") {
    return {
      snapshot,
      candidate,
      receiptHash:
        snapshot.projection.terminalReceiptHash ??
        fail("已采用运行缺少终验回执"),
    };
  }
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash: version.stateHash,
    verifierSetVersion: TTRPG_GM_RUNTIME_VERIFIER_SET_V1,
    criteria: [
      {
        id: "runtime.candidate",
        status: "passed",
        evidenceRefs: [`candidate:${candidate.candidateHash}`],
      },
      {
        id: "runtime.freshness",
        status: "passed",
        evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`],
      },
      {
        id: "runtime.author-confirmed",
        status: "passed",
        evidenceRefs: [`run:${candidate.runId}:confirmation`],
      },
      {
        id: "runtime.prose-only",
        status: "passed",
        evidenceRefs: [`sim-event:${committed.id ?? committed.sequence}`],
      },
    ],
    acceptedAt: Date.now(),
  });
  snapshot = await append(input.scope, snapshot, "verification.accepted", {
    receiptHash: receipt.receiptHash,
  });
  return { snapshot, candidate, receiptHash: receipt.receiptHash };
}

export async function rejectTtrpgGmNarrationCandidateV1(input: {
  scope: WorkspaceScope;
  runId: number;
  note?: string;
}): Promise<AgentRunSnapshotV1> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(
    input.scope,
    input.runId,
    { owner: "instance" },
  );
  if (!saved || !isCandidate(saved.resumePayload))
    fail("运行缺少可恢复的 AI GM 候选");
  const step = saved.snapshot.projection.steps[TTRPG_GM_RUNTIME_STEP_ID_V1];
  if (step?.status === "failed" && step.confirmation === "reject")
    return saved.snapshot;
  if (step?.status !== "awaiting_confirmation")
    fail("AI GM 候选当前不等待作者确认");
  return append(input.scope, saved.snapshot, "confirmation.recorded", {
    stepId: TTRPG_GM_RUNTIME_STEP_ID_V1,
    candidateHash: saved.resumePayload.candidateHash,
    decision: "reject",
    note: input.note?.trim().slice(0, 1_000) || "真人 GM 拒绝该叙事候选",
  });
}
