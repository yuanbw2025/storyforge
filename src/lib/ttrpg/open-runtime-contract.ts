import { assertTtrpgOpenVoiceJournalV1, parseTtrpgOpenVoiceRequestV1, type TtrpgOpenVoiceRequestV1 } from './open-voice-request-contract'
import { assertTtrpgOpenAudioJournalV1, parseTtrpgOpenAudioReceiptV1, type TtrpgOpenAudioReceiptV1 } from './open-audio-contract'
import { assertTtrpgOpenEntityJournalV1 } from './open-entity-journal'
import { parseTtrpgOpenEntityOperationV1, type TtrpgOpenEntityOperationV1 } from './open-entity-contract'
import { parseTtrpgOpenSessionSituationReceiptV2, type TtrpgOpenSessionSituationReceipt } from './open-session-situation-contract'
import { isTtrpgOpenPassiveEpochV1 } from './open-coordination'
import { ttrpgOpenEpochBudgetForTriggerV1 } from './open-coordination'
import { parseTtrpgOpenTableMessageV1,assertTtrpgOpenTableMessageHistoryV1,type TtrpgOpenTableMessageV1 } from './open-table-conversation'
import { parseTtrpgOpenMemoryReceipt, type TtrpgOpenMemoryReceipt } from './open-memory-receipt'
import { parseTtrpgOpenGateRecoveryV1, type TtrpgOpenGateRecoveryV1 } from './open-gate-recovery'
import { parseTtrpgOpenNarrationReceiptV1, type TtrpgOpenNarrationReceiptV1 } from './open-kp-receipt'
import { parseTtrpgOpenStageClosureV1, ttrpgOpenStageClosureOriginV1, type TtrpgOpenStageClosureV1 } from './open-stage-close'
import { parseTtrpgOpenTerminalReceiptV1, parseTtrpgOpenGateReceiptV1, type TtrpgOpenTerminalReceiptV1, type TtrpgOpenGateReceiptV1 } from './open-terminal-gates'
import { parseTtrpgOpenSituationCycleV1, assertTtrpgOpenSituationCycleHistoryV1, type TtrpgOpenSituationCycleV1 } from './open-situation-cycle'
import { parseTtrpgOpenSituationHistoryV1, type TtrpgOpenSituationHistoryV1 } from './open-situation-runtime'
import { parseTtrpgOpenPressureCycleV1, assertTtrpgOpenPressureHistoryV1, parseTtrpgOpenPressureSignalV1, type TtrpgOpenPressureSignalV1, type TtrpgOpenPressureCycleV1 } from './open-pressure-cycle'
import { assertTtrpgOpenNormalizationSourceV1, assertTtrpgOpenOracleRuntimeCallOriginV1 } from './open-model-calls';
import { parseTtrpgOpenOracleReviewV1, assertTtrpgOpenOracleReviewJournalV1, type TtrpgOpenOracleReviewV1 } from './open-oracle-review';
import { parseTtrpgOpenKnowledgeV1, type TtrpgOpenKnowledgeEntryV1 } from './open-knowledge';
import { parseTtrpgOpenOracleReceiptV1, type TtrpgOpenOracleReceiptV1 } from './open-oracle-contract';
import { parseTtrpgOpenFactLedgerV1, assertTtrpgOpenModelFactApproverV1, assertTtrpgOpenFactModelCallV1, type TtrpgOpenFactLedgerV1 } from './open-fact-ledger';
import { parseTtrpgOpenKnowledgeShareReceiptV1, type TtrpgOpenKnowledgeShareReceiptV1 } from './open-knowledge-share';
import { assertTtrpgOpenIdentityKnowledgeJournalV1 } from './open-identity-knowledge';
import { parseTtrpgOpenBranchLineageV1, ttrpgOpenAncestorSourceAllowedV1, type TtrpgOpenBranchLineageV1 } from './open-branch-contract';
import { assertTtrpgOpenRecoveredOperationV1 } from './open-branch-recovery';
import type {
  TtrpgRuntimeState,
} from "../types";
import { parseTtrpgOpenMechanicalStateV1 } from "./runtime-state";
import { key as parseKey } from "./open-contract-parse";
import { parseTtrpgOpenAuthorizationV1, type TtrpgOpenAuthorizationV1 } from "./open-authorization";
import { parseTtrpgOpenCoordinationV1, parseTtrpgOpenEpochBudgetV1,
  type TtrpgOpenCoordinationV1, type TtrpgOpenEpochBudgetV1 } from "./open-coordination";
import { stableProductRuntimeJsonV1 } from "../product/runtime-values";
import { parseTtrpgOpenOperationV1, parseTtrpgOpenRuleReceiptV1, assertTtrpgOpenOperationIntentCallV1,
  type TtrpgOpenOperationV1, type TtrpgOpenRuleReceiptV1 } from "./open-operation";
import type {
  TtrpgOpenCampaignClockV1,
  TtrpgOpenCampaignFrontV1,
  TtrpgCampaignContentV2,
  TtrpgOpenAudience,
} from "./open-contract";
import type {
  TtrpgSituationActivationReasonV1,
  TtrpgSituationInstanceV1,
} from "./situation-engine";
import {
  advanceTtrpgWorldTimeV1,
  createTtrpgWorldTimeV1,
  type TtrpgWorldTimeAdvanceReason,
  type TtrpgWorldTimeV1,
} from "./world-time";

export const TTRPG_OPEN_FAILURE_CATEGORIES = [
  "fact-conflict",
  "gate-failed",
  "situation-rejected",
  "situation-capacity",
  "telegraph-missing",
  "oracle-scope-violation",
  "oracle-budget",
  "intent-unclear",
  "predicate-unresolvable",
  "budget-overflow",
  "media-degraded",
] as const;
export type TtrpgOpenFailureCategoryV1 =
  (typeof TTRPG_OPEN_FAILURE_CATEGORIES)[number];

export interface TtrpgOpenClockRuntimeStateV1 {
  clockKey: string;
  title: string;
  value: number;
  maximum: number;
  visibility: TtrpgOpenAudience;
  completed: boolean;
  lastAdvancedWorldTurn: number | null;
}

export interface TtrpgOpenFrontRuntimeStateV1 {
  frontKey: string;
  title: string;
  stageKey: string | null;
  defeated: boolean;
  telegraphedStageKeys: string[];
  telegraphWorldTurns?: Record<string, number>;
  lastEvaluatedWorldTurn: number | null;
}

export interface TtrpgOpenCompanionRuntimeStateV1 {
  actorKey: string;
  controller: "human" | "ai" | "hybrid" | "gm" | "open";
  consecutiveActions: number;
}

export interface TtrpgOpenGateRuntimeStateV1 {
  gateKey: string;
  status: "pending" | "passed" | "failed";
  evaluatedAtWorldTurn: number | null;
}

export interface TtrpgOpenFailureRuntimeStateV1 {
  failureKey: string;
  atSequence: number;
  atWorldTurn: number;
  category: TtrpgOpenFailureCategoryV1;
  violatedRule: string;
}

export interface TtrpgOpenSituationRuntimeStateV1
  extends Omit<TtrpgSituationInstanceV1, "status"> {
  status: "active" | "queued" | "resolved" | "expired";
  queuePosition: number | null;
}

export interface TtrpgOpenStageRuntimeStateV1 {
  status: "open" | "closed";
  openedAtWorldTurn: number;
  closedAtWorldTurn: number | null;
}

