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
  assertTtrpgGmActorRuntimeHarnessFreshV1,
  captureTtrpgGmActorRuntimeHarnessBoundaryV1,
} from "../agent/run/runtime-scope";
import { createVerificationReceiptV1 } from "../agent/run/verification-receipt";
import { assembleContext } from "../registry/assemble-context";
import {
  commitTtrpgGmActorActionFromHarnessV1,
  readProductRuntimeState,
  readProductRuntimeStateVersion,
} from "./runtime-api";
import type {
  AIConfig,
  ChatMessage,
  ProductRuntimeEvent,
  TtrpgRuntimeModelEvidenceV1,
  WorkspaceScope,
} from "../types";
import {
  loadTtrpgGmRuntimeViewV1,
  type TtrpgGmRuntimeViewV1,
} from "./gm-context";

export const TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1 =
  "ttrpg:gm-actor-action-candidate" as const;
export const TTRPG_GM_ACTOR_RUNTIME_VERIFIER_SET_V1 =
  "ttrpg-gm-actor-runtime-terminal-v1" as const;

export interface TtrpgGmActorActionCandidateV1 {
  schema: "storyforge.ttrpg-gm-actor-action-candidate";
  version: 1;
  portable: false;
  runId: number;
  productRuntimeSessionId: number;
  baseSequence: number;
  stateHash: string;
  visibilityHash: string;
  releaseHash: string;
  contextManifestHash: string;
  coordinatorKey: string;
  actorKey: string;
  viewerKey: string;
  controller: "ai" | "hybrid";
  requiresHumanConfirmation: boolean;
  actionKey: string;
  actionName: string;
  targetKey: string | null;
  targetName: string | null;
  defaultDifficulty: number | null;
  approach: string;
  spokenIntent: string | null;
  modelEvidence: TtrpgRuntimeModelEvidenceV1;
  modelCalls: TtrpgRuntimeModelEvidenceV1[];
  repairEvidence?: {
    initialIssue: string;
    initialOutputHash: string;
    repairedOutputHash: string;
  };
  candidateHash: string;
}

type RunAI = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>;

function fail(message: string): never {
  throw new Error(`[ttrpg-gm-actor-harness] ${message}`);
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
function boundedText(
  value: unknown,
  label: string,
  maximum: number,
  nullable = false,
): string | null {
  if (nullable && value == null) return null;
  if (typeof value !== "string")
    fail(`${label}必须是文本${nullable ? "或 null" : ""}`);
  const parsed = value.trim().normalize("NFC");
  if (!parsed || parsed.length > maximum) fail(`${label}无效`);
  return parsed;
}

function messages(objective: string, context: string): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "你是 StoryForge 可信 AI KP 的 NPC 行动提议器，只控制 activeTurn.actorKey 对应的当前 NPC。",
        "你必须从 activeTurn.availableActions 选择 actionKey，并按行动 target 只选择 activeTurn.visibleTargets 中的合法目标。",
        "你可以依据 GM 私密场景信息、该 NPC 的 objective、leverage、escalation、当前角色状态和已发生事实选择合理行动，但不得泄露这些私密信息给玩家。",
        "你只提出 NPC 行动意图，不能生成骰点、难度、修正、成功失败、伤害、资源/状态变化、奖励、线索发现、场景推进或新世界事实。",
        "approach 说明 NPC 尝试怎么做；spokenIntent 只允许该 NPC 当下说出的一句话，无台词时为 null。",
        "只输出严格 JSON，不要 Markdown、解释或额外字段：",
        '{"actionKey":"availableActions 中的 key","targetKey":null,"approach":"NPC 要尝试的做法","spokenIntent":null}',
      ].join("\n"),
    },
    {
      role: "user",
      content: `【主持目标】${objective}\n\n【冻结 GM 运行上下文】\n${context}`,
    },
  ];
}

