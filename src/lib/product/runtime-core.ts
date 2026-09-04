/** Product-neutral session, event-log, checkpoint and projection infrastructure. */
import Dexie from "dexie";
import { assertProductReleaseUnchanged } from "./releases";
import { cascadeRegisteredReferences } from "../workspace/lifecycle";
import { db } from "../db/schema";
import { evaluateNarrativeChoices, applyNarrativeChoiceEffects } from "./narrative-content";
import { normalizeProductRuntimeCommandIdV1 } from "./runtime-command-id";
import { assertProductRuntimeIntegerV1, isProductRuntimeJsonObjectV1, stableProductRuntimeJsonV1, type ProductRuntimeJsonObjectV1 } from "./runtime-values";
import { parseNarrativeCondition, parseNarrativeEffects, evaluateNarrativeCondition, applyNarrativeEffects } from "../narrative/blueprint";
import { transactionTablesForReferenceCascade } from "../registry/lifecycle";
import { type ProductRuntimeKind, type ProductRuntimeState, type FrozenNarrativeBeat, NARRATIVE_BEAT_KINDS, type FrozenNarrativeChoice, type ProductNarrativeRuntimeNodeSnapshot, NARRATIVE_NODE_KINDS, type ProductNarrativeRuntimeState, NARRATIVE_MODULE_KINDS, type NarrativeChoiceHistoryEntry, type RuntimeAttributes, type RuntimeEntityState, RUNTIME_ENTITY_KINDS, RUNTIME_LIFECYCLE_STATUSES, type RuntimeMemory, type ProductRuntimeEvent, PRODUCT_RUNTIME_EVENT_TYPES, type ProductRuntimeSession, PRODUCT_RUNTIME_KINDS, EMPTY_PRODUCT_RUNTIME_STATE, type ProductRuntimePackageV1, type ProductRuntimeEventType, type ProductRelease, type ProductBuildRecordV1, type ProductProductionRecordV1, type ProductProductionBriefRecordV1, type ProductRuntimeCheckpoint } from "../types";
import { verifyProductReleaseManifestV1 } from "../product-production/runtime-package";
import { verifyProductRuntimeSource, verifyProductRuntimeSessionSourceV1 } from "../product-production/preview-source";
import {
  applyProductOwnedRuntimeEventV1,
  assertProductNarrativeChoiceReadyV1,
  assertFrozenProductRuntimeStateV1,
  cloneProductRuntimeBranchExtensionsV1,
  parseProductOwnedRuntimeStateV1,
  rebaseProductRuntimeStateForBranchV1,
} from "./runtime-product-adapters";
export type JsonObject = ProductRuntimeJsonObjectV1;
export const stableJson = stableProductRuntimeJsonV1;

export interface CreateProductRuntimeSessionInput {
  projectId: number;
  worldGroupId?: number | null;
  kind: ProductRuntimeKind;
  title: string;
  seed?: string;
  canonSnapshot?: unknown;
  initialState?: ProductRuntimeState;
}

export interface CreateReleasedProductRuntimeSessionInput extends CreateProductRuntimeSessionInput {
  worldId: number;
  workId: number;
  productReleaseId: number;
  /** New games must match the release entry state; validated branches preserve a replayed mid-game state. */
  origin: "release" | "branch";
}

export interface CreatePreviewProductRuntimeSessionInput extends CreateProductRuntimeSessionInput {
  worldId: number;
  workId: number;
  productBuildId: number;
  expectedPreviewHash: string;
  runtimeSourceHash: string;
  /** New previews start at entry; branches preserve an already replayed state. */
  origin: "preview" | "branch";
}

export const isObject = isProductRuntimeJsonObjectV1;

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

export const assertFiniteInteger = assertProductRuntimeIntegerV1;

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