export interface TtrpgOpenRunStateV1 {
  schema: "storyforge.ttrpg-open-runtime";
  version: 1;
  runFormat: "open";
  worldTime: TtrpgWorldTimeV1;
  chaos: {
    value: number;
    lastChangedAtSequence?: number;
  };
  clocks: TtrpgOpenClockRuntimeStateV1[];
  fronts: TtrpgOpenFrontRuntimeStateV1[];
  companions: TtrpgOpenCompanionRuntimeStateV1[];
  gates: TtrpgOpenGateRuntimeStateV1[];
  failures: TtrpgOpenFailureRuntimeStateV1[];
  situations: {
    active: TtrpgOpenSituationRuntimeStateV1[];
    queued: TtrpgOpenSituationRuntimeStateV1[];
    cooldowns: Record<string, number>;
    history?: TtrpgOpenSituationHistoryV1[];
  };
  stage: TtrpgOpenStageRuntimeStateV1;
  consultedThisWorldTurn: number;
  coordination: TtrpgOpenCoordinationV1;
  operations: TtrpgOpenOperationV1[];
  ruleReceipts: TtrpgOpenRuleReceiptV1[];
  knowledge: TtrpgOpenKnowledgeEntryV1[];
  /** Absent on older states; first real consultation introduces the journal. */
  oracleReceipts?: TtrpgOpenOracleReceiptV1[];
  /** Introduced only by the first real semantic fact event. */
  factLedger?: TtrpgOpenFactLedgerV1;
  knowledgeShares?: TtrpgOpenKnowledgeShareReceiptV1[];
  oracleReviews?: TtrpgOpenOracleReviewV1[];
  tableMessages?: TtrpgOpenTableMessageV1[];
  audioReceipts?: TtrpgOpenAudioReceiptV1[];
  voiceRequests?: TtrpgOpenVoiceRequestV1[];
  narrations?: TtrpgOpenNarrationReceiptV1[];
  stageClosures?: TtrpgOpenStageClosureV1[];
  terminalReceipts?: TtrpgOpenTerminalReceiptV1[];
  gateReceipts?: TtrpgOpenGateReceiptV1[];
  gateRecoveries?: TtrpgOpenGateRecoveryV1[];
  situationCycles?: TtrpgOpenSituationCycleV1[];
  pressureCycles?: TtrpgOpenPressureCycleV1[];
  pressureSignals?: TtrpgOpenPressureSignalV1[];
  memoryReceipts?: TtrpgOpenMemoryReceipt[];
  situationReceipts?: TtrpgOpenSessionSituationReceipt[];
  entityOperations?: TtrpgOpenEntityOperationV1[];
}

/**
 * The V2 child state intentionally keeps the legacy scripted projection
 * fields. They remain a compatibility shell; open truth lives only in
 * `openRun`. The legacy parser never accepts this shape because it keeps its
 * exact eleven-key contract.
 */
export type TtrpgRuntimeStateV2 = TtrpgRuntimeState & {
  schema: "storyforge.ttrpg-runtime";
  version: 2;
  runFormat: "open";
  sessionKey: string;
  authorization: TtrpgOpenAuthorizationV1 | null;
  epochBudget: TtrpgOpenEpochBudgetV1;
  openRun: TtrpgOpenRunStateV1 | null;
  /** Present only on a branch; ordinary V2 states retain their original JSON shape. */
  branchLineage?: TtrpgOpenBranchLineageV1;
};

function fail(message: string): never {
  throw new Error(`[ttrpg-open-runtime] ${message}`);
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(`${label} 必须是 JSON 对象`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return fail(`${label} 必须是普通对象`);
  }
  return value as Record<string, unknown>;
}

function exact(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    fail(`${label} 字段不精确：${actual.join(",")}`);
  }
}

function text(value: unknown, label: string, maximum = 500): string {
  if (typeof value !== "string") return fail(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    return fail(`${label} 无效`);
  }
  return normalized;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null) return null;
  return text(value, label);
}

function integer(value: unknown, label: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    return fail(`${label} 必须是安全整数`);
  }
  return Number(value);
}

function nullableInteger(
  value: unknown,
  label: string,
  minimum: number,
): number | null {
  if (value === null) return null;
  return integer(value, label, minimum);
}

function uniqueStrings(
  value: unknown,
  label: string,
  maximum = 10_000,
): string[] {
  if (!Array.isArray(value) || value.length > maximum) {
    return fail(`${label} 必须是有限数组`);
  }
  const result = value.map((item, index) => text(item, `${label}[${index}]`, 500));
  if (new Set(result).size !== result.length) {
    return fail(`${label} 不能重复`);
  }
  return result;
}

function parseClock(value: unknown, index: number): TtrpgOpenClockRuntimeStateV1 {
  const row = record(value, `openRun.clocks[${index}]`);
  exact(
    row,
    [
      "clockKey",
      "title",
      "value",
      "maximum",
      "visibility",
      "completed",
      "lastAdvancedWorldTurn",
    ],
    `openRun.clocks[${index}]`,
  );
  const clockKey = text(row.clockKey, "clockKey");
  const title = text(row.title, "clock.title", 300);
  const maximum = integer(row.maximum, "clock.maximum", 1);
  const valueNumber = integer(row.value, "clock.value", 0);
  if (valueNumber > maximum) fail("clock.value 不能超过 maximum");
  if (
    row.visibility !== "gm-only" &&
    row.visibility !== "party" &&
    row.visibility !== "private" &&
    row.visibility !== "public"
  ) {
    fail("clock.visibility 无效");
  }
  if (typeof row.completed !== "boolean") fail("clock.completed 无效");
  const lastAdvancedWorldTurn = nullableInteger(
    row.lastAdvancedWorldTurn,
    "clock.lastAdvancedWorldTurn",
    0,
  );
  if (row.completed !== (valueNumber >= maximum)) {
    fail("clock.completed 与 clock.value 不一致");
  }
  return {
    clockKey,
    title,
    value: valueNumber,
    maximum,
    visibility: row.visibility,
    completed: row.completed,
    lastAdvancedWorldTurn,
  };
}

function parseFront(value: unknown, index: number): TtrpgOpenFrontRuntimeStateV1 {
  const row = record(value, `openRun.fronts[${index}]`);
  exact(
    row,
    [
      "frontKey",
      "title",
      "stageKey",
      "defeated",
      "telegraphedStageKeys",
      "lastEvaluatedWorldTurn",
      ...(Object.prototype.hasOwnProperty.call(row, "telegraphWorldTurns") ? ["telegraphWorldTurns"] : []),
    ],
    `openRun.fronts[${index}]`,
  );
  if (typeof row.defeated !== "boolean") fail("front.defeated 无效");
  return {
    frontKey: text(row.frontKey, "front.frontKey"),
    title: text(row.title, "front.title", 300),
    stageKey: nullableText(row.stageKey, "front.stageKey"),
    defeated: row.defeated,
    telegraphedStageKeys: uniqueStrings(
      row.telegraphedStageKeys,
      "front.telegraphedStageKeys",
    ),
    lastEvaluatedWorldTurn: nullableInteger(
      row.lastEvaluatedWorldTurn,
      "front.lastEvaluatedWorldTurn",
      0,
    ),
    ...(Object.prototype.hasOwnProperty.call(row, 'telegraphWorldTurns') ? { telegraphWorldTurns: Object.fromEntries(Object.entries(record(row.telegraphWorldTurns, 'front telegraphs')).map(([key, turn]) => [text(key, 'telegraph key'), integer(turn, 'telegraph turn', 0)])) } : {}),
  };
}

function parseCompanion(
  value: unknown,
  index: number,
): TtrpgOpenCompanionRuntimeStateV1 {
  const row = record(value, `openRun.companions[${index}]`);
  exact(
    row,
    ["actorKey", "controller", "consecutiveActions"],
    `openRun.companions[${index}]`,
  );
  if (
    row.controller !== "human" &&
    row.controller !== "ai" &&
    row.controller !== "hybrid" &&
    row.controller !== "gm"
  ) {
    fail("companion.controller 无效");
  }
  return {
    actorKey: text(row.actorKey, "companion.actorKey"),
    controller: row.controller,
    consecutiveActions: integer(
      row.consecutiveActions,
      "companion.consecutiveActions",
      0,
    ),
  };
}

function parseGate(value: unknown, index: number): TtrpgOpenGateRuntimeStateV1 {
  const row = record(value, `openRun.gates[${index}]`);
  exact(
    row,
    ["gateKey", "status", "evaluatedAtWorldTurn"],
    `openRun.gates[${index}]`,
  );
  if (
    row.status !== "pending" &&
    row.status !== "passed" &&
    row.status !== "failed"
  ) {
    fail("gate.status 无效");
  }
  return {
    gateKey: text(row.gateKey, "gate.gateKey"),
    status: row.status,
    evaluatedAtWorldTurn: nullableInteger(
      row.evaluatedAtWorldTurn,
      "gate.evaluatedAtWorldTurn",
      0,
    ),
  };
}