function parseDraft(output: string, view: TtrpgGmRuntimeViewV1) {
  const source = parseJson(output);
  exact(
    source,
    ["actionKey", "targetKey", "approach", "spokenIntent"],
    "AI KP 角色行动候选",
  );
  const turn = view.activeTurn ?? fail("当前没有 GM 控制的 NPC 行动回合");
  if (turn.gmController !== "ai" && turn.gmController !== "hybrid")
    fail("当前 GM 席位未授权 AI 行动候选");
  const actionKey = boundedText(source.actionKey, "actionKey", 200)!;
  const targetKey =
    source.targetKey == null
      ? null
      : boundedText(source.targetKey, "targetKey", 200)!;
  const approach = boundedText(source.approach, "approach", 4_000)!;
  const spokenIntent = boundedText(
    source.spokenIntent,
    "spokenIntent",
    2_000,
    true,
  );
  const action =
    turn.availableActions.find((item) => item.actionKey === actionKey) ??
    fail("actionKey 不在当前 NPC 可用行动闭集");
  const target =
    targetKey == null
      ? null
      : (turn.visibleTargets.find((item) => item.actorKey === targetKey) ??
        fail("targetKey 不在 GM 当前场景可见角色中"));
  if (action.target === "self" && targetKey !== turn.actorKey)
    fail("自身行动必须以当前 NPC 为 targetKey");
  if (action.target === "scene" && targetKey != null)
    fail("场景行动的 targetKey 必须为 null");
  if (
    action.target === "single-ally" &&
    (!target || target.actorKey === turn.actorKey || target.role !== "npc")
  )
    fail("NPC 友方单体目标无效");
  if (action.target === "single-enemy" && (!target || target.role !== "player"))
    fail("NPC 敌方单体目标无效");
  if (
    /(?:掷|骰|d\d+|dc\s*\d+|难度\s*\d+|成功|失败|伤害\s*\d+|获得\s*\d+|失去\s*\d+)/iu.test(
      approach,
    )
  ) {
    fail("approach 夹带骰点、难度或尚未结算的机械结果");
  }
  return {
    actionKey: action.actionKey,
    actionName: action.name,
    targetKey,
    targetName: target?.name ?? null,
    defaultDifficulty: action.defaultDifficulty,
    approach,
    spokenIntent,
  };
}

