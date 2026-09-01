import Dexie from "dexie";
import { db } from "../db/schema";
import { transactionTablesForReferenceCascade } from "../registry/lifecycle";
import { cascadeRegisteredReferences } from "../world-engine/lifecycle";
import {
  EMPTY_SIMULATION_STATE,
  NARRATIVE_MODULE_KINDS,
  NARRATIVE_BEAT_KINDS,
  NARRATIVE_NODE_KINDS,
  RUNTIME_ENTITY_KINDS,
  RUNTIME_LIFECYCLE_STATUSES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_SESSION_KINDS,
  type RuntimeAttributes,
  type RuntimeEntityState,
  type RuntimeMemory,
  type FrozenNarrativeBeat,
  type FrozenNarrativeChoice,
  type GameBuildRecordV1,
  type GameProductionBriefRecordV1,
  type GameProductionRecordV1,
  type GameRelease,
  type GameRuntimePackageV2,
  type TextOpenWorldGameRuntimePackageV2,
  type NarrativeChoiceHistoryEntry,
  type SimulationCheckpoint,
  type SimulationEvent,
  type SimulationEventType,
  type SimulationNpcEvolutionCandidate,
  type SimulationNpcEvolutionProposal,
  type SimulationNarrativeNodeSnapshot,
  type SimulationNarrativeState,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type SimulationTtrpgAction,
  type SimulationTtrpgAttackResult,
  type SimulationTtrpgCheck,
  type SimulationTtrpgCheckRequest,
  type SimulationTtrpgCombatant,
  type SimulationTtrpgCondition,
  type SimulationTtrpgCampaignState,
  type SimulationTtrpgCampaignMemoryV2,
  type SimulationTtrpgCampaignSessionV2,
  type InteractionMemoryKind,
  type SimulationTtrpgEncounter,
  type SimulationTtrpgEncounterCandidate,
  type SimulationTtrpgModelEvidenceV1,
  type SimulationTtrpgNpcSchedule,
  type SimulationTtrpgRosterEntryV2,
  type SimulationTtrpgRestReceiptV2,
  type SimulationTtrpgIntentReceiptV2,
  type SimulationTtrpgHumanResponseV2,
  type SimulationTtrpgItemReceiptV2,
  type SimulationTtrpgSupplementReceiptV2,
  type SimulationTtrpgQuest,
  SIMULATION_TTRPG_QUEST_STATUSES,
  type SimulationTtrpgQuestStatus,
  type SimulationTtrpgResource,
  type SimulationTtrpgScene,
  type SimulationTtrpgState,
  type SimulationTtrpgTabletopStateV1,
  type SimulationTtrpgTurnCandidate,
  type TtrpgCharacterSheetV2,
  type TtrpgCampaignContentV1,
  type TtrpgDegreeV2,
  type TtrpgRuntimeAssetRequestRecordV1,
  type SimulationTtrpgVersionTransitionV2,
  type SimulationTtrpgWorldEvolutionV2,
} from "../types";
import {
  applyInteractionEvent,
  createInitialInteractionState,
  parseInteractionState,
  rebaseInteractionStateForBranch,
} from "../character-interaction/runtime";
import {
  applyAdventureEffects,
  applyAdventureEvent,
  adventureNarrativeProjection,
  availableAdventureActions,
  createInitialAdventureState,
  parseAdventureState,
} from "../adventure/runtime";
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
} from "../narrative/blueprint";
import {
  applyNarrativeChoiceEffects,
  evaluateNarrativeChoices,
} from "../text-game/content";
import {
  assertGameReleaseUnchanged,
} from "../text-game/releases";
import {
  verifyGameReleaseManifestV2,
} from "../game-production/runtime-package";
import {
  verifyPlayableGamePackageSource,
  verifyPlayableSessionPackageV2,
} from "../game-production/preview-source";
import {
  applyAvgPresentationEvent,
  createInitialAvgPresentationState,
  parseAvgPresentationState,
} from "../avg/runtime";
import {
  applyNarrativeSimulationEvent,
  createInitialNarrativeSimulationState,
  narrativeSimulationProjection,
  parseNarrativeSimulationState,
  planNarrativeSimulationTurn,
  rebaseNarrativeSimulationStateForBranch,
} from "../narrative-simulation/runtime";
import {
  applyOpenWorldEvent,
  createInitialOpenWorldState,
  openWorldMainlineProjection,
  parseOpenWorldState,
  planOpenWorldDraw,
  planOpenWorldQuestDecision,
  planOpenWorldTick,
  planOpenWorldTravel,
  rebaseOpenWorldStateForBranch,
} from "../open-world/runtime";
import { assertInitialTtrpgProductStateV1 } from "../ttrpg/runtime";
import {
  evaluateRuleNumberExpressionV1,
  parseRulePackV1,
  resolveRulePackCheckV1,
  resolveRulePackDiceModelV1,
  type RuleCheckResolutionV1,
} from "../ttrpg/rule-pack";
import { parseTtrpgCampaignContentV1 } from "../ttrpg/campaign";
import {
  assertTtrpgDiceRollTraceV2,
  parseTtrpgDiceExpressionV2,
  sampleTtrpgDiceFromUint32V2,
} from "../ttrpg/dice";
import {
  parseTtrpgActionEconomyV2,
  spendTtrpgActionEconomyV2,
  startTtrpgActionEconomySceneV2,
} from "../ttrpg/action-economy";
import {
  applyTtrpgItemCommandV2,
  parseTtrpgInventoryStateV2,
  parseTtrpgItemCommandV2,
  ttrpgItemDefinitionFromRuleV1,
} from "../ttrpg/item-ledger";
import {
  parseTtrpgAbilityRuntimeStateV2,
  parseTtrpgUsagePoolStateV2,
  ttrpgAbilityStateKeyV2,
  resetTtrpgAbilityUsageV2,
  consumeTtrpgAbilityV2,
} from "../ttrpg/ability-ledger";
import {
  applyTtrpgEffectPlanToRuntimeV2,
  parseTtrpgEffectLedgerStateV2,
  proposeTtrpgEffectChoiceToRuntimeV2,
  resolveTtrpgEffectChoiceToRuntimeV2,
} from "../ttrpg/effect-runtime";
import {
  assertTtrpgFeedbackOutcomeConsistentV2,
  createDeterministicGmSynthesisFrameV2,
  createTtrpgActionReceiptV2,
  parseTtrpgActionReceiptV2,
  parseTtrpgGmSynthesisFrameV2,
} from "../ttrpg/action-feedback";
import {
  cloneTtrpgSessionParticipantsV2,
  finalizeTtrpgSessionParticipantsV2,
  readTtrpgSessionParticipantsV2,
} from "../ttrpg/participants";
import { parseTtrpgEffectPlanV2 } from "../ttrpg/effect-plan";
import { createCompleteTtrpgCharacterSheetV2 } from "../ttrpg/character-sheet";
import {
  availableTtrpgCharacterCurrencyV2,
  earnedTtrpgCharacterCurrencyV2,
} from "../ttrpg/advancement";
import { evaluateTtrpgActionRequirementsV2 } from "../ttrpg/action-requirement";
import { isFormalProductSessionKindV1 } from "../product/runtime-boundary";

type JsonObject = Record<string, unknown>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export interface CreateSimulationSessionInput {
  projectId: number;
  worldGroupId?: number | null;
  kind: SimulationSessionKind;
  title: string;
  seed?: string;
  canonSnapshot?: unknown;
  initialState?: SimulationRuntimeState;
}

export interface CreateReleasedGameSessionInput extends CreateSimulationSessionInput {
  worldId: number;
  workId: number;
  gameReleaseId: number;
  /** New games must match the release entry state; validated branches preserve a replayed mid-game state. */
  origin: "release" | "branch";
}

export interface CreatePreviewGameSessionInput extends CreateSimulationSessionInput {
  worldId: number;
  workId: number;
  gameBuildId: number;
  expectedPreviewHash: string;
  runtimeSourceHash: string;
  /** New previews start at entry; branches preserve an already replayed state. */
  origin: "preview" | "branch";
}

export interface DiceResolution {
  expression: string;
  dice: number[];
  modifier: number;
  total: number;
  nonce: string;
}

function isObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value: string, label: string): JsonObject {
  try {
    const parsed = JSON.parse(value);
    if (!isObject(parsed)) throw new Error(`${label} 必须是 JSON 对象。`);
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.message.endsWith("必须是 JSON 对象。"))
      throw error;
    throw new Error(`${label} 不是合法 JSON。`);
  }
}

function assertFiniteInteger(
  value: unknown,
  label: string,
  min: number,
  max: number,
): number {
  if (!Number.isInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} 必须是 ${min}..${max} 的整数。`);
  }
  return Number(value);
}

function narrativeKeyArray(
  value: unknown,
  label: string,
  keys?: Set<string>,
  allowDuplicates = false,
): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  const result = value.map((item) => String(item).trim());
  if (
    result.some((item) => !item || item.length > 200) ||
    (!allowDuplicates && new Set(result).size !== result.length)
  ) {
    throw new Error(`${label} 包含空值、超长值或重复值。`);
  }
  if (keys && result.some((item) => !keys.has(item)))
    throw new Error(`${label} 引用了不存在的叙事节点。`);
  return result;
}

function narrativeTextArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} 必须是数组。`);
  const result = value.map((item) => String(item).trim());
  if (
    result.some((item) => !item || item.length > 100) ||
    new Set(result).size !== result.length
  ) {
    throw new Error(`${label} 包含空值、超长值或重复值。`);
  }
  return result;
}

function parseFrozenNarrativeBeat(
  value: unknown,
  nodeKeys: Set<string>,
): FrozenNarrativeBeat {
  if (!isObject(value)) throw new Error("冻结 Beat 必须是对象。");
  const beatKey = String(value.beatKey ?? "").trim();
  const nodeKey = String(value.nodeKey ?? "").trim();
  const kind = String(value.kind ?? "");
  const speakerKey =
    value.speakerKey == null ? null : String(value.speakerKey).trim();
  const text = String(value.text ?? "");
  if (!beatKey || beatKey.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(beatKey))
    throw new Error("冻结 Beat key 无效。");
  if (!nodeKeys.has(nodeKey))
    throw new Error(`冻结 Beat 节点不存在: ${beatKey}`);
  if (!NARRATIVE_BEAT_KINDS.includes(kind as FrozenNarrativeBeat["kind"]))
    throw new Error(`冻结 Beat 类型无效: ${beatKey}`);
  if (kind === "dialogue" && !speakerKey)
    throw new Error(`冻结对话 Beat 缺少 speaker: ${beatKey}`);
  if (!text.trim() || text.length > 40_000)
    throw new Error(`冻结 Beat 文本无效: ${beatKey}`);
  return {
    beatKey,
    nodeKey,
    kind: kind as FrozenNarrativeBeat["kind"],
    speakerKey,
    text,
    order: assertFiniteInteger(
      value.order,
      `${beatKey}.order`,
      -1_000_000,
      1_000_000,
    ),
  };
}

function parseFrozenNarrativeChoice(
  value: unknown,
  nodeKeys: Set<string>,
): FrozenNarrativeChoice {
  if (!isObject(value)) throw new Error("冻结 Choice 必须是对象。");
  const choiceKey = String(value.choiceKey ?? "").trim();
  const sourceNodeKey = String(value.sourceNodeKey ?? "").trim();
  const targetNodeKey = String(value.targetNodeKey ?? "").trim();
  const text = String(value.text ?? "");
  const description = String(value.description ?? "");
  const unavailableReason = String(value.unavailableReason ?? "");
  const displayConditionJson = String(value.displayConditionJson ?? "{}");
  const availableConditionJson = String(value.availableConditionJson ?? "{}");
  const effectsJson = String(value.effectsJson ?? "[]");
  if (
    !choiceKey ||
    choiceKey.length > 200 ||
    !/^[a-zA-Z0-9._:-]+$/.test(choiceKey)
  )
    throw new Error("冻结 Choice key 无效。");
  if (!nodeKeys.has(sourceNodeKey) || !nodeKeys.has(targetNodeKey))
    throw new Error(`冻结 Choice 节点不存在: ${choiceKey}`);
  if (
    !text.trim() ||
    text.length > 4_000 ||
    description.length > 20_000 ||
    unavailableReason.length > 4_000
  ) {
    throw new Error(`冻结 Choice 内容无效: ${choiceKey}`);
  }
  parseNarrativeCondition(displayConditionJson);
  parseNarrativeCondition(availableConditionJson);
  parseNarrativeEffects(effectsJson);
  const tags = narrativeTextArray(value.tags, `${choiceKey}.tags`);
  return {
    choiceKey,
    sourceNodeKey,
    text,
    description,
    unavailableReason,
    targetNodeKey,
    displayConditionJson,
    availableConditionJson,
    effectsJson,
    tags,
    order: assertFiniteInteger(
      value.order,
      `${choiceKey}.order`,
      -1_000_000,
      1_000_000,
    ),
  };
}

function parseSimulationNarrativeNode(
  value: unknown,
): SimulationNarrativeNodeSnapshot {
  if (!isObject(value)) throw new Error("冻结叙事节点必须是对象。");
  const key = String(value.key ?? "").trim();
  const kind = String(value.kind ?? "");
  const title = String(value.title ?? "").trim();
  const summary = String(value.summary ?? "").trim();
  const conditionJson = String(value.conditionJson ?? "{}");
  const effectsJson = String(value.effectsJson ?? "[]");
  if (!key || key.length > 200 || !/^[a-zA-Z0-9._:-]+$/.test(key))
    throw new Error("冻结叙事节点 key 无效。");
  if (
    !NARRATIVE_NODE_KINDS.includes(
      kind as (typeof NARRATIVE_NODE_KINDS)[number],
    )
  )
    throw new Error(`冻结叙事节点类型无效: ${kind}`);
  if (!title || title.length > 500 || summary.length > 20_000)
    throw new Error(`冻结叙事节点内容无效: ${key}`);
  parseNarrativeCondition(conditionJson);
  parseNarrativeEffects(effectsJson);
  return {
    key,
    kind: kind as SimulationNarrativeNodeSnapshot["kind"],
    title,
    summary,
    conditionJson,
    effectsJson,
    successorKeys: narrativeKeyArray(
      value.successorKeys,
      `${key}.successorKeys`,
    ),
  };
}

function parseSimulationNarrativeState(
  value: unknown,
): SimulationNarrativeState | null {
  if (value == null) return null;
  if (
    !isObject(value) ||
    value.schema !== "storyforge.simulation-narrative" ||
    value.version !== 2
  ) {
    throw new Error("不支持的冻结叙事状态。");
  }
  if (
    !Array.isArray(value.nodes) ||
    value.nodes.length === 0 ||
    value.nodes.length > 5_000
  ) {
    throw new Error("冻结叙事必须包含 1..5000 个节点。");
  }
  const nodes = value.nodes.map(parseSimulationNarrativeNode);
  const keys = new Set(nodes.map((node) => node.key));
  if (keys.size !== nodes.length)
    throw new Error("冻结叙事节点 key 不能重复。");
  for (const node of nodes) {
    if (node.successorKeys.some((key) => !keys.has(key)))
      throw new Error(`冻结叙事节点 ${node.key} 存在悬空后继。`);
  }
  const moduleKind = String(value.moduleKind ?? "");
  const moduleTitle = String(value.moduleTitle ?? "").trim();
  const sourceHash = String(value.sourceHash ?? "").trim();
  if (
    !NARRATIVE_MODULE_KINDS.includes(
      moduleKind as (typeof NARRATIVE_MODULE_KINDS)[number],
    )
  )
    throw new Error("冻结叙事模块类型无效。");
  if (
    !moduleTitle ||
    moduleTitle.length > 500 ||
    !sourceHash ||
    sourceHash.length > 128
  )
    throw new Error("冻结叙事模块身份无效。");
  const currentNodeKey =
    value.currentNodeKey == null ? null : String(value.currentNodeKey).trim();
  if (currentNodeKey != null && !keys.has(currentNodeKey))
    throw new Error("冻结叙事当前节点不存在。");
  if (!isObject(value.variables)) throw new Error("冻结叙事变量必须是对象。");
  if (typeof value.completed !== "boolean")
    throw new Error("冻结叙事完成状态无效。");
  const common = {
    schema: "storyforge.simulation-narrative" as const,
    version: 2 as const,
    moduleKind: moduleKind as SimulationNarrativeState["moduleKind"],
    moduleTitle,
    sourceHash,
    nodes,
    currentNodeKey,
    visitedNodeKeys: narrativeKeyArray(
      value.visitedNodeKeys,
      "叙事已访问节点",
      keys,
      true,
    ),
    availableNodeKeys: narrativeKeyArray(
      value.availableNodeKeys,
      "叙事可选节点",
      keys,
    ),
    variables: structuredClone(value.variables),
    completed: value.completed,
  };
  const contentHash = String(value.contentHash ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(contentHash))
    throw new Error("冻结游戏发布身份无效。");
  if (!Array.isArray(value.beats) || value.beats.length > 50_000)
    throw new Error("冻结 Beat 列表无效。");
  if (!Array.isArray(value.choices) || value.choices.length > 50_000)
    throw new Error("冻结 Choice 列表无效。");
  const beats = value.beats.map((beat) => parseFrozenNarrativeBeat(beat, keys));
  const choices = value.choices.map((choice) =>
    parseFrozenNarrativeChoice(choice, keys),
  );
  const choiceKeys = new Set(choices.map((choice) => choice.choiceKey));
  if (choiceKeys.size !== choices.length)
    throw new Error("冻结 Choice key 不能重复。");
  const visibleChoiceKeys = narrativeKeyArray(
    value.visibleChoiceKeys,
    "可见 Choice",
  );
  const availableChoiceKeys = narrativeKeyArray(
    value.availableChoiceKeys,
    "可用 Choice",
  );
  if (
    visibleChoiceKeys.some((key) => !choiceKeys.has(key)) ||
    availableChoiceKeys.some((key) => !choiceKeys.has(key))
  ) {
    throw new Error("冻结叙事 Choice 状态引用不存在。");
  }
  if (availableChoiceKeys.some((key) => !visibleChoiceKeys.includes(key)))
    throw new Error("可用 Choice 必须可见。");
  if (!Array.isArray(value.choiceHistory))
    throw new Error("冻结叙事选择历史必须是数组。");
  const choiceHistory: NarrativeChoiceHistoryEntry[] = value.choiceHistory.map(
    (raw) => {
      if (!isObject(raw)) throw new Error("冻结叙事选择历史记录无效。");
      const choiceKey = String(raw.choiceKey ?? "").trim();
      const fromNodeKey = String(raw.fromNodeKey ?? "").trim();
      const toNodeKey = String(raw.toNodeKey ?? "").trim();
      if (
        !choiceKeys.has(choiceKey) ||
        !keys.has(fromNodeKey) ||
        !keys.has(toNodeKey)
      ) {
        throw new Error("冻结叙事选择历史引用不存在。");
      }
      return {
        eventSequence: assertFiniteInteger(
          raw.eventSequence,
          "选择事件序号",
          1,
          Number.MAX_SAFE_INTEGER,
        ),
        choiceKey,
        fromNodeKey,
        toNodeKey,
      };
    },
  );
  const endingKey =
    value.endingKey == null ? null : String(value.endingKey).trim();
  if (endingKey != null && !keys.has(endingKey))
    throw new Error("冻结叙事结局节点不存在。");
  const completedAtSequence =
    value.completedAtSequence == null
      ? null
      : assertFiniteInteger(
          value.completedAtSequence,
          "叙事完成事件序号",
          0,
          Number.MAX_SAFE_INTEGER,
        );
  if (
    value.completed !== (endingKey != null) ||
    (value.completed && completedAtSequence == null)
  ) {
    throw new Error("冻结叙事完成状态不一致。");
  }
  const lastEnteredNodeSequence =
    value.lastEnteredNodeSequence == null
      ? null
      : assertFiniteInteger(
          value.lastEnteredNodeSequence,
          "最后节点进入序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  const evaluations =
    currentNodeKey == null || value.completed
      ? []
      : evaluateNarrativeChoices(
          {
            ...common.variables,
            __visitedNodeKeys: common.visitedNodeKeys,
            __selectedChoiceKeys: choiceHistory.map((item) => item.choiceKey),
          },
          currentNodeKey,
          choices,
        );
  const expectedVisible = evaluations
    .filter((choice) => choice.visible)
    .map((choice) => choice.choiceKey);
  const expectedAvailable = evaluations
    .filter((choice) => choice.available)
    .map((choice) => choice.choiceKey);
  if (
    JSON.stringify(visibleChoiceKeys) !== JSON.stringify(expectedVisible) ||
    JSON.stringify(availableChoiceKeys) !== JSON.stringify(expectedAvailable)
  ) {
    throw new Error("冻结叙事 Choice 投影与变量状态不一致。");
  }
  return {
    ...common,
    contentHash,
    beats,
    choices,
    visibleChoiceKeys,
    availableChoiceKeys,
    choiceHistory,
    endingKey,
    completedAtSequence,
    lastEnteredNodeSequence,
  };
}

export function enterFrozenNarrativeNode(
  narrative: SimulationNarrativeState,
  targetKey: string,
  options: {
    variables?: Record<string, unknown>;
    eventSequence?: number;
    selectedChoiceKey?: string;
  } = {},
): SimulationNarrativeState {
  const target = narrative.nodes.find((node) => node.key === targetKey);
  if (!target) throw new Error(`冻结叙事节点不存在: ${targetKey}`);
  const sourceVariables = options.variables ?? narrative.variables;
  const predicateVariables = {
    ...sourceVariables,
    __visitedNodeKeys: narrative.visitedNodeKeys,
    __selectedChoiceKeys: [
      ...(narrative.choiceHistory ?? []).map((item) => item.choiceKey),
      ...(options.selectedChoiceKey ? [options.selectedChoiceKey] : []),
    ],
  };
  if (
    !evaluateNarrativeCondition(
      parseNarrativeCondition(target.conditionJson),
      predicateVariables,
    )
  ) {
    throw new Error(`冻结叙事节点条件未满足: ${targetKey}`);
  }
  const variables = applyNarrativeEffects(
    parseNarrativeEffects(target.effectsJson),
    sourceVariables,
  );
  const choiceVariables = {
    ...variables,
    __visitedNodeKeys: [...narrative.visitedNodeKeys, targetKey],
    __selectedChoiceKeys: predicateVariables.__selectedChoiceKeys,
  };
  const completed = target.kind === "ending";
  const choiceEvaluations =
    narrative.version === 2 && !completed
      ? evaluateNarrativeChoices(
          choiceVariables,
          targetKey,
          narrative.choices ?? [],
        )
      : [];
  const availableNodeKeys =
    narrative.version === 2
      ? [
          ...new Set(
            choiceEvaluations
              .filter((choice) => choice.available)
              .map((choice) => choice.targetNodeKey),
          ),
        ]
      : target.successorKeys.filter((key) => {
          const node = narrative.nodes.find(
            (candidate) => candidate.key === key,
          )!;
          return evaluateNarrativeCondition(
            parseNarrativeCondition(node.conditionJson),
            variables,
          );
        });
  return {
    ...narrative,
    currentNodeKey: targetKey,
    visitedNodeKeys: [...narrative.visitedNodeKeys, targetKey],
    availableNodeKeys,
    variables,
    completed,
    ...(narrative.version === 2
      ? {
          visibleChoiceKeys: choiceEvaluations
            .filter((choice) => choice.visible)
            .map((choice) => choice.choiceKey),
          availableChoiceKeys: choiceEvaluations
            .filter((choice) => choice.available)
            .map((choice) => choice.choiceKey),
          endingKey: completed ? targetKey : null,
          completedAtSequence: completed
            ? (options.eventSequence ?? null)
            : null,
        }
      : {}),
  };
}

/**
 * Apply one choice with the exact same deterministic semantics used by the
 * persisted event reducer. Authoring preview reuses this helper but never
 * writes a session or an event.
 */
export function advanceFrozenNarrativeChoice(
  narrative: SimulationNarrativeState,
  choiceKey: string,
  eventSequence: number,
): SimulationNarrativeState {
  if (
    narrative.version !== 2 ||
    narrative.completed ||
    !narrative.currentNodeKey
  ) {
    throw new Error("当前叙事没有可提交选择的内容。");
  }
  if (!narrative.availableChoiceKeys?.includes(choiceKey))
    throw new Error("所选 Choice 当前不可用。");
  const choice = narrative.choices?.find(
    (item) => item.choiceKey === choiceKey,
  );
  if (!choice || choice.sourceNodeKey !== narrative.currentNodeKey)
    throw new Error("所选 Choice 不属于当前节点。");
  const fromNodeKey = narrative.currentNodeKey;
  const variables = applyNarrativeChoiceEffects(choice, narrative.variables);
  const entered = enterFrozenNarrativeNode(narrative, choice.targetNodeKey, {
    variables,
    eventSequence,
    selectedChoiceKey: choiceKey,
  });
  return {
    ...entered,
    choiceHistory: [
      ...(narrative.choiceHistory ?? []),
      {
        eventSequence,
        choiceKey,
        fromNodeKey,
        toNodeKey: choice.targetNodeKey,
      },
    ],
  };
}

function assertRuntimeAttributes(value: unknown): RuntimeAttributes {
  if (!isObject(value)) throw new Error("运行时 attributes 必须是对象。");
  const result: RuntimeAttributes = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!key.trim() || key.length > 80) throw new Error("运行时属性键无效。");
    if (raw !== null && !["string", "number", "boolean"].includes(typeof raw)) {
      throw new Error(`运行时属性 ${key} 只能是标量。`);
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) {
      throw new Error(`运行时属性 ${key} 不是有限数字。`);
    }
    result[key] = raw as RuntimeAttributes[string];
  }
  return result;
}

function assertRuntimeEntity(value: unknown): RuntimeEntityState {
  if (!isObject(value)) throw new Error("运行时实体必须是对象。");
  const entityKey = String(value.entityKey ?? "").trim();
  const name = String(value.name ?? "").trim();
  const kind = String(value.kind ?? "");
  const lifecycleStatus = String(value.lifecycleStatus ?? "");
  if (!entityKey || entityKey.length > 160)
    throw new Error("运行时实体缺少有效 entityKey。");
  if (!name || name.length > 200) throw new Error("运行时实体缺少有效名称。");
  if (!RUNTIME_ENTITY_KINDS.includes(kind as RuntimeEntityState["kind"])) {
    throw new Error(`未知运行时实体类型: ${kind}`);
  }
  if (
    !RUNTIME_LIFECYCLE_STATUSES.includes(
      lifecycleStatus as RuntimeEntityState["lifecycleStatus"],
    )
  ) {
    throw new Error(`未知运行时生命周期: ${lifecycleStatus}`);
  }
  const sourceId =
    value.sourceId == null
      ? null
      : assertFiniteInteger(
          value.sourceId,
          "sourceId",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  const locationKey =
    value.locationKey == null ? null : String(value.locationKey).trim() || null;
  return {
    entityKey,
    kind: kind as RuntimeEntityState["kind"],
    sourceId,
    name,
    locationKey,
    lifecycleStatus: lifecycleStatus as RuntimeEntityState["lifecycleStatus"],
    attributes: assertRuntimeAttributes(value.attributes ?? {}),
  };
}

function assertRuntimeMemory(value: unknown): RuntimeMemory {
  if (!isObject(value)) throw new Error("运行时记忆必须是对象。");
  const id = String(value.id ?? "").trim();
  const subjectKey = String(value.subjectKey ?? "").trim();
  const content = String(value.content ?? "").trim();
  const status = String(value.status ?? "");
  if (!id || id.length > 160) throw new Error("运行时记忆缺少有效 id。");
  if (!subjectKey || subjectKey.length > 160)
    throw new Error("运行时记忆缺少主体。");
  if (!content || content.length > 4_000)
    throw new Error("运行时记忆内容无效。");
  if (!["known", "mistaken", "forgotten"].includes(status)) {
    throw new Error(`未知运行时记忆状态: ${status}`);
  }
  return {
    id,
    subjectKey,
    content,
    status: status as RuntimeMemory["status"],
    sourceEventSequence: assertFiniteInteger(
      value.sourceEventSequence,
      "sourceEventSequence",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

export function isNpcRuntimeEntity(entity: RuntimeEntityState): boolean {
  return (
    entity.kind === "npc" ||
    (entity.kind === "character" &&
      (entity.attributes.role === "npc" ||
        entity.attributes.roleWeight === "npc"))
  );
}

export function parseSimulationNpcEvolutionCandidate(
  value: unknown,
): SimulationNpcEvolutionCandidate {
  if (!isObject(value)) throw new Error("NPC 演进候选必须是对象。");
  const allowed = new Set([
    "baseSequence",
    "entityKey",
    "locationKey",
    "lifecycleStatus",
    "attributes",
    "narrative",
    "memory",
    "rationale",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`NPC 演进候选包含未知字段: ${unknown.join(", ")}`);
  const entityKey = String(value.entityKey ?? "").trim();
  if (!entityKey || entityKey.length > 160)
    throw new Error("NPC 演进候选缺少有效实体。");
  const rawLocationKey = value.locationKey;
  if (rawLocationKey != null && typeof rawLocationKey !== "string") {
    throw new Error("NPC 演进地点必须是稳定实体键或 null。");
  }
  const locationKey =
    typeof rawLocationKey === "string" ? rawLocationKey.trim() || null : null;
  const lifecycleStatus = String(value.lifecycleStatus ?? "");
  if (
    !RUNTIME_LIFECYCLE_STATUSES.includes(
      lifecycleStatus as RuntimeEntityState["lifecycleStatus"],
    )
  ) {
    throw new Error(`未知 NPC 生命周期状态: ${lifecycleStatus}`);
  }
  const narrative = String(value.narrative ?? "").trim();
  if (narrative.length > 20_000) throw new Error("NPC 演进叙事过长。");
  const rationale = String(value.rationale ?? "").trim();
  if (rationale.length > 4_000) throw new Error("NPC 演进理由过长。");
  let memory: SimulationNpcEvolutionCandidate["memory"] = null;
  if (value.memory != null) {
    if (!isObject(value.memory))
      throw new Error("NPC 演进记忆必须是对象或 null。");
    const status = String(value.memory.status ?? "");
    const content = String(value.memory.content ?? "").trim();
    if (!["known", "mistaken", "forgotten"].includes(status)) {
      throw new Error(`未知 NPC 记忆状态: ${status}`);
    }
    if (!content || content.length > 4_000)
      throw new Error("NPC 演进记忆内容无效。");
    memory = { status: status as RuntimeMemory["status"], content };
  }
  return {
    baseSequence: assertFiniteInteger(
      value.baseSequence,
      "NPC 演进基线序号",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
    entityKey,
    locationKey,
    lifecycleStatus: lifecycleStatus as RuntimeEntityState["lifecycleStatus"],
    attributes: assertRuntimeAttributes(value.attributes ?? {}),
    narrative,
    memory,
    rationale,
  };
}

function prepareNpcEvolution(
  state: SimulationRuntimeState,
  candidate: SimulationNpcEvolutionCandidate,
): RuntimeEntityState {
  const existing = state.entities[candidate.entityKey];
  if (!existing)
    throw new Error(`要演进的运行时实体不存在: ${candidate.entityKey}`);
  if (!isNpcRuntimeEntity(existing))
    throw new Error("只有运行时 NPC 可以进入演进候选。");
  if (candidate.locationKey != null) {
    const location = state.entities[candidate.locationKey];
    if (!location || location.kind !== "location") {
      throw new Error(`NPC 演进目标地点不存在: ${candidate.locationKey}`);
    }
  }
  const next = assertRuntimeEntity({
    ...existing,
    locationKey: candidate.locationKey,
    lifecycleStatus: candidate.lifecycleStatus,
    attributes: { ...existing.attributes, ...candidate.attributes },
  });
  const attributesChanged = Object.entries(candidate.attributes).some(
    ([key, child]) => existing.attributes[key] !== child,
  );
  if (
    next.locationKey === existing.locationKey &&
    next.lifecycleStatus === existing.lifecycleStatus &&
    !attributesChanged &&
    !candidate.narrative &&
    !candidate.memory
  )
    throw new Error("NPC 演进候选没有任何状态或经历变化。");
  return next;
}

function applyNpcEvolution(
  state: SimulationRuntimeState,
  candidate: SimulationNpcEvolutionCandidate,
  eventSequence: number,
): void {
  state.entities[candidate.entityKey] = prepareNpcEvolution(state, candidate);
  if (candidate.narrative) {
    state.narratives.push({ eventSequence, text: candidate.narrative });
  }
  if (candidate.memory) {
    state.memories.push({
      id: `npc-evolution:${eventSequence}:${candidate.entityKey}`,
      subjectKey: candidate.entityKey,
      status: candidate.memory.status,
      content: candidate.memory.content,
      sourceEventSequence: eventSequence,
    });
  }
}

function assertTtrpgScene(value: unknown): SimulationTtrpgScene {
  if (!isObject(value)) throw new Error("跑团场景必须是对象。");
  const sceneId = String(value.sceneId ?? "").trim();
  const sceneKey =
    value.sceneKey == null ? null : String(value.sceneKey).trim() || null;
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const locationKey =
    value.locationKey == null ? null : String(value.locationKey).trim() || null;
  const status = String(value.status ?? "active");
  if (!sceneId || sceneId.length > 160)
    throw new Error("跑团场景缺少有效 ID。");
  if (
    sceneKey != null &&
    (sceneKey.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sceneKey))
  ) {
    throw new Error("跑团 Campaign 场景 key 无效。");
  }
  if (!title || title.length > 200) throw new Error("跑团场景标题无效。");
  if (description.length > 8_000) throw new Error("跑团场景描述过长。");
  if (status !== "active" && status !== "resolved")
    throw new Error("跑团场景状态无效。");
  return {
    sceneId,
    sceneKey,
    title,
    description,
    locationKey,
    status: status as SimulationTtrpgScene["status"],
  };
}

function assertTtrpgAction(value: unknown): SimulationTtrpgAction {
  if (!isObject(value)) throw new Error("跑团动作必须是对象。");
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "跑团动作事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actorKey = String(value.actorKey ?? "").trim();
  const text = String(value.text ?? "").trim();
  if (!actorKey || actorKey.length > 160)
    throw new Error("跑团动作缺少行动者。");
  if (!text || text.length > 4_000) throw new Error("跑团动作文本无效。");
  return { eventSequence, actorKey, text };
}

function ttrpgDegreeSucceededV2(
  degree: RuleCheckResolutionV1["degree"],
): boolean {
  return [
    "partial-success",
    "success",
    "hard-success",
    "extreme-success",
    "critical-success",
  ].includes(degree);
}

function assertTtrpgCheck(value: unknown): SimulationTtrpgCheck {
  if (!isObject(value)) throw new Error("跑团检定必须是对象。");
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "跑团检定事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actorKey = String(value.actorKey ?? "").trim();
  const skill = String(value.skill ?? "").trim();
  const expression = String(value.expression ?? "").trim();
  const dc = assertFiniteInteger(value.dc, "检定难度", 0, 1_000);
  const dice = value.dice;
  if (!actorKey || actorKey.length > 160)
    throw new Error("跑团检定缺少行动者。");
  if (!skill || skill.length > 120) throw new Error("跑团检定技能无效。");
  if (!Array.isArray(dice)) throw new Error("跑团检定缺少骰子结果。");
  const parsed = parseDiceExpression(expression);
  if (dice.length !== parsed.count)
    throw new Error("跑团检定骰子数量与骰式不一致。");
  const normalizedDice = dice.map((die) =>
    assertFiniteInteger(die, "检定骰子点数", 1, parsed.sides),
  );
  const modifier = Number(value.modifier);
  const total = Number(value.total);
  const success = value.success;
  const visibility =
    value.visibility == null ? "public" : String(value.visibility);
  if (!["public", "gm-only"].includes(visibility)) {
    throw new Error("跑团检定可见性无效。");
  }
  const formalDegree = isObject(value.rule)
    ? String(value.rule.degree ?? "")
    : null;
  const formalMode =
    isObject(value.rule) && value.rule.mode != null
      ? String(value.rule.mode)
      : null;
  if (
    modifier !== parsed.modifier ||
    total !== normalizedDice.reduce((sum, die) => sum + die, modifier)
  ) {
    throw new Error("跑团检定合计与骰式不一致。");
  }
  const expectedSuccess =
    formalMode == null
      ? total >= dc
      : [
          "partial-success",
          "success",
          "hard-success",
          "extreme-success",
          "critical-success",
        ].includes(formalDegree ?? "");
  if (success !== expectedSuccess)
    throw new Error("跑团检定成功状态与合计不一致。");
  let rule: SimulationTtrpgCheck["rule"] = null;
  if (value.rule != null) {
    if (!isObject(value.rule)) throw new Error("正式规则检定证据必须是对象。");
    const actionKey = String(value.rule.actionKey ?? "").trim();
    const checkKey = String(value.rule.checkKey ?? "").trim();
    const attributeKey = String(value.rule.attributeKey ?? "").trim();
    const skillKey =
      value.rule.skillKey == null ? null : String(value.rule.skillKey).trim();
    const skillValue =
      value.rule.skillValue == null ? null : Number(value.rule.skillValue);
    const diceModelKey = String(value.rule.diceModelKey ?? "").trim();
    const degree = String(value.rule.degree ?? "");
    const mode = value.rule.mode == null ? undefined : String(value.rule.mode);
    const seedCommitment =
      value.rule.seedCommitment == null
        ? null
        : String(value.rule.seedCommitment);
    const nonce = value.rule.nonce == null ? null : String(value.rule.nonce);
    const proofHash = String(value.rule.proofHash ?? "");
    const rulePackContentHash = String(value.rule.rulePackContentHash ?? "");
    if (
      ![actionKey, checkKey, attributeKey, diceModelKey].every((key) =>
        /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(key),
      )
    ) {
      throw new Error("正式规则检定 key 无效。");
    }
    if (
      (skillKey == null) !== (skillValue == null) ||
      (skillKey != null &&
        (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(skillKey) ||
          !Number.isFinite(skillValue) ||
          Math.abs(skillValue!) > 1_000))
    ) {
      throw new Error("正式规则检定技能证据无效。");
    }
    if (
      ![
        "critical-failure",
        "failure",
        "partial-success",
        "success",
        "hard-success",
        "extreme-success",
        "critical-success",
      ].includes(degree)
    ) {
      throw new Error("正式规则检定结果等级无效。");
    }
    if (
      mode != null &&
      !["total-vs-target", "roll-under", "success-pool", "opposed"].includes(
        mode,
      )
    ) {
      throw new Error("正式规则检定裁决模式无效。");
    }
    if (
      !/^[0-9a-f]{64}$/.test(proofHash) ||
      !/^[0-9a-f]{64}$/.test(rulePackContentHash)
    ) {
      throw new Error("正式规则检定 hash 无效。");
    }
    if (
      (seedCommitment != null && !/^[0-9a-f]{64}$/.test(seedCommitment)) ||
      (nonce != null && (!nonce || nonce.length > 10_000))
    ) {
      throw new Error("正式规则检定承诺证据无效。");
    }
    if (
      !Array.isArray(value.rule.rolledDice) ||
      !Array.isArray(value.rule.keptDice)
    ) {
      throw new Error("正式规则检定骰子证据无效。");
    }
    const rolledDice = value.rule.rolledDice.map((die) =>
      assertFiniteInteger(die, "正式规则原始骰点", 1, 100),
    );
    const keptDice = value.rule.keptDice.map((die) =>
      assertFiniteInteger(die, "正式规则保留骰点", 1, 100),
    );
    if (!keptDice.length || keptDice.some((die) => !rolledDice.includes(die))) {
      throw new Error("正式规则保留骰点不属于原始骰点。");
    }
    const stableKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
    const winnerRef =
      value.rule.winnerRef == null ? null : String(value.rule.winnerRef).trim();
    const tiedRefs = Array.isArray(value.rule.tiedRefs)
      ? value.rule.tiedRefs.map((item) => String(item).trim())
      : [];
    const calculationTrace = Array.isArray(value.rule.calculationTrace)
      ? value.rule.calculationTrace.map((item) => String(item))
      : [];
    if (
      (winnerRef != null && !stableKeyPattern.test(winnerRef)) ||
      tiedRefs.some((item) => !stableKeyPattern.test(item)) ||
      new Set(tiedRefs).size !== tiedRefs.length ||
      calculationTrace.length > 100 ||
      calculationTrace.some((item) => !item || item.length > 500)
    ) {
      throw new Error("正式规则检定裁决轨迹无效。");
    }
    let opponent: NonNullable<SimulationTtrpgCheck["rule"]>["opponent"] = null;
    if (value.rule.opponent != null) {
      if (!isObject(value.rule.opponent))
        throw new Error("对抗检定目标证据必须是对象。");
      const contestantRef = String(
        value.rule.opponent.contestantRef ?? "",
      ).trim();
      const opponentAttributeKey = String(
        value.rule.opponent.attributeKey ?? "",
      ).trim();
      const opponentDegree = String(value.rule.opponent.degree ?? "");
      if (
        !stableKeyPattern.test(contestantRef) ||
        !stableKeyPattern.test(opponentAttributeKey) ||
        ![
          "critical-failure",
          "failure",
          "partial-success",
          "success",
          "hard-success",
          "extreme-success",
          "critical-success",
        ].includes(opponentDegree) ||
        !/^[0-9a-f]{64}$/.test(String(value.rule.opponent.proofHash ?? ""))
      ) {
        throw new Error("对抗检定目标证据字段无效。");
      }
      if (
        !Array.isArray(value.rule.opponent.rolledDice) ||
        !Array.isArray(value.rule.opponent.keptDice)
      ) {
        throw new Error("对抗检定目标骰子证据无效。");
      }
      const opponentRolledDice = value.rule.opponent.rolledDice.map((die) =>
        assertFiniteInteger(die, "对抗检定目标原始骰点", 1, 100),
      );
      const opponentKeptDice = value.rule.opponent.keptDice.map((die) =>
        assertFiniteInteger(die, "对抗检定目标保留骰点", 1, 100),
      );
      const opponentModifier = Number(value.rule.opponent.attributeModifier);
      const opponentTotal = Number(value.rule.opponent.total);
      if (
        !opponentKeptDice.length ||
        opponentKeptDice.some((die) => !opponentRolledDice.includes(die)) ||
        !Number.isFinite(opponentModifier) ||
        opponentModifier < -1_000 ||
        opponentModifier > 1_000 ||
        opponentTotal !==
          opponentKeptDice.reduce((sum, die) => sum + die, opponentModifier)
      ) {
        throw new Error("对抗检定目标合计证据无效。");
      }
      opponent = {
        contestantRef,
        attributeKey: opponentAttributeKey,
        rolledDice: opponentRolledDice,
        keptDice: opponentKeptDice,
        attributeModifier: opponentModifier,
        total: opponentTotal,
        degree: opponentDegree as TtrpgDegreeV2,
        rollTrace: assertTtrpgDiceRollTraceV2(value.rule.opponent.rollTrace),
        proofHash: String(value.rule.opponent.proofHash),
      };
    }
    if (
      (mode === "opposed" && opponent == null) ||
      (mode !== "opposed" && opponent != null)
    ) {
      throw new Error("正式规则对抗证据与裁决模式不一致。");
    }
    rule = {
      actionKey,
      checkKey,
      attributeKey,
      ...(skillKey == null
        ? {}
        : { skillKey, skillValue: skillValue as number }),
      diceModelKey,
      rolledDice,
      keptDice,
      degree: degree as NonNullable<SimulationTtrpgCheck["rule"]>["degree"],
      ...(mode == null
        ? {}
        : {
            mode: mode as NonNullable<SimulationTtrpgCheck["rule"]>["mode"],
            successes:
              value.rule.successes == null
                ? null
                : assertFiniteInteger(
                    value.rule.successes,
                    "正式规则成功数",
                    0,
                    10_000,
                  ),
            winnerRef,
            tiedRefs,
            calculationTrace,
            opponent,
          }),
      rollTrace:
        value.rule.rollTrace == null
          ? null
          : assertTtrpgDiceRollTraceV2(value.rule.rollTrace),
      seedCommitment,
      nonce,
      proofHash,
      rulePackContentHash,
    };
  }
  return {
    eventSequence,
    actorKey,
    skill,
    expression: parsed.normalized,
    dice: normalizedDice,
    modifier,
    total,
    dc,
    success: Boolean(success),
    visibility: visibility as "public" | "gm-only",
    rule,
  };
}

function assertTtrpgRuleActionResult(
  value: unknown,
): import("../types").SimulationTtrpgRuleActionResultV1 {
  if (!isObject(value)) throw new Error("正式规则行动结果必须是对象。");
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "规则行动事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionKey = String(value.actionKey ?? "").trim();
  const actionName = String(value.actionName ?? "").trim();
  const actorKey = String(value.actorKey ?? "").trim();
  const targetKey =
    value.targetKey == null ? null : String(value.targetKey).trim() || null;
  const actionPhase =
    value.actionPhase == null
      ? null
      : (String(
          value.actionPhase,
        ) as import("../types").SimulationTtrpgRuleActionResultV1["actionPhase"]);
  const outcome = String(
    value.outcome ?? "",
  ) as import("../types").SimulationTtrpgRuleActionResultV1["outcome"];
  if (
    !actionKey ||
    !actionName ||
    !actorKey ||
    (actionPhase != null &&
      !["free", "action", "reaction", "downtime"].includes(actionPhase)) ||
    ![
      "automatic",
      "critical-failure",
      "failure",
      "partial-success",
      "success",
      "hard-success",
      "extreme-success",
      "critical-success",
    ].includes(outcome)
  ) {
    throw new Error("正式规则行动身份或结果无效。");
  }
  const check =
    value.check == null
      ? null
      : assertTtrpgCheck({ ...(value.check as object), eventSequence });
  if (
    !Array.isArray(value.resourceChanges) ||
    !Array.isArray(value.conditionChanges)
  ) {
    throw new Error("正式规则行动效果必须是数组。");
  }
  const resourceChanges = value.resourceChanges.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`规则资源变化 ${index} 无效。`);
    const entityKey = String(raw.entityKey ?? "").trim();
    const resourceKey = String(raw.resourceKey ?? "").trim();
    const before = assertFiniteInteger(
      raw.before,
      "规则资源原值",
      0,
      1_000_000_000,
    );
    const delta = assertFiniteInteger(
      raw.delta,
      "规则资源变化",
      -1_000_000_000,
      1_000_000_000,
    );
    const after = assertFiniteInteger(
      raw.after,
      "规则资源结果",
      0,
      1_000_000_000,
    );
    const maximum = assertFiniteInteger(
      raw.maximum,
      "规则资源上限",
      1,
      1_000_000_000,
    );
    const proofHash = raw.proofHash == null ? null : String(raw.proofHash);
    if (
      !entityKey ||
      !resourceKey ||
      after > maximum ||
      (proofHash != null && !/^[0-9a-f]{64}$/.test(proofHash))
    ) {
      throw new Error(`规则资源变化 ${index} 字段无效。`);
    }
    return { entityKey, resourceKey, before, delta, after, maximum, proofHash };
  });
  const conditionChanges = value.conditionChanges.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`规则状态变化 ${index} 无效。`);
    const entityKey = String(raw.entityKey ?? "").trim();
    const conditionKey = String(raw.conditionKey ?? "").trim();
    const stacks = assertFiniteInteger(raw.stacks, "规则状态层数", 0, 1_000);
    const duration =
      raw.duration == null
        ? null
        : assertFiniteInteger(raw.duration, "规则状态持续时间", 0, 1_000_000);
    if (!entityKey || !conditionKey)
      throw new Error(`规则状态变化 ${index} 字段无效。`);
    return { entityKey, conditionKey, stacks, duration };
  });
  let abilityChange: import("../types").SimulationTtrpgRuleActionResultV1["abilityChange"] =
    null;
  if (value.abilityChange != null) {
    if (!isObject(value.abilityChange))
      throw new Error("规则能力变化必须是对象。");
    const change = value.abilityChange;
    const stateKey = String(change.stateKey ?? "").trim();
    const before = parseTtrpgAbilityRuntimeStateV2(change.before);
    const after = parseTtrpgAbilityRuntimeStateV2(change.after);
    const sharedPoolKey =
      change.sharedPoolKey == null
        ? null
        : String(change.sharedPoolKey).trim() || null;
    const sharedPoolBefore =
      change.sharedPoolBefore == null
        ? null
        : parseTtrpgUsagePoolStateV2(change.sharedPoolBefore);
    const sharedPoolAfter =
      change.sharedPoolAfter == null
        ? null
        : parseTtrpgUsagePoolStateV2(change.sharedPoolAfter);
    if (
      stateKey !== ttrpgAbilityStateKeyV2(actorKey, actionKey) ||
      before.actorInstanceId !== actorKey ||
      after.actorInstanceId !== actorKey ||
      before.abilityKey !== actionKey ||
      after.abilityKey !== actionKey ||
      (sharedPoolKey == null) !== (sharedPoolBefore == null) ||
      (sharedPoolKey == null) !== (sharedPoolAfter == null) ||
      (sharedPoolKey != null &&
        (sharedPoolBefore?.poolKey !== sharedPoolKey ||
          sharedPoolAfter?.poolKey !== sharedPoolKey))
    ) {
      throw new Error("规则能力变化身份不一致。");
    }
    abilityChange = {
      stateKey,
      before,
      after,
      sharedPoolKey,
      sharedPoolBefore,
      sharedPoolAfter,
    };
  }
  let actorAuthority: import("../types").SimulationTtrpgRuleActionResultV1["actorAuthority"] =
    null;
  if (value.actorAuthority != null) {
    if (!isObject(value.actorAuthority))
      throw new Error("AI 行动授权必须是对象。");
    const source = String(value.actorAuthority.source ?? "");
    const viewerKey = String(value.actorAuthority.viewerKey ?? "").trim();
    const runId = assertFiniteInteger(
      value.actorAuthority.runId,
      "AI 玩家 Run ID",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const candidateHash = String(value.actorAuthority.candidateHash ?? "");
    const contextManifestHash = String(
      value.actorAuthority.contextManifestHash ?? "",
    );
    const approach = String(value.actorAuthority.approach ?? "")
      .trim()
      .normalize("NFC");
    const spokenIntent =
      value.actorAuthority.spokenIntent == null
        ? null
        : String(value.actorAuthority.spokenIntent).trim().normalize("NFC") ||
          null;
    if (
      ![
        "ai-player",
        "hybrid-confirmed",
        "ai-gm-npc",
        "hybrid-gm-confirmed",
      ].includes(source) ||
      !viewerKey ||
      !/^[0-9a-f]{64}$/.test(candidateHash) ||
      !/^[0-9a-f]{64}$/.test(contextManifestHash) ||
      !approach ||
      approach.length > 4_000 ||
      (spokenIntent?.length ?? 0) > 2_000
    ) {
      throw new Error("AI 行动授权字段无效。");
    }
    actorAuthority = {
      source: source as
        "ai-player" | "hybrid-confirmed" | "ai-gm-npc" | "hybrid-gm-confirmed",
      viewerKey,
      runId,
      candidateHash,
      contextManifestHash,
      approach,
      spokenIntent,
    };
  }
  const receipt =
    value.receipt == null ? null : parseTtrpgActionReceiptV2(value.receipt);
  if (
    receipt &&
    (receipt.actionSequence !== eventSequence ||
      receipt.context.actorKey !== actorKey ||
      receipt.context.targetKey !== targetKey ||
      receipt.context.actionKey !== actionKey ||
      receipt.context.actionPhase !== actionPhase ||
      receipt.nextActorKey !==
        (value.nextActorKey == null
          ? null
          : String(value.nextActorKey).trim() || null) ||
      receipt.nextRound !== Number(value.nextRound))
  ) {
    throw new Error("ActionReceipt 与规则行动结果身份或回合推进不一致。");
  }
  return {
    eventSequence,
    actionKey,
    actionName,
    actorKey,
    targetKey,
    actionPhase,
    outcome,
    check,
    resourceChanges,
    conditionChanges,
    abilityChange,
    actorAuthority,
    receipt,
    nextActorKey:
      value.nextActorKey == null
        ? null
        : String(value.nextActorKey).trim() || null,
    nextRound: assertFiniteInteger(
      value.nextRound,
      "规则行动下一回合",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function parseTtrpgIntentReceiptV2(
  value: unknown,
): SimulationTtrpgIntentReceiptV2 {
  if (
    !isObject(value) ||
    value.schema !== "storyforge.ttrpg-intent-receipt" ||
    value.version !== 2
  ) {
    throw new Error("正式行动意图收据 schema/version 无效。");
  }
  const allowed = [
    "schema",
    "version",
    "receiptKey",
    "eventSequence",
    "intentKey",
    "actorKey",
    "rawInput",
    "proposedActionKey",
    "targetKey",
    "terminalStatus",
    "reason",
    "suggestedActionKeys",
  ];
  if (Object.keys(value).some((field) => !allowed.includes(field))) {
    throw new Error("正式行动意图收据包含未知字段。");
  }
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "行动意图事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const stable = (raw: unknown, label: string, nullable = false) => {
    if (nullable && raw == null) return null;
    const parsed = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed))
      throw new Error(`${label} 无效。`);
    return parsed;
  };
  const receiptKey = stable(value.receiptKey, "行动意图收据 key")!;
  const intentKey = stable(value.intentKey, "行动意图 key")!;
  const actorKey = stable(value.actorKey, "行动意图角色")!;
  const proposedActionKey = stable(
    value.proposedActionKey,
    "行动意图规则行动",
    true,
  );
  const targetKey = stable(value.targetKey, "行动意图目标", true);
  const rawInput = String(value.rawInput ?? "")
    .trim()
    .normalize("NFC");
  const reason = String(value.reason ?? "")
    .trim()
    .normalize("NFC");
  const terminalStatus = String(value.terminalStatus ?? "");
  const suggestedActionKeys = Array.isArray(value.suggestedActionKeys)
    ? value.suggestedActionKeys.map((item) => stable(item, "建议规则行动 key")!)
    : [];
  if (
    receiptKey !== `intent-receipt.${eventSequence}` ||
    !rawInput ||
    rawInput.length > 10_000 ||
    !reason ||
    reason.length > 2_000 ||
    ![
      "needs-clarification",
      "rejected-illegal",
      "interrupted",
      "queued/deferred",
      "cancelled",
    ].includes(terminalStatus) ||
    suggestedActionKeys.length > 32 ||
    new Set(suggestedActionKeys).size !== suggestedActionKeys.length
  ) {
    throw new Error("正式行动意图收据字段无效。");
  }
  return {
    schema: "storyforge.ttrpg-intent-receipt",
    version: 2,
    receiptKey,
    eventSequence,
    intentKey,
    actorKey,
    rawInput,
    proposedActionKey,
    targetKey,
    terminalStatus:
      terminalStatus as SimulationTtrpgIntentReceiptV2["terminalStatus"],
    reason,
    suggestedActionKeys,
  };
}

function parseTtrpgHumanResponseV2(
  value: unknown,
): SimulationTtrpgHumanResponseV2 {
  if (
    !isObject(value) ||
    value.schema !== "storyforge.ttrpg-human-response" ||
    value.version !== 2
  ) {
    throw new Error("真人角色回应 schema/version 无效。");
  }
  const expected = [
    "schema",
    "version",
    "responseKey",
    "eventSequence",
    "actionSequence",
    "actionReceiptKey",
    "actorKey",
    "kind",
    "text",
    "audience",
    "viewerKey",
  ];
  if (Object.keys(value).sort().join(",") !== expected.sort().join(",")) {
    throw new Error("真人角色回应字段不精确。");
  }
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "真人回应事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionSequence = assertFiniteInteger(
    value.actionSequence,
    "真人回应行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const stable = (raw: unknown, label: string) => {
    const parsed = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(parsed))
      throw new Error(`${label} 无效。`);
    return parsed;
  };
  const responseKey = stable(value.responseKey, "真人回应 key");
  const actionReceiptKey = stable(value.actionReceiptKey, "行动收据 key");
  const actorKey = stable(value.actorKey, "真人回应角色");
  const viewerKey = stable(value.viewerKey, "真人回应 viewer");
  const kind = String(value.kind);
  const audience = String(value.audience);
  const text = String(value.text ?? "")
    .trim()
    .normalize("NFC");
  if (
    responseKey !== `human-response.${actionSequence}.${actorKey}` ||
    !["speak", "act-narratively", "decline"].includes(kind) ||
    !["party", "gm-only"].includes(audience) ||
    !text ||
    text.length > 10_000 ||
    (kind === "decline" && text !== "本角色选择不作额外回应。")
  ) {
    throw new Error("真人角色回应内容无效。");
  }
  return {
    schema: "storyforge.ttrpg-human-response",
    version: 2,
    responseKey,
    eventSequence,
    actionSequence,
    actionReceiptKey,
    actorKey,
    kind: kind as SimulationTtrpgHumanResponseV2["kind"],
    text,
    audience: audience as SimulationTtrpgHumanResponseV2["audience"],
    viewerKey,
  };
}

function parseTtrpgRestReceiptV2(value: unknown): SimulationTtrpgRestReceiptV2 {
  if (
    !isObject(value) ||
    value.schema !== "storyforge.ttrpg-rest-receipt" ||
    value.version !== 2
  ) {
    throw new Error("正式休息收据 schema/version 无效。");
  }
  const eventSequence = assertFiniteInteger(
    value.eventSequence,
    "休息事件序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const restKey = String(value.restKey ?? "").trim();
  const kind = String(value.kind ?? "");
  const completedBy = String(value.completedBy ?? "").trim();
  const reason = String(value.reason ?? "")
    .trim()
    .normalize("NFC");
  const actorKeys = Array.isArray(value.actorKeys)
    ? value.actorKeys.map((item) => String(item).trim())
    : [];
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(restKey) ||
    !["short-rest", "long-rest"].includes(kind) ||
    !completedBy ||
    !reason ||
    reason.length > 2_000 ||
    !actorKeys.length ||
    actorKeys.some((key) => !key) ||
    new Set(actorKeys).size !== actorKeys.length ||
    !Array.isArray(value.abilityChanges)
  ) {
    throw new Error("正式休息收据字段无效。");
  }
  const abilityChanges = value.abilityChanges.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`休息能力恢复 ${index} 无效。`);
    const stateKey = String(raw.stateKey ?? "").trim();
    const actorKey = String(raw.actorKey ?? "").trim();
    const abilityKey = String(raw.abilityKey ?? "").trim();
    const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
    const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
    if (
      stateKey !== ttrpgAbilityStateKeyV2(actorKey, abilityKey) ||
      before.actorInstanceId !== actorKey ||
      after.actorInstanceId !== actorKey ||
      before.abilityKey !== abilityKey ||
      after.abilityKey !== abilityKey ||
      !actorKeys.includes(actorKey)
    ) {
      throw new Error(`休息能力恢复 ${index} 身份不一致。`);
    }
    return { stateKey, actorKey, abilityKey, before, after };
  });
  if (
    new Set(abilityChanges.map((item) => item.stateKey)).size !==
    abilityChanges.length
  ) {
    throw new Error("正式休息收据包含重复能力状态。");
  }
  return {
    schema: "storyforge.ttrpg-rest-receipt",
    version: 2,
    eventSequence,
    restKey,
    kind: kind as "short-rest" | "long-rest",
    actorKeys,
    completedBy,
    reason,
    abilityChanges,
  };
}

function assertTtrpgResource(value: unknown): SimulationTtrpgResource {
  if (!isObject(value)) throw new Error("跑团资源必须是对象。");
  const current = assertFiniteInteger(
    value.current,
    "资源当前值",
    0,
    1_000_000_000,
  );
  const maximum = assertFiniteInteger(
    value.maximum,
    "资源上限",
    1,
    1_000_000_000,
  );
  if (current > maximum) throw new Error("资源当前值不能超过上限。");
  return { current, maximum };
}

function assertTtrpgCondition(value: unknown): SimulationTtrpgCondition {
  if (!isObject(value)) throw new Error("跑团状态效果必须是对象。");
  const conditionId = String(value.conditionId ?? "").trim();
  const name = String(value.name ?? "").trim();
  const description = String(value.description ?? "").trim();
  const duration =
    value.duration == null
      ? null
      : assertFiniteInteger(value.duration, "状态效果持续回合", 0, 1_000_000);
  const stacks = assertFiniteInteger(
    value.stacks ?? 1,
    "状态效果层数",
    1,
    1_000,
  );
  if (!conditionId || conditionId.length > 160)
    throw new Error("状态效果缺少有效 ID。");
  if (!name || name.length > 120) throw new Error("状态效果名称无效。");
  if (description.length > 2_000) throw new Error("状态效果描述过长。");
  return { conditionId, name, description, duration, stacks };
}

function assertTtrpgCombatant(value: unknown): SimulationTtrpgCombatant {
  if (!isObject(value)) throw new Error("战斗参与者必须是对象。");
  const entityKey = String(value.entityKey ?? "").trim();
  const initiative = assertFiniteInteger(value.initiative, "先攻值", 0, 1_000);
  const armorClass = assertFiniteInteger(
    value.armorClass,
    "护甲等级",
    0,
    1_000,
  );
  if (!entityKey || entityKey.length > 160)
    throw new Error("战斗参与者缺少实体键。");
  if (!isObject(value.resources)) throw new Error("战斗资源必须是对象。");
  const resources: Record<string, SimulationTtrpgResource> = {};
  for (const [key, resource] of Object.entries(value.resources)) {
    if (!key.trim() || key.length > 80) throw new Error("战斗资源键无效。");
    resources[key] = assertTtrpgResource(resource);
  }
  if (!resources.hp) throw new Error("战斗参与者必须拥有 hp 资源。");
  if (!Array.isArray(value.conditions))
    throw new Error("战斗状态效果必须是数组。");
  const conditions = value.conditions.map(assertTtrpgCondition);
  if (
    new Set(conditions.map((condition) => condition.conditionId)).size !==
    conditions.length
  ) {
    throw new Error("战斗状态效果不能重复。");
  }
  return { entityKey, initiative, armorClass, resources, conditions };
}

function assertTtrpgEncounter(value: unknown): SimulationTtrpgEncounter {
  if (!isObject(value)) throw new Error("跑团遭遇必须是对象。");
  const encounterId = String(value.encounterId ?? "").trim();
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const status = String(value.status ?? "active");
  const round = assertFiniteInteger(
    value.round,
    "战斗回合",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const activeActorKey =
    value.activeActorKey == null
      ? null
      : String(value.activeActorKey).trim() || null;
  if (!encounterId || encounterId.length > 160)
    throw new Error("遭遇缺少有效 ID。");
  if (!title || title.length > 200) throw new Error("遭遇标题无效。");
  if (description.length > 8_000) throw new Error("遭遇描述过长。");
  if (status !== "active" && status !== "resolved")
    throw new Error("遭遇状态无效。");
  if (!Array.isArray(value.turnOrder) || value.turnOrder.length === 0)
    throw new Error("遭遇必须有回合顺序。");
  const turnOrder = value.turnOrder.map((raw) => String(raw).trim());
  if (
    turnOrder.some((key) => !key || key.length > 160) ||
    new Set(turnOrder).size !== turnOrder.length
  ) {
    throw new Error("遭遇回合顺序包含无效或重复参与者。");
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey))
    throw new Error("遭遇当前行动者不在回合顺序中。");
  if (!isObject(value.combatants)) throw new Error("遭遇缺少战斗参与者。");
  const combatants: Record<string, SimulationTtrpgCombatant> = {};
  for (const [key, raw] of Object.entries(value.combatants)) {
    const combatant = assertTtrpgCombatant(raw);
    if (combatant.entityKey !== key)
      throw new Error(`遭遇参与者索引与实体键不一致: ${key}`);
    combatants[key] = combatant;
  }
  if (
    turnOrder.some((key) => !combatants[key]) ||
    Object.keys(combatants).some((key) => !turnOrder.includes(key))
  ) {
    throw new Error("遭遇回合顺序与参与者不一致。");
  }
  return {
    encounterId,
    title,
    description,
    status: status as SimulationTtrpgEncounter["status"],
    round,
    activeActorKey,
    turnOrder,
    combatants,
  };
}

function assertTtrpgAttackResult(value: unknown): SimulationTtrpgAttackResult {
  if (!isObject(value)) throw new Error("攻击结果必须是对象。");
  const actorKey = String(value.actorKey ?? "").trim();
  const targetKey = String(value.targetKey ?? "").trim();
  const attackExpression = String(value.attackExpression ?? "").trim();
  const damageExpression =
    value.damageExpression == null
      ? null
      : String(value.damageExpression).trim() || null;
  const resourceKey = String(value.resourceKey ?? "hp").trim();
  const reason = String(value.reason ?? "").trim();
  if (
    !actorKey ||
    !targetKey ||
    actorKey.length > 160 ||
    targetKey.length > 160
  )
    throw new Error("攻击缺少有效行动者或目标。");
  const attack = parseDiceExpression(attackExpression);
  const attackDice = value.attackDice;
  if (!Array.isArray(attackDice) || attackDice.length !== attack.count)
    throw new Error("攻击骰子数量与骰式不一致。");
  const normalizedAttackDice = attackDice.map((die) =>
    assertFiniteInteger(die, "攻击骰子点数", 1, attack.sides),
  );
  const attackModifier = Number(value.attackModifier);
  const attackTotal = Number(value.attackTotal);
  const armorClass = assertFiniteInteger(
    value.armorClass,
    "护甲等级",
    0,
    1_000,
  );
  const hit = value.hit;
  if (
    attackModifier !== attack.modifier ||
    attackTotal !==
      normalizedAttackDice.reduce((sum, die) => sum + die, attackModifier)
  ) {
    throw new Error("攻击合计与骰式不一致。");
  }
  if (hit !== attackTotal >= armorClass)
    throw new Error("攻击命中状态与合计不一致。");
  let normalizedDamageExpression: string | null = null;
  let damageDice: number[] = [];
  let damageModifier = 0;
  const damageTotal = Number(value.damageTotal ?? 0);
  if (damageExpression) {
    const damage = parseDiceExpression(damageExpression);
    if (
      !Array.isArray(value.damageDice) ||
      value.damageDice.length !== damage.count
    )
      throw new Error("伤害骰子数量与骰式不一致。");
    damageDice = value.damageDice.map((die) =>
      assertFiniteInteger(die, "伤害骰子点数", 1, damage.sides),
    );
    damageModifier = Number(value.damageModifier);
    if (
      damageModifier !== damage.modifier ||
      damageTotal !== damageDice.reduce((sum, die) => sum + die, damageModifier)
    ) {
      throw new Error("伤害合计与骰式不一致。");
    }
    if (damageTotal < 0) throw new Error("伤害合计不能为负数。");
    normalizedDamageExpression = damage.normalized;
  } else if (
    damageTotal !== 0 ||
    (Array.isArray(value.damageDice) && value.damageDice.length > 0)
  ) {
    throw new Error("没有伤害骰式时不能提交伤害结果。");
  }
  const resourceDelta = assertFiniteInteger(
    value.resourceDelta,
    "资源变化量",
    -1_000_000_000,
    1_000_000_000,
  );
  if (!hit && (damageTotal !== 0 || resourceDelta !== 0))
    throw new Error("未命中攻击不能造成伤害。");
  if (hit && resourceDelta !== -damageTotal)
    throw new Error("攻击资源变化必须等于伤害负值。");
  if (!resourceKey || resourceKey.length > 80)
    throw new Error("攻击资源键无效。");
  if (reason.length > 2_000) throw new Error("攻击理由过长。");
  return {
    actorKey,
    targetKey,
    attackExpression: attack.normalized,
    attackDice: normalizedAttackDice,
    attackModifier,
    attackTotal,
    armorClass,
    hit: Boolean(hit),
    damageExpression: normalizedDamageExpression,
    damageDice,
    damageModifier,
    damageTotal,
    resourceKey,
    resourceDelta,
    reason,
  };
}

function emptyTtrpgState(): SimulationTtrpgState {
  return {
    scene: null,
    round: 0,
    activeActorKey: null,
    turnOrder: [],
    actions: [],
    checks: [],
    attacks: [],
    encounter: null,
    campaign: emptyTtrpgCampaignState(),
    product: null,
  };
}

function parseTtrpgModelEvidenceV1(
  value: unknown,
): SimulationTtrpgModelEvidenceV1 | null {
  if (value == null) return null;
  if (!isObject(value)) throw new Error("正式 TTRPG 模型调用证据无效。");
  const provider = String(value.provider ?? "").trim();
  const model = String(value.model ?? "").trim();
  const usageSource = String(value.usageSource ?? "");
  const inputTokens = assertFiniteInteger(
    value.inputTokens,
    "AI GM 输入 tokens",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const outputTokens = assertFiniteInteger(
    value.outputTokens,
    "AI GM 输出 tokens",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const totalTokens = assertFiniteInteger(
    value.totalTokens,
    "AI GM 总 tokens",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const latencyMs = assertFiniteInteger(
    value.latencyMs,
    "AI GM 延迟",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const estimatedCostUsd =
    value.estimatedCostUsd == null ? null : Number(value.estimatedCostUsd);
  if (
    !provider ||
    provider.length > 100 ||
    !model ||
    model.length > 200 ||
    !["provider", "estimated"].includes(usageSource) ||
    totalTokens !== inputTokens + outputTokens ||
    (estimatedCostUsd != null &&
      (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0))
  ) {
    throw new Error("正式 TTRPG 模型调用证据字段无效。");
  }
  return {
    provider,
    model,
    usageSource: usageSource as "provider" | "estimated",
    inputTokens,
    outputTokens,
    totalTokens,
    latencyMs,
    estimatedCostUsd,
  };
}

function parseTtrpgTabletopStateV1(
  value: unknown,
): SimulationTtrpgTabletopStateV1 | null {
  if (value == null) return null;
  if (
    !isObject(value) ||
    !Array.isArray(value.maps) ||
    !Array.isArray(value.tokens) ||
    !Array.isArray(value.visibleLayerKeys) ||
    !Array.isArray(value.revealedFogKeys)
  ) {
    throw new Error("正式 TTRPG 桌面状态无效。");
  }
  const maps = value.maps.map((raw, index) => {
    if (
      !isObject(raw) ||
      !Array.isArray(raw.sceneKeys) ||
      !Array.isArray(raw.publicLayerKeys) ||
      !Array.isArray(raw.gmLayerKeys) ||
      !Array.isArray(raw.areaKeys) ||
      !Array.isArray(raw.gmAreaKeys) ||
      !Array.isArray(raw.fogKeys)
    ) {
      throw new Error(`正式 TTRPG 桌面地图 ${index} 无效。`);
    }
    const mapKey = String(raw.mapKey ?? "").trim();
    const toKeys = (items: unknown[], label: string) => {
      const keys = items.map((item) => String(item).trim());
      if (keys.some((key) => !key) || new Set(keys).size !== keys.length)
        throw new Error(`${label} 无效或重复。`);
      return keys;
    };
    const sceneKeys = toKeys(raw.sceneKeys, "桌面场景索引");
    const publicLayerKeys = toKeys(raw.publicLayerKeys, "桌面公开图层");
    const gmLayerKeys = toKeys(raw.gmLayerKeys, "桌面 GM 图层");
    const areaKeys = toKeys(raw.areaKeys, "桌面公开区域");
    const gmAreaKeys = toKeys(raw.gmAreaKeys, "桌面 GM 区域");
    const fogKeys = toKeys(raw.fogKeys, "桌面迷雾索引");
    if (
      !mapKey ||
      publicLayerKeys.some((key) => gmLayerKeys.includes(key)) ||
      areaKeys.some((key) => gmAreaKeys.includes(key))
    ) {
      throw new Error(`正式 TTRPG 桌面地图 ${index} 字段冲突。`);
    }
    return {
      mapKey,
      sceneKeys,
      width: assertFiniteInteger(raw.width, "桌面地图宽度", 4, 100),
      height: assertFiniteInteger(raw.height, "桌面地图高度", 4, 100),
      publicLayerKeys,
      gmLayerKeys,
      areaKeys,
      gmAreaKeys,
      fogKeys,
    };
  });
  if (
    !maps.length ||
    new Set(maps.map((map) => map.mapKey)).size !== maps.length
  )
    throw new Error("正式 TTRPG 桌面地图索引无效。");
  const knownLayers = new Set(
    maps.flatMap((map) => [...map.publicLayerKeys, ...map.gmLayerKeys]),
  );
  const knownFog = new Set(maps.flatMap((map) => map.fogKeys));
  const visibleLayerKeys = value.visibleLayerKeys.map((item) =>
    String(item).trim(),
  );
  const revealedFogKeys = value.revealedFogKeys.map((item) =>
    String(item).trim(),
  );
  if (
    visibleLayerKeys.some((key) => !knownLayers.has(key)) ||
    new Set(visibleLayerKeys).size !== visibleLayerKeys.length ||
    revealedFogKeys.some((key) => !knownFog.has(key)) ||
    new Set(revealedFogKeys).size !== revealedFogKeys.length
  ) {
    throw new Error("正式 TTRPG 桌面图层或迷雾投影无效。");
  }
  const tokens = value.tokens.map((raw, index) => {
    if (!isObject(raw))
      throw new Error(`正式 TTRPG 桌面 token ${index} 无效。`);
    const tokenKey = String(raw.tokenKey ?? "").trim();
    const entityKey = String(raw.entityKey ?? "").trim();
    const mapKey = String(raw.mapKey ?? "").trim();
    const controllerKey =
      raw.controllerKey == null
        ? null
        : String(raw.controllerKey).trim() || null;
    if (
      !tokenKey ||
      !entityKey ||
      !maps.some((map) => map.mapKey === mapKey) ||
      typeof raw.hidden !== "boolean"
    ) {
      throw new Error(`正式 TTRPG 桌面 token ${index} 字段无效。`);
    }
    return {
      tokenKey,
      entityKey,
      mapKey,
      x: assertFiniteInteger(raw.x, "桌面 token x", 0, 100),
      y: assertFiniteInteger(raw.y, "桌面 token y", 0, 100),
      size: assertFiniteInteger(raw.size, "桌面 token 大小", 1, 20),
      controllerKey,
      hidden: raw.hidden,
    };
  });
  if (new Set(tokens.map((token) => token.tokenKey)).size !== tokens.length)
    throw new Error("正式 TTRPG 桌面 token 重复。");
  const currentMapKey =
    value.currentMapKey == null
      ? null
      : String(value.currentMapKey).trim() || null;
  if (currentMapKey && !maps.some((map) => map.mapKey === currentMapKey))
    throw new Error("正式 TTRPG 当前桌面地图无效。");
  return {
    currentMapKey,
    maps,
    tokens,
    visibleLayerKeys,
    revealedFogKeys,
    updatedAtSequence:
      value.updatedAtSequence == null
        ? null
        : assertFiniteInteger(
            value.updatedAtSequence,
            "桌面更新序号",
            1,
            Number.MAX_SAFE_INTEGER,
          ),
  };
}

function parseTtrpgMediaStateV1(
  value: unknown,
): NonNullable<NonNullable<SimulationTtrpgState["product"]>["media"]> | null {
  if (value == null) return null;
  if (
    !isObject(value) ||
    !isObject(value.runtimePolicy) ||
    !Array.isArray(value.slots)
  ) {
    throw new Error("正式 TTRPG 媒资状态无效。");
  }
  const visualBibleHash =
    value.visualBibleHash == null ? null : String(value.visualBibleHash);
  if (visualBibleHash != null && !/^[a-f0-9]{64}$/.test(visualBibleHash))
    throw new Error("正式 TTRPG 视觉圣经 hash 无效。");
  const generatedCount = assertFiniteInteger(
    value.generatedCount,
    "运行时已生成媒资数",
    0,
    4_096,
  );
  const policy = value.runtimePolicy;
  if (
    typeof policy.enabled !== "boolean" ||
    !["any", "wifi-only", "disabled"].includes(String(policy.networkPolicy)) ||
    typeof policy.maximumSessionCostUsd !== "number" ||
    !Number.isFinite(policy.maximumSessionCostUsd) ||
    policy.maximumSessionCostUsd < 0 ||
    policy.maximumSessionCostUsd > 10_000 ||
    typeof policy.allowProviderFallback !== "boolean"
  )
    throw new Error("正式 TTRPG 媒资策略无效。");
  const runtimePolicy = {
    enabled: policy.enabled,
    networkPolicy: String(policy.networkPolicy) as
      "any" | "wifi-only" | "disabled",
    maximumSessionCostUsd: policy.maximumSessionCostUsd,
    maximumConcurrentRequests: assertFiniteInteger(
      policy.maximumConcurrentRequests,
      "媒资最大并发",
      1,
      16,
    ),
    maximumAttempts: assertFiniteInteger(
      policy.maximumAttempts,
      "媒资最大重试",
      1,
      10,
    ),
    maximumGeneratedAssets: assertFiniteInteger(
      policy.maximumGeneratedAssets,
      "媒资最大数量",
      0,
      4_096,
    ),
    allowProviderFallback: policy.allowProviderFallback,
  };
  if (!runtimePolicy.enabled && runtimePolicy.maximumGeneratedAssets !== 0)
    throw new Error("禁用媒资策略仍声明生成数量。");
  const slots = value.slots.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG 媒资槽 ${index} 无效。`);
    const slotKey = String(raw.slotKey ?? "").trim();
    const targetRef = String(raw.targetRef ?? "").trim();
    const kind = String(raw.kind);
    const audience = String(raw.audience);
    const status = String(raw.status);
    const requestKey =
      raw.requestKey == null ? null : String(raw.requestKey).trim() || null;
    const assetKey =
      raw.assetKey == null ? null : String(raw.assetKey).trim() || null;
    const mediaAssetId =
      raw.mediaAssetId == null
        ? null
        : assertFiniteInteger(
            raw.mediaAssetId,
            "媒资槽资产 ID",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    const mediaAssetVersion =
      raw.mediaAssetVersion == null
        ? null
        : assertFiniteInteger(
            raw.mediaAssetVersion,
            "媒资槽资产版本",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    const mediaContentHash =
      raw.mediaContentHash == null ? null : String(raw.mediaContentHash);
    const lastErrorCode =
      raw.lastErrorCode == null
        ? null
        : String(raw.lastErrorCode).trim() || null;
    const fallbackText = String(raw.fallbackText ?? "").trim();
    const altText = String(raw.altText ?? "").trim();
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(slotKey) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(targetRef) ||
      ![
        "scene",
        "map",
        "character-portrait",
        "character-expression",
        "token",
        "item-icon",
        "handout",
      ].includes(kind) ||
      !["public", "party", "private", "gm-only"].includes(audience) ||
      !["placeholder", "queued", "available", "failed", "cancelled"].includes(
        status,
      ) ||
      !fallbackText ||
      fallbackText.length > 20_000 ||
      !altText ||
      altText.length > 2_000 ||
      (requestKey != null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestKey)) ||
      (assetKey != null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(assetKey)) ||
      (mediaContentHash != null && !/^[a-f0-9]{64}$/.test(mediaContentHash)) ||
      (lastErrorCode != null &&
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(lastErrorCode))
    ) {
      throw new Error(`正式 TTRPG 媒资槽 ${index} 字段无效。`);
    }
    if (
      (status === "queued" || status === "failed" || status === "cancelled") &&
      requestKey == null
    ) {
      throw new Error(`正式 TTRPG 媒资槽 ${index} 缺少请求身份。`);
    }
    if (
      mediaAssetId != null &&
      (status !== "available" ||
        mediaAssetVersion == null ||
        mediaContentHash == null ||
        assetKey == null)
    ) {
      throw new Error(`正式 TTRPG 媒资槽 ${index} 动态资产证据不完整。`);
    }
    if (
      mediaAssetId == null &&
      (mediaAssetVersion != null || mediaContentHash != null)
    )
      throw new Error("媒资槽存在悬空动态资产元数据。");
    return {
      slotKey,
      kind: kind as import("../types").TtrpgRuntimeMediaKindV1,
      targetRef,
      audience: audience as import("../types").TtrpgRuntimeMediaAudienceV1,
      fallbackText,
      altText,
      status: status as
        "placeholder" | "queued" | "available" | "failed" | "cancelled",
      requestKey,
      assetKey,
      mediaAssetId,
      mediaAssetVersion,
      mediaContentHash,
      lastErrorCode,
      updatedAtSequence:
        raw.updatedAtSequence == null
          ? null
          : assertFiniteInteger(
              raw.updatedAtSequence,
              "媒资槽更新序号",
              1,
              Number.MAX_SAFE_INTEGER,
            ),
    };
  });
  if (
    new Set(slots.map((slot) => slot.slotKey)).size !== slots.length ||
    generatedCount !==
      slots.filter(
        (slot) => slot.status === "available" && slot.mediaAssetId != null,
      ).length ||
    generatedCount > runtimePolicy.maximumGeneratedAssets
  )
    throw new Error("正式 TTRPG 媒资槽重复或计数不一致。");
  return { visualBibleHash, generatedCount, runtimePolicy, slots };
}

function parseTtrpgProductState(
  value: unknown,
): SimulationTtrpgState["product"] {
  if (value == null) return null;
  if (
    !isObject(value) ||
    !/^[0-9a-f]{64}$/.test(String(value.rulePackContentHash ?? ""))
  ) {
    throw new Error("正式 TTRPG 产品状态无效。");
  }
  const campaignKey = String(value.campaignKey ?? "").trim();
  const campaignTitle = String(value.campaignTitle ?? "").trim();
  const openingSceneKey = String(value.openingSceneKey ?? "").trim();
  if (!campaignKey || !campaignTitle || !openingSceneKey)
    throw new Error("正式 TTRPG 产品身份不完整。");
  if (
    !isObject(value.sessionZero) ||
    !Array.isArray(value.sessionZero.requiredItemKeys) ||
    !Array.isArray(value.sessionZero.acceptedItemKeys)
  ) {
    throw new Error("正式 TTRPG Session Zero 状态无效。");
  }
  const requiredItemKeys = value.sessionZero.requiredItemKeys.map((item) =>
    String(item).trim(),
  );
  const acceptedItemKeys = value.sessionZero.acceptedItemKeys.map((item) =>
    String(item).trim(),
  );
  const selectedCharacterKeys = Array.isArray(
    value.sessionZero.selectedCharacterKeys,
  )
    ? value.sessionZero.selectedCharacterKeys.map((item) => String(item).trim())
    : [];
  if (
    !requiredItemKeys.length ||
    [...requiredItemKeys, ...acceptedItemKeys].some((item) => !item) ||
    new Set(requiredItemKeys).size !== requiredItemKeys.length ||
    new Set(acceptedItemKeys).size !== acceptedItemKeys.length ||
    selectedCharacterKeys.some((item) => !item) ||
    new Set(selectedCharacterKeys).size !== selectedCharacterKeys.length
  ) {
    throw new Error("Session Zero 确认项无效或重复。");
  }
  const completed = value.sessionZero.completed === true;
  const completedBy =
    value.sessionZero.completedBy == null
      ? null
      : String(value.sessionZero.completedBy).trim() || null;
  const completedAtSequence =
    value.sessionZero.completedAtSequence == null
      ? null
      : assertFiniteInteger(
          value.sessionZero.completedAtSequence,
          "Session Zero 完成序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if (completed !== (completedBy != null && completedAtSequence != null))
    throw new Error("Session Zero 完成状态不一致。");
  const rawSafety = value.safety;
  const safetyStatus = isObject(rawSafety)
    ? String(rawSafety.status ?? "")
    : "active";
  const safetyReason =
    isObject(rawSafety) && rawSafety.reason != null
      ? String(rawSafety.reason).trim() || null
      : null;
  const safetyChangedBy =
    isObject(rawSafety) && rawSafety.changedBy != null
      ? String(rawSafety.changedBy).trim() || null
      : null;
  const safetyChangedAtSequence =
    isObject(rawSafety) && rawSafety.changedAtSequence != null
      ? assertFiniteInteger(
          rawSafety.changedAtSequence,
          "安全状态变更序号",
          1,
          Number.MAX_SAFE_INTEGER,
        )
      : null;
  if (
    !["active", "paused"].includes(safetyStatus) ||
    (safetyChangedAtSequence == null) !== (safetyChangedBy == null) ||
    (safetyStatus === "paused" && !safetyReason)
  ) {
    throw new Error("正式 TTRPG 安全状态无效。");
  }
  const hiddenDicePolicy =
    value.hiddenDicePolicy == null ? "never" : String(value.hiddenDicePolicy);
  if (!["never", "gm-only", "allowed"].includes(hiddenDicePolicy)) {
    throw new Error("正式 TTRPG 暗骰策略无效。");
  }
  if (
    !Array.isArray(value.sceneKeys) ||
    !Array.isArray(value.clueCatalog) ||
    !Array.isArray(value.discoveredClues)
  ) {
    throw new Error("正式 TTRPG 战役索引无效。");
  }
  const sceneKeys = value.sceneKeys.map((item) => String(item).trim());
  if (
    !sceneKeys.length ||
    sceneKeys.some((item) => !item) ||
    new Set(sceneKeys).size !== sceneKeys.length
  ) {
    throw new Error("正式 TTRPG 场景索引无效。");
  }
  const openedSceneKeys = Array.isArray(value.openedSceneKeys)
    ? value.openedSceneKeys.map((item) => String(item).trim())
    : [];
  if (
    openedSceneKeys.some((key) => !sceneKeys.includes(key)) ||
    new Set(openedSceneKeys).size !== openedSceneKeys.length
  ) {
    throw new Error("正式 TTRPG 已开启场景索引无效。");
  }
  const clueCatalog = value.clueCatalog.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG 线索索引 ${index} 无效。`);
    const clueKey = String(raw.clueKey ?? "").trim();
    const conclusionKey = String(raw.conclusionKey ?? "").trim();
    const sourceVisibility = String(raw.sourceVisibility ?? "");
    if (
      !clueKey ||
      !conclusionKey ||
      typeof raw.required !== "boolean" ||
      !["gm-only", "discoverable", "public"].includes(sourceVisibility)
    ) {
      throw new Error(`正式 TTRPG 线索索引 ${index} 字段无效。`);
    }
    return {
      clueKey,
      conclusionKey,
      required: raw.required,
      sourceVisibility: sourceVisibility as
        "gm-only" | "discoverable" | "public",
    };
  });
  if (
    new Set(clueCatalog.map((item) => item.clueKey)).size !== clueCatalog.length
  ) {
    throw new Error("正式 TTRPG 线索索引重复。");
  }
  const clockCatalog = (
    Array.isArray(value.clockCatalog) ? value.clockCatalog : []
  ).map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG Clock ${index} 无效。`);
    const clockKey = String(raw.clockKey ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const visibility = String(raw.visibility ?? "");
    const onComplete = String(raw.onComplete ?? "").trim();
    const initialValue = assertFiniteInteger(
      raw.initialValue,
      "Clock 初值",
      0,
      99,
    );
    const maximum = assertFiniteInteger(raw.maximum, "Clock 上限", 2, 100);
    if (
      !clockKey ||
      !title ||
      !onComplete ||
      initialValue >= maximum ||
      !["gm-only", "party", "public"].includes(visibility)
    ) {
      throw new Error(`正式 TTRPG Clock ${index} 字段无效。`);
    }
    return {
      clockKey,
      title,
      initialValue,
      maximum,
      visibility: visibility as "gm-only" | "party" | "public",
      onComplete,
    };
  });
  if (
    new Set(clockCatalog.map((item) => item.clockKey)).size !==
    clockCatalog.length
  ) {
    throw new Error("正式 TTRPG Clock 索引重复。");
  }
  const discoveredClues = value.discoveredClues.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`已发现线索 ${index} 无效。`);
    const clueKey = String(raw.clueKey ?? "").trim();
    const actorKey = String(raw.actorKey ?? "").trim();
    const visibility = String(raw.visibility ?? "");
    if (!clueKey || !actorKey || !["private", "party"].includes(visibility))
      throw new Error(`已发现线索 ${index} 字段无效。`);
    return {
      clueKey,
      actorKey,
      visibility: visibility as "private" | "party",
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        "线索发现序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  });
  if (
    new Set(discoveredClues.map((item) => item.clueKey)).size !==
    discoveredClues.length
  )
    throw new Error("同一线索不能重复发现。");
  if (
    !isObject(value.conditions) ||
    !Array.isArray(value.actionHistory) ||
    !Array.isArray(value.gmNarrations) ||
    !Array.isArray(value.questProgress) ||
    !Array.isArray(value.endingCatalog) ||
    !isObject(value.advancement)
  ) {
    throw new Error("正式 TTRPG 规则效果状态无效。");
  }
  const conditions: NonNullable<SimulationTtrpgState["product"]>["conditions"] =
    {};
  for (const [entityKey, rawConditions] of Object.entries(value.conditions)) {
    if (!entityKey || !Array.isArray(rawConditions))
      throw new Error("正式 TTRPG 状态效果索引无效。");
    const parsed = rawConditions.map((raw, index) => {
      if (!isObject(raw))
        throw new Error(`正式 TTRPG 状态效果 ${index} 无效。`);
      const conditionKey = String(raw.conditionKey ?? "").trim();
      if (!conditionKey)
        throw new Error(`正式 TTRPG 状态效果 ${index} key 无效。`);
      return {
        conditionKey,
        stacks: assertFiniteInteger(
          raw.stacks,
          "正式 TTRPG 状态层数",
          1,
          1_000,
        ),
        duration:
          raw.duration == null
            ? null
            : assertFiniteInteger(
                raw.duration,
                "正式 TTRPG 状态时长",
                1,
                1_000_000,
              ),
      };
    });
    if (new Set(parsed.map((item) => item.conditionKey)).size !== parsed.length)
      throw new Error("正式 TTRPG 状态效果重复。");
    conditions[entityKey] = parsed;
  }
  const characterCustomizations = (
    Array.isArray(value.characterCustomizations)
      ? value.characterCustomizations
      : []
  ).map((raw, index) => {
    if (!isObject(raw) || !isObject(raw.attributes))
      throw new Error(`正式 TTRPG 自定义角色 ${index} 无效。`);
    const characterKey = String(raw.characterKey ?? "").trim();
    const name = String(raw.name ?? "").trim();
    const description = String(raw.description ?? "").trim();
    const attributes = Object.fromEntries(
      Object.entries(raw.attributes).map(([key, rawValue]) => {
        const parsed = Number(rawValue);
        if (
          !key.trim() ||
          !Number.isFinite(parsed) ||
          parsed < -1_000_000 ||
          parsed > 1_000_000
        ) {
          throw new Error(`正式 TTRPG 自定义角色 ${index} 属性无效。`);
        }
        return [key.trim(), parsed];
      }),
    );
    if (
      !characterKey ||
      !name ||
      name.length > 300 ||
      !description ||
      description.length > 20_000 ||
      !Object.keys(attributes).length
    )
      throw new Error(`正式 TTRPG 自定义角色 ${index} 字段无效。`);
    if (raw.characterSheet != null && !isObject(raw.characterSheet)) {
      throw new Error(`正式 TTRPG 自定义角色 ${index} 完整角色卡无效。`);
    }
    return {
      characterKey,
      name,
      description,
      attributes,
      ...(raw.characterSheet == null
        ? {}
        : {
            characterSheet: structuredClone(
              raw.characterSheet,
            ) as unknown as TtrpgCharacterSheetV2,
          }),
      customizedAtSequence: assertFiniteInteger(
        raw.customizedAtSequence,
        "角色定制事件序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  });
  if (
    new Set(characterCustomizations.map((item) => item.characterKey)).size !==
    characterCustomizations.length
  ) {
    throw new Error("同一正式角色不能存在多份当前定制。");
  }
  const actionHistory = value.actionHistory.map(assertTtrpgRuleActionResult);
  const intentReceipts = (
    Array.isArray(value.intentReceipts) ? value.intentReceipts : []
  ).map(parseTtrpgIntentReceiptV2);
  if (
    new Set(intentReceipts.map((item) => item.intentKey)).size !==
      intentReceipts.length ||
    intentReceipts.some(
      (item, index) =>
        index > 0 &&
        item.eventSequence <= intentReceipts[index - 1].eventSequence,
    )
  ) {
    throw new Error("正式 TTRPG 行动意图收据重复或乱序。");
  }
  const humanResponses = (
    Array.isArray(value.humanResponses) ? value.humanResponses : []
  ).map(parseTtrpgHumanResponseV2);
  if (
    new Set(humanResponses.map((item) => item.responseKey)).size !==
      humanResponses.length ||
    humanResponses.some(
      (item, index) =>
        index > 0 &&
        item.eventSequence <= humanResponses[index - 1].eventSequence,
    )
  ) {
    throw new Error("真人角色回应重复或乱序。");
  }
  const restHistory = (
    Array.isArray(value.restHistory) ? value.restHistory : []
  ).map(parseTtrpgRestReceiptV2);
  if (
    new Set(restHistory.map((item) => item.restKey)).size !==
      restHistory.length ||
    restHistory.some(
      (item, index) =>
        index > 0 && item.eventSequence <= restHistory[index - 1].eventSequence,
    )
  ) {
    throw new Error("正式 TTRPG 休息账本重复或乱序。");
  }
  const gmNarrations = value.gmNarrations.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG GM 叙事 ${index} 无效。`);
    const text = String(raw.text ?? "").trim();
    const source = raw.source == null ? "ai-confirmed" : String(raw.source);
    const candidateHash =
      raw.candidateHash == null ? null : String(raw.candidateHash);
    const runId =
      raw.runId == null
        ? null
        : assertFiniteInteger(
            raw.runId,
            "GM 叙事 Run ID",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    const modelEvidence = parseTtrpgModelEvidenceV1(raw.modelEvidence);
    const modelCalls = Array.isArray(raw.modelCalls)
      ? raw.modelCalls
          .map(parseTtrpgModelEvidenceV1)
          .filter(
            (item): item is SimulationTtrpgModelEvidenceV1 => item != null,
          )
      : modelEvidence
        ? [modelEvidence]
        : [];
    const repairApplied = raw.repairApplied === true;
    const actionSequence = assertFiniteInteger(
      raw.actionSequence,
      "GM 叙事动作序号",
      1,
      Number.MAX_SAFE_INTEGER,
    );
    const actionReceipt =
      actionHistory.find((action) => action.eventSequence === actionSequence)
        ?.receipt ?? null;
    const synthesisFrame =
      raw.synthesisFrame == null
        ? null
        : actionReceipt
          ? parseTtrpgGmSynthesisFrameV2(raw.synthesisFrame, actionReceipt)
          : (() => {
              throw new Error(
                `正式 TTRPG GM 叙事 ${index} 的综合帧缺少 ActionReceipt。`,
              );
            })();
    if (
      !text ||
      text.length > 20_000 ||
      !["human-gm", "ai-confirmed", "deterministic-fallback"].includes(
        source,
      ) ||
      (source === "ai-confirmed" &&
        (!candidateHash ||
          !/^[0-9a-f]{64}$/.test(candidateHash) ||
          runId == null)) ||
      modelCalls.length > 2 ||
      ((source === "human-gm" || source === "deterministic-fallback") &&
        (candidateHash != null ||
          runId != null ||
          modelEvidence != null ||
          modelCalls.length ||
          repairApplied))
    ) {
      throw new Error(`正式 TTRPG GM 叙事 ${index} 字段无效。`);
    }
    return {
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        "GM 叙事事件序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      actionSequence,
      checkSequence:
        raw.checkSequence == null
          ? null
          : assertFiniteInteger(
              raw.checkSequence,
              "GM 叙事检定序号",
              1,
              Number.MAX_SAFE_INTEGER,
            ),
      text,
      candidateHash,
      runId,
      modelEvidence,
      modelCalls,
      repairApplied,
      synthesisFrame,
      source: source as "human-gm" | "ai-confirmed" | "deterministic-fallback",
    };
  });
  if (
    new Set(gmNarrations.map((item) => item.actionSequence)).size !==
    gmNarrations.length
  ) {
    throw new Error("同一正式规则行动不能记录多份 GM 叙事。");
  }
  const questProgress = value.questProgress.map((raw, index) => {
    if (!isObject(raw) || !Array.isArray(raw.requiredConclusionKeys)) {
      throw new Error(`正式 TTRPG 任务进度 ${index} 无效。`);
    }
    const questKey = String(raw.questKey ?? "").trim();
    const requiredConclusionKeys = raw.requiredConclusionKeys.map((item) =>
      String(item).trim(),
    );
    const status = String(raw.status ?? "");
    const completedAtSequence =
      raw.completedAtSequence == null
        ? null
        : assertFiniteInteger(
            raw.completedAtSequence,
            "任务完成序号",
            1,
            Number.MAX_SAFE_INTEGER,
          );
    if (
      !questKey ||
      !requiredConclusionKeys.length ||
      requiredConclusionKeys.some((item) => !item) ||
      new Set(requiredConclusionKeys).size !== requiredConclusionKeys.length ||
      !["active", "completed"].includes(status) ||
      (status === "completed") !== (completedAtSequence != null)
    ) {
      throw new Error(`正式 TTRPG 任务进度 ${index} 字段无效。`);
    }
    return {
      questKey,
      requiredConclusionKeys,
      status: status as "active" | "completed",
      completedAtSequence,
    };
  });
  if (
    !questProgress.length ||
    new Set(questProgress.map((item) => item.questKey)).size !==
      questProgress.length
  ) {
    throw new Error("正式 TTRPG 任务索引无效或重复。");
  }
  const endingCatalog = value.endingCatalog.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`正式 TTRPG 结局 ${index} 无效。`);
    const endingKey = String(raw.endingKey ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const epilogue = String(raw.epilogue ?? "").trim();
    if (
      !endingKey ||
      !title ||
      !epilogue ||
      title.length > 300 ||
      epilogue.length > 20_000
    ) {
      throw new Error(`正式 TTRPG 结局 ${index} 字段无效。`);
    }
    let trigger: NonNullable<
      SimulationTtrpgState["product"]
    >["endingCatalog"][number]["trigger"] = null;
    if (raw.trigger != null) {
      if (!isObject(raw.trigger))
        throw new Error(`正式 TTRPG 结局 ${index} trigger 无效。`);
      const sceneKey = String(raw.trigger.sceneKey ?? "").trim();
      const requiredConclusionKeys = Array.isArray(
        raw.trigger.requiredConclusionKeys,
      )
        ? raw.trigger.requiredConclusionKeys.map((item) => String(item).trim())
        : [];
      const forbiddenConclusionKeys = Array.isArray(
        raw.trigger.forbiddenConclusionKeys,
      )
        ? raw.trigger.forbiddenConclusionKeys.map((item) => String(item).trim())
        : [];
      const knownConclusions = new Set(
        clueCatalog.map((item) => item.conclusionKey),
      );
      if (
        !sceneKeys.includes(sceneKey) ||
        requiredConclusionKeys.some((key) => !knownConclusions.has(key)) ||
        forbiddenConclusionKeys.some((key) => !knownConclusions.has(key)) ||
        requiredConclusionKeys.some((key) =>
          forbiddenConclusionKeys.includes(key),
        ) ||
        new Set(requiredConclusionKeys).size !==
          requiredConclusionKeys.length ||
        new Set(forbiddenConclusionKeys).size !== forbiddenConclusionKeys.length
      ) {
        throw new Error(`正式 TTRPG 结局 ${index} trigger 字段无效。`);
      }
      trigger = { sceneKey, requiredConclusionKeys, forbiddenConclusionKeys };
    }
    return { endingKey, title, epilogue, trigger };
  });
  if (
    endingCatalog.length < 2 ||
    new Set(endingCatalog.map((item) => item.endingKey)).size !==
      endingCatalog.length
  ) {
    throw new Error("正式 TTRPG 结局索引无效或重复。");
  }
  let ending: NonNullable<SimulationTtrpgState["product"]>["ending"] = null;
  if (value.ending != null) {
    if (!isObject(value.ending)) throw new Error("正式 TTRPG 已选结局无效。");
    const endingKey = String(value.ending.endingKey ?? "").trim();
    if (!endingCatalog.some((item) => item.endingKey === endingKey))
      throw new Error("正式 TTRPG 已选结局不在目录中。");
    ending = {
      endingKey,
      eventSequence: assertFiniteInteger(
        value.ending.eventSequence,
        "战役结局序号",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
    };
  }
  const currencyKey = String(value.advancement.currencyKey ?? "").trim();
  const currencyName = String(value.advancement.currencyName ?? "").trim();
  const totalAwarded = assertFiniteInteger(
    value.advancement.totalAwarded,
    "成长奖励总额",
    0,
    1_000_000_000,
  );
  if (
    !Array.isArray(value.advancement.milestones) ||
    !Array.isArray(value.advancement.awardedMilestoneKeys)
  ) {
    throw new Error("正式 TTRPG 成长里程碑无效。");
  }
  const milestones = value.advancement.milestones.map((raw, index) => {
    if (!isObject(raw)) throw new Error(`成长里程碑 ${index} 无效。`);
    const milestoneKey = String(raw.milestoneKey ?? "").trim();
    const title = String(raw.title ?? "").trim();
    const award = assertFiniteInteger(
      raw.award,
      "成长里程碑奖励",
      0,
      1_000_000,
    );
    if (!milestoneKey || !title || title.length > 300)
      throw new Error(`成长里程碑 ${index} 字段无效。`);
    return { milestoneKey, title, award };
  });
  const awardedMilestoneKeys = value.advancement.awardedMilestoneKeys.map(
    (item) => String(item).trim(),
  );
  if (
    !currencyKey ||
    !currencyName ||
    !milestones.length ||
    new Set(milestones.map((item) => item.milestoneKey)).size !==
      milestones.length ||
    awardedMilestoneKeys.some(
      (key) => !milestones.some((item) => item.milestoneKey === key),
    ) ||
    new Set(awardedMilestoneKeys).size !== awardedMilestoneKeys.length ||
    totalAwarded !==
      milestones
        .filter((item) => awardedMilestoneKeys.includes(item.milestoneKey))
        .reduce((sum, item) => sum + item.award, 0)
  ) {
    throw new Error("正式 TTRPG 成长投影不一致。");
  }
  const tabletop = parseTtrpgTabletopStateV1(value.tabletop);
  const media = parseTtrpgMediaStateV1(value.media);
  const actionEconomy =
    value.actionEconomy == null
      ? null
      : parseTtrpgActionEconomyV2(value.actionEconomy);
  const inventory =
    value.inventory == null
      ? null
      : parseTtrpgInventoryStateV2(value.inventory);
  const itemSnapshot = (
    raw: unknown,
    itemInstanceId: string,
    label: string,
  ): SimulationTtrpgItemReceiptV2["before"] => {
    if (raw == null) return null;
    try {
      return parseTtrpgInventoryStateV2({
        schema: "storyforge.ttrpg-inventory",
        version: 2,
        items: { [itemInstanceId]: raw },
        appliedCommandIds: [],
      }).items[itemInstanceId];
    } catch (error) {
      throw new Error(
        `${label} 无效：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const itemHistory: SimulationTtrpgItemReceiptV2[] = Array.isArray(
    value.itemHistory,
  )
    ? value.itemHistory.map((raw, index) => {
        if (!isObject(raw) || !isObject(raw.requestedBy)) {
          throw new Error(`正式 TTRPG 物品收据 ${index} 无效。`);
        }
        const itemInstanceId = String(raw.itemInstanceId ?? "").trim();
        const definitionRef = String(raw.definitionRef ?? "").trim();
        const commandId = String(raw.commandId ?? "").trim();
        const operation = String(
          raw.operation ?? "",
        ) as SimulationTtrpgItemReceiptV2["operation"];
        const role = String(raw.requestedBy.role ?? "");
        const actorKey = String(raw.requestedBy.actorKey ?? "").trim();
        const eventSequence = assertFiniteInteger(
          raw.eventSequence,
          "物品收据事件序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
        if (
          raw.schema !== "storyforge.ttrpg-item-receipt" ||
          raw.version !== 2 ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(itemInstanceId) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(definitionRef) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(commandId) ||
          ![
            "grant",
            "remove",
            "transfer",
            "use",
            "equip",
            "unequip",
            "attune",
            "damage",
            "repair",
          ].includes(operation) ||
          !["gm", "player"].includes(role) ||
          !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey)
        ) {
          throw new Error(`正式 TTRPG 物品收据 ${index} 字段无效。`);
        }
        const before = itemSnapshot(
          raw.before,
          itemInstanceId,
          `物品收据 ${index}.before`,
        );
        const after = itemSnapshot(
          raw.after,
          itemInstanceId,
          `物品收据 ${index}.after`,
        );
        if (
          (!before && !after) ||
          (before?.definitionRef ?? after?.definitionRef) !== definitionRef
        ) {
          throw new Error(`正式 TTRPG 物品收据 ${index} 前后状态不一致。`);
        }
        return {
          schema: "storyforge.ttrpg-item-receipt",
          version: 2,
          eventSequence,
          commandId,
          operation,
          itemInstanceId,
          definitionRef,
          requestedBy: { role: role as "gm" | "player", actorKey },
          before,
          after,
        };
      })
    : [];
  if (
    itemHistory.length > 100_000 ||
    new Set(itemHistory.map((item) => item.eventSequence)).size !==
      itemHistory.length ||
    new Set(itemHistory.map((item) => item.commandId)).size !==
      itemHistory.length
  ) {
    throw new Error("正式 TTRPG 物品收据过多或重复。");
  }
  const abilityStates =
    value.abilityStates == null
      ? null
      : (() => {
          if (
            !isObject(value.abilityStates) ||
            Object.keys(value.abilityStates).length > 10_000
          ) {
            throw new Error("正式 TTRPG 能力状态无效。");
          }
          return Object.fromEntries(
            Object.entries(value.abilityStates).map(([stateKey, raw]) => {
              const parsed = parseTtrpgAbilityRuntimeStateV2(raw);
              if (
                stateKey !==
                ttrpgAbilityStateKeyV2(
                  parsed.actorInstanceId,
                  parsed.abilityKey,
                )
              ) {
                throw new Error(`正式 TTRPG 能力状态索引不一致:${stateKey}`);
              }
              return [stateKey, parsed];
            }),
          );
        })();
  const usagePools =
    value.usagePools == null
      ? null
      : (() => {
          if (
            !isObject(value.usagePools) ||
            Object.keys(value.usagePools).length > 1_000
          ) {
            throw new Error("正式 TTRPG 共享次数池无效。");
          }
          return Object.fromEntries(
            Object.entries(value.usagePools).map(([poolKey, raw]) => {
              const parsed = parseTtrpgUsagePoolStateV2(raw);
              if (parsed.poolKey !== poolKey)
                throw new Error(`正式 TTRPG 共享次数池索引不一致:${poolKey}`);
              return [poolKey, parsed];
            }),
          );
        })();
  const effectLedger =
    value.effectLedger == null
      ? null
      : parseTtrpgEffectLedgerStateV2(value.effectLedger);
  const characterProgression: NonNullable<
    SimulationTtrpgState["product"]
  >["characterProgression"] =
    value.characterProgression == null
      ? null
      : (() => {
          if (
            !isObject(value.characterProgression) ||
            Object.keys(value.characterProgression).length > 256
          ) {
            throw new Error("正式 TTRPG 角色成长索引无效。");
          }
          return Object.fromEntries(
            Object.entries(value.characterProgression).map(
              ([characterKey, raw]) => {
                if (
                  !characterKey.trim() ||
                  !isObject(raw) ||
                  !isObject(raw.attributeIncreases) ||
                  !isObject(raw.skillIncreases) ||
                  !Array.isArray(raw.history) ||
                  raw.history.length > 10_000
                ) {
                  throw new Error(`正式 TTRPG 角色成长无效:${characterKey}`);
                }
                const model = String(raw.model);
                if (
                  !["numeric-level", "rank", "point-buy", "classless"].includes(
                    model,
                  )
                )
                  throw new Error("角色成长模式无效。");
                const level =
                  raw.level == null
                    ? null
                    : assertFiniteInteger(raw.level, "角色等级", 1, 1_000);
                const rankKey =
                  raw.rankKey == null
                    ? null
                    : String(raw.rankKey).trim() || null;
                if (
                  (model === "numeric-level") !== (level != null) ||
                  (model === "rank") !== (rankKey != null)
                ) {
                  throw new Error(
                    `角色成长等级/阶位与模式不一致:${characterKey}`,
                  );
                }
                const parseIncreases = (
                  source: Record<string, unknown>,
                  label: string,
                ) =>
                  Object.fromEntries(
                    Object.entries(source).map(([entryKey, amount]) => {
                      if (!entryKey.trim())
                        throw new Error(`${label} key 无效。`);
                      return [
                        entryKey,
                        assertFiniteInteger(amount, label, 0, 1_000_000),
                      ];
                    }),
                  );
                const history = raw.history.map((entry, index) => {
                  if (
                    !isObject(entry) ||
                    !["attribute", "skill", "level", "rank"].includes(
                      String(entry.kind),
                    )
                  ) {
                    throw new Error(`角色成长历史 ${index} 无效。`);
                  }
                  const targetKey = String(entry.targetKey ?? "").trim();
                  const before = entry.before;
                  const after = entry.after;
                  if (
                    !targetKey ||
                    !["string", "number"].includes(typeof before) ||
                    !["string", "number"].includes(typeof after) ||
                    typeof before !== typeof after
                  )
                    throw new Error(`角色成长历史 ${index} 前后值无效。`);
                  return {
                    eventSequence: assertFiniteInteger(
                      entry.eventSequence,
                      "成长事件序号",
                      1,
                      Number.MAX_SAFE_INTEGER,
                    ),
                    kind: String(entry.kind) as
                      "attribute" | "skill" | "level" | "rank",
                    targetKey,
                    before: before as number | string,
                    after: after as number | string,
                    cost: assertFiniteInteger(
                      entry.cost,
                      "成长消耗",
                      1,
                      1_000_000,
                    ),
                  };
                });
                const spentCurrency = assertFiniteInteger(
                  raw.spentCurrency,
                  "成长已消费货币",
                  0,
                  1_000_000_000,
                );
                if (
                  history.reduce((sum, entry) => sum + entry.cost, 0) !==
                  spentCurrency
                )
                  throw new Error("成长历史消费与余额不一致。");
                return [
                  characterKey,
                  {
                    model: model as
                      "numeric-level" | "rank" | "point-buy" | "classless",
                    level,
                    rankKey,
                    spentCurrency,
                    attributeIncreases: parseIncreases(
                      raw.attributeIncreases,
                      "属性成长次数",
                    ),
                    skillIncreases: parseIncreases(
                      raw.skillIncreases,
                      "技能成长次数",
                    ),
                    history,
                  },
                ];
              },
            ),
          );
        })();
  return {
    rulePackContentHash: String(value.rulePackContentHash),
    campaignKey,
    campaignTitle,
    openingSceneKey,
    sessionZero: {
      completed,
      requiredItemKeys,
      acceptedItemKeys,
      selectedCharacterKeys,
      completedBy,
      completedAtSequence,
    },
    safety: {
      status: safetyStatus as "active" | "paused",
      reason: safetyReason,
      changedBy: safetyChangedBy,
      changedAtSequence: safetyChangedAtSequence,
    },
    hiddenDicePolicy: hiddenDicePolicy as "never" | "gm-only" | "allowed",
    sceneKeys,
    openedSceneKeys,
    clueCatalog,
    clockCatalog,
    discoveredClues,
    conditions,
    actionEconomy,
    inventory,
    itemHistory,
    abilityStates,
    usagePools,
    effectLedger,
    characterProgression,
    characterCustomizations,
    actionHistory,
    intentReceipts,
    humanResponses,
    restHistory,
    gmNarrations,
    questProgress,
    endingCatalog,
    ending,
    advancement: {
      currencyKey,
      currencyName,
      totalAwarded,
      milestones,
      awardedMilestoneKeys,
    },
    tabletop,
    media,
  };
}

function parseTtrpgState(value: unknown): SimulationTtrpgState | null {
  if (value == null) return null;
  if (!isObject(value)) throw new Error("跑团状态必须是对象或 null。");
  const scene = value.scene == null ? null : assertTtrpgScene(value.scene);
  const round = assertFiniteInteger(
    value.round,
    "跑团回合",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const activeActorKey =
    value.activeActorKey == null
      ? null
      : String(value.activeActorKey).trim() || null;
  if (!Array.isArray(value.turnOrder))
    throw new Error("跑团回合顺序必须是数组。");
  const turnOrder = value.turnOrder.map((raw) => String(raw).trim());
  if (
    turnOrder.some((key) => !key || key.length > 160) ||
    new Set(turnOrder).size !== turnOrder.length
  ) {
    throw new Error("跑团回合顺序包含无效或重复行动者。");
  }
  if (activeActorKey != null && !turnOrder.includes(activeActorKey))
    throw new Error("跑团当前行动者不在回合顺序中。");
  const initiative: SimulationTtrpgState["initiative"] =
    value.initiative == null
      ? null
      : (() => {
          if (
            !isObject(value.initiative) ||
            !Array.isArray(value.initiative.entries)
          )
            throw new Error("跑团先攻收据无效。");
          const sceneKey = String(value.initiative.sceneKey ?? "").trim();
          const diceModelKey = String(
            value.initiative.diceModelKey ?? "",
          ).trim();
          const attributeKey = String(
            value.initiative.attributeKey ?? "",
          ).trim();
          const entries = value.initiative.entries.map((raw, index) => {
            if (
              !isObject(raw) ||
              !Array.isArray(raw.rolledDice) ||
              !Array.isArray(raw.keptDice)
            )
              throw new Error(`跑团先攻项 ${index} 无效。`);
            const actorKey = String(raw.actorKey ?? "").trim();
            const rolledDice = raw.rolledDice.map((die) =>
              assertFiniteInteger(die, "先攻原始骰点", 1, 100),
            );
            const keptDice = raw.keptDice.map((die) =>
              assertFiniteInteger(die, "先攻保留骰点", 1, 100),
            );
            const modifier = assertFiniteInteger(
              raw.modifier,
              "先攻修正",
              -1_000,
              1_000,
            );
            const total = assertFiniteInteger(
              raw.total,
              "先攻总值",
              -100_000,
              100_000,
            );
            const seedCommitment = String(raw.seedCommitment ?? "");
            const nonce = String(raw.nonce ?? "");
            const proofHash = String(raw.proofHash ?? "");
            if (
              !actorKey ||
              !keptDice.length ||
              total !== keptDice.reduce((sum, die) => sum + die, modifier) ||
              !/^[a-f0-9]{64}$/.test(seedCommitment) ||
              !nonce ||
              nonce.length > 10_000 ||
              !/^[a-f0-9]{64}$/.test(proofHash)
            ) {
              throw new Error(`跑团先攻项 ${index} 证据不一致。`);
            }
            return {
              actorKey,
              rolledDice,
              keptDice,
              modifier,
              total,
              rollTrace: assertTtrpgDiceRollTraceV2(raw.rollTrace),
              seedCommitment,
              nonce,
              proofHash,
            };
          });
          if (
            !sceneKey ||
            !diceModelKey ||
            !attributeKey ||
            entries.length !== turnOrder.length ||
            entries.some((entry, index) => entry.actorKey !== turnOrder[index])
          )
            throw new Error("跑团先攻顺序与回合顺序不一致。");
          return { sceneKey, diceModelKey, attributeKey, entries };
        })();
  if (!Array.isArray(value.actions) || !Array.isArray(value.checks))
    throw new Error("跑团动作与检定记录必须是数组。");
  if (value.attacks != null && !Array.isArray(value.attacks))
    throw new Error("跑团攻击记录必须是数组。");
  return {
    scene,
    round,
    activeActorKey,
    turnOrder,
    initiative,
    actions: value.actions.map(assertTtrpgAction),
    checks: value.checks.map(assertTtrpgCheck),
    attacks: (value.attacks ?? []).map(assertTtrpgAttackResult),
    encounter:
      value.encounter == null ? null : assertTtrpgEncounter(value.encounter),
    campaign: parseTtrpgCampaignState(value.campaign),
    product: parseTtrpgProductState(value.product),
  };
}

function emptyTtrpgCampaignState(): SimulationTtrpgCampaignState {
  return {
    summary: "",
    quests: [],
    npcSchedules: [],
    activeSessionKey: null,
    playSessions: [],
    roster: [],
    memories: [],
    supplements: [],
    worldEvolution: [],
    versionTransitions: [],
  };
}

function assertTtrpgQuest(value: unknown): SimulationTtrpgQuest {
  if (!isObject(value)) throw new Error("战役任务必须是对象。");
  const questId = String(value.questId ?? "").trim();
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  const status = String(value.status ?? "") as SimulationTtrpgQuestStatus;
  if (!questId || questId.length > 160) throw new Error("战役任务 ID 无效。");
  if (!title || title.length > 240) throw new Error("战役任务标题无效。");
  if (description.length > 8_000) throw new Error("战役任务描述过长。");
  if (!SIMULATION_TTRPG_QUEST_STATUSES.includes(status))
    throw new Error(`未知战役任务状态: ${status}`);
  const dueClock =
    value.dueClock == null
      ? null
      : assertFiniteInteger(
          value.dueClock,
          "任务期限",
          0,
          Number.MAX_SAFE_INTEGER,
        );
  return {
    questId,
    title,
    description,
    status,
    priority: assertFiniteInteger(value.priority ?? 0, "任务优先级", 0, 5),
    dueClock,
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "任务更新时间序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function assertTtrpgNpcSchedule(value: unknown): SimulationTtrpgNpcSchedule {
  if (!isObject(value)) throw new Error("NPC 日程必须是对象。");
  const scheduleId = String(value.scheduleId ?? "").trim();
  const entityKey = String(value.entityKey ?? "").trim();
  const activity = String(value.activity ?? "").trim();
  const recurrence = String(value.recurrence ?? "once");
  if (!scheduleId || scheduleId.length > 160)
    throw new Error("NPC 日程 ID 无效。");
  if (!entityKey || entityKey.length > 160)
    throw new Error("NPC 日程缺少 NPC。");
  if (!activity || activity.length > 2_000)
    throw new Error("NPC 日程活动无效。");
  if (!["once", "daily", "weekly"].includes(recurrence))
    throw new Error(`未知 NPC 日程重复方式: ${recurrence}`);
  const startClock = assertFiniteInteger(
    value.startClock,
    "NPC 日程开始时间",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const endClock =
    value.endClock == null
      ? null
      : assertFiniteInteger(
          value.endClock,
          "NPC 日程结束时间",
          startClock,
          Number.MAX_SAFE_INTEGER,
        );
  const locationKey =
    value.locationKey == null ? null : String(value.locationKey).trim() || null;
  return {
    scheduleId,
    entityKey,
    startClock,
    endClock,
    locationKey,
    activity,
    recurrence: recurrence as SimulationTtrpgNpcSchedule["recurrence"],
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "日程更新时间序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

const TTRPG_LONG_CAMPAIGN_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const TTRPG_SHA256 = /^[0-9a-f]{64}$/;

function longCampaignKey(value: unknown, label: string): string {
  const parsed = String(value ?? "").trim();
  if (!TTRPG_LONG_CAMPAIGN_KEY.test(parsed))
    throw new Error(`${label} 不是稳定 key。`);
  return parsed;
}

function longCampaignText(
  value: unknown,
  label: string,
  maximum: number,
  allowEmpty = false,
): string {
  const parsed = String(value ?? "")
    .trim()
    .normalize("NFC");
  if ((!allowEmpty && !parsed) || parsed.length > maximum)
    throw new Error(`${label} 为空或过长。`);
  return parsed;
}

function assertTtrpgCampaignPlaySessionV2(
  value: unknown,
): SimulationTtrpgCampaignSessionV2 {
  if (!isObject(value)) throw new Error("长期战役分场必须是对象。");
  const status = String(value.status ?? "");
  if (!Array.isArray(value.participantKeys))
    throw new Error("长期战役分场缺少参与者。");
  const participantKeys = value.participantKeys.map((item) =>
    longCampaignKey(item, "长期战役参与者"),
  );
  if (
    participantKeys.length < 1 ||
    participantKeys.length > 12 ||
    new Set(participantKeys).size !== participantKeys.length ||
    !["active", "completed", "cancelled"].includes(status) ||
    !TTRPG_SHA256.test(String(value.rulePackContentHash ?? ""))
  ) {
    throw new Error("长期战役分场字段无效。");
  }
  const completedSequence =
    value.completedSequence == null
      ? null
      : assertFiniteInteger(
          value.completedSequence,
          "长期战役分场完成序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if ((status === "active") !== (completedSequence == null))
    throw new Error("长期战役分场状态与完成序号不一致。");
  return {
    sessionKey: longCampaignKey(value.sessionKey, "长期战役分场 key"),
    ordinal: assertFiniteInteger(value.ordinal, "长期战役分场序号", 1, 10_000),
    title: longCampaignText(value.title, "长期战役分场标题", 300),
    status: status as SimulationTtrpgCampaignSessionV2["status"],
    participantKeys,
    startedSequence: assertFiniteInteger(
      value.startedSequence,
      "长期战役分场开始序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
    completedSequence,
    summary: longCampaignText(
      value.summary,
      "长期战役分场摘要",
      20_000,
      status === "active",
    ),
    rulePackContentHash: String(value.rulePackContentHash),
    campaignKey: longCampaignKey(value.campaignKey, "长期战役 Campaign key"),
  };
}

function assertTtrpgRosterEntryV2(
  value: unknown,
): SimulationTtrpgRosterEntryV2 {
  if (!isObject(value)) throw new Error("长期战役编组必须是对象。");
  const status = String(value.status ?? "");
  if (!["active", "reserve", "retired"].includes(status))
    throw new Error("长期战役编组状态无效。");
  const joinedSessionKey =
    value.joinedSessionKey == null
      ? null
      : longCampaignKey(value.joinedSessionKey, "角色加入分场");
  const leftSessionKey =
    value.leftSessionKey == null
      ? null
      : longCampaignKey(value.leftSessionKey, "角色离开分场");
  const replacementFor =
    value.replacementFor == null
      ? null
      : longCampaignKey(value.replacementFor, "补员替代角色");
  if ((status === "retired") !== (leftSessionKey != null))
    throw new Error("退场角色必须记录离开分场，未退场角色不得记录离开分场。");
  return {
    characterKey: longCampaignKey(value.characterKey, "长期战役角色"),
    status: status as SimulationTtrpgRosterEntryV2["status"],
    joinedSessionKey,
    leftSessionKey,
    replacementFor,
    reason: longCampaignText(value.reason, "编组变更理由", 2_000, true),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "编组更新序号",
      0,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function assertTtrpgCampaignMemoryV2(
  value: unknown,
): SimulationTtrpgCampaignMemoryV2 {
  if (!isObject(value)) throw new Error("长期战役记忆必须是对象。");
  const audience = String(value.audience ?? "");
  if (
    audience !== "party" &&
    audience !== "gm-only" &&
    !/^actor:[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(audience)
  ) {
    throw new Error("长期战役记忆受众无效。");
  }
  return {
    memoryKey: longCampaignKey(value.memoryKey, "长期战役记忆 key"),
    subjectKey: longCampaignKey(value.subjectKey, "长期战役记忆主体"),
    summary: longCampaignText(value.summary, "长期战役记忆摘要", 4_000),
    audience: audience as SimulationTtrpgCampaignMemoryV2["audience"],
    sourceSessionKey: longCampaignKey(value.sourceSessionKey, "记忆来源分场"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "记忆更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function assertTtrpgSupplementReceiptV2(
  value: unknown,
): SimulationTtrpgSupplementReceiptV2 {
  if (!isObject(value)) throw new Error("补充包收据必须是对象。");
  const compatibility = String(value.compatibility ?? "");
  if (
    !["same-release", "next-release"].includes(compatibility) ||
    !TTRPG_SHA256.test(String(value.contentHash ?? ""))
  ) {
    throw new Error("补充包收据字段无效。");
  }
  return {
    supplementKey: longCampaignKey(value.supplementKey, "补充包 key"),
    title: longCampaignText(value.title, "补充包标题", 300),
    contentHash: String(value.contentHash),
    compatibility:
      compatibility as SimulationTtrpgSupplementReceiptV2["compatibility"],
    sourceRef: longCampaignKey(value.sourceRef, "补充包来源"),
    activatedSessionKey:
      value.activatedSessionKey == null
        ? null
        : longCampaignKey(value.activatedSessionKey, "补充包激活分场"),
    approvedBy: longCampaignKey(value.approvedBy, "补充包批准者"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "补充包更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function assertTtrpgWorldEvolutionV2(
  value: unknown,
): SimulationTtrpgWorldEvolutionV2 {
  if (!isObject(value)) throw new Error("世界演化候选必须是对象。");
  const category = String(value.category ?? "");
  const status = String(value.status ?? "");
  if (
    !["character", "location", "faction", "artifact", "event", "lore"].includes(
      category,
    ) ||
    !["proposed", "approved-for-world-review", "rejected"].includes(status)
  ) {
    throw new Error("世界演化候选字段无效。");
  }
  return {
    candidateKey: longCampaignKey(value.candidateKey, "世界演化候选 key"),
    category: category as SimulationTtrpgWorldEvolutionV2["category"],
    summary: longCampaignText(value.summary, "世界演化摘要", 8_000),
    sourceSessionKey: longCampaignKey(
      value.sourceSessionKey,
      "世界演化来源分场",
    ),
    status: status as SimulationTtrpgWorldEvolutionV2["status"],
    targetWorldRef:
      value.targetWorldRef == null
        ? null
        : longCampaignKey(value.targetWorldRef, "世界演化目标"),
    reviewedBy:
      value.reviewedBy == null
        ? null
        : longCampaignKey(value.reviewedBy, "世界演化审核者"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "世界演化更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function assertTtrpgVersionTransitionV2(
  value: unknown,
): SimulationTtrpgVersionTransitionV2 {
  if (!isObject(value)) throw new Error("版本迁移记录必须是对象。");
  const compatibility = String(value.compatibility ?? "");
  const status = String(value.status ?? "");
  if (
    !["same-content", "compatible", "manual-migration", "breaking"].includes(
      compatibility,
    ) ||
    !["planned", "activated", "rejected"].includes(status) ||
    !TTRPG_SHA256.test(String(value.fromRulePackContentHash ?? "")) ||
    !TTRPG_SHA256.test(String(value.toRulePackContentHash ?? ""))
  ) {
    throw new Error("版本迁移记录字段无效。");
  }
  return {
    transitionKey: longCampaignKey(value.transitionKey, "版本迁移 key"),
    fromRulePackContentHash: String(value.fromRulePackContentHash),
    toRulePackContentHash: String(value.toRulePackContentHash),
    fromCampaignKey: longCampaignKey(
      value.fromCampaignKey,
      "迁移前 Campaign key",
    ),
    toCampaignKey: longCampaignKey(value.toCampaignKey, "迁移后 Campaign key"),
    compatibility:
      compatibility as SimulationTtrpgVersionTransitionV2["compatibility"],
    status: status as SimulationTtrpgVersionTransitionV2["status"],
    notes: longCampaignText(value.notes, "版本迁移说明", 8_000),
    approvedBy: longCampaignKey(value.approvedBy, "版本迁移批准者"),
    updatedSequence: assertFiniteInteger(
      value.updatedSequence,
      "版本迁移更新序号",
      1,
      Number.MAX_SAFE_INTEGER,
    ),
  };
}

function parseTtrpgCampaignState(value: unknown): SimulationTtrpgCampaignState {
  if (value == null) return emptyTtrpgCampaignState();
  if (!isObject(value)) throw new Error("长期战役状态必须是对象。");
  const summary = String(value.summary ?? "").trim();
  if (summary.length > 20_000) throw new Error("长期战役摘要过长。");
  if (!Array.isArray(value.quests) || !Array.isArray(value.npcSchedules)) {
    throw new Error("长期战役任务和 NPC 日程必须是数组。");
  }
  const quests = value.quests.map(assertTtrpgQuest);
  const npcSchedules = value.npcSchedules.map(assertTtrpgNpcSchedule);
  if (new Set(quests.map((quest) => quest.questId)).size !== quests.length)
    throw new Error("战役任务 ID 不能重复。");
  if (
    new Set(npcSchedules.map((schedule) => schedule.scheduleId)).size !==
    npcSchedules.length
  )
    throw new Error("NPC 日程 ID 不能重复。");
  const playSessions = Array.isArray(value.playSessions)
    ? value.playSessions.map(assertTtrpgCampaignPlaySessionV2)
    : [];
  const roster = Array.isArray(value.roster)
    ? value.roster.map(assertTtrpgRosterEntryV2)
    : [];
  const memories = Array.isArray(value.memories)
    ? value.memories.map(assertTtrpgCampaignMemoryV2)
    : [];
  const supplements = Array.isArray(value.supplements)
    ? value.supplements.map(assertTtrpgSupplementReceiptV2)
    : [];
  const worldEvolution = Array.isArray(value.worldEvolution)
    ? value.worldEvolution.map(assertTtrpgWorldEvolutionV2)
    : [];
  const versionTransitions = Array.isArray(value.versionTransitions)
    ? value.versionTransitions.map(assertTtrpgVersionTransitionV2)
    : [];
  const activeSessionKey =
    value.activeSessionKey == null
      ? null
      : longCampaignKey(value.activeSessionKey, "当前长期战役分场");
  const unique = <T>(items: T[], pick: (item: T) => string, label: string) => {
    if (new Set(items.map(pick)).size !== items.length)
      throw new Error(`${label} 不能重复。`);
  };
  unique(playSessions, (item) => item.sessionKey, "长期战役分场 key");
  unique(playSessions, (item) => String(item.ordinal), "长期战役分场序号");
  unique(roster, (item) => item.characterKey, "长期战役角色");
  unique(memories, (item) => item.memoryKey, "长期战役记忆 key");
  unique(supplements, (item) => item.supplementKey, "补充包 key");
  unique(worldEvolution, (item) => item.candidateKey, "世界演化候选 key");
  unique(versionTransitions, (item) => item.transitionKey, "版本迁移 key");
  const active = playSessions.filter((item) => item.status === "active");
  if (
    active.length > 1 ||
    (activeSessionKey == null) !== (active.length === 0) ||
    (activeSessionKey != null && active[0]?.sessionKey !== activeSessionKey)
  ) {
    throw new Error("长期战役当前分场索引不一致。");
  }
  const sessionKeys = new Set(playSessions.map((item) => item.sessionKey));
  if (
    roster.some(
      (item) =>
        (item.joinedSessionKey != null &&
          !sessionKeys.has(item.joinedSessionKey)) ||
        (item.leftSessionKey != null && !sessionKeys.has(item.leftSessionKey)),
    ) ||
    memories.some((item) => !sessionKeys.has(item.sourceSessionKey)) ||
    worldEvolution.some((item) => !sessionKeys.has(item.sourceSessionKey))
  ) {
    throw new Error("长期战役引用了不存在的分场。");
  }
  return {
    summary,
    quests,
    npcSchedules,
    activeSessionKey,
    playSessions,
    roster,
    memories,
    supplements,
    worldEvolution,
    versionTransitions,
  };
}

function requireTtrpgState(
  state: SimulationRuntimeState,
): SimulationTtrpgState {
  if (!state.ttrpg) state.ttrpg = emptyTtrpgState();
  return state.ttrpg;
}

export function parseSimulationTtrpgTurnCandidate(
  value: unknown,
): SimulationTtrpgTurnCandidate {
  if (!isObject(value)) throw new Error("跑团回合候选必须是对象。");
  const allowed = new Set([
    "baseSequence",
    "actorKey",
    "action",
    "narrative",
    "check",
    "outcomes",
    "nextActorKey",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`跑团回合候选包含未知字段: ${unknown.join(", ")}`);
  const baseSequence = assertFiniteInteger(
    value.baseSequence,
    "跑团候选基线序号",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const actorKey = String(value.actorKey ?? "").trim();
  const action = String(value.action ?? "").trim();
  const narrative = String(value.narrative ?? "").trim();
  const nextActorKey =
    value.nextActorKey == null
      ? null
      : String(value.nextActorKey).trim() || null;
  if (!actorKey || actorKey.length > 160)
    throw new Error("跑团候选缺少行动者。");
  if (!action || action.length > 4_000) throw new Error("跑团候选动作无效。");
  if (!narrative || narrative.length > 20_000)
    throw new Error("跑团候选叙事无效。");
  let check: SimulationTtrpgCheckRequest | null = null;
  if (value.check != null) {
    if (!isObject(value.check))
      throw new Error("跑团检定候选必须是对象或 null。");
    const skill = String(value.check.skill ?? "").trim();
    const expression = String(value.check.expression ?? "").trim();
    const reason = String(value.check.reason ?? "").trim();
    const dc = assertFiniteInteger(value.check.dc, "检定难度", 0, 1_000);
    parseDiceExpression(expression);
    if (!skill || skill.length > 120) throw new Error("跑团候选技能无效。");
    if (!reason || reason.length > 1_000)
      throw new Error("跑团候选检定理由无效。");
    check = { skill, expression, dc, reason };
  }
  let outcomes: SimulationTtrpgTurnCandidate["outcomes"] = null;
  if (value.outcomes != null) {
    if (!isObject(value.outcomes))
      throw new Error("跑团检定分支叙事必须是对象或 null。");
    const success = String(value.outcomes.success ?? "").trim();
    const failure = String(value.outcomes.failure ?? "").trim();
    if (
      !success ||
      !failure ||
      success.length > 20_000 ||
      failure.length > 20_000
    ) {
      throw new Error("跑团检定成功/失败叙事无效。");
    }
    outcomes = { success, failure };
  }
  if ((check == null) !== (outcomes == null))
    throw new Error("跑团检定与成功/失败叙事必须同时提供。");
  return {
    baseSequence,
    actorKey,
    action,
    narrative,
    check,
    outcomes,
    nextActorKey,
  };
}

export function parseSimulationState(
  value: string | SimulationRuntimeState,
): SimulationRuntimeState {
  const parsed =
    typeof value === "string" ? parseJsonObject(value, "运行时状态") : value;
  if (parsed.version !== 1) throw new Error("不支持的运行时状态版本。");
  const clock = assertFiniteInteger(
    parsed.clock,
    "运行时时钟",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const lastSequence = assertFiniteInteger(
    parsed.lastSequence,
    "lastSequence",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  if (!isObject(parsed.entities))
    throw new Error("运行时 entities 必须是对象。");
  const entities: Record<string, RuntimeEntityState> = {};
  for (const [key, raw] of Object.entries(parsed.entities)) {
    const entity = assertRuntimeEntity(raw);
    if (entity.entityKey !== key)
      throw new Error(`实体索引与 entityKey 不一致: ${key}`);
    entities[key] = entity;
  }
  if (!Array.isArray(parsed.memories))
    throw new Error("运行时 memories 必须是数组。");
  if (!Array.isArray(parsed.narratives))
    throw new Error("运行时 narratives 必须是数组。");
  const memories = parsed.memories.map(assertRuntimeMemory);
  const narratives = parsed.narratives.map((raw) => {
    if (!isObject(raw)) throw new Error("运行时叙事记录必须是对象。");
    const text = String(raw.text ?? "").trim();
    if (!text || text.length > 20_000) throw new Error("运行时叙事文本无效。");
    return {
      eventSequence: assertFiniteInteger(
        raw.eventSequence,
        "narrative.eventSequence",
        1,
        Number.MAX_SAFE_INTEGER,
      ),
      text,
    };
  });
  return {
    version: 1,
    clock,
    entities,
    memories,
    narratives,
    ttrpg: parseTtrpgState(parsed.ttrpg),
    interaction: parseInteractionState(parsed.interaction),
    narrative: parseSimulationNarrativeState(parsed.narrative),
    adventure: parseAdventureState(parsed.adventure),
    presentation: parseAvgPresentationState(parsed.presentation),
    narrativeSimulation: parseNarrativeSimulationState(
      parsed.narrativeSimulation,
    ),
    openWorld: parseOpenWorldState(parsed.openWorld),
    lastSequence,
  };
}

function cloneState(state: SimulationRuntimeState): SimulationRuntimeState {
  return structuredClone(state);
}

function parseEventPayload(event: SimulationEvent): JsonObject {
  if (!SIMULATION_EVENT_TYPES.includes(event.type)) {
    throw new Error(`未知模拟事件类型: ${event.type}`);
  }
  return parseJsonObject(event.payloadJson, `模拟事件 ${event.type}`);
}

export type TtrpgTabletopOperationV1 =
  | { kind: "move-token"; tokenKey: string; x: number; y: number }
  | { kind: "set-token-hidden"; tokenKey: string; hidden: boolean }
  | { kind: "set-fog"; fogKey: string; revealed: boolean }
  | { kind: "set-layer"; layerKey: string; visible: boolean };

function parseTtrpgTabletopOperationV1(
  value: unknown,
): TtrpgTabletopOperationV1 {
  if (!isObject(value)) throw new Error("桌面操作必须是对象。");
  const kind = String(value.kind ?? "");
  const actual = Object.keys(value).sort().join(",");
  const key = (raw: unknown, label: string) => {
    const result = String(raw ?? "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(result))
      throw new Error(`${label} 无效。`);
    return result;
  };
  if (kind === "move-token") {
    if (actual !== "kind,tokenKey,x,y")
      throw new Error("移动 token 操作字段不精确。");
    return {
      kind,
      tokenKey: key(value.tokenKey, "桌面 token key"),
      x: assertFiniteInteger(value.x, "桌面 token x", 0, 100),
      y: assertFiniteInteger(value.y, "桌面 token y", 0, 100),
    };
  }
  if (kind === "set-token-hidden") {
    if (actual !== "hidden,kind,tokenKey" || typeof value.hidden !== "boolean")
      throw new Error("token 可见性操作字段无效。");
    return {
      kind,
      tokenKey: key(value.tokenKey, "桌面 token key"),
      hidden: value.hidden,
    };
  }
  if (kind === "set-fog") {
    if (
      actual !== "fogKey,kind,revealed" ||
      typeof value.revealed !== "boolean"
    )
      throw new Error("迷雾操作字段无效。");
    return {
      kind,
      fogKey: key(value.fogKey, "桌面迷雾 key"),
      revealed: value.revealed,
    };
  }
  if (kind === "set-layer") {
    if (
      actual !== "kind,layerKey,visible" ||
      typeof value.visible !== "boolean"
    )
      throw new Error("图层操作字段无效。");
    return {
      kind,
      layerKey: key(value.layerKey, "桌面图层 key"),
      visible: value.visible,
    };
  }
  throw new Error("桌面操作 kind 无效。");
}

function applyTtrpgTabletopOperationV1(input: {
  tabletop: SimulationTtrpgTabletopStateV1;
  role: "gm" | "player";
  actorKey: string;
  operation: TtrpgTabletopOperationV1;
  sequence: number;
}): void {
  const mapKey = input.tabletop.currentMapKey;
  const map = input.tabletop.maps.find((item) => item.mapKey === mapKey);
  if (!map) throw new Error("当前场景没有可操作的冻结桌面地图。");
  const operation = input.operation;
  if (
    operation.kind === "move-token" ||
    operation.kind === "set-token-hidden"
  ) {
    const token = input.tabletop.tokens.find(
      (item) =>
        item.tokenKey === operation.tokenKey && item.mapKey === map.mapKey,
    );
    if (!token) throw new Error("桌面 token 不属于当前地图。");
    if (
      input.role === "player" &&
      (operation.kind !== "move-token" ||
        token.controllerKey !== input.actorKey ||
        token.hidden)
    ) {
      throw new Error("玩家只能移动自己控制且已公开的 token。");
    }
    if (operation.kind === "move-token") {
      token.x = operation.x;
      token.y = operation.y;
    } else {
      if (input.role !== "gm")
        throw new Error("只有 GM 可以改变 token 可见性。");
      token.hidden = operation.hidden;
    }
  } else if (operation.kind === "set-fog") {
    if (input.role !== "gm" || !map.fogKeys.includes(operation.fogKey))
      throw new Error("只有 GM 可以操作当前地图迷雾。");
    input.tabletop.revealedFogKeys = operation.revealed
      ? [...new Set([...input.tabletop.revealedFogKeys, operation.fogKey])]
      : input.tabletop.revealedFogKeys.filter(
          (key) => key !== operation.fogKey,
        );
  } else {
    if (
      input.role !== "gm" ||
      ![...map.publicLayerKeys, ...map.gmLayerKeys].includes(operation.layerKey)
    ) {
      throw new Error("只有 GM 可以操作当前地图图层。");
    }
    input.tabletop.visibleLayerKeys = operation.visible
      ? [...new Set([...input.tabletop.visibleLayerKeys, operation.layerKey])]
      : input.tabletop.visibleLayerKeys.filter(
          (key) => key !== operation.layerKey,
        );
  }
  input.tabletop.updatedAtSequence = input.sequence;
}

export function applySimulationEvent(
  current: SimulationRuntimeState,
  event: SimulationEvent,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current));
  if (event.sequence !== state.lastSequence + 1) {
    throw new Error(
      `模拟事件序号不连续: 期望 ${state.lastSequence + 1}，收到 ${event.sequence}`,
    );
  }
  const payload = parseEventPayload(event);
  if (event.type.startsWith("world.")) {
    state.openWorld = applyOpenWorldEvent(state.openWorld ?? null, event);
    if (event.type === "world.narrative.synced") {
      if (
        !state.openWorld ||
        !state.narrative ||
        state.narrative.version !== 2 ||
        !isObject(payload.projection)
      ) {
        throw new Error(
          "[textworld] Narrative 同步需要正式开放世界与冻结叙事状态。",
        );
      }
      const expected = openWorldMainlineProjection(
        state.openWorld,
        state.openWorld.mainlineQuestKeys,
      );
      if (stableJson(payload.projection) !== stableJson(expected)) {
        throw new Error("[textworld] Narrative 投影与开放世界状态不一致。");
      }
      state.narrative.variables = {
        ...state.narrative.variables,
        openWorld: structuredClone(expected),
      };
      if (!state.narrative.completed && state.narrative.currentNodeKey) {
        const evaluations = evaluateNarrativeChoices(
          {
            ...state.narrative.variables,
            __visitedNodeKeys: state.narrative.visitedNodeKeys,
            __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(
              (item) => item.choiceKey,
            ),
          },
          state.narrative.currentNodeKey,
          state.narrative.choices ?? [],
        );
        state.narrative.visibleChoiceKeys = evaluations
          .filter((item) => item.visible)
          .map((item) => item.choiceKey);
        state.narrative.availableChoiceKeys = evaluations
          .filter((item) => item.available)
          .map((item) => item.choiceKey);
        state.narrative.availableNodeKeys = [
          ...new Set(
            evaluations
              .filter((item) => item.available)
              .map((item) => item.targetNodeKey),
          ),
        ];
      }
    }
    state.lastSequence = event.sequence;
    return state;
  }
  if (event.type.startsWith("simulation.")) {
    state.narrativeSimulation = applyNarrativeSimulationEvent(
      state.narrativeSimulation ?? null,
      event,
    );
    if (event.type === "simulation.narrative.synced") {
      if (
        !state.narrative ||
        state.narrative.version !== 2 ||
        !isObject(payload.projection)
      ) {
        throw new Error("[textsim] Narrative 同步需要正式模拟与冻结叙事状态。");
      }
      const expected = narrativeSimulationProjection(state.narrativeSimulation);
      if (stableJson(payload.projection) !== stableJson(expected)) {
        throw new Error("[textsim] Narrative 投影与模拟状态不一致。");
      }
      state.narrative.variables = {
        ...state.narrative.variables,
        simulation: structuredClone(expected),
      };
      if (!state.narrative.completed && state.narrative.currentNodeKey) {
        const evaluations = evaluateNarrativeChoices(
          {
            ...state.narrative.variables,
            __visitedNodeKeys: state.narrative.visitedNodeKeys,
            __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(
              (item) => item.choiceKey,
            ),
          },
          state.narrative.currentNodeKey,
          state.narrative.choices ?? [],
        );
        state.narrative.visibleChoiceKeys = evaluations
          .filter((item) => item.visible)
          .map((item) => item.choiceKey);
        state.narrative.availableChoiceKeys = evaluations
          .filter((item) => item.available)
          .map((item) => item.choiceKey);
        state.narrative.availableNodeKeys = [
          ...new Set(
            evaluations
              .filter((item) => item.available)
              .map((item) => item.targetNodeKey),
          ),
        ];
      }
    }
    state.lastSequence = event.sequence;
    return state;
  }
  if (event.type.startsWith("presentation.")) {
    state.presentation = applyAvgPresentationEvent(
      state.presentation ?? null,
      event,
      state.narrative?.currentNodeKey ?? null,
      state.narrative?.beats ?? [],
    );
    state.lastSequence = event.sequence;
    return state;
  }
  if (event.type.startsWith("interaction.")) {
    state.interaction = applyInteractionEvent(state.interaction ?? null, event);
    state.lastSequence = event.sequence;
    return state;
  }
  if (event.type === "adventure.narrative.synced") {
    if (!state.adventure || !state.narrative || state.narrative.version !== 2) {
      throw new Error("[adventure] Narrative 同步需要正式冒险与冻结叙事状态。");
    }
    if (!isObject(payload.projection))
      throw new Error("[adventure] Narrative 投影无效。");
    const expected = adventureNarrativeProjection(state.adventure);
    if (stableJson(payload.projection) !== stableJson(expected)) {
      throw new Error("[adventure] Narrative 投影与冒险状态不一致。");
    }
    state.narrative.variables = {
      ...state.narrative.variables,
      adventure: structuredClone(expected),
      ...(state.openWorld
        ? {
            openWorld: openWorldMainlineProjection(
              state.openWorld,
              state.openWorld.mainlineQuestKeys,
            ),
          }
        : {}),
    };
    if (!state.narrative.completed && state.narrative.currentNodeKey) {
      const evaluations = evaluateNarrativeChoices(
        {
          ...state.narrative.variables,
          __visitedNodeKeys: state.narrative.visitedNodeKeys,
          __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(
            (item) => item.choiceKey,
          ),
        },
        state.narrative.currentNodeKey,
        state.narrative.choices ?? [],
      );
      state.narrative.visibleChoiceKeys = evaluations
        .filter((item) => item.visible)
        .map((item) => item.choiceKey);
      state.narrative.availableChoiceKeys = evaluations
        .filter((item) => item.available)
        .map((item) => item.choiceKey);
      state.narrative.availableNodeKeys = [
        ...new Set(
          evaluations
            .filter((item) => item.available)
            .map((item) => item.targetNodeKey),
        ),
      ];
    }
    state.lastSequence = event.sequence;
    return state;
  }
  if (event.type.startsWith("adventure.")) {
    state.adventure = applyAdventureEvent(state.adventure ?? null, event);
    if (state.openWorld)
      state.openWorld = applyOpenWorldEvent(state.openWorld, event);
    state.lastSequence = event.sequence;
    return state;
  }
  switch (event.type) {
    case "time.advanced": {
      const amount = assertFiniteInteger(
        payload.amount,
        "时间推进量",
        1,
        1_000_000_000,
      );
      if (state.clock + amount > Number.MAX_SAFE_INTEGER)
        throw new Error("运行时时钟溢出。");
      state.clock += amount;
      break;
    }
    case "entity.upserted": {
      const entity = assertRuntimeEntity(payload.entity);
      state.entities[entity.entityKey] = entity;
      break;
    }
    case "entity.patched": {
      const entityKey = String(payload.entityKey ?? "").trim();
      const existing = state.entities[entityKey];
      if (!existing) throw new Error(`运行时实体不存在: ${entityKey}`);
      if (!isObject(payload.patch)) throw new Error("实体补丁必须是对象。");
      const allowed = new Set([
        "name",
        "locationKey",
        "lifecycleStatus",
        "attributes",
      ]);
      for (const key of Object.keys(payload.patch)) {
        if (!allowed.has(key)) throw new Error(`实体补丁禁止字段: ${key}`);
      }
      state.entities[entityKey] = assertRuntimeEntity({
        ...existing,
        ...payload.patch,
        entityKey,
        kind: existing.kind,
        sourceId: existing.sourceId,
        attributes:
          payload.patch.attributes == null
            ? existing.attributes
            : {
                ...existing.attributes,
                ...assertRuntimeAttributes(payload.patch.attributes),
              },
      });
      break;
    }
    case "entity.removed": {
      const entityKey = String(payload.entityKey ?? "").trim();
      if (!state.entities[entityKey])
        throw new Error(`运行时实体不存在: ${entityKey}`);
      delete state.entities[entityKey];
      break;
    }
    case "memory.recorded": {
      const memory = assertRuntimeMemory(payload.memory);
      if (memory.sourceEventSequence !== event.sequence) {
        throw new Error("运行时记忆必须引用自身事件序号。");
      }
      const index = state.memories.findIndex((row) => row.id === memory.id);
      if (index >= 0) state.memories[index] = memory;
      else state.memories.push(memory);
      break;
    }
    case "random.resolved": {
      assertDiceResolution(payload);
      break;
    }
    case "narrative.recorded": {
      const text = String(payload.text ?? "").trim();
      if (!text || text.length > 20_000)
        throw new Error("运行时叙事文本无效。");
      state.narratives.push({ eventSequence: event.sequence, text });
      break;
    }
    case "narrative.started": {
      const narrative = state.narrative;
      if (
        !narrative ||
        narrative.version !== 2 ||
        !narrative.currentNodeKey ||
        event.sequence !== 1
      ) {
        throw new Error("GameRelease 叙事启动事件无效。");
      }
      if (
        String(payload.entryNodeKey ?? "").trim() !==
          narrative.currentNodeKey ||
        String(payload.contentHash ?? "").trim() !== narrative.contentHash
      ) {
        throw new Error("叙事启动事件与冻结发布不一致。");
      }
      break;
    }
    case "narrative.node.entered": {
      const narrative = state.narrative;
      if (!narrative || narrative.version !== 2 || !narrative.currentNodeKey) {
        throw new Error("GameRelease 节点进入事件无效。");
      }
      const nodeKey = String(payload.nodeKey ?? "").trim();
      const causeSequence = assertFiniteInteger(
        payload.causeSequence,
        "节点进入原因序号",
        1,
        event.sequence - 1,
      );
      if (nodeKey !== narrative.currentNodeKey)
        throw new Error("节点进入事件与当前冻结节点不一致。");
      if (event.sequence !== causeSequence + 1)
        throw new Error("节点进入事件没有紧随其状态变更。");
      if (
        causeSequence > 1 &&
        narrative.choiceHistory?.[narrative.choiceHistory.length - 1]
          ?.eventSequence !== causeSequence
      ) {
        throw new Error("节点进入事件缺少对应的 Choice。");
      }
      narrative.lastEnteredNodeSequence = event.sequence;
      break;
    }
    case "narrative.choice.committed": {
      const narrative = state.narrative;
      if (
        !narrative ||
        narrative.version !== 2 ||
        narrative.completed ||
        !narrative.currentNodeKey
      ) {
        throw new Error("当前会话没有可提交选择的 GameRelease 叙事。");
      }
      const commandId = String(payload.commandId ?? "").trim();
      const baseSequence = assertFiniteInteger(
        payload.baseSequence,
        "选择基准序号",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      const baseStateHash = String(payload.baseStateHash ?? "").trim();
      const fromNodeKey = String(payload.fromNodeKey ?? "").trim();
      const choiceKey = String(payload.choiceKey ?? "").trim();
      const toNodeKey = String(payload.toNodeKey ?? "").trim();
      if (
        !commandId ||
        commandId.length > 200 ||
        !/^[a-zA-Z0-9._:-]+$/.test(commandId)
      )
        throw new Error("选择 commandId 无效。");
      if (!/^[a-f0-9]{64}$/.test(baseStateHash))
        throw new Error("选择 baseStateHash 无效。");
      if (baseSequence !== event.sequence - 1)
        throw new Error("选择基准序号与事件位置不一致。");
      if (fromNodeKey !== narrative.currentNodeKey)
        throw new Error("选择来源节点已变化。");
      if (!narrative.availableChoiceKeys?.includes(choiceKey))
        throw new Error("所选 Choice 当前不可用。");
      const choice = narrative.choices?.find(
        (item) => item.choiceKey === choiceKey,
      );
      if (
        !choice ||
        choice.sourceNodeKey !== fromNodeKey ||
        choice.targetNodeKey !== toNodeKey
      ) {
        throw new Error("选择与冻结内容不一致。");
      }
      state.narrative = advanceFrozenNarrativeChoice(
        narrative,
        choiceKey,
        event.sequence,
      );
      break;
    }
    case "narrative.ending.reached": {
      const narrative = state.narrative;
      const endingKey = String(payload.endingKey ?? "").trim();
      const enteredSequence = assertFiniteInteger(
        payload.enteredSequence,
        "结局进入序号",
        1,
        event.sequence - 1,
      );
      if (
        !narrative ||
        narrative.version !== 2 ||
        !narrative.completed ||
        narrative.currentNodeKey !== endingKey ||
        narrative.endingKey !== endingKey
      ) {
        throw new Error("结局事件与冻结叙事状态不一致。");
      }
      if (event.sequence !== enteredSequence + 1)
        throw new Error("结局事件没有紧随节点进入。");
      if (narrative.lastEnteredNodeSequence !== enteredSequence)
        throw new Error("结局事件引用的节点尚未正式进入。");
      narrative.completedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.character.customized": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product || product.sessionZero.completed || ttrpg.scene) {
        throw new Error("角色只能在正式战役 Session Zero 完成前定制。");
      }
      const characterKey = String(payload.characterKey ?? "").trim();
      const name = String(payload.name ?? "").trim();
      const description = String(payload.description ?? "").trim();
      if (
        !characterKey ||
        event.actorKey !== characterKey ||
        !name ||
        name.length > 300 ||
        !description ||
        description.length > 20_000 ||
        !isObject(payload.attributes) ||
        !isObject(payload.entityAttributes) ||
        !isObject(payload.characterSheet) ||
        state.entities[characterKey]?.kind !== "player"
      ) {
        throw new Error("正式 TTRPG 角色定制事件无效。");
      }
      const attributes = Object.fromEntries(
        Object.entries(payload.attributes).map(([key, value]) => {
          const parsed = Number(value);
          if (!key.trim() || !Number.isFinite(parsed))
            throw new Error("正式 TTRPG 角色属性无效。");
          return [key.trim(), parsed];
        }),
      );
      const entityAttributes = Object.fromEntries(
        Object.entries(payload.entityAttributes).map(([key, value]) => {
          if (
            !key.trim() ||
            (!["string", "number", "boolean"].includes(typeof value) &&
              value !== null)
          ) {
            throw new Error("正式 TTRPG 角色投影属性无效。");
          }
          return [key, value as string | number | boolean | null];
        }),
      );
      const entity = state.entities[characterKey];
      entity.name = name;
      entity.attributes = { ...entity.attributes, ...entityAttributes };
      const current = product.characterCustomizations.find(
        (item) => item.characterKey === characterKey,
      );
      const customization = {
        characterKey,
        name,
        description,
        attributes,
        characterSheet: structuredClone(
          payload.characterSheet,
        ) as unknown as TtrpgCharacterSheetV2,
        customizedAtSequence: event.sequence,
      };
      if (current) Object.assign(current, customization);
      else product.characterCustomizations.push(customization);
      break;
    }
    case "ttrpg.character.advanced": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      const characterKey = String(payload.characterKey ?? "").trim();
      const kind = String(payload.kind);
      const targetKey = String(payload.targetKey ?? "").trim();
      const before = payload.before;
      const after = payload.after;
      const cost = assertFiniteInteger(payload.cost, "成长消费", 1, 1_000_000);
      const progression = product?.characterProgression?.[characterKey];
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !progression ||
        event.actorKey !== characterKey ||
        !targetKey ||
        !["attribute", "skill", "level", "rank"].includes(kind) ||
        !["number", "string"].includes(typeof before) ||
        typeof before !== typeof after ||
        !isObject(payload.entityAttributes) ||
        progression.spentCurrency + cost >
          earnedTtrpgCharacterCurrencyV2(product, characterKey)
      ) {
        throw new Error("正式 TTRPG 角色成长事件无效。");
      }
      if (kind === "attribute") {
        const current = state.entities[characterKey]?.attributes[targetKey];
        if (
          typeof before !== "number" ||
          typeof after !== "number" ||
          current !== before ||
          after !== before + 1
        ) {
          throw new Error("角色属性成长前后值不连续。");
        }
        progression.attributeIncreases[targetKey] =
          (progression.attributeIncreases[targetKey] ?? 0) + 1;
      } else if (kind === "skill") {
        if (
          typeof before !== "number" ||
          typeof after !== "number" ||
          after !== before + 1
        ) {
          throw new Error("角色技能成长前后值不连续。");
        }
        progression.skillIncreases[targetKey] =
          (progression.skillIncreases[targetKey] ?? 0) + 1;
      } else if (kind === "level") {
        if (
          progression.model !== "numeric-level" ||
          typeof before !== "number" ||
          typeof after !== "number" ||
          progression.level !== before ||
          after !== before + 1
        )
          throw new Error("角色等级成长无效。");
        progression.level = after;
      } else {
        if (
          progression.model !== "rank" ||
          typeof before !== "string" ||
          typeof after !== "string" ||
          progression.rankKey !== before ||
          before === after
        )
          throw new Error("角色阶位成长无效。");
        progression.rankKey = after;
        if (
          typeof state.entities[characterKey]?.attributes.rankPower === "number"
        ) {
          progression.attributeIncreases.rankPower =
            (progression.attributeIncreases.rankPower ?? 0) + 1;
        }
      }
      const entity = state.entities[characterKey];
      if (!entity) throw new Error("角色成长目标不存在。");
      for (const [field, raw] of Object.entries(payload.entityAttributes)) {
        if (
          !field.trim() ||
          (!["string", "number", "boolean"].includes(typeof raw) &&
            raw !== null) ||
          (typeof raw === "number" && !Number.isFinite(raw))
        )
          throw new Error("角色成长实体投影无效。");
        entity.attributes[field] = raw as string | number | boolean | null;
      }
      progression.spentCurrency += cost;
      progression.history.push({
        eventSequence: event.sequence,
        kind: kind as "attribute" | "skill" | "level" | "rank",
        targetKey,
        before: before as number | string,
        after: after as number | string,
        cost,
      });
      break;
    }
    case "ttrpg.session-zero.completed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product)
        throw new Error("Session Zero 只能用于正式 TTRPG 产品会话。");
      if (product.sessionZero.completed)
        throw new Error("Session Zero 已完成，不能重复提交。");
      if (!Array.isArray(payload.acceptedItemKeys))
        throw new Error("Session Zero 缺少确认项。");
      const acceptedItemKeys = payload.acceptedItemKeys
        .map((item) => String(item).trim())
        .sort();
      if (!Array.isArray(payload.selectedCharacterKeys))
        throw new Error("Session Zero 缺少玩家角色编组。");
      const selectedCharacterKeys = payload.selectedCharacterKeys.map((item) =>
        String(item).trim(),
      );
      const requiredItemKeys = [...product.sessionZero.requiredItemKeys].sort();
      if (stableJson(acceptedItemKeys) !== stableJson(requiredItemKeys)) {
        throw new Error("必须确认全部 Session Zero 安全与共识事项。");
      }
      if (
        !selectedCharacterKeys.length ||
        new Set(selectedCharacterKeys).size !== selectedCharacterKeys.length ||
        selectedCharacterKeys.some(
          (key) => state.entities[key]?.kind !== "player",
        )
      ) {
        throw new Error("Session Zero 玩家角色编组无效。");
      }
      const completedBy = String(payload.completedBy ?? "").trim();
      if (!completedBy || completedBy !== event.actorKey)
        throw new Error("Session Zero 完成人身份无效。");
      product.sessionZero = {
        ...product.sessionZero,
        completed: true,
        acceptedItemKeys,
        selectedCharacterKeys,
        completedBy,
        completedAtSequence: event.sequence,
      };
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState();
      const existingRoster = new Map(
        ttrpg.campaign.roster.map((entry) => [entry.characterKey, entry]),
      );
      const allPlayerKeys = Object.values(state.entities)
        .filter((entity) => entity.kind === "player")
        .map((entity) => entity.entityKey);
      ttrpg.campaign.roster = allPlayerKeys.map((characterKey) => ({
        characterKey,
        status: selectedCharacterKeys.includes(characterKey)
          ? ("active" as const)
          : ("reserve" as const),
        joinedSessionKey: null,
        leftSessionKey: null,
        replacementFor: null,
        reason: existingRoster.get(characterKey)?.reason ?? "",
        updatedSequence: event.sequence,
      }));
      break;
    }
    case "ttrpg.safety.changed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product?.sessionZero.completed || product.ending)
        throw new Error("当前正式战役不能变更安全状态。");
      const status = String(payload.status ?? "");
      const reason =
        payload.reason == null ? null : String(payload.reason).trim() || null;
      const changedBy = String(payload.changedBy ?? "").trim();
      if (
        !["active", "paused"].includes(status) ||
        !changedBy ||
        changedBy !== event.actorKey ||
        (status === "paused" && !reason) ||
        status === product.safety.status
      ) {
        throw new Error("安全状态变更无效。");
      }
      product.safety = {
        status: status as "active" | "paused",
        reason: status === "paused" ? reason : null,
        changedBy,
        changedAtSequence: event.sequence,
      };
      break;
    }
    case "ttrpg.clue.discovered": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product || !product.sessionZero.completed)
        throw new Error("正式战役尚未完成 Session Zero。");
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("请先打开一个正式战役场景。");
      const clueKey = String(payload.clueKey ?? "").trim();
      const actorKey = String(payload.actorKey ?? "").trim();
      const visibility = String(payload.visibility ?? "");
      const catalog = product.clueCatalog.find(
        (item) => item.clueKey === clueKey,
      );
      if (!catalog) throw new Error("线索不属于冻结 CampaignPack。");
      if (catalog.sourceVisibility === "gm-only")
        throw new Error("GM 私密线索不能通过玩家发现路径公开。");
      if (catalog.sourceVisibility === "public" && visibility !== "party")
        throw new Error("公开线索必须对队伍可见。");
      if (visibility !== "private" && visibility !== "party")
        throw new Error("线索可见范围无效。");
      const actor = state.entities[actorKey];
      if (
        !actor ||
        !["player", "character"].includes(actor.kind) ||
        actorKey !== event.actorKey
      ) {
        throw new Error("线索发现者必须是当前正式战役中的玩家角色。");
      }
      const existing = product.discoveredClues.find(
        (item) => item.clueKey === clueKey,
      );
      if (existing) {
        if (existing.visibility !== "private" || visibility !== "party")
          throw new Error("同一线索不能重复发现。");
        existing.visibility = "party";
        existing.actorKey = actorKey;
        existing.eventSequence = event.sequence;
      } else {
        product.discoveredClues.push({
          clueKey,
          actorKey,
          visibility: visibility as "private" | "party",
          eventSequence: event.sequence,
        });
      }
      const discoveredConclusions = new Set(
        product.discoveredClues
          .map(
            (item) =>
              product.clueCatalog.find((clue) => clue.clueKey === item.clueKey)
                ?.conclusionKey,
          )
          .filter((item): item is string => !!item),
      );
      for (const quest of product.questProgress) {
        if (
          quest.status === "active" &&
          quest.requiredConclusionKeys.every((key) =>
            discoveredConclusions.has(key),
          )
        ) {
          quest.status = "completed";
          quest.completedAtSequence = event.sequence;
        }
      }
      break;
    }
    case "ttrpg.scene.opened": {
      const ttrpg = requireTtrpgState(state);
      const scene = assertTtrpgScene(payload.scene);
      if (ttrpg.product) {
        if (!ttrpg.product.sessionZero.completed)
          throw new Error("正式战役必须先完成 Session Zero。");
        if (ttrpg.product.ending)
          throw new Error("正式战役已经结束，不能再打开场景。");
        if (
          !scene.sceneKey ||
          !ttrpg.product.sceneKeys.includes(scene.sceneKey)
        ) {
          throw new Error("正式场景必须来自冻结 CampaignPack。");
        }
      }
      const rawTurnOrder = payload.turnOrder;
      if (!Array.isArray(rawTurnOrder) || rawTurnOrder.length === 0) {
        throw new Error("跑团场景至少需要一个行动者。");
      }
      const turnOrder = rawTurnOrder.map((raw) => String(raw).trim());
      if (new Set(turnOrder).size !== turnOrder.length)
        throw new Error("跑团回合顺序不能重复。");
      for (const actorKey of turnOrder) {
        const actor = state.entities[actorKey];
        if (!actor || !["player", "character", "npc"].includes(actor.kind)) {
          throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`);
        }
      }
      const initiative = ttrpg.product
        ? parseTtrpgState({
            ...ttrpg,
            scene,
            round: 1,
            activeActorKey: turnOrder[0],
            turnOrder,
            initiative: payload.initiative,
          })!.initiative
        : null;
      if (ttrpg.product && initiative?.sceneKey !== scene.sceneKey) {
        throw new Error("正式场景先攻收据没有绑定当前场景。");
      }
      if (scene.locationKey != null) {
        const location = state.entities[scene.locationKey];
        if (!location || location.kind !== "location")
          throw new Error(`跑团场景地点不存在: ${scene.locationKey}`);
      }
      ttrpg.scene = scene;
      if (
        ttrpg.product &&
        scene.sceneKey &&
        !ttrpg.product.openedSceneKeys.includes(scene.sceneKey)
      ) {
        ttrpg.product.openedSceneKeys.push(scene.sceneKey);
      }
      if (ttrpg.product?.tabletop && scene.sceneKey) {
        const tabletopMap = ttrpg.product.tabletop.maps.find((map) =>
          map.sceneKeys.includes(scene.sceneKey!),
        );
        ttrpg.product.tabletop.currentMapKey = tabletopMap?.mapKey ?? null;
        ttrpg.product.tabletop.updatedAtSequence = event.sequence;
      }
      ttrpg.round = 1;
      ttrpg.activeActorKey = turnOrder[0];
      ttrpg.turnOrder = turnOrder;
      ttrpg.initiative = initiative;
      if (ttrpg.product?.abilityStates) {
        if (!Array.isArray(payload.abilityResets))
          throw new Error("正式场景事件缺少能力场景重置计划。");
        for (const raw of payload.abilityResets) {
          if (!isObject(raw)) throw new Error("能力场景重置项无效。");
          const stateKey = String(raw.stateKey ?? "").trim();
          const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
          const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
          if (
            stateKey !==
              ttrpgAbilityStateKeyV2(
                before.actorInstanceId,
                before.abilityKey,
              ) ||
            stableJson(ttrpg.product.abilityStates[stateKey]) !==
              stableJson(before)
          ) {
            throw new Error(`能力场景重置基线不一致:${stateKey}`);
          }
          ttrpg.product.abilityStates[stateKey] = after;
        }
      }
      if (ttrpg.product?.actionEconomy && scene.sceneKey) {
        ttrpg.product.actionEconomy = startTtrpgActionEconomySceneV2({
          economy: ttrpg.product.actionEconomy,
          sceneKey: scene.sceneKey,
          turnOrder,
        });
      }
      ttrpg.actions = [];
      ttrpg.checks = [];
      ttrpg.attacks = [];
      ttrpg.encounter = null;
      break;
    }
    case "ttrpg.media.requested": {
      const product = requireTtrpgState(state).product;
      if (
        !product?.media ||
        !product.media.runtimePolicy.enabled ||
        product.media.runtimePolicy.networkPolicy === "disabled"
      ) {
        throw new Error("正式 TTRPG 没有启用运行时媒资。");
      }
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const styleBibleHash = String(payload.styleBibleHash ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestKey) ||
        !/^[a-f0-9]{64}$/.test(styleBibleHash) ||
        payload.kind !== slot.kind ||
        payload.targetRef !== slot.targetRef ||
        payload.audience !== slot.audience ||
        (slot.status === "available" && slot.requestKey !== requestKey)
      ) {
        throw new Error("运行时媒资请求没有严格绑定冻结槽位。");
      }
      if (
        product.media.visualBibleHash != null &&
        product.media.visualBibleHash !== styleBibleHash
      ) {
        throw new Error("运行时媒资请求的视觉圣经已经漂移。");
      }
      product.media.visualBibleHash = styleBibleHash;
      slot.status = "queued";
      slot.requestKey = requestKey;
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.media.available": {
      const product = requireTtrpgState(state).product;
      if (!product?.media) throw new Error("正式 TTRPG 缺少媒资投影。");
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const assetKey = String(payload.assetKey ?? "").trim();
      const contentHash = String(payload.mediaContentHash ?? "").trim();
      const mediaAssetId = assertFiniteInteger(
        payload.mediaAssetId,
        "运行时媒资 ID",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const mediaAssetVersion = assertFiniteInteger(
        payload.mediaAssetVersion,
        "运行时媒资版本",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        slot.status !== "queued" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(assetKey) ||
        !/^[a-f0-9]{64}$/.test(contentHash) ||
        product.media.generatedCount >=
          product.media.runtimePolicy.maximumGeneratedAssets
      ) {
        throw new Error("运行时媒资可用事件无效或超过冻结预算。");
      }
      slot.status = "available";
      slot.assetKey = assetKey;
      slot.mediaAssetId = mediaAssetId;
      slot.mediaAssetVersion = mediaAssetVersion;
      slot.mediaContentHash = contentHash;
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      product.media.generatedCount += 1;
      break;
    }
    case "ttrpg.media.failed": {
      const product = requireTtrpgState(state).product;
      if (!product?.media) throw new Error("正式 TTRPG 缺少媒资投影。");
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const errorCode = String(payload.errorCode ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        slot.status !== "queued" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(errorCode)
      ) {
        throw new Error("运行时媒资失败事件无效。");
      }
      slot.status = "failed";
      slot.lastErrorCode = errorCode;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.media.cancelled": {
      const product = requireTtrpgState(state).product;
      if (!product?.media) throw new Error("正式 TTRPG 缺少媒资投影。");
      const slotKey = String(payload.slotKey ?? "").trim();
      const requestKey = String(payload.requestKey ?? "").trim();
      const slot = product.media.slots.find((item) => item.slotKey === slotKey);
      if (
        !slot ||
        event.targetKey !== slotKey ||
        slot.requestKey !== requestKey ||
        !["queued", "failed"].includes(slot.status)
      )
        throw new Error("运行时媒资取消事件无效。");
      slot.status = "cancelled";
      slot.lastErrorCode = null;
      slot.updatedAtSequence = event.sequence;
      break;
    }
    case "ttrpg.tabletop.updated": {
      const product = requireTtrpgState(state).product;
      if (
        !product?.sessionZero.completed ||
        !product.tabletop ||
        !state.ttrpg?.scene ||
        state.ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式桌面操作需要已开始且未暂停的 CampaignPack 场景。");
      }
      const role = String(payload.role ?? "");
      const actorKey = String(payload.actorKey ?? "").trim();
      if (
        !["gm", "player"].includes(role) ||
        !actorKey ||
        event.actorKey !== actorKey
      )
        throw new Error("桌面操作者身份无效。");
      const operation = parseTtrpgTabletopOperationV1(payload.operation);
      applyTtrpgTabletopOperationV1({
        tabletop: product.tabletop,
        role: role as "gm" | "player",
        actorKey,
        operation,
        sequence: event.sequence,
      });
      break;
    }
    case "ttrpg.action.recorded": {
      const ttrpg = requireTtrpgState(state);
      if (ttrpg.product)
        throw new Error("正式 TTRPG 禁止绕过 RulePack 记录自由动作。");
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("跑团尚未开始活动场景。");
      const action = assertTtrpgAction({
        eventSequence: event.sequence,
        actorKey: payload.actorKey,
        text: payload.text,
      });
      if (!ttrpg.turnOrder.includes(action.actorKey))
        throw new Error("跑团动作行动者不在当前回合顺序中。");
      if (ttrpg.activeActorKey !== action.actorKey)
        throw new Error("当前还没轮到该行动者。");
      ttrpg.actions.push(action);
      break;
    }
    case "ttrpg.check.resolved": {
      const ttrpg = requireTtrpgState(state);
      if (!isObject(payload.check))
        throw new Error("跑团检定缺少 check 对象。");
      const check = assertTtrpgCheck({
        ...payload.check,
        eventSequence: event.sequence,
      });
      if (!ttrpg.turnOrder.includes(check.actorKey))
        throw new Error("跑团检定行动者不在当前回合顺序中。");
      if (ttrpg.product) {
        if (
          !check.rule ||
          check.rule.rulePackContentHash !== ttrpg.product.rulePackContentHash
        ) {
          throw new Error("正式 TTRPG 检定缺少匹配冻结规则包的裁定证据。");
        }
        if (ttrpg.activeActorKey !== check.actorKey)
          throw new Error("当前还没轮到该正式规则行动者。");
      }
      ttrpg.checks.push(check);
      break;
    }
    case "ttrpg.intent.receipted": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product?.sessionZero.completed || !ttrpg.scene) {
        throw new Error("正式行动意图收据需要已打开的 CampaignPack 场景。");
      }
      const receipt = parseTtrpgIntentReceiptV2(payload.receipt);
      if (
        receipt.eventSequence !== event.sequence ||
        receipt.actorKey !== event.actorKey ||
        receipt.targetKey !== event.targetKey
      ) {
        throw new Error("正式行动意图收据与事件身份不一致。");
      }
      const history = product.intentReceipts ?? (product.intentReceipts = []);
      if (history.some((item) => item.intentKey === receipt.intentKey)) {
        throw new Error("正式行动意图已经存在终态收据。");
      }
      history.push(receipt);
      break;
    }
    case "ttrpg.human-response.recorded": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product?.sessionZero.completed || !ttrpg.scene) {
        throw new Error("真人角色回应需要已打开的正式 CampaignPack 场景。");
      }
      const response = parseTtrpgHumanResponseV2(payload.response);
      if (
        response.eventSequence !== event.sequence ||
        response.actorKey !== event.actorKey
      ) {
        throw new Error("真人角色回应与事件身份不一致。");
      }
      const sourceAction = product.actionHistory.find(
        (action) => action.eventSequence === response.actionSequence,
      );
      const sourceReceipt = sourceAction?.receipt;
      if (
        !sourceReceipt ||
        sourceReceipt.receiptKey !== response.actionReceiptKey
      ) {
        throw new Error("真人角色回应没有绑定有效 ActionReceipt。");
      }
      const observer = sourceReceipt.context.observers.find(
        (item) => item.actorKey === response.actorKey,
      );
      const promptWindow = sourceReceipt.context.reactionWindows.some(
        (window) =>
          window.status !== "closed" &&
          window.layer === "immediate-character" &&
          window.humanConfirmationRequiredActorKeys.includes(response.actorKey),
      );
      if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
        throw new Error("该角色没有属于本人的开放回应窗口。");
      }
      const history = product.humanResponses ?? (product.humanResponses = []);
      if (history.some((item) => item.responseKey === response.responseKey)) {
        throw new Error("该真人角色已经回应本次行动。");
      }
      history.push(response);
      break;
    }
    case "ttrpg.rule.action.resolved": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product ||
        !product.sessionZero.completed ||
        !ttrpg.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式规则行动需要已开始的 CampaignPack 场景。");
      }
      if (!isObject(payload.result)) throw new Error("正式规则行动缺少结果。");
      const result = assertTtrpgRuleActionResult({
        ...payload.result,
        eventSequence: event.sequence,
      });
      if (
        result.actorKey !== event.actorKey ||
        result.targetKey !== event.targetKey
      ) {
        throw new Error("正式规则行动的行动者或目标与事件元数据不一致。");
      }
      if (
        result.actionPhase !== "reaction" &&
        ttrpg.activeActorKey !== result.actorKey
      ) {
        throw new Error("当前还没轮到该正式规则行动者。");
      }
      if (
        result.check &&
        (!result.check.rule ||
          result.check.rule.rulePackContentHash !==
            product.rulePackContentHash ||
          result.check.rule.actionKey !== result.actionKey)
      ) {
        throw new Error("正式规则行动的检定证据与冻结 RulePack 不一致。");
      }
      if (result.receipt) {
        const receipt = result.receipt;
        const declaredIntentKey = receipt.context.declaredIntent?.intentKey;
        if (
          declaredIntentKey &&
          ((product.intentReceipts ?? []).some(
            (item) => item.intentKey === declaredIntentKey,
          ) ||
            product.actionHistory.some(
              (item) =>
                item.receipt?.context.declaredIntent?.intentKey ===
                declaredIntentKey,
            ))
        ) {
          throw new Error("正式行动意图已经存在终态收据。");
        }
        const observerKeys = receipt.context.observers.map(
          (observer) => observer.actorKey,
        );
        const changedEntityKeys = [
          ...new Set([
            ...result.resourceChanges.map((change) => change.entityKey),
            ...result.conditionChanges.map((change) => change.entityKey),
          ]),
        ];
        const actorConditions = (product.conditions[result.actorKey] ?? []).map(
          (condition) => condition.conditionKey,
        );
        const actorInventory = Object.values(product.inventory?.items ?? {})
          .filter(
            (item) =>
              item.ownerRef === result.actorKey &&
              !item.stateTags.includes("broken"),
          )
          .map((item) => item.itemInstanceId);
        if (
          receipt.context.sceneKey !== ttrpg.scene.sceneKey ||
          receipt.context.round !== ttrpg.round ||
          receipt.context.activeActorKey !==
            (ttrpg.activeActorKey ?? result.actorKey) ||
          stableJson(observerKeys) !== stableJson(ttrpg.turnOrder) ||
          stableJson(receipt.context.actorConditionKeys) !==
            stableJson(actorConditions) ||
          stableJson(receipt.context.actorInventoryInstanceIds) !==
            stableJson(actorInventory) ||
          stableJson(receipt.changedEntityKeys) !==
            stableJson(changedEntityKeys)
        ) {
          throw new Error("ActionReceipt 上下文与规则行动提交前状态不一致。");
        }
      }
      for (const change of result.resourceChanges) {
        const entity = state.entities[change.entityKey];
        if (!entity)
          throw new Error(`正式规则资源目标不存在:${change.entityKey}`);
        const current = entity.attributes[`resource.${change.resourceKey}`];
        const maximum = entity.attributes[`resourceMax.${change.resourceKey}`];
        if (
          current !== change.before ||
          maximum !== change.maximum ||
          change.after !==
            Math.max(0, Math.min(change.maximum, change.before + change.delta))
        ) {
          throw new Error(
            `正式规则资源变化与当前状态不一致:${change.resourceKey}`,
          );
        }
        entity.attributes[`resource.${change.resourceKey}`] = change.after;
        if (change.resourceKey === "vigor") entity.attributes.hp = change.after;
      }
      for (const change of result.conditionChanges) {
        if (!state.entities[change.entityKey])
          throw new Error(`正式规则状态目标不存在:${change.entityKey}`);
        const current = product.conditions[change.entityKey] ?? [];
        const without = current.filter(
          (item) => item.conditionKey !== change.conditionKey,
        );
        product.conditions[change.entityKey] =
          change.stacks > 0
            ? [
                ...without,
                {
                  conditionKey: change.conditionKey,
                  stacks: change.stacks,
                  duration: change.duration,
                },
              ]
            : without;
      }
      if (product.abilityStates && !result.abilityChange) {
        throw new Error("正式规则行动缺少能力次数/冷却变化证据。");
      }
      if (result.abilityChange) {
        if (
          !product.abilityStates ||
          stableJson(product.abilityStates[result.abilityChange.stateKey]) !==
            stableJson(result.abilityChange.before)
        ) {
          throw new Error("正式规则行动的能力账本基线不一致。");
        }
        product.abilityStates[result.abilityChange.stateKey] = structuredClone(
          result.abilityChange.after,
        );
        if (result.abilityChange.sharedPoolKey != null) {
          if (
            !product.usagePools ||
            stableJson(
              product.usagePools[result.abilityChange.sharedPoolKey],
            ) !== stableJson(result.abilityChange.sharedPoolBefore)
          ) {
            throw new Error("正式规则行动的共享次数池基线不一致。");
          }
          product.usagePools[result.abilityChange.sharedPoolKey] =
            structuredClone(result.abilityChange.sharedPoolAfter!);
        }
      }
      if (product.actionEconomy && result.actionPhase) {
        const transition = spendTtrpgActionEconomyV2({
          economy: product.actionEconomy,
          turnOrder: ttrpg.turnOrder,
          actorKey: result.actorKey,
          phase: result.actionPhase,
        });
        if (
          transition.nextActorKey !== result.nextActorKey ||
          transition.nextRound !== result.nextRound
        ) {
          throw new Error("正式规则行动的行动经济推进不一致。");
        }
        product.actionEconomy = transition.economy;
        ttrpg.activeActorKey = transition.economy.activeActorKey;
        ttrpg.round = transition.economy.round;
      } else if (result.nextActorKey == null) {
        if (result.nextRound !== ttrpg.round)
          throw new Error("非回合行动不能修改回合数。");
      } else {
        const currentIndex = ttrpg.turnOrder.indexOf(result.actorKey);
        const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
        const expectedActor = ttrpg.turnOrder[nextIndex];
        const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0);
        if (
          result.nextActorKey !== expectedActor ||
          result.nextRound !== expectedRound
        ) {
          throw new Error("正式规则行动的回合推进不一致。");
        }
        ttrpg.activeActorKey = result.nextActorKey;
        ttrpg.round = result.nextRound;
      }
      ttrpg.actions.push({
        eventSequence: event.sequence,
        actorKey: result.actorKey,
        text: result.actionName,
      });
      if (result.check) ttrpg.checks.push(result.check);
      product.actionHistory.push(result);
      break;
    }
    case "ttrpg.rest.completed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product?.sessionZero.completed ||
        !product.abilityStates ||
        product.ending
      ) {
        throw new Error("正式休息需要进行中的 CampaignPack 与能力账本。");
      }
      if (ttrpg.encounter?.status === "active") {
        throw new Error("战斗遭遇进行中不能完成休息。");
      }
      const receipt = parseTtrpgRestReceiptV2(payload.receipt);
      if (
        receipt.eventSequence !== event.sequence ||
        receipt.completedBy !== event.actorKey
      ) {
        throw new Error("正式休息收据与事件身份不一致。");
      }
      const history = product.restHistory ?? (product.restHistory = []);
      if (history.some((item) => item.restKey === receipt.restKey)) {
        throw new Error("正式休息 key 已经提交。");
      }
      const rulePack = parseRulePackV1(payload.rulePack);
      const expectedChanges = Object.entries(product.abilityStates).flatMap(
        ([stateKey, before]) => {
          if (!receipt.actorKeys.includes(before.actorInstanceId)) return [];
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes(receipt.kind)) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: receipt.kind,
            eventId: `event.${event.sequence}`,
          });
          return [
            {
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after,
            },
          ];
        },
      );
      if (stableJson(receipt.abilityChanges) !== stableJson(expectedChanges)) {
        throw new Error("正式休息恢复清单与冻结 RulePack 或当前账本不一致。");
      }
      for (const change of receipt.abilityChanges) {
        if (
          stableJson(product.abilityStates[change.stateKey]) !==
          stableJson(change.before)
        ) {
          throw new Error(`正式休息能力账本基线不一致:${change.stateKey}`);
        }
        product.abilityStates[change.stateKey] = structuredClone(change.after);
      }
      history.push(receipt);
      break;
    }
    case "ttrpg.item.changed": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (!product?.sessionZero.completed || !product.inventory) {
        throw new Error("正式物品命令需要已完成 Session Zero 的库存账本。");
      }
      const command = parseTtrpgItemCommandV2(payload.command);
      if (command.commandId !== event.commandId)
        throw new Error("物品命令与正式事件幂等键不一致。");
      const definitions = isObject(payload.definitions)
        ? Object.fromEntries(
            Object.entries(payload.definitions).map(
              ([definitionKey, definition]) => [
                definitionKey,
                ttrpgItemDefinitionFromRuleV1(
                  definition as import("../types").RuleItemDefinitionV1,
                ),
              ],
            ),
          )
        : null;
      if (!definitions) throw new Error("正式物品命令缺少冻结定义。");
      const before = structuredClone(
        product.inventory.items[command.instanceId] ?? null,
      );
      const applied = applyTtrpgItemCommandV2({
        state: product.inventory,
        definitions,
        command,
      });
      if (applied.replayed) throw new Error("物品命令已经在库存账本执行。");
      const changed = applied.changedItemIds
        .map((itemId) => applied.state.items[itemId])
        .filter(Boolean);
      if (
        changed.some(
          (item) => item.ownerRef != null && !state.entities[item.ownerRef],
        )
      ) {
        throw new Error("物品命令产生了未知角色所有者。");
      }
      product.inventory = applied.state;
      const requestedBy = isObject(payload.requestedBy)
        ? {
            role: String(payload.requestedBy.role),
            actorKey: String(payload.requestedBy.actorKey ?? "").trim(),
          }
        : {
            role: event.actorKey === "gm" ? "gm" : "player",
            actorKey: String(event.actorKey ?? "").trim(),
          };
      if (
        !["gm", "player"].includes(requestedBy.role) ||
        requestedBy.actorKey !== event.actorKey
      ) {
        throw new Error("物品收据操作者与正式事件身份不一致。");
      }
      const after = structuredClone(
        product.inventory.items[command.instanceId] ?? null,
      );
      const history = product.itemHistory ?? (product.itemHistory = []);
      if (
        history.some(
          (receipt) =>
            receipt.commandId === event.commandId ||
            receipt.eventSequence === event.sequence,
        )
      ) {
        throw new Error("物品收据已经存在。");
      }
      history.push({
        schema: "storyforge.ttrpg-item-receipt",
        version: 2,
        eventSequence: event.sequence,
        commandId: event.commandId,
        operation: command.kind,
        itemInstanceId: command.instanceId,
        definitionRef:
          before?.definitionRef ??
          after?.definitionRef ??
          (command.kind === "grant" ? command.definitionRef : ""),
        requestedBy: {
          role: requestedBy.role as "gm" | "player",
          actorKey: requestedBy.actorKey,
        },
        before,
        after,
      });
      break;
    }
    case "ttrpg.effects.choice.proposed": {
      const product = requireTtrpgState(state).product;
      if (!product?.sessionZero.completed || !product.effectLedger) {
        throw new Error("正式效果选择需要已完成 Session Zero 的效果账本。");
      }
      const plan = parseTtrpgEffectPlanV2(payload.plan);
      if (plan.idempotencyKey !== event.commandId) {
        throw new Error("效果选择提议幂等键与正式事件 commandId 不一致。");
      }
      const actionSequence = assertFiniteInteger(
        payload.actionSequence,
        "效果选择来源行动序号",
        1,
        event.sequence - 1,
      );
      const ownerActorKey = String(payload.ownerActorKey ?? "").trim();
      if (event.actorKey !== "gm" || !ownerActorKey) {
        throw new Error("效果选择提议必须由 GM 提交并绑定所有者。");
      }
      const proposed = proposeTtrpgEffectChoiceToRuntimeV2({
        state,
        plan,
        actionSequence,
        ownerActorKey,
        eventSequence: event.sequence,
      });
      Object.assign(state, proposed.state);
      break;
    }
    case "ttrpg.effects.applied": {
      const product = requireTtrpgState(state).product;
      if (!product?.sessionZero.completed || !product.effectLedger) {
        throw new Error("正式 EffectPlan 需要已完成 Session Zero 的效果账本。");
      }
      const plan = parseTtrpgEffectPlanV2(payload.plan);
      if (plan.idempotencyKey !== event.commandId)
        throw new Error("EffectPlan 幂等键与正式事件 commandId 不一致。");
      const rulePack = parseRulePackV1(payload.rulePack);
      if (payload.choiceKey != null) {
        if (!isObject(payload.requestedBy)) {
          throw new Error("效果选择结算缺少操作者。");
        }
        const choiceKey = String(payload.choiceKey ?? "").trim();
        const selectedEffectKey = String(
          payload.selectedEffectKey ?? "",
        ).trim();
        const requestedBy = {
          role: String(payload.requestedBy.role ?? ""),
          actorKey: String(payload.requestedBy.actorKey ?? "").trim(),
        };
        const pending = product.effectLedger.pendingChoices.find(
          (choice) => choice.choiceKey === choiceKey,
        );
        if (
          !pending ||
          !["gm", "player"].includes(requestedBy.role) ||
          requestedBy.actorKey !== pending.ownerActorKey ||
          event.actorKey !== pending.ownerActorKey
        ) {
          throw new Error("效果选择结算身份或所有者不一致。");
        }
        const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
          state,
          rulePack,
          choiceKey,
          selectedEffectKey,
          commandId: event.commandId,
          eventSequence: event.sequence,
        });
        if (stableJson(resolved.plan) !== stableJson(plan)) {
          throw new Error("效果选择结算计划不是由冻结选项派生。");
        }
        Object.assign(state, resolved.state);
        break;
      }
      if (
        product.effectLedger.pendingChoices.some(
          (choice) => choice.plan.sourceEventId === plan.sourceEventId,
        )
      ) {
        throw new Error("该行动已有待玩家确认的后果，不能绕过选择直接结算。");
      }
      const applied = applyTtrpgEffectPlanToRuntimeV2({
        state,
        rulePack,
        plan,
        eventSequence: event.sequence,
      });
      Object.assign(state, applied.state);
      break;
    }
    case "ttrpg.gm.response.recorded": {
      const ttrpg = requireTtrpgState(state);
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("跑团尚未开始活动场景。");
      const actionSequence = assertFiniteInteger(
        payload.actionSequence,
        "跑团动作序号",
        1,
        event.sequence - 1,
      );
      if (
        !ttrpg.actions.some((action) => action.eventSequence === actionSequence)
      ) {
        throw new Error("AI GM 叙事没有对应的玩家动作。");
      }
      if (payload.checkSequence != null) {
        const checkSequence = assertFiniteInteger(
          payload.checkSequence,
          "跑团检定序号",
          1,
          event.sequence - 1,
        );
        if (
          !ttrpg.checks.some((check) => check.eventSequence === checkSequence)
        ) {
          throw new Error("AI GM 叙事引用了不存在的检定。");
        }
      }
      const text = String(payload.text ?? "").trim();
      if (!text || text.length > 20_000)
        throw new Error("AI GM 叙事文本无效。");
      if (ttrpg.product) {
        const source = String(payload.source ?? "ai-confirmed");
        const candidateHash =
          payload.candidateHash == null ? null : String(payload.candidateHash);
        const runId =
          payload.runId == null
            ? null
            : assertFiniteInteger(
                payload.runId,
                "AI GM Run ID",
                1,
                Number.MAX_SAFE_INTEGER,
              );
        const latestAction =
          ttrpg.product.actionHistory[ttrpg.product.actionHistory.length - 1];
        if (
          !["human-gm", "ai-confirmed", "deterministic-fallback"].includes(
            source,
          ) ||
          (source === "ai-confirmed" &&
            (!candidateHash ||
              !/^[0-9a-f]{64}$/.test(candidateHash) ||
              runId == null)) ||
          ((source === "human-gm" || source === "deterministic-fallback") &&
            (candidateHash != null || runId != null)) ||
          latestAction?.eventSequence !== actionSequence
        ) {
          throw new Error("正式 GM 叙事证据无效或没有绑定最近规则行动。");
        }
        const checkSequence =
          payload.checkSequence == null
            ? null
            : assertFiniteInteger(
                payload.checkSequence,
                "跑团检定序号",
                1,
                event.sequence - 1,
              );
        if ((latestAction.check?.eventSequence ?? null) !== checkSequence) {
          throw new Error("正式 AI GM 叙事引用的检定与规则行动不一致。");
        }
        if (
          ttrpg.product.gmNarrations.some(
            (item) => item.actionSequence === actionSequence,
          )
        ) {
          throw new Error("最近规则行动已经有正式 GM 叙事。");
        }
        const modelEvidence = parseTtrpgModelEvidenceV1(payload.modelEvidence);
        const modelCalls = Array.isArray(payload.modelCalls)
          ? payload.modelCalls
              .map(parseTtrpgModelEvidenceV1)
              .filter(
                (item): item is SimulationTtrpgModelEvidenceV1 => item != null,
              )
          : modelEvidence
            ? [modelEvidence]
            : [];
        const repairApplied = payload.repairApplied === true;
        if (
          modelCalls.length > 2 ||
          ((source === "human-gm" || source === "deterministic-fallback") &&
            (modelEvidence || modelCalls.length || repairApplied))
        ) {
          throw new Error("正式 GM 模型调用或修复证据无效。");
        }
        const synthesisFrame =
          payload.synthesisFrame == null
            ? null
            : latestAction.receipt
              ? parseTtrpgGmSynthesisFrameV2(
                  payload.synthesisFrame,
                  latestAction.receipt,
                )
              : (() => {
                  throw new Error("正式 GM 综合帧缺少 ActionReceipt。");
                })();
        ttrpg.product.gmNarrations.push({
          eventSequence: event.sequence,
          actionSequence,
          checkSequence,
          text,
          candidateHash,
          runId,
          modelEvidence,
          modelCalls,
          repairApplied,
          synthesisFrame,
          source: source as
            "human-gm" | "ai-confirmed" | "deterministic-fallback",
        });
      }
      state.narratives.push({ eventSequence: event.sequence, text });
      break;
    }
    case "ttrpg.campaign.ended": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product ||
        product.ending ||
        !ttrpg.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("正式战役当前不能提交结局。");
      }
      const endingKey = String(payload.endingKey ?? "").trim();
      const ending = product.endingCatalog.find(
        (item) => item.endingKey === endingKey,
      );
      if (
        !ending ||
        payload.title !== ending.title ||
        payload.epilogue !== ending.epilogue
      ) {
        throw new Error("战役结局与冻结 CampaignPack 不一致。");
      }
      const knownConclusions = new Set(
        product.discoveredClues.flatMap((discovery) => {
          const clue = product.clueCatalog.find(
            (item) => item.clueKey === discovery.clueKey,
          );
          return clue ? [clue.conclusionKey] : [];
        }),
      );
      if (ending.trigger) {
        if (
          ending.trigger.sceneKey !== ttrpg.scene.sceneKey ||
          ending.trigger.requiredConclusionKeys.some(
            (key) => !knownConclusions.has(key),
          ) ||
          ending.trigger.forbiddenConclusionKeys.some((key) =>
            knownConclusions.has(key),
          )
        ) {
          throw new Error("战役结局触发条件与当前状态不一致。");
        }
      } else if (
        product.questProgress.some((quest) => quest.status !== "completed")
      ) {
        throw new Error("正式战役仍有未完成主线任务。");
      }
      if (!Array.isArray(payload.awardedMilestones))
        throw new Error("战役结局缺少成长里程碑。");
      const awardedMilestones = payload.awardedMilestones.map((raw, index) => {
        if (!isObject(raw)) throw new Error(`战役成长奖励 ${index} 无效。`);
        return {
          milestoneKey: String(raw.milestoneKey ?? "").trim(),
          award: assertFiniteInteger(raw.award, "战役成长奖励", 0, 1_000_000),
        };
      });
      const expectedMilestones = product.advancement.milestones
        .filter(
          (item, index) =>
            !product.advancement.awardedMilestoneKeys.includes(
              item.milestoneKey,
            ) && product.questProgress[index]?.status === "completed",
        )
        .map((item) => ({
          milestoneKey: item.milestoneKey,
          award: item.award,
        }));
      if (stableJson(awardedMilestones) !== stableJson(expectedMilestones)) {
        throw new Error("战役成长奖励与冻结 CampaignPack 不一致。");
      }
      product.advancement.awardedMilestoneKeys.push(
        ...awardedMilestones.map((item) => item.milestoneKey),
      );
      product.advancement.totalAwarded += awardedMilestones.reduce(
        (sum, item) => sum + item.award,
        0,
      );
      product.ending = { endingKey, eventSequence: event.sequence };
      ttrpg.scene.status = "resolved";
      ttrpg.activeActorKey = null;
      state.narratives.push({
        eventSequence: event.sequence,
        text: ending.epilogue,
      });
      break;
    }
    case "ttrpg.turn.advanced": {
      const ttrpg = requireTtrpgState(state);
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("跑团尚未开始活动场景。");
      const nextActorKey = String(payload.nextActorKey ?? "").trim();
      const round = assertFiniteInteger(
        payload.round,
        "跑团回合",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      if (!ttrpg.turnOrder.includes(nextActorKey))
        throw new Error("下一个行动者不在当前回合顺序中。");
      const currentIndex = ttrpg.turnOrder.indexOf(ttrpg.activeActorKey ?? "");
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
      const expectedActorKey = ttrpg.turnOrder[nextIndex];
      const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0);
      if (nextActorKey !== expectedActorKey || round !== expectedRound) {
        throw new Error("跑团回合推进与确定性顺序不一致。");
      }
      ttrpg.activeActorKey = nextActorKey;
      ttrpg.round = round;
      break;
    }
    case "ttrpg.encounter.started": {
      const ttrpg = requireTtrpgState(state);
      if (!ttrpg.scene || ttrpg.scene.status !== "active")
        throw new Error("请先开始一个跑团场景。");
      if (ttrpg.encounter?.status === "active")
        throw new Error("当前已有进行中的战斗遭遇。");
      const encounter = assertTtrpgEncounter(payload.encounter);
      for (const actorKey of encounter.turnOrder) {
        const actor = state.entities[actorKey];
        if (!actor || !["player", "character", "npc"].includes(actor.kind)) {
          throw new Error(`遭遇参与者不存在或类型不支持: ${actorKey}`);
        }
      }
      if (encounter.activeActorKey !== encounter.turnOrder[0])
        throw new Error("遭遇必须从先攻最高者开始。");
      ttrpg.encounter = encounter;
      break;
    }
    case "ttrpg.encounter.resolved": {
      const ttrpg = requireTtrpgState(state);
      const encounter = ttrpg.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("当前没有进行中的战斗遭遇。");
      const reason = String(payload.reason ?? "").trim();
      if (reason.length > 2_000) throw new Error("遭遇结束理由过长。");
      encounter.status = "resolved";
      encounter.activeActorKey = null;
      if (reason)
        state.narratives.push({
          eventSequence: event.sequence,
          text: `遭遇结束：${reason}`,
        });
      break;
    }
    case "ttrpg.combat.attack.resolved": {
      const ttrpg = requireTtrpgState(state);
      const encounter = ttrpg.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("请先开始一个战斗遭遇。");
      const attack = assertTtrpgAttackResult(payload.attack);
      if (
        attack.actorKey !== event.actorKey ||
        attack.targetKey !== event.targetKey
      ) {
        throw new Error("攻击事件的行动者或目标与事件元数据不一致。");
      }
      if (encounter.activeActorKey !== attack.actorKey)
        throw new Error("当前还没轮到该战斗行动者。");
      if (
        !encounter.combatants[attack.actorKey] ||
        !encounter.combatants[attack.targetKey]
      ) {
        throw new Error("攻击行动者或目标不在当前遭遇中。");
      }
      ttrpg.attacks.push(attack);
      break;
    }
    case "ttrpg.combat.resource.changed": {
      const ttrpg = requireTtrpgState(state);
      const encounter = ttrpg.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("请先开始一个战斗遭遇。");
      const entityKey = String(payload.entityKey ?? "").trim();
      const resourceKey = String(payload.resourceKey ?? "").trim();
      const delta = assertFiniteInteger(
        payload.delta,
        "资源变化量",
        -1_000_000_000,
        1_000_000_000,
      );
      const combatant = encounter.combatants[entityKey];
      if (!combatant || !resourceKey || resourceKey.length > 80)
        throw new Error("资源变化目标无效。");
      if (event.targetKey !== entityKey)
        throw new Error("资源变化事件目标与实体不一致。");
      const resource = combatant.resources[resourceKey];
      if (!resource) throw new Error(`战斗参与者没有资源: ${resourceKey}`);
      const expectedCurrent = Math.max(
        0,
        Math.min(resource.maximum, resource.current + delta),
      );
      const current = assertFiniteInteger(
        payload.current,
        "资源当前值",
        0,
        resource.maximum,
      );
      if (current !== expectedCurrent)
        throw new Error("资源变化结果与当前资源不一致。");
      combatant.resources[resourceKey] = { ...resource, current };
      break;
    }
    case "ttrpg.combat.condition.applied": {
      const ttrpg = requireTtrpgState(state);
      const encounter = ttrpg.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("请先开始一个战斗遭遇。");
      const entityKey = String(payload.entityKey ?? "").trim();
      const combatant = encounter.combatants[entityKey];
      if (!combatant) throw new Error("状态效果目标不在当前遭遇中。");
      if (event.targetKey !== entityKey)
        throw new Error("状态效果事件目标与实体不一致。");
      const condition = assertTtrpgCondition(payload.condition);
      const existing = combatant.conditions.find(
        (item) => item.conditionId === condition.conditionId,
      );
      if (existing) {
        existing.stacks = Math.min(1_000, existing.stacks + condition.stacks);
        existing.duration = condition.duration;
        existing.description = condition.description;
      } else {
        combatant.conditions.push(condition);
      }
      break;
    }
    case "ttrpg.combat.condition.removed": {
      const ttrpg = requireTtrpgState(state);
      const encounter = ttrpg.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("请先开始一个战斗遭遇。");
      const entityKey = String(payload.entityKey ?? "").trim();
      const conditionId = String(payload.conditionId ?? "").trim();
      const combatant = encounter.combatants[entityKey];
      if (!combatant || !conditionId) throw new Error("状态效果移除目标无效。");
      if (event.targetKey !== entityKey)
        throw new Error("状态效果事件目标与实体不一致。");
      combatant.conditions = combatant.conditions.filter(
        (condition) => condition.conditionId !== conditionId,
      );
      break;
    }
    case "ttrpg.combat.turn.advanced": {
      const ttrpg = requireTtrpgState(state);
      const encounter = ttrpg.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("请先开始一个战斗遭遇。");
      const nextActorKey = String(payload.nextActorKey ?? "").trim();
      const round = assertFiniteInteger(
        payload.round,
        "战斗回合",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      if (!encounter.turnOrder.includes(nextActorKey))
        throw new Error("下一个战斗行动者不在遭遇中。");
      const currentIndex = encounter.turnOrder.indexOf(
        encounter.activeActorKey ?? "",
      );
      const nextIndex = (currentIndex + 1) % encounter.turnOrder.length;
      const expectedActorKey = encounter.turnOrder[nextIndex];
      const expectedRound = encounter.round + (nextIndex === 0 ? 1 : 0);
      if (nextActorKey !== expectedActorKey || round !== expectedRound)
        throw new Error("战斗回合推进与先攻顺序不一致。");
      const leaving = encounter.activeActorKey
        ? encounter.combatants[encounter.activeActorKey]
        : null;
      if (leaving) {
        leaving.conditions = leaving.conditions
          .map((condition) =>
            condition.duration == null
              ? condition
              : { ...condition, duration: condition.duration - 1 },
          )
          .filter(
            (condition) => condition.duration == null || condition.duration > 0,
          );
      }
      encounter.activeActorKey = nextActorKey;
      encounter.round = round;
      break;
    }
    case "ttrpg.campaign.summary.updated": {
      const ttrpg = requireTtrpgState(state);
      const baseSequence = assertFiniteInteger(
        payload.baseSequence,
        "战役摘要基线序号",
        0,
        event.sequence - 1,
      );
      if (baseSequence !== event.sequence - 1)
        throw new Error("战役摘要基线与事件序号不一致。");
      const summary = String(payload.summary ?? "").trim();
      if (summary.length > 20_000) throw new Error("长期战役摘要过长。");
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState();
      ttrpg.campaign.summary = summary;
      break;
    }
    case "ttrpg.campaign.quest.upserted": {
      const ttrpg = requireTtrpgState(state);
      const quest = assertTtrpgQuest(payload.quest);
      if (quest.updatedSequence !== event.sequence)
        throw new Error("战役任务更新时间序号不一致。");
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState();
      const index = ttrpg.campaign.quests.findIndex(
        (item) => item.questId === quest.questId,
      );
      if (index >= 0) ttrpg.campaign.quests[index] = quest;
      else ttrpg.campaign.quests.push(quest);
      break;
    }
    case "ttrpg.campaign.schedule.upserted": {
      const ttrpg = requireTtrpgState(state);
      const schedule = assertTtrpgNpcSchedule(payload.schedule);
      if (schedule.updatedSequence !== event.sequence)
        throw new Error("NPC 日程更新时间序号不一致。");
      const npc = state.entities[schedule.entityKey];
      if (!npc || !isNpcRuntimeEntity(npc))
        throw new Error("NPC 日程目标不是当前运行时 NPC。");
      if (schedule.locationKey != null) {
        const location = state.entities[schedule.locationKey];
        if (!location || location.kind !== "location")
          throw new Error("NPC 日程地点不是当前运行时地点。");
      }
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState();
      const index = ttrpg.campaign.npcSchedules.findIndex(
        (item) => item.scheduleId === schedule.scheduleId,
      );
      if (index >= 0) ttrpg.campaign.npcSchedules[index] = schedule;
      else ttrpg.campaign.npcSchedules.push(schedule);
      break;
    }
    case "ttrpg.campaign.session.started": {
      const ttrpg = requireTtrpgState(state);
      const product = ttrpg.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        ttrpg.campaign?.activeSessionKey != null
      ) {
        throw new Error("当前正式战役不能开始新的长期分场。");
      }
      ttrpg.campaign = ttrpg.campaign ?? emptyTtrpgCampaignState();
      const playSession = assertTtrpgCampaignPlaySessionV2(payload.playSession);
      if (
        playSession.status !== "active" ||
        playSession.startedSequence !== event.sequence ||
        playSession.completedSequence != null ||
        playSession.ordinal !== ttrpg.campaign.playSessions.length + 1 ||
        playSession.rulePackContentHash !== product.rulePackContentHash ||
        playSession.campaignKey !== product.campaignKey ||
        ttrpg.campaign.playSessions.some(
          (item) => item.sessionKey === playSession.sessionKey,
        )
      ) {
        throw new Error("长期战役分场开始收据与当前冻结战役不一致。");
      }
      const activeRoster = ttrpg.campaign.roster
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey)
        .sort();
      const participants = [...playSession.participantKeys].sort();
      if (
        !activeRoster.length ||
        stableJson(activeRoster) !== stableJson(participants) ||
        participants.some((key) => state.entities[key]?.kind !== "player")
      ) {
        throw new Error("长期战役分场参与者必须精确匹配当前活动编组。");
      }
      ttrpg.campaign.playSessions.push(playSession);
      ttrpg.campaign.activeSessionKey = playSession.sessionKey;
      ttrpg.campaign.roster = ttrpg.campaign.roster.map((entry) =>
        entry.status === "active" && entry.joinedSessionKey == null
          ? {
              ...entry,
              joinedSessionKey: playSession.sessionKey,
              updatedSequence: event.sequence,
            }
          : entry,
      );
      break;
    }
    case "ttrpg.campaign.session.completed": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign ?? emptyTtrpgCampaignState();
      const sessionKey = longCampaignKey(
        payload.sessionKey,
        "长期战役完成分场 key",
      );
      const active = campaignState.playSessions.find(
        (item) => item.sessionKey === sessionKey,
      );
      const summary = longCampaignText(
        payload.summary,
        "长期战役分场摘要",
        20_000,
      );
      if (
        campaignState.activeSessionKey !== sessionKey ||
        active?.status !== "active" ||
        active.completedSequence != null ||
        !Array.isArray(payload.memories) ||
        !Array.isArray(payload.abilityResets)
      ) {
        throw new Error("长期战役完成事件没有绑定当前活动分场。");
      }
      const memories = payload.memories.map(assertTtrpgCampaignMemoryV2);
      if (
        new Set(memories.map((item) => item.memoryKey)).size !==
          memories.length ||
        memories.some(
          (item) =>
            item.sourceSessionKey !== sessionKey ||
            item.updatedSequence !== event.sequence ||
            campaignState.memories.some(
              (prior) => prior.memoryKey === item.memoryKey,
            ) ||
            (item.audience.startsWith("actor:") &&
              !campaignState.roster.some(
                (entry) =>
                  entry.characterKey === item.audience.slice("actor:".length),
              )),
        )
      ) {
        throw new Error("长期战役记忆没有唯一绑定当前分场或合法受众。");
      }
      const product = ttrpg.product;
      if (!product?.abilityStates)
        throw new Error("长期战役缺少技能次数台账。");
      for (const raw of payload.abilityResets) {
        if (!isObject(raw)) throw new Error("能力跨场重置项无效。");
        const stateKey = String(raw.stateKey ?? "").trim();
        const before = parseTtrpgAbilityRuntimeStateV2(raw.before);
        const after = parseTtrpgAbilityRuntimeStateV2(raw.after);
        if (
          stateKey !==
            ttrpgAbilityStateKeyV2(before.actorInstanceId, before.abilityKey) ||
          stableJson(product.abilityStates[stateKey]) !== stableJson(before) ||
          after.actorInstanceId !== before.actorInstanceId ||
          after.abilityKey !== before.abilityKey ||
          after.lastUsedEventId !== `event.${event.sequence}`
        ) {
          throw new Error(`能力跨场重置基线不一致:${stateKey}`);
        }
        product.abilityStates[stateKey] = after;
      }
      active.status = "completed";
      active.completedSequence = event.sequence;
      active.summary = summary;
      campaignState.activeSessionKey = null;
      campaignState.memories.push(...memories);
      const summaryEntry = `第 ${active.ordinal} 场《${active.title}》：${summary}`;
      campaignState.summary = [campaignState.summary, summaryEntry]
        .filter(Boolean)
        .join("\n\n")
        .slice(-20_000);
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.roster.changed": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign ?? emptyTtrpgCampaignState();
      if (campaignState.activeSessionKey != null)
        throw new Error("长期战役只能在两场之间变更编组。");
      const entry = assertTtrpgRosterEntryV2(payload.entry);
      const priorIndex = campaignState.roster.findIndex(
        (item) => item.characterKey === entry.characterKey,
      );
      const prior = campaignState.roster[priorIndex];
      if (
        !prior ||
        entry.updatedSequence !== event.sequence ||
        state.entities[entry.characterKey]?.kind !== "player" ||
        !ttrpg.product?.characterProgression?.[entry.characterKey] ||
        prior.status === "retired" ||
        prior.status === entry.status ||
        (prior.status === "reserve" && entry.status !== "active") ||
        (prior.status === "active" && entry.status === "active") ||
        entry.joinedSessionKey !== prior.joinedSessionKey ||
        (entry.status === "retired" && entry.leftSessionKey == null) ||
        (entry.status !== "retired" && entry.leftSessionKey != null)
      ) {
        throw new Error("长期战役编组变更不是允许的补员、轮换或退役迁移。");
      }
      if (entry.replacementFor != null) {
        const replaced = campaignState.roster.find(
          (item) => item.characterKey === entry.replacementFor,
        );
        if (
          entry.status !== "active" ||
          entry.replacementFor === entry.characterKey ||
          replaced?.status !== "retired"
        ) {
          throw new Error("补员替代关系必须指向已经退役的不同角色。");
        }
      }
      const nextRoster = [...campaignState.roster];
      nextRoster[priorIndex] = entry;
      const activeKeys = nextRoster
        .filter((item) => item.status === "active")
        .map((item) => item.characterKey);
      if (!activeKeys.length || activeKeys.length > 12)
        throw new Error("长期战役必须保留 1–12 名活动角色。");
      campaignState.roster = nextRoster;
      ttrpg.campaign = campaignState;
      ttrpg.product.sessionZero.selectedCharacterKeys = activeKeys;
      break;
    }
    case "ttrpg.campaign.supplement.activated": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign ?? emptyTtrpgCampaignState();
      if (campaignState.activeSessionKey != null)
        throw new Error("补充包只能在两场之间激活。");
      const supplement = assertTtrpgSupplementReceiptV2(payload.supplement);
      if (
        supplement.updatedSequence !== event.sequence ||
        campaignState.supplements.some(
          (item) => item.supplementKey === supplement.supplementKey,
        ) ||
        (supplement.activatedSessionKey != null &&
          !campaignState.playSessions.some(
            (item) =>
              item.sessionKey === supplement.activatedSessionKey &&
              item.status === "completed",
          ))
      ) {
        throw new Error("补充包激活收据无效或重复。");
      }
      campaignState.supplements.push(supplement);
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.world-evolution.recorded": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign ?? emptyTtrpgCampaignState();
      if (campaignState.activeSessionKey != null)
        throw new Error("世界演化候选只能在两场之间记录或复审。");
      const candidate = assertTtrpgWorldEvolutionV2(payload.candidate);
      if (
        candidate.updatedSequence !== event.sequence ||
        !campaignState.playSessions.some(
          (item) =>
            item.sessionKey === candidate.sourceSessionKey &&
            item.status === "completed",
        )
      ) {
        throw new Error("世界演化候选没有绑定已完成分场。");
      }
      const index = campaignState.worldEvolution.findIndex(
        (item) => item.candidateKey === candidate.candidateKey,
      );
      const prior = campaignState.worldEvolution[index];
      if (!prior) {
        if (candidate.status !== "proposed" || candidate.reviewedBy != null)
          throw new Error("新世界演化候选必须先进入 proposed 状态。");
        campaignState.worldEvolution.push(candidate);
      } else {
        if (
          prior.status !== "proposed" ||
          candidate.status === "proposed" ||
          candidate.reviewedBy == null ||
          candidate.category !== prior.category ||
          candidate.summary !== prior.summary ||
          candidate.sourceSessionKey !== prior.sourceSessionKey ||
          candidate.targetWorldRef !== prior.targetWorldRef
        ) {
          throw new Error("世界演化候选只能由 proposed 审核为批准或拒绝。");
        }
        campaignState.worldEvolution[index] = candidate;
      }
      // Approval deliberately stops at a review candidate. World Canon writes
      // still require the normal AdoptionSchema/FIELD_REGISTRY path.
      ttrpg.campaign = campaignState;
      break;
    }
    case "ttrpg.campaign.version-transition.recorded": {
      const ttrpg = requireTtrpgState(state);
      const campaignState = ttrpg.campaign ?? emptyTtrpgCampaignState();
      const product = ttrpg.product;
      if (!product || campaignState.activeSessionKey != null)
        throw new Error("版本迁移只能在冻结战役的两场之间记录。");
      const transition = assertTtrpgVersionTransitionV2(payload.transition);
      if (
        transition.updatedSequence !== event.sequence ||
        transition.fromRulePackContentHash !== product.rulePackContentHash ||
        transition.fromCampaignKey !== product.campaignKey ||
        campaignState.versionTransitions.some(
          (item) => item.transitionKey === transition.transitionKey,
        ) ||
        (transition.status === "activated" &&
          (transition.toRulePackContentHash !== product.rulePackContentHash ||
            transition.toCampaignKey !== product.campaignKey))
      ) {
        throw new Error("版本迁移记录与当前冻结内容不一致或试图原地换包。");
      }
      campaignState.versionTransitions.push(transition);
      ttrpg.campaign = campaignState;
      break;
    }
    case "npc.evolution.proposed": {
      const candidate = parseSimulationNpcEvolutionCandidate(payload.candidate);
      if (candidate.baseSequence !== state.lastSequence) {
        throw new Error("NPC 演进候选基线与当前事件序号不一致。");
      }
      prepareNpcEvolution(state, candidate);
      break;
    }
    case "npc.evolution.accepted": {
      const proposalSequence = assertFiniteInteger(
        payload.proposalSequence,
        "NPC 演进提案序号",
        1,
        event.sequence - 1,
      );
      if (state.lastSequence !== proposalSequence) {
        throw new Error("NPC 演进候选已过期，请重新生成。");
      }
      const candidate = parseSimulationNpcEvolutionCandidate(payload.candidate);
      if (candidate.baseSequence !== proposalSequence - 1) {
        throw new Error("NPC 演进候选与提案序号不一致。");
      }
      applyNpcEvolution(state, candidate, event.sequence);
      break;
    }
    case "npc.evolution.rejected": {
      assertFiniteInteger(
        payload.proposalSequence,
        "NPC 演进提案序号",
        1,
        event.sequence - 1,
      );
      const reason = String(payload.reason ?? "").trim();
      if (reason.length > 1_000) throw new Error("NPC 演进拒绝原因过长。");
      break;
    }
  }
  state.lastSequence = event.sequence;
  return state;
}

/** Prepare a release entry state with the same projection later persisted by
 * adventure.narrative.synced. No event is fabricated at sequence zero. */
export function withAdventureNarrativeProjection(
  current: SimulationRuntimeState,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current));
  if (!state.adventure || !state.narrative || state.narrative.version !== 2)
    return state;
  const projection = adventureNarrativeProjection(state.adventure);
  state.narrative.variables = {
    ...state.narrative.variables,
    adventure: projection,
  };
  if (!state.narrative.completed && state.narrative.currentNodeKey) {
    const evaluations = evaluateNarrativeChoices(
      {
        ...state.narrative.variables,
        __visitedNodeKeys: state.narrative.visitedNodeKeys,
        __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(
          (item) => item.choiceKey,
        ),
      },
      state.narrative.currentNodeKey,
      state.narrative.choices ?? [],
    );
    state.narrative.visibleChoiceKeys = evaluations
      .filter((item) => item.visible)
      .map((item) => item.choiceKey);
    state.narrative.availableChoiceKeys = evaluations
      .filter((item) => item.available)
      .map((item) => item.choiceKey);
    state.narrative.availableNodeKeys = [
      ...new Set(
        evaluations
          .filter((item) => item.available)
          .map((item) => item.targetNodeKey),
      ),
    ];
  }
  return parseSimulationState(state);
}

/** Prepare the release entry state with the same projection later persisted by
 * simulation.narrative.synced. Narrative conditions consume this read-only
 * projection; the deterministic simulation remains the source of truth. */
export function withNarrativeSimulationProjection(
  current: SimulationRuntimeState,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current));
  if (
    !state.narrativeSimulation ||
    !state.narrative ||
    state.narrative.version !== 2
  )
    return state;
  const projection = narrativeSimulationProjection(state.narrativeSimulation);
  state.narrative.variables = {
    ...state.narrative.variables,
    simulation: projection,
  };
  if (!state.narrative.completed && state.narrative.currentNodeKey) {
    const evaluations = evaluateNarrativeChoices(
      {
        ...state.narrative.variables,
        __visitedNodeKeys: state.narrative.visitedNodeKeys,
        __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(
          (item) => item.choiceKey,
        ),
      },
      state.narrative.currentNodeKey,
      state.narrative.choices ?? [],
    );
    state.narrative.visibleChoiceKeys = evaluations
      .filter((item) => item.visible)
      .map((item) => item.choiceKey);
    state.narrative.availableChoiceKeys = evaluations
      .filter((item) => item.available)
      .map((item) => item.choiceKey);
    state.narrative.availableNodeKeys = [
      ...new Set(
        evaluations
          .filter((item) => item.available)
          .map((item) => item.targetNodeKey),
      ),
    ];
  }
  return parseSimulationState(state);
}

/** Prepare a TEXTWORLD release entry with the same read-only projection that
 * later world.narrative.synced events verify during replay. */
export function withOpenWorldNarrativeProjection(
  current: SimulationRuntimeState,
): SimulationRuntimeState {
  const state = cloneState(parseSimulationState(current));
  if (!state.openWorld || !state.narrative || state.narrative.version !== 2)
    return state;
  const projection = openWorldMainlineProjection(
    state.openWorld,
    state.openWorld.mainlineQuestKeys,
  );
  state.narrative.variables = {
    ...state.narrative.variables,
    openWorld: projection,
  };
  if (!state.narrative.completed && state.narrative.currentNodeKey) {
    const evaluations = evaluateNarrativeChoices(
      {
        ...state.narrative.variables,
        __visitedNodeKeys: state.narrative.visitedNodeKeys,
        __selectedChoiceKeys: (state.narrative.choiceHistory ?? []).map(
          (item) => item.choiceKey,
        ),
      },
      state.narrative.currentNodeKey,
      state.narrative.choices ?? [],
    );
    state.narrative.visibleChoiceKeys = evaluations
      .filter((item) => item.visible)
      .map((item) => item.choiceKey);
    state.narrative.availableChoiceKeys = evaluations
      .filter((item) => item.available)
      .map((item) => item.choiceKey);
    state.narrative.availableNodeKeys = [
      ...new Set(
        evaluations
          .filter((item) => item.available)
          .map((item) => item.targetNodeKey),
      ),
    ];
  }
  return parseSimulationState(state);
}

export function replaySimulationEvents(
  initialState: SimulationRuntimeState,
  events: readonly SimulationEvent[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): SimulationRuntimeState {
  let state = cloneState(parseSimulationState(initialState));
  const ordered = [...events]
    .filter((event) => event.sequence <= throughSequence)
    .sort((a, b) => a.sequence - b.sequence);
  for (const event of ordered) state = applySimulationEvent(state, event);
  return state;
}

async function assertSessionScope(input: {
  projectId: number;
  worldGroupId?: number | null;
}): Promise<void> {
  if (!(await db.projects.get(input.projectId)))
    throw new Error("模拟会话所属项目不存在。");
  if (input.worldGroupId != null) {
    const world = await db.worldGroups.get(input.worldGroupId);
    if (!world || world.projectId !== input.projectId) {
      throw new Error("模拟会话所属世界不存在或不属于当前项目。");
    }
  }
}

function defaultSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function prepareSimulationSessionRecord(
  input: CreateSimulationSessionInput,
  binding?: Pick<
    SimulationSession,
    | "worldId"
    | "workId"
    | "gameReleaseId"
    | "gameBuildId"
    | "runtimeSourceHash"
  >,
): Promise<SimulationSession> {
  await assertSessionScope(input);
  if (!SIMULATION_SESSION_KINDS.includes(input.kind))
    throw new Error("未知模拟会话类型。");
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("模拟会话标题无效。");
  const initialState = parseSimulationState(
    input.initialState ?? EMPTY_SIMULATION_STATE,
  );
  if (initialState.lastSequence !== 0)
    throw new Error("模拟会话初始状态 lastSequence 必须为 0。");
  const canonSnapshot = input.canonSnapshot ?? { version: 1, sources: [] };
  if (!isObject(canonSnapshot)) throw new Error("Canon 冻结快照必须是对象。");
  const now = Date.now();
  const initialStateJson = JSON.stringify(initialState);
  const session: SimulationSession = {
    projectId: input.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title,
    status: "active",
    rulesetVersion: 1,
    seed: input.seed?.trim() || defaultSeed(),
    canonSnapshotJson: JSON.stringify(canonSnapshot),
    initialStateJson,
    runtimeHeadSequence: 0,
    runtimeHeadStateJson: initialStateJson,
    runtimeHeadStateHash: await hashStateJson(initialStateJson),
    parentSessionId: null,
    parentThroughSequence: null,
    createdAt: now,
    updatedAt: now,
    ...binding,
  };
  return session;
}

async function insertSimulationSession(
  input: CreateSimulationSessionInput,
  binding?: Pick<
    SimulationSession,
    | "worldId"
    | "workId"
    | "gameReleaseId"
    | "gameBuildId"
    | "runtimeSourceHash"
  >,
): Promise<SimulationSession> {
  const session = await prepareSimulationSessionRecord(input, binding);
  session.id = (await db.simulationSessions.add(session)) as number;
  return session;
}

export async function createSimulationSession(
  input: CreateSimulationSessionInput,
): Promise<SimulationSession> {
  if (isFormalProductSessionKindV1(input.kind)) {
    throw new Error(
      "新建正式上层产品必须通过不可变 GameRelease 或受治理的 Build Preview；createSimulationSession 只允许 sandbox 与 NPC 演进内核。",
    );
  }
  return insertSimulationSession(input);
}

/**
 * Regression-only constructor for exercising deterministic product kernels without
 * fabricating a full ProductRelease in every unit test. Production builds always
 * reject this boundary; formal UI and services must use release/build launchers.
 */
export async function createSimulationSessionFixtureV1(
  input: CreateSimulationSessionInput,
): Promise<SimulationSession> {
  if (import.meta.env.MODE !== "test") {
    throw new Error("createSimulationSessionFixtureV1 仅允许隔离测试环境使用。");
  }
  return insertSimulationSession(input);
}

function sessionKindForProduct(
  productType: GameRuntimePackageV2["productType"],
): SimulationSessionKind {
  return productType === "storygame"
    ? "storygame"
    : productType === "character-interaction"
      ? "chatgame"
      : productType === "text-adventure"
        ? "textadventure"
        : productType === "avg"
          ? "avg"
          : productType === "narrative-simulation"
            ? "textsimulation"
            : productType === "ttrpg"
              ? "ttrpg"
              : "textworld";
}

function validateFrozenRuntimePackageSession(input: {
  session: CreateSimulationSessionInput;
  runtimePackage: GameRuntimePackageV2;
  runtimeSourceHash: string;
  origin: "release" | "preview" | "branch";
}): void {
  const { runtimePackage, runtimeSourceHash } = input;
  if (
    input.session.kind !== sessionKindForProduct(runtimePackage.productType)
  ) {
    throw new Error(`${runtimePackage.productType} 与会话类型不匹配。`);
  }
  const initial = parseSimulationState(
    input.session.initialState ?? EMPTY_SIMULATION_STATE,
  );
  const narrative = initial.narrative;
  const sourceMismatch =
    narrative?.version !== 2 ||
    narrative.contentHash !== runtimeSourceHash ||
    narrative.sourceHash !== runtimeSourceHash ||
    narrative.moduleKind !== runtimePackage.narrative.moduleKind ||
    narrative.moduleTitle !== runtimePackage.narrative.moduleTitle ||
    stableJson(narrative.nodes) !==
      stableJson(runtimePackage.narrative.nodes) ||
    stableJson(narrative.beats) !==
      stableJson(runtimePackage.narrative.beats) ||
    stableJson(narrative.choices) !==
      stableJson(runtimePackage.narrative.choices);
  const entryMismatch =
    input.origin !== "branch" &&
    narrative?.version === 2 &&
    (narrative.currentNodeKey !== runtimePackage.narrative.entryNodeKey ||
      narrative.choiceHistory?.length !== 0 ||
      narrative.visitedNodeKeys.length !== 1 ||
      narrative.visitedNodeKeys[0] !== runtimePackage.narrative.entryNodeKey);
  if (sourceMismatch || entryMismatch) {
    throw new Error("文字游戏初始叙事必须来自绑定 RuntimePackage 的冻结内容。");
  }
  if (runtimePackage.productType === "character-interaction") {
    const interaction = initial.interaction;
    const releaseInitial = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    });
    const frozenMismatch =
      !interaction ||
      interaction.playerKey !== releaseInitial.playerKey ||
      stableJson(interaction.profiles) !==
        stableJson(releaseInitial.profiles) ||
      stableJson(interaction.sceneTemplates) !==
        stableJson(releaseInitial.sceneTemplates);
    const entryStateMismatch =
      input.origin !== "branch" &&
      stableJson(interaction) !== stableJson(releaseInitial);
    if (frozenMismatch || entryStateMismatch) {
      throw new Error(
        "chatgame 初始状态必须来自绑定 RuntimePackage 的冻结互动内容。",
      );
    }
  }
  if (runtimePackage.productType === "text-adventure") {
    const adventure = initial.adventure;
    const releaseInitial = createInitialAdventureState(
      runtimePackage.adventure!,
      runtimeSourceHash,
    );
    const frozenMismatch =
      !adventure ||
      adventure.contentHash !== runtimeSourceHash ||
      stableJson(adventure.abilities) !==
        stableJson(releaseInitial.abilities) ||
      Object.keys(adventure.resources).some(
        (key) =>
          !Object.prototype.hasOwnProperty.call(releaseInitial.resources, key),
      );
    const entryStateMismatch =
      input.origin !== "branch" &&
      stableJson(adventure) !== stableJson(releaseInitial);
    if (frozenMismatch || entryStateMismatch) {
      throw new Error(
        "textadventure 初始状态必须来自绑定 RuntimePackage 的冻结冒险内容。",
      );
    }
  }
  if (runtimePackage.productType === "avg") {
    const presentation = initial.presentation;
    const releaseInitial = createInitialAvgPresentationState({
      contentHash: runtimeSourceHash,
      assets: runtimePackage.presentation!.assets,
      content: runtimePackage.presentation!,
      entryNodeKey: runtimePackage.narrative.entryNodeKey,
    });
    const frozenMismatch =
      !presentation ||
      presentation.contentHash !== runtimeSourceHash ||
      stableJson(presentation.assets) !== stableJson(releaseInitial.assets) ||
      stableJson(presentation.cues) !== stableJson(releaseInitial.cues);
    const entryStateMismatch =
      input.origin !== "branch" &&
      stableJson(presentation) !== stableJson(releaseInitial);
    if (frozenMismatch || entryStateMismatch)
      throw new Error("avg 初始演出必须来自绑定 RuntimePackage 的冻结内容。");
  }
  if (runtimePackage.productType === "narrative-simulation") {
    const simulation = initial.narrativeSimulation;
    const releaseInitial = createInitialNarrativeSimulationState(
      runtimePackage.simulation!,
      runtimeSourceHash,
    );
    const frozenMismatch =
      !simulation ||
      simulation.contentHash !== runtimeSourceHash ||
      simulation.turnLimit !== releaseInitial.turnLimit ||
      simulation.actionBudget !== releaseInitial.actionBudget ||
      Object.keys(simulation.resources).sort().join(",") !==
        Object.keys(releaseInitial.resources).sort().join(",") ||
      Object.keys(simulation.metrics).sort().join(",") !==
        Object.keys(releaseInitial.metrics).sort().join(",") ||
      Object.keys(simulation.actorStances).sort().join(",") !==
        Object.keys(releaseInitial.actorStances).sort().join(",") ||
      simulation.issues
        .map((item) => item.issueKey)
        .sort()
        .join(",") !==
        releaseInitial.issues
          .map((item) => item.issueKey)
          .sort()
          .join(",");
    const entryStateMismatch =
      input.origin !== "branch" &&
      stableJson(simulation) !== stableJson(releaseInitial);
    if (frozenMismatch || entryStateMismatch) {
      throw new Error(
        "textsimulation 初始状态必须来自绑定 RuntimePackage 的冻结内容。",
      );
    }
  }
  if (runtimePackage.productType === "text-open-world") {
    const expectedInteraction = createInitialInteractionState({
      playerKey: runtimePackage.interaction!.playerKey,
      profiles: runtimePackage.interaction!.profiles,
      sceneTemplates: runtimePackage.interaction!.sceneTemplates,
    });
    const expectedAdventure = createInitialAdventureState(
      runtimePackage.adventure!,
      runtimeSourceHash,
    );
    const expectedSimulation = createInitialNarrativeSimulationState(
      runtimePackage.simulation!,
      runtimeSourceHash,
    );
    const expectedOpenWorld = createInitialOpenWorldState(
      runtimePackage.openWorld!,
      runtimeSourceHash,
    );
    const frozenMismatch =
      !initial.interaction ||
      !initial.adventure ||
      !initial.narrativeSimulation ||
      !initial.openWorld ||
      initial.adventure.contentHash !== runtimeSourceHash ||
      initial.narrativeSimulation.contentHash !== runtimeSourceHash ||
      initial.openWorld.contentHash !== runtimeSourceHash ||
      stableJson(initial.interaction.profiles) !==
        stableJson(expectedInteraction.profiles) ||
      stableJson(initial.interaction.sceneTemplates) !==
        stableJson(expectedInteraction.sceneTemplates) ||
      stableJson(initial.openWorld.mainlineQuestKeys) !==
        stableJson(expectedOpenWorld.mainlineQuestKeys);
    const entryStateMismatch =
      input.origin !== "branch" &&
      (stableJson(initial.interaction) !== stableJson(expectedInteraction) ||
        stableJson(initial.adventure) !== stableJson(expectedAdventure) ||
        stableJson(initial.narrativeSimulation) !==
          stableJson(expectedSimulation) ||
        stableJson(initial.openWorld) !== stableJson(expectedOpenWorld));
    if (frozenMismatch || entryStateMismatch) {
      throw new Error(
        "textworld 初始状态必须来自绑定 RuntimePackage 的全部冻结内容。",
      );
    }
  }
  if (runtimePackage.productType === "ttrpg") {
    assertInitialTtrpgProductStateV1({
      state: initial,
      content: runtimePackage.ttrpg!,
      allowProgress: input.origin === "branch",
    });
  }
}

/** Formal immutable GameRelease v2 lower insertion boundary. */
export async function createReleasedGameSession(
  input: CreateReleasedGameSessionInput,
): Promise<SimulationSession> {
  const gameRelease = await assertGameReleaseUnchanged(input.gameReleaseId);
  if (
    gameRelease.projectId !== input.projectId ||
    gameRelease.worldId !== input.worldId ||
    gameRelease.workId !== input.workId
  ) {
    throw new Error("文字游戏的 GameRelease 绑定无效。");
  }
  const manifest = await verifyGameReleaseManifestV2(gameRelease.manifestJson);
  const runtimePackage = manifest.runtimePackage;
  const runtimeSourceHash = manifest.packageHash;
  validateFrozenRuntimePackageSession({
    session: input,
    runtimePackage,
    runtimeSourceHash,
    origin: input.origin,
  });
  return insertSimulationSession(input, {
    worldId: input.worldId,
    workId: input.workId,
    gameReleaseId: input.gameReleaseId,
    gameBuildId: null,
    runtimeSourceHash,
  });
}

/** Build Preview lower insertion boundary; no generic SIM path may bypass it. */
export async function createPreviewGameSession(
  input: CreatePreviewGameSessionInput,
): Promise<SimulationSession> {
  const verified = await verifyPlayableGamePackageSource({
    scope: {
      projectId: input.projectId,
      worldId: input.worldId,
      workId: input.workId,
    },
    source: {
      kind: "build",
      gameBuildId: input.gameBuildId,
      expectedPreviewHash: input.expectedPreviewHash,
    },
  });
  if (verified.runtimeSourceHash !== input.runtimeSourceHash) {
    throw new Error("文字游戏的 Build Preview 冻结绑定无效。");
  }
  validateFrozenRuntimePackageSession({
    session: input,
    runtimePackage: verified.runtimePackage,
    runtimeSourceHash: verified.runtimeSourceHash,
    origin: input.origin,
  });
  return insertSimulationSession(input, {
    worldId: input.worldId,
    workId: input.workId,
    gameReleaseId: null,
    gameBuildId: input.gameBuildId,
    runtimeSourceHash: verified.runtimeSourceHash,
  });
}

async function readSessionEvents(
  session: SimulationSession,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<SimulationEvent[]> {
  const events = await db.simulationEvents
    .where("sessionId")
    .equals(session.id!)
    .toArray();
  for (const event of events) {
    if (
      event.projectId !== session.projectId ||
      (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)
    ) {
      throw new Error(`模拟事件 ${event.id ?? "?"} 作用域与会话不一致。`);
    }
  }
  return events.filter((event) => event.sequence <= throughSequence);
}

interface SimulationRuntimeHeadV1 {
  state: SimulationRuntimeState;
  stateJson: string;
  stateHash: string;
  sequence: number;
  fromCache: boolean;
}

async function readLatestSessionEventSequenceV1(
  sessionId: number,
): Promise<number> {
  const latest = await db.simulationEvents
    .where("[sessionId+sequence]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .last();
  return latest?.sequence ?? 0;
}

async function readVerifiedSimulationRuntimeHeadV1(
  session: SimulationSession,
): Promise<SimulationRuntimeHeadV1> {
  const latestSequence = await readLatestSessionEventSequenceV1(session.id!);
  const cachedJson = session.runtimeHeadStateJson;
  const cachedHash = session.runtimeHeadStateHash;
  if (
    session.runtimeHeadSequence === latestSequence &&
    typeof cachedJson === "string" &&
    typeof cachedHash === "string" &&
    /^[a-f0-9]{64}$/.test(cachedHash)
  ) {
    try {
      const state = parseSimulationState(cachedJson);
      if (
        state.lastSequence === latestSequence &&
        (await hashStateJson(cachedJson)) === cachedHash
      ) {
        return {
          state,
          stateJson: cachedJson,
          stateHash: cachedHash,
          sequence: latestSequence,
          fromCache: true,
        };
      }
    } catch {
      // The head is derived and recoverable. Fall through to canonical replay.
    }
  }
  const events = await readSessionEvents(session);
  const state = replaySimulationEvents(
    parseSimulationState(session.initialStateJson),
    events,
  );
  const stateJson = JSON.stringify(state);
  return {
    state,
    stateJson,
    stateHash: await hashStateJson(stateJson),
    sequence: state.lastSequence,
    fromCache: false,
  };
}

export async function readSimulationState(
  sessionId: number,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<SimulationRuntimeState> {
  const session = await db.simulationSessions.get(sessionId);
  if (!session) throw new Error("模拟会话不存在。");
  if (throughSequence === Number.MAX_SAFE_INTEGER) {
    return (await readVerifiedSimulationRuntimeHeadV1(session)).state;
  }
  const events = await readSessionEvents(session, throughSequence);
  return replaySimulationEvents(
    parseSimulationState(session.initialStateJson),
    events,
    throughSequence,
  );
}

async function appendBuiltEvent(
  sessionId: number,
  build: (input: {
    session: SimulationSession;
    state: SimulationRuntimeState;
    events: SimulationEvent[];
    sequence: number;
  }) => Omit<
    SimulationEvent,
    "id" | "projectId" | "worldGroupId" | "sessionId" | "sequence" | "createdAt"
  >,
): Promise<SimulationEvent> {
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(sessionId);
      if (!session) throw new Error("模拟会话不存在。");
      if (session.status !== "active")
        throw new Error("只有 active 会话可以追加事件。");
      const events = await readSessionEvents(session);
      const state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      const sequence = state.lastSequence + 1;
      const built = build({ session, state, events, sequence });
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId,
        sequence,
        ...built,
        createdAt: Date.now(),
      };
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      await db.simulationSessions.update(sessionId, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}

export async function appendSimulationEvent(input: {
  sessionId: number;
  type: SimulationEventType;
  actorKey?: string | null;
  targetKey?: string | null;
  payload: unknown;
}): Promise<SimulationEvent> {
  if (input.type === "random.resolved") {
    throw new Error("随机判定只能通过 resolveSimulationDice() 生成。");
  }
  if (input.type.startsWith("interaction.")) {
    throw new Error("受治理的角色互动事件只能通过对应的专用命令 API 生成。");
  }
  if (input.type.startsWith("adventure.")) {
    throw new Error(
      "受治理的文字冒险事件只能通过 commitAdventureAction() 生成。",
    );
  }
  if (input.type.startsWith("presentation.")) {
    throw new Error("受治理的 AVG 演出事件只能通过对应的专用命令 API 生成。");
  }
  if (input.type.startsWith("simulation.")) {
    throw new Error("受治理的复杂模拟事件只能通过对应的专用回合命令生成。");
  }
  if (input.type.startsWith("world.")) {
    throw new Error("受治理的开放世界事件只能通过对应的专用命令生成。");
  }
  if (
    input.type === "npc.evolution.proposed" ||
    input.type === "npc.evolution.accepted" ||
    input.type === "npc.evolution.rejected" ||
    input.type === "ttrpg.scene.opened" ||
    input.type === "ttrpg.action.recorded" ||
    input.type === "ttrpg.check.resolved" ||
    input.type === "ttrpg.gm.response.recorded" ||
    input.type === "ttrpg.turn.advanced" ||
    input.type === "ttrpg.encounter.started" ||
    input.type === "ttrpg.encounter.resolved" ||
    input.type === "ttrpg.combat.attack.resolved" ||
    input.type === "ttrpg.combat.resource.changed" ||
    input.type === "ttrpg.combat.condition.applied" ||
    input.type === "ttrpg.combat.condition.removed" ||
    input.type === "ttrpg.combat.turn.advanced" ||
    input.type === "ttrpg.campaign.summary.updated" ||
    input.type === "ttrpg.campaign.quest.upserted" ||
    input.type === "ttrpg.campaign.schedule.upserted" ||
    input.type === "ttrpg.campaign.session.started" ||
    input.type === "ttrpg.campaign.session.completed" ||
    input.type === "ttrpg.campaign.roster.changed" ||
    input.type === "ttrpg.campaign.supplement.activated" ||
    input.type === "ttrpg.campaign.world-evolution.recorded" ||
    input.type === "ttrpg.campaign.version-transition.recorded" ||
    input.type === "ttrpg.session-zero.completed" ||
    input.type === "ttrpg.safety.changed" ||
    input.type === "ttrpg.clue.discovered" ||
    input.type === "ttrpg.intent.receipted" ||
    input.type === "ttrpg.human-response.recorded" ||
    input.type === "ttrpg.rule.action.resolved" ||
    input.type === "ttrpg.rest.completed" ||
    input.type === "ttrpg.item.changed" ||
    input.type === "ttrpg.effects.choice.proposed" ||
    input.type === "ttrpg.effects.applied" ||
    input.type === "ttrpg.campaign.ended" ||
    input.type === "ttrpg.tabletop.updated" ||
    input.type === "narrative.started" ||
    input.type === "narrative.node.entered" ||
    input.type === "narrative.choice.committed" ||
    input.type === "narrative.ending.reached"
  ) {
    throw new Error("受治理的互动事件只能通过对应的专用 API 生成。");
  }
  return appendBuiltEvent(input.sessionId, ({ sequence }) => {
    let payload = input.payload;
    if (
      input.type === "memory.recorded" &&
      isObject(payload) &&
      isObject(payload.memory)
    ) {
      payload = {
        ...payload,
        memory: {
          ...payload.memory,
          sourceEventSequence: sequence,
        },
      };
    }
    return {
      type: input.type,
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      payloadJson: JSON.stringify(payload),
    };
  });
}

export async function reachAvgPresentationBeat(input: {
  sessionId: number;
  beatKey: string;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  snapshotKey?: string | null;
}): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const beatKey = input.beatKey.trim();
  const baseStateHash = input.baseStateHash.trim();
  if (!beatKey || beatKey.length > 200) throw new Error("[avg] beatKey 无效");
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[avg] 演出命令基线无效");
  }
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (
    !previewSession ||
    previewSession.kind !== "avg" ||
    (previewSession.gameReleaseId == null && previewSession.gameBuildId == null)
  ) {
    throw new Error("[avg] AVG Release/Build Preview 实例不存在");
  }
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replaySimulationEvents(
    parseSimulationState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewHash = await hashStateJson(JSON.stringify(previewState));
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "avg" ||
        (session.gameReleaseId == null && session.gameBuildId == null)
      ) {
        throw new Error("[avg] AVG Release/Build Preview 实例不存在");
      }
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      if (prior) {
        const payload = parseEventPayload(prior);
        if (
          prior.type !== "presentation.beat.reached" ||
          payload.beatKey !== beatKey
        )
          throw new Error("[avg] commandId 已被不同命令使用");
        return prior;
      }
      if (session.status !== "active")
        throw new Error("[avg] 只有 active 会话可以推进演出");
      const state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      if (
        state.lastSequence !== input.baseSequence ||
        previewState.lastSequence !== state.lastSequence ||
        previewHash !== baseStateHash
      ) {
        throw new Error("[avg] 演出状态已变化，请刷新后重试");
      }
      if (!state.presentation || !state.narrative)
        throw new Error("[avg] 当前没有可推进的演出 Beat");
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        sequence: state.lastSequence + 1,
        type: "presentation.beat.reached",
        actorKey: null,
        targetKey: beatKey,
        commandId,
        baseSequence: input.baseSequence,
        baseStateHash,
        payloadJson: JSON.stringify({
          beatKey,
          snapshotKey: input.snapshotKey?.trim() || null,
        }),
        createdAt: Date.now(),
      };
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      await db.simulationSessions.update(session.id!, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}

export async function recordAvgMediaFailure(input: {
  sessionId: number;
  assetKey: string;
  reason: string;
  commandId: string;
}): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const assetKey = input.assetKey.trim();
  const reason = input.reason.trim() || "资源不可用";
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(assetKey))
    throw new Error("[avg] 失败媒资 key 无效");
  if (reason.length > 2_000) throw new Error("[avg] 媒资失败原因过长");
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "avg" ||
        (session.gameReleaseId == null && session.gameBuildId == null)
      ) {
        throw new Error("[avg] AVG Release/Build Preview 实例不存在");
      }
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      if (prior) {
        const payload = parseEventPayload(prior);
        if (
          prior.type !== "presentation.media.failed" ||
          payload.assetKey !== assetKey ||
          payload.reason !== reason
        ) {
          throw new Error("[avg] commandId 已被不同媒资诊断使用");
        }
        return prior;
      }
      const state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        sequence: state.lastSequence + 1,
        type: "presentation.media.failed",
        actorKey: null,
        targetKey: assetKey,
        commandId,
        payloadJson: JSON.stringify({ assetKey, reason }),
        createdAt: Date.now(),
      };
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      await db.simulationSessions.update(session.id!, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}

function normalizeCommandId(value: string): string {
  const commandId = value.trim();
  if (
    !commandId ||
    commandId.length > 200 ||
    !/^[a-zA-Z0-9._:-]+$/.test(commandId)
  ) {
    throw new Error("命令 commandId 无效。");
  }
  return commandId;
}

export async function readSimulationStateVersion(sessionId: number): Promise<{
  sequence: number;
  stateHash: string;
}> {
  const session = await db.simulationSessions.get(sessionId);
  if (!session) throw new Error("模拟会话不存在。");
  const head = await readVerifiedSimulationRuntimeHeadV1(session);
  return {
    sequence: head.sequence,
    stateHash: head.stateHash,
  };
}

type FrozenFormalPlayableSourceV1 = {
  runtimePackage: GameRuntimePackageV2;
  packageHash: string;
  source:
    | { kind: "release"; release: GameRelease & { id: number } }
    | {
        kind: "build";
        build: GameBuildRecordV1 & { id: number };
        production: GameProductionRecordV1 & { id: number };
        brief: GameProductionBriefRecordV1 & { id: number };
      };
};

/**
 * Product-neutral runtime source guard shared by every upper-product command.
 * A formal instance may bind one immutable Product Release or one governed
 * Build Preview; product commands must never reopen the WorldRelease directly.
 */
async function verifyFormalPlayableSourceV1(
  session: SimulationSession,
  allowedProductTypes: readonly GameRuntimePackageV2["productType"][],
): Promise<FrozenFormalPlayableSourceV1> {
  const sourceCount = [session.gameReleaseId, session.gameBuildId]
    .filter((value) => value != null).length;
  if (
    sourceCount !== 1 ||
    session.worldId == null ||
    session.workId == null ||
    !session.runtimeSourceHash
  ) {
    throw new Error("[product-runtime] 正式实例没有唯一冻结 Product Release/Build 来源。");
  }
  const playable = await verifyPlayableSessionPackageV2({
    scope: {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    session,
  });
  if (
    playable.packageHash !== session.runtimeSourceHash ||
    !allowedProductTypes.includes(playable.runtimePackage.productType)
  ) {
    throw new Error("[product-runtime] 实例产品类型或冻结运行包 hash 不匹配。");
  }
  if (session.gameReleaseId != null) {
    const release = await db.gameReleases.get(session.gameReleaseId);
    if (!release?.id) throw new Error("[product-runtime] Product Release 已不存在。");
    return {
      runtimePackage: playable.runtimePackage,
      packageHash: playable.packageHash,
      source: { kind: "release", release: release as GameRelease & { id: number } },
    };
  }
  const build = await db.gameBuilds.get(session.gameBuildId!);
  if (!build?.id) throw new Error("[product-runtime] Product Build 已不存在。");
  const [production, brief] = await Promise.all([
    db.gameProductions.get(build.productionId),
    db.gameProductionBriefs
      .where("[productionId+revision]")
      .equals([build.productionId, build.briefRevision])
      .first(),
  ]);
  if (!production?.id || !brief?.id) {
    throw new Error("[product-runtime] Product Build 的 Production/Brief 来源已损坏。");
  }
  return {
    runtimePackage: playable.runtimePackage,
    packageHash: playable.packageHash,
    source: {
      kind: "build",
      build: build as GameBuildRecordV1 & { id: number },
      production: production as GameProductionRecordV1 & { id: number },
      brief: brief as GameProductionBriefRecordV1 & { id: number },
    },
  };
}

async function assertFormalPlayableSourceUnchangedV1(input: {
  previewSession: SimulationSession;
  session: SimulationSession;
  frozen: FrozenFormalPlayableSourceV1;
}): Promise<void> {
  const session = input.session;
  if (
    session.gameReleaseId !== input.previewSession.gameReleaseId ||
    session.gameBuildId !== input.previewSession.gameBuildId ||
    session.runtimeSourceHash !== input.frozen.packageHash ||
    session.seed !== input.previewSession.seed
  ) {
    throw new Error("[product-runtime] 实例冻结运行源在命令提交期间发生变化。");
  }
  if (input.frozen.source.kind === "release") {
    const release = await db.gameReleases.get(input.frozen.source.release.id);
    if (!release || stableJson(release) !== stableJson(input.frozen.source.release)) {
      throw new Error("[product-runtime] Product Release 在命令提交期间发生变化。");
    }
    return;
  }
  const [build, production, brief] = await Promise.all([
    db.gameBuilds.get(input.frozen.source.build.id),
    db.gameProductions.get(input.frozen.source.production.id),
    db.gameProductionBriefs.get(input.frozen.source.brief.id),
  ]);
  if (
    !build || !production || !brief ||
    stableJson(build) !== stableJson(input.frozen.source.build) ||
    stableJson(production) !== stableJson(input.frozen.source.production) ||
    stableJson(brief) !== stableJson(input.frozen.source.brief)
  ) {
    throw new Error("[product-runtime] Product Build/Production/Brief 在命令提交期间发生变化。");
  }
}

/** Hash an already verified in-memory projection without replaying its event log again. */
export async function hashSimulationRuntimeStateV1(
  state: SimulationRuntimeState,
): Promise<string> {
  return hashStateJson(JSON.stringify(state));
}

export interface FormalTtrpgCommandEnvelope {
  sessionId: number;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}

type FormalTtrpgEventType = Extract<
  SimulationEventType,
  | "ttrpg.character.customized"
  | "ttrpg.character.advanced"
  | "ttrpg.session-zero.completed"
  | "ttrpg.scene.opened"
  | "ttrpg.clue.discovered"
  | "ttrpg.intent.receipted"
  | "ttrpg.human-response.recorded"
  | "ttrpg.check.resolved"
  | "ttrpg.rule.action.resolved"
  | "ttrpg.rest.completed"
  | "ttrpg.gm.response.recorded"
  | "ttrpg.item.changed"
  | "ttrpg.effects.choice.proposed"
  | "ttrpg.effects.applied"
  | "ttrpg.campaign.ended"
  | "ttrpg.safety.changed"
  | "ttrpg.tabletop.updated"
  | "ttrpg.campaign.session.started"
  | "ttrpg.campaign.session.completed"
  | "ttrpg.campaign.roster.changed"
  | "ttrpg.campaign.supplement.activated"
  | "ttrpg.campaign.world-evolution.recorded"
  | "ttrpg.campaign.version-transition.recorded"
>;

async function verifyFormalTtrpgSource(session: SimulationSession) {
  const sourceCount = [
    session.gameReleaseId,
    session.gameBuildId,
  ].filter((value) => value != null).length;
  if (
    session.kind !== "ttrpg" ||
    !session.runtimeSourceHash ||
    sourceCount !== 1
  ) {
    throw new Error("[ttrpg] 正式 TTRPG 实例没有唯一冻结运行源。");
  }
  if (session.gameBuildId != null) {
    if (session.worldId == null || session.workId == null) {
      throw new Error("[ttrpg] Build Preview 实例缺少完整工作区作用域。");
    }
    const buildBefore = await db.gameBuilds.get(session.gameBuildId);
    if (!buildBefore || !buildBefore.previewHash) {
      throw new Error("[ttrpg] Build Preview 运行源不存在。");
    }
    const playable = await verifyPlayableGamePackageSource({
      scope: {
        projectId: session.projectId,
        worldId: session.worldId,
        workId: session.workId,
      },
      source: {
        kind: "build",
        gameBuildId: session.gameBuildId,
        expectedPreviewHash: buildBefore.previewHash,
      },
    });
    const build = await db.gameBuilds.get(session.gameBuildId);
    if (!build || stableJson(build) !== stableJson(buildBefore)) {
      throw new Error("[ttrpg] GameBuild 在运行源校验期间发生变化。");
    }
    if (
      playable.runtimePackage.productType !== "ttrpg" ||
      !playable.runtimePackage.ttrpg ||
      playable.packageHash !== session.runtimeSourceHash
    ) {
      throw new Error("[ttrpg] 实例与冻结 TTRPG Build Preview 不一致。");
    }
    const rulePack = parseRulePackV1(
      playable.runtimePackage.ttrpg.rulePack.content,
    );
    const campaign = parseTtrpgCampaignContentV1(
      playable.runtimePackage.ttrpg.campaign,
      rulePack,
    );
    return {
      source: { kind: "build" as const, build },
      runtimePackage: playable.runtimePackage,
      packageHash: playable.packageHash,
      rulePack,
      campaign,
    };
  }
  const release = await assertGameReleaseUnchanged(session.gameReleaseId!);
  const manifest = await verifyGameReleaseManifestV2(release.manifestJson);
  if (
    manifest.productType !== "ttrpg" ||
    !manifest.runtimePackage.ttrpg ||
    manifest.packageHash !== session.runtimeSourceHash
  ) {
    throw new Error("[ttrpg] 实例与冻结 TTRPG GameRelease 不一致。");
  }
  const rulePack = parseRulePackV1(
    manifest.runtimePackage.ttrpg.rulePack.content,
  );
  const campaign = parseTtrpgCampaignContentV1(
    manifest.runtimePackage.ttrpg.campaign,
    rulePack,
  );
  return {
    source: { kind: "release" as const, release },
    runtimePackage: manifest.runtimePackage,
    packageHash: manifest.packageHash,
    rulePack,
    campaign,
  };
}

function assertFormalTtrpgPrior(input: {
  prior: SimulationEvent;
  type: FormalTtrpgEventType;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  intent: Record<string, unknown>;
}): void {
  const body = parseEventPayload(input.prior);
  if (
    input.prior.type !== input.type ||
    input.prior.commandId !== input.commandId ||
    input.prior.baseSequence !== input.baseSequence ||
    input.prior.baseStateHash !== input.baseStateHash ||
    stableJson(body.intent) !== stableJson(input.intent)
  ) {
    throw new Error("[ttrpg] commandId 已被不同命令使用。");
  }
}

async function appendFormalTtrpgCommand(
  input: FormalTtrpgCommandEnvelope & {
    type: FormalTtrpgEventType;
    intent: Record<string, unknown>;
    build: (context: {
      session: SimulationSession;
      state: SimulationRuntimeState;
      sequence: number;
      rulePack: ReturnType<typeof parseRulePackV1>;
      campaign: ReturnType<typeof parseTtrpgCampaignContentV1>;
      participants: import("../types").TtrpgSessionParticipantRecordV2[];
    }) => Promise<{
      actorKey: string | null;
      targetKey: string | null;
      payload: Record<string, unknown>;
    }>;
    afterCommit?: (context: {
      session: SimulationSession;
      state: SimulationRuntimeState;
      event: SimulationEvent;
      rulePack: ReturnType<typeof parseRulePackV1>;
      campaign: ReturnType<typeof parseTtrpgCampaignContentV1>;
    }) => Promise<void>;
  },
): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[ttrpg] 命令基线无效。");
  }
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (!previewSession) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const frozen = await verifyFormalTtrpgSource(previewSession);
  const previewPrior = await db.simulationEvents
    .where("[sessionId+commandId]")
    .equals([input.sessionId, commandId])
    .first();
  if (previewPrior) {
    assertFormalTtrpgPrior({
      prior: previewPrior,
      type: input.type,
      commandId,
      baseSequence: input.baseSequence,
      baseStateHash,
      intent: input.intent,
    });
    return previewPrior;
  }
  const previewHead = await readVerifiedSimulationRuntimeHeadV1(previewSession);
  const previewState = previewHead.state;
  const previewParticipants = await db.ttrpgSessionParticipants
    .where("sessionId")
    .equals(input.sessionId)
    .sortBy("seatKey");
  const previewHash = previewHead.stateHash;
  if (
    previewState.lastSequence !== input.baseSequence ||
    previewHash !== baseStateHash
  ) {
    throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
  }
  if (
    !previewState.ttrpg?.product ||
    previewState.ttrpg.product.rulePackContentHash !==
      frozen.runtimePackage.ttrpg!.rulePack.contentHash ||
    previewState.ttrpg.product.campaignKey !== frozen.campaign.campaignKey
  ) {
    throw new Error("[ttrpg] 战役状态没有绑定冻结 RulePack/CampaignPack。");
  }
  if (
    previewState.ttrpg.product.safety.status === "paused" &&
    input.type !== "ttrpg.safety.changed"
  ) {
    throw new Error(
      "[ttrpg] 战役已由安全工具暂停；恢复后才能继续规则、场景或 AI 主持。",
    );
  }
  // Preflight command-specific validation before opening the write transaction.
  const previewBuilt = await input.build({
    session: previewSession,
    state: previewState,
    sequence: previewState.lastSequence + 1,
    rulePack: frozen.rulePack,
    campaign: frozen.campaign,
    participants: previewParticipants,
  });
  const preparedEvent: SimulationEvent = {
    projectId: previewSession.projectId,
    worldGroupId: previewSession.worldGroupId ?? null,
    sessionId: previewSession.id!,
    sequence: previewState.lastSequence + 1,
    type: input.type,
    actorKey: previewBuilt.actorKey,
    targetKey: previewBuilt.targetKey,
    commandId,
    baseSequence: input.baseSequence,
    baseStateHash,
    payloadJson: JSON.stringify({
      ...previewBuilt.payload,
      intent: input.intent,
    }),
    createdAt: Date.now(),
  };
  const preparedState = applySimulationEvent(
    cloneState(previewState),
    preparedEvent,
  );
  const preparedStateJson = JSON.stringify(preparedState);
  const preparedStateHash = await hashStateJson(preparedStateJson);
  return db.transaction(
    "rw",
    [
      db.simulationSessions,
      db.simulationEvents,
      db.ttrpgSessionParticipants,
      db.gameReleases,
      db.gameBuilds,
    ],
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (!session) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
      const currentSource = frozen.source.kind === "release"
        ? session.gameReleaseId == null
          ? null
          : await db.gameReleases.get(session.gameReleaseId)
        : session.gameBuildId == null
          ? null
          : await db.gameBuilds.get(session.gameBuildId);
      const sourceUnchanged =
        frozen.source.kind === "release"
          ? currentSource != null &&
            currentSource.id === frozen.source.release.id &&
            "contentHash" in currentSource &&
            currentSource.manifestJson === frozen.source.release.manifestJson &&
            currentSource.contentHash === frozen.source.release.contentHash &&
            session.gameBuildId == null
          : currentSource != null &&
            currentSource.id === frozen.source.build.id &&
            "previewHash" in currentSource &&
            currentSource.productionId === frozen.source.build.productionId &&
            currentSource.buildNumber === frozen.source.build.buildNumber &&
            currentSource.briefRevision === frozen.source.build.briefRevision &&
            currentSource.briefHash === frozen.source.build.briefHash &&
            currentSource.previewManifestJson ===
              frozen.source.build.previewManifestJson &&
            currentSource.previewHash === frozen.source.build.previewHash &&
            currentSource.packageHash === frozen.source.build.packageHash &&
            currentSource.manifestHash === frozen.source.build.manifestHash &&
            ["preview-ready", "release-ready", "released"].includes(
              currentSource.status,
            ) &&
            session.gameReleaseId == null;
      if (
        !sourceUnchanged ||
        session.gameReleaseId !== previewSession.gameReleaseId ||
        session.gameBuildId !== previewSession.gameBuildId ||
        session.runtimeSourceHash !== frozen.packageHash ||
        session.seed !== previewSession.seed
      ) {
        throw new Error("[ttrpg] 冻结运行源在命令提交期间发生变化。");
      }
      const currentParticipants = await db.ttrpgSessionParticipants
        .where("sessionId")
        .equals(input.sessionId)
        .sortBy("seatKey");
      const prior = await db.simulationEvents
        .where("[sessionId+commandId]")
        .equals([input.sessionId, commandId])
        .first();
      if (prior) {
        assertFormalTtrpgPrior({
          prior,
          type: input.type,
          commandId,
          baseSequence: input.baseSequence,
          baseStateHash,
          intent: input.intent,
        });
        return prior;
      }
      if (session.status !== "active")
        throw new Error("[ttrpg] 只有 active 战役可以提交命令。");
      const latestSequence = await readLatestSessionEventSequenceV1(
        input.sessionId,
      );
      let state: SimulationRuntimeState;
      if (
        latestSequence === previewHead.sequence &&
        session.runtimeHeadSequence === previewHead.sequence &&
        session.runtimeHeadStateJson === previewHead.stateJson &&
        session.runtimeHeadStateHash === previewHead.stateHash
      ) {
        state = cloneState(previewState);
      } else {
        const events = await readSessionEvents(session);
        state = replaySimulationEvents(
          parseSimulationState(session.initialStateJson),
          events,
        );
      }
      const currentStateJson = JSON.stringify(state);
      if (
        state.lastSequence !== input.baseSequence ||
        currentStateJson !== previewHead.stateJson ||
        previewHead.stateHash !== baseStateHash ||
        state.lastSequence !== previewState.lastSequence ||
        stableJson(currentParticipants) !== stableJson(previewParticipants)
      ) {
        throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
      }
      // The state hash, release bytes, seed and next sequence were all compared
      // above, so the preflight result is the exact deterministic command plan.
      // Reusing it also keeps WebCrypto outside Dexie's active transaction.
      const event: SimulationEvent = { ...preparedEvent };
      state = applySimulationEvent(state, event);
      if (stableJson(state) !== stableJson(preparedState)) {
        throw new Error("[ttrpg] 事务内规则结果与预提交计划不一致。");
      }
      event.id = (await db.simulationEvents.add(event)) as number;
      await input.afterCommit?.({
        session,
        state,
        event,
        rulePack: frozen.rulePack,
        campaign: frozen.campaign,
      });
      await db.simulationSessions.update(session.id!, {
        updatedAt: event.createdAt,
        runtimeHeadSequence: event.sequence,
        runtimeHeadStateJson: preparedStateJson,
        runtimeHeadStateHash: preparedStateHash,
      });
      return event;
    },
  );
}

export async function customizeTtrpgPlayerCharacterV1(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    name: string;
    description: string;
    attributes: Record<string, number>;
    identity?: Partial<TtrpgCharacterSheetV2["identity"]>;
  },
): Promise<SimulationEvent> {
  const characterKey = input.characterKey.trim();
  const name = input.name.trim().normalize("NFC");
  const description = input.description.trim().normalize("NFC");
  const attributes = Object.fromEntries(
    Object.entries(input.attributes).map(([key, value]) => [
      key.trim(),
      Number(value),
    ]),
  );
  if (
    !characterKey ||
    !name ||
    name.length > 300 ||
    !description ||
    description.length > 20_000 ||
    Object.keys(attributes).some(
      (key) => !key || !Number.isFinite(attributes[key]),
    )
  ) {
    throw new Error("[ttrpg] 角色创建器输入无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.character.customized",
    intent: { characterKey, name, description, attributes },
    build: async ({ state, rulePack, campaign }) => {
      const product = state.ttrpg?.product;
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === characterKey && item.role === "player",
      );
      if (
        !product ||
        product.sessionZero.completed ||
        state.ttrpg?.scene ||
        !template
      ) {
        throw new Error("[ttrpg] 只能在 Session Zero 前定制冻结玩家角色。");
      }
      const expectedKeys = rulePack.attributes.map(
        (attribute) => attribute.key,
      );
      if (
        Object.keys(attributes).length !== expectedKeys.length ||
        expectedKeys.some(
          (key) => !Object.prototype.hasOwnProperty.call(attributes, key),
        )
      ) {
        throw new Error("[ttrpg] 角色创建器必须填写全部规则属性。");
      }
      for (const attribute of rulePack.attributes) {
        const value = attributes[attribute.key];
        if (
          !Number.isInteger(value) ||
          value < attribute.minimum ||
          value > attribute.maximum
        ) {
          throw new Error(
            `[ttrpg] ${attribute.name} 必须在 ${attribute.minimum}–${attribute.maximum} 之间。`,
          );
        }
      }
      const frozenBudget = rulePack.attributes.reduce(
        (sum, attribute) => sum + template.attributes[attribute.key],
        0,
      );
      const allocatedBudget = rulePack.attributes.reduce(
        (sum, attribute) => sum + attributes[attribute.key],
        0,
      );
      if (allocatedBudget !== frozenBudget) {
        throw new Error(
          `[ttrpg] 属性点必须保持 ${frozenBudget} 点；当前为 ${allocatedBudget} 点。`,
        );
      }
      const derived = Object.fromEntries(
        rulePack.derivedStats.map((stat) => {
          let value = evaluateRuleNumberExpressionV1(stat.formula, attributes);
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          return [stat.key, value];
        }),
      );
      const maximums = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          evaluateRuleNumberExpressionV1(resource.maximumFormula, attributes),
        ]),
      );
      const resources = Object.fromEntries(
        rulePack.resources.map((resource) => [
          resource.key,
          resource.initialMode === "maximum"
            ? maximums[resource.key]
            : resource.minimum,
        ]),
      );
      const entityAttributes = {
        identity: description,
        ...attributes,
        ...derived,
        ...Object.fromEntries(
          Object.entries(resources).map(([key, value]) => [
            `resource.${key}`,
            value,
          ]),
        ),
        ...Object.fromEntries(
          Object.entries(maximums).map(([key, value]) => [
            `resourceMax.${key}`,
            value,
          ]),
        ),
        hp: resources.vigor ?? 1,
        maxHp: maximums.vigor ?? resources.vigor ?? 1,
        armorClass: derived.defense ?? 8,
        initiative:
          attributes[rulePack.turnStructure.initiativeAttributeKey] ?? 0,
      };
      const { characterSheet: _frozenSheet, ...templateWithoutSheet } =
        template;
      const effectiveTemplate = {
        ...templateWithoutSheet,
        name,
        description,
        attributes,
      };
      const previousIdentity: Partial<TtrpgCharacterSheetV2["identity"]> =
        template.characterSheet?.identity ?? {};
      const characterSheet = createCompleteTtrpgCharacterSheetV2({
        template: effectiveTemplate,
        rulePack,
        authoringMode: "manual",
        progression: template.characterSheet?.rules.progression,
        identity: {
          ...structuredClone(previousIdentity),
          ...structuredClone(input.identity ?? {}),
          name,
          background: input.identity?.background ?? description,
          appearance:
            input.identity?.appearance ??
            previousIdentity.appearance ??
            description,
        },
      });
      return {
        actorKey: characterKey,
        targetKey: characterKey,
        payload: {
          characterKey,
          name,
          description,
          attributes,
          entityAttributes,
          characterSheet,
        },
      };
    },
  });
}

export async function advanceTtrpgCharacterV1(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    kind: "attribute" | "skill" | "level" | "rank";
    targetKey: string;
  },
): Promise<SimulationEvent> {
  const characterKey = input.characterKey.trim();
  const targetKey = input.targetKey.trim();
  if (
    !characterKey ||
    !targetKey ||
    !["attribute", "skill", "level", "rank"].includes(input.kind)
  ) {
    throw new Error("[ttrpg] 角色成长请求无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.character.advanced",
    intent: { characterKey, kind: input.kind, targetKey },
    build: async ({ state, rulePack, campaign }) => {
      const product = state.ttrpg?.product;
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === characterKey && item.role === "player",
      );
      const progression = product?.characterProgression?.[characterKey];
      const entity = state.entities[characterKey];
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        product.safety.status !== "active" ||
        !product.sessionZero.selectedCharacterKeys.includes(characterKey) ||
        !template ||
        !progression ||
        !entity
      ) {
        throw new Error(
          "[ttrpg] 只有已开团、未结局且安全状态正常的本局玩家角色可以成长。",
        );
      }
      const available = availableTtrpgCharacterCurrencyV2(
        product,
        characterKey,
      );
      let cost: number;
      let before: number | string;
      let after: number | string;
      const entityAttributes: Record<string, string | number | boolean | null> =
        {};
      if (input.kind === "attribute") {
        if (!["point-buy", "classless"].includes(progression.model)) {
          throw new Error(
            "[ttrpg] 当前成长模式不能直接购买属性；请使用等级或阶位成长。",
          );
        }
        const definition = rulePack.attributes.find(
          (item) => item.key === targetKey,
        );
        const current = entity.attributes[targetKey];
        const maximum = definition
          ? Math.min(
              definition.maximum,
              rulePack.advancement.maximumAttributeValue,
            )
          : null;
        if (
          !definition ||
          typeof current !== "number" ||
          maximum == null ||
          current >= maximum
        ) {
          throw new Error("[ttrpg] 属性不存在或已达到规则上限。");
        }
        cost = rulePack.advancement.attributeIncreaseCost;
        before = current;
        after = current + 1;
        entityAttributes[targetKey] = after;
      } else if (input.kind === "skill") {
        if (progression.model === "rank")
          throw new Error("[ttrpg] 阶位制角色必须先按阶位规则成长。");
        const base = template.skills[targetKey];
        if (typeof base !== "number")
          throw new Error("[ttrpg] 只能提高冻结角色卡上已有的技能。");
        before = base + (progression.skillIncreases[targetKey] ?? 0);
        const maximum = rulePack.advancement.maximumSkillValue ?? 10;
        if (before >= maximum) throw new Error("[ttrpg] 技能已达到规则上限。");
        cost =
          rulePack.advancement.skillIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        after = before + 1;
      } else if (input.kind === "level") {
        if (progression.model !== "numeric-level" || progression.level == null)
          throw new Error("[ttrpg] 当前角色不是等级制成长。");
        if (progression.level >= (rulePack.advancement.maximumLevel ?? 20))
          throw new Error("[ttrpg] 角色已达到等级上限。");
        cost =
          rulePack.advancement.levelIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        before = progression.level;
        after = progression.level + 1;
      } else {
        if (progression.model !== "rank" || progression.rankKey == null)
          throw new Error("[ttrpg] 当前角色不是阶位制成长。");
        const order = rulePack.advancement.rankOrder?.length
          ? rulePack.advancement.rankOrder
          : ["D", "C", "B", "A"];
        const index = order.indexOf(progression.rankKey);
        if (index < 0 || index >= order.length - 1)
          throw new Error("[ttrpg] 角色已达到最高阶位。");
        cost =
          rulePack.advancement.rankIncreaseCost ??
          rulePack.advancement.attributeIncreaseCost;
        before = progression.rankKey;
        after = order[index + 1];
        const rankPower = entity.attributes.rankPower;
        if (typeof rankPower === "number")
          entityAttributes.rankPower = rankPower + 1;
      }
      if (available < cost) {
        throw new Error(
          `[ttrpg] ${product.advancement.currencyName}不足：需要 ${cost}，当前可用 ${available}。`,
        );
      }
      if (
        Object.keys(entityAttributes).some((field) =>
          rulePack.attributes.some((attribute) => attribute.key === field),
        )
      ) {
        const effectiveAttributes = Object.fromEntries(
          [...rulePack.attributes, ...rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              typeof entityAttributes[attribute.key] === "number"
                ? Number(entityAttributes[attribute.key])
                : Number(entity.attributes[attribute.key]),
            ],
          ),
        );
        for (const stat of rulePack.derivedStats) {
          let value = evaluateRuleNumberExpressionV1(
            stat.formula,
            effectiveAttributes,
          );
          if (stat.minimum != null) value = Math.max(stat.minimum, value);
          if (stat.maximum != null) value = Math.min(stat.maximum, value);
          entityAttributes[stat.key] = value;
        }
        for (const resource of rulePack.resources) {
          const maximum = evaluateRuleNumberExpressionV1(
            resource.maximumFormula,
            effectiveAttributes,
          );
          const current = Number(entity.attributes[`resource.${resource.key}`]);
          entityAttributes[`resourceMax.${resource.key}`] = maximum;
          entityAttributes[`resource.${resource.key}`] = Math.max(
            resource.minimum,
            Math.min(maximum, current),
          );
        }
        entityAttributes.hp =
          entityAttributes["resource.vigor"] ?? entity.attributes.hp ?? 1;
        entityAttributes.maxHp =
          entityAttributes["resourceMax.vigor"] ?? entity.attributes.maxHp ?? 1;
        entityAttributes.armorClass =
          entityAttributes.defense ?? entity.attributes.armorClass ?? 8;
        entityAttributes.initiative =
          effectiveAttributes[rulePack.turnStructure.initiativeAttributeKey] ??
          0;
      }
      return {
        actorKey: characterKey,
        targetKey: characterKey,
        payload: {
          characterKey,
          kind: input.kind,
          targetKey,
          before,
          after,
          cost,
          entityAttributes,
        },
      };
    },
  });
}

export async function completeTtrpgSessionZero(
  input: FormalTtrpgCommandEnvelope & {
    acceptedItemKeys: string[];
    selectedCharacterKeys?: string[];
    completedBy: string;
  },
): Promise<SimulationEvent> {
  const acceptedItemKeys = [
    ...new Set(
      input.acceptedItemKeys.map((item) => item.trim()).filter(Boolean),
    ),
  ].sort();
  const requestedCharacterKeys = [
    ...new Set(
      (input.selectedCharacterKeys ?? [])
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
  const completedBy = input.completedBy.trim();
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (!previewSession) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const { campaign: previewCampaign } =
    await verifyFormalTtrpgSource(previewSession);
  const allPlayerCharacterKeys = previewCampaign.characterTemplates
    .filter((item) => item.role === "player")
    .map((item) => item.characterKey);
  const selectedCharacterKeys = requestedCharacterKeys.length
    ? requestedCharacterKeys
    : allPlayerCharacterKeys;
  const participantRows = await readTtrpgSessionParticipantsV2(input.sessionId);
  const acknowledgedCharacterKeys = participantRows.flatMap((row) =>
    row.role === "player" &&
    row.actorKey != null &&
    row.controller !== "vacant" &&
    row.assignmentState !== "vacant" &&
    row.assignmentState !== "left"
      ? [row.actorKey]
      : [],
  );
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.session-zero.completed",
    intent: { acceptedItemKeys, selectedCharacterKeys, completedBy },
    build: async ({ state, campaign }) => {
      const product = state.ttrpg?.product;
      if (!product || product.sessionZero.completed)
        throw new Error("[ttrpg] Session Zero 已完成或产品状态缺失。");
      if (!completedBy || completedBy.length > 160)
        throw new Error("[ttrpg] Session Zero 完成人无效。");
      if (
        stableJson(acceptedItemKeys) !==
        stableJson([...product.sessionZero.requiredItemKeys].sort())
      ) {
        throw new Error("[ttrpg] 必须确认全部 Session Zero 安全与共识事项。");
      }
      const allowed = new Set(
        campaign.characterTemplates
          .filter((item) => item.role === "player")
          .map((item) => item.characterKey),
      );
      if (
        selectedCharacterKeys.length < campaign.playerCount.minimum ||
        selectedCharacterKeys.length > campaign.playerCount.maximum ||
        selectedCharacterKeys.some((key) => !allowed.has(key))
      ) {
        throw new Error(
          `[ttrpg] 请选择 ${campaign.playerCount.minimum}–${campaign.playerCount.maximum} 名冻结玩家角色。`,
        );
      }
      const selected = new Set(selectedCharacterKeys);
      const activeSeats = participantRows.filter(
        (row) =>
          row.role === "gm" ||
          (row.actorKey != null && selected.has(row.actorKey)),
      );
      if (
        !activeSeats.some((row) => row.role === "gm") ||
        selectedCharacterKeys.some(
          (characterKey) =>
            !activeSeats.some((row) => row.actorKey === characterKey),
        ) ||
        activeSeats.some(
          (row) =>
            row.controller === "vacant" ||
            row.assignmentState === "vacant" ||
            row.assignmentState === "left",
        )
      ) {
        throw new Error(
          "[ttrpg] Session Zero 仍有未认领、空缺或已离席的活动席位。",
        );
      }
      if (
        activeSeats.some(
          (row) =>
            (row.controller === "ai" || row.controller === "hybrid") &&
            !row.consent.aiIdentityDisclosed,
        )
      ) {
        throw new Error(
          "[ttrpg] Session Zero 必须先向全部活动席位披露 AI 身份。",
        );
      }
      return {
        actorKey: completedBy,
        targetKey: product.campaignKey,
        payload: { acceptedItemKeys, selectedCharacterKeys, completedBy },
      };
    },
    afterCommit: async ({ event }) => {
      await finalizeTtrpgSessionParticipantsV2({
        sessionId: input.sessionId,
        // Session Zero acknowledges every configured seat in the frozen
        // roster. The subset in product.sessionZero remains the opening active
        // party; accepted reserve seats can later reinforce a long campaign
        // without inventing consent after play has started. Vacant reserves
        // remain unavailable until a future roster-release workflow.
        selectedCharacterKeys: acknowledgedCharacterKeys,
        eventSequence: event.sequence,
        completedBy,
      });
    },
  });
}

export async function changeTtrpgSafetyStatus(
  input: FormalTtrpgCommandEnvelope & {
    status: "active" | "paused";
    reason?: string | null;
    changedBy: string;
  },
): Promise<SimulationEvent> {
  const changedBy = input.changedBy.trim();
  const reason = input.reason?.trim() || null;
  if (
    !changedBy ||
    changedBy.length > 160 ||
    (input.status === "paused" && !reason) ||
    (reason?.length ?? 0) > 2_000
  ) {
    throw new Error("[ttrpg] 安全状态命令无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.safety.changed",
    intent: { status: input.status, reason, changedBy },
    build: async ({ state }) => {
      const product = state.ttrpg?.product;
      if (!product?.sessionZero.completed || product.ending)
        throw new Error("[ttrpg] 当前正式战役不能变更安全状态。");
      if (product.safety.status === input.status)
        throw new Error("[ttrpg] 安全状态没有变化。");
      return {
        actorKey: changedBy,
        targetKey: product.campaignKey,
        payload: { status: input.status, reason, changedBy },
      };
    },
  });
}

function assertFormalTtrpgGmV2(
  participants: import("../types").TtrpgSessionParticipantRecordV2[],
  gmKey: string,
): void {
  const gm = participants.find((row) => row.role === "gm");
  if (
    !gm ||
    ![gm.seatKey, gm.viewerKey].includes(gmKey) ||
    gm.controller === "vacant" ||
    gm.assignmentState === "vacant" ||
    gm.assignmentState === "left" ||
    gm.sessionZeroAcceptedAtSequence == null
  ) {
    throw new Error("[ttrpg] 长期战役命令必须由已确认的本局 GM 提交。");
  }
}

export async function startTtrpgCampaignSessionV2(
  input: FormalTtrpgCommandEnvelope & {
    sessionKey: string;
    title: string;
    participantKeys: string[];
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const sessionKey = longCampaignKey(input.sessionKey, "长期战役分场 key");
  const title = longCampaignText(input.title, "长期战役分场标题", 300);
  const participantKeys = [
    ...new Set(
      input.participantKeys.map((key) =>
        longCampaignKey(key, "长期战役参与者"),
      ),
    ),
  ];
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.session.started",
    intent: { sessionKey, title, participantKeys, gmKey },
    build: async ({ state, sequence, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const campaignState = ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.playSessions.some(
          (item) => item.sessionKey === sessionKey,
        )
      ) {
        throw new Error("[ttrpg] 当前正式战役不能开始新的长期分场。");
      }
      const activeRoster = campaignState.roster
        .filter((entry) => entry.status === "active")
        .map((entry) => entry.characterKey)
        .sort();
      if (
        !activeRoster.length ||
        stableJson(activeRoster) !== stableJson([...participantKeys].sort())
      ) {
        throw new Error("[ttrpg] 分场参与者必须精确匹配当前活动编组。");
      }
      for (const characterKey of participantKeys) {
        const seat = participants.find(
          (row) => row.role === "player" && row.actorKey === characterKey,
        );
        if (
          !seat ||
          seat.controller === "vacant" ||
          seat.assignmentState === "vacant" ||
          seat.assignmentState === "left" ||
          seat.sessionZeroAcceptedAtSequence == null ||
          ((seat.controller === "ai" || seat.controller === "hybrid") &&
            !seat.consent.aiIdentityDisclosed)
        ) {
          throw new Error(`[ttrpg] 活动角色席位尚未确认:${characterKey}`);
        }
      }
      return {
        actorKey: gmKey,
        targetKey: product.campaignKey,
        payload: {
          playSession: {
            sessionKey,
            ordinal: campaignState.playSessions.length + 1,
            title,
            status: "active",
            participantKeys,
            startedSequence: sequence,
            completedSequence: null,
            summary: "",
            rulePackContentHash: product.rulePackContentHash,
            campaignKey: product.campaignKey,
          } satisfies SimulationTtrpgCampaignSessionV2,
        },
      };
    },
  });
}

export async function completeTtrpgCampaignSessionV2(
  input: FormalTtrpgCommandEnvelope & {
    sessionKey: string;
    summary: string;
    memories?: Array<{
      memoryKey: string;
      subjectKey: string;
      summary: string;
      audience: SimulationTtrpgCampaignMemoryV2["audience"];
    }>;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const sessionKey = longCampaignKey(input.sessionKey, "长期战役分场 key");
  const summary = longCampaignText(input.summary, "长期战役分场摘要", 20_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  const memoryInputs = (input.memories ?? []).map((memory) =>
    assertTtrpgCampaignMemoryV2({
      ...memory,
      sourceSessionKey: sessionKey,
      updatedSequence: 1,
    }),
  );
  if (
    new Set(memoryInputs.map((item) => item.memoryKey)).size !==
    memoryInputs.length
  ) {
    throw new Error("[ttrpg] 同一分场不能提交重复记忆 key。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.session.completed",
    intent: { sessionKey, summary, memories: memoryInputs, gmKey },
    build: async ({ state, sequence, rulePack, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const campaignState = ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        !campaignState ||
        campaignState.activeSessionKey !== sessionKey ||
        campaignState.playSessions.find(
          (item) => item.sessionKey === sessionKey,
        )?.status !== "active"
      ) {
        throw new Error("[ttrpg] 只能完成当前活动长期分场。");
      }
      if (
        memoryInputs.some(
          (memory) =>
            campaignState.memories.some(
              (prior) => prior.memoryKey === memory.memoryKey,
            ) ||
            (memory.audience.startsWith("actor:") &&
              !campaignState.roster.some(
                (entry) =>
                  entry.characterKey === memory.audience.slice("actor:".length),
              )),
        )
      ) {
        throw new Error("[ttrpg] 长期战役记忆 key 或受众无效。");
      }
      const memories = memoryInputs.map((memory) => ({
        ...memory,
        updatedSequence: sequence,
      }));
      const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
        ([stateKey, before]) => {
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("session")) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: "session",
            eventId: `event.${sequence}`,
          });
          return [{ stateKey, before, after }];
        },
      );
      return {
        actorKey: gmKey,
        targetKey: sessionKey,
        payload: { sessionKey, summary, memories, abilityResets },
      };
    },
  });
}

export async function changeTtrpgCampaignRosterV2(
  input: FormalTtrpgCommandEnvelope & {
    characterKey: string;
    status: SimulationTtrpgRosterEntryV2["status"];
    replacementFor?: string | null;
    reason: string;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const characterKey = longCampaignKey(input.characterKey, "长期战役角色");
  const replacementFor =
    input.replacementFor == null
      ? null
      : longCampaignKey(input.replacementFor, "补员替代角色");
  const reason = longCampaignText(input.reason, "编组变更理由", 2_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (!(["active", "reserve", "retired"] as string[]).includes(input.status))
    throw new Error("[ttrpg] 编组目标状态无效。");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.roster.changed",
    intent: {
      characterKey,
      status: input.status,
      replacementFor,
      reason,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const ttrpg = state.ttrpg;
      const campaignState = ttrpg?.campaign;
      const product = ttrpg?.product;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !campaignState ||
        !product?.sessionZero.completed ||
        product.ending ||
        campaignState.activeSessionKey != null
      ) {
        throw new Error("[ttrpg] 编组只能在未结束战役的两场之间调整。");
      }
      const prior = campaignState.roster.find(
        (entry) => entry.characterKey === characterKey,
      );
      if (!prior || prior.status === "retired" || prior.status === input.status)
        throw new Error("[ttrpg] 角色当前编组状态不能执行该迁移。");
      if (input.status === "active") {
        if (prior.status !== "reserve")
          throw new Error("[ttrpg] 只有后备角色可以加入活动编组。");
        const seat = participants.find(
          (row) => row.role === "player" && row.actorKey === characterKey,
        );
        if (
          !seat ||
          seat.controller === "vacant" ||
          seat.assignmentState === "vacant" ||
          seat.assignmentState === "left" ||
          seat.sessionZeroAcceptedAtSequence == null
        ) {
          throw new Error("[ttrpg] 补员席位尚未在 Session Zero 中确认。");
        }
        if (replacementFor != null) {
          const replaced = campaignState.roster.find(
            (entry) => entry.characterKey === replacementFor,
          );
          if (!replaced || replaced.status !== "retired")
            throw new Error("[ttrpg] 补员只能替代已经退役的角色。");
        }
      } else if (prior.status !== "active" || replacementFor != null) {
        throw new Error("[ttrpg] 只有活动角色可以轮换或退役。");
      }
      const lastCompleted = [...campaignState.playSessions]
        .reverse()
        .find((item) => item.status === "completed");
      if (input.status === "retired" && !lastCompleted)
        throw new Error("[ttrpg] 角色至少完成一场后才能正式退役。");
      return {
        actorKey: gmKey,
        targetKey: characterKey,
        payload: {
          entry: {
            ...prior,
            status: input.status,
            leftSessionKey:
              input.status === "retired" ? lastCompleted!.sessionKey : null,
            replacementFor: input.status === "active" ? replacementFor : null,
            reason,
            updatedSequence: sequence,
          } satisfies SimulationTtrpgRosterEntryV2,
        },
      };
    },
  });
}

export async function activateTtrpgCampaignSupplementV2(
  input: FormalTtrpgCommandEnvelope & {
    supplementKey: string;
    title: string;
    contentHash: string;
    compatibility: SimulationTtrpgSupplementReceiptV2["compatibility"];
    sourceRef: string;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const supplementKey = longCampaignKey(input.supplementKey, "补充包 key");
  const title = longCampaignText(input.title, "补充包标题", 300);
  const contentHash = String(input.contentHash).trim();
  const sourceRef = longCampaignKey(input.sourceRef, "补充包来源");
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (
    !TTRPG_SHA256.test(contentHash) ||
    !["same-release", "next-release"].includes(input.compatibility)
  ) {
    throw new Error("[ttrpg] 补充包兼容性或内容哈希无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.supplement.activated",
    intent: {
      supplementKey,
      title,
      contentHash,
      compatibility: input.compatibility,
      sourceRef,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !state.ttrpg?.product?.sessionZero.completed ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.supplements.some(
          (item) => item.supplementKey === supplementKey,
        )
      ) {
        throw new Error("[ttrpg] 当前不能激活该补充包。");
      }
      const activatedSessionKey =
        [...campaignState.playSessions]
          .reverse()
          .find((item) => item.status === "completed")?.sessionKey ?? null;
      return {
        actorKey: gmKey,
        targetKey: supplementKey,
        payload: {
          supplement: {
            supplementKey,
            title,
            contentHash,
            compatibility: input.compatibility,
            sourceRef,
            activatedSessionKey,
            approvedBy: gmKey,
            updatedSequence: sequence,
          } satisfies SimulationTtrpgSupplementReceiptV2,
        },
      };
    },
  });
}

export async function recordTtrpgWorldEvolutionV2(
  input: FormalTtrpgCommandEnvelope & {
    candidateKey: string;
    category: SimulationTtrpgWorldEvolutionV2["category"];
    summary: string;
    sourceSessionKey: string;
    status: SimulationTtrpgWorldEvolutionV2["status"];
    targetWorldRef?: string | null;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const candidateKey = longCampaignKey(input.candidateKey, "世界演化候选 key");
  const summary = longCampaignText(input.summary, "世界演化摘要", 8_000);
  const sourceSessionKey = longCampaignKey(
    input.sourceSessionKey,
    "世界演化来源分场",
  );
  const targetWorldRef =
    input.targetWorldRef == null
      ? null
      : longCampaignKey(input.targetWorldRef, "世界演化目标");
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.world-evolution.recorded",
    intent: {
      candidateKey,
      category: input.category,
      summary,
      sourceSessionKey,
      status: input.status,
      targetWorldRef,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (!campaignState || campaignState.activeSessionKey != null)
        throw new Error("[ttrpg] 世界演化只能在两场之间处理。");
      const prior = campaignState.worldEvolution.find(
        (item) => item.candidateKey === candidateKey,
      );
      if (
        !campaignState.playSessions.some(
          (item) =>
            item.sessionKey === sourceSessionKey && item.status === "completed",
        ) ||
        (!prior && input.status !== "proposed") ||
        (prior && (prior.status !== "proposed" || input.status === "proposed"))
      ) {
        throw new Error("[ttrpg] 世界演化候选创建或复审状态无效。");
      }
      if (
        prior &&
        (prior.category !== input.category ||
          prior.summary !== summary ||
          prior.sourceSessionKey !== sourceSessionKey ||
          prior.targetWorldRef !== targetWorldRef)
      ) {
        throw new Error("[ttrpg] 世界演化复审不得篡改候选内容。");
      }
      return {
        actorKey: gmKey,
        targetKey: candidateKey,
        payload: {
          candidate: {
            candidateKey,
            category: input.category,
            summary,
            sourceSessionKey,
            status: input.status,
            targetWorldRef,
            reviewedBy: input.status === "proposed" ? null : gmKey,
            updatedSequence: sequence,
          } satisfies SimulationTtrpgWorldEvolutionV2,
        },
      };
    },
  });
}

export async function recordTtrpgVersionTransitionV2(
  input: FormalTtrpgCommandEnvelope & {
    transitionKey: string;
    toRulePackContentHash: string;
    toCampaignKey: string;
    compatibility: SimulationTtrpgVersionTransitionV2["compatibility"];
    status: SimulationTtrpgVersionTransitionV2["status"];
    notes: string;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const transitionKey = longCampaignKey(input.transitionKey, "版本迁移 key");
  const toRulePackContentHash = String(input.toRulePackContentHash).trim();
  const toCampaignKey = longCampaignKey(
    input.toCampaignKey,
    "迁移后 Campaign key",
  );
  const notes = longCampaignText(input.notes, "版本迁移说明", 8_000);
  const gmKey = longCampaignKey(input.gmKey, "长期战役 GM");
  if (!TTRPG_SHA256.test(toRulePackContentHash))
    throw new Error("[ttrpg] 迁移目标 RulePack hash 无效。");
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.version-transition.recorded",
    intent: {
      transitionKey,
      toRulePackContentHash,
      toCampaignKey,
      compatibility: input.compatibility,
      status: input.status,
      notes,
      gmKey,
    },
    build: async ({ state, sequence, participants }) => {
      const product = state.ttrpg?.product;
      const campaignState = state.ttrpg?.campaign;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product ||
        !campaignState ||
        campaignState.activeSessionKey != null ||
        campaignState.versionTransitions.some(
          (item) => item.transitionKey === transitionKey,
        )
      ) {
        throw new Error("[ttrpg] 当前不能记录该版本迁移。");
      }
      if (
        input.status === "activated" &&
        (toRulePackContentHash !== product.rulePackContentHash ||
          toCampaignKey !== product.campaignKey)
      ) {
        throw new Error(
          "[ttrpg] 不得在运行中原地替换冻结规则；请创建跨版本续团 Instance。",
        );
      }
      return {
        actorKey: gmKey,
        targetKey: transitionKey,
        payload: {
          transition: {
            transitionKey,
            fromRulePackContentHash: product.rulePackContentHash,
            toRulePackContentHash,
            fromCampaignKey: product.campaignKey,
            toCampaignKey,
            compatibility: input.compatibility,
            status: input.status,
            notes,
            approvedBy: gmKey,
            updatedSequence: sequence,
          } satisfies SimulationTtrpgVersionTransitionV2,
        },
      };
    },
  });
}

export async function openTtrpgCampaignScene(
  input: FormalTtrpgCommandEnvelope & {
    sceneKey: string;
  },
): Promise<SimulationEvent> {
  const sceneKey = input.sceneKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.scene.opened",
    intent: { sceneKey },
    build: async ({ session, state, sequence, rulePack, campaign }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (!ttrpg || !product?.sessionZero.completed)
        throw new Error("[ttrpg] 请先完成 Session Zero。");
      if (product.ending) throw new Error("[ttrpg] 正式战役已经结束。");
      const scene = campaign.scenes.find((item) => item.sceneKey === sceneKey);
      if (!scene) throw new Error("[ttrpg] 场景不属于冻结 CampaignPack。");
      if (!ttrpg.scene && sceneKey !== product.openingSceneKey) {
        throw new Error("[ttrpg] 正式战役必须从冻结开场场景开始。");
      }
      if (ttrpg.scene?.sceneKey) {
        const current = campaign.scenes.find(
          (item) => item.sceneKey === ttrpg.scene?.sceneKey,
        );
        if (!current?.nextSceneKeys.includes(sceneKey)) {
          throw new Error("[ttrpg] 只能进入当前冻结场景声明的后继场景。");
        }
      }
      const allPlayers = campaign.characterTemplates
        .filter((item) => item.role === "player")
        .map((item) => item.characterKey);
      const selectedPlayers = product.sessionZero.selectedCharacterKeys.length
        ? product.sessionZero.selectedCharacterKeys
        : allPlayers;
      const playerSet = new Set(allPlayers);
      const participants = (
        scene.participantKeys.length ? scene.participantKeys : selectedPlayers
      ).filter((key) => !playerSet.has(key) || selectedPlayers.includes(key));
      if (!participants.length)
        throw new Error("[ttrpg] 正式场景没有可用行动者。");
      const initiativeEntries = await Promise.all(
        participants.map(async (actorKey) => {
          const modifier = Number(
            state.entities[actorKey]?.attributes[
              rulePack.turnStructure.initiativeAttributeKey
            ],
          );
          if (!Number.isFinite(modifier))
            throw new Error(`[ttrpg] 角色缺少先攻属性:${actorKey}`);
          const nonce = `${input.commandId}:${sequence}:initiative:${actorKey}`;
          const rolled = await resolveRulePackDiceModelV1({
            rulePack,
            diceModelKey: rulePack.turnStructure.initiativeDiceModelKey,
            seed: session.seed,
            nonce,
            modifier,
          });
          return {
            actorKey,
            rolledDice: rolled.dice,
            keptDice: rolled.keptDice,
            modifier,
            total: rolled.total,
            rollTrace: rolled.rollTrace,
            seedCommitment: rolled.seedCommitment,
            nonce: rolled.nonce,
            proofHash: rolled.proofHash,
          };
        }),
      );
      initiativeEntries.sort(
        (left, right) =>
          right.total - left.total ||
          left.actorKey.localeCompare(right.actorKey),
      );
      const turnOrder = initiativeEntries.map((entry) => entry.actorKey);
      const abilityResets = Object.entries(product.abilityStates ?? {}).flatMap(
        ([stateKey, before]) => {
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes("scene")) return [];
          const after = resetTtrpgAbilityUsageV2({
            definition: {
              abilityKey: action.key,
              actionDefinitionKey: action.key,
              usage: action.usage,
            },
            state: before,
            trigger: "scene",
            eventId: `event.${sequence}`,
          });
          return [{ stateKey, before, after }];
        },
      );
      return {
        actorKey: turnOrder[0],
        targetKey: scene.locationKey,
        payload: {
          scene: {
            sceneId: `campaign-scene:${scene.sceneKey}:${sequence}`,
            sceneKey: scene.sceneKey,
            title: scene.title,
            description: scene.description,
            locationKey: scene.locationKey,
            status: "active",
          },
          turnOrder,
          initiative: {
            sceneKey: scene.sceneKey,
            diceModelKey: rulePack.turnStructure.initiativeDiceModelKey,
            attributeKey: rulePack.turnStructure.initiativeAttributeKey,
            entries: initiativeEntries,
          },
          abilityResets,
        },
      };
    },
  });
}

export async function updateTtrpgTabletopV1(
  input: FormalTtrpgCommandEnvelope & {
    role: "gm" | "player";
    actorKey: string;
    operation: TtrpgTabletopOperationV1;
  },
): Promise<SimulationEvent> {
  const actorKey = input.actorKey.trim();
  const operation = parseTtrpgTabletopOperationV1(input.operation);
  if (
    !actorKey ||
    actorKey.length > 200 ||
    !["gm", "player"].includes(input.role)
  ) {
    throw new Error("[ttrpg] 桌面操作者无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.tabletop.updated",
    intent: { role: input.role, actorKey, operation },
    build: async ({ state, sequence }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.tabletop ||
        !state.ttrpg?.scene ||
        state.ttrpg.scene.status !== "active"
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可操作桌面。");
      }
      if (
        input.role === "player" &&
        !product.sessionZero.selectedCharacterKeys.includes(actorKey)
      ) {
        throw new Error("[ttrpg] 玩家桌面操作者不在本局角色名单中。");
      }
      applyTtrpgTabletopOperationV1({
        tabletop: structuredClone(product.tabletop),
        role: input.role,
        actorKey,
        operation,
        sequence,
      });
      const targetKey =
        operation.kind === "set-fog"
          ? operation.fogKey
          : operation.kind === "set-layer"
            ? operation.layerKey
            : operation.tokenKey;
      return {
        actorKey,
        targetKey,
        payload: { role: input.role, actorKey, operation },
      };
    },
  });
}

/**
 * Atomically grants, transfers, consumes, equips or changes one ItemInstance.
 * The formal command id is also the inventory idempotency key, so transport
 * retries cannot duplicate loot or apply a stale transfer twice.
 */
export async function commitTtrpgItemCommandV2(
  input: FormalTtrpgCommandEnvelope & {
    command: import("../ttrpg/item-ledger").TtrpgItemCommandV2;
    requestedBy: { role: "gm" | "player"; actorKey: string };
  },
): Promise<SimulationEvent> {
  const command = parseTtrpgItemCommandV2(input.command);
  if (!input.requestedBy || typeof input.requestedBy !== "object") {
    throw new Error("[ttrpg] 物品命令必须声明已验证的操作者。");
  }
  const requestedBy = {
    role: input.requestedBy.role,
    actorKey: input.requestedBy.actorKey.trim(),
  };
  if (
    !["gm", "player"].includes(requestedBy.role) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(requestedBy.actorKey)
  ) {
    throw new Error("[ttrpg] 物品命令操作者无效。");
  }
  if (command.commandId !== input.commandId.trim()) {
    throw new Error("[ttrpg] 物品命令必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.item.changed",
    intent: { command, requestedBy },
    build: async ({ state, sequence, rulePack, participants }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.inventory
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可操作库存。");
      }
      if (requestedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, requestedBy.actorKey);
      } else {
        const seat = participants.find(
          (row) =>
            row.role === "player" && row.actorKey === requestedBy.actorKey,
        );
        const prior = product.inventory.items[command.instanceId];
        if (
          !seat ||
          !["human", "hybrid"].includes(seat.controller) ||
          seat.assignmentState !== "claimed" ||
          seat.sessionZeroAcceptedAtSequence == null ||
          !prior ||
          prior.ownerRef !== requestedBy.actorKey ||
          ["grant", "remove"].includes(command.kind)
        ) {
          throw new Error(
            "[ttrpg] 玩家只能操作自己持有的物品，授予与移除由 GM 负责。",
          );
        }
      }
      if (command.kind === "grant" && command.eventId !== `event.${sequence}`) {
        throw new Error(
          `[ttrpg] 新物品 acquiredByEventId 必须为 event.${sequence}。`,
        );
      }
      const entityRefs =
        command.kind === "grant"
          ? [command.ownerRef, command.locationRef]
          : command.kind === "transfer"
            ? [command.expectedOwnerRef, command.destinationOwnerRef]
            : "expectedOwnerRef" in command
              ? [command.expectedOwnerRef]
              : [];
      if (entityRefs.some((ref) => ref != null && !state.entities[ref])) {
        throw new Error("[ttrpg] 物品所有者或地点不属于当前冻结运行时。");
      }
      const definitions = Object.fromEntries(
        rulePack.items.map((item) => [
          item.key,
          ttrpgItemDefinitionFromRuleV1(item),
        ]),
      );
      const applied = applyTtrpgItemCommandV2({
        state: product.inventory,
        definitions,
        command,
      });
      if (applied.replayed) throw new Error("[ttrpg] 物品命令已经执行。");
      const prior = product.inventory.items[command.instanceId];
      const actorKey = requestedBy.actorKey;
      const targetKey =
        command.kind === "transfer"
          ? command.destinationOwnerRef
          : (prior?.ownerRef ?? command.instanceId);
      return {
        actorKey,
        targetKey,
        payload: {
          command,
          requestedBy,
          // Frozen RulePack definitions are included so replay never reads mutable DB rows.
          definitions: Object.fromEntries(
            rulePack.items.map((item) => [item.key, item]),
          ),
        },
      };
    },
  });
}

/** Commit one closed reward/penalty plan as an all-or-nothing replayable event. */
export async function commitTtrpgEffectPlanV2(
  input: FormalTtrpgCommandEnvelope & {
    plan: import("../types").TtrpgEffectPlanV2;
    /** When set, this plan is the single authoritative consequence ledger for that resolved action. */
    actionSequence?: number;
  },
): Promise<SimulationEvent> {
  const plan = parseTtrpgEffectPlanV2(input.plan);
  const actionSequence =
    input.actionSequence == null
      ? null
      : assertFiniteInteger(
          input.actionSequence,
          "EffectPlan 来源行动序号",
          1,
          Number.MAX_SAFE_INTEGER,
        );
  if (plan.idempotencyKey !== input.commandId.trim()) {
    throw new Error("[ttrpg] EffectPlan 必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.applied",
    intent: { plan, actionSequence },
    build: async ({ state, sequence, rulePack }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        !product.effectLedger
      ) {
        throw new Error("[ttrpg] 当前正式战役没有可提交的效果账本。");
      }
      if (actionSequence != null) {
        const sourceAction = product.actionHistory.find(
          (action) => action.eventSequence === actionSequence,
        );
        if (
          !sourceAction ||
          plan.sourceEventId !== `event.${actionSequence}` ||
          plan.ruleRef !== sourceAction.actionKey
        ) {
          throw new Error(
            "[ttrpg] 行动后果必须精确引用已经提交的规则行动与 actionKey。",
          );
        }
        const expectedDegree =
          sourceAction.outcome === "automatic"
            ? "success"
            : sourceAction.outcome;
        if (plan.degree !== expectedDegree) {
          throw new Error("[ttrpg] 行动后果等级与冻结判定结果不一致。");
        }
        if (
          product.effectLedger.entries.some(
            (entry) => entry.sourceEventId === plan.sourceEventId,
          ) ||
          product.effectLedger.pendingChoices.some(
            (choice) => choice.plan.sourceEventId === plan.sourceEventId,
          )
        ) {
          throw new Error("[ttrpg] 该规则行动已经提交过唯一后果计划。");
        }
      }
      applyTtrpgEffectPlanToRuntimeV2({
        state,
        rulePack,
        plan,
        eventSequence: sequence,
      });
      const audienceActor = plan.audience.startsWith("actor:")
        ? plan.audience.slice("actor:".length)
        : null;
      return {
        actorKey: audienceActor,
        targetKey: plan.effects[0]?.targetRef ?? product.campaignKey,
        payload: { plan, rulePack },
      };
    },
  });
}

/** Record a GM-authored set of mutually-exclusive consequences without applying one. */
export async function proposeTtrpgEffectChoiceV2(
  input: FormalTtrpgCommandEnvelope & {
    plan: import("../types").TtrpgEffectPlanV2;
    actionSequence: number;
    ownerActorKey: string;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const plan = parseTtrpgEffectPlanV2(input.plan);
  const actionSequence = assertFiniteInteger(
    input.actionSequence,
    "效果选择来源行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const ownerActorKey = normalizeCommandId(input.ownerActorKey);
  const gmKey = normalizeCommandId(input.gmKey);
  if (plan.idempotencyKey !== input.commandId.trim()) {
    throw new Error("[ttrpg] 效果选择提议必须复用正式 commandId 作为幂等键。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.choice.proposed",
    intent: { plan, actionSequence, ownerActorKey, gmKey },
    build: async ({ state, sequence, participants }) => {
      assertFormalTtrpgGmV2(participants, gmKey);
      proposeTtrpgEffectChoiceToRuntimeV2({
        state,
        plan,
        actionSequence,
        ownerActorKey,
        eventSequence: sequence,
      });
      return {
        actorKey: "gm",
        targetKey: ownerActorKey,
        payload: { plan, actionSequence, ownerActorKey },
      };
    },
  });
}

/** Resolve one pending consequence choice through the owning seat authority. */
export async function resolveTtrpgEffectChoiceV2(
  input: FormalTtrpgCommandEnvelope & {
    choiceKey: string;
    selectedEffectKey: string;
    requestedBy: { role: "gm" | "player"; actorKey: string };
    gmKey?: string;
  },
): Promise<SimulationEvent> {
  const choiceKey = normalizeCommandId(input.choiceKey);
  const selectedEffectKey = normalizeCommandId(input.selectedEffectKey);
  const requestedBy = {
    role: input.requestedBy?.role,
    actorKey: normalizeCommandId(input.requestedBy?.actorKey ?? ""),
  };
  const gmKey = input.gmKey == null ? null : normalizeCommandId(input.gmKey);
  if (!["gm", "player"].includes(requestedBy.role)) {
    throw new Error("[ttrpg] 效果选择操作者无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.effects.applied",
    intent: { choiceKey, selectedEffectKey, requestedBy, gmKey },
    build: async ({ state, sequence, rulePack, participants }) => {
      const product = state.ttrpg?.product;
      const choice = product?.effectLedger?.pendingChoices.find(
        (item) => item.choiceKey === choiceKey,
      );
      if (!product?.sessionZero.completed || product.ending || !choice) {
        throw new Error("[ttrpg] 待选择后果不存在或当前战役不可结算。");
      }
      if (choice.ownerActorKey !== requestedBy.actorKey) {
        throw new Error("[ttrpg] 只能结算自己角色的后果选择。");
      }
      const seat = participants.find(
        (row) => row.role === "player" && row.actorKey === choice.ownerActorKey,
      );
      if (requestedBy.role === "player") {
        if (
          !seat ||
          !["human", "hybrid"].includes(seat.controller) ||
          seat.assignmentState !== "claimed" ||
          seat.sessionZeroAcceptedAtSequence == null
        ) {
          throw new Error("[ttrpg] 该角色没有可确认选择的真人席位。");
        }
      } else {
        if (!gmKey) throw new Error("[ttrpg] GM 代管选择缺少主持身份。");
        assertFormalTtrpgGmV2(participants, gmKey);
        if (!seat || seat.controller !== "ai") {
          throw new Error("[ttrpg] GM 只能代纯 AI 玩家席位确认后果选择。");
        }
      }
      const resolved = resolveTtrpgEffectChoiceToRuntimeV2({
        state,
        rulePack,
        choiceKey,
        selectedEffectKey,
        commandId: input.commandId,
        eventSequence: sequence,
      });
      return {
        actorKey: choice.ownerActorKey,
        targetKey: resolved.plan.effects[0].targetRef,
        payload: {
          choiceKey,
          selectedEffectKey,
          requestedBy,
          plan: resolved.plan,
          rulePack,
        },
      };
    },
  });
}

export async function discoverTtrpgClue(
  input: FormalTtrpgCommandEnvelope & {
    clueKey: string;
    actorKey: string;
    visibility: "private" | "party";
  },
): Promise<SimulationEvent> {
  const clueKey = input.clueKey.trim();
  const actorKey = input.actorKey.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.clue.discovered",
    intent: { clueKey, actorKey, visibility: input.visibility },
    build: async ({ state, campaign }) => {
      if (
        !state.ttrpg?.product?.sessionZero.completed ||
        !state.ttrpg.scene?.sceneKey
      ) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      const clue = campaign.clues.find((item) => item.clueKey === clueKey);
      if (
        !clue ||
        !state.ttrpg.scene ||
        !campaign.scenes.find(
          (item) =>
            item.sceneKey === state.ttrpg!.scene!.sceneKey &&
            item.clueKeys.includes(clueKey),
        )
      )
        throw new Error("[ttrpg] 当前场景不包含该线索。");
      if (clue.visibility === "gm-only")
        throw new Error("[ttrpg] GM 私密线索不能通过玩家发现命令公开。");
      if (clue.visibility === "public" && input.visibility !== "party")
        throw new Error("[ttrpg] 公开线索必须对队伍可见。");
      const existing = state.ttrpg.product.discoveredClues.find(
        (item) => item.clueKey === clueKey,
      );
      if (
        existing &&
        !(existing.visibility === "private" && input.visibility === "party")
      ) {
        throw new Error("[ttrpg] 该线索已经发现。");
      }
      const actor = state.entities[actorKey];
      if (
        !actor ||
        !["player", "character"].includes(actor.kind) ||
        (state.ttrpg.product.sessionZero.selectedCharacterKeys.length > 0 &&
          !state.ttrpg.product.sessionZero.selectedCharacterKeys.includes(
            actorKey,
          ))
      ) {
        throw new Error("[ttrpg] 线索发现者不是本局已选择的玩家角色。");
      }
      return {
        actorKey,
        targetKey: clueKey,
        payload: { clueKey, actorKey, visibility: input.visibility },
      };
    },
  });
}

function resolveTtrpgActionSkillV2(input: {
  state: SimulationRuntimeState;
  campaign: TtrpgCampaignContentV1;
  actorKey: string;
  actionKey: string;
}): { skillKey: string; skillValue: number } {
  const template = input.campaign.characterTemplates.find(
    (item) => item.characterKey === input.actorKey,
  );
  if (!template) throw new Error("[ttrpg] 技能判定角色不在冻结 CampaignPack。");
  const customization =
    input.state.ttrpg?.product?.characterCustomizations.find(
      (item) => item.characterKey === input.actorKey,
    );
  const raw =
    customization?.characterSheet?.rules.skills[input.actionKey] ??
    template.characterSheet?.rules.skills[input.actionKey] ??
    template.skills[input.actionKey] ??
    0;
  if (!Number.isFinite(raw) || raw < -1_000 || raw > 1_000) {
    throw new Error(
      `[ttrpg] 角色技能值无效:${input.actorKey}.${input.actionKey}`,
    );
  }
  return { skillKey: input.actionKey, skillValue: Number(raw) };
}

export function classifyTtrpgSubmittedIntentV2(input: {
  state: SimulationRuntimeState;
  campaign: TtrpgCampaignContentV1;
  rulePack: ReturnType<typeof parseRulePackV1>;
  actorKey: string;
  actionKey: string | null;
  targetKey: string | null;
}): {
  status: "needs-clarification" | "rejected-illegal" | null;
  reason: string;
  suggestedActionKeys: string[];
} {
  const ttrpg = input.state.ttrpg;
  const product = ttrpg?.product;
  const scene = input.campaign.scenes.find(
    (item) => item.sceneKey === ttrpg?.scene?.sceneKey,
  );
  const template = input.campaign.characterTemplates.find(
    (item) => item.characterKey === input.actorKey,
  );
  const itemActionKeys = Object.values(product?.inventory?.items ?? {})
    .filter(
      (item) =>
        item.ownerRef === input.actorKey && !item.stateTags.includes("broken"),
    )
    .flatMap(
      (item) =>
        input.rulePack.items.find(
          (definition) => definition.key === item.definitionRef,
        )?.grantedActionKeys ?? [],
    );
  const granted = new Set([...(template?.actionKeys ?? []), ...itemActionKeys]);
  const suggestedActionKeys = (scene?.actionKeys ?? [])
    .filter((actionKey) => granted.has(actionKey))
    .slice(0, 12);
  if (!ttrpg || !product?.sessionZero.completed || !scene || !template) {
    return {
      status: "rejected-illegal",
      reason: "当前尚未完成 Session Zero 或打开可行动场景。",
      suggestedActionKeys,
    };
  }
  if (!input.actionKey) {
    return {
      status: "needs-clarification",
      reason:
        "请确认这段描述要使用哪一项规则行动；系统不会替你暗选风险、资源或检定方式。",
      suggestedActionKeys,
    };
  }
  const action = input.rulePack.actions.find(
    (item) => item.key === input.actionKey,
  );
  if (
    !action ||
    !scene.actionKeys.includes(input.actionKey) ||
    !granted.has(input.actionKey)
  ) {
    return {
      status: "rejected-illegal",
      reason: "当前场景、角色卡或所持物品没有授予这项规则行动。",
      suggestedActionKeys,
    };
  }
  if (!ttrpg.turnOrder.includes(input.actorKey)) {
    return {
      status: "rejected-illegal",
      reason: "该角色不在当前场景，不能感知或执行这里的行动。",
      suggestedActionKeys,
    };
  }
  if (action.phase !== "reaction" && ttrpg.activeActorKey !== input.actorKey) {
    return {
      status: "rejected-illegal",
      reason: `当前轮到 ${ttrpg.activeActorKey ?? "其他角色"}，本行动不会掷骰或消耗资源。`,
      suggestedActionKeys,
    };
  }
  const requirement = evaluateTtrpgActionRequirementsV2({
    action,
    rulePack: input.rulePack,
    actorAttributes: input.state.entities[input.actorKey]?.attributes,
    actorConditions: product.conditions[input.actorKey],
  });
  if (!requirement.met) {
    return {
      status: "rejected-illegal",
      reason: requirement.reason!,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  if (
    action.target === "self" &&
    input.targetKey != null &&
    input.targetKey !== input.actorKey
  ) {
    return {
      status: "rejected-illegal",
      reason: "这项行动只能以行动者自己为目标。",
      suggestedActionKeys,
    };
  }
  if (
    ["single-ally", "single-enemy"].includes(action.target) &&
    (!input.targetKey ||
      input.targetKey === input.actorKey ||
      !ttrpg.turnOrder.includes(input.targetKey))
  ) {
    return {
      status: "needs-clarification",
      reason: "请指定当前场景中的另一名合法目标。",
      suggestedActionKeys,
    };
  }
  const ability =
    product.abilityStates?.[ttrpgAbilityStateKeyV2(input.actorKey, action.key)];
  if (!ability) {
    return {
      status: "rejected-illegal",
      reason: "角色缺少这项能力的冻结次数账本。",
      suggestedActionKeys,
    };
  }
  if (ability.disabledReasons.length > 0) {
    return {
      status: "rejected-illegal",
      reason: `能力当前被禁用：${ability.disabledReasons.join("、")}。`,
      suggestedActionKeys,
    };
  }
  if (ability.remainingUses === 0) {
    const resetLabels = action.usage.reset.map(
      (trigger) =>
        ({
          turn: "下一回合",
          round: "下一轮",
          scene: "下一场景",
          encounter: "遭遇结束",
          session: "下一场游戏",
          "short-rest": "短休",
          "long-rest": "长休",
          "manual-gm": "KP 手动恢复",
          milestone: "指定里程碑",
        })[trigger] ?? trigger,
    );
    return {
      status: "rejected-illegal",
      reason: `次数已耗尽；${resetLabels.length ? `${resetLabels.join("或")}恢复` : "当前规则没有自动恢复条件"}。本次没有掷骰、消耗或重复奖励。`,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  if (
    ability.cooldownUntilRound != null &&
    ttrpg.round < ability.cooldownUntilRound
  ) {
    return {
      status: "rejected-illegal",
      reason: `能力冷却到第 ${ability.cooldownUntilRound} 轮；当前是第 ${ttrpg.round} 轮。`,
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  const resourceCosts = new Map<string, number>();
  if (action.usage.resourceKey && (action.usage.cost ?? 0) > 0) {
    resourceCosts.set(action.usage.resourceKey, action.usage.cost ?? 0);
  }
  if (action.costResourceKey && action.costAmount > 0) {
    resourceCosts.set(
      action.costResourceKey,
      (resourceCosts.get(action.costResourceKey) ?? 0) + action.costAmount,
    );
  }
  for (const [resourceKey, resourceCost] of resourceCosts) {
    const available =
      input.state.entities[input.actorKey]?.attributes[
        `resource.${resourceKey}`
      ];
    if (typeof available !== "number" || available < resourceCost) {
      return {
        status: "rejected-illegal",
        reason: `资源不足：${resourceKey} 需要 ${resourceCost}，当前 ${typeof available === "number" ? available : 0}。`,
        suggestedActionKeys: suggestedActionKeys.filter(
          (actionKey) => actionKey !== action.key,
        ),
      };
    }
  }
  if (action.usage.sharedPoolKey) {
    const pool = product.usagePools?.[action.usage.sharedPoolKey];
    if (!pool || pool.remaining < (action.usage.cost ?? 1)) {
      return {
        status: "rejected-illegal",
        reason: `共享次数池 ${action.usage.sharedPoolKey} 不足。`,
        suggestedActionKeys: suggestedActionKeys.filter(
          (actionKey) => actionKey !== action.key,
        ),
      };
    }
  }
  try {
    if (product.actionEconomy) {
      spendTtrpgActionEconomyV2({
        economy: product.actionEconomy,
        turnOrder: ttrpg.turnOrder,
        actorKey: input.actorKey,
        phase: action.phase,
      });
    }
  } catch (cause) {
    return {
      status: "rejected-illegal",
      reason: cause instanceof Error ? cause.message : String(cause),
      suggestedActionKeys: suggestedActionKeys.filter(
        (actionKey) => actionKey !== action.key,
      ),
    };
  }
  return {
    status: null,
    reason: "行动合法，进入冻结 RulePack 裁决。",
    suggestedActionKeys,
  };
}

/**
 * Human/GM intent gate. Legal declarations resolve through the same RulePack
 * action event; unclear or illegal declarations still commit one terminal,
 * player-visible receipt without rolling dice or mutating mechanics.
 */
export async function submitTtrpgActionIntentV2(
  input: FormalTtrpgCommandEnvelope & {
    intentKey: string;
    actorKey: string;
    rawInput: string;
    actionKey?: string | null;
    targetKey?: string | null;
    goal?: string | null;
    method?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    submittedBy: { role: "gm" | "player"; viewerKey: string };
  },
): Promise<SimulationEvent> {
  const intentKey = input.intentKey.trim();
  const actorKey = input.actorKey.trim();
  const rawInput = input.rawInput.trim().normalize("NFC");
  const actionKey = input.actionKey?.trim() || null;
  const targetKey = input.targetKey?.trim() || null;
  const goal = input.goal?.trim().normalize("NFC") || null;
  const method = input.method?.trim().normalize("NFC") || null;
  const submittedBy = {
    role: input.submittedBy?.role,
    viewerKey: input.submittedBy?.viewerKey?.trim() ?? "",
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(intentKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !rawInput ||
    rawInput.length > 10_000 ||
    (goal?.length ?? 0) > 2_000 ||
    (method?.length ?? 0) > 2_000 ||
    !["gm", "player"].includes(String(submittedBy.role)) ||
    !submittedBy.viewerKey
  ) {
    throw new Error("[ttrpg] 行动意图提交字段无效。");
  }
  const session = await db.simulationSessions.get(input.sessionId);
  if (!session) throw new Error("[ttrpg] 正式 TTRPG 实例不存在。");
  const prior = (await readSessionEvents(session)).find(
    (event) => event.commandId === input.commandId.trim(),
  );
  if (prior) {
    const payload = parseEventPayload(prior);
    const priorIntent =
      prior.type === "ttrpg.intent.receipted" && isObject(payload.receipt)
        ? parseTtrpgIntentReceiptV2(payload.receipt)
        : prior.type === "ttrpg.rule.action.resolved" &&
            isObject(payload.result)
          ? assertTtrpgRuleActionResult(payload.result).receipt?.context
              .declaredIntent
          : null;
    if (
      !priorIntent ||
      priorIntent.intentKey !== intentKey ||
      priorIntent.rawInput !== rawInput
    ) {
      throw new Error("[ttrpg] commandId 已被不同行动意图使用。");
    }
    return prior;
  }
  const [state, version, frozen, participants] = await Promise.all([
    readSimulationState(input.sessionId),
    readSimulationStateVersion(input.sessionId),
    verifyFormalTtrpgSource(session),
    readTtrpgSessionParticipantsV2(input.sessionId),
  ]);
  if (
    version.sequence !== input.baseSequence ||
    version.stateHash !== input.baseStateHash
  ) {
    throw new Error("[ttrpg] 战役状态已变化，请刷新后重试。");
  }
  if (submittedBy.role === "gm") {
    assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
  } else {
    const seat = participants.find(
      (row) =>
        row.role === "player" &&
        row.actorKey === actorKey &&
        row.viewerKey === submittedBy.viewerKey,
    );
    if (
      !seat ||
      !["human", "hybrid"].includes(seat.controller) ||
      seat.assignmentState !== "claimed" ||
      seat.sessionZeroAcceptedAtSequence == null
    ) {
      throw new Error("[ttrpg] 当前 viewer 没有为该角色提交行动的席位权限。");
    }
  }
  const classification = classifyTtrpgSubmittedIntentV2({
    state,
    campaign: frozen.campaign,
    rulePack: frozen.rulePack,
    actorKey,
    actionKey,
    targetKey,
  });
  if (classification.status == null && actionKey) {
    return resolveTtrpgRuleAction({
      sessionId: input.sessionId,
      commandId: input.commandId,
      baseSequence: input.baseSequence,
      baseStateHash: input.baseStateHash,
      actionKey,
      actorKey,
      targetKey,
      difficulty: input.difficulty,
      situationalModifier: input.situationalModifier,
      rollVisibility: input.rollVisibility,
      declaredIntent: { intentKey, rawInput, goal, method },
    });
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.intent.receipted",
    intent: {
      intentKey,
      actorKey,
      rawInput,
      actionKey,
      targetKey,
      goal,
      method,
      submittedBy,
    },
    build: async ({
      state: current,
      sequence,
      campaign,
      rulePack,
      participants,
    }) => {
      if (submittedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
      } else if (
        !participants.some(
          (row) =>
            row.role === "player" &&
            row.actorKey === actorKey &&
            row.viewerKey === submittedBy.viewerKey &&
            ["human", "hybrid"].includes(row.controller) &&
            row.assignmentState === "claimed" &&
            row.sessionZeroAcceptedAtSequence != null,
        )
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有为该角色提交行动的席位权限。");
      }
      const terminal = classifyTtrpgSubmittedIntentV2({
        state: current,
        campaign,
        rulePack,
        actorKey,
        actionKey,
        targetKey,
      });
      if (terminal.status == null) {
        throw new Error("[ttrpg] 行动已经合法，请刷新并进入正式规则裁决。");
      }
      const receipt: SimulationTtrpgIntentReceiptV2 = {
        schema: "storyforge.ttrpg-intent-receipt",
        version: 2,
        receiptKey: `intent-receipt.${sequence}`,
        eventSequence: sequence,
        intentKey,
        actorKey,
        rawInput,
        proposedActionKey: actionKey,
        targetKey,
        terminalStatus: terminal.status,
        reason: terminal.reason,
        suggestedActionKeys: terminal.suggestedActionKeys,
      };
      return { actorKey, targetKey, payload: { receipt } };
    },
  });
}

/** Records one human-owned, non-mechanical response to an ActionReceipt prompt window. */
export async function recordTtrpgHumanResponseV2(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
    actionReceiptKey: string;
    actorKey: string;
    kind: "speak" | "act-narratively" | "decline";
    text?: string;
    audience: "party" | "gm-only";
    viewerKey: string;
  },
): Promise<SimulationEvent> {
  const actionSequence = assertFiniteInteger(
    input.actionSequence,
    "真人回应行动序号",
    1,
    Number.MAX_SAFE_INTEGER,
  );
  const actionReceiptKey = input.actionReceiptKey.trim();
  const actorKey = input.actorKey.trim();
  const viewerKey = input.viewerKey.trim();
  const kind = input.kind;
  const audience = input.audience;
  const text =
    kind === "decline"
      ? "本角色选择不作额外回应。"
      : String(input.text ?? "")
          .trim()
          .normalize("NFC");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actionReceiptKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(viewerKey) ||
    !["speak", "act-narratively", "decline"].includes(kind) ||
    !["party", "gm-only"].includes(audience) ||
    !text ||
    text.length > 10_000
  ) {
    throw new Error("[ttrpg] 真人角色回应字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.human-response.recorded",
    intent: {
      actionSequence,
      actionReceiptKey,
      actorKey,
      kind,
      text,
      audience,
      viewerKey,
    },
    build: async ({ state, sequence, participants }) => {
      const product = state.ttrpg?.product;
      if (
        !product?.sessionZero.completed ||
        product.ending ||
        product.safety.status !== "active"
      ) {
        throw new Error("[ttrpg] 当前战役不能提交真人角色回应。");
      }
      const seat = participants.find(
        (row) =>
          row.role === "player" &&
          row.actorKey === actorKey &&
          row.viewerKey === viewerKey,
      );
      if (
        !seat ||
        !["human", "hybrid"].includes(seat.controller) ||
        seat.assignmentState !== "claimed" ||
        seat.sessionZeroAcceptedAtSequence == null
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有替该真人角色回应的席位权限。");
      }
      const sourceAction = product.actionHistory.find(
        (action) => action.eventSequence === actionSequence,
      );
      const sourceReceipt = sourceAction?.receipt;
      if (!sourceReceipt || sourceReceipt.receiptKey !== actionReceiptKey) {
        throw new Error(
          "[ttrpg] 真人回应绑定的 ActionReceipt 不存在或已变化。",
        );
      }
      const observer = sourceReceipt.context.observers.find(
        (item) => item.actorKey === actorKey,
      );
      const promptWindow = sourceReceipt.context.reactionWindows.some(
        (window) =>
          window.status !== "closed" &&
          window.layer === "immediate-character" &&
          window.humanConfirmationRequiredActorKeys.includes(actorKey),
      );
      if (observer?.responsePolicy !== "prompt-human" || !promptWindow) {
        throw new Error("[ttrpg] 该角色没有属于本人的开放回应窗口。");
      }
      if (
        (product.humanResponses ?? []).some(
          (response) =>
            response.actionSequence === actionSequence &&
            response.actorKey === actorKey,
        )
      ) {
        throw new Error("[ttrpg] 该真人角色已经回应本次行动。");
      }
      const response: SimulationTtrpgHumanResponseV2 = {
        schema: "storyforge.ttrpg-human-response",
        version: 2,
        responseKey: `human-response.${actionSequence}.${actorKey}`,
        eventSequence: sequence,
        actionSequence,
        actionReceiptKey,
        actorKey,
        kind,
        text,
        audience,
        viewerKey,
      };
      return {
        actorKey,
        targetKey: sourceAction?.actorKey ?? null,
        payload: { response },
      };
    },
  });
}

/**
 * Records a non-resolution terminal disposition without rolling dice or
 * mutating action economy. Queueing/interruption requires a structurally
 * available frozen action; cancellation may also close an unstructured draft.
 */
export async function commitTtrpgIntentDispositionV2(
  input: FormalTtrpgCommandEnvelope & {
    intentKey: string;
    actorKey: string;
    rawInput: string;
    actionKey?: string | null;
    targetKey?: string | null;
    terminalStatus: "interrupted" | "queued/deferred" | "cancelled";
    reason: string;
    submittedBy: { role: "gm" | "player"; viewerKey: string };
  },
): Promise<SimulationEvent> {
  const intentKey = input.intentKey.trim();
  const actorKey = input.actorKey.trim();
  const rawInput = input.rawInput.trim().normalize("NFC");
  const actionKey = input.actionKey?.trim() || null;
  const targetKey = input.targetKey?.trim() || null;
  const reason = input.reason.trim().normalize("NFC");
  const terminalStatus = input.terminalStatus;
  const submittedBy = {
    role: input.submittedBy?.role,
    viewerKey: input.submittedBy?.viewerKey?.trim() ?? "",
  };
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(intentKey) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(actorKey) ||
    !rawInput ||
    rawInput.length > 10_000 ||
    !reason ||
    reason.length > 4_000 ||
    !["interrupted", "queued/deferred", "cancelled"].includes(terminalStatus) ||
    !["gm", "player"].includes(String(submittedBy.role)) ||
    !submittedBy.viewerKey
  ) {
    throw new Error("[ttrpg] 行动意图终态处置字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.intent.receipted",
    intent: {
      intentKey,
      actorKey,
      rawInput,
      actionKey,
      targetKey,
      terminalStatus,
      reason,
      submittedBy,
    },
    build: async ({ state, sequence, campaign, rulePack, participants }) => {
      if (submittedBy.role === "gm") {
        assertFormalTtrpgGmV2(participants, submittedBy.viewerKey);
      } else if (
        !participants.some(
          (row) =>
            row.role === "player" &&
            row.actorKey === actorKey &&
            row.viewerKey === submittedBy.viewerKey &&
            ["human", "hybrid"].includes(row.controller) &&
            row.assignmentState === "claimed" &&
            row.sessionZeroAcceptedAtSequence != null,
        )
      ) {
        throw new Error("[ttrpg] 当前 viewer 没有处置该角色行动的席位权限。");
      }
      if (terminalStatus === "interrupted" && submittedBy.role !== "gm") {
        throw new Error("[ttrpg] 只有 KP/规则权威可以确认行动被正式打断。");
      }
      const classification = classifyTtrpgSubmittedIntentV2({
        state,
        campaign,
        rulePack,
        actorKey,
        actionKey,
        targetKey,
      });
      if (
        terminalStatus !== "cancelled" &&
        (!actionKey || !classification.suggestedActionKeys.includes(actionKey))
      ) {
        throw new Error(
          "[ttrpg] 只有当前场景与角色卡实际授予的行动可以排队或被打断。",
        );
      }
      const receipt: SimulationTtrpgIntentReceiptV2 = {
        schema: "storyforge.ttrpg-intent-receipt",
        version: 2,
        receiptKey: `intent-receipt.${sequence}`,
        eventSequence: sequence,
        intentKey,
        actorKey,
        rawInput,
        proposedActionKey: actionKey,
        targetKey,
        terminalStatus,
        reason,
        suggestedActionKeys: classification.suggestedActionKeys.filter(
          (candidate) => candidate !== actionKey,
        ),
      };
      return { actorKey, targetKey, payload: { receipt } };
    },
  });
}

export async function resolveTtrpgRuleCheck(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
  },
): Promise<SimulationEvent> {
  const actionKey = input.actionKey.trim();
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey?.trim() || null;
  const difficulty = input.difficulty;
  const situationalModifier = input.situationalModifier ?? 0;
  const rollVisibility = input.rollVisibility ?? "public";
  if (!["public", "gm-only"].includes(rollVisibility)) {
    throw new Error("[ttrpg] 检定可见性无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.check.resolved",
    intent: {
      actionKey,
      actorKey,
      targetKey,
      difficulty: difficulty ?? null,
      situationalModifier,
      rollVisibility,
    },
    build: async ({ session, state, sequence, rulePack, campaign }) => {
      const ttrpg = state.ttrpg;
      if (!ttrpg?.product?.sessionZero.completed || !ttrpg.scene?.sceneKey) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      if (
        rollVisibility === "gm-only" &&
        ttrpg.product.hiddenDicePolicy === "never"
      ) {
        throw new Error("[ttrpg] 冻结 CampaignPack 不允许暗骰。");
      }
      const scene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene!.sceneKey,
      );
      const action = rulePack.actions.find((item) => item.key === actionKey);
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === actorKey,
      );
      const checkEffect = action?.effects.find(
        (effect) => effect.kind === "check",
      );
      if (
        !scene?.actionKeys.includes(actionKey) ||
        !action ||
        !template ||
        !checkEffect ||
        checkEffect.kind !== "check"
      ) {
        throw new Error("[ttrpg] 当前角色/场景没有该冻结规则行动。");
      }
      const granted =
        template.actionKeys.includes(actionKey) ||
        template.itemKeys.some((itemKey) =>
          rulePack.items
            .find((item) => item.key === itemKey)
            ?.grantedActionKeys.includes(actionKey),
        );
      if (!granted) throw new Error("[ttrpg] 角色卡没有该行动。");
      if (action.target === "self" && targetKey !== actorKey)
        throw new Error("[ttrpg] 自身行动目标必须是行动者。");
      if (
        (action.target === "single-ally" || action.target === "single-enemy") &&
        (!targetKey || targetKey === actorKey)
      ) {
        throw new Error("[ttrpg] 单体行动必须选择另一名目标。");
      }
      if (targetKey && !state.entities[targetKey])
        throw new Error("[ttrpg] 行动目标不存在。");
      const actorSkill = resolveTtrpgActionSkillV2({
        state,
        campaign,
        actorKey,
        actionKey,
      });
      const opponentSkill =
        targetKey == null
          ? null
          : resolveTtrpgActionSkillV2({
              state,
              campaign,
              actorKey: targetKey,
              actionKey,
            });
      const resolution = await resolveRulePackCheckV1({
        rulePack,
        checkKey: checkEffect.checkKey,
        attributeKey: checkEffect.attributeKey,
        attributes: Object.fromEntries(
          [...rulePack.attributes, ...rulePack.derivedStats].map(
            (attribute) => [
              attribute.key,
              Number(state.entities[actorKey]?.attributes[attribute.key]),
            ],
          ),
        ),
        seed: session.seed,
        nonce: `${input.commandId}:${sequence}:${actionKey}`,
        difficulty,
        situationalModifier: situationalModifier + actorSkill.skillValue,
        contestantRef: actorKey,
        opponent:
          targetKey == null
            ? undefined
            : {
                contestantRef: targetKey,
                attributeKey: checkEffect.attributeKey,
                situationalModifier: opponentSkill?.skillValue ?? 0,
                attributes: Object.fromEntries(
                  [...rulePack.attributes, ...rulePack.derivedStats].map(
                    (attribute) => [
                      attribute.key,
                      Number(
                        state.entities[targetKey]?.attributes[attribute.key],
                      ),
                    ],
                  ),
                ),
              },
      });
      const model = rulePack.diceModels.find(
        (item) => item.key === resolution.diceModelKey,
      )!;
      const modifier = ["total-vs-target", "opposed"].includes(resolution.mode)
        ? resolution.attributeModifier + resolution.situationalModifier
        : 0;
      const expression = `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`;
      return {
        actorKey,
        targetKey: targetKey ?? actorKey,
        payload: {
          check: {
            actorKey,
            skill: action.name,
            expression,
            dice: resolution.keptDice,
            modifier,
            total: resolution.total,
            dc: resolution.difficulty,
            success: ttrpgDegreeSucceededV2(resolution.degree),
            visibility: rollVisibility,
            rule: {
              actionKey,
              checkKey: resolution.checkKey,
              attributeKey: resolution.attributeKey,
              skillKey: actorSkill.skillKey,
              skillValue: actorSkill.skillValue,
              diceModelKey: resolution.diceModelKey,
              rolledDice: resolution.dice,
              keptDice: resolution.keptDice,
              degree: resolution.degree,
              mode: resolution.mode,
              successes: resolution.successes,
              winnerRef: resolution.winnerRef,
              tiedRefs: resolution.tiedRefs,
              calculationTrace: resolution.calculationTrace,
              opponent:
                resolution.opponent == null
                  ? null
                  : {
                      contestantRef: resolution.opponent.contestantRef,
                      attributeKey: resolution.opponent.attributeKey,
                      rolledDice: resolution.opponent.dice,
                      keptDice: resolution.opponent.keptDice,
                      attributeModifier: resolution.opponent.attributeModifier,
                      total: resolution.opponent.total,
                      degree: resolution.opponent.degree,
                      rollTrace: resolution.opponent.rollTrace,
                      proofHash: resolution.opponent.proofHash,
                    },
              rollTrace: resolution.rollTrace,
              seedCommitment: resolution.seedCommitment,
              nonce: resolution.nonce,
              proofHash: resolution.proofHash,
              rulePackContentHash: ttrpg.product.rulePackContentHash,
            },
          },
        },
      };
    },
  });
}

export async function resolveTtrpgRuleAction(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal?: string | null;
      method?: string | null;
    } | null;
  },
): Promise<SimulationEvent> {
  return resolveTtrpgRuleActionWithAuthority(input);
}

async function resolveTtrpgRuleActionWithAuthority(
  input: FormalTtrpgCommandEnvelope & {
    actionKey: string;
    actorKey: string;
    targetKey?: string | null;
    difficulty?: number;
    situationalModifier?: number;
    rollVisibility?: "public" | "gm-only";
    declaredIntent?: {
      intentKey: string;
      rawInput: string;
      goal?: string | null;
      method?: string | null;
    } | null;
    actorAuthority?: NonNullable<
      import("../types").SimulationTtrpgRuleActionResultV1["actorAuthority"]
    >;
  },
): Promise<SimulationEvent> {
  const actionKey = input.actionKey.trim();
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey?.trim() || null;
  const difficulty = input.difficulty;
  const situationalModifier = input.situationalModifier ?? 0;
  const rollVisibility = input.rollVisibility ?? "public";
  if (!["public", "gm-only"].includes(rollVisibility)) {
    throw new Error("[ttrpg] 检定可见性无效。");
  }
  const actorAuthority =
    input.actorAuthority == null ? null : structuredClone(input.actorAuthority);
  const declaredIntent =
    input.declaredIntent == null
      ? null
      : {
          intentKey: input.declaredIntent.intentKey.trim(),
          rawInput: input.declaredIntent.rawInput.trim().normalize("NFC"),
          goal: input.declaredIntent.goal?.trim().normalize("NFC") || null,
          method: input.declaredIntent.method?.trim().normalize("NFC") || null,
        };
  if (
    declaredIntent &&
    (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(declaredIntent.intentKey) ||
      !declaredIntent.rawInput ||
      declaredIntent.rawInput.length > 10_000 ||
      (declaredIntent.goal?.length ?? 0) > 2_000 ||
      (declaredIntent.method?.length ?? 0) > 2_000)
  ) {
    throw new Error("[ttrpg] 行动声明意图无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.rule.action.resolved",
    intent: {
      actionKey,
      actorKey,
      targetKey,
      difficulty: difficulty ?? null,
      situationalModifier,
      rollVisibility,
      actorAuthority,
      declaredIntent,
    },
    build: async ({
      session,
      state,
      sequence,
      rulePack,
      campaign,
      participants,
    }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (!ttrpg || !product?.sessionZero.completed || !ttrpg.scene?.sceneKey) {
        throw new Error("[ttrpg] 请先完成 Session Zero 并打开正式场景。");
      }
      if (
        rollVisibility === "gm-only" &&
        product.hiddenDicePolicy === "never"
      ) {
        throw new Error("[ttrpg] 冻结 CampaignPack 不允许暗骰。");
      }
      const scene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene!.sceneKey,
      );
      const action = rulePack.actions.find((item) => item.key === actionKey);
      const template = campaign.characterTemplates.find(
        (item) => item.characterKey === actorKey,
      );
      if (!scene?.actionKeys.includes(actionKey) || !action || !template) {
        throw new Error("[ttrpg] 当前角色/场景没有该冻结规则行动。");
      }
      const actorSeat =
        participants.find(
          (row) => row.role === "player" && row.actorKey === actorKey,
        ) ?? null;
      const gmSeat = participants.find((row) => row.role === "gm") ?? null;
      const gmActorAuthority =
        actorAuthority?.source === "ai-gm-npc" ||
        actorAuthority?.source === "hybrid-gm-confirmed";
      if (
        !actorAuthority &&
        (actorSeat?.controller === "ai" || actorSeat?.controller === "vacant")
      ) {
        throw new Error("[ttrpg] AI 或空缺玩家席位不能通过真人直提入口行动。");
      }
      if (
        !actorAuthority &&
        template.role === "npc" &&
        gmSeat?.controller === "ai"
      ) {
        throw new Error("[ttrpg] AI KP 控制的 NPC 不能通过真人直提入口行动。");
      }
      if (actorAuthority) {
        if (gmActorAuthority) {
          if (
            template.role !== "npc" ||
            actorSeat ||
            !gmSeat ||
            gmSeat.viewerKey !== actorAuthority.viewerKey ||
            gmSeat.sessionZeroAcceptedAtSequence == null ||
            !gmSeat.consent.safetyBoundariesAccepted ||
            !gmSeat.consent.aiIdentityDisclosed ||
            (actorAuthority.source === "ai-gm-npc" &&
              gmSeat.controller !== "ai") ||
            (actorAuthority.source === "hybrid-gm-confirmed" &&
              (gmSeat.controller !== "hybrid" ||
                !gmSeat.consent.aiAdviceAllowed))
          ) {
            throw new Error(
              "[ttrpg] AI KP 角色行动与当前 GM 席位、NPC 权威或同意策略不一致。",
            );
          }
        } else {
          const seat = actorSeat;
          if (
            !seat ||
            seat.viewerKey !== actorAuthority.viewerKey ||
            seat.sessionZeroAcceptedAtSequence == null ||
            !seat.consent.safetyBoundariesAccepted ||
            !seat.consent.aiIdentityDisclosed ||
            (actorAuthority.source === "ai-player" &&
              seat.controller !== "ai") ||
            (actorAuthority.source === "hybrid-confirmed" &&
              (seat.controller !== "hybrid" || !seat.consent.aiAdviceAllowed))
          ) {
            throw new Error(
              "[ttrpg] AI 玩家行动与当前席位控制权或同意策略不一致。",
            );
          }
        }
      }
      const economyTransition = product.actionEconomy
        ? spendTtrpgActionEconomyV2({
            economy: product.actionEconomy,
            turnOrder: ttrpg.turnOrder,
            actorKey,
            phase: action.phase,
          })
        : null;
      if (!economyTransition && ttrpg.activeActorKey !== actorKey) {
        throw new Error("[ttrpg] 当前还没轮到该行动者。");
      }
      const inventoryItemKeys =
        product.inventory == null
          ? template.itemKeys
          : Object.values(product.inventory.items)
              .filter(
                (item) =>
                  item.ownerRef === actorKey &&
                  !item.stateTags.includes("broken"),
              )
              .map((item) => item.definitionRef);
      const granted =
        template.actionKeys.includes(actionKey) ||
        inventoryItemKeys.some((itemKey) =>
          rulePack.items
            .find((item) => item.key === itemKey)
            ?.grantedActionKeys.includes(actionKey),
        );
      if (!granted) throw new Error("[ttrpg] 角色卡没有该行动。");
      const participantSet = new Set(ttrpg.turnOrder);
      let resolvedTargetKey: string | null = targetKey;
      if (action.target === "self") resolvedTargetKey = actorKey;
      else if (action.target === "scene") resolvedTargetKey = null;
      else if (
        !resolvedTargetKey ||
        resolvedTargetKey === actorKey ||
        !participantSet.has(resolvedTargetKey)
      ) {
        throw new Error("[ttrpg] 单体行动必须选择当前场景中的另一名目标。");
      }
      if (
        !state.entities[actorKey] ||
        (resolvedTargetKey && !state.entities[resolvedTargetKey])
      ) {
        throw new Error("[ttrpg] 行动者或目标不存在。");
      }
      const actorSkill = resolveTtrpgActionSkillV2({
        state,
        campaign,
        actorKey,
        actionKey,
      });
      const opponentSkill =
        resolvedTargetKey == null
          ? null
          : resolveTtrpgActionSkillV2({
              state,
              campaign,
              actorKey: resolvedTargetKey,
              actionKey,
            });

      const resourceChanges: import("../types").SimulationTtrpgRuleActionResultV1["resourceChanges"] =
        [];
      const resourceCurrent = (
        entityKey: string,
        resourceKey: string,
      ): { current: number; maximum: number } => {
        const prior = [...resourceChanges]
          .reverse()
          .find(
            (item) =>
              item.entityKey === entityKey && item.resourceKey === resourceKey,
          );
        if (prior) return { current: prior.after, maximum: prior.maximum };
        const entity = state.entities[entityKey];
        const current = entity?.attributes[`resource.${resourceKey}`];
        const maximum = entity?.attributes[`resourceMax.${resourceKey}`];
        if (
          !Number.isInteger(current) ||
          !Number.isInteger(maximum) ||
          Number(maximum) <= 0
        ) {
          throw new Error(
            `[ttrpg] 角色缺少规则资源:${entityKey}.${resourceKey}`,
          );
        }
        return { current: Number(current), maximum: Number(maximum) };
      };
      const addResourceChange = (
        entityKey: string,
        resourceKey: string,
        delta: number,
        proofHash: string | null,
      ) => {
        const { current, maximum } = resourceCurrent(entityKey, resourceKey);
        const after = Math.max(0, Math.min(maximum, current + delta));
        resourceChanges.push({
          entityKey,
          resourceKey,
          before: current,
          delta,
          after,
          maximum,
          proofHash,
        });
      };
      const abilityStateKey = ttrpgAbilityStateKeyV2(actorKey, actionKey);
      const beforeAbility = product.abilityStates?.[abilityStateKey];
      if (!beforeAbility)
        throw new Error(`[ttrpg] 角色缺少冻结能力次数账本:${abilityStateKey}`);
      const sharedPoolKey = action.usage.sharedPoolKey;
      const beforeSharedPool =
        sharedPoolKey == null
          ? null
          : (product.usagePools?.[sharedPoolKey] ?? null);
      const abilityResource =
        action.usage.resourceKey == null
          ? null
          : resourceCurrent(actorKey, action.usage.resourceKey).current;
      const abilityUse = consumeTtrpgAbilityV2({
        definition: {
          abilityKey: action.key,
          actionDefinitionKey: action.key,
          usage: action.usage,
        },
        state: beforeAbility,
        eventId: `event.${sequence}`,
        currentRound: ttrpg.round,
        resourceCurrent: abilityResource,
        sharedPool: beforeSharedPool,
      });
      if (abilityUse.resourceDelta !== 0 && action.usage.resourceKey) {
        addResourceChange(
          actorKey,
          action.usage.resourceKey,
          abilityUse.resourceDelta,
          null,
        );
      }
      const abilityChange: import("../types").SimulationTtrpgRuleActionResultV1["abilityChange"] =
        {
          stateKey: abilityStateKey,
          before: structuredClone(beforeAbility),
          after: abilityUse.state,
          sharedPoolKey,
          sharedPoolBefore:
            beforeSharedPool == null ? null : structuredClone(beforeSharedPool),
          sharedPoolAfter: abilityUse.sharedPool,
        };
      if (action.costResourceKey && action.costAmount > 0) {
        const resource = resourceCurrent(actorKey, action.costResourceKey);
        if (resource.current < action.costAmount)
          throw new Error(`[ttrpg] ${action.name}所需资源不足。`);
        addResourceChange(
          actorKey,
          action.costResourceKey,
          -action.costAmount,
          null,
        );
      }

      const checkEffects = action.effects.filter(
        (effect): effect is Extract<typeof effect, { kind: "check" }> =>
          effect.kind === "check",
      );
      if (checkEffects.length > 1)
        throw new Error("[ttrpg] v1 规则行动最多包含一个检定效果。");
      const activeConditions = product.conditions[actorKey] ?? [];
      const conditionModifier = activeConditions.reduce((sum, condition) => {
        const definition = rulePack.conditions.find(
          (item) => item.key === condition.conditionKey,
        );
        return sum + (definition?.checkModifier ?? 0) * condition.stacks;
      }, 0);
      let check: SimulationTtrpgCheck | null = null;
      let outcome: import("../types").SimulationTtrpgRuleActionResultV1["outcome"] =
        "automatic";
      if (checkEffects[0]) {
        const effect = checkEffects[0];
        const resolution = await resolveRulePackCheckV1({
          rulePack,
          checkKey: effect.checkKey,
          attributeKey: effect.attributeKey,
          attributes: Object.fromEntries(
            [...rulePack.attributes, ...rulePack.derivedStats].map(
              (attribute) => [
                attribute.key,
                Number(state.entities[actorKey]?.attributes[attribute.key]),
              ],
            ),
          ),
          seed: session.seed,
          nonce: `${input.commandId}:${sequence}:${actionKey}`,
          difficulty,
          situationalModifier:
            situationalModifier + conditionModifier + actorSkill.skillValue,
          contestantRef: actorKey,
          opponent:
            resolvedTargetKey == null
              ? undefined
              : {
                  contestantRef: resolvedTargetKey,
                  attributeKey: effect.attributeKey,
                  situationalModifier: opponentSkill?.skillValue ?? 0,
                  attributes: Object.fromEntries(
                    [...rulePack.attributes, ...rulePack.derivedStats].map(
                      (attribute) => [
                        attribute.key,
                        Number(
                          state.entities[resolvedTargetKey]?.attributes[
                            attribute.key
                          ],
                        ),
                      ],
                    ),
                  ),
                },
        });
        const model = rulePack.diceModels.find(
          (item) => item.key === resolution.diceModelKey,
        )!;
        const modifier = ["total-vs-target", "opposed"].includes(
          resolution.mode,
        )
          ? resolution.attributeModifier + resolution.situationalModifier
          : 0;
        const expression = `${resolution.keptDice.length}d${model.sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`;
        outcome = resolution.degree;
        check = {
          eventSequence: sequence,
          actorKey,
          skill: action.name,
          expression,
          dice: resolution.keptDice,
          modifier,
          total: resolution.total,
          dc: resolution.difficulty,
          success: ttrpgDegreeSucceededV2(resolution.degree),
          visibility: rollVisibility,
          rule: {
            actionKey,
            checkKey: resolution.checkKey,
            attributeKey: resolution.attributeKey,
            skillKey: actorSkill.skillKey,
            skillValue: actorSkill.skillValue,
            diceModelKey: resolution.diceModelKey,
            rolledDice: resolution.dice,
            keptDice: resolution.keptDice,
            degree: resolution.degree,
            mode: resolution.mode,
            successes: resolution.successes,
            winnerRef: resolution.winnerRef,
            tiedRefs: resolution.tiedRefs,
            calculationTrace: resolution.calculationTrace,
            opponent:
              resolution.opponent == null
                ? null
                : {
                    contestantRef: resolution.opponent.contestantRef,
                    attributeKey: resolution.opponent.attributeKey,
                    rolledDice: resolution.opponent.dice,
                    keptDice: resolution.opponent.keptDice,
                    attributeModifier: resolution.opponent.attributeModifier,
                    total: resolution.opponent.total,
                    degree: resolution.opponent.degree,
                    rollTrace: resolution.opponent.rollTrace,
                    proofHash: resolution.opponent.proofHash,
                  },
            rollTrace: resolution.rollTrace,
            seedCommitment: resolution.seedCommitment,
            nonce: resolution.nonce,
            proofHash: resolution.proofHash,
            rulePackContentHash: product.rulePackContentHash,
          },
        };
      }
      const effectSucceeded = check == null || check.success;
      const conditionChanges: import("../types").SimulationTtrpgRuleActionResultV1["conditionChanges"] =
        [];
      for (const [effectIndex, effect] of action.effects.entries()) {
        if (effect.kind === "check") continue;
        const shouldApply = effect.appliesOnDegrees
          ? effect.appliesOnDegrees.includes(outcome)
          : effectSucceeded;
        if (!shouldApply) continue;
        const effectTargetKey =
          effect.targetScope === "actor"
            ? actorKey
            : (resolvedTargetKey ?? actorKey);
        if (effect.kind === "resource") {
          addResourceChange(
            effectTargetKey,
            effect.resourceKey,
            effect.delta,
            null,
          );
        } else if (effect.kind === "damage") {
          const modifier =
            effect.modifierAttributeKey == null
              ? 0
              : Number(
                  state.entities[actorKey].attributes[
                    effect.modifierAttributeKey
                  ],
                );
          if (!Number.isFinite(modifier))
            throw new Error(
              `[ttrpg] 伤害修正属性无效:${effect.modifierAttributeKey}`,
            );
          const damage = await resolveRulePackDiceModelV1({
            rulePack,
            diceModelKey: effect.diceModelKey,
            seed: session.seed,
            nonce: `${input.commandId}:${sequence}:${actionKey}:damage:${effectIndex}`,
            modifier,
          });
          addResourceChange(
            effectTargetKey,
            effect.resourceKey,
            -Math.max(0, damage.total),
            damage.proofHash,
          );
        } else if (effect.kind === "condition") {
          const definition = rulePack.conditions.find(
            (item) => item.key === effect.conditionKey,
          )!;
          const existing = product.conditions[effectTargetKey]?.find(
            (item) => item.conditionKey === effect.conditionKey,
          );
          const stacks =
            definition.stacking === "replace"
              ? Math.min(definition.maximumStacks, effect.stacks)
              : Math.min(
                  definition.maximumStacks,
                  (existing?.stacks ?? 0) + effect.stacks,
                );
          conditionChanges.push({
            entityKey: effectTargetKey,
            conditionKey: effect.conditionKey,
            stacks,
            duration: definition.defaultDurationRounds,
          });
        }
      }
      const completesTurn = economyTransition
        ? economyTransition.nextActorKey != null
        : action.phase === "action";
      if (completesTurn) {
        for (const condition of activeConditions) {
          if (condition.duration == null) continue;
          const duration = condition.duration - 1;
          conditionChanges.push({
            entityKey: actorKey,
            conditionKey: condition.conditionKey,
            stacks: duration > 0 ? condition.stacks : 0,
            duration: duration > 0 ? duration : null,
          });
        }
      }
      const currentIndex = ttrpg.turnOrder.indexOf(actorKey);
      const shouldAdvance = action.phase === "action";
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
      const nextActorKey =
        economyTransition?.nextActorKey ??
        (shouldAdvance ? ttrpg.turnOrder[nextIndex] : null);
      const nextRound =
        economyTransition?.nextRound ??
        (shouldAdvance ? ttrpg.round + (nextIndex === 0 ? 1 : 0) : ttrpg.round);
      const receipt = createTtrpgActionReceiptV2({
        state,
        campaign,
        rulePack,
        sequence,
        sceneKey: scene.sceneKey,
        action,
        actorKey,
        targetKey: resolvedTargetKey,
        check,
        outcome,
        resourceChanges,
        conditionChanges,
        abilityChange,
        nextActorKey,
        nextRound,
        participantControllers: Object.fromEntries(
          participants.flatMap((row) =>
            row.actorKey == null ? [] : [[row.actorKey, row.controller]],
          ),
        ),
        declaredIntent,
      });
      return {
        actorKey,
        targetKey: resolvedTargetKey,
        payload: {
          result: {
            eventSequence: sequence,
            actionKey,
            actionName: action.name,
            actorKey,
            targetKey: resolvedTargetKey,
            actionPhase: action.phase,
            outcome,
            check,
            resourceChanges,
            conditionChanges,
            abilityChange,
            actorAuthority,
            receipt,
            nextActorKey,
            nextRound,
          },
        },
      };
    },
  });
}

/**
 * GM-authorized short/long rest. The command resets only usages explicitly
 * named by the frozen RulePack and writes every before/after value to replay.
 */
export async function completeTtrpgRestV2(
  input: FormalTtrpgCommandEnvelope & {
    restKey: string;
    kind: "short-rest" | "long-rest";
    actorKeys: string[];
    gmKey: string;
    reason: string;
  },
): Promise<SimulationEvent> {
  const restKey = input.restKey.trim();
  const kind = input.kind;
  const actorKeys = [...new Set(input.actorKeys.map((key) => key.trim()))];
  const gmKey = input.gmKey.trim();
  const reason = input.reason.trim().normalize("NFC");
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(restKey) ||
    !["short-rest", "long-rest"].includes(kind) ||
    !actorKeys.length ||
    actorKeys.some((key) => !key) ||
    !gmKey ||
    !reason ||
    reason.length > 2_000
  ) {
    throw new Error("[ttrpg] 休息命令字段无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.rest.completed",
    intent: { restKey, kind, actorKeys, gmKey, reason },
    build: async ({ state, sequence, rulePack, participants }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      assertFormalTtrpgGmV2(participants, gmKey);
      if (
        !product?.sessionZero.completed ||
        !product.abilityStates ||
        product.ending ||
        ttrpg?.encounter?.status === "active" ||
        (product.restHistory ?? []).some((item) => item.restKey === restKey)
      ) {
        throw new Error("[ttrpg] 当前战役不能完成这次休息。");
      }
      if (
        actorKeys.some(
          (key) => !product.sessionZero.selectedCharacterKeys.includes(key),
        )
      ) {
        throw new Error(
          "[ttrpg] 休息对象必须是 Session Zero 已确认的玩家角色。",
        );
      }
      const abilityChanges: SimulationTtrpgRestReceiptV2["abilityChanges"] =
        Object.entries(product.abilityStates).flatMap(([stateKey, before]) => {
          if (!actorKeys.includes(before.actorInstanceId)) return [];
          const action = rulePack.actions.find(
            (item) => item.key === before.abilityKey,
          );
          if (!action?.usage.reset.includes(kind)) return [];
          return [
            {
              stateKey,
              actorKey: before.actorInstanceId,
              abilityKey: before.abilityKey,
              before: structuredClone(before),
              after: resetTtrpgAbilityUsageV2({
                definition: {
                  abilityKey: action.key,
                  actionDefinitionKey: action.key,
                  usage: action.usage,
                },
                state: before,
                trigger: kind,
                eventId: `event.${sequence}`,
              }),
            },
          ];
        });
      const receipt: SimulationTtrpgRestReceiptV2 = {
        schema: "storyforge.ttrpg-rest-receipt",
        version: 2,
        eventSequence: sequence,
        restKey,
        kind,
        actorKeys,
        completedBy: gmKey,
        reason,
        abilityChanges,
      };
      return {
        actorKey: gmKey,
        targetKey: restKey,
        payload: { receipt, rulePack },
      };
    },
  });
}

/**
 * The only commit gate for AI/hybrid player candidates. The mechanical action
 * is re-derived by RulePack after verifying the exact Instance-owned durable
 * checkpoint and, for hybrid seats, a human confirmation event.
 */
export async function commitTtrpgPlayerActionFromHarnessV1(input: {
  sessionId: number;
  runId: number;
  candidateHash: string;
}): Promise<SimulationEvent> {
  if (
    !Number.isInteger(input.runId) ||
    input.runId < 1 ||
    !/^[0-9a-f]{64}$/.test(input.candidateHash)
  ) {
    throw new Error("[ttrpg] AI 玩家候选授权无效。");
  }
  const session = await db.simulationSessions.get(input.sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.worldId == null ||
    session.workId == null
  ) {
    throw new Error("[ttrpg] AI 玩家运行缺少正式工作区 owner。");
  }
  const scope = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
  };
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  // These readers each use their own verified Dexie boundary; keep them
  // sequential so nested read transactions cannot outlive one another.
  const run = await readInstanceAgentRunV1(scope, input.runId);
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    scope,
    input.runId,
    { owner: "instance" },
  );
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const candidate = checkpoint?.resumePayload;
  if (
    !isObject(candidate) ||
    candidate.schema !== "storyforge.ttrpg-player-action-candidate" ||
    candidate.version !== 1 ||
    candidate.portable !== false ||
    candidate.runId !== input.runId ||
    candidate.simulationSessionId !== input.sessionId ||
    candidate.candidateHash !== input.candidateHash ||
    typeof candidate.actorKey !== "string" ||
    typeof candidate.seatKey !== "string" ||
    typeof candidate.viewerKey !== "string" ||
    typeof candidate.actionKey !== "string" ||
    typeof candidate.approach !== "string" ||
    typeof candidate.contextManifestHash !== "string" ||
    typeof candidate.baseSequence !== "number" ||
    typeof candidate.stateHash !== "string"
  ) {
    throw new Error("[ttrpg] AI 玩家检查点候选无效。");
  }
  const { candidateHash: _candidateHash, ...candidateBody } = candidate;
  const expectedCandidateHash = await (
    await import("../agent/run/hash")
  ).hashCanonicalValue(candidateBody);
  if (
    expectedCandidateHash !== input.candidateHash ||
    run.run.simulationSessionId !== input.sessionId ||
    run.contract.permissions.contextSourceKeys.length !== 1 ||
    run.contract.permissions.contextSourceKeys[0] !== "ttrpgPlayerRuntime" ||
    run.contract.scope.runtime?.simulationSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== candidate.baseSequence ||
    run.contract.scope.runtime.stateHash !== candidate.stateHash
  ) {
    throw new Error("[ttrpg] AI 玩家 RunContract、上下文或候选哈希不一致。");
  }
  const seat = participants.find(
    (row) =>
      row.seatKey === candidate.seatKey && row.actorKey === candidate.actorKey,
  );
  if (
    !seat ||
    seat.viewerKey !== candidate.viewerKey ||
    seat.controller !== candidate.controller
  ) {
    throw new Error("[ttrpg] AI 玩家候选与当前席位不一致。");
  }
  const persisted = run.events.find(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === input.candidateHash,
  );
  if (!persisted || persisted.type !== "candidate.persisted")
    throw new Error("[ttrpg] AI 玩家候选没有持久化证据。");
  const hybrid = seat.controller === "hybrid";
  if (persisted.payload.requiresConfirmation !== hybrid) {
    throw new Error("[ttrpg] AI 玩家候选确认策略与席位控制权不一致。");
  }
  if (
    hybrid &&
    !run.events.some(
      (event) =>
        event.type === "confirmation.recorded" &&
        event.payload.candidateHash === input.candidateHash &&
        event.payload.decision === "adopt",
    )
  ) {
    throw new Error("[ttrpg] 混合席位行动候选尚未获得真人确认。");
  }
  return resolveTtrpgRuleActionWithAuthority({
    sessionId: input.sessionId,
    commandId: `ttrpg-ai-player:${input.runId}:${input.candidateHash.slice(0, 32)}`,
    baseSequence: Number(candidate.baseSequence),
    baseStateHash: String(candidate.stateHash),
    actionKey: String(candidate.actionKey),
    actorKey: String(candidate.actorKey),
    targetKey: candidate.targetKey == null ? null : String(candidate.targetKey),
    difficulty:
      candidate.defaultDifficulty == null
        ? undefined
        : Number(candidate.defaultDifficulty),
    situationalModifier: 0,
    actorAuthority: {
      source: hybrid ? "hybrid-confirmed" : "ai-player",
      viewerKey: String(candidate.viewerKey),
      runId: input.runId,
      candidateHash: input.candidateHash,
      contextManifestHash: String(candidate.contextManifestHash),
      approach: String(candidate.approach),
      spokenIntent:
        candidate.spokenIntent == null ? null : String(candidate.spokenIntent),
    },
  });
}

/**
 * The only commit gate for an AI/hybrid GM choosing an NPC's formal action.
 * The model may choose only an intent from the current GM projection; the
 * frozen RulePack still derives dice, effects, costs and turn advancement.
 */
export async function commitTtrpgGmActorActionFromHarnessV1(input: {
  sessionId: number;
  runId: number;
  candidateHash: string;
}): Promise<SimulationEvent> {
  if (
    !Number.isInteger(input.runId) ||
    input.runId < 1 ||
    !/^[0-9a-f]{64}$/.test(input.candidateHash)
  ) {
    throw new Error("[ttrpg] AI KP 角色行动候选授权无效。");
  }
  const session = await db.simulationSessions.get(input.sessionId);
  if (
    !session ||
    session.kind !== "ttrpg" ||
    session.worldId == null ||
    session.workId == null
  ) {
    throw new Error("[ttrpg] AI KP 运行缺少正式工作区 owner。");
  }
  const scope = {
    projectId: session.projectId,
    worldId: session.worldId,
    workId: session.workId,
  };
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  const run = await readInstanceAgentRunV1(scope, input.runId);
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    scope,
    input.runId,
    { owner: "instance" },
  );
  const participants = await readTtrpgSessionParticipantsV2(input.sessionId);
  const candidate = checkpoint?.resumePayload;
  if (
    !isObject(candidate) ||
    candidate.schema !== "storyforge.ttrpg-gm-actor-action-candidate" ||
    candidate.version !== 1 ||
    candidate.portable !== false ||
    candidate.runId !== input.runId ||
    candidate.simulationSessionId !== input.sessionId ||
    candidate.candidateHash !== input.candidateHash ||
    typeof candidate.actorKey !== "string" ||
    typeof candidate.viewerKey !== "string" ||
    typeof candidate.actionKey !== "string" ||
    typeof candidate.approach !== "string" ||
    typeof candidate.contextManifestHash !== "string" ||
    typeof candidate.baseSequence !== "number" ||
    typeof candidate.stateHash !== "string"
  ) {
    throw new Error("[ttrpg] AI KP 角色行动检查点候选无效。");
  }
  const { candidateHash: _candidateHash, ...candidateBody } = candidate;
  const expectedCandidateHash = await (
    await import("../agent/run/hash")
  ).hashCanonicalValue(candidateBody);
  if (
    expectedCandidateHash !== input.candidateHash ||
    run.run.simulationSessionId !== input.sessionId ||
    run.contract.permissions.contextSourceKeys.length !== 1 ||
    run.contract.permissions.contextSourceKeys[0] !== "ttrpgRuntime" ||
    run.contract.scope.runtime?.simulationSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== candidate.baseSequence ||
    run.contract.scope.runtime.stateHash !== candidate.stateHash
  ) {
    throw new Error(
      "[ttrpg] AI KP 角色行动 RunContract、上下文或候选哈希不一致。",
    );
  }
  const gmSeat = participants.find((row) => row.role === "gm");
  if (
    !gmSeat ||
    gmSeat.viewerKey !== candidate.viewerKey ||
    gmSeat.controller !== candidate.controller
  ) {
    throw new Error("[ttrpg] AI KP 候选与当前 GM 席位不一致。");
  }
  const persisted = run.events.find(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === input.candidateHash,
  );
  if (!persisted || persisted.type !== "candidate.persisted") {
    throw new Error("[ttrpg] AI KP 角色行动候选没有持久化证据。");
  }
  const hybrid = gmSeat.controller === "hybrid";
  if (persisted.payload.requiresConfirmation !== hybrid) {
    throw new Error("[ttrpg] AI KP 候选确认策略与 GM 控制权不一致。");
  }
  if (
    hybrid &&
    !run.events.some(
      (event) =>
        event.type === "confirmation.recorded" &&
        event.payload.candidateHash === input.candidateHash &&
        event.payload.decision === "adopt",
    )
  ) {
    throw new Error("[ttrpg] 混合 GM 角色行动候选尚未获得真人确认。");
  }
  return resolveTtrpgRuleActionWithAuthority({
    sessionId: input.sessionId,
    commandId: `ttrpg-ai-gm-actor:${input.runId}:${input.candidateHash.slice(0, 32)}`,
    baseSequence: Number(candidate.baseSequence),
    baseStateHash: String(candidate.stateHash),
    actionKey: String(candidate.actionKey),
    actorKey: String(candidate.actorKey),
    targetKey: candidate.targetKey == null ? null : String(candidate.targetKey),
    difficulty:
      candidate.defaultDifficulty == null
        ? undefined
        : Number(candidate.defaultDifficulty),
    situationalModifier: 0,
    actorAuthority: {
      source: hybrid ? "hybrid-gm-confirmed" : "ai-gm-npc",
      viewerKey: String(candidate.viewerKey),
      runId: input.runId,
      candidateHash: input.candidateHash,
      contextManifestHash: String(candidate.contextManifestHash),
      approach: String(candidate.approach),
      spokenIntent:
        candidate.spokenIntent == null ? null : String(candidate.spokenIntent),
    },
  });
}

/**
 * Commit author-confirmed GM prose for one already-resolved formal action.
 * This command never changes dice, resources, conditions, turns, clues, or
 * scene progression; those remain owned by RulePack commands.
 */
export async function commitTtrpgGmNarrationFromHarnessV1(
  input: FormalTtrpgCommandEnvelope & {
    runId: number;
    candidateHash: string;
    actionSequence: number;
    text: string;
    synthesisFrame: import("../types").SimulationTtrpgGmSynthesisFrameV2;
  },
): Promise<SimulationEvent> {
  const runId = input.runId;
  const candidateHash = input.candidateHash.trim();
  const actionSequence = input.actionSequence;
  const narration = input.text.trim();
  if (
    !Number.isInteger(runId) ||
    runId < 1 ||
    !/^[0-9a-f]{64}$/.test(candidateHash) ||
    !Number.isInteger(actionSequence) ||
    actionSequence < 1 ||
    !narration ||
    narration.length > 20_000
  ) {
    throw new Error("[ttrpg] AI GM 候选授权或叙事无效。");
  }

  // A formal narration is accepted only after the Instance-owned durable Run
  // recorded an explicit author confirmation for the exact candidate hash.
  const session = await db.simulationSessions.get(input.sessionId);
  if (!session || session.worldId == null || session.workId == null) {
    throw new Error("[ttrpg] AI GM 运行缺少正式工作区 owner。");
  }
  const { readInstanceAgentRunV1 } = await import("../agent/run/event-store");
  const run = await readInstanceAgentRunV1(
    {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    runId,
  );
  if (
    run.run.simulationSessionId !== input.sessionId ||
    run.contract.scope.runtime?.simulationSessionId !== input.sessionId ||
    run.contract.scope.runtime.baseSequence !== input.baseSequence ||
    run.contract.scope.runtime.stateHash !== input.baseStateHash
  ) {
    throw new Error("[ttrpg] AI GM RunContract 与当前战役基线不一致。");
  }
  const persisted = run.events.some(
    (event) =>
      event.type === "candidate.persisted" &&
      event.payload.candidateHash === candidateHash &&
      event.payload.requiresConfirmation,
  );
  const confirmed = run.events.some(
    (event) =>
      event.type === "confirmation.recorded" &&
      event.payload.candidateHash === candidateHash &&
      event.payload.decision === "adopt",
  );
  if (!persisted || !confirmed)
    throw new Error("[ttrpg] AI GM 候选尚未获得作者确认。");
  const { readLatestVerifiedAgentRunCheckpointV1 } =
    await import("../agent/run/checkpoint");
  const checkpoint = await readLatestVerifiedAgentRunCheckpointV1(
    {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    runId,
    { owner: "instance" },
  );
  const frozenCandidate = checkpoint?.resumePayload;
  if (
    !isObject(frozenCandidate) ||
    frozenCandidate.candidateHash !== candidateHash ||
    frozenCandidate.runId !== runId ||
    frozenCandidate.simulationSessionId !== input.sessionId ||
    frozenCandidate.baseSequence !== input.baseSequence ||
    frozenCandidate.stateHash !== input.baseStateHash ||
    frozenCandidate.actionSequence !== actionSequence ||
    frozenCandidate.narration !== narration ||
    stableJson(frozenCandidate.synthesisFrame) !==
      stableJson(input.synthesisFrame)
  ) {
    throw new Error("[ttrpg] AI GM 提交内容与已确认候选不一致。");
  }
  const modelEvidence = parseTtrpgModelEvidenceV1(
    frozenCandidate.modelEvidence,
  );
  const modelCalls = Array.isArray(frozenCandidate.modelCalls)
    ? frozenCandidate.modelCalls
        .map(parseTtrpgModelEvidenceV1)
        .filter((item): item is SimulationTtrpgModelEvidenceV1 => item != null)
    : modelEvidence
      ? [modelEvidence]
      : [];
  const repairApplied = isObject(frozenCandidate.repairEvidence);
  if (modelCalls.length > 2)
    throw new Error("[ttrpg] AI GM 模型调用证据超过固定预算。");

  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: { runId, candidateHash, actionSequence, text: narration },
    build: async ({ state }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== actionSequence
      ) {
        throw new Error("[ttrpg] AI GM 候选没有绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] AI GM 综合反馈缺少 ActionReceipt。");
        })();
      const synthesisFrame = parseTtrpgGmSynthesisFrameV2(
        input.synthesisFrame,
        receipt,
      );
      return {
        actorKey: null,
        targetKey: latest.actorKey,
        payload: {
          actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: narration,
          candidateHash,
          runId,
          modelEvidence,
          modelCalls,
          repairApplied,
          synthesisFrame,
          source: "ai-confirmed",
        },
      };
    },
  });
}

/**
 * Commit prose written by the authenticated human GM for the latest resolved
 * RulePack action. Human narration is first-class campaign history, but it is
 * never allowed to alter dice, resources, conditions, clues, turns or scenes.
 */
export async function commitTtrpgHumanGmNarrationV1(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
    text: string;
    gmKey: string;
  },
): Promise<SimulationEvent> {
  const actionSequence = input.actionSequence;
  const narration = input.text.trim().normalize("NFC");
  const gmKey = input.gmKey.trim();
  if (
    !Number.isInteger(actionSequence) ||
    actionSequence < 1 ||
    !narration ||
    narration.length > 20_000 ||
    !gmKey ||
    gmKey.length > 160
  ) {
    throw new Error("[ttrpg] 真人 GM 叙事输入无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: { actionSequence, text: narration, gmKey, source: "human-gm" },
    build: async ({ state }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== actionSequence
      ) {
        throw new Error("[ttrpg] 真人 GM 叙事必须绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      assertTtrpgFeedbackOutcomeConsistentV2(narration, latest.outcome);
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] 真人 GM 综合反馈缺少 ActionReceipt。");
        })();
      return {
        actorKey: gmKey,
        targetKey: latest.actorKey,
        payload: {
          actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: narration,
          candidateHash: null,
          runId: null,
          source: "human-gm",
          synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        },
      };
    },
  });
}

function deterministicTtrpgNarrationV1(
  state: SimulationRuntimeState,
  action: import("../types").SimulationTtrpgRuleActionResultV1,
  rulePack: ReturnType<typeof parseRulePackV1>,
): string {
  const actorName = state.entities[action.actorKey]?.name ?? action.actorKey;
  const degreeLabels = {
    automatic: "规则自动生效",
    "critical-failure": "严重失败",
    failure: "失败，但场景仍可继续推进",
    "partial-success": "部分成功，并伴随代价",
    success: "成功",
    "hard-success": "困难成功",
    "extreme-success": "极难成功",
    "critical-success": "卓越成功",
  } as const;
  const parts = [
    `${actorName}执行「${action.actionName}」：${degreeLabels[action.outcome]}。`,
  ];
  if (action.check) {
    const signedModifier =
      action.check.modifier === 0
        ? ""
        : action.check.modifier > 0
          ? ` + ${action.check.modifier}`
          : ` - ${Math.abs(action.check.modifier)}`;
    parts.push(
      `检定 ${action.check.dice.join(" + ")}${signedModifier} = ${action.check.total}，难度 ${action.check.dc}。`,
    );
  }
  if (action.resourceChanges.length) {
    parts.push(
      action.resourceChanges
        .map((change) => {
          const targetName =
            state.entities[change.entityKey]?.name ?? change.entityKey;
          const resourceName =
            rulePack.resources.find((item) => item.key === change.resourceKey)
              ?.name ?? change.resourceKey;
          return `${targetName}的${resourceName}由 ${change.before} 变为 ${change.after}`;
        })
        .join("；") + "。",
    );
  }
  if (action.conditionChanges.length) {
    parts.push(
      action.conditionChanges
        .map((change) => {
          const targetName =
            state.entities[change.entityKey]?.name ?? change.entityKey;
          const conditionName =
            rulePack.conditions.find((item) => item.key === change.conditionKey)
              ?.name ?? change.conditionKey;
          return change.stacks > 0
            ? `${targetName}获得${conditionName}×${change.stacks}`
            : `${targetName}移除${conditionName}`;
        })
        .join("；") + "。",
    );
  }
  if (action.nextActorKey)
    parts.push(
      `接下来轮到${state.entities[action.nextActorKey]?.name ?? action.nextActorKey}。`,
    );
  return parts.join("");
}

/**
 * Code-owned fallback used when the model is unavailable or deliberately
 * disabled. It derives every claim from the already committed RulePack result
 * and, like AI prose, cannot mutate rules, permissions, clues or scene flow.
 */
export async function commitTtrpgDeterministicFallbackV1(
  input: FormalTtrpgCommandEnvelope & {
    actionSequence: number;
  },
): Promise<SimulationEvent> {
  if (!Number.isInteger(input.actionSequence) || input.actionSequence < 1) {
    throw new Error("[ttrpg] 确定性旁白动作序号无效。");
  }
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.gm.response.recorded",
    intent: {
      actionSequence: input.actionSequence,
      source: "deterministic-fallback",
    },
    build: async ({ state, rulePack }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      const latest = product?.actionHistory[product.actionHistory.length - 1];
      if (
        !product ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active" ||
        latest?.eventSequence !== input.actionSequence
      ) {
        throw new Error("[ttrpg] 确定性旁白必须绑定最近的正式规则行动。");
      }
      if (
        product.gmNarrations.some(
          (item) => item.actionSequence === input.actionSequence,
        )
      ) {
        throw new Error("[ttrpg] 最近规则行动已经有正式 GM 叙事。");
      }
      const receipt =
        latest.receipt ??
        (() => {
          throw new Error("[ttrpg] 确定性综合反馈缺少 ActionReceipt。");
        })();
      return {
        actorKey: null,
        targetKey: latest.actorKey,
        payload: {
          actionSequence: input.actionSequence,
          checkSequence: latest.check?.eventSequence ?? null,
          text: deterministicTtrpgNarrationV1(state, latest, rulePack),
          candidateHash: null,
          runId: null,
          source: "deterministic-fallback",
          synthesisFrame: createDeterministicGmSynthesisFrameV2(receipt),
        },
      };
    },
  });
}

export async function completeTtrpgCampaignEnding(
  input: FormalTtrpgCommandEnvelope & {
    endingKey: string;
    completedBy: string;
  },
): Promise<SimulationEvent> {
  const endingKey = input.endingKey.trim();
  const completedBy = input.completedBy.trim();
  return appendFormalTtrpgCommand({
    ...input,
    type: "ttrpg.campaign.ended",
    intent: { endingKey, completedBy },
    build: async ({ state, campaign }) => {
      const ttrpg = state.ttrpg;
      const product = ttrpg?.product;
      if (
        !product ||
        product.ending ||
        !ttrpg?.scene ||
        ttrpg.scene.status !== "active"
      ) {
        throw new Error("[ttrpg] 正式战役当前不能提交结局。");
      }
      if (!completedBy || completedBy.length > 160)
        throw new Error("[ttrpg] 战役结局提交者无效。");
      const currentScene = campaign.scenes.find(
        (item) => item.sceneKey === ttrpg.scene?.sceneKey,
      );
      if (!currentScene || currentScene.nextSceneKeys.length > 0) {
        throw new Error(
          "[ttrpg] 只有冻结 CampaignPack 的终局场景可以选择结局。",
        );
      }
      const ending = campaign.endings.find(
        (item) => item.endingKey === endingKey,
      );
      if (!ending) throw new Error("[ttrpg] 结局不属于冻结 CampaignPack。");
      const knownConclusions = new Set(
        product.discoveredClues.flatMap((discovery) => {
          const clue = product.clueCatalog.find(
            (item) => item.clueKey === discovery.clueKey,
          );
          return clue ? [clue.conclusionKey] : [];
        }),
      );
      if (ending.trigger) {
        if (
          ending.trigger.sceneKey !== currentScene.sceneKey ||
          ending.trigger.requiredConclusionKeys.some(
            (key) => !knownConclusions.has(key),
          ) ||
          ending.trigger.forbiddenConclusionKeys.some((key) =>
            knownConclusions.has(key),
          )
        ) {
          throw new Error("[ttrpg] 当前场景与已发现结论不满足该结局触发条件。");
        }
      } else if (
        product.questProgress.some((quest) => quest.status !== "completed")
      ) {
        throw new Error("[ttrpg] 仍有主线结论未完成，不能选择旧版结局。");
      }
      const awardedMilestones = product.advancement.milestones
        .filter(
          (item, index) =>
            !product.advancement.awardedMilestoneKeys.includes(
              item.milestoneKey,
            ) && product.questProgress[index]?.status === "completed",
        )
        .map((item) => ({
          milestoneKey: item.milestoneKey,
          award: item.award,
        }));
      return {
        actorKey: completedBy,
        targetKey: endingKey,
        payload: {
          endingKey,
          title: ending.title,
          epilogue: ending.epilogue,
          awardedMilestones,
        },
      };
    },
  });
}

interface InteractionCommandEnvelope {
  sessionId: number;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}

async function appendInteractionCommand(
  input: InteractionCommandEnvelope & {
    type: Extract<SimulationEventType, `interaction.${string}`>;
    actorKey?: string | null;
    targetKey?: string | null;
    payload: JsonObject;
  },
): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0) {
    throw new Error("互动命令 baseSequence 无效。");
  }
  if (!/^[a-f0-9]{64}$/.test(baseStateHash))
    throw new Error("互动命令 baseStateHash 无效。");
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (!previewSession) throw new Error("模拟会话不存在。");
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replaySimulationEvents(
    parseSimulationState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewStateHash = await hashStateJson(JSON.stringify(previewState));
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (!session) throw new Error("模拟会话不存在。");
      if (
        session.kind !== "chatgame" &&
        session.kind !== "textadventure" &&
        session.kind !== "textworld"
      ) {
        throw new Error("角色互动命令只能写入带冻结互动状态的正式会话。");
      }
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      const commandPayload = {
        ...input.payload,
        commandId,
        baseSequence: input.baseSequence,
        baseStateHash,
      };
      if (prior) {
        if (
          prior.type !== input.type ||
          prior.baseSequence !== input.baseSequence ||
          prior.baseStateHash !== baseStateHash ||
          stableJson(parseEventPayload(prior)) !== stableJson(commandPayload)
        ) {
          throw new Error("互动命令 commandId 已被不同命令使用。");
        }
        return prior;
      }
      if (session.status !== "active")
        throw new Error("只有 active 会话可以提交互动命令。");
      const state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      if (!state.interaction)
        throw new Error("当前会话不是 CHATGAME-2 角色互动存档。");
      if (state.lastSequence !== input.baseSequence)
        throw new Error("互动状态已变化，请刷新后重试。");
      if (
        previewState.lastSequence !== state.lastSequence ||
        previewStateHash !== baseStateHash
      ) {
        throw new Error("互动状态哈希已变化，请刷新后重试。");
      }
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: state.lastSequence + 1,
        type: input.type,
        actorKey: input.actorKey ?? null,
        targetKey: input.targetKey ?? null,
        commandId,
        baseSequence: input.baseSequence,
        baseStateHash,
        payloadJson: JSON.stringify(commandPayload),
        createdAt: Date.now(),
      };
      applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      await db.simulationSessions.update(input.sessionId, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}

export async function startInteractionScene(
  input: InteractionCommandEnvelope & {
    sceneId: string;
    sceneKey: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.scene.started",
    targetKey: input.sceneKey.trim(),
    payload: { sceneId: input.sceneId.trim(), sceneKey: input.sceneKey.trim() },
  });
}

export async function endInteractionScene(
  input: InteractionCommandEnvelope & {
    sceneId: string;
    reason: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.scene.ended",
    targetKey: input.sceneId.trim(),
    payload: { sceneId: input.sceneId.trim(), reason: input.reason.trim() },
  });
}

export async function joinInteractionParticipant(
  input: InteractionCommandEnvelope & {
    participantKey: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.participant.joined",
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: { participantKey: input.participantKey.trim() },
  });
}

export async function leaveInteractionParticipant(
  input: InteractionCommandEnvelope & {
    participantKey: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.participant.left",
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: { participantKey: input.participantKey.trim() },
  });
}

export async function commitInteractionPlayerMessage(
  input: InteractionCommandEnvelope & {
    messageId: string;
    text: string;
    audienceKeys?: string[] | null;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.player.message.committed",
    actorKey: "player",
    payload: {
      messageId: input.messageId.trim(),
      text: input.text.trim(),
      audienceKeys: input.audienceKeys ?? null,
    },
  });
}

export async function commitInteractionCharacterReply(
  input: InteractionCommandEnvelope & {
    messageId: string;
    speakerKey: string;
    text: string;
    replyToSequence: number;
    audienceKeys?: string[] | null;
    supersedesSequence?: number | null;
    budgetCost?: number;
    disclosures?: Array<{
      knowledgeKey: string;
      toParticipantKeys: string[];
      evidenceExcerpt: string;
    }>;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.character.reply.committed",
    actorKey: input.speakerKey.trim(),
    targetKey: input.speakerKey.trim(),
    payload: {
      messageId: input.messageId.trim(),
      speakerKey: input.speakerKey.trim(),
      text: input.text.trim(),
      replyToSequence: input.replyToSequence,
      audienceKeys: input.audienceKeys ?? null,
      supersedesSequence: input.supersedesSequence ?? null,
      budgetCost: input.budgetCost ?? 0,
      disclosures: input.disclosures ?? [],
    },
  });
}

export async function proposeInteractionMemory(
  input: InteractionCommandEnvelope & {
    memoryId: string;
    participantKey: string;
    kind: InteractionMemoryKind;
    content: string;
    importance: number;
    sourceEventSequences: number[];
    evidenceExcerpt: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.memory.proposed",
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: {
      memoryId: input.memoryId.trim(),
      participantKey: input.participantKey.trim(),
      kind: input.kind,
      content: input.content.trim(),
      importance: input.importance,
      sourceEventSequences: input.sourceEventSequences,
      evidenceExcerpt: input.evidenceExcerpt.trim(),
    },
  });
}

export async function resolveInteractionMemory(
  input: InteractionCommandEnvelope & {
    memoryId: string;
    resolution: "accepted" | "rejected";
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type:
      input.resolution === "accepted"
        ? "interaction.memory.accepted"
        : "interaction.memory.rejected",
    targetKey: input.memoryId.trim(),
    payload: { memoryId: input.memoryId.trim() },
  });
}

export async function supersedeInteractionMemory(
  input: InteractionCommandEnvelope & {
    memoryId: string;
    supersededByMemoryId: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.memory.superseded",
    targetKey: input.memoryId.trim(),
    payload: {
      memoryId: input.memoryId.trim(),
      supersededByMemoryId: input.supersededByMemoryId.trim(),
    },
  });
}

export async function shareInteractionKnowledge(
  input: InteractionCommandEnvelope & {
    knowledgeKey: string;
    fromParticipantKey: string;
    toParticipantKeys: string[];
    sourceEventSequence: number;
    evidenceExcerpt: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.knowledge.shared",
    actorKey: input.fromParticipantKey.trim(),
    payload: {
      knowledgeKey: input.knowledgeKey.trim(),
      fromParticipantKey: input.fromParticipantKey.trim(),
      toParticipantKeys: input.toParticipantKeys,
      sourceEventSequence: input.sourceEventSequence,
      evidenceExcerpt: input.evidenceExcerpt.trim(),
    },
  });
}

export async function changeInteractionRelationship(
  input: InteractionCommandEnvelope & {
    fromParticipantKey: string;
    toParticipantKey: string;
    dimensionKey: string;
    delta: number;
    reason: string;
    ruleKey: string;
    sourceEventSequence: number;
    significantEventKey?: string | null;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.relationship.changed",
    actorKey: input.fromParticipantKey.trim(),
    targetKey: input.toParticipantKey.trim(),
    payload: {
      fromParticipantKey: input.fromParticipantKey.trim(),
      toParticipantKey: input.toParticipantKey.trim(),
      dimensionKey: input.dimensionKey.trim(),
      delta: input.delta,
      reason: input.reason.trim(),
      ruleKey: input.ruleKey.trim(),
      sourceEventSequence: input.sourceEventSequence,
      significantEventKey: input.significantEventKey?.trim() || null,
    },
  });
}

export async function openInteractionThread(
  input: InteractionCommandEnvelope & {
    threadKey: string;
    title: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.thread.opened",
    targetKey: input.threadKey.trim(),
    payload: { threadKey: input.threadKey.trim(), title: input.title.trim() },
  });
}

export async function resolveInteractionThread(
  input: InteractionCommandEnvelope & {
    threadKey: string;
    resolution: string;
  },
): Promise<SimulationEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.thread.resolved",
    targetKey: input.threadKey.trim(),
    payload: {
      threadKey: input.threadKey.trim(),
      resolution: input.resolution.trim(),
    },
  });
}

export interface NarrativeChoiceCommitResultV1 {
  event: SimulationEvent;
  state: SimulationRuntimeState;
  appendedEvents: SimulationEvent[];
}

async function commitNarrativeChoiceWithState(input: {
  sessionId: number;
  choiceKey: string;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<NarrativeChoiceCommitResultV1> {
  const commandId = normalizeCommandId(input.commandId);
  const choiceKey = input.choiceKey.trim();
  const baseStateHash = input.baseStateHash.trim();
  if (!choiceKey || choiceKey.length > 200)
    throw new Error("请选择有效的 Choice。");
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0)
    throw new Error("选择 baseSequence 无效。");
  if (!/^[a-f0-9]{64}$/.test(baseStateHash))
    throw new Error("选择 baseStateHash 无效。");
  // Hashing a long replayed state is external async work. Resolve it before
  // entering the write transaction; Dexie transaction zones must not span
  // browser crypto promises or they can become inactive/intermittently hang.
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (!previewSession) throw new Error("模拟会话不存在。");
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replaySimulationEvents(
    parseSimulationState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewStateHash = await hashStateJson(JSON.stringify(previewState));
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (!session) throw new Error("模拟会话不存在。");
      const prior = await db.simulationEvents
        .where("[sessionId+commandId]")
        .equals([input.sessionId, commandId])
        .first();
      if (prior) {
        const payload = parseEventPayload(prior);
        if (
          prior.type !== "narrative.choice.committed" ||
          payload.choiceKey !== choiceKey ||
          prior.baseSequence !== input.baseSequence ||
          prior.baseStateHash !== baseStateHash
        ) {
          throw new Error("选择 commandId 已被不同命令使用。");
        }
        const previewContainsPrior = previewEvents.some(
          (event) => event.id === prior.id,
        );
        const currentState = previewContainsPrior
          ? previewState
          : replaySimulationEvents(
              parseSimulationState(session.initialStateJson),
              await readSessionEvents(session),
            );
        return { event: prior, state: currentState, appendedEvents: [] };
      }
      if (session.status !== "active")
        throw new Error("只有 active 会话可以提交选择。");
      const latest = await db.simulationEvents
        .where("[sessionId+sequence]")
        .between(
          [input.sessionId, Dexie.minKey],
          [input.sessionId, Dexie.maxKey],
        )
        .last();
      const latestSequence = latest?.sequence ?? 0;
      if (
        latestSequence !== input.baseSequence ||
        previewState.lastSequence !== input.baseSequence
      ) {
        throw new Error("叙事分支已变化，请刷新后重试。");
      }
      if (
        previewSession.id !== session.id ||
        previewStateHash !== baseStateHash
      ) {
        throw new Error("叙事状态已变化，请刷新后重试。");
      }
      const state = previewState;
      const narrative = state.narrative;
      if (
        !narrative ||
        narrative.version !== 2 ||
        narrative.completed ||
        !narrative.currentNodeKey
      ) {
        throw new Error("当前会话没有可提交选择的 GameRelease 叙事。");
      }
      if (!narrative.availableChoiceKeys?.includes(choiceKey))
        throw new Error("所选 Choice 当前不可用。");
      const choice = narrative.choices?.find(
        (item) => item.choiceKey === choiceKey,
      );
      if (!choice || choice.sourceNodeKey !== narrative.currentNodeKey)
        throw new Error("所选 Choice 不属于当前节点。");
      if (session.kind === "avg") {
        const nodeBeats = (narrative.beats ?? [])
          .filter((beat) => beat.nodeKey === narrative.currentNodeKey)
          .sort(
            (a, b) => a.order - b.order || a.beatKey.localeCompare(b.beatKey),
          );
        const reachedIndex =
          state.presentation?.currentNodeKey === narrative.currentNodeKey &&
          state.presentation.currentBeatKey
            ? nodeBeats.findIndex(
                (beat) => beat.beatKey === state.presentation!.currentBeatKey,
              )
            : -1;
        const unread = nodeBeats.slice(reachedIndex + 1);
        if (unread.length)
          throw new Error("[avg] 必须先读完当前节点的全部 Beat 才能选择。");
      }
      const adventureActionTags = choice.tags.filter((tag) =>
        tag.startsWith("adventure-action:"),
      );
      if (
        (session.kind === "textadventure" || session.kind === "textworld") &&
        adventureActionTags.length
      ) {
        if (adventureActionTags.length !== 1 || !state.adventure) {
          throw new Error("[adventure] Narrative Choice 公共行动绑定无效。");
        }
        const actionKey = adventureActionTags[0].slice(
          "adventure-action:".length,
        );
        const requiredCommandId = adventureNarrativeActionCommandId(
          session.id!,
          choiceKey,
        );
        if (
          !state.adventure.actionHistory.some(
            (item) =>
              item.actionKey === actionKey &&
              item.commandId === requiredCommandId,
          )
        ) {
          throw new Error(
            "[adventure] Narrative Choice 必须先通过公共 Adventure 行动桥接。",
          );
        }
      }
      const event: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: state.lastSequence + 1,
        type: "narrative.choice.committed",
        actorKey: null,
        targetKey: choice.targetNodeKey,
        commandId,
        baseSequence: input.baseSequence,
        baseStateHash,
        payloadJson: JSON.stringify({
          commandId,
          baseSequence: input.baseSequence,
          baseStateHash,
          fromNodeKey: narrative.currentNodeKey,
          choiceKey,
          toNodeKey: choice.targetNodeKey,
        }),
        createdAt: Date.now(),
      };
      let projected = applySimulationEvent(state, event);
      event.id = (await db.simulationEvents.add(event)) as number;
      const enteredEvent: SimulationEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: input.sessionId,
        sequence: event.sequence + 1,
        type: "narrative.node.entered",
        actorKey: null,
        targetKey: choice.targetNodeKey,
        payloadJson: JSON.stringify({
          nodeKey: choice.targetNodeKey,
          causeSequence: event.sequence,
        }),
        createdAt: event.createdAt,
      };
      projected = applySimulationEvent(projected, enteredEvent);
      enteredEvent.id = (await db.simulationEvents.add(enteredEvent)) as number;
      let lastEvent = enteredEvent;
      const appendedEvents = [event, enteredEvent];
      if (projected.narrative?.completed) {
        const endingEvent: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: input.sessionId,
          sequence: enteredEvent.sequence + 1,
          type: "narrative.ending.reached",
          actorKey: null,
          targetKey: choice.targetNodeKey,
          payloadJson: JSON.stringify({
            endingKey: choice.targetNodeKey,
            enteredSequence: enteredEvent.sequence,
          }),
          createdAt: event.createdAt,
        };
        projected = applySimulationEvent(projected, endingEvent);
        endingEvent.id = (await db.simulationEvents.add(endingEvent)) as number;
        lastEvent = endingEvent;
        appendedEvents.push(endingEvent);
      }
      await db.simulationSessions.update(input.sessionId, {
        updatedAt: lastEvent.createdAt,
      });
      return { event, state: projected, appendedEvents };
    },
  );
}

export async function commitNarrativeChoiceWithStateV1(input: {
  sessionId: number;
  choiceKey: string;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<NarrativeChoiceCommitResultV1> {
  return commitNarrativeChoiceWithState(input);
}

export async function commitNarrativeChoice(input: {
  sessionId: number;
  choiceKey: string;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<SimulationEvent> {
  return (await commitNarrativeChoiceWithState(input)).event;
}

function adventureNarrativeActionCommandId(
  sessionId: number,
  choiceKey: string,
): string {
  return normalizeCommandId(`choice-action:${sessionId}:${choiceKey}`);
}

function adventureNarrativeChoiceCommandId(
  sessionId: number,
  choiceKey: string,
): string {
  return normalizeCommandId(`choice-commit:${sessionId}:${choiceKey}`);
}

/**
 * Executes the deliberately small Narrative -> Adventure public-action bridge.
 * Both phases use stable command ids, so a crash between the action and the
 * choice is recoverable by calling this function again without duplicating an
 * item, quest effect, or ending transition.
 */
export async function commitAdventureNarrativeChoice(input: {
  sessionId: number;
  choiceKey: string;
  commandId?: string;
}): Promise<SimulationEvent> {
  const choiceKey = input.choiceKey.trim();
  if (!choiceKey)
    throw new Error("[adventure] Narrative Choice key 不能为空。");
  const session = await db.simulationSessions.get(input.sessionId);
  if (
    !session ||
    (session.kind !== "textadventure" && session.kind !== "textworld") ||
    (session.gameReleaseId == null && session.gameBuildId == null)
  ) {
    throw new Error("[adventure] 正式文字冒险实例不存在。");
  }
  const frozen = await verifyFormalPlayableSourceV1(session, [
    "text-adventure",
    "text-open-world",
  ]);
  if (!frozen.runtimePackage.adventure) {
    throw new Error("[adventure] 冻结 Product RuntimePackage 缺少冒险模块。");
  }
  const bridgeChoiceCommandId = adventureNarrativeChoiceCommandId(
    session.id!,
    choiceKey,
  );
  const existingEvents = await readSessionEvents(session);
  let state = replaySimulationEvents(
    parseSimulationState(session.initialStateJson),
    existingEvents,
  );
  const choice = state.narrative?.choices?.find(
    (item) => item.choiceKey === choiceKey,
  );
  if (!choice || choice.sourceNodeKey !== state.narrative?.currentNodeKey) {
    const prior = existingEvents.find((event) => {
      if (event.type !== "narrative.choice.committed") return false;
      const payload = parseEventPayload(event);
      return (
        payload.choiceKey === choiceKey &&
        (event.commandId === bridgeChoiceCommandId ||
          (input.commandId != null &&
            event.commandId === normalizeCommandId(input.commandId)))
      );
    });
    if (prior) return prior;
    throw new Error("[adventure] Narrative Choice 不属于当前节点。");
  }
  const actionTags = choice.tags.filter((tag) =>
    tag.startsWith("adventure-action:"),
  );
  if (actionTags.length > 1)
    throw new Error("[adventure] Narrative Choice 只能绑定一个公共行动。");
  const choiceCommandId =
    actionTags.length === 1
      ? bridgeChoiceCommandId
      : normalizeCommandId(input.commandId ?? "");
  const priorChoice = existingEvents.find(
    (event) => event.commandId === choiceCommandId,
  );
  if (priorChoice) {
    const payload = parseEventPayload(priorChoice);
    if (
      priorChoice.type !== "narrative.choice.committed" ||
      payload.choiceKey !== choiceKey
    ) {
      throw new Error(
        "[adventure] Narrative Choice commandId 已被不同命令使用。",
      );
    }
    return priorChoice;
  }
  if (actionTags.length === 1) {
    const actionKey = actionTags[0].slice("adventure-action:".length);
    const action = frozen.runtimePackage.adventure.actions.find(
      (item) => item.key === actionKey,
    );
    if (!action || action.narrativeChoiceKey !== choiceKey) {
      throw new Error(
        "[adventure] Narrative Choice 没有有效的冻结公共行动绑定。",
      );
    }
    const actionCommandId = adventureNarrativeActionCommandId(
      session.id!,
      choiceKey,
    );
    if (
      !state.adventure?.actionHistory.some(
        (item) =>
          item.actionKey === actionKey && item.commandId === actionCommandId,
      )
    ) {
      const baseStateHash = await hashStateJson(JSON.stringify(state));
      await commitAdventureAction({
        sessionId: session.id!,
        actionKey,
        commandId: actionCommandId,
        baseSequence: state.lastSequence,
        baseStateHash,
      });
      state = await readSimulationState(session.id!);
    }
  }
  const baseStateHash = await hashStateJson(JSON.stringify(state));
  return commitNarrativeChoice({
    sessionId: session.id!,
    choiceKey,
    commandId: choiceCommandId,
    baseSequence: state.lastSequence,
    baseStateHash,
  });
}

function proposalSequenceFromResolution(event: SimulationEvent): number | null {
  if (
    event.type !== "npc.evolution.accepted" &&
    event.type !== "npc.evolution.rejected"
  )
    return null;
  const payload = parseEventPayload(event);
  return Number.isInteger(payload.proposalSequence)
    ? Number(payload.proposalSequence)
    : null;
}

export function readPendingNpcEvolutionProposals(
  events: readonly SimulationEvent[],
): SimulationNpcEvolutionProposal[] {
  const resolved = new Set(
    events.flatMap((event) => {
      const sequence = proposalSequenceFromResolution(event);
      return sequence == null ? [] : [sequence];
    }),
  );
  return events
    .filter(
      (event) =>
        event.type === "npc.evolution.proposed" &&
        !resolved.has(event.sequence),
    )
    .map((event) => ({
      ...parseSimulationNpcEvolutionCandidate(
        parseEventPayload(event).candidate,
      ),
      proposalSequence: event.sequence,
    }))
    .sort((left, right) => left.proposalSequence - right.proposalSequence);
}

export async function appendNpcEvolutionProposal(input: {
  sessionId: number;
  candidate: SimulationNpcEvolutionCandidate;
}): Promise<SimulationEvent> {
  const candidate = parseSimulationNpcEvolutionCandidate(input.candidate);
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "npc-evolution") {
      throw new Error("NPC 演进候选只能写入 NPC 演进会话。");
    }
    if (candidate.baseSequence !== state.lastSequence) {
      throw new Error("NPC 演进生成期间会话已变化，请重新生成。");
    }
    prepareNpcEvolution(state, candidate);
    return {
      type: "npc.evolution.proposed",
      actorKey: candidate.entityKey,
      targetKey: candidate.entityKey,
      payloadJson: JSON.stringify({ candidate }),
    };
  });
}

export async function acceptNpcEvolutionProposal(input: {
  sessionId: number;
  proposalSequence: number;
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, state, events }) => {
    if (session.kind !== "npc-evolution")
      throw new Error("当前不是 NPC 演进会话。");
    const proposal = events.find(
      (event) =>
        event.sequence === input.proposalSequence &&
        event.type === "npc.evolution.proposed",
    );
    if (!proposal) throw new Error("NPC 演进提案不存在。");
    if (
      events.some(
        (event) =>
          proposalSequenceFromResolution(event) === input.proposalSequence,
      )
    ) {
      throw new Error("NPC 演进提案已经处理。");
    }
    if (state.lastSequence !== input.proposalSequence) {
      throw new Error("NPC 演进候选已过期，请重新生成。");
    }
    const candidate = parseSimulationNpcEvolutionCandidate(
      parseEventPayload(proposal).candidate,
    );
    return {
      type: "npc.evolution.accepted",
      actorKey: candidate.entityKey,
      targetKey: candidate.entityKey,
      payloadJson: JSON.stringify({
        proposalSequence: input.proposalSequence,
        candidate,
      }),
    };
  });
}

export async function rejectNpcEvolutionProposal(input: {
  sessionId: number;
  proposalSequence: number;
  reason?: string;
}): Promise<SimulationEvent> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 1_000) throw new Error("NPC 演进拒绝原因过长。");
  return appendBuiltEvent(input.sessionId, ({ session, events }) => {
    if (session.kind !== "npc-evolution")
      throw new Error("当前不是 NPC 演进会话。");
    const proposal = events.find(
      (event) =>
        event.sequence === input.proposalSequence &&
        event.type === "npc.evolution.proposed",
    );
    if (!proposal) throw new Error("NPC 演进提案不存在。");
    if (
      events.some(
        (event) =>
          proposalSequenceFromResolution(event) === input.proposalSequence,
      )
    ) {
      throw new Error("NPC 演进提案已经处理。");
    }
    return {
      type: "npc.evolution.rejected",
      actorKey: proposal.actorKey ?? null,
      targetKey: proposal.targetKey ?? null,
      payloadJson: JSON.stringify({
        proposalSequence: input.proposalSequence,
        reason,
      }),
    };
  });
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  return hash >>> 0;
}

function deterministicDie(seed: string, sides: number): number {
  return sampleTtrpgDiceFromUint32V2({
    count: 1,
    sides,
    nextUint32: (sampleIndex) => {
      let value = hash32(`${seed}\u0000${sampleIndex}`);
      value += 0x6d2b79f5;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return (value ^ (value >>> 14)) >>> 0;
    },
  }).dice[0];
}

function parseDiceExpression(expression: string): {
  normalized: string;
  count: number;
  sides: number;
  modifier: number;
} {
  return parseTtrpgDiceExpressionV2(expression);
}

function assertDiceResolution(value: unknown): DiceResolution {
  if (!isObject(value)) throw new Error("随机判定结果必须是对象。");
  const parsed = parseDiceExpression(String(value.expression ?? ""));
  if (!Array.isArray(value.dice) || value.dice.length !== parsed.count) {
    throw new Error("随机判定骰子数量与骰式不一致。");
  }
  const dice = value.dice.map((die) =>
    assertFiniteInteger(die, "骰子点数", 1, parsed.sides),
  );
  const modifier = Number(value.modifier);
  const total = Number(value.total);
  if (
    modifier !== parsed.modifier ||
    total !== dice.reduce((sum, die) => sum + die, modifier)
  ) {
    throw new Error("随机判定合计与骰式不一致。");
  }
  return {
    expression: parsed.normalized,
    dice,
    modifier,
    total,
    nonce: String(value.nonce ?? ""),
  };
}

function buildDiceResolution(input: {
  seed: string;
  sequence: number;
  expression: ReturnType<typeof parseDiceExpression>;
  nonce: string;
}): DiceResolution {
  const dice = Array.from({ length: input.expression.count }, (_, index) =>
    deterministicDie(
      `${input.seed}\u0000${input.sequence}\u0000${input.expression.normalized}\u0000${input.nonce}\u0000${index}`,
      input.expression.sides,
    ),
  );
  return {
    expression: input.expression.normalized,
    dice,
    modifier: input.expression.modifier,
    total: dice.reduce((sum, die) => sum + die, input.expression.modifier),
    nonce: input.nonce,
  };
}

export async function resolveSimulationDice(input: {
  sessionId: number;
  expression: string;
  nonce?: string;
  actorKey?: string | null;
  targetKey?: string | null;
}): Promise<SimulationEvent> {
  const parsed = parseDiceExpression(input.expression);
  const nonce = input.nonce?.trim() ?? "";
  if (nonce.length > 200) throw new Error("随机判定 nonce 过长。");
  return appendBuiltEvent(input.sessionId, ({ session, sequence }) => {
    const resolution = buildDiceResolution({
      seed: session.seed,
      sequence,
      expression: parsed,
      nonce,
    });
    return {
      type: "random.resolved",
      actorKey: input.actorKey ?? null,
      targetKey: input.targetKey ?? null,
      payloadJson: JSON.stringify(resolution),
    };
  });
}

export interface AdventureCommandEnvelope {
  sessionId: number;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  actionKey: string;
}

function adventureEvent(
  session: SimulationSession,
  sequence: number,
  type: SimulationEventType,
  payload: Record<string, unknown>,
  envelope?: Pick<
    AdventureCommandEnvelope,
    "commandId" | "baseSequence" | "baseStateHash"
  >,
): SimulationEvent {
  return {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    sequence,
    type,
    actorKey: "player",
    targetKey: null,
    commandId: envelope?.commandId ?? null,
    baseSequence: envelope?.baseSequence ?? null,
    baseStateHash: envelope?.baseStateHash ?? null,
    payloadJson: JSON.stringify(payload),
    createdAt: Date.now(),
  };
}

function adventureEffectsForOutcome(
  action: import("../types").AdventureActionDefinition,
  outcome: import("../types").AdventureCheckOutcome,
) {
  return outcome === "success"
    ? action.successEffects
    : outcome === "costly-success"
      ? action.costlySuccessEffects
      : action.failureEffects;
}

function adventureTextForOutcome(
  action: import("../types").AdventureActionDefinition,
  outcome: import("../types").AdventureCheckOutcome,
): string {
  return outcome === "success"
    ? action.successText
    : outcome === "costly-success"
      ? action.costlySuccessText
      : action.failureText;
}

async function buildAdventureInteractionStateHashes(input: {
  state: SimulationRuntimeState;
  session: SimulationSession;
  action: import("../types").AdventureActionDefinition;
  commandId: string;
}): Promise<string[]> {
  if (input.action.kind !== "talk") return [];
  const binding = input.action.interaction;
  const interaction = input.state.interaction;
  if (!binding || !interaction)
    throw new Error("[adventure] talk 行动缺少共享角色互动状态。");
  const scene = interaction.sceneTemplates.find(
    (item) => item.sceneKey === binding.sceneKey,
  );
  const rule = scene?.relationshipRules.find(
    (item) => item.ruleKey === binding.ruleKey,
  );
  if (!scene || !rule)
    throw new Error("[adventure] talk 行动的冻结互动绑定无效。");
  let projected = structuredClone(input.state);
  const sceneId = `scene:${binding.sceneKey}:${projected.lastSequence + 1}`;
  const descriptors: Array<{
    type: SimulationEventType;
    payload: Record<string, unknown>;
  }> = [
    {
      type: "interaction.scene.started",
      payload: { sceneId, sceneKey: binding.sceneKey },
    },
    {
      type: "interaction.player.message.committed",
      payload: {
        messageId: `message:${binding.ruleKey}:${projected.lastSequence + 2}`,
        text: rule.playerText,
        audienceKeys: null,
      },
    },
    {
      type: "interaction.relationship.changed",
      payload: {
        fromParticipantKey: rule.fromParticipantKey,
        toParticipantKey: rule.toParticipantKey,
        dimensionKey: rule.dimensionKey,
        delta: rule.delta,
        reason: rule.reason,
        ruleKey: rule.ruleKey,
        sourceEventSequence: projected.lastSequence + 2,
        significantEventKey: rule.significantEventKey,
      },
    },
    {
      type: "interaction.scene.ended",
      payload: { sceneId, reason: `adventure-action:${input.action.key}` },
    },
  ];
  const hashes: string[] = [];
  for (const descriptor of descriptors) {
    const baseStateHash = await hashStateJson(JSON.stringify(projected));
    hashes.push(baseStateHash);
    const sequence = projected.lastSequence + 1;
    const envelope = {
      commandId: `${input.commandId.slice(0, 150)}:interaction:${sequence}`,
      baseSequence: projected.lastSequence,
      baseStateHash,
    };
    projected = applySimulationEvent(
      projected,
      adventureEvent(
        input.session,
        sequence,
        descriptor.type,
        { ...descriptor.payload, ...envelope },
        envelope,
      ),
    );
  }
  return hashes;
}

/**
 * TEXTADV-1 authoritative write path. A command expands into small domain
 * events inside one Dexie transaction; no UI or Harness candidate may submit
 * those events directly.
 */
export async function commitAdventureAction(
  input: AdventureCommandEnvelope,
): Promise<SimulationEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const actionKey = input.actionKey.trim();
  if (!actionKey || actionKey.length > 160)
    throw new Error("[adventure] 行动 key 无效。");
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0)
    throw new Error("[adventure] baseSequence 无效。");
  if (!/^[a-f0-9]{64}$/.test(input.baseStateHash))
    throw new Error("[adventure] baseStateHash 无效。");
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (
    !previewSession ||
    (previewSession.kind !== "textadventure" &&
      previewSession.kind !== "textworld") ||
    (previewSession.gameReleaseId == null && previewSession.gameBuildId == null)
  ) {
    throw new Error("[adventure] 正式文字冒险实例不存在。");
  }
  const [previewEvents, frozen] = await Promise.all([
    readSessionEvents(previewSession),
    verifyFormalPlayableSourceV1(previewSession, [
      "text-adventure",
      "text-open-world",
    ]),
  ]);
  const adventureContent = frozen.runtimePackage.adventure;
  if (!adventureContent) {
    throw new Error("[adventure] 冻结 Product RuntimePackage 缺少冒险模块。");
  }
  const previewPrior = previewEvents.find(
    (event) => event.commandId === commandId,
  );
  if (previewPrior) {
    const body = parseEventPayload(previewPrior);
    if (
      previewPrior.type !== "adventure.action.committed" ||
      body.actionKey !== actionKey ||
      previewPrior.baseSequence !== input.baseSequence ||
      previewPrior.baseStateHash !== input.baseStateHash
    ) {
      throw new Error("[adventure] commandId 已被不同命令使用。");
    }
    return previewPrior;
  }
  const previewState = replaySimulationEvents(
    parseSimulationState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewStateHash = await hashStateJson(JSON.stringify(previewState));
  if (
    !previewState.adventure ||
    previewState.adventure.contentHash !== frozen.packageHash
  ) {
    throw new Error("[adventure] 实例 Product Release/Build 绑定无效。");
  }
  const previewAvailable = availableAdventureActions(
    adventureContent,
    previewState.adventure,
    previewState.narrative?.variables,
  ).find((item) => item.action.key === actionKey);
  if (!previewAvailable?.available) {
    throw new Error(
      previewAvailable?.reason ||
        "[adventure] 行动不在当前位置或前置条件未满足。",
    );
  }
  if (
    previewSession.kind === "textworld" &&
    previewAvailable.action.kind === "move"
  ) {
    throw new Error("[textworld] 区域移动只能通过开放世界交通命令提交。");
  }
  const interactionStateHashes = await buildAdventureInteractionStateHashes({
    state: previewState,
    session: previewSession,
    action: previewAvailable.action,
    commandId,
  });
  return db.transaction(
    "rw",
    [
      db.simulationSessions,
      db.simulationEvents,
      db.gameReleases,
      db.gameBuilds,
      db.gameProductions,
      db.gameProductionBriefs,
    ],
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (
        !session ||
        (session.kind !== "textadventure" && session.kind !== "textworld") ||
        (session.gameReleaseId == null && session.gameBuildId == null)
      )
        throw new Error("[adventure] 正式文字冒险实例不存在。");
      await assertFormalPlayableSourceUnchangedV1({
        previewSession,
        session,
        frozen,
      });
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      if (prior) {
        const body = parseEventPayload(prior);
        if (
          prior.type !== "adventure.action.committed" ||
          body.actionKey !== actionKey ||
          prior.baseSequence !== input.baseSequence ||
          prior.baseStateHash !== input.baseStateHash
        ) {
          throw new Error("[adventure] commandId 已被不同命令使用。");
        }
        return prior;
      }
      if (session.status !== "active")
        throw new Error("[adventure] 只有 active 实例可以行动。");
      let projected = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      if (projected.lastSequence !== input.baseSequence)
        throw new Error("[adventure] 冒险状态已变化，请刷新后重试。");
      if (
        previewState.lastSequence !== projected.lastSequence ||
        previewStateHash !== input.baseStateHash
      )
        throw new Error("[adventure] 冒险状态哈希已变化。");
      if (
        !projected.adventure ||
        projected.adventure.contentHash !== frozen.packageHash
      ) {
        throw new Error("[adventure] 实例 Product Release/Build 绑定无效。");
      }
      const available = availableAdventureActions(
        adventureContent,
        projected.adventure,
        projected.narrative?.variables,
      ).find((item) => item.action.key === actionKey);
      if (!available?.available)
        throw new Error(
          available?.reason || "[adventure] 行动不在当前位置或前置条件未满足。",
        );
      const action = available.action;
      if (session.kind === "textworld" && action.kind === "move") {
        throw new Error("[textworld] 区域移动只能通过开放世界交通命令提交。");
      }
      if (action.kind === "talk") {
        const binding = action.interaction;
        if (!binding || !projected.interaction)
          throw new Error("[adventure] talk 行动缺少共享角色互动状态。");
        const scene = projected.interaction.sceneTemplates.find(
          (item) => item.sceneKey === binding.sceneKey,
        );
        const rule = scene?.relationshipRules.find(
          (item) => item.ruleKey === binding.ruleKey,
        );
        if (
          !scene ||
          !scene.participantKeys.includes(binding.participantKey) ||
          !rule ||
          rule.fromParticipantKey !== binding.participantKey
        ) {
          throw new Error("[adventure] talk 行动的冻结互动绑定无效。");
        }
        if (projected.interaction.activeScene)
          throw new Error("[adventure] 请先结束当前角色互动场景。");
      }
      let outcome: import("../types").AdventureCheckOutcome = "success";
      let evidence: import("../types").AdventureCheckEvidence | null = null;
      const remainingInteractionStateHashes = [...interactionStateHashes];
      const nextSequence = () => projected.lastSequence + 1;
      const append = async (
        type: SimulationEventType,
        payload: Record<string, unknown>,
        envelope?: boolean,
      ) => {
        const interactionEnvelope = type.startsWith("interaction.")
          ? {
              commandId: `${commandId.slice(0, 150)}:interaction:${nextSequence()}`,
              baseSequence: projected.lastSequence,
              baseStateHash:
                remainingInteractionStateHashes.shift() ??
                (() => {
                  throw new Error("[adventure] 互动状态哈希预算不足。");
                })(),
            }
          : null;
        const selectedEnvelope =
          interactionEnvelope ??
          (envelope
            ? {
                commandId,
                baseSequence: input.baseSequence,
                baseStateHash: input.baseStateHash,
              }
            : undefined);
        const event = adventureEvent(
          session,
          nextSequence(),
          type,
          interactionEnvelope
            ? { ...payload, ...interactionEnvelope }
            : payload,
          selectedEnvelope,
        );
        projected = applySimulationEvent(projected, event);
        event.id = (await db.simulationEvents.add(event)) as number;
        return event;
      };
      if (action.kind === "talk") {
        const binding = action.interaction!;
        const scene = projected.interaction!.sceneTemplates.find(
          (item) => item.sceneKey === binding.sceneKey,
        )!;
        const rule = scene.relationshipRules.find(
          (item) => item.ruleKey === binding.ruleKey,
        )!;
        const sceneId = `scene:${binding.sceneKey}:${nextSequence()}`;
        await append("interaction.scene.started", {
          sceneId,
          sceneKey: binding.sceneKey,
        });
        const message = await append("interaction.player.message.committed", {
          messageId: `message:${binding.ruleKey}:${nextSequence()}`,
          text: rule.playerText,
          audienceKeys: null,
        });
        await append("interaction.relationship.changed", {
          fromParticipantKey: rule.fromParticipantKey,
          toParticipantKey: rule.toParticipantKey,
          dimensionKey: rule.dimensionKey,
          delta: rule.delta,
          reason: rule.reason,
          ruleKey: rule.ruleKey,
          sourceEventSequence: message.sequence,
          significantEventKey: rule.significantEventKey,
        });
        await append("interaction.scene.ended", {
          sceneId,
          reason: `adventure-action:${action.key}`,
        });
      }
      if (action.rule.kind === "threshold") {
        const total = projected.adventure.abilities[action.rule.abilityKey];
        outcome = total >= action.rule.difficulty ? "success" : "failure";
        evidence = {
          eventSequence: nextSequence(),
          actionKey,
          abilityKey: action.rule.abilityKey,
          mode: "threshold",
          expression: null,
          dice: [],
          modifier: total,
          total,
          difficulty: action.rule.difficulty,
          outcome,
        };
      } else if (action.rule.kind === "random") {
        const expression = parseDiceExpression(action.rule.expression);
        const ability = projected.adventure.abilities[action.rule.abilityKey];
        if (ability == null)
          throw new Error(`[adventure] 能力不存在:${action.rule.abilityKey}`);
        const dice = buildDiceResolution({
          seed: session.seed,
          sequence: nextSequence(),
          expression,
          nonce: `adventure:${commandId}:${actionKey}`,
        });
        const total = dice.total + ability;
        outcome =
          total >= action.rule.difficulty
            ? "success"
            : action.rule.costlySuccessFloor != null &&
                total >= action.rule.costlySuccessFloor
              ? "costly-success"
              : "failure";
        evidence = {
          eventSequence: nextSequence(),
          actionKey,
          abilityKey: action.rule.abilityKey,
          mode: "random",
          expression: dice.expression,
          dice: dice.dice,
          modifier: dice.modifier + ability,
          total,
          difficulty: action.rule.difficulty,
          outcome,
        };
      } else if (action.rule.kind === "resource-payment") {
        const total = projected.adventure.resources[action.rule.resourceKey];
        outcome = total >= action.rule.amount ? "success" : "not-attempted";
        evidence = {
          eventSequence: nextSequence(),
          actionKey,
          abilityKey: null,
          mode: "resource-payment",
          expression: null,
          dice: [],
          modifier: 0,
          total,
          difficulty: action.rule.amount,
          outcome,
        };
      }
      if (evidence) await append("adventure.check.resolved", { evidence });
      const effects =
        outcome === "not-attempted"
          ? []
          : [
              ...(action.rule.kind === "resource-payment"
                ? [
                    {
                      op: "change-resource" as const,
                      resourceKey: action.rule.resourceKey,
                      delta: -action.rule.amount,
                    },
                  ]
                : []),
              ...adventureEffectsForOutcome(action, outcome),
            ];
      // Preflight all effects against a pure clone before the first mutating event.
      applyAdventureEffects(
        adventureContent,
        projected.adventure,
        effects,
        nextSequence(),
      );
      for (const effect of effects) {
        if (effect.op === "enter-location") {
          await append("adventure.location.left", {
            locationKey: projected.adventure!.currentLocationKey,
          });
          await append("adventure.location.entered", {
            locationKey: effect.locationKey,
          });
        } else if (effect.op === "gain-item")
          await append("adventure.item.gained", effect);
        else if (effect.op === "remove-item")
          await append("adventure.item.used", effect);
        else if (effect.op === "transfer-item")
          await append("adventure.item.transferred", effect);
        else if (effect.op === "change-item-state")
          await append("adventure.item.state-changed", effect);
        else if (effect.op === "change-resource") {
          const definition = adventureContent.resources.find(
            (item) => item.key === effect.resourceKey,
          )!;
          const before = projected.adventure!.resources[effect.resourceKey];
          const after = Math.max(
            definition.minimum,
            Math.min(definition.maximum, before + effect.delta),
          );
          if (after !== before + effect.delta)
            throw new Error(`[adventure] 资源越界:${effect.resourceKey}`);
          await append("adventure.resource.changed", {
            resourceKey: effect.resourceKey,
            before,
            after,
            delta: effect.delta,
          });
        } else if (effect.op === "change-ability") {
          const definition = adventureContent.abilities.find(
            (item) => item.key === effect.abilityKey,
          )!;
          const before = projected.adventure!.abilities[effect.abilityKey];
          const after = before + effect.delta;
          if (after < definition.minimum || after > definition.maximum)
            throw new Error(`[adventure] 能力越界:${effect.abilityKey}`);
          await append("adventure.ability.changed", {
            abilityKey: effect.abilityKey,
            before,
            after,
            delta: effect.delta,
          });
        } else if (effect.op === "apply-condition")
          await append("adventure.condition.applied", effect);
        else if (effect.op === "remove-condition")
          await append("adventure.condition.removed", effect);
        else if (effect.op === "accept-quest")
          await append("adventure.quest.accepted", effect);
        else if (effect.op === "fail-quest")
          await append("adventure.quest.failed", effect);
        else {
          await append("adventure.quest.objective-updated", effect);
          const quest = projected.adventure!.quests.find(
            (item) => item.questKey === effect.questKey,
          )!;
          if (
            quest.status === "active" &&
            quest.objectives
              .filter((item) => !item.optional)
              .every((item) => item.completed)
          ) {
            await append("adventure.quest.completed", {
              questKey: effect.questKey,
            });
            const reward = adventureContent.quests.find(
              (item) => item.key === effect.questKey,
            )!.rewardEffects;
            for (const rewardEffect of reward) {
              if (
                rewardEffect.op !== "gain-item" &&
                rewardEffect.op !== "change-resource" &&
                rewardEffect.op !== "change-ability" &&
                rewardEffect.op !== "apply-condition"
              ) {
                throw new Error(
                  "[adventure] 首期任务奖励只支持物品、资源、能力或状态。",
                );
              }
              if (rewardEffect.op === "gain-item")
                await append("adventure.item.gained", rewardEffect);
              else if (rewardEffect.op === "apply-condition")
                await append("adventure.condition.applied", rewardEffect);
              else if (rewardEffect.op === "change-ability") {
                const definition = adventureContent.abilities.find(
                  (item) => item.key === rewardEffect.abilityKey,
                )!;
                const before =
                  projected.adventure!.abilities[rewardEffect.abilityKey];
                const after = before + rewardEffect.delta;
                if (after < definition.minimum || after > definition.maximum)
                  throw new Error(
                    `[adventure] 奖励能力越界:${rewardEffect.abilityKey}`,
                  );
                await append("adventure.ability.changed", {
                  abilityKey: rewardEffect.abilityKey,
                  before,
                  after,
                  delta: rewardEffect.delta,
                });
              } else {
                const definition = adventureContent.resources.find(
                  (item) => item.key === rewardEffect.resourceKey,
                )!;
                const before =
                  projected.adventure!.resources[rewardEffect.resourceKey];
                const after = before + rewardEffect.delta;
                if (after < definition.minimum || after > definition.maximum)
                  throw new Error(
                    `[adventure] 奖励资源越界:${rewardEffect.resourceKey}`,
                  );
                await append("adventure.resource.changed", {
                  resourceKey: rewardEffect.resourceKey,
                  before,
                  after,
                  delta: rewardEffect.delta,
                });
              }
            }
          }
        }
      }
      await append("adventure.narrative.synced", {
        projection: adventureNarrativeProjection(projected.adventure!),
      });
      const narrative =
        outcome === "not-attempted"
          ? action.unavailableText
          : adventureTextForOutcome(action, outcome);
      const committed = await append(
        "adventure.action.committed",
        {
          commandId,
          actionKey,
          kind: action.kind,
          outcome,
          narrative,
          repeatable: action.repeatable,
        },
        true,
      );
      await db.simulationSessions.update(session.id!, {
        updatedAt: Date.now(),
      });
      return committed;
    },
  );
}

function assertTtrpgActor(
  state: SimulationRuntimeState,
  actorKey: string,
): void {
  const actor = state.entities[actorKey];
  if (!actor || !["player", "character", "npc"].includes(actor.kind)) {
    throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`);
  }
  const ttrpg = state.ttrpg;
  if (!ttrpg?.scene || ttrpg.scene.status !== "active")
    throw new Error("请先开始一个跑团场景。");
  if (!ttrpg.turnOrder.includes(actorKey))
    throw new Error("行动者不在当前回合顺序中。");
  if (ttrpg.activeActorKey !== actorKey)
    throw new Error("当前还没轮到该行动者。");
}

export async function openTtrpgScene(input: {
  sessionId: number;
  title: string;
  description: string;
  locationKey?: string | null;
  turnOrder: string[];
}): Promise<SimulationEvent> {
  const title = input.title.trim();
  const description = input.description.trim();
  const turnOrder = [
    ...new Set(input.turnOrder.map((key) => key.trim()).filter(Boolean)),
  ];
  if (!title || title.length > 200) throw new Error("跑团场景标题无效。");
  if (description.length > 8_000) throw new Error("跑团场景描述过长。");
  if (turnOrder.length === 0) throw new Error("跑团场景至少需要一个行动者。");
  const scene: SimulationTtrpgScene = {
    sceneId:
      globalThis.crypto?.randomUUID?.() ??
      `scene-${Date.now()}-${Math.random()}`,
    title,
    description,
    locationKey: input.locationKey?.trim() || null,
    status: "active",
  };
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "ttrpg") throw new Error("只有跑团会话可以开始场景。");
    for (const actorKey of turnOrder) {
      const actor = state.entities[actorKey];
      if (!actor || !["player", "character", "npc"].includes(actor.kind)) {
        throw new Error(`跑团行动者不存在或类型不支持: ${actorKey}`);
      }
    }
    if (scene.locationKey != null) {
      const location = state.entities[scene.locationKey];
      if (!location || location.kind !== "location")
        throw new Error(`跑团场景地点不存在: ${scene.locationKey}`);
    }
    return {
      type: "ttrpg.scene.opened",
      actorKey: turnOrder[0],
      targetKey: scene.locationKey,
      payloadJson: JSON.stringify({ scene, turnOrder }),
    };
  });
}

export async function resolveTtrpgCheck(input: {
  sessionId: number;
  actorKey: string;
  skill: string;
  expression: string;
  dc: number;
  nonce?: string;
}): Promise<SimulationEvent> {
  const actorKey = input.actorKey.trim();
  const skill = input.skill.trim();
  const parsed = parseDiceExpression(input.expression);
  const dc = assertFiniteInteger(input.dc, "检定难度", 0, 1_000);
  const nonce = input.nonce?.trim() || `check:${skill}`;
  if (!skill || skill.length > 120) throw new Error("检定技能无效。");
  if (nonce.length > 200) throw new Error("检定 nonce 过长。");
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以进行技能检定。");
    assertTtrpgActor(state, actorKey);
    const resolution = buildDiceResolution({
      seed: session.seed,
      sequence,
      expression: parsed,
      nonce,
    });
    return {
      type: "ttrpg.check.resolved",
      actorKey,
      targetKey: actorKey,
      payloadJson: JSON.stringify({
        check: {
          actorKey,
          skill,
          expression: resolution.expression,
          dice: resolution.dice,
          modifier: resolution.modifier,
          total: resolution.total,
          dc,
          success: resolution.total >= dc,
        },
      }),
    };
  });
}

export function parseSimulationTtrpgEncounterCandidate(
  value: unknown,
): SimulationTtrpgEncounterCandidate {
  if (!isObject(value)) throw new Error("跑团遭遇候选必须是对象。");
  const allowed = new Set([
    "baseSequence",
    "title",
    "description",
    "participantKeys",
  ]);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length)
    throw new Error(`跑团遭遇候选包含未知字段: ${unknown.join(", ")}`);
  const baseSequence = assertFiniteInteger(
    value.baseSequence,
    "遭遇候选基线序号",
    0,
    Number.MAX_SAFE_INTEGER,
  );
  const title = String(value.title ?? "").trim();
  const description = String(value.description ?? "").trim();
  if (!title || title.length > 200) throw new Error("遭遇候选标题无效。");
  if (!description || description.length > 8_000)
    throw new Error("遭遇候选描述无效。");
  if (!Array.isArray(value.participantKeys))
    throw new Error("遭遇候选必须提供参与者列表。");
  const participantKeys = value.participantKeys.map((raw) =>
    String(raw).trim(),
  );
  if (
    participantKeys.length < 2 ||
    participantKeys.length > 40 ||
    participantKeys.some((key) => !key || key.length > 160)
  ) {
    throw new Error("遭遇候选参与者必须为 2..40 个有效实体。");
  }
  if (new Set(participantKeys).size !== participantKeys.length)
    throw new Error("遭遇候选参与者不能重复。");
  return { baseSequence, title, description, participantKeys };
}

function numericAttribute(
  entity: RuntimeEntityState,
  keys: string[],
  fallback: number,
  min: number,
  max: number,
): number {
  for (const key of keys) {
    const value = entity.attributes[key];
    if (
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= min &&
      value <= max
    )
      return value;
  }
  return fallback;
}

function combatantFromEntity(
  entity: RuntimeEntityState,
  initiative: number,
): SimulationTtrpgCombatant {
  const maximumHp = numericAttribute(
    entity,
    ["maxHp", "hp"],
    10,
    1,
    1_000_000_000,
  );
  const currentHp = numericAttribute(entity, ["hp"], maximumHp, 0, maximumHp);
  const resources: Record<string, SimulationTtrpgResource> = {
    hp: { current: currentHp, maximum: maximumHp },
  };
  for (const key of ["mana", "stamina", "actionPoints"]) {
    const maximum = numericAttribute(
      entity,
      [`max${key[0].toUpperCase()}${key.slice(1)}`, key],
      0,
      0,
      1_000_000_000,
    );
    if (maximum > 0)
      resources[key] = {
        current: numericAttribute(entity, [key], maximum, 0, maximum),
        maximum,
      };
  }
  return {
    entityKey: entity.entityKey,
    initiative,
    armorClass: numericAttribute(entity, ["armorClass", "ac"], 10, 0, 1_000),
    resources,
    conditions: [],
  };
}

export async function startTtrpgEncounter(input: {
  sessionId: number;
  candidate: SimulationTtrpgEncounterCandidate;
}): Promise<SimulationEvent> {
  const candidate = parseSimulationTtrpgEncounterCandidate(input.candidate);
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== "ttrpg") throw new Error("只有跑团会话可以开始遭遇。");
    const ttrpg = state.ttrpg;
    if (!ttrpg?.scene || ttrpg.scene.status !== "active")
      throw new Error("请先开始一个跑团场景。");
    if (candidate.baseSequence !== state.lastSequence)
      throw new Error("遭遇候选已过期，请重新生成。");
    if (ttrpg.encounter?.status === "active")
      throw new Error("当前已有进行中的战斗遭遇。");
    const combatants: Record<string, SimulationTtrpgCombatant> = {};
    for (const entityKey of candidate.participantKeys) {
      const entity = state.entities[entityKey];
      if (!entity || !["player", "character", "npc"].includes(entity.kind))
        throw new Error(`遭遇参与者不存在或类型不支持: ${entityKey}`);
      const initiative = numericAttribute(
        entity,
        ["initiative"],
        deterministicDie(
          `${session.seed}\u0000${sequence}\u0000initiative:${entityKey}`,
          20,
        ),
        0,
        1_000,
      );
      combatants[entityKey] = combatantFromEntity(entity, initiative);
    }
    const turnOrder = Object.values(combatants)
      .sort(
        (left, right) =>
          right.initiative - left.initiative ||
          left.entityKey.localeCompare(right.entityKey),
      )
      .map((combatant) => combatant.entityKey);
    const encounter: SimulationTtrpgEncounter = {
      encounterId:
        globalThis.crypto?.randomUUID?.() ??
        `encounter-${Date.now()}-${Math.random()}`,
      title: candidate.title,
      description: candidate.description,
      status: "active",
      round: 1,
      activeActorKey: turnOrder[0],
      turnOrder,
      combatants,
    };
    return {
      type: "ttrpg.encounter.started",
      actorKey: turnOrder[0],
      targetKey: null,
      payloadJson: JSON.stringify({ encounter }),
    };
  });
}

export async function resolveTtrpgEncounter(input: {
  sessionId: number;
  reason?: string;
}): Promise<SimulationEvent> {
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 2_000) throw new Error("遭遇结束理由过长。");
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "ttrpg") throw new Error("只有跑团会话可以结束遭遇。");
    if (!state.ttrpg?.encounter || state.ttrpg.encounter.status !== "active")
      throw new Error("当前没有进行中的战斗遭遇。");
    return {
      type: "ttrpg.encounter.resolved",
      actorKey: null,
      targetKey: null,
      payloadJson: JSON.stringify({ reason }),
    };
  });
}

export async function changeTtrpgResource(input: {
  sessionId: number;
  entityKey: string;
  resourceKey: string;
  delta: number;
  reason?: string;
}): Promise<SimulationEvent> {
  const entityKey = input.entityKey.trim();
  const resourceKey = input.resourceKey.trim();
  const delta = assertFiniteInteger(
    input.delta,
    "资源变化量",
    -1_000_000_000,
    1_000_000_000,
  );
  const reason = input.reason?.trim() ?? "";
  if (!entityKey || !resourceKey || resourceKey.length > 80)
    throw new Error("资源变化目标无效。");
  if (reason.length > 2_000) throw new Error("资源变化理由过长。");
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以调整战斗资源。");
    const encounter = state.ttrpg?.encounter;
    const resource = encounter?.combatants[entityKey]?.resources[resourceKey];
    if (!encounter || encounter.status !== "active" || !resource)
      throw new Error("资源目标不在当前进行中的遭遇中。");
    const current = Math.max(
      0,
      Math.min(resource.maximum, resource.current + delta),
    );
    return {
      type: "ttrpg.combat.resource.changed",
      actorKey: entityKey,
      targetKey: entityKey,
      payloadJson: JSON.stringify({
        entityKey,
        resourceKey,
        delta,
        current,
        reason,
      }),
    };
  });
}

export async function applyTtrpgCondition(input: {
  sessionId: number;
  entityKey: string;
  condition: SimulationTtrpgCondition;
}): Promise<SimulationEvent> {
  const entityKey = input.entityKey.trim();
  const condition = assertTtrpgCondition(input.condition);
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以施加状态效果。");
    if (!state.ttrpg?.encounter?.combatants[entityKey])
      throw new Error("状态效果目标不在当前遭遇中。");
    return {
      type: "ttrpg.combat.condition.applied",
      actorKey: entityKey,
      targetKey: entityKey,
      payloadJson: JSON.stringify({ entityKey, condition }),
    };
  });
}

export async function removeTtrpgCondition(input: {
  sessionId: number;
  entityKey: string;
  conditionId: string;
}): Promise<SimulationEvent> {
  const entityKey = input.entityKey.trim();
  const conditionId = input.conditionId.trim();
  if (!entityKey || !conditionId) throw new Error("状态效果移除目标无效。");
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以移除状态效果。");
    if (!state.ttrpg?.encounter?.combatants[entityKey])
      throw new Error("状态效果目标不在当前遭遇中。");
    return {
      type: "ttrpg.combat.condition.removed",
      actorKey: entityKey,
      targetKey: entityKey,
      payloadJson: JSON.stringify({ entityKey, conditionId }),
    };
  });
}

export async function resolveTtrpgAttack(input: {
  sessionId: number;
  actorKey: string;
  targetKey: string;
  attackExpression: string;
  damageExpression?: string | null;
  resourceKey?: string;
  reason?: string;
}): Promise<SimulationEvent[]> {
  const actorKey = input.actorKey.trim();
  const targetKey = input.targetKey.trim();
  const attackExpression = parseDiceExpression(input.attackExpression);
  const damageExpression = input.damageExpression?.trim()
    ? parseDiceExpression(input.damageExpression)
    : null;
  const resourceKey = input.resourceKey?.trim() || "hp";
  const reason = input.reason?.trim() ?? "";
  if (!actorKey || !targetKey || actorKey === targetKey)
    throw new Error("攻击者与目标必须是不同实体。");
  if (resourceKey.length > 80) throw new Error("攻击资源键无效。");
  if (reason.length > 2_000) throw new Error("攻击理由过长。");
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (!session) throw new Error("模拟会话不存在。");
      if (session.status !== "active")
        throw new Error("只有 active 会话可以追加事件。");
      if (session.kind !== "ttrpg")
        throw new Error("只有跑团会话可以执行攻击。");
      const events = await readSessionEvents(session);
      let state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      const encounter = state.ttrpg?.encounter;
      if (!encounter || encounter.status !== "active")
        throw new Error("请先开始一个进行中的战斗遭遇。");
      if (encounter.activeActorKey !== actorKey)
        throw new Error("当前还没轮到该战斗行动者。");
      const actor = encounter.combatants[actorKey];
      const target = encounter.combatants[targetKey];
      if (!actor || !target)
        throw new Error("攻击行动者或目标不在当前遭遇中。");
      const targetResource = target.resources[resourceKey];
      if (!targetResource) throw new Error(`目标没有资源: ${resourceKey}`);
      const attackSequence = state.lastSequence + 1;
      const attackDice = Array.from(
        { length: attackExpression.count },
        (_, index) =>
          deterministicDie(
            `${session.seed}\u0000${attackSequence}\u0000${attackExpression.normalized}\u0000attack:${actorKey}:${targetKey}\u0000${index}`,
            attackExpression.sides,
          ),
      );
      const attackTotal = attackDice.reduce(
        (sum, die) => sum + die,
        attackExpression.modifier,
      );
      const hit = attackTotal >= target.armorClass;
      const damageDice =
        hit && damageExpression
          ? Array.from({ length: damageExpression.count }, (_, index) =>
              deterministicDie(
                `${session.seed}\u0000${attackSequence}\u0000${damageExpression.normalized}\u0000damage:${actorKey}:${targetKey}\u0000${index}`,
                damageExpression.sides,
              ),
            )
          : [];
      const damageTotal =
        hit && damageExpression
          ? damageDice.reduce(
              (sum, die) => sum + die,
              damageExpression.modifier,
            )
          : 0;
      if (damageTotal < 0) throw new Error("伤害骰式不能产生负数伤害。");
      const resourceDelta = -damageTotal;
      const attack: SimulationTtrpgAttackResult = {
        actorKey,
        targetKey,
        attackExpression: attackExpression.normalized,
        attackDice,
        attackModifier: attackExpression.modifier,
        attackTotal,
        armorClass: target.armorClass,
        hit,
        damageExpression:
          hit && damageExpression ? damageExpression.normalized : null,
        damageDice,
        damageModifier: damageExpression?.modifier ?? 0,
        damageTotal,
        resourceKey,
        resourceDelta,
        reason,
      };
      const appended: SimulationEvent[] = [];
      const appendLocal = (eventInput: {
        type: SimulationEventType;
        actorKey?: string | null;
        targetKey?: string | null;
        payload: unknown;
      }) => {
        const event: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: input.sessionId,
          sequence: state.lastSequence + 1,
          type: eventInput.type,
          actorKey: eventInput.actorKey ?? null,
          targetKey: eventInput.targetKey ?? null,
          payloadJson: JSON.stringify(eventInput.payload),
          createdAt: Date.now(),
        };
        state = applySimulationEvent(state, event);
        appended.push(event);
      };
      appendLocal({
        type: "ttrpg.combat.attack.resolved",
        actorKey,
        targetKey,
        payload: { attack },
      });
      if (hit && damageTotal > 0) {
        const current = Math.max(
          0,
          Math.min(
            targetResource.maximum,
            targetResource.current + resourceDelta,
          ),
        );
        appendLocal({
          type: "ttrpg.combat.resource.changed",
          actorKey,
          targetKey,
          payload: {
            entityKey: targetKey,
            resourceKey,
            delta: resourceDelta,
            current,
            reason: reason || "攻击伤害",
          },
        });
      }
      const currentIndex = encounter.turnOrder.indexOf(actorKey);
      const nextIndex = (currentIndex + 1) % encounter.turnOrder.length;
      const nextActorKey = encounter.turnOrder[nextIndex];
      const nextRound = encounter.round + (nextIndex === 0 ? 1 : 0);
      appendLocal({
        type: "ttrpg.combat.turn.advanced",
        actorKey,
        targetKey: nextActorKey,
        payload: { nextActorKey, round: nextRound },
      });
      for (const event of appended)
        event.id = (await db.simulationEvents.add(event)) as number;
      await db.simulationSessions.update(input.sessionId, {
        updatedAt: appended[appended.length - 1].createdAt,
      });
      return appended;
    },
  );
}

export async function updateTtrpgCampaignSummary(input: {
  sessionId: number;
  summary: string;
  baseSequence?: number;
}): Promise<SimulationEvent> {
  const summary = input.summary.trim();
  if (summary.length > 20_000)
    throw new Error("长期战役摘要不能超过 20,000 个字符。");
  return appendBuiltEvent(input.sessionId, ({ session, state }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以更新长期战役摘要。");
    const baseSequence = input.baseSequence ?? state.lastSequence;
    if (baseSequence !== state.lastSequence)
      throw new Error("长期战役摘要基线已变化，请刷新后重试。");
    return {
      type: "ttrpg.campaign.summary.updated",
      actorKey: null,
      targetKey: null,
      payloadJson: JSON.stringify({ baseSequence, summary }),
    };
  });
}

export async function upsertTtrpgQuest(input: {
  sessionId: number;
  questId: string;
  title: string;
  description: string;
  status: SimulationTtrpgQuest["status"];
  priority?: number;
  dueClock?: number | null;
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, sequence }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以管理战役任务。");
    const quest = assertTtrpgQuest({
      questId: input.questId,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority ?? 0,
      dueClock: input.dueClock ?? null,
      updatedSequence: sequence,
    });
    return {
      type: "ttrpg.campaign.quest.upserted",
      actorKey: null,
      targetKey: quest.questId,
      payloadJson: JSON.stringify({ quest }),
    };
  });
}

export async function upsertTtrpgNpcSchedule(input: {
  sessionId: number;
  scheduleId: string;
  entityKey: string;
  startClock: number;
  endClock?: number | null;
  locationKey?: string | null;
  activity: string;
  recurrence?: SimulationTtrpgNpcSchedule["recurrence"];
}): Promise<SimulationEvent> {
  return appendBuiltEvent(input.sessionId, ({ session, state, sequence }) => {
    if (session.kind !== "ttrpg")
      throw new Error("只有跑团会话可以管理 NPC 日程。");
    const entityKey = input.entityKey.trim();
    const npc = state.entities[entityKey];
    if (!npc || !isNpcRuntimeEntity(npc))
      throw new Error("NPC 日程目标不是当前运行时 NPC。");
    const locationKey = input.locationKey?.trim() || null;
    if (locationKey != null) {
      const location = state.entities[locationKey];
      if (!location || location.kind !== "location")
        throw new Error("NPC 日程地点不是当前运行时地点。");
    }
    const schedule = assertTtrpgNpcSchedule({
      scheduleId: input.scheduleId,
      entityKey,
      startClock: input.startClock,
      endClock: input.endClock ?? null,
      locationKey,
      activity: input.activity,
      recurrence: input.recurrence ?? "once",
      updatedSequence: sequence,
    });
    return {
      type: "ttrpg.campaign.schedule.upserted",
      actorKey: entityKey,
      targetKey: locationKey,
      payloadJson: JSON.stringify({ schedule }),
    };
  });
}

export async function appendTtrpgTurn(input: {
  sessionId: number;
  candidate: SimulationTtrpgTurnCandidate;
}): Promise<SimulationEvent[]> {
  const candidate = parseSimulationTtrpgTurnCandidate(input.candidate);
  return db.transaction(
    "rw",
    db.simulationSessions,
    db.simulationEvents,
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (!session) throw new Error("模拟会话不存在。");
      if (session.status !== "active")
        throw new Error("只有 active 会话可以追加事件。");
      if (session.kind !== "ttrpg")
        throw new Error("只有跑团会话可以记录回合。");
      const events = await readSessionEvents(session);
      let state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      if (candidate.baseSequence !== state.lastSequence)
        throw new Error("跑团候选已过期，请重新生成。");
      assertTtrpgActor(state, candidate.actorKey);
      const ttrpg = state.ttrpg!;
      const currentIndex = ttrpg.turnOrder.indexOf(ttrpg.activeActorKey!);
      const nextIndex = (currentIndex + 1) % ttrpg.turnOrder.length;
      const expectedNextActorKey = ttrpg.turnOrder[nextIndex];
      const expectedRound = ttrpg.round + (nextIndex === 0 ? 1 : 0);
      if (
        candidate.nextActorKey != null &&
        candidate.nextActorKey !== expectedNextActorKey
      ) {
        throw new Error("跑团候选尝试改变确定性回合顺序。");
      }
      if (candidate.check) parseDiceExpression(candidate.check.expression);
      const appended: SimulationEvent[] = [];
      const appendLocal = (inputEvent: {
        type: SimulationEventType;
        actorKey?: string | null;
        targetKey?: string | null;
        payload: unknown;
      }) => {
        const event: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: input.sessionId,
          sequence: state.lastSequence + 1,
          type: inputEvent.type,
          actorKey: inputEvent.actorKey ?? null,
          targetKey: inputEvent.targetKey ?? null,
          payloadJson: JSON.stringify(inputEvent.payload),
          createdAt: Date.now(),
        };
        state = applySimulationEvent(state, event);
        appended.push(event);
      };
      appendLocal({
        type: "ttrpg.action.recorded",
        actorKey: candidate.actorKey,
        targetKey: candidate.actorKey,
        payload: { actorKey: candidate.actorKey, text: candidate.action },
      });
      let checkSequence: number | null = null;
      let resolvedNarrative = candidate.narrative;
      if (candidate.check) {
        const expression = parseDiceExpression(candidate.check.expression);
        const sequence = state.lastSequence + 1;
        const resolution = buildDiceResolution({
          seed: session.seed,
          sequence,
          expression,
          nonce: `check:${candidate.check.skill}`,
        });
        checkSequence = sequence;
        resolvedNarrative = [
          candidate.narrative,
          resolution.total >= candidate.check.dc
            ? candidate.outcomes!.success
            : candidate.outcomes!.failure,
        ]
          .filter(Boolean)
          .join("\n\n");
        appendLocal({
          type: "ttrpg.check.resolved",
          actorKey: candidate.actorKey,
          targetKey: candidate.actorKey,
          payload: {
            check: {
              actorKey: candidate.actorKey,
              skill: candidate.check.skill,
              expression: resolution.expression,
              dice: resolution.dice,
              modifier: resolution.modifier,
              total: resolution.total,
              dc: candidate.check.dc,
              success: resolution.total >= candidate.check.dc,
            },
          },
        });
      }
      const actionSequence = appended[0].sequence;
      appendLocal({
        type: "ttrpg.gm.response.recorded",
        actorKey: null,
        targetKey: candidate.actorKey,
        payload: {
          actionSequence,
          checkSequence,
          text: resolvedNarrative,
        },
      });
      appendLocal({
        type: "ttrpg.turn.advanced",
        actorKey: candidate.actorKey,
        targetKey: expectedNextActorKey,
        payload: { nextActorKey: expectedNextActorKey, round: expectedRound },
      });
      for (const event of appended)
        event.id = (await db.simulationEvents.add(event)) as number;
      await db.simulationSessions.update(input.sessionId, {
        updatedAt: appended[appended.length - 1].createdAt,
      });
      return appended;
    },
  );
}

export async function commitNarrativeSimulationTurn(input: {
  sessionId: number;
  decisionKeys: string[];
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<{
  events: SimulationEvent[];
  checkpoint: SimulationCheckpoint;
  state: SimulationRuntimeState;
}> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[textsim] 回合命令基线无效。");
  }
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (
    !previewSession ||
    (previewSession.kind !== "textsimulation" &&
      previewSession.kind !== "textworld") ||
    (previewSession.gameReleaseId == null && previewSession.gameBuildId == null)
  ) {
    throw new Error("[textsim] 正式叙事模拟实例不存在。");
  }
  const frozen = await verifyFormalPlayableSourceV1(previewSession, [
    "narrative-simulation",
    "text-open-world",
  ]);
  const simulationContent = frozen.runtimePackage.simulation;
  if (!simulationContent) {
    throw new Error("[textsim] 冻结 Product RuntimePackage 缺少模拟模块。");
  }
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replaySimulationEvents(
    parseSimulationState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewPrior = previewEvents.find(
    (event) => event.commandId === commandId,
  );
  if (
    !previewState.narrativeSimulation ||
    previewState.narrativeSimulation.contentHash !== frozen.packageHash
  ) {
    throw new Error("[textsim] 实例冻结状态与 Product Release/Build 不一致。");
  }
  if (
    !previewPrior &&
    (previewState.lastSequence !== input.baseSequence ||
      (await hashStateJson(JSON.stringify(previewState))) !== baseStateHash)
  ) {
    throw new Error("[textsim] 模拟状态已变化，请刷新后重试。");
  }
  if (!previewPrior) {
    planNarrativeSimulationTurn({
      content: simulationContent,
      state: previewState.narrativeSimulation,
      decisionKeys: input.decisionKeys,
      seed: previewSession.seed,
      startingSequence: previewState.lastSequence,
    });
  }

  return db.transaction(
    "rw",
    [
      db.simulationSessions,
      db.simulationEvents,
      db.simulationCheckpoints,
      db.gameReleases,
      db.gameBuilds,
      db.gameProductions,
      db.gameProductionBriefs,
    ],
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (
        !session ||
        (session.kind !== "textsimulation" && session.kind !== "textworld") ||
        (session.gameReleaseId == null && session.gameBuildId == null)
      ) {
        throw new Error("[textsim] 正式叙事模拟实例不存在。");
      }
      await assertFormalPlayableSourceUnchangedV1({
        previewSession,
        session,
        frozen,
      });
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      if (prior) {
        const priorPayload = parseEventPayload(prior);
        if (
          prior.type !== "simulation.turn.started" ||
          prior.baseSequence !== input.baseSequence ||
          prior.baseStateHash !== baseStateHash ||
          stableJson(priorPayload.decisionKeys) !==
            stableJson(input.decisionKeys)
        ) {
          throw new Error("[textsim] commandId 已被不同回合命令使用。");
        }
        const turn = Number(priorPayload.turn);
        const ended = events.find(
          (event) =>
            event.sequence >= prior.sequence &&
            event.type === "simulation.turn.ended" &&
            Number(parseEventPayload(event).turn) === turn,
        );
        if (!ended) throw new Error("[textsim] 已提交回合缺少结束事件。");
        const commandEvents = events.filter(
          (event) =>
            event.sequence >= prior.sequence &&
            event.sequence <= ended.sequence,
        );
        const checkpoint = await db.simulationCheckpoints
          .where("sessionId")
          .equals(session.id!)
          .filter((item) => item.throughSequence === ended.sequence)
          .first();
        if (!checkpoint) throw new Error("[textsim] 已提交回合缺少检查点。");
        const state = parseSimulationState(checkpoint.stateJson);
        return { events: commandEvents, checkpoint, state };
      }
      if (session.status !== "active")
        throw new Error("[textsim] 只有 active 会话可以提交回合。");
      let state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      const stateHash = await hashStateJson(JSON.stringify(state));
      if (
        state.lastSequence !== input.baseSequence ||
        stateHash !== baseStateHash ||
        state.lastSequence !== previewState.lastSequence
      ) {
        throw new Error("[textsim] 模拟状态已变化，请刷新后重试。");
      }
      if (
        !state.narrativeSimulation ||
        state.narrativeSimulation.contentHash !== frozen.packageHash
      ) {
        throw new Error("[textsim] 实例冻结状态与 Product Release/Build 不一致。");
      }
      const settledTurn = state.narrativeSimulation.turn;
      const plan = planNarrativeSimulationTurn({
        content: simulationContent,
        state: state.narrativeSimulation,
        decisionKeys: input.decisionKeys,
        seed: session.seed,
        startingSequence: state.lastSequence,
      });
      const appended: SimulationEvent[] = [];
      const createdAt = Date.now();
      for (const [index, descriptor] of plan.descriptors.entries()) {
        const envelope = descriptor.commandEnvelope
          ? { commandId, baseSequence: input.baseSequence, baseStateHash }
          : {};
        const event: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: input.baseSequence + index + 1,
          type: descriptor.type,
          actorKey: descriptor.actorKey,
          targetKey: descriptor.targetKey,
          ...envelope,
          payloadJson: JSON.stringify({ ...descriptor.payload, ...envelope }),
          createdAt,
        };
        state = applySimulationEvent(state, event);
        appended.push(event);
      }
      for (const event of appended)
        event.id = (await db.simulationEvents.add(event)) as number;
      const stateJson = JSON.stringify(state);
      const throughSequence = appended[appended.length - 1].sequence;
      const checkpoint: SimulationCheckpoint = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        throughSequence,
        name: `第 ${settledTurn} 回合自动检查点`,
        stateJson,
        stateHash: await hashStateJson(stateJson),
        createdAt,
      };
      checkpoint.id = (await db.simulationCheckpoints.add(
        checkpoint,
      )) as number;
      await db.simulationSessions.update(session.id!, { updatedAt: createdAt });
      return { events: appended, checkpoint, state };
    },
  );
}

export type OpenWorldCommand =
  | {
      kind: "draw";
      trigger: import("../types").OpenWorldDiscoveryTrigger;
    }
  | {
      kind: "travel";
      edgeKey: string;
    }
  | {
      kind: "quest-decision";
      instanceKey: string;
      decision: "accept" | "decline";
    }
  | {
      kind: "tick";
    };

interface OpenWorldEventPlan {
  descriptors: Array<{
    type: SimulationEventType;
    actorKey?: string | null;
    targetKey?: string | null;
    payload: Record<string, unknown>;
  }>;
}

function normalizeOpenWorldCommand(
  command: OpenWorldCommand,
): OpenWorldCommand {
  if (command.kind === "draw") {
    if (
      !["observe", "social", "explore", "rest", "travel", "combat"].includes(
        command.trigger,
      )
    ) {
      throw new Error("[textworld] 发现触发类型无效。");
    }
    return { kind: "draw", trigger: command.trigger };
  }
  if (command.kind === "travel") {
    const edgeKey = command.edgeKey.trim();
    if (!edgeKey || edgeKey.length > 160)
      throw new Error("[textworld] 交通边 key 无效。");
    return { kind: "travel", edgeKey };
  }
  if (command.kind === "quest-decision") {
    const instanceKey = command.instanceKey.trim();
    if (
      !instanceKey ||
      instanceKey.length > 200 ||
      !["accept", "decline"].includes(command.decision)
    ) {
      throw new Error("[textworld] 任务决策无效。");
    }
    return { kind: "quest-decision", instanceKey, decision: command.decision };
  }
  if (command.kind === "tick") return { kind: "tick" };
  throw new Error("[textworld] 未知开放世界命令。");
}

function planOpenWorldCommand(input: {
  manifest: TextOpenWorldGameRuntimePackageV2;
  state: SimulationRuntimeState;
  seed: string;
  command: OpenWorldCommand;
}): OpenWorldEventPlan {
  if (
    !input.state.openWorld ||
    !input.state.adventure ||
    !input.state.narrativeSimulation
  ) {
    throw new Error("[textworld] 实例缺少开放世界、冒险或模拟冻结状态。");
  }
  const common = {
    content: input.manifest.openWorld,
    state: input.state.openWorld,
    startingSequence: input.state.lastSequence,
  };
  if (input.command.kind === "draw") {
    return planOpenWorldDraw({
      ...common,
      simulation: input.manifest.simulation,
      adventure: input.state.adventure,
      trigger: input.command.trigger,
      seed: input.seed,
    });
  }
  if (input.command.kind === "travel") {
    return planOpenWorldTravel({ ...common, edgeKey: input.command.edgeKey });
  }
  if (input.command.kind === "quest-decision") {
    return planOpenWorldQuestDecision({
      ...common,
      simulation: input.manifest.simulation,
      instanceKey: input.command.instanceKey,
      decision: input.command.decision,
    });
  }
  return planOpenWorldTick({
    ...common,
    simulation: input.manifest.simulation,
    seed: input.seed,
  });
}

/** TEXTWORLD-1 authoritative command path. Every command expands to replayable
 * shared adventure/world events, a verified narrative projection, and one
 * atomic checkpoint. */
export async function commitOpenWorldCommand(input: {
  sessionId: number;
  command: OpenWorldCommand;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<{
  events: SimulationEvent[];
  checkpoint: SimulationCheckpoint;
  state: SimulationRuntimeState;
}> {
  const commandId = normalizeCommandId(input.commandId);
  const command = normalizeOpenWorldCommand(input.command);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[textworld] 命令基线无效。");
  }
  const previewSession = await db.simulationSessions.get(input.sessionId);
  if (
    !previewSession ||
    previewSession.kind !== "textworld" ||
    (previewSession.gameReleaseId == null && previewSession.gameBuildId == null)
  ) {
    throw new Error("[textworld] 正式文字开放世界实例不存在。");
  }
  const [frozen, previewEvents] = await Promise.all([
    verifyFormalPlayableSourceV1(previewSession, ["text-open-world"]),
    readSessionEvents(previewSession),
  ]);
  const previewManifest = frozen.runtimePackage as TextOpenWorldGameRuntimePackageV2;
  if (
    !previewManifest.openWorld ||
    !previewManifest.adventure ||
    !previewManifest.simulation ||
    !previewManifest.interaction
  ) {
    throw new Error("[textworld] 冻结 Product RuntimePackage 缺少开放世界模块闭包。");
  }
  const previewState = replaySimulationEvents(
    parseSimulationState(previewSession.initialStateJson),
    previewEvents,
  );
  const prior = previewEvents.find((event) => event.commandId === commandId);
  if (
    !prior &&
    (previewState.lastSequence !== input.baseSequence ||
      (await hashStateJson(JSON.stringify(previewState))) !== baseStateHash)
  ) {
    throw new Error("[textworld] 世界状态已变化，请刷新后重试。");
  }
  if (!prior)
    planOpenWorldCommand({
      manifest: previewManifest,
      state: previewState,
      seed: previewSession.seed,
      command,
    });
  const checkpointName =
    commandId.length <= 190
      ? `TEXTWORLD:${commandId}`
      : `TEXTWORLD:${commandId.slice(0, 120)}:${(await hashStateJson(JSON.stringify(commandId))).slice(0, 64)}`;

  return db.transaction(
    "rw",
    [
      db.simulationSessions,
      db.simulationEvents,
      db.simulationCheckpoints,
      db.gameReleases,
      db.gameBuilds,
      db.gameProductions,
      db.gameProductionBriefs,
    ],
    async () => {
      const session = await db.simulationSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "textworld" ||
        (session.gameReleaseId == null && session.gameBuildId == null)
      ) {
        throw new Error("[textworld] 正式文字开放世界实例不存在。");
      }
      await assertFormalPlayableSourceUnchangedV1({
        previewSession,
        session,
        frozen,
      });
      const manifest = previewManifest;
      const events = await readSessionEvents(session);
      const existing = events.find((event) => event.commandId === commandId);
      if (existing) {
        const payload = parseEventPayload(existing);
        if (
          existing.baseSequence !== input.baseSequence ||
          existing.baseStateHash !== baseStateHash ||
          stableJson(payload.worldCommand) !== stableJson(command)
        ) {
          throw new Error("[textworld] commandId 已被不同命令使用。");
        }
        const checkpoint = await db.simulationCheckpoints
          .where("sessionId")
          .equals(session.id!)
          .filter((item) => item.name === checkpointName)
          .first();
        if (!checkpoint || checkpoint.throughSequence < existing.sequence) {
          throw new Error("[textworld] 已提交命令缺少检查点。");
        }
        return {
          events: events.filter(
            (event) =>
              event.sequence >= existing.sequence &&
              event.sequence <= checkpoint.throughSequence,
          ),
          checkpoint,
          state: parseSimulationState(checkpoint.stateJson),
        };
      }
      if (session.status !== "active")
        throw new Error("[textworld] 只有 active 实例可以提交命令。");
      let state = replaySimulationEvents(
        parseSimulationState(session.initialStateJson),
        events,
      );
      if (
        state.lastSequence !== input.baseSequence ||
        state.lastSequence !== previewState.lastSequence ||
        (await hashStateJson(JSON.stringify(state))) !== baseStateHash
      ) {
        throw new Error("[textworld] 世界状态已变化，请刷新后重试。");
      }
      if (
        !state.openWorld ||
        !state.adventure ||
        !state.narrativeSimulation ||
        state.openWorld.contentHash !== frozen.packageHash ||
        state.adventure.contentHash !== frozen.packageHash ||
        state.narrativeSimulation.contentHash !== frozen.packageHash
      ) {
        throw new Error("[textworld] 实例冻结状态与 Product Release/Build 不一致。");
      }
      const plan = planOpenWorldCommand({
        manifest,
        state,
        seed: session.seed,
        command,
      });
      const appended: SimulationEvent[] = [];
      const createdAt = Date.now();
      const append = (
        descriptor: OpenWorldEventPlan["descriptors"][number],
        envelope = false,
      ) => {
        const commandEnvelope = envelope
          ? { commandId, baseSequence: input.baseSequence, baseStateHash }
          : {};
        const event: SimulationEvent = {
          projectId: session.projectId,
          worldGroupId: session.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: state.lastSequence + 1,
          type: descriptor.type,
          actorKey: descriptor.actorKey ?? null,
          targetKey: descriptor.targetKey ?? null,
          ...commandEnvelope,
          payloadJson: JSON.stringify({
            ...descriptor.payload,
            ...(envelope ? { worldCommand: command } : {}),
          }),
          createdAt,
        };
        state = applySimulationEvent(state, event);
        appended.push(event);
      };
      for (const [index, descriptor] of plan.descriptors.entries())
        append(descriptor, index === 0);
      append({
        type: "world.narrative.synced",
        payload: {
          projection: openWorldMainlineProjection(
            state.openWorld!,
            state.openWorld!.mainlineQuestKeys,
          ),
        },
      });
      for (const event of appended)
        event.id = (await db.simulationEvents.add(event)) as number;
      const stateJson = JSON.stringify(state);
      const checkpoint: SimulationCheckpoint = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        throughSequence: state.lastSequence,
        name: checkpointName,
        stateJson,
        stateHash: await hashStateJson(stateJson),
        createdAt,
      };
      checkpoint.id = (await db.simulationCheckpoints.add(
        checkpoint,
      )) as number;
      await db.simulationSessions.update(session.id!, { updatedAt: createdAt });
      return { events: appended, checkpoint, state };
    },
  );
}

async function hashStateJson(stateJson: string): Promise<string> {
  const data = new TextEncoder().encode(stateJson);
  const digestPromise = crypto.subtle.digest("SHA-256", data);
  const digest = Dexie.currentTransaction
    ? await Dexie.waitFor(digestPromise)
    : await digestPromise;
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createSimulationCheckpoint(input: {
  sessionId: number;
  name: string;
  throughSequence?: number;
}): Promise<SimulationCheckpoint> {
  const session = await db.simulationSessions.get(input.sessionId);
  if (!session) throw new Error("模拟会话不存在。");
  const events = await readSessionEvents(session);
  const latest = events.reduce(
    (max, event) => Math.max(max, event.sequence),
    0,
  );
  const throughSequence = input.throughSequence ?? latest;
  if (
    !Number.isInteger(throughSequence) ||
    throughSequence < 0 ||
    throughSequence > latest
  ) {
    throw new Error("检查点序号不在会话事件范围内。");
  }
  const state = replaySimulationEvents(
    parseSimulationState(session.initialStateJson),
    events,
    throughSequence,
  );
  const stateJson = JSON.stringify(state);
  const name = input.name.trim() || `检查点 ${throughSequence}`;
  if (name.length > 200) throw new Error("检查点名称不能超过 200 个字符。");
  const checkpoint: SimulationCheckpoint = {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    throughSequence,
    name,
    stateJson,
    stateHash: await hashStateJson(stateJson),
    createdAt: Date.now(),
  };
  checkpoint.id = (await db.simulationCheckpoints.add(checkpoint)) as number;
  return checkpoint;
}

export async function verifySimulationCheckpoint(
  checkpointId: number,
): Promise<boolean> {
  const checkpoint = await db.simulationCheckpoints.get(checkpointId);
  if (!checkpoint) return false;
  const session = await db.simulationSessions.get(checkpoint.sessionId);
  if (
    !session ||
    session.projectId !== checkpoint.projectId ||
    (session.worldGroupId ?? null) !== (checkpoint.worldGroupId ?? null)
  )
    return false;
  const replayed = await readSimulationState(
    checkpoint.sessionId,
    checkpoint.throughSequence,
  );
  const stateJson = JSON.stringify(replayed);
  return (
    stateJson === checkpoint.stateJson &&
    (await hashStateJson(stateJson)) === checkpoint.stateHash
  );
}

async function cloneTtrpgRuntimeMediaRequestsForBranchV1(input: {
  parent: SimulationSession;
  child: SimulationSession;
  throughSequence: number;
  state: SimulationRuntimeState;
  events: SimulationEvent[];
}): Promise<void> {
  const media = input.state.ttrpg?.product?.media;
  if (
    !media ||
    input.parent.id == null ||
    input.child.id == null ||
    input.child.worldId == null ||
    input.child.workId == null
  )
    return;
  const reflectedSlots = media.slots.filter(
    (slot) => slot.requestKey != null && slot.status !== "placeholder",
  );
  if (reflectedSlots.length === 0) return;
  const parentRows = await db.ttrpgRuntimeAssetRequests
    .where("sessionId")
    .equals(input.parent.id)
    .toArray();
  const now = Date.now();
  const rows: TtrpgRuntimeAssetRequestRecordV1[] = reflectedSlots.map(
    (slot) => {
      const source = parentRows.find(
        (row) =>
          row.requestKey === slot.requestKey && row.slotKey === slot.slotKey,
      );
      if (!source)
        throw new Error(`TTRPG 分支缺少媒资请求证据:${slot.requestKey}`);
      const failuresThroughBranch = input.events.filter((event) => {
        if (
          event.sequence > input.throughSequence ||
          event.type !== "ttrpg.media.failed"
        )
          return false;
        try {
          return JSON.parse(event.payloadJson).requestKey === slot.requestKey;
        } catch {
          return false;
        }
      }).length;
      const available = slot.status === "available";
      const status = slot.status as Exclude<
        TtrpgRuntimeAssetRequestRecordV1["status"],
        "generating"
      >;
      const cloned: TtrpgRuntimeAssetRequestRecordV1 = {
        ...source,
        projectId: input.child.projectId,
        worldGroupId: input.child.worldGroupId ?? null,
        worldId: input.child.worldId!,
        workId: input.child.workId!,
        sessionId: input.child.id!,
        status,
        attemptCount: Math.min(
          source.maximumAttempts,
          failuresThroughBranch + (available ? 1 : 0),
        ),
        actualCostUsd: available ? source.actualCostUsd : null,
        mediaAssetId: available ? slot.mediaAssetId : null,
        mediaAssetVersion: available ? slot.mediaAssetVersion : null,
        mediaContentHash: available ? slot.mediaContentHash : null,
        processorLeaseId: null,
        processorLeaseExpiresAt: null,
        lastErrorCode: slot.status === "failed" ? slot.lastErrorCode : null,
        lastErrorDetail: null,
        terminalEventSequence: ["available", "failed", "cancelled"].includes(
          slot.status,
        )
          ? slot.updatedAtSequence
          : null,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      };
      delete cloned.id;
      return cloned;
    },
  );
  await db.ttrpgRuntimeAssetRequests.bulkAdd(rows);
}

export interface BranchSimulationSessionInputV1 {
  parentSessionId: number;
  throughSequence: number;
  title: string;
  seed?: string;
}

async function branchSimulationSessionInternal(
  input: BranchSimulationSessionInputV1,
  options: { allowFormalFixture: boolean },
): Promise<SimulationSession> {
  const parent = await db.simulationSessions.get(input.parentSessionId);
  if (!parent) throw new Error("父模拟会话不存在。");
  const events = await readSessionEvents(parent);
  const latest = events.reduce(
    (max, event) => Math.max(max, event.sequence),
    0,
  );
  if (
    !Number.isInteger(input.throughSequence) ||
    input.throughSequence < 0 ||
    input.throughSequence > latest
  )
    throw new Error("分支序号不在父会话事件范围内。");
  const state = replaySimulationEvents(
    parseSimulationState(parent.initialStateJson),
    events,
    input.throughSequence,
  );
  if (state.interaction) {
    state.interaction = rebaseInteractionStateForBranch(
      state.interaction,
      input.throughSequence,
    );
  }
  if (state.narrativeSimulation) {
    state.narrativeSimulation = rebaseNarrativeSimulationStateForBranch(
      state.narrativeSimulation,
    );
  }
  if (state.openWorld) {
    state.openWorld = rebaseOpenWorldStateForBranch(state.openWorld);
  }
  state.lastSequence = 0;
  const childInput: CreateSimulationSessionInput = {
    projectId: parent.projectId,
    worldGroupId: parent.worldGroupId ?? null,
    kind: parent.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: parseJsonObject(parent.canonSnapshotJson, "Canon 冻结快照"),
    initialState: state,
  };
  const parentBuild =
    parent.gameBuildId == null
      ? null
      : await db.gameBuilds.get(parent.gameBuildId);
  const child =
    (parent.kind === "storygame" ||
      parent.kind === "chatgame" ||
      parent.kind === "textadventure" ||
      parent.kind === "avg" ||
      parent.kind === "textsimulation" ||
      parent.kind === "textworld" ||
      parent.kind === "ttrpg") &&
    parent.gameReleaseId != null &&
    parent.worldId != null &&
    parent.workId != null
      ? await createReleasedGameSession({
          ...childInput,
          worldId: parent.worldId,
          workId: parent.workId,
          gameReleaseId: parent.gameReleaseId,
          origin: "branch",
        })
      : (parent.kind === "storygame" ||
            parent.kind === "chatgame" ||
            parent.kind === "textadventure" ||
            parent.kind === "avg" ||
            parent.kind === "textsimulation" ||
            parent.kind === "textworld" ||
            parent.kind === "ttrpg") &&
          parent.gameBuildId != null &&
          parentBuild &&
          parent.runtimeSourceHash &&
          parent.worldId != null &&
          parent.workId != null
        ? await createPreviewGameSession({
            ...childInput,
            worldId: parent.worldId,
            workId: parent.workId,
            gameBuildId: parent.gameBuildId,
            expectedPreviewHash: parentBuild.previewHash,
            runtimeSourceHash: parent.runtimeSourceHash,
            origin: "branch",
          })
        : options.allowFormalFixture && isFormalProductSessionKindV1(parent.kind)
          ? await insertSimulationSession(childInput)
          : await createSimulationSession(childInput);
  await db.simulationSessions.update(child.id!, {
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
    worldId: parent.worldId ?? null,
    workId: parent.workId ?? null,
    gameReleaseId: parent.gameReleaseId ?? null,
    gameBuildId: parent.gameBuildId ?? null,
    runtimeSourceHash: parent.runtimeSourceHash ?? null,
  });
  const boundChild = {
    ...child,
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
    worldId: parent.worldId ?? null,
    workId: parent.workId ?? null,
    gameReleaseId: parent.gameReleaseId ?? null,
    gameBuildId: parent.gameBuildId ?? null,
    runtimeSourceHash: parent.runtimeSourceHash ?? null,
  };
  if (parent.kind === "ttrpg") {
    try {
      await cloneTtrpgSessionParticipantsV2({
        parentSessionId: parent.id!,
        child: boundChild,
      });
    } catch (cause) {
      throw new Error(
        `TTRPG 分支复制席位失败:${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    try {
      await cloneTtrpgRuntimeMediaRequestsForBranchV1({
        parent,
        child: boundChild,
        throughSequence: input.throughSequence,
        state,
        events,
      });
    } catch (cause) {
      throw new Error(
        `TTRPG 分支复制媒资队列失败:${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  return boundChild;
}

export async function branchSimulationSession(
  input: BranchSimulationSessionInputV1,
): Promise<SimulationSession> {
  return branchSimulationSessionInternal(input, { allowFormalFixture: false });
}

/** Regression-only companion for sessions created by
 * createSimulationSessionFixtureV1. Formal release/build branches still take
 * the normal immutable launch paths before this fallback is considered. */
export async function branchSimulationSessionFixtureV1(
  input: BranchSimulationSessionInputV1,
): Promise<SimulationSession> {
  if (import.meta.env.MODE !== "test") {
    throw new Error("branchSimulationSessionFixtureV1 仅允许隔离测试环境使用。");
  }
  return branchSimulationSessionInternal(input, { allowFormalFixture: true });
}

export async function deleteSimulationSession(
  sessionId: number,
): Promise<void> {
  await db.transaction(
    "rw",
    transactionTablesForReferenceCascade("simulationSessions"),
    async () => {
      // Preserve child ids before the registered parentSessionId setNull runs;
      // parentThroughSequence is the companion provenance field and must be
      // cleared in the same lifecycle operation.
      const children = await db.simulationSessions
        .where("parentSessionId")
        .equals(sessionId)
        .toArray();
      // PROJECT_TABLES is authoritative for runtime-owned extensions such as the
      // unified Harness ledger. Cascading the registered references keeps this
      // lifecycle complete without a second hand-written run/event table list.
      await cascadeRegisteredReferences("simulationSessions", sessionId);
      await db.simulationEvents.where("sessionId").equals(sessionId).delete();
      await db.simulationCheckpoints
        .where("sessionId")
        .equals(sessionId)
        .delete();
      for (const child of children) {
        if (child.id != null) {
          await db.simulationSessions.update(child.id, {
            parentSessionId: null,
            parentThroughSequence: null,
          });
        }
      }
      await db.simulationSessions.delete(sessionId);
    },
  );
}