function parseProductNarrativeRuntimeNode(
  value: unknown,
): ProductNarrativeRuntimeNodeSnapshot {
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
    kind: kind as ProductNarrativeRuntimeNodeSnapshot["kind"],
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

function parseProductNarrativeRuntimeState(
  value: unknown,
): ProductNarrativeRuntimeState | null {
  if (value == null) return null;
  if (
    !isObject(value) ||
    value.schema !== "storyforge.product-narrative-runtime" ||
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
  const nodes = value.nodes.map(parseProductNarrativeRuntimeNode);
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
    schema: "storyforge.product-narrative-runtime" as const,
    version: 2 as const,
    moduleKind: moduleKind as ProductNarrativeRuntimeState["moduleKind"],
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
  narrative: ProductNarrativeRuntimeState,
  targetKey: string,
  options: {
    variables?: Record<string, unknown>;
    eventSequence?: number;
    selectedChoiceKey?: string;
  } = {},
): ProductNarrativeRuntimeState {
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
  narrative: ProductNarrativeRuntimeState,
  choiceKey: string,
  eventSequence: number,
): ProductNarrativeRuntimeState {
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

export function parseProductRuntimeState(
  value: string | ProductRuntimeState,
): ProductRuntimeState {
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
    narrative: parseProductNarrativeRuntimeState(parsed.narrative),
    ...parseProductOwnedRuntimeStateV1(parsed as ProductRuntimeState),
    lastSequence,
  };
}

export function cloneState(state: ProductRuntimeState): ProductRuntimeState {
  return structuredClone(state);
}

export function parseEventPayload(event: ProductRuntimeEvent): JsonObject {
  if (!PRODUCT_RUNTIME_EVENT_TYPES.includes(event.type)) {
    throw new Error(`未知演化事件类型: ${event.type}`);
  }
  return parseJsonObject(event.payloadJson, `演化事件 ${event.type}`);
}

export function applyProductRuntimeEvent(
  current: ProductRuntimeState,
  event: ProductRuntimeEvent,
): ProductRuntimeState {
  const state = cloneState(parseProductRuntimeState(current));
  if (event.sequence !== state.lastSequence + 1) {
    throw new Error(
      `演化事件序号不连续: 期望 ${state.lastSequence + 1}，收到 ${event.sequence}`,
    );
  }
  const payload = parseEventPayload(event);
  const productState = applyProductOwnedRuntimeEventV1(state, event, payload);
  if (productState) return productState;
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
        throw new Error("ProductRelease 叙事启动事件无效。");
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
        throw new Error("ProductRelease 节点进入事件无效。");
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
      // A node may legally point back to itself. Narrative state records a new
      // visit even when the stable node key is unchanged, so AVG presentation
      // must also start that visit before its first Beat. Without this reset a
      // self-loop inherited the prior visit's currentBeatKey and skipped the
      // entire scene on replay and in the live player.
      if (state.presentation) {
        state.presentation.currentNodeKey = nodeKey;
        state.presentation.currentBeatKey = null;
      }
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
        throw new Error("当前会话没有可提交选择的 ProductRelease 叙事。");
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
  }
  state.lastSequence = event.sequence;
  return state;
}

export function replayProductRuntimeEvents(
  initialState: ProductRuntimeState,
  events: readonly ProductRuntimeEvent[],
  throughSequence = Number.MAX_SAFE_INTEGER,
): ProductRuntimeState {
  let state = cloneState(parseProductRuntimeState(initialState));
  const ordered = [...events]
    .filter((event) => event.sequence <= throughSequence)
    .sort((a, b) => a.sequence - b.sequence);
  for (const event of ordered) state = applyProductRuntimeEvent(state, event);
  return state;
}

async function assertSessionWorkspace(input: {
  projectId: number;
}): Promise<void> {
  if (!(await db.projects.get(input.projectId)))
    throw new Error("产品运行会话所属项目不存在。");
}

function defaultSeed(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

async function prepareProductRuntimeSessionRecord(
  input: CreateProductRuntimeSessionInput,
  binding: Pick<ProductRuntimeSession, "worldId" | "workId" | "runtimeSourceHash"> & (
    | { productReleaseId: number; productBuildId: null }
    | { productReleaseId: null; productBuildId: number }
  ),
): Promise<ProductRuntimeSession> {
  await assertSessionWorkspace(input);
  if (!PRODUCT_RUNTIME_KINDS.includes(input.kind))
    throw new Error("未知产品运行会话类型。");
  const title = input.title.trim();
  if (!title || title.length > 200) throw new Error("产品运行会话标题无效。");
  const initialState = parseProductRuntimeState(
    input.initialState ?? EMPTY_PRODUCT_RUNTIME_STATE,
  );
  if (initialState.lastSequence !== 0)
    throw new Error("ProductRuntime 初始状态 lastSequence 必须为 0。");
  const canonSnapshot = input.canonSnapshot ?? { version: 1, sources: [] };
  if (!isObject(canonSnapshot)) throw new Error("Canon 冻结快照必须是对象。");
  const now = Date.now();
  const initialStateJson = JSON.stringify(initialState);
  const session: ProductRuntimeSession = {
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

const preparedProductRuntimeSessionsV1 = new WeakSet<object>();

/**
 * Prepares and cryptographically verifies a Release-owned session before its
 * caller opens the atomic session/event transaction. No WebCrypto work is left
 * for the commit phase.
 */
export async function prepareReleasedProductRuntimeSessionRecordV1(
  input: CreateReleasedProductRuntimeSessionInput,
): Promise<ProductRuntimeSession> {
  const productRelease = await assertProductReleaseUnchanged(input.productReleaseId);
  if (
    productRelease.projectId !== input.projectId ||
    productRelease.worldId !== input.worldId ||
    productRelease.workId !== input.workId
  ) {
    throw new Error("上层产品的 ProductRelease 绑定无效。");
  }
  const manifest = await verifyProductReleaseManifestV1(productRelease.manifestJson);
  validateFrozenRuntimePackageSession({
    session: input,
    runtimePackage: manifest.runtimePackage,
    runtimeSourceHash: manifest.packageHash,
    origin: input.origin,
  });
  const session = await prepareProductRuntimeSessionRecord(input, {
    worldId: input.worldId,
    workId: input.workId,
    productReleaseId: input.productReleaseId,
    productBuildId: null,
    runtimeSourceHash: manifest.packageHash,
  });
  preparedProductRuntimeSessionsV1.add(session);
  return session;
}

/** Prepare a governed Build-preview session before the atomic commit phase. */
export async function preparePreviewProductRuntimeSessionRecordV1(
  input: CreatePreviewProductRuntimeSessionInput,
): Promise<ProductRuntimeSession> {
  const verified = await verifyProductRuntimeSource({
    scope: {
      projectId: input.projectId,
      worldId: input.worldId,
      workId: input.workId,
    },
    source: {
      kind: "build",
      productBuildId: input.productBuildId,
      expectedPreviewHash: input.expectedPreviewHash,
    },
  });
  if (verified.runtimeSourceHash !== input.runtimeSourceHash) {
    throw new Error("上层产品的 Build Preview 冻结绑定无效。");
  }
  validateFrozenRuntimePackageSession({
    session: input,
    runtimePackage: verified.runtimePackage,
    runtimeSourceHash: verified.runtimeSourceHash,
    origin: input.origin,
  });
  const session = await prepareProductRuntimeSessionRecord(input, {
    worldId: input.worldId,
    workId: input.workId,
    productReleaseId: null,
    productBuildId: input.productBuildId,
    runtimeSourceHash: verified.runtimeSourceHash,
  });
  preparedProductRuntimeSessionsV1.add(session);
  return session;
}

/** Commit-only half of the formal session boundary. */
export async function insertPreparedProductRuntimeSessionV1(
  session: ProductRuntimeSession,
): Promise<ProductRuntimeSession> {
  if (session.id != null || !preparedProductRuntimeSessionsV1.has(session)) {
    throw new Error("未经验证准备的正式产品会话不得写入。");
  }
  session.id = (await db.productRuntimeSessions.add(session)) as number;
  preparedProductRuntimeSessionsV1.delete(session);
  return session;
}

function sessionKindForProduct(
  productType: ProductRuntimePackageV1["productType"],
): ProductRuntimeKind {
  return productType;
}

function validateFrozenRuntimePackageSession(input: {
  session: CreateProductRuntimeSessionInput;
  runtimePackage: ProductRuntimePackageV1;
  runtimeSourceHash: string;
  origin: "release" | "preview" | "branch";
}): void {
  const { runtimePackage, runtimeSourceHash } = input;
  if (
    input.session.kind !== sessionKindForProduct(runtimePackage.productType)
  ) {
    throw new Error(`${runtimePackage.productType} 与会话类型不匹配。`);
  }
  const initial = parseProductRuntimeState(
    input.session.initialState ?? EMPTY_PRODUCT_RUNTIME_STATE,
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
    throw new Error("上层产品初始叙事必须来自绑定 RuntimePackage 的冻结内容。");
  }
  assertFrozenProductRuntimeStateV1({
    initial,
    runtimePackage,
    runtimeSourceHash,
    origin: input.origin,
  });
}

/** Formal immutable ProductRelease lower insertion boundary. */
export async function createReleasedProductRuntimeSession(
  input: CreateReleasedProductRuntimeSessionInput,
): Promise<ProductRuntimeSession> {
  return insertPreparedProductRuntimeSessionV1(
    await prepareReleasedProductRuntimeSessionRecordV1(input),
  );
}

/** Build Preview lower insertion boundary; no unbound runtime source may bypass it. */
export async function createPreviewProductRuntimeSession(
  input: CreatePreviewProductRuntimeSessionInput,
): Promise<ProductRuntimeSession> {
  return insertPreparedProductRuntimeSessionV1(
    await preparePreviewProductRuntimeSessionRecordV1(input),
  );
}

export async function readSessionEvents(
  session: ProductRuntimeSession,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<ProductRuntimeEvent[]> {
  const events = await db.productRuntimeEvents
    .where("sessionId")
    .equals(session.id!)
    .toArray();
  for (const event of events) {
    if (
      event.projectId !== session.projectId ||
      (event.worldGroupId ?? null) !== (session.worldGroupId ?? null)
    ) {
      throw new Error(`演化事件 ${event.id ?? "?"} 作用域与会话不一致。`);
    }
  }
  return events.filter((event) => event.sequence <= throughSequence);
}

interface ProductRuntimeHeadV1 {
  state: ProductRuntimeState;
  stateJson: string;
  stateHash: string;
  sequence: number;
  fromCache: boolean;
}

export async function readLatestSessionEventSequenceV1(
  sessionId: number,
): Promise<number> {
  const latest = await db.productRuntimeEvents
    .where("[sessionId+sequence]")
    .between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey])
    .last();
  return latest?.sequence ?? 0;
}

export async function readVerifiedProductRuntimeHeadV1(
  session: ProductRuntimeSession,
): Promise<ProductRuntimeHeadV1> {
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
      const state = parseProductRuntimeState(cachedJson);
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
  const state = replayProductRuntimeEvents(
    parseProductRuntimeState(session.initialStateJson),
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

export async function readProductRuntimeState(
  sessionId: number,
  throughSequence = Number.MAX_SAFE_INTEGER,
): Promise<ProductRuntimeState> {
  const session = await db.productRuntimeSessions.get(sessionId);
  if (!session) throw new Error("产品运行会话不存在。");
  if (throughSequence === Number.MAX_SAFE_INTEGER) {
    return (await readVerifiedProductRuntimeHeadV1(session)).state;
  }
  const events = await readSessionEvents(session, throughSequence);
  return replayProductRuntimeEvents(
    parseProductRuntimeState(session.initialStateJson),
    events,
    throughSequence,
  );
}

export async function appendBuiltEvent(
  sessionId: number,
  build: (input: {
    session: ProductRuntimeSession;
    state: ProductRuntimeState;
    events: ProductRuntimeEvent[];
    sequence: number;
  }) => Omit<
    ProductRuntimeEvent,
    "id" | "projectId" | "worldGroupId" | "sessionId" | "sequence" | "createdAt"
  >,
): Promise<ProductRuntimeEvent> {
  return db.transaction(
    "rw",
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    async () => {
      const session = await db.productRuntimeSessions.get(sessionId);
      if (!session) throw new Error("产品运行会话不存在。");
      if (session.status !== "active")
        throw new Error("只有 active 会话可以追加事件。");
      const events = await readSessionEvents(session);
      const state = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events,
      );
      const sequence = state.lastSequence + 1;
      const built = build({ session, state, events, sequence });
      const event: ProductRuntimeEvent = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId,
        sequence,
        ...built,
        createdAt: Date.now(),
      };
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      await db.productRuntimeSessions.update(sessionId, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}

export async function appendProductRuntimeEvent(input: {
  sessionId: number;
  type: ProductRuntimeEventType;
  actorKey?: string | null;
  targetKey?: string | null;
  payload: unknown;
}): Promise<ProductRuntimeEvent> {
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
  if (input.type.startsWith("open-world-evolution.")) {
    throw new Error("受治理的复杂演化事件只能通过对应的专用回合命令生成。");
  }
  if (input.type.startsWith("world.")) {
    throw new Error("受治理的开放世界事件只能通过对应的专用命令生成。");
  }
  if (
    input.type.startsWith("ttrpg.")
    || (input.type.startsWith("narrative.") && input.type !== "narrative.recorded")
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

export const normalizeCommandId = normalizeProductRuntimeCommandIdV1;

export async function readProductRuntimeStateVersion(sessionId: number): Promise<{
  sequence: number;
  stateHash: string;
}> {
  const session = await db.productRuntimeSessions.get(sessionId);
  if (!session) throw new Error("产品运行会话不存在。");
  const head = await readVerifiedProductRuntimeHeadV1(session);
  return {
    sequence: head.sequence,
    stateHash: head.stateHash,
  };
}

type VerifiedFormalRuntimeSourceV1 = {
  runtimePackage: ProductRuntimePackageV1;
  packageHash: string;
  source:
    | { kind: "release"; release: ProductRelease & { id: number } }
    | {
        kind: "build";
        build: ProductBuildRecordV1 & { id: number };
        production: ProductProductionRecordV1 & { id: number };
        brief: ProductProductionBriefRecordV1 & { id: number };
      };
};

/**
 * Product-neutral runtime source guard shared by every upper-product command.
 * A formal instance may bind one immutable Product Release or one governed
 * Build Preview; product commands must never reopen the WorldRelease directly.
 */
export async function verifyFormalRuntimeSourceV1(
  session: ProductRuntimeSession,
  allowedProductTypes: readonly ProductRuntimePackageV1["productType"][],
): Promise<VerifiedFormalRuntimeSourceV1> {
  const sourceCount = [session.productReleaseId, session.productBuildId]
    .filter((value) => value != null).length;
  if (
    sourceCount !== 1 ||
    session.worldId == null ||
    session.workId == null ||
    !session.runtimeSourceHash
  ) {
    throw new Error("[product-runtime] 正式实例没有唯一冻结 Product Release/Build 来源。");
  }
  const playable = await verifyProductRuntimeSessionSourceV1({
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
  if (session.productReleaseId != null) {
    const release = await db.productReleases.get(session.productReleaseId);
    if (!release?.id) throw new Error("[product-runtime] Product Release 已不存在。");
    return {
      runtimePackage: playable.runtimePackage,
      packageHash: playable.packageHash,
      source: { kind: "release", release: release as ProductRelease & { id: number } },
    };
  }
  const build = await db.productBuilds.get(session.productBuildId!);
  if (!build?.id) throw new Error("[product-runtime] Product Build 已不存在。");
  const [production, brief] = await Promise.all([
    db.productProductions.get(build.productionId),
    db.productProductionBriefs
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
      build: build as ProductBuildRecordV1 & { id: number },
      production: production as ProductProductionRecordV1 & { id: number },
      brief: brief as ProductProductionBriefRecordV1 & { id: number },
    },
  };
}

export async function assertFormalRuntimeSourceUnchangedV1(input: {
  previewSession: ProductRuntimeSession;
  session: ProductRuntimeSession;
  frozen: VerifiedFormalRuntimeSourceV1;
}): Promise<void> {
  const session = input.session;
  if (
    session.productReleaseId !== input.previewSession.productReleaseId ||
    session.productBuildId !== input.previewSession.productBuildId ||
    session.runtimeSourceHash !== input.frozen.packageHash ||
    session.seed !== input.previewSession.seed
  ) {
    throw new Error("[product-runtime] 实例冻结运行源在命令提交期间发生变化。");
  }
  if (input.frozen.source.kind === "release") {
    const release = await db.productReleases.get(input.frozen.source.release.id);
    if (!release || stableJson(release) !== stableJson(input.frozen.source.release)) {
      throw new Error("[product-runtime] Product Release 在命令提交期间发生变化。");
    }
    return;
  }
  const [build, production, brief] = await Promise.all([
    db.productBuilds.get(input.frozen.source.build.id),
    db.productProductions.get(input.frozen.source.production.id),
    db.productProductionBriefs.get(input.frozen.source.brief.id),
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
export async function hashProductRuntimeStateV1(
  state: ProductRuntimeState,
): Promise<string> {
  return hashStateJson(JSON.stringify(state));
}

export interface NarrativeChoiceCommitResultV1 {
  event: ProductRuntimeEvent;
  state: ProductRuntimeState;
  appendedEvents: ProductRuntimeEvent[];
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
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (!previewSession) throw new Error("产品运行会话不存在。");
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replayProductRuntimeEvents(
    parseProductRuntimeState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewStateHash = await hashStateJson(JSON.stringify(previewState));
  return db.transaction(
    "rw",
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (!session) throw new Error("产品运行会话不存在。");
      const prior = await db.productRuntimeEvents
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
          : replayProductRuntimeEvents(
              parseProductRuntimeState(session.initialStateJson),
              await readSessionEvents(session),
            );
        return { event: prior, state: currentState, appendedEvents: [] };
      }
      if (session.status !== "active")
        throw new Error("只有 active 会话可以提交选择。");
      const latest = await db.productRuntimeEvents
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
        throw new Error("当前会话没有可提交选择的 ProductRelease 叙事。");
      }
      if (!narrative.availableChoiceKeys?.includes(choiceKey))
        throw new Error("所选 Choice 当前不可用。");
      const choice = narrative.choices?.find(
        (item) => item.choiceKey === choiceKey,
      );
      if (!choice || choice.sourceNodeKey !== narrative.currentNodeKey)
        throw new Error("所选 Choice 不属于当前节点。");
      assertProductNarrativeChoiceReadyV1({ session, state, choice });
      const event: ProductRuntimeEvent = {
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
      let projected = applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      const enteredEvent: ProductRuntimeEvent = {
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
      projected = applyProductRuntimeEvent(projected, enteredEvent);
      enteredEvent.id = (await db.productRuntimeEvents.add(enteredEvent)) as number;
      let lastEvent = enteredEvent;
      const appendedEvents = [event, enteredEvent];
      if (projected.narrative?.completed) {
        const endingEvent: ProductRuntimeEvent = {
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
        projected = applyProductRuntimeEvent(projected, endingEvent);
        endingEvent.id = (await db.productRuntimeEvents.add(endingEvent)) as number;
        lastEvent = endingEvent;
        appendedEvents.push(endingEvent);
      }
      await db.productRuntimeSessions.update(input.sessionId, {
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
}): Promise<ProductRuntimeEvent> {
  return (await commitNarrativeChoiceWithState(input)).event;
}

export async function hashStateJson(stateJson: string): Promise<string> {
  const data = new TextEncoder().encode(stateJson);
  const digestPromise = crypto.subtle.digest("SHA-256", data);
  const digest = Dexie.currentTransaction
    ? await Dexie.waitFor(digestPromise)
    : await digestPromise;
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createProductRuntimeCheckpoint(input: {
  sessionId: number;
  name: string;
  throughSequence?: number;
}): Promise<ProductRuntimeCheckpoint> {
  const session = await db.productRuntimeSessions.get(input.sessionId);
  if (!session) throw new Error("产品运行会话不存在。");
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
  const state = replayProductRuntimeEvents(
    parseProductRuntimeState(session.initialStateJson),
    events,
    throughSequence,
  );
  const stateJson = JSON.stringify(state);
  const name = input.name.trim() || `检查点 ${throughSequence}`;
  if (name.length > 200) throw new Error("检查点名称不能超过 200 个字符。");
  const checkpoint: ProductRuntimeCheckpoint = {
    projectId: session.projectId,
    worldGroupId: session.worldGroupId ?? null,
    sessionId: session.id!,
    throughSequence,
    name,
    stateJson,
    stateHash: await hashStateJson(stateJson),
    createdAt: Date.now(),
  };
  checkpoint.id = (await db.productRuntimeCheckpoints.add(checkpoint)) as number;
  return checkpoint;
}

export async function verifyProductRuntimeCheckpoint(
  checkpointId: number,
): Promise<boolean> {
  const checkpoint = await db.productRuntimeCheckpoints.get(checkpointId);
  if (!checkpoint) return false;
  const session = await db.productRuntimeSessions.get(checkpoint.sessionId);
  if (
    !session ||
    session.projectId !== checkpoint.projectId ||
    (session.worldGroupId ?? null) !== (checkpoint.worldGroupId ?? null)
  )
    return false;
  const replayed = await readProductRuntimeState(
    checkpoint.sessionId,
    checkpoint.throughSequence,
  );
  const stateJson = JSON.stringify(replayed);
  return (
    stateJson === checkpoint.stateJson &&
    (await hashStateJson(stateJson)) === checkpoint.stateHash
  );
}

export interface BranchProductRuntimeSessionInputV1 {
  parentSessionId: number;
  throughSequence: number;
  title: string;
  seed?: string;
}

async function branchProductRuntimeSessionInternal(
  input: BranchProductRuntimeSessionInputV1,
): Promise<ProductRuntimeSession> {
  const parent = await db.productRuntimeSessions.get(input.parentSessionId);
  if (!parent) throw new Error("父产品运行会话不存在。");
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
  const state = replayProductRuntimeEvents(
    parseProductRuntimeState(parent.initialStateJson),
    events,
    input.throughSequence,
  );
  rebaseProductRuntimeStateForBranchV1(state, input.throughSequence);
  state.lastSequence = 0;
  const childInput: CreateProductRuntimeSessionInput = {
    projectId: parent.projectId,
    worldGroupId: parent.worldGroupId ?? null,
    kind: parent.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: parseJsonObject(parent.canonSnapshotJson, "Canon 冻结快照"),
    initialState: state,
  };
  let child: ProductRuntimeSession;
  if (parent.productReleaseId != null) {
    child = await createReleasedProductRuntimeSession({
      ...childInput,
      worldId: parent.worldId,
      workId: parent.workId,
      productReleaseId: parent.productReleaseId,
      origin: "branch",
    });
  } else {
    const parentBuild = await db.productBuilds.get(parent.productBuildId);
    if (!parentBuild) throw new Error("运行分支绑定的 Build Preview 不存在。");
    child = await createPreviewProductRuntimeSession({
      ...childInput,
      worldId: parent.worldId,
      workId: parent.workId,
      productBuildId: parent.productBuildId,
      expectedPreviewHash: parentBuild.previewHash,
      runtimeSourceHash: parent.runtimeSourceHash,
      origin: "branch",
    });
  }
  await db.productRuntimeSessions.update(child.id!, {
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
  });
  const boundChild = {
    ...child,
    parentSessionId: parent.id!,
    parentThroughSequence: input.throughSequence,
  };
  try {
    await cloneProductRuntimeBranchExtensionsV1({
      parent,
      child: boundChild,
      throughSequence: input.throughSequence,
      state,
      events,
    });
  } catch (cause) {
    throw new Error(
      `${parent.kind} 分支扩展复制失败:${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return boundChild;
}

export async function branchProductRuntimeSession(
  input: BranchProductRuntimeSessionInputV1,
): Promise<ProductRuntimeSession> {
  return branchProductRuntimeSessionInternal(input);
}

export async function deleteProductRuntimeSession(
  sessionId: number,
): Promise<void> {
  await db.transaction(
    "rw",
    transactionTablesForReferenceCascade("productRuntimeSessions"),
    async () => {
      // Preserve child ids before the registered parentSessionId setNull runs;
      // parentThroughSequence is the companion provenance field and must be
      // cleared in the same lifecycle operation.
      const children = await db.productRuntimeSessions
        .where("parentSessionId")
        .equals(sessionId)
        .toArray();
      // PROJECT_TABLES is authoritative for runtime-owned extensions such as the
      // unified Harness ledger. Cascading the registered references keeps this
      // lifecycle complete without a second hand-written run/event table list.
      await cascadeRegisteredReferences("productRuntimeSessions", sessionId);
      await db.productRuntimeEvents.where("sessionId").equals(sessionId).delete();
      await db.productRuntimeCheckpoints
        .where("sessionId")
        .equals(sessionId)
        .delete();
      for (const child of children) {
        if (child.id != null) {
          await db.productRuntimeSessions.update(child.id, {
            parentSessionId: null,
            parentThroughSequence: null,
          });
        }
      }
      await db.productRuntimeSessions.delete(sessionId);
    },
  );
}