export function evaluateTtrpgGmActorCandidateOutputV1(
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
  boundary: Awaited<
    ReturnType<typeof captureTtrpgGmActorRuntimeHarnessBoundaryV1>
  >;
  runtimeBindingHash: string;
  requiresHumanConfirmation: boolean;
}) {
  const skill = getAgentSkillV1("prose.ttrpg-gm-actor-intent");
  const authorityCriterion = input.requiresHumanConfirmation
    ? {
        id: "runtime.gm-human-confirmed",
        kind: "author-confirmed" as const,
        required: true,
      }
    : {
        id: "runtime.ai-gm-authorized",
        kind: "deterministic-check" as const,
        required: true,
      };
  return {
    version: 1 as const,
    objective: input.objective,
    workflowKind: "direct-generation" as const,
    scope: input.boundary.scope,
    permissions: { contextSourceKeys: ["ttrpgRuntime"], writeTargets: [] },
    runtimeBindingHash: input.runtimeBindingHash,
    executionBindings: [
      {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
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
        id: "runtime.gm-actor-candidate",
        kind: "output-present" as const,
        required: true,
      },
      {
        id: "runtime.gm-actor-freshness",
        kind: "deterministic-check" as const,
        required: true,
      },
      authorityCriterion,
      {
        id: "runtime.gm-actor-rulepack-commit",
        kind: "post-state-matches" as const,
        required: true,
      },
    ],
    verificationPlan: [
      {
        id: "runtime.gm-actor-terminal",
        kind: "terminal" as const,
        verifier: TTRPG_GM_ACTOR_RUNTIME_VERIFIER_SET_V1,
        criterionIds: [
          "runtime.gm-actor-candidate",
          "runtime.gm-actor-freshness",
          authorityCriterion.id,
          "runtime.gm-actor-rulepack-commit",
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

function repairable(error: unknown): boolean {
  return /不是有效 JSON|字段不在允许闭集|必须是文本|无效/u.test(
    error instanceof Error ? error.message : String(error),
  );
}
function repairPrompt(
  original: ChatMessage[],
  output: string,
  issue: string,
): ChatMessage[] {
  return [
    ...original,
    { role: "assistant", content: output.slice(0, 12_000) },
    {
      role: "user",
      content: `上一次输出未通过协议校验：${issue.slice(0, 1_000)}。只修复为 actionKey、targetKey、approach、spokenIntent 四字段严格 JSON；不得添加机械结果或新事实。`,
    },
  ];
}
function aggregateEvidence(
  calls: TtrpgRuntimeModelEvidenceV1[],
): TtrpgRuntimeModelEvidenceV1 {
  const first = calls[0] ?? fail("AI KP 角色行动缺少模型调用证据");
  const inputTokens = calls.reduce((sum, call) => sum + call.inputTokens, 0);
  const outputTokens = calls.reduce((sum, call) => sum + call.outputTokens, 0);
  const costs = calls.map((call) => call.estimatedCostUsd);
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
    estimatedCostUsd: costs.every((cost): cost is number => cost != null)
      ? costs.reduce((sum, cost) => sum + cost, 0)
      : null,
  };
}

export async function generateTtrpgGmActorActionCandidateV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
  objective: string;
  aiConfig?: AIConfig;
  runAI?: RunAI;
  signal?: AbortSignal;
  onRunCreated?: (runId: number) => void | Promise<void>;
}): Promise<{
  snapshot: AgentRunSnapshotV1;
  candidate: TtrpgGmActorActionCandidateV1;
}> {
  const objective = input.objective.trim();
  if (!objective || objective.length > 4_000) fail("NPC 行动主持目标无效");
  if (!input.runAI && !input.aiConfig) fail("缺少 AI 配置");
  const view = await loadTtrpgGmRuntimeViewV1(input);
  const turn = view.activeTurn ?? fail("当前不是 GM 控制的 NPC 回合");
  if (turn.gmController !== "ai" && turn.gmController !== "hybrid")
    fail("当前 GM 席位没有 AI 行动权限");
  const requiresHumanConfirmation = turn.gmController === "hybrid";
  const skill = getAgentSkillV1("prose.ttrpg-gm-actor-intent");
  const boundary = await captureTtrpgGmActorRuntimeHarnessBoundaryV1(input);
  const resolvedConfig = input.aiConfig
    ? resolveRequestConfig(input.aiConfig, {
        category: "runtime.ttrpg-gm",
        projectId: input.scope.projectId,
        contextOverflowPolicy: "reject",
      })
    : null;
  const modelIdentity = input.runAI
    ? { provider: "test-adapter", model: "injected", transport: "chat-v1" }
    : {
        provider: resolvedConfig?.config.provider ?? fail("缺少 AI provider"),
        model: resolvedConfig?.config.model ?? fail("缺少 AI model"),
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
    contract: contract({
      objective,
      boundary,
      runtimeBindingHash,
      requiresHumanConfirmation,
    }),
  });
  let activeAttempt: 1 | 2 = 1;
  await input.onRunCreated?.(snapshot.run.id);
  snapshot = await append(input.scope, snapshot, "step.scheduled", {
    stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
  });
  snapshot = await append(input.scope, snapshot, "step.started", {
    stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
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
      fail("正式 TTRPG GM 上下文为空");
    await assertTtrpgGmActorRuntimeHarnessFreshV1({
      scope: input.scope,
      contractScope: snapshot.contract.scope,
    });
    const manifest = await createContextManifestFromAssemblyV1({
      runId: snapshot.run.id,
      stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
      attempt: 1,
      projectId: input.scope.projectId,
      worldGroupId: boundary.scope.worldGroupId,
      declaredSourceKeys: ["ttrpgRuntime"],
      assembled,
      readerVersion: "ttrpg-gm-runtime-view-v1",
    });
    snapshot = await append(input.scope, snapshot, "context.assembled", {
      stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
      attempt: 1,
      manifestHash: manifest.manifestHash,
    });
    const prompt = messages(objective, assembled.text);
    const call = async (attemptPrompt: ChatMessage[], attempt: 1 | 2) => {
      snapshot = await append(input.scope, snapshot, "model.requested", {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
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
        latencyMs: Math.max(0, Date.now() - startedAt),
        estimatedCostUsd: computeKnownCostUsd(
          modelIdentity.model,
          inputTokens,
          outputTokens,
        ),
      };
      snapshot = await append(input.scope, snapshot, "model.responded", {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
        attempt,
        outputHash: await hashCanonicalValue(output),
      });
      return { output, evidence };
    };
    const first = await call(prompt, 1);
    const calls = [first.evidence];
    let draft: ReturnType<typeof parseDraft>;
    let repairEvidence: TtrpgGmActorActionCandidateV1["repairEvidence"];
    try {
      draft = parseDraft(first.output, view);
    } catch (error) {
      if (!repairable(error)) throw error;
      const issue = error instanceof Error ? error.message : String(error);
      snapshot = await append(input.scope, snapshot, "step.failed", {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
        attempt: 1,
        code: "ttrpg-gm-actor-repairable-protocol",
        retryable: true,
        category: "protocol",
        action: "retry",
      });
      snapshot = await append(input.scope, snapshot, "step.started", {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
        attempt: 2,
      });
      activeAttempt = 2;
      await assertTtrpgGmActorRuntimeHarnessFreshV1({
        scope: input.scope,
        contractScope: snapshot.contract.scope,
      });
      const second = await call(repairPrompt(prompt, first.output, issue), 2);
      calls.push(second.evidence);
      draft = parseDraft(second.output, view);
      repairEvidence = {
        initialIssue: issue.slice(0, 1_000),
        initialOutputHash: await hashCanonicalValue(first.output),
        repairedOutputHash: await hashCanonicalValue(second.output),
      };
    }
    const body = {
      schema: "storyforge.ttrpg-gm-actor-action-candidate" as const,
      version: 1 as const,
      portable: false as const,
      runId: snapshot.run.id,
      ...boundary.scope.runtime,
      contextManifestHash: manifest.manifestHash,
      coordinatorKey: `ttrpg-gm-actor:${input.productRuntimeSessionId}:${boundary.scope.runtime.baseSequence}:${turn.actorKey}`,
      actorKey: turn.actorKey,
      viewerKey: "viewer.gm",
      controller: turn.gmController,
      requiresHumanConfirmation,
      ...draft,
      modelEvidence: aggregateEvidence(calls),
      modelCalls: calls,
      ...(repairEvidence ? { repairEvidence } : {}),
    };
    const candidate: TtrpgGmActorActionCandidateV1 = {
      ...body,
      candidateHash: await hashCanonicalValue(body),
    };
    snapshot = await append(input.scope, snapshot, "candidate.persisted", {
      stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
      attempt: repairEvidence ? 2 : 1,
      candidateHash: candidate.candidateHash,
      requiresConfirmation: candidate.requiresHumanConfirmation,
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
      current.projection.steps[TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1]?.status ===
      "running"
    ) {
      snapshot = await append(input.scope, current, "step.failed", {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
        attempt: activeAttempt,
        code: input.signal?.aborted
          ? "ttrpg-gm-actor-cancelled"
          : "ttrpg-gm-actor-generation-failed",
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
          ? { reason: "ttrpg-gm-actor-cancelled" }
          : { code: "ttrpg-gm-actor-generation-failed", retryable: false },
      );
    }
    throw error;
  }
}

function candidateBody(candidate: TtrpgGmActorActionCandidateV1) {
  const { candidateHash: _candidateHash, ...body } = candidate;
  return body;
}
function isCandidate(value: unknown): value is TtrpgGmActorActionCandidateV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<TtrpgGmActorActionCandidateV1>;
  return (
    row.schema === "storyforge.ttrpg-gm-actor-action-candidate" &&
    row.version === 1 &&
    row.portable === false &&
    Number.isInteger(row.runId) &&
    Number.isInteger(row.productRuntimeSessionId) &&
    Number.isInteger(row.baseSequence) &&
    typeof row.stateHash === "string" &&
    typeof row.visibilityHash === "string" &&
    typeof row.releaseHash === "string" &&
    typeof row.contextManifestHash === "string" &&
    typeof row.coordinatorKey === "string" &&
    typeof row.actorKey === "string" &&
    typeof row.viewerKey === "string" &&
    (row.controller === "ai" || row.controller === "hybrid") &&
    typeof row.actionKey === "string" &&
    typeof row.approach === "string" &&
    typeof row.candidateHash === "string"
  );
}

export async function adoptTtrpgGmActorActionCandidateV1(input: {
  scope: WorkspaceScope;
  runId: number;
}): Promise<{
  snapshot: AgentRunSnapshotV1;
  candidate: TtrpgGmActorActionCandidateV1;
  event: ProductRuntimeEvent;
  receiptHash: string;
}> {
  const saved = await readLatestVerifiedAgentRunCheckpointV1(
    input.scope,
    input.runId,
    { owner: "instance" },
  );
  if (!saved || !isCandidate(saved.resumePayload))
    fail("运行缺少可恢复的 AI KP 角色行动候选");
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
  let committed = await import("../db/schema").then(({ db }) =>
    db.productRuntimeEvents
      .where("sessionId")
      .equals(candidate.productRuntimeSessionId)
      .and(
        (event) =>
          event.commandId ===
          `ttrpg-ai-gm-actor:${candidate.runId}:${candidate.candidateHash.slice(0, 32)}`,
      )
      .first(),
  );
  if (!committed) {
    try {
      await assertTtrpgGmActorRuntimeHarnessFreshV1({
        scope: input.scope,
        contractScope: snapshot.contract.scope,
      });
      const currentView = await loadTtrpgGmRuntimeViewV1({
        scope: input.scope,
        productRuntimeSessionId: candidate.productRuntimeSessionId,
      });
      const revalidated = parseDraft(
        JSON.stringify({
          actionKey: candidate.actionKey,
          targetKey: candidate.targetKey,
          approach: candidate.approach,
          spokenIntent: candidate.spokenIntent,
        }),
        currentView,
      );
      if (revalidated.defaultDifficulty !== candidate.defaultDifficulty)
        fail("候选默认难度已变化");
    } catch (error) {
      if (
        snapshot.projection.steps[TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1]?.status ===
        "awaiting_confirmation"
      ) {
        snapshot = await append(input.scope, snapshot, "candidate.staled", {
          stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
          candidateHash: candidate.candidateHash,
          reason:
            error instanceof Error
              ? error.message.slice(0, 1_000)
              : "runtime-input-stale",
        });
      }
      throw Object.assign(
        error instanceof Error ? error : new Error("AI KP 角色行动候选已过期"),
        { snapshot },
      );
    }
    const step = snapshot.projection.steps[TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1];
    if (candidate.requiresHumanConfirmation) {
      if (step?.status === "awaiting_confirmation") {
        snapshot = await append(
          input.scope,
          snapshot,
          "confirmation.recorded",
          {
            stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
            candidateHash: candidate.candidateHash,
            decision: "adopt",
          },
        );
      } else if (step?.confirmation !== "adopt")
        fail("混合 GM 候选当前不等待真人确认");
    } else if (candidate.controller !== "ai" || step?.status !== "running") {
      fail("自动 AI KP 角色行动候选状态无效");
    }
    committed = await commitTtrpgGmActorActionFromHarnessV1({
      sessionId: candidate.productRuntimeSessionId,
      runId: candidate.runId,
      candidateHash: candidate.candidateHash,
    });
  }
  const payload = JSON.parse(committed.payloadJson) as Record<string, any>;
  if (
    committed.type !== "ttrpg.rule.action.resolved" ||
    payload.result?.actorKey !== candidate.actorKey ||
    payload.result?.actionKey !== candidate.actionKey ||
    payload.result?.targetKey !== candidate.targetKey ||
    payload.result?.actorAuthority?.candidateHash !== candidate.candidateHash ||
    payload.result?.actorAuthority?.runId !== candidate.runId
  ) {
    fail("已提交规则行动与 AI KP 角色行动候选不一致");
  }
  const version = await readProductRuntimeStateVersion(
    candidate.productRuntimeSessionId,
  );
  const state = await readProductRuntimeState(candidate.productRuntimeSessionId);
  const result = state.ttrpg?.product?.actionHistory.find(
    (item) => item.eventSequence === committed.sequence,
  );
  if (
    !result ||
    result.actorAuthority?.candidateHash !== candidate.candidateHash
  )
    fail("AI KP 角色行动提交后状态验证失败");
  const adoptionHash = await hashCanonicalValue({
    candidateHash: candidate.candidateHash,
    eventId: committed.id,
    resultingSequence: version.sequence,
    resultingStateHash: version.stateHash,
  });
  snapshot = await readInstanceAgentRunV1(input.scope, snapshot.run.id);
  if (
    !priorAdoption &&
    !snapshot.events.some((event) => event.type === "runtime.candidate.adopted")
  ) {
    snapshot = await appendRuntimeCandidateAdoptedV1({
      scope: input.scope,
      runId: snapshot.run.id,
      expectedLastSequence: snapshot.projection.lastSequence,
      payload: {
        stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
        candidateHash: candidate.candidateHash,
        adoptionHash,
        commandIds: [
          committed.commandId ?? fail("AI KP 规则行动缺少 commandId"),
        ],
        baseSequence: candidate.baseSequence,
        resultingSequence: version.sequence,
      },
    });
  }
  if (
    snapshot.projection.steps[TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1]?.status !==
    "succeeded"
  ) {
    snapshot = await append(input.scope, snapshot, "step.succeeded", {
      stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
      attempt:
        snapshot.projection.steps[TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1]?.attempt ??
        1,
      outputHash: adoptionHash,
    });
  }
  if (
    snapshot.projection.state !== "verifying" &&
    snapshot.projection.state !== "completed"
  ) {
    snapshot = await append(input.scope, snapshot, "verification.started", {
      verifierSetVersion: TTRPG_GM_ACTOR_RUNTIME_VERIFIER_SET_V1,
    });
  }
  if (snapshot.projection.state === "completed") {
    return {
      snapshot,
      candidate,
      event: committed,
      receiptHash:
        snapshot.projection.terminalReceiptHash ?? fail("完成运行缺少回执"),
    };
  }
  const authorityCriterionId = candidate.requiresHumanConfirmation
    ? "runtime.gm-human-confirmed"
    : "runtime.ai-gm-authorized";
  const receipt = await createVerificationReceiptV1({
    version: 1,
    runId: snapshot.run.id,
    generation: snapshot.projection.generation,
    contractHash: snapshot.run.contractHash,
    contextManifestHashes: [candidate.contextManifestHash],
    candidateHashes: [candidate.candidateHash],
    adoptionEventIds: [],
    postStateHash: version.stateHash,
    verifierSetVersion: TTRPG_GM_ACTOR_RUNTIME_VERIFIER_SET_V1,
    criteria: [
      {
        id: "runtime.gm-actor-candidate",
        status: "passed",
        evidenceRefs: [`candidate:${candidate.candidateHash}`],
      },
      {
        id: "runtime.gm-actor-freshness",
        status: "passed",
        evidenceRefs: [`base:${candidate.baseSequence}:${candidate.stateHash}`],
      },
      {
        id: authorityCriterionId,
        status: "passed",
        evidenceRefs: [`gm:${candidate.controller}`],
      },
      {
        id: "runtime.gm-actor-rulepack-commit",
        status: "passed",
        evidenceRefs: [`sim-event:${committed.id ?? committed.sequence}`],
      },
    ],
    acceptedAt: Date.now(),
  });
  snapshot = await append(input.scope, snapshot, "verification.accepted", {
    receiptHash: receipt.receiptHash,
  });
  return {
    snapshot,
    candidate,
    event: committed,
    receiptHash: receipt.receiptHash,
  };
}

export async function rejectTtrpgGmActorActionCandidateV1(input: {
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
    fail("运行缺少可恢复的 AI KP 角色行动候选");
  if (!saved.resumePayload.requiresHumanConfirmation)
    fail("纯 AI KP 候选不能走真人拒绝分支");
  const step =
    saved.snapshot.projection.steps[TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1];
  if (step?.status === "failed" && step.confirmation === "reject")
    return saved.snapshot;
  if (step?.status !== "awaiting_confirmation")
    fail("混合 GM 候选当前不等待真人确认");
  return append(input.scope, saved.snapshot, "confirmation.recorded", {
    stepId: TTRPG_GM_ACTOR_RUNTIME_STEP_ID_V1,
    candidateHash: saved.resumePayload.candidateHash,
    decision: "reject",
    note: input.note?.trim().slice(0, 1_000) || "真人 GM 拒绝 AI NPC 行动建议",
  });
}
