import type {
  TtrpgRuntimeActionReceiptV2,
  TtrpgRuntimeGmSynthesisFrameV2,
  TtrpgRuntimeModelEvidenceV1,
  TtrpgRuntimeRuleActionResultV1,
} from "../types";
import {
  assertTtrpgFeedbackOutcomeConsistentV2,
  parseTtrpgGmSynthesisFrameV2,
} from "../ttrpg/action-feedback";
import type { TtrpgViewerProjectionV1 } from "../ttrpg/viewer-projection";
import { OnlineRoomAuthorityError } from "./room-authority";

export interface OnlineTtrpgAiGmServiceV1 {
  /**
   * Propose intent for the active GM-controlled NPC. The service must not roll
   * dice or return consequences; the authoritative room revalidates and
   * resolves the proposal through the frozen RulePack.
   */
  act(input: {
    roomId: string;
    releaseHash: string;
    actorKey: string;
    objective: string;
    projection: TtrpgViewerProjectionV1;
  }): Promise<unknown>;
  /** Deployment-owned model boundary; result is treated as untrusted protocol input. */
  narrate(input: {
    roomId: string;
    releaseHash: string;
    objective: string;
    projection: TtrpgViewerProjectionV1;
    action: TtrpgRuntimeRuleActionResultV1;
  }): Promise<unknown>;
}

export interface OnlineTtrpgAiGmActorProposalV1 {
  runId: number;
  actionKey: string;
  targetKey: string | null;
  approach: string;
  spokenIntent: string | null;
}

export interface OnlineTtrpgAiGmProposalV1 {
  runId: number;
  text: string;
  modelEvidence: TtrpgRuntimeModelEvidenceV1;
  synthesisFrame: TtrpgRuntimeGmSynthesisFrameV2;
}

function fail(message: string): never {
  throw new OnlineRoomAuthorityError("ai_gm_protocol", message);
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string") fail(`${label} 必须是文本`);
  const result = value.trim().normalize("NFC");
  if (!result || result.length > maximum) fail(`${label} 无效`);
  return result;
}

function finiteInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${label} 无效`);
  }
  return Number(value);
}

export function parseOnlineTtrpgAiGmObjectiveV1(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("ai.gm.narrate.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !("objective" in row)) {
    fail("ai.gm.narrate.payload 字段不符合闭集协议");
  }
  return text(row.objective, "objective", 4_000);
}

export function parseOnlineTtrpgAiGmActorObjectiveV1(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("ai.gm.act.payload 必须是对象");
  }
  const row = value as Record<string, unknown>;
  if (Object.keys(row).length !== 1 || !("objective" in row)) {
    fail("ai.gm.act.payload 字段不符合闭集协议");
  }
  return text(row.objective, "objective", 4_000);
}

export function parseOnlineTtrpgAiGmActorProposalV1(input: {
  value: unknown;
  projection: TtrpgViewerProjectionV1;
  actorKey: string;
}): OnlineTtrpgAiGmActorProposalV1 {
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("AI GM NPC 行动服务返回值必须是对象");
  }
  const row = input.value as Record<string, unknown>;
  const expected = ["runId", "actionKey", "targetKey", "approach", "spokenIntent"];
  const actual = Object.keys(row);
  if (actual.length !== expected.length || actual.some(field => !expected.includes(field))) {
    fail("AI GM NPC 行动服务返回字段不在闭集");
  }
  const runId = finiteInteger(row.runId, "runId", 1, Number.MAX_SAFE_INTEGER);
  const actionKey = text(row.actionKey, "actionKey", 200);
  const targetKey = row.targetKey == null ? null : text(row.targetKey, "targetKey", 200);
  const approach = text(row.approach, "approach", 4_000);
  const spokenIntent = row.spokenIntent == null
    ? null
    : text(row.spokenIntent, "spokenIntent", 2_000);
  const action = input.projection.availableActions.find(item => item.actionKey === actionKey);
  const actor = input.projection.actors.find(item => item.actorKey === input.actorKey);
  const target = targetKey == null
    ? null
    : input.projection.actors.find(item => item.actorKey === targetKey);
  if (!action || !actor || actor.role !== "npc") {
    fail("AI GM 引用了投影闭集之外的 NPC 或行动");
  }
  if (action.target === "self" && targetKey !== actor.actorKey) {
    fail("NPC 自身行动必须以当前 NPC 为目标");
  }
  if (action.target === "scene" && targetKey != null) {
    fail("NPC 场景行动不得指定目标角色");
  }
  if (
    action.target === "single-ally" &&
    (!target || target.actorKey === actor.actorKey || target.role !== "npc")
  ) {
    fail("NPC 友方单体行动目标无效");
  }
  if (action.target === "single-enemy" && (!target || target.role !== "player")) {
    fail("NPC 敌方单体行动目标无效");
  }
  if (/(?:掷|骰|d\d+|dc\s*\d+|难度\s*\d+|成功|失败|伤害\s*\d+|获得\s*\d+|失去\s*\d+)/iu.test(approach)) {
    fail("AI GM NPC 意图夹带尚未结算的机械结果");
  }
  return { runId, actionKey, targetKey, approach, spokenIntent };
}

function parseEvidence(value: unknown): TtrpgRuntimeModelEvidenceV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("modelEvidence 必须是对象");
  }
  const row = value as Record<string, unknown>;
  const fields = [
    "provider", "model", "usageSource", "inputTokens", "outputTokens",
    "totalTokens", "latencyMs", "estimatedCostUsd",
  ];
  const actual = Object.keys(row);
  if (actual.length !== fields.length || actual.some(field => !fields.includes(field))) {
    fail("modelEvidence 字段不符合闭集协议");
  }
  const inputTokens = finiteInteger(row.inputTokens, "inputTokens", 0, 1_000_000);
  const outputTokens = finiteInteger(row.outputTokens, "outputTokens", 0, 100_000);
  const totalTokens = finiteInteger(row.totalTokens, "totalTokens", 0, 1_100_000);
  const latencyMs = finiteInteger(row.latencyMs, "latencyMs", 0, 3_600_000);
  if (totalTokens !== inputTokens + outputTokens) fail("模型 token 总数不一致");
  if (row.usageSource !== "provider" && row.usageSource !== "estimated") fail("usageSource 无效");
  if (row.estimatedCostUsd != null && (
    typeof row.estimatedCostUsd !== "number" ||
    !Number.isFinite(row.estimatedCostUsd) ||
    row.estimatedCostUsd < 0 ||
    row.estimatedCostUsd > 1_000_000
  )) fail("estimatedCostUsd 无效");
  return {
    provider: text(row.provider, "provider", 160),
    model: text(row.model, "model", 240),
    usageSource: row.usageSource,
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs,
    estimatedCostUsd: row.estimatedCostUsd == null ? null : row.estimatedCostUsd,
  };
}

export function parseOnlineTtrpgAiGmProposalV1(input: {
  value: unknown;
  action: TtrpgRuntimeRuleActionResultV1;
  receipt: TtrpgRuntimeActionReceiptV2;
}): OnlineTtrpgAiGmProposalV1 {
  if (!input.value || typeof input.value !== "object" || Array.isArray(input.value)) {
    fail("AI GM 服务返回值必须是对象");
  }
  const row = input.value as Record<string, unknown>;
  const fields = ["runId", "text", "modelEvidence", "synthesisFrame"];
  const actual = Object.keys(row);
  if (actual.length !== fields.length || actual.some(field => !fields.includes(field))) {
    fail("AI GM 服务返回字段不在闭集");
  }
  const narration = text(row.text, "text", 20_000);
  try {
    assertTtrpgFeedbackOutcomeConsistentV2(narration, input.action.outcome);
    return {
      runId: finiteInteger(row.runId, "runId", 1, Number.MAX_SAFE_INTEGER),
      text: narration,
      modelEvidence: parseEvidence(row.modelEvidence),
      synthesisFrame: parseTtrpgGmSynthesisFrameV2(row.synthesisFrame, input.receipt),
    };
  } catch (error) {
    fail(error instanceof Error ? error.message : "AI GM 反馈与正式结果不一致");
  }
}