export function parseTtrpgOpenFailureRuntimeStateV1(
  value: unknown,
  index = 0,
): TtrpgOpenFailureRuntimeStateV1 {
  const row = record(value, `openRun.failures[${index}]`);
  exact(
    row,
    ["failureKey", "atSequence", "atWorldTurn", "category", "violatedRule"],
    `openRun.failures[${index}]`,
  );
  if (
    !TTRPG_OPEN_FAILURE_CATEGORIES.includes(
      row.category as TtrpgOpenFailureCategoryV1,
    )
  ) {
    fail("failure.category 无效");
  }
  return {
    failureKey: text(row.failureKey, "failure.failureKey", 200),
    atSequence: integer(row.atSequence, "failure.atSequence", 1),
    atWorldTurn: integer(row.atWorldTurn, "failure.atWorldTurn", 0),
    category: row.category as TtrpgOpenFailureCategoryV1,
    violatedRule: text(row.violatedRule, "failure.violatedRule", 2_000),
  };
}

export function parseTtrpgOpenSituationRuntimeStateV1(
  value: unknown,
  label: string,
): TtrpgOpenSituationRuntimeStateV1 {
  const row = record(value, label);
  exact(
    row,
    [
      "situationKey",
      "templateKey",
      "status",
      "activatedAtSequence",
      "activatedAtWorldTurn",
      "activationReason",
      "whyNowRefs",
      "satisfiedObstacleKeys",
      "discoveredEvidenceRefs",
      "noInterventionDueWorldTurn",
      "resolvedAtSequence",
      "resolutionKind",
      "queuePosition",
    ],
    label,
  );
  if (
    row.status !== "active" &&
    row.status !== "queued" &&
    row.status !== "resolved" &&
    row.status !== "expired"
  ) {
    fail(`${label}.status 无效`);
  }
  if (
    row.activationReason !== "opening" &&
    row.activationReason !== "front-escalation" &&
    row.activationReason !== "consequence" && row.activationReason !== "session-generation"
  ) {
    fail(`${label}.activationReason 无效`);
  }
  const resolutionKind =
    row.resolutionKind === null
      ? null
      : row.resolutionKind === "intervened" ||
          row.resolutionKind === "no-intervention" ||
          row.resolutionKind === "front-defeated" ||
          row.resolutionKind === "superseded"
        ? row.resolutionKind
        : fail(`${label}.resolutionKind 无效`);
  const queuePosition = nullableInteger(row.queuePosition, `${label}.queuePosition`, 0);
  if (row.status === "queued" && queuePosition === null) {
    fail(`${label}.queued 必须有 queuePosition`);
  }
  if (row.status !== "queued" && queuePosition !== null) {
    fail(`${label}.非 queued 不能有 queuePosition`);
  }
  return {
    situationKey: text(row.situationKey, `${label}.situationKey`, 200),
    templateKey: text(row.templateKey, `${label}.templateKey`, 200),
    status: row.status,
    activatedAtSequence: integer(
      row.activatedAtSequence,
      `${label}.activatedAtSequence`,
      1,
    ),
    activatedAtWorldTurn: integer(
      row.activatedAtWorldTurn,
      `${label}.activatedAtWorldTurn`,
      0,
    ),
    activationReason: row.activationReason as TtrpgSituationActivationReasonV1,
    whyNowRefs: uniqueStrings(row.whyNowRefs, `${label}.whyNowRefs`),
    satisfiedObstacleKeys: uniqueStrings(
      row.satisfiedObstacleKeys,
      `${label}.satisfiedObstacleKeys`,
    ),
    discoveredEvidenceRefs: uniqueStrings(
      row.discoveredEvidenceRefs,
      `${label}.discoveredEvidenceRefs`,
    ),
    noInterventionDueWorldTurn: integer(
      row.noInterventionDueWorldTurn,
      `${label}.noInterventionDueWorldTurn`,
      0,
    ),
    resolvedAtSequence: nullableInteger(
      row.resolvedAtSequence,
      `${label}.resolvedAtSequence`,
      1,
    ),
    resolutionKind,
    queuePosition,
  };
}

function parseWorldTime(value: unknown): TtrpgWorldTimeV1 {
  const row = record(value, "openRun.worldTime");
  exact(
    row,
    ["worldTurn", "lastAdvancedByEventSequence", "lastAdvanceReason"],
    "openRun.worldTime",
  );
  const worldTurn = integer(row.worldTurn, "worldTime.worldTurn", 0);
  const lastAdvancedByEventSequence = integer(
    row.lastAdvancedByEventSequence,
    "worldTime.lastAdvancedByEventSequence",
    -1,
  );
  const lastAdvanceReason = row.lastAdvanceReason;
  if (
    lastAdvanceReason !== null &&
    ![
      "game-action",
      "ai-companion-action",
      "idle-tick",
      "front-escalation",
      "situation-maintenance",
      "stage-close",
    ].includes(String(lastAdvanceReason))
  ) {
    fail("worldTime.lastAdvanceReason 无效");
  }
  return {
    worldTurn,
    lastAdvancedByEventSequence,
    lastAdvanceReason:
      lastAdvanceReason as TtrpgWorldTimeV1["lastAdvanceReason"],
  };
}

export function parseTtrpgOpenRunStateV1(
  value: unknown,
  sessionKey?: string,
): TtrpgOpenRunStateV1 {
  const row = record(value, "openRun");
  exact(
    row,
    [
      "schema",
      "version",
      "runFormat",
      "worldTime",
      "chaos",
      "clocks",
      "fronts",
      "companions",
      "gates",
      "failures",
      "situations",
      "stage",
      "consultedThisWorldTurn",
      "coordination",
      "operations",
      "ruleReceipts", "knowledge",
      ...(Object.prototype.hasOwnProperty.call(row, "oracleReceipts") ? ["oracleReceipts"] : []),
    ...(Object.prototype.hasOwnProperty.call(row, "factLedger") ? ["factLedger"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "knowledgeShares") ? ["knowledgeShares"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "oracleReviews") ? ["oracleReviews"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "tableMessages") ? ["tableMessages"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "audioReceipts") ? ["audioReceipts"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "voiceRequests") ? ["voiceRequests"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "narrations") ? ["narrations"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "memoryReceipts") ? ["memoryReceipts"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "situationReceipts") ? ["situationReceipts"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "entityOperations") ? ["entityOperations"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "stageClosures") ? ["stageClosures"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "terminalReceipts") ? ["terminalReceipts"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "gateReceipts") ? ["gateReceipts"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "gateRecoveries") ? ["gateRecoveries"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "situationCycles") ? ["situationCycles"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "pressureCycles") ? ["pressureCycles"] : []),
      ...(Object.prototype.hasOwnProperty.call(row, "pressureSignals") ? ["pressureSignals"] : []),
    ],
    "openRun",
  );
  if (
    row.schema !== "storyforge.ttrpg-open-runtime" ||
    row.version !== 1 ||
    row.runFormat !== "open"
  ) {
    fail("openRun schema/version/runFormat 无效");
  }
  const chaos = record(row.chaos, "openRun.chaos");
  exact(chaos, ["value", ...(Object.prototype.hasOwnProperty.call(chaos, "lastChangedAtSequence") ? ["lastChangedAtSequence"] : [])], "openRun.chaos");
  const chaosValue = integer(chaos.value, "openRun.chaos.value", 0);
  if (chaosValue > 100) fail("openRun.chaos.value 超出范围");
  const clocks = Array.isArray(row.clocks)
    ? row.clocks.map(parseClock)
    : fail("openRun.clocks 必须是数组");
  const fronts = Array.isArray(row.fronts)
    ? row.fronts.map(parseFront)
    : fail("openRun.fronts 必须是数组");
  const companions = Array.isArray(row.companions)
    ? row.companions.map(parseCompanion)
    : fail("openRun.companions 必须是数组");
  const gates = Array.isArray(row.gates)
    ? row.gates.map(parseGate)
    : fail("openRun.gates 必须是数组");
  const failures = Array.isArray(row.failures)
    ? row.failures.map(parseTtrpgOpenFailureRuntimeStateV1)
    : fail("openRun.failures 必须是数组");
  const situations = record(row.situations, "openRun.situations");
  exact(
    situations,
    ["active", "queued", "cooldowns", ...(Object.prototype.hasOwnProperty.call(situations, "history") ? ["history"] : [])],
    "openRun.situations",
  );
  const active = Array.isArray(situations.active)
    ? situations.active.map((item) =>
        parseTtrpgOpenSituationRuntimeStateV1(
          item,
          "openRun.situations.active[]",
        ),
      )
    : fail("openRun.situations.active 必须是数组");
  const queued = Array.isArray(situations.queued)
    ? situations.queued.map((item) =>
        parseTtrpgOpenSituationRuntimeStateV1(
          item,
          "openRun.situations.queued[]",
        ),
      )
    : fail("openRun.situations.queued 必须是数组");
  if (active.length > 5) fail("openRun.active situations 不能超过 5 个");
  if (new Set([...active, ...queued].map((item) => item.situationKey)).size !== active.length + queued.length) {
    fail("openRun situations 不能重复");
  }
  const cooldowns = record(situations.cooldowns, "openRun.situations.cooldowns");
  const parsedCooldowns: Record<string, number> = {};
  for (const [key, value] of Object.entries(cooldowns)) {
    parsedCooldowns[text(key, "situation cooldown key", 200)] = integer(
      value,
      `openRun.situations.cooldowns.${key}`,
      0,
    );
  }
  const stage = record(row.stage, "openRun.stage");
  exact(
    stage,
    ["status", "openedAtWorldTurn", "closedAtWorldTurn"],
    "openRun.stage",
  );
  if (stage.status !== "open" && stage.status !== "closed") {
    fail("openRun.stage.status 无效");
  }
  const parsedStage: TtrpgOpenStageRuntimeStateV1 = {
    status: stage.status,
    openedAtWorldTurn: integer(
      stage.openedAtWorldTurn,
      "openRun.stage.openedAtWorldTurn",
      0,
    ),
    closedAtWorldTurn: nullableInteger(
      stage.closedAtWorldTurn,
      "openRun.stage.closedAtWorldTurn",
      0,
    ),
  };
  if (
    (parsedStage.status === "open") !== (parsedStage.closedAtWorldTurn === null)
  ) {
    fail("openRun.stage 开闭状态与时间不一致");
  }
  return {
    schema: "storyforge.ttrpg-open-runtime",
    version: 1,
    runFormat: "open",
    worldTime: parseWorldTime(row.worldTime),
    chaos: { value: chaosValue, ...(Object.prototype.hasOwnProperty.call(chaos, "lastChangedAtSequence") ? { lastChangedAtSequence: integer(chaos.lastChangedAtSequence, "chaos change source", 1) } : {}) },
    clocks,
    fronts,
    companions,
    gates,
    failures,
    situations: {
      active,
      queued,
      cooldowns: parsedCooldowns,
      ...(Object.prototype.hasOwnProperty.call(situations, "history") ? { history: Array.isArray(situations.history) && situations.history.length <= 100000
        ? situations.history.map(parseTtrpgOpenSituationHistoryV1) : fail("situation history 必须是有界实际记录") } : {}),
    },
    stage: parsedStage,
    consultedThisWorldTurn: integer(
      row.consultedThisWorldTurn,
      "openRun.consultedThisWorldTurn",
      0,
    ),
    coordination: parseTtrpgOpenCoordinationV1(row.coordination, sessionKey),
    operations: Array.isArray(row.operations) ? row.operations.map(value => parseTtrpgOpenOperationV1(value, sessionKey)) : fail("operations 必须是数组"),
    ruleReceipts: Array.isArray(row.ruleReceipts) ? row.ruleReceipts.map(parseTtrpgOpenRuleReceiptV1) : fail("ruleReceipts 必须是数组"),
    knowledge: parseTtrpgOpenKnowledgeV1(row.knowledge),
    ...(Object.prototype.hasOwnProperty.call(row, "oracleReceipts") ? {
      oracleReceipts: Array.isArray(row.oracleReceipts) && row.oracleReceipts.length <= 100_000
        ? row.oracleReceipts.map(parseTtrpgOpenOracleReceiptV1) : fail("oracleReceipts 必须是有限数组"),
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "oracleReviews") ? { oracleReviews: Array.isArray(row.oracleReviews) && row.oracleReviews.length <= 100000
      ? row.oracleReviews.map(parseTtrpgOpenOracleReviewV1) : fail("oracleReviews 必须是有限数组") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "factLedger") ? { factLedger: parseTtrpgOpenFactLedgerV1(row.factLedger) } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "knowledgeShares") ? {
      knowledgeShares: Array.isArray(row.knowledgeShares) && row.knowledgeShares.length <= 100000
        ? row.knowledgeShares.map(parseTtrpgOpenKnowledgeShareReceiptV1) : fail("knowledgeShares 必须是有限数组"),
    } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "tableMessages") ? { tableMessages: Array.isArray(row.tableMessages) && row.tableMessages.length <= 100000 ? row.tableMessages.map(parseTtrpgOpenTableMessageV1) : fail("tableMessages 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "audioReceipts") ? { audioReceipts: Array.isArray(row.audioReceipts) && row.audioReceipts.length <= 100000 ? row.audioReceipts.map(parseTtrpgOpenAudioReceiptV1) : fail("audioReceipts 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "voiceRequests") ? { voiceRequests: Array.isArray(row.voiceRequests) && row.voiceRequests.length <= 100000 ? row.voiceRequests.map(parseTtrpgOpenVoiceRequestV1) : fail("voiceRequests 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "narrations") ? { narrations: Array.isArray(row.narrations) && row.narrations.length <= 100000 ? row.narrations.map(parseTtrpgOpenNarrationReceiptV1) : fail("narrations 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "entityOperations") ? { entityOperations: Array.isArray(row.entityOperations) && row.entityOperations.length <= 1000 ? row.entityOperations.map(parseTtrpgOpenEntityOperationV1) : fail("entityOperations 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "situationReceipts") ? { situationReceipts: Array.isArray(row.situationReceipts) && row.situationReceipts.length <= 1000 ? row.situationReceipts.map(parseTtrpgOpenSessionSituationReceiptV2) : fail("situationReceipts 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "memoryReceipts") ? { memoryReceipts: Array.isArray(row.memoryReceipts) && row.memoryReceipts.length <= 100000 ? row.memoryReceipts.map(parseTtrpgOpenMemoryReceipt) : fail("memoryReceipts 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "stageClosures") ? { stageClosures: Array.isArray(row.stageClosures) && row.stageClosures.length <= 100000 ? row.stageClosures.map(parseTtrpgOpenStageClosureV1) : fail("stageClosures 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "terminalReceipts") ? { terminalReceipts: Array.isArray(row.terminalReceipts) && row.terminalReceipts.length <= 100000 ? row.terminalReceipts.map(parseTtrpgOpenTerminalReceiptV1) : fail("terminalReceipts 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "gateReceipts") ? { gateReceipts: Array.isArray(row.gateReceipts) && row.gateReceipts.length <= 100000 ? row.gateReceipts.map(parseTtrpgOpenGateReceiptV1) : fail("gateReceipts 必须有界") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "situationCycles") ? { situationCycles: Array.isArray(row.situationCycles) && row.situationCycles.length <= 100000
      ? row.situationCycles.map(parseTtrpgOpenSituationCycleV1) : fail("situationCycles 必须是有限数组") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "pressureCycles") ? { pressureCycles: Array.isArray(row.pressureCycles) && row.pressureCycles.length <= 100000
      ? row.pressureCycles.map(parseTtrpgOpenPressureCycleV1) : fail("pressureCycles 必须是有限数组") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "pressureSignals") ? { pressureSignals: Array.isArray(row.pressureSignals) && row.pressureSignals.length <= 100000
      ? row.pressureSignals.map(parseTtrpgOpenPressureSignalV1) : fail("pressureSignals 必须是有限数组") } : {}),
    ...(Object.prototype.hasOwnProperty.call(row, "gateRecoveries") ? { gateRecoveries: Array.isArray(row.gateRecoveries) && row.gateRecoveries.length <= 100000 ? row.gateRecoveries.map(parseTtrpgOpenGateRecoveryV1) : fail("gateRecoveries 必须有界") } : {}),
  };
}

export function parseTtrpgRuntimeStateV2(
  value: unknown,
): TtrpgRuntimeStateV2 | null {
  if (value == null) return null;
  const row = record(value, "正式 TTRPG open 运行态");
  exact(
    row,
    [
      "schema",
      "version",
      "runFormat",
      "sessionKey",
      "authorization",
      "epochBudget",
      "scene",
      "round",
      "activeActorKey",
      "turnOrder",
      "initiative",
      "actions",
      "checks",
      "attacks",
      "encounter",
      "campaign",
      "product",
      "openRun",
      ...(Object.prototype.hasOwnProperty.call(row, "branchLineage") ? ["branchLineage"] : []),
    ],
    "正式 TTRPG open 运行态",
  );
  if (row.schema !== "storyforge.ttrpg-runtime" || row.version !== 2 || row.runFormat !== "open") {
    fail("open 运行态 schema/version/runFormat 无效");
  }
  if (row.scene !== null || row.activeActorKey !== null || row.initiative !== null) {
    fail("open 运行态不能携带 scripted scene/initiative");
  }
  if (row.round !== 0) fail("open 运行态 compatibility round 必须为 0");
  if (!Array.isArray(row.turnOrder) || row.turnOrder.length !== 0) {
    fail("open 运行态 compatibility turnOrder 必须为空");
  }
  for (const key of ["actions", "checks", "attacks"]) {
    if (!Array.isArray(row[key])) fail(`open 运行态 ${key} 必须是数组`);
  }
  if (row.encounter !== null) fail("open 运行态不能携带 scripted encounter");
  // Validate shared mechanical fields with the existing strict parser in memory.
  // This validation view is never persisted or used for the original state hash.
  const { schema: _schema, version: _version, runFormat: _format, openRun: _run,
    sessionKey: _session, authorization: _authorization, epochBudget: _budget, branchLineage: _lineage, ...mechanical } = row;
  const parsed = parseTtrpgOpenMechanicalStateV1(mechanical);
  if (!parsed) return fail("open 运行态 compatibility projection 不完整");
  const sessionKey = parseKey(row.sessionKey, "open.sessionKey");
  const branchLineage = Object.prototype.hasOwnProperty.call(row, "branchLineage")
    ? parseTtrpgOpenBranchLineageV1(row.branchLineage, sessionKey) : undefined;
  const authorization = row.authorization === null ? null : parseTtrpgOpenAuthorizationV1(row.authorization);
  const epochBudget = parseTtrpgOpenEpochBudgetV1(row.epochBudget);
  if (parsed.product.sessionZero.completed !== (authorization !== null)
    || (authorization !== null && (authorization.revision !== parsed.product.sessionZero.completedAtSequence
      || authorization.sourceRef.sessionKey !== sessionKey
      || authorization.completedBySeatKey !== parsed.product.sessionZero.completedBy
      || JSON.stringify([...authorization.selectedActorKeys].sort()) !== JSON.stringify([...parsed.product.sessionZero.selectedCharacterKeys].sort())))
    || (row.openRun !== null && authorization === null && branchLineage === undefined)) fail("open 授权与 Session Zero 状态不一致");
  const openRun = row.openRun === null ? null : parseTtrpgOpenRunStateV1(row.openRun, sessionKey);
  if (openRun && authorization === null && (openRun.coordination.epochs.length || openRun.coordination.calls.length
    || openRun.operations.length || openRun.ruleReceipts.length
    || openRun.tableMessages?.some(message => message.sourceRef.sessionKey === sessionKey)
    || openRun.audioReceipts?.some(receipt => receipt.envelope.sourceRef.sessionKey === sessionKey)
    || openRun.knowledge.some(entry => entry.acquisitionRef.sessionKey === sessionKey)
    || branchLineage?.recoveryTasks.some(task => task.status !== "awaiting-authorization" && task.status !== "withdrawn"))) {
    fail("未重新确认的分支不得拥有活动授权或恢复执行");
  }
  for (const history of openRun?.situations.history ?? []) {
    if (history.sourceRef.sessionKey !== sessionKey && !branchLineage?.ancestors.some(a => a.sessionKey === history.sourceRef.sessionKey && a.throughSequence >= history.sourceRef.sequence
      && a.snapshot.openRun?.situations.history?.some(h => stableProductRuntimeJsonV1(h) === stableProductRuntimeJsonV1(history)))) fail("局势终态缺少实际祖先处置记录");
  }
  for (const receipt of [...(openRun?.terminalReceipts ?? []), ...(openRun?.gateReceipts ?? [])]) {
    if (receipt.sourceRef.sessionKey !== sessionKey && !branchLineage?.ancestors.some(a => a.sessionKey === receipt.sourceRef.sessionKey && a.throughSequence >= receipt.sourceRef.sequence
      && [...(a.snapshot.openRun?.terminalReceipts ?? []), ...(a.snapshot.openRun?.gateReceipts ?? [])].some(r => stableProductRuntimeJsonV1(r) === stableProductRuntimeJsonV1(receipt)))) fail("终态/门缺少实际祖先评估记录");
  }
  const recoveries = openRun?.gateRecoveries ?? [];
  if (new Set(recoveries.map(r => r.recoveryKey)).size !== recoveries.length || new Set(recoveries.map(r => `${r.operationKey}:${r.authorizationEpochKey}`)).size !== recoveries.length) fail("局部恢复只能按真实操作窗口执行一次");
  for (const recovery of recoveries) {
    if (recovery.sourceRef.sessionKey !== sessionKey) {
      if (!branchLineage?.ancestors.some(a => a.sessionKey === recovery.sourceRef.sessionKey && a.throughSequence >= (recovery.stoppedRef?.sequence ?? recovery.sourceRef.sequence) && a.snapshot.openRun?.gateRecoveries?.some(r => stableProductRuntimeJsonV1(r) === stableProductRuntimeJsonV1(recovery)))) fail("局部恢复缺少真实祖先记录");
    } else if (!openRun!.operations.some(o => o.operationKey === recovery.operationKey && o.planHash === recovery.frozenPlanHash && o.authorizationEpochKey === recovery.authorizationEpochKey)
      || !openRun!.gateReceipts?.some(r => r.sourceRef.sessionKey === recovery.evaluationRef.sessionKey && r.sourceRef.sequence === recovery.evaluationRef.sequence && r.actorKey === recovery.actorKey && r.result.evaluationBasisHash === recovery.evaluationBasisHash && r.result.results[recovery.gateKey].passed === false)) fail("局部恢复必须引用该操作真实失败评估");
    if (recovery.action === 'evidence' && !openRun!.knowledge.some(k => k.knowledgeKey === recovery.recoveryKey && k.evidenceRef === recovery.targetRef && k.publicFieldsHash === recovery.publicFieldsHash && k.acquisitionRef.sessionKey === recovery.sourceRef.sessionKey && k.acquisitionRef.sequence === recovery.sourceRef.sequence && k.reliability === 'observed' && k.audience === 'private' && k.recipientActorKeys.length === 1 && k.recipientActorKeys[0] === recovery.actorKey)) fail("恢复线索没有真实定向知识记录");
    if (recovery.stoppedRef && recovery.sourceRef.sessionKey === sessionKey && !openRun!.coordination.epochs.some(e => e.epochKey === recovery.authorizationEpochKey && e.status === 'closed' && e.closedRef?.sequence === recovery.stoppedRef!.sequence && e.stopReason === recovery.stopReason)) fail("恢复停止必须闭合实际原授权窗口");
    if (recovery.failedEvaluationRefs.some(ref => !openRun!.gateReceipts?.some(g => g.sourceRef.sessionKey === ref.sessionKey && g.sourceRef.sequence === ref.sequence && g.authorizationEpochKey === recovery.authorizationEpochKey && !g.result.allApplicablePassed))) fail("恢复停止引用了不存在或并未失败的评估");
  }
  const closures = openRun?.stageClosures ?? [];
  if (new Set(closures.map(c => c.cycleKey)).size !== closures.length || closures.some((c, i) => c.stageIndex !== i)) fail("阶段收束身份/索引必须唯一且有序");
  for (const closure of closures) {
    if (closure.sourceRef.sessionKey !== sessionKey) {
      const captured = branchLineage?.ancestors.find(a => a.sessionKey === closure.sourceRef.sessionKey && a.throughSequence >= closure.sourceRef.sequence)?.snapshot.openRun?.stageClosures?.find(c => c.cycleKey === closure.cycleKey);
      if (!captured || stableProductRuntimeJsonV1(ttrpgOpenStageClosureOriginV1(captured)) !== stableProductRuntimeJsonV1(ttrpgOpenStageClosureOriginV1(closure))) fail("阶段收束不可改写已冻结祖先起源");
    }
    const refs = [closure.sourceRef, closure.terminalRef, closure.ruleSourceRef, ...closure.ticks.flatMap(t => [t.causeRef, ...(t.completedRef ? [t.completedRef] : [])]), ...closure.work.flatMap(w => [w.causeRef, ...(w.completedRef ? [w.completedRef] : []), ...(w.effectReviews?.flatMap(r => r.decisions.map(d => d.sourceRef)) ?? [])]), ...(closure.completedRef ? [closure.completedRef] : [])];
    for (const ref of refs) {
      if (ref.sessionKey === sessionKey) continue;
      const ancestor = branchLineage?.ancestors.find(a => a.sessionKey === ref.sessionKey && a.throughSequence >= ref.sequence);
      const sameRef = (r: { sessionKey: string; sequence: number }) => r.sessionKey === ref.sessionKey && r.sequence === ref.sequence;
      const captured = ancestor?.snapshot.openRun?.stageClosures?.find(c => c.cycleKey === closure.cycleKey);
      const capturedRefs = captured ? [captured.sourceRef, captured.terminalRef, captured.ruleSourceRef, ...captured.ticks.flatMap(t => [t.causeRef, ...(t.completedRef ? [t.completedRef] : [])]), ...captured.work.flatMap(w => [w.causeRef, ...(w.completedRef ? [w.completedRef] : []), ...(w.effectReviews?.flatMap(r => r.decisions.map(d => d.sourceRef)) ?? [])]), ...(captured.completedRef ? [captured.completedRef] : [])] : [];
      const terminal = sameRef(closure.terminalRef) && ancestor?.snapshot.openRun?.terminalReceipts?.some(r => sameRef(r.sourceRef));
      const rule = sameRef(closure.ruleSourceRef) && ttrpgOpenAncestorSourceAllowedV1(branchLineage, ref, ['ttrpg.rule.action.resolved']);
      if (!ancestor || !capturedRefs.some(sameRef) && !terminal && !rule) fail("阶段收束缺少真实祖先来源");
    }
  }
  for (const receipt of openRun?.narrations ?? []) {
    if (receipt.sourceRef.sessionKey !== sessionKey && !branchLineage?.ancestors.some(a => a.sessionKey === receipt.sourceRef.sessionKey && a.throughSequence >= receipt.sourceRef.sequence && a.snapshot.openRun?.narrations?.some(r => stableProductRuntimeJsonV1(r) === stableProductRuntimeJsonV1(receipt)))) fail("已采用叙述缺少真实封存祖先回执");
  }
  const acceptedSituations = openRun?.situationReceipts ?? [];
  if (new Set(acceptedSituations.map(r => r.template.templateKey)).size !== acceptedSituations.length
    || new Set(acceptedSituations.map(r => `${r.sourceRef.sessionKey}:${r.model.requestKey}`)).size !== acceptedSituations.length) fail('会话局势模板或原请求只能采用一次');
  for (const receipt of acceptedSituations) {
    if (receipt.acceptedAtWorldTurn > openRun!.worldTime.worldTurn) fail('局势采用不能来自未来世界时间');
    if (receipt.sourceRef.sessionKey !== sessionKey) {
      if (!branchLineage?.ancestors.some(a => a.sessionKey === receipt.sourceRef.sessionKey && a.throughSequence >= receipt.sourceRef.sequence
        && a.snapshot.openRun?.situationReceipts?.some(r => stableProductRuntimeJsonV1(r) === stableProductRuntimeJsonV1(receipt)))) fail('会话局势缺少切点前的真实祖先采用回执');
      continue;
    }
    const call = openRun!.coordination.calls.find(c => c.requestKey === receipt.model.requestKey);
    const epoch = openRun!.coordination.epochs.find(e => e.epochKey === receipt.model.epochKey);
    const publicAdoption = receipt.version === 2;
    if (!call || !epoch || epoch.triggerKind !== (publicAdoption ? 'request-public-situation' : 'request-situation')
      || call.skillId !== (publicAdoption ? 'prose.ttrpg-open-public-situation-propose' : 'prose.ttrpg-open-situation-propose')
      || call.status !== 'succeeded' || !call.terminalRef || call.terminalRef.sequence >= receipt.sourceRef.sequence
      || call.authorizationEpochKey !== epoch.epochKey || call.runContractHash !== receipt.model.runContractHash
      || call.responseArtifactHash !== receipt.model.rawResponseHash || call.inputManifestHash !== receipt.model.inputManifestHash
      || call.visibilityHash !== receipt.model.contextHash || call.admissionStateHash !== (receipt.version === 2 ? receipt.disclosure.authorization.admissionStateHash : receipt.model.basisHash)
      || call.runtimeSourceHash !== receipt.runtimeSourceHash || receipt.authorizationRef.sessionKey !== epoch.startedRef.sessionKey
      || receipt.authorizationRef.sequence !== epoch.startedRef.sequence || receipt.disclosure.authorizationHash !== epoch.authorizationHash
      || receipt.disclosure.viewerKey !== epoch.viewerKey || receipt.disclosure.seatKey !== epoch.triggeredBySeatKey) fail('局势采用没有原生成调用、明确披露及实际授权来源');
    if (receipt.version === 2 && stableProductRuntimeJsonV1(epoch.publicSituation) !== stableProductRuntimeJsonV1(receipt.disclosure.authorization)) fail('AI 主持采用不属于原本次共同请求委托');
    if (stableProductRuntimeJsonV1(receipt.runtimeEntityReferences ?? null) !== stableProductRuntimeJsonV1(epoch.runtimeEntityReferencePolicy?.references ?? null)) fail('已采用局势的实例引用不属于原请求冻结策略');
  }
  for (const operation of openRun?.operations ?? []) {
    const snapshot = operation.plan.discoveryPlan?.sessionSituation;
    if (snapshot && !acceptedSituations.some(r => stableProductRuntimeJsonV1(r) === stableProductRuntimeJsonV1(snapshot))) fail('发现操作没有真实会话采用的原始局势快照');
  }
  for (const cycle of [...(openRun?.situationCycles ?? []), ...(openRun?.pressureCycles ?? [])]) {
    for (const ref of cycle.sessionSituationRefs ?? []) {
      const owner = acceptedSituations.find(r => r.template.templateKey === ref.templateKey && r.receiptHash === ref.receiptHash);
      if (!owner || owner.sourceRef.sessionKey === cycle.startedRef.sessionKey && owner.sourceRef.sequence >= cycle.startedRef.sequence) fail('冻结周期缺少先前实际采用的局势定义');
    }
  }
  const memoryRevisions = new Set<string>()
  assertTtrpgOpenEntityJournalV1({ ...parsed, schema: "storyforge.ttrpg-runtime", version: 2, runFormat: "open", sessionKey, authorization, epochBudget, ...(branchLineage ? { branchLineage } : {}), openRun });
  for (const receipt of openRun?.memoryReceipts ?? []) {
    if (memoryRevisions.has(receipt.draft.revisionKey)) fail('记忆版本重复')
    memoryRevisions.add(receipt.draft.revisionKey)
    if (receipt.sourceRef.sessionKey !== sessionKey && !branchLineage?.ancestors.some(a => a.sessionKey === receipt.sourceRef.sessionKey
      && a.throughSequence >= receipt.sourceRef.sequence && a.snapshot.openRun?.memoryReceipts?.some(r => stableProductRuntimeJsonV1(r) === stableProductRuntimeJsonV1(receipt)))) fail('记忆缺少切点前的真实祖先回执')
  }
  const inheritedKnowledge = new Set(branchLineage?.ancestors.flatMap(ancestor =>
    (ancestor.snapshot.openRun?.knowledge ?? []).map(entry => stableProductRuntimeJsonV1(entry))) ?? []);
  if (openRun?.knowledge.some(entry => entry.acquisitionRef.sessionKey !== sessionKey
    && (!ttrpgOpenAncestorSourceAllowedV1(branchLineage, entry.acquisitionRef)
      || !inheritedKnowledge.has(stableProductRuntimeJsonV1(entry))))) fail("knowledge 缺少精确祖先授予证据");
  if (openRun) {
    if (openRun.knowledgeShares) {
      const inheritedShares = new Set(branchLineage?.ancestors.flatMap(ancestor =>
        (ancestor.snapshot.openRun?.knowledgeShares ?? []).map(receipt => stableProductRuntimeJsonV1(receipt))) ?? []);
      if (new Set(openRun.knowledgeShares.map(receipt => receipt.knowledge.knowledgeKey)).size !== openRun.knowledgeShares.length
        || openRun.knowledgeShares.some(receipt => {
          const source = openRun.knowledge.find(entry => entry.knowledgeKey === receipt.sourceKnowledgeKey);
          return !source || stableProductRuntimeJsonV1(source.acquisitionRef) !== stableProductRuntimeJsonV1(receipt.sourceAcquisitionRef)
            || !openRun.knowledge.some(entry => stableProductRuntimeJsonV1(entry) === stableProductRuntimeJsonV1(receipt.knowledge))
            || (source.acquisitionRef.sessionKey === receipt.knowledge.acquisitionRef.sessionKey && source.acquisitionRef.sequence >= receipt.knowledge.acquisitionRef.sequence)
            || (receipt.knowledge.acquisitionRef.sessionKey === sessionKey
              ? !authorization || !openRun.coordination.epochs.some(epoch => epoch.epochKey === receipt.authorizationEpochKey && epoch.viewerKey === receipt.viewerKey
                && receipt.knowledge.acquisitionRef.sequence > epoch.startedRef.sequence
                && (epoch.closedRef === null || receipt.knowledge.acquisitionRef.sequence < epoch.closedRef.sequence))
              : !ttrpgOpenAncestorSourceAllowedV1(branchLineage, receipt.knowledge.acquisitionRef, [receipt.knowledge.identityGrant ? 'ttrpg.open.knowledge.identity-shared' : 'ttrpg.open.knowledge.shared'])
                || !inheritedShares.has(stableProductRuntimeJsonV1(receipt)));
        })) fail("知识分享缺少真实获得记录、窗口或精确祖先事件");
    }
    assertTtrpgOpenOracleReviewJournalV1({ sessionKey, authorization, openRun, branchLineage });
    const seenOracleRefs = new Set<string>();
    const assistedTurns = new Set<number>(branchLineage?.ancestors.flatMap(ancestor =>
      ancestor.snapshot.openRun?.coordination.calls.flatMap(call => call.supportSlot ? [call.supportSlot.worldTurn] : []) ?? []) ?? []);
    for (const call of openRun.coordination.calls) {
      if (!call.supportSlot) continue;
      assertTtrpgOpenNormalizationSourceV1({ openRun, sessionKey, branchLineage, product: parsed.product },call);
      if (call.supportSlot.worldTurn > openRun.worldTime.worldTurn || assistedTurns.has(call.supportSlot.worldTurn)) fail("每世界轮辅助槽最多一次，且不得来自未来");
      assistedTurns.add(call.supportSlot.worldTurn);
    }
    const interpretedTurns = new Set<number>(branchLineage?.ancestors.flatMap(ancestor =>
      ancestor.snapshot.openRun?.coordination.calls.flatMap(call => call.oracleInterpretation ? [call.oracleInterpretation.worldTurn] : []) ?? []) ?? []);
    for (const call of openRun.coordination.calls) {
      assertTtrpgOpenOracleRuntimeCallOriginV1({ openRun, product: parsed.product }, call);
      if (!call.oracleInterpretation) continue;
      const marker = call.oracleInterpretation;
      if (marker.worldTurn > openRun.worldTime.worldTurn || interpretedTurns.has(marker.worldTurn)
        || !openRun.oracleReceipts?.some(receipt => stableProductRuntimeJsonV1(receipt.sourceRef) === stableProductRuntimeJsonV1(marker.oracleSourceRef)
          && (receipt.sourceRef.sessionKey !== call.createdRef.sessionKey || receipt.sourceRef.sequence < call.createdRef.sequence))) {
        fail("Oracle 解释槽位必须绑定真实咨询，且每个世界轮最多一次");
      }
      interpretedTurns.add(marker.worldTurn);
    }
    const previousByOracle = new Map<string, string>();
    const inheritedOracles = new Set(branchLineage?.ancestors.flatMap(ancestor =>
      (ancestor.snapshot.openRun?.oracleReceipts ?? []).map(receipt => stableProductRuntimeJsonV1(receipt))) ?? []);
    for (const receipt of openRun.oracleReceipts ?? []) {
      const ref = stableProductRuntimeJsonV1(receipt.sourceRef);
      const oracleKey = receipt.resolution.outcome.oracleKey;
      if (seenOracleRefs.has(ref) || receipt.resolution.rollReceipt.rulePackContentHash !== parsed.product.rulePackContentHash
        || stableProductRuntimeJsonV1(receipt.previousOracleRef) !== (previousByOracle.get(oracleKey) ?? "null")
        || (receipt.sourceRef.sessionKey !== sessionKey && (!branchLineage
          || !ttrpgOpenAncestorSourceAllowedV1(branchLineage, receipt.sourceRef, ['ttrpg.oracle.consulted'])
          || !inheritedOracles.has(stableProductRuntimeJsonV1(receipt))))
        || (receipt.sourceRef.sessionKey === sessionKey && !openRun.coordination.epochs.some(epoch =>
          epoch.epochKey === receipt.authorizationEpochKey && epoch.viewerKey === receipt.viewerKey
          && receipt.sourceRef.sequence > epoch.startedRef.sequence
          && (epoch.closedRef === null || receipt.sourceRef.sequence < epoch.closedRef.sequence)))) fail("Oracle 回执来源/前序/授权窗口不闭合");
      seenOracleRefs.add(ref); previousByOracle.set(oracleKey, ref);
    }
    if (openRun.oracleReceipts && (openRun.oracleReceipts.some(receipt => receipt.worldTurn > openRun.worldTime.worldTurn)
      || openRun.consultedThisWorldTurn !== openRun.oracleReceipts.filter(receipt => receipt.worldTurn === openRun.worldTime.worldTurn).length
      || openRun.consultedThisWorldTurn > 2)) fail("Oracle 本世界轮咨询额度必须由真实结果派生");
    if (openRun.factLedger) {
      const ledger = openRun.factLedger;
      const inheritedFacts = new Set(branchLineage?.ancestors.flatMap(ancestor =>
        (ancestor.snapshot.openRun?.factLedger?.entries ?? []).map(entry => stableProductRuntimeJsonV1(entry))) ?? []);
      const inheritedRetirements = new Set(branchLineage?.ancestors.flatMap(ancestor =>
        (ancestor.snapshot.openRun?.factLedger?.retirements ?? []).map(entry => stableProductRuntimeJsonV1(entry))) ?? []);
      const currentEpochAllows = (entry: { sourceRef: { sessionKey: string; sequence: number }; viewerKey: string; authorizationEpochKey: string }) =>
        authorization !== null && openRun.coordination.epochs.some(epoch => epoch.epochKey === entry.authorizationEpochKey
          && epoch.viewerKey === entry.viewerKey && entry.sourceRef.sequence > epoch.startedRef.sequence
          && (epoch.closedRef === null || entry.sourceRef.sequence < epoch.closedRef.sequence));
      const factSourceAuthorityAllows = (entry: typeof ledger.entries[number]) => {
        const sourceAuthority = entry.sourceRef.sessionKey === sessionKey ? authorization
          : branchLineage?.ancestors.find(ancestor => ancestor.sessionKey === entry.sourceRef.sessionKey)?.snapshot.authorization;
        const sourceSeat = sourceAuthority?.seats.find(seat => seat.viewerKey === entry.viewerKey);
        if (entry.modelCandidate && sourceAuthority) {
          assertTtrpgOpenModelFactApproverV1(sourceAuthority, entry.viewerKey);
          const sourceCalls = entry.sourceRef.sessionKey === sessionKey ? openRun.coordination.calls
            : branchLineage?.ancestors.find(ancestor => ancestor.sessionKey === entry.sourceRef.sessionKey)?.snapshot.openRun?.coordination.calls ?? [];
          assertTtrpgOpenFactModelCallV1(entry, sourceCalls);
        }
        return sourceAuthority !== null && sourceAuthority !== undefined && (entry.modelCandidate !== undefined || sourceSeat?.role === "gm")
          && sourceSeat?.controller !== "ai" && sourceSeat?.assignmentState === "claimed"
          && !entry.fact.knownBy.some(actorKey => !sourceAuthority.selectedActorKeys.includes(actorKey))
          && (entry.fact.audience !== "party" || stableProductRuntimeJsonV1([...entry.fact.knownBy].sort())
            === stableProductRuntimeJsonV1([...sourceAuthority.selectedActorKeys].sort()));
      };
      if (ledger.basis.rulePackContentHash !== parsed.product.rulePackContentHash
        || new Set(ledger.entries.map(entry => stableProductRuntimeJsonV1([entry.sourceRef, entry.modelCandidate?.reviewHash ? entry.modelCandidate.proposalIndex : null]))).size !== ledger.entries.length
        || ledger.entries.some(entry => !factSourceAuthorityAllows(entry)
          || !openRun.oracleReceipts?.some(oracle => stableProductRuntimeJsonV1(oracle.sourceRef) === stableProductRuntimeJsonV1(entry.oracleSourceRef))
          || (entry.sourceRef.sessionKey === sessionKey ? !currentEpochAllows(entry)
            : !ttrpgOpenAncestorSourceAllowedV1(branchLineage, entry.sourceRef, ['ttrpg.fact.asserted', 'ttrpg.open.oracle.reviewed']) || !inheritedFacts.has(stableProductRuntimeJsonV1(entry))))
        || ledger.retirements.some(entry => entry.sourceRef.sessionKey === sessionKey ? !currentEpochAllows(entry)
          : !ttrpgOpenAncestorSourceAllowedV1(branchLineage, entry.sourceRef, ['ttrpg.fact.asserted', 'ttrpg.fact.retired', 'ttrpg.open.oracle.reviewed']) || !inheritedRetirements.has(stableProductRuntimeJsonV1(entry)))) {
        fail("事实账本缺少冻结来源、真实 Oracle、授权窗口或精确祖先事件");
      }
    }
  }
  if (openRun && authorization) {
    for (const operation of openRun.operations) assertTtrpgOpenOperationIntentCallV1(operation, openRun.coordination.calls)
    if (openRun.knowledge.some(entry => entry.acquisitionRef.sessionKey === sessionKey
      && entry.recipientActorKeys.some(actorKey => !authorization.seats.some(seat => seat.role === "player" && seat.actorKey === actorKey)))) fail("knowledge 身份/来源不闭合");
    if (new Set(openRun.operations.map(operation => operation.operationKey)).size !== openRun.operations.length
      || new Set(openRun.ruleReceipts.map(receipt => receipt.operationKey)).size !== openRun.ruleReceipts.length
      || openRun.operations.filter(operation => ["awaiting-approval", "executing"].includes(operation.status)).length > 1
      || openRun.operations.some(operation => operation.plan.epochKey !== operation.authorizationEpochKey
        || !openRun.coordination.epochs.some(epoch => epoch.epochKey === operation.authorizationEpochKey && !isTtrpgOpenPassiveEpochV1(epoch)))
      || openRun.ruleReceipts.some(receipt => receipt.sourceRef.sessionKey !== sessionKey
        || !openRun.operations.some(operation => operation.operationKey === receipt.operationKey && operation.planHash === receipt.frozenPlanHash))) {
      fail("operation 身份/epoch/规则回执不一致");
    }
    for (const epoch of openRun.coordination.epochs) {
      const seat = authorization.seats.find(item => item.seatKey === epoch.triggeredBySeatKey && item.viewerKey === epoch.viewerKey);
      if (epoch.hostingDelegation && stableProductRuntimeJsonV1(epoch.hostingDelegation.authorizationRef) !== stableProductRuntimeJsonV1(authorization.sourceRef)) fail('有限主持委托未绑定本桌真实 Session Zero')
      if (!seat || seat.controller === "ai" || seat.assignmentState !== "claimed"
        || epoch.sessionZeroRevision !== authorization.revision
        || stableProductRuntimeJsonV1(epoch.budget) !== stableProductRuntimeJsonV1(ttrpgOpenEpochBudgetForTriggerV1(epochBudget, epoch.triggerKind, Boolean(epoch.commonOracle || epoch.oracleRuntimeReferencePolicy || epoch.normalizationRuntimeReferencePolicy)))
        || epoch.successfulActorKeys.length > epoch.budget.maximumAiActions
        || epoch.successfulActorKeys.some(actorKey => !authorization.seats.some(item => item.actorKey === actorKey && item.role === "player" && item.controller !== "human"))) {
        fail("epoch 与冻结预算、Session Zero 或队友控制权不一致");
      }
    }
    for (const operation of openRun.operations) {
      if (!operation.inheritance) continue;
      const receipt = openRun.ruleReceipts.find(receipt => receipt.operationKey === operation.operationKey);
      if (!branchLineage || !receipt) fail("继承操作缺少祖先与真实裁定");
      assertTtrpgOpenRecoveredOperationV1({ lineage: branchLineage, authorization, operation, receipt, mode: "stored" });
    }
  }
  const result: TtrpgRuntimeStateV2 = {
    ...parsed,
    schema: "storyforge.ttrpg-runtime",
    version: 2,
    runFormat: "open",
    sessionKey,
    authorization,
    epochBudget,
    openRun,
    ...(branchLineage ? { branchLineage } : {}),
  };
  assertTtrpgOpenTableMessageHistoryV1(result);
  assertTtrpgOpenAudioJournalV1(result);
  assertTtrpgOpenVoiceJournalV1(result);
  assertTtrpgOpenIdentityKnowledgeJournalV1(result);
  assertTtrpgOpenPressureHistoryV1(result);
  assertTtrpgOpenSituationCycleHistoryV1(result);
  return result;
}

function openClock(
  clock: TtrpgOpenCampaignClockV1,
): TtrpgOpenClockRuntimeStateV1 {
  return {
    clockKey: clock.clockKey,
    title: clock.title,
    value: clock.initialValue,
    maximum: clock.maximum,
    visibility: clock.visibility,
    completed: clock.initialValue >= clock.maximum,
    lastAdvancedWorldTurn: null,
  };
}

function openFront(
  front: TtrpgOpenCampaignFrontV1,
): TtrpgOpenFrontRuntimeStateV1 {
  return {
    frontKey: front.frontKey,
    title: front.title,
    stageKey: null,
    defeated: false,
    telegraphedStageKeys: [],
    lastEvaluatedWorldTurn: null,
  };
}

function companionController(
  character: TtrpgCampaignContentV2["characterTemplates"][number],
): TtrpgOpenCompanionRuntimeStateV1 {
  return {
    actorKey: character.characterKey,
    controller: character.controller,
    consecutiveActions: 0,
  };
}

export function createTtrpgOpenRunStateV1(
  campaign: TtrpgCampaignContentV2,
): TtrpgOpenRunStateV1 {
  const companions = campaign.characterTemplates
    .filter((character) => character.role === "player")
    .map(companionController);
  return {
    schema: "storyforge.ttrpg-open-runtime",
    version: 1,
    runFormat: "open",
    worldTime: createTtrpgWorldTimeV1(),
    chaos: { value: 5 },
    clocks: campaign.clocks.map(openClock),
    fronts: campaign.fronts.map(openFront),
    companions,
    gates: [],
    failures: [],
    situations: {
      active: [],
      queued: [],
      cooldowns: {},
    },
    stage: {
      status: "open",
      openedAtWorldTurn: 0,
      closedAtWorldTurn: null,
    },
    consultedThisWorldTurn: 0,
    coordination: { activeEpochKey: null, epochs: [], calls: [] },
    operations: [],
    ruleReceipts: [], knowledge: [],
  };
}

export function advanceOpenWorldTimeV1(
  state: TtrpgOpenRunStateV1,
  reason: TtrpgWorldTimeAdvanceReason,
  byEventSequence: number,
): TtrpgOpenRunStateV1 {
  const nextWorldTime = advanceTtrpgWorldTimeV1({
    worldTime: state.worldTime,
    reason,
    byEventSequence,
  });
  return {
    ...structuredClone(state),
    worldTime: nextWorldTime,
  };
}
