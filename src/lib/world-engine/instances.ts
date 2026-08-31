import { db } from "../db/schema";
import {
  assertRecordInScope,
  resolveScope,
  scopeTransactionTables,
} from "./scope";
import { assertReleaseUnchanged } from "./releases";
import {
  applySimulationEvent,
  createPreviewGameSession,
  createReleasedGameSession,
  createSimulationSession,
  insertPreparedTtrpgProductPreviewSessionV1,
  prepareTtrpgProductPreviewSessionV1,
  hashSimulationRuntimeStateV1,
  readSimulationState,
  withAdventureNarrativeProjection,
  withNarrativeSimulationProjection,
  withOpenWorldNarrativeProjection,
  type CreateSimulationSessionInput,
} from "../simulation/runtime";
import {
  assertPlayableWorldBundleRunnable,
  buildPlayableWorldBundleFromRelease,
} from "../simulation/canon-snapshot";
import {
  EMPTY_SIMULATION_STATE,
  type FrozenNarrativeBeat,
  type FrozenNarrativeChoice,
  type GameRuntimePackageV2,
  type NarrativeModule,
  type NarrativeNode,
  type PlayableGameSourceV1,
  type SimulationNarrativeNodeSnapshot,
  type SimulationNarrativeState,
  type SimulationRuntimeState,
  type SimulationSession,
  type SimulationSessionKind,
  type WorkspaceScope,
  type WorldRelease,
  type WorldReleaseManifestV2,
} from "../types";
import { createInitialInteractionState } from "../character-interaction/runtime";
import { createInitialAdventureState } from "../adventure/runtime";
import {
  applyNarrativeEffects,
  evaluateNarrativeCondition,
  parseNarrativeCondition,
  parseNarrativeEffects,
  validateNarrativeModule,
} from "../narrative/blueprint";
import { evaluateNarrativeChoices } from "../text-game/content";
import { assertGameReleaseUnchanged } from "../text-game/releases";
import { createInitialAvgPresentationState } from "../avg/runtime";
import { createInitialNarrativeSimulationState } from "../narrative-simulation/runtime";
import { createInitialOpenWorldState } from "../open-world/runtime";
import { createInitialTtrpgProductStateV1 } from "../ttrpg/runtime";
import { verifyPlayableGamePackageSource } from "../game-production/preview-source";
import {
  carryTtrpgContinuationParticipantsV2,
  installInitialTtrpgParticipantsV2,
} from "../ttrpg/participants";
import { parseRulePackV1 } from "../ttrpg/rule-pack";
import { parseTtrpgCampaignContentV1 } from "../ttrpg/campaign";
import {
  buildTtrpgContinuationStateV2,
  type TtrpgContinuationRequestV2,
} from "../ttrpg/continuity-state";
import { createTtrpgProductionBuildBootstrapV1 } from "../ttrpg/production-service";

export interface CreateWorldInstanceInput {
  scope: WorkspaceScope;
  kind: SimulationSessionKind;
  title: string;
  /** Unified immutable source; gameReleaseId remains a legacy call-shape adapter. */
  gameSource?: PlayableGameSourceV1;
  gameReleaseId?: number | null;
  releaseId?: number | null;
  draftSnapshotHash?: string | null;
  narrativeModuleId?: number | null;
  releaseNarrativeModuleExportId?: number | null;
  canonSnapshot?: unknown;
  initialState?: SimulationRuntimeState;
  worldGroupId?: number | null;
  seed?: string;
  /** Cross-release TTRPG continuation; requires a pre-reviewed plan hash. */
  ttrpgContinuation?: TtrpgContinuationRequestV2;
}

interface FrozenNarrativeDefinition {
  version: 1 | 2;
  sourceModuleId: number | null;
  sourceModuleExportId: number | null;
  moduleKind: NarrativeModule["kind"];
  moduleTitle: string;
  entryNodeKey: string;
  nodes: SimulationNarrativeNodeSnapshot[];
  sourceHash: string;
  contentHash?: string;
  beats?: FrozenNarrativeBeat[];
  choices?: FrozenNarrativeChoice[];
  initialVariables?: Record<string, unknown>;
}

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

async function sha256(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableJson(value)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function parseSuccessors(value: unknown, nodeKey: string): string[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`[instance] ${nodeKey} 的后继不是合法 JSON`);
    }
  }
  if (
    !Array.isArray(parsed) ||
    parsed.some((item) => typeof item !== "string" || !item.trim())
  ) {
    throw new Error(`[instance] ${nodeKey} 的后继必须是字符串数组`);
  }
  return parsed.map((item) => item.trim());
}

function freezeNode(
  row: NarrativeNode | Record<string, unknown>,
): SimulationNarrativeNodeSnapshot {
  const record = row as unknown as Record<string, unknown>;
  const key = String(record.key ?? "").trim();
  const conditionJson = String(record.conditionJson ?? "{}");
  const effectsJson = String(record.effectsJson ?? "[]");
  parseNarrativeCondition(conditionJson);
  parseNarrativeEffects(effectsJson);
  return {
    key,
    kind: record.kind as SimulationNarrativeNodeSnapshot["kind"],
    title: String(record.title ?? "").trim(),
    summary: String(record.summary ?? "").trim(),
    conditionJson,
    effectsJson,
    successorKeys: parseSuccessors(
      record.successorKeysJson ?? record.successorKeys ?? [],
      key,
    ),
  };
}

async function liveNarrativeBase(
  scope: WorkspaceScope,
  module: NarrativeModule,
): Promise<Omit<FrozenNarrativeDefinition, "sourceHash">> {
  const report = await validateNarrativeModule(scope, module.id!);
  if (!report.valid || !report.entryKey)
    throw new Error(`[instance] 叙事模块不可执行:${report.errors.join("；")}`);
  const nodes = (
    await db.narrativeNodes.where("moduleId").equals(module.id!).sortBy("order")
  ).map(freezeNode);
  return {
    version: 1,
    sourceModuleId: module.id!,
    sourceModuleExportId: null,
    moduleKind: module.kind,
    moduleTitle: module.title,
    entryNodeKey: report.entryKey,
    nodes,
  };
}

function gameReleaseNarrativeDefinition(
  runtimeSourceHash: string,
  runtimePackage: GameRuntimePackageV2,
  sourceModuleExportId: number | null,
): FrozenNarrativeDefinition {
  return {
    version: 2,
    sourceModuleId: null,
    sourceModuleExportId,
    moduleKind: runtimePackage.narrative.moduleKind,
    moduleTitle: runtimePackage.narrative.moduleTitle,
    entryNodeKey: runtimePackage.narrative.entryNodeKey,
    nodes: structuredClone(runtimePackage.narrative.nodes),
    sourceHash: runtimeSourceHash,
    contentHash: runtimeSourceHash,
    beats: structuredClone(runtimePackage.narrative.beats),
    choices: structuredClone(runtimePackage.narrative.choices),
    initialVariables: structuredClone(
      runtimePackage.definition.initialVariables,
    ),
  };
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

function isFormalGameKind(kind: SimulationSessionKind): boolean {
  return (
    kind === "storygame" ||
    kind === "chatgame" ||
    kind === "textadventure" ||
    kind === "avg" ||
    kind === "textsimulation" ||
    kind === "textworld"
  );
}

async function liveNarrativeDefinition(
  scope: WorkspaceScope,
  module: NarrativeModule,
): Promise<FrozenNarrativeDefinition> {
  const base = await liveNarrativeBase(scope, module);
  return { ...base, sourceHash: await sha256(base) };
}

function releaseManifest(release: WorldRelease): WorldReleaseManifestV2 {
  const manifest = JSON.parse(release.manifestJson) as WorldReleaseManifestV2;
  if (
    manifest.schema !== "storyforge.world-package" ||
    manifest.version !== 2
  ) {
    throw new Error("[instance] 发布版本没有可执行的 v2 清单");
  }
  return manifest;
}

function releaseNarrativeDefinition(
  release: WorldRelease,
  manifest: WorldReleaseManifestV2,
  exportId: number,
): FrozenNarrativeDefinition {
  const selected = manifest.selectedNarrativeModules.find(
    (item) => item.exportId === exportId,
  );
  if (!selected) throw new Error("[instance] 发布版本不包含所选叙事模块");
  const moduleRow = manifest.records.narrativeModules?.find(
    (raw) =>
      !!raw &&
      typeof raw === "object" &&
      (raw as Record<string, unknown>)._exportId === exportId,
  ) as Record<string, unknown> | undefined;
  if (!moduleRow) throw new Error("[instance] 发布版本缺少所选叙事模块记录");
  if (
    moduleRow.kind !== selected.kind ||
    String(moduleRow.title ?? "") !== selected.title
  ) {
    throw new Error("[instance] 发布叙事模块身份与选择清单不一致");
  }
  const nodes = (manifest.records.narrativeNodes ?? [])
    .filter(
      (raw) =>
        !!raw &&
        typeof raw === "object" &&
        (raw as Record<string, unknown>)._moduleExportId === exportId,
    )
    .map((raw) => freezeNode(raw as Record<string, unknown>));
  const entryNodeKey = String(moduleRow.entryNodeKey ?? "").trim();
  if (!entryNodeKey || !nodes.some((node) => node.key === entryNodeKey))
    throw new Error("[instance] 发布叙事缺少有效入口");
  const keys = new Set(nodes.map((node) => node.key));
  if (keys.size !== nodes.length)
    throw new Error("[instance] 发布叙事节点 key 重复");
  if (
    !nodes.some((node) => node.kind === "ending") ||
    nodes.some((node) => node.successorKeys.some((key) => !keys.has(key)))
  ) {
    throw new Error("[instance] 发布叙事缺少结局或存在悬空后继");
  }
  const reachable = new Set<string>();
  const queue = [entryNodeKey];
  while (queue.length) {
    const key = queue.shift()!;
    if (reachable.has(key)) continue;
    reachable.add(key);
    queue.push(...nodes.find((node) => node.key === key)!.successorKeys);
  }
  if (reachable.size !== nodes.length)
    throw new Error("[instance] 发布叙事存在入口不可达节点");
  return {
    version: 1,
    sourceModuleId: null,
    sourceModuleExportId: exportId,
    moduleKind: selected.kind,
    moduleTitle: selected.title,
    entryNodeKey,
    nodes,
    sourceHash: `${release.contentHash}:${exportId}`,
  };
}

function initialNarrativeState(
  definition: FrozenNarrativeDefinition,
): SimulationNarrativeState {
  const entry = definition.nodes.find(
    (node) => node.key === definition.entryNodeKey,
  );
  if (!entry) throw new Error("[instance] 冻结叙事入口不存在");
  const initialVariables = structuredClone(definition.initialVariables ?? {});
  if (
    !evaluateNarrativeCondition(
      parseNarrativeCondition(entry.conditionJson),
      initialVariables,
    )
  ) {
    throw new Error("[instance] 冻结叙事入口条件在初始状态下不成立");
  }
  const variables = applyNarrativeEffects(
    parseNarrativeEffects(entry.effectsJson),
    initialVariables,
  );
  const completed = entry.kind === "ending";
  const choiceEvaluations =
    definition.version === 2 && !completed
      ? evaluateNarrativeChoices(
          {
            ...variables,
            __visitedNodeKeys: [entry.key],
            __selectedChoiceKeys: [],
          },
          entry.key,
          definition.choices ?? [],
        )
      : [];
  const availableNodeKeys =
    definition.version === 2
      ? [
          ...new Set(
            choiceEvaluations
              .filter((choice) => choice.available)
              .map((choice) => choice.targetNodeKey),
          ),
        ]
      : entry.successorKeys.filter((key) => {
          const node = definition.nodes.find(
            (candidate) => candidate.key === key,
          )!;
          return evaluateNarrativeCondition(
            parseNarrativeCondition(node.conditionJson),
            variables,
          );
        });
  return {
    schema: "storyforge.simulation-narrative",
    version: definition.version,
    sourceModuleId: definition.sourceModuleId,
    sourceModuleExportId: definition.sourceModuleExportId,
    moduleKind: definition.moduleKind,
    moduleTitle: definition.moduleTitle,
    sourceHash: definition.sourceHash,
    nodes: structuredClone(definition.nodes),
    currentNodeKey: entry.key,
    visitedNodeKeys: [entry.key],
    availableNodeKeys,
    variables,
    completed,
    ...(definition.version === 2
      ? {
          contentHash: definition.contentHash!,
          beats: structuredClone(definition.beats ?? []),
          choices: structuredClone(definition.choices ?? []),
          visibleChoiceKeys: choiceEvaluations
            .filter((choice) => choice.visible)
            .map((choice) => choice.choiceKey),
          availableChoiceKeys: choiceEvaluations
            .filter((choice) => choice.available)
            .map((choice) => choice.choiceKey),
          choiceHistory: [],
          endingKey: completed ? entry.key : null,
          completedAtSequence: completed ? 0 : null,
          lastEnteredNodeSequence: null,
        }
      : {}),
  };
}

export async function createWorldInstance(
  input: CreateWorldInstanceInput,
): Promise<SimulationSession> {
  const initialScope = await resolveScope({ scope: input.scope });
  if (input.gameSource && input.gameReleaseId != null) {
    throw new Error(
      "[instance] 不能同时传入 gameSource 与 legacy gameReleaseId",
    );
  }
  const gameSource: PlayableGameSourceV1 | null =
    input.gameSource ??
    (input.gameReleaseId == null
      ? null
      : { kind: "release", gameReleaseId: input.gameReleaseId });
  const playable = gameSource
    ? await verifyPlayableGamePackageSource({
        scope: initialScope,
        source: gameSource,
      })
    : null;
  const gameRelease =
    gameSource?.kind === "release"
      ? await assertGameReleaseUnchanged(gameSource.gameReleaseId)
      : null;
  const gameBuild =
    gameSource?.kind === "build"
      ? ((await db.gameBuilds.get(gameSource.gameBuildId)) ?? null)
      : null;
  const ttrpgBuild =
    gameSource?.kind === "ttrpg-build"
      ? ((await db.ttrpgProductionBuilds.get(gameSource.ttrpgBuildId)) ?? null)
      : null;
  const gamePackage = playable?.runtimePackage ?? null;
  const continuation = input.ttrpgContinuation ?? null;
  if (
    continuation &&
    (input.kind !== "ttrpg" ||
      gameSource?.kind !== "release" ||
      gamePackage?.productType !== "ttrpg")
  ) {
    throw new Error(
      "[instance] 跨发布续团只能创建绑定正式 GameRelease 的 TTRPG Instance",
    );
  }
  const continuationParent = continuation
    ? ((await db.simulationSessions.get(continuation.parentSessionId)) ?? null)
    : null;
  if (
    continuation &&
    (!continuationParent ||
      continuationParent.kind !== "ttrpg" ||
      continuationParent.status !== "active" ||
      continuationParent.projectId !== initialScope.projectId ||
      continuationParent.worldId !== initialScope.worldId ||
      continuationParent.workId !== initialScope.workId ||
      continuationParent.gameReleaseId == null)
  ) {
    throw new Error(
      "[instance] 跨发布续团父 Instance 不存在、已结束或不在同一 Work",
    );
  }
  const continuationParentState = continuationParent
    ? await readSimulationState(continuationParent.id!)
    : null;
  const continuationParentStateHash = continuationParentState
    ? await hashSimulationRuntimeStateV1(continuationParentState)
    : null;
  if (
    continuation &&
    continuationParentState &&
    (continuation.expectedParentSequence !==
      continuationParentState.lastSequence ||
      continuation.expectedParentStateHash !== continuationParentStateHash ||
      !/^[0-9a-f]{64}$/.test(continuation.expectedPlanHash))
  ) {
    throw new Error("[instance] 跨发布续团父状态已变化或计划哈希无效");
  }
  const continuationParentPlayable = continuationParent
    ? await verifyPlayableGamePackageSource({
        scope: initialScope,
        source: {
          kind: "release",
          gameReleaseId: continuationParent.gameReleaseId!,
        },
      })
    : null;
  if (
    continuationParentPlayable &&
    continuationParentPlayable.runtimePackage.productType !== "ttrpg"
  ) {
    throw new Error("[instance] 跨发布续团父 GameRelease 不是 TTRPG");
  }
  const explicitLegacyBinding =
    !gameSource &&
    input.kind === "chatgame" &&
    Boolean(
      (input.releaseId != null &&
        input.releaseNarrativeModuleExportId != null) ||
      (input.draftSnapshotHash && input.narrativeModuleId != null),
    );
  if (isFormalGameKind(input.kind) && !playable && !explicitLegacyBinding) {
    throw new Error(
      "[instance] 新建正式文字游戏必须绑定不可变 GameRelease 或 Build Preview；旧版显式绑定仅保留兼容",
    );
  }
  if (playable && gamePackage) {
    const expectedKind = sessionKindForProduct(gamePackage.productType);
    if (input.kind !== expectedKind)
      throw new Error(
        `[instance] ${gamePackage.productType} 必须创建 ${expectedKind} 会话`,
      );
    if (
      input.releaseId != null ||
      input.draftSnapshotHash ||
      input.narrativeModuleId != null ||
      input.releaseNarrativeModuleExportId != null
    ) {
      throw new Error("[instance] 可玩来源已完整冻结，不能混用其他叙事绑定");
    }
  }
  const boundReleaseId =
    playable?.sourceWorldReleaseId ?? input.releaseId ?? null;
  const boundDraftSnapshotHash = input.draftSnapshotHash ??
    (gameSource?.kind === "ttrpg-build" ? playable?.runtimeSourceHash ?? null : null);
  if (boundReleaseId == null && !boundDraftSnapshotHash) {
    throw new Error("[instance] 必须绑定不可变发布版本或显式草稿快照哈希");
  }
  let release: WorldRelease | null = null;
  let manifest: WorldReleaseManifestV2 | null = null;
  if (boundReleaseId != null) {
    release = (await db.worldReleases.get(boundReleaseId)) ?? null;
    if (
      !release ||
      release.projectId !== initialScope.projectId ||
      release.worldId !== initialScope.worldId
    ) {
      throw new Error("[instance] 发布版本不属于当前 World");
    }
    await assertReleaseUnchanged(boundReleaseId);
    manifest = releaseManifest(release);
  }
  if (release && input.narrativeModuleId != null) {
    throw new Error(
      "[instance] Release 实例必须绑定发布清单中的便携叙事 ID，不能绑定可变草稿模块",
    );
  }
  if (release && !playable && input.releaseNarrativeModuleExportId == null) {
    throw new Error("[instance] Release 实例必须选择发布清单中的便携叙事 ID");
  }
  let module: NarrativeModule | null = null;
  if (input.narrativeModuleId != null) {
    module = (await db.narrativeModules.get(input.narrativeModuleId)) ?? null;
    if (
      !module ||
      !(await assertRecordInScope(initialScope, "narrativeModules", module))
    ) {
      throw new Error("[instance] 叙事模块不属于当前 scope");
    }
  }
  if (input.releaseNarrativeModuleExportId != null && !release) {
    throw new Error("[instance] 便携叙事 ID 只能与不可变发布版本一起使用");
  }
  const releaseModuleExportId =
    gamePackage?.sourceWorld.selection.narrativeModuleExportIds[0] ??
    input.releaseNarrativeModuleExportId ??
    null;
  const definition =
    playable && gamePackage
      ? gameReleaseNarrativeDefinition(
          playable.runtimeSourceHash,
          gamePackage,
          releaseModuleExportId,
        )
      : release && manifest && releaseModuleExportId != null
        ? releaseNarrativeDefinition(release, manifest, releaseModuleExportId)
        : module
          ? await liveNarrativeDefinition(initialScope, module)
          : null;
  const playableWorld =
    release &&
    manifest &&
    (input.initialState == null || input.canonSnapshot == null)
      ? await buildPlayableWorldBundleFromRelease({
          manifest,
          worldContentHash: release.contentHash,
          createdAt: release.createdAt,
        })
      : null;
  if (playableWorld) assertPlayableWorldBundleRunnable(playableWorld);
  const ttrpgProductBootstrap =
    gameSource?.kind === "ttrpg-build"
      ? await createTtrpgProductionBuildBootstrapV1({
          scope: initialScope,
          buildId: gameSource.ttrpgBuildId,
          expectedBuildHash: gameSource.expectedBuildHash,
        })
      : null;
  let initialState = structuredClone(
    input.initialState ??
      playableWorld?.initialState ??
      ttrpgProductBootstrap?.initialState ??
      EMPTY_SIMULATION_STATE,
  );
  initialState.narrative = definition
    ? initialNarrativeState(definition)
    : null;
  if (gamePackage?.productType === "character-interaction") {
    if (input.initialState?.interaction != null) {
      throw new Error(
        "[instance] GameRelease 已冻结互动初始状态，不允许外部覆盖",
      );
    }
    initialState.interaction = createInitialInteractionState({
      playerKey: gamePackage.interaction!.playerKey,
      profiles: gamePackage.interaction!.profiles,
      sceneTemplates: gamePackage.interaction!.sceneTemplates,
    });
  }
  if (gamePackage?.productType === "text-adventure") {
    if (
      input.initialState?.adventure != null ||
      input.initialState?.interaction != null
    ) {
      throw new Error(
        "[instance] GameRelease 已冻结冒险与互动初始状态，不允许外部覆盖",
      );
    }
    initialState.interaction = createInitialInteractionState({
      playerKey: gamePackage.interaction!.playerKey,
      profiles: gamePackage.interaction!.profiles,
      sceneTemplates: gamePackage.interaction!.sceneTemplates,
    });
    initialState.adventure = createInitialAdventureState(
      gamePackage.adventure!,
      playable!.runtimeSourceHash,
    );
    Object.assign(initialState, withAdventureNarrativeProjection(initialState));
  }
  if (gamePackage?.productType === "avg") {
    if (input.initialState?.presentation != null)
      throw new Error("[instance] GameRelease 已冻结 AVG 演出，不允许外部覆盖");
    initialState.presentation = createInitialAvgPresentationState({
      contentHash: playable!.runtimeSourceHash,
      assets: gamePackage.presentation!.assets,
      content: gamePackage.presentation!,
      entryNodeKey: gamePackage.narrative.entryNodeKey,
    });
  }
  if (gamePackage?.productType === "narrative-simulation") {
    if (input.initialState?.narrativeSimulation != null) {
      throw new Error(
        "[instance] GameRelease 已冻结叙事模拟初始状态，不允许外部覆盖",
      );
    }
    initialState.narrativeSimulation = createInitialNarrativeSimulationState(
      gamePackage.simulation!,
      playable!.runtimeSourceHash,
    );
    Object.assign(
      initialState,
      withNarrativeSimulationProjection(initialState),
    );
  }
  if (gamePackage?.productType === "text-open-world") {
    if (
      input.initialState?.interaction != null ||
      input.initialState?.adventure != null ||
      input.initialState?.narrativeSimulation != null ||
      input.initialState?.openWorld != null
    ) {
      throw new Error(
        "[instance] GameRelease 已冻结开放世界全部初始状态，不允许外部覆盖",
      );
    }
    initialState.interaction = createInitialInteractionState({
      playerKey: gamePackage.interaction!.playerKey,
      profiles: gamePackage.interaction!.profiles,
      sceneTemplates: gamePackage.interaction!.sceneTemplates,
    });
    initialState.adventure = createInitialAdventureState(
      gamePackage.adventure!,
      playable!.runtimeSourceHash,
    );
    initialState.narrativeSimulation = createInitialNarrativeSimulationState(
      gamePackage.simulation!,
      playable!.runtimeSourceHash,
    );
    initialState.openWorld = createInitialOpenWorldState(
      gamePackage.openWorld!,
      playable!.runtimeSourceHash,
    );
    Object.assign(initialState, withAdventureNarrativeProjection(initialState));
    Object.assign(
      initialState,
      withNarrativeSimulationProjection(initialState),
    );
    Object.assign(initialState, withOpenWorldNarrativeProjection(initialState));
  }
  if (gamePackage?.productType === "ttrpg") {
    if (input.initialState?.ttrpg != null) {
      throw new Error(
        "[instance] GameRelease 已冻结 TTRPG 初始状态，不允许外部覆盖",
      );
    }
    Object.assign(
      initialState,
      createInitialTtrpgProductStateV1({
        initialState,
        content: gamePackage.ttrpg!,
      }),
    );
    if (
      continuation &&
      continuationParent &&
      continuationParentState &&
      continuationParentPlayable?.runtimePackage.ttrpg
    ) {
      const targetTtrpgContent = gamePackage.ttrpg!;
      const parentRulePack = parseRulePackV1(
        continuationParentPlayable.runtimePackage.ttrpg.rulePack.content,
      );
      const parentCampaign = parseTtrpgCampaignContentV1(
        continuationParentPlayable.runtimePackage.ttrpg.campaign,
        parentRulePack,
      );
      const targetRulePack = parseRulePackV1(
        targetTtrpgContent.rulePack.content,
      );
      const targetCampaign = parseTtrpgCampaignContentV1(
        targetTtrpgContent.campaign,
        targetRulePack,
      );
      const migrated = await buildTtrpgContinuationStateV2({
        parentSessionId: continuationParent.id!,
        parentSequence: continuation.expectedParentSequence,
        parentStateHash: continuation.expectedParentStateHash,
        targetGameReleaseId: gameRelease!.id!,
        parentState: continuationParentState,
        targetInitialState: initialState,
        parentRulePack,
        targetRulePack,
        parentCampaign,
        targetCampaign,
        compatibility: continuation.compatibility,
        transitionKey: continuation.transitionKey,
        approvedBy: continuation.approvedBy,
      });
      if (migrated.plan.planHash !== continuation.expectedPlanHash) {
        throw new Error("[instance] 跨发布续团计划已变化，请重新预览并确认");
      }
      initialState = migrated.state;
    }
  }
  const sessionInput: CreateSimulationSessionInput = {
    projectId: initialScope.projectId,
    worldGroupId: input.worldGroupId ?? null,
    kind: input.kind,
    title: input.title,
    seed: input.seed,
    canonSnapshot: input.canonSnapshot ??
      playableWorld?.canonSnapshot ??
      ttrpgProductBootstrap?.canonSnapshot ?? { version: 2, sources: [] },
    initialState,
  };
  const preparedTtrpgSession =
    gameSource?.kind === "ttrpg-build" && ttrpgBuild && playable
      ? await prepareTtrpgProductPreviewSessionV1({
          ...sessionInput,
          worldId: initialScope.worldId,
          workId: initialScope.workId,
          worldReleaseId: playable.sourceWorldReleaseId,
          ttrpgBuildId: ttrpgBuild.id!,
          expectedBuildHash: gameSource.expectedBuildHash,
          runtimeSourceHash: playable.runtimeSourceHash,
          narrativeModuleExportId: releaseModuleExportId,
          origin: "preview",
        })
      : null;
  const binding = {
    worldId: initialScope.worldId,
    workId: initialScope.workId,
    worldReleaseId: boundReleaseId,
    gameReleaseId: gameRelease?.id ?? null,
    gameBuildId: gameBuild?.id ?? null,
    ttrpgBuildId: ttrpgBuild?.id ?? null,
    runtimeSourceHash: playable?.runtimeSourceHash ?? null,
    narrativeModuleId: module?.id ?? null,
    narrativeModuleExportId: releaseModuleExportId,
    draftSnapshotHash: boundDraftSnapshotHash,
    parentSessionId: continuationParent?.id ?? null,
    parentThroughSequence: continuation?.expectedParentSequence ?? null,
  };
  return db.transaction(
    "rw",
    scopeTransactionTables(
      db.worldGroups,
      db.simulationSessions,
      db.ttrpgSessionParticipants,
      db.worldReleases,
      db.gameReleases,
      db.gameProductions,
      db.gameProductionBriefs,
      db.gameBuilds,
      db.ttrpgProductions,
      db.ttrpgSourceSelections,
      db.ttrpgProductionBriefs,
      db.ttrpgProductionBuilds,
      db.simulationEvents,
      db.narrativeModules,
      db.narrativeNodes,
      db.narrativeChoices,
    ),
    async () => {
      const scope = await resolveScope({ scope: initialScope });
      if (continuation && continuationParent) {
        const currentParent = await db.simulationSessions.get(
          continuationParent.id!,
        );
        const parentEvents = await db.simulationEvents
          .where("sessionId")
          .equals(continuationParent.id!)
          .sortBy("sequence");
        const currentSequence =
          parentEvents[parentEvents.length - 1]?.sequence ?? 0;
        if (
          !currentParent ||
          currentParent.status !== "active" ||
          currentParent.updatedAt !== continuationParent.updatedAt ||
          currentParent.gameReleaseId !== continuationParent.gameReleaseId ||
          currentSequence !== continuation.expectedParentSequence
        ) {
          throw new Error("[instance] 父战役在续团创建期间发生变化");
        }
      }
      if (release) {
        const current = await db.worldReleases.get(release.id!);
        if (
          !current ||
          current.manifestJson !== release.manifestJson ||
          current.contentHash !== release.contentHash
        ) {
          throw new Error("[instance] 发布版本在实例创建过程中发生变化");
        }
      }
      if (gameRelease) {
        const current = await db.gameReleases.get(gameRelease.id!);
        if (
          !current ||
          current.manifestJson !== gameRelease.manifestJson ||
          current.contentHash !== gameRelease.contentHash
        ) {
          throw new Error("[instance] GameRelease 在实例创建过程中发生变化");
        }
      }
      if (gameBuild && gameSource?.kind === "build") {
        const current = await db.gameBuilds.get(gameBuild.id!);
        if (
          !current ||
          current.previewManifestJson !== gameBuild.previewManifestJson ||
          current.previewHash !== gameBuild.previewHash ||
          current.packageHash !== gameBuild.packageHash
        ) {
          throw new Error("[instance] GameBuild 在实例创建过程中发生变化");
        }
      }
      if (ttrpgBuild && gameSource?.kind === "ttrpg-build") {
        const current = await db.ttrpgProductionBuilds.get(ttrpgBuild.id!);
        if (
          !current ||
          current.buildHash !== ttrpgBuild.buildHash ||
          current.status !== ttrpgBuild.status ||
          !["preview-ready", "validated", "release-ready"].includes(current.status)
        ) {
          throw new Error("[instance] TTRPG Product Build 在实例创建过程中发生变化");
        }
      }
      if (module) {
        const current = await db.narrativeModules.get(module.id!);
        if (
          !current ||
          !(await assertRecordInScope(scope, "narrativeModules", current))
        ) {
          throw new Error("[instance] 叙事模块在实例创建过程中发生变化");
        }
        if (!release) {
          const currentDefinition = await liveNarrativeBase(scope, current);
          const originalDefinition =
            definition == null
              ? null
              : { ...definition, sourceHash: undefined };
          if (
            stableJson(currentDefinition) !== stableJson(originalDefinition)
          ) {
            throw new Error("[instance] 叙事模块在实例创建过程中发生变化");
          }
        }
      }
      const session =
        gameSource?.kind === "release" && gameRelease && release
          ? await createReleasedGameSession({
              ...sessionInput,
              worldId: scope.worldId,
              workId: scope.workId,
              worldReleaseId: release.id!,
              gameReleaseId: gameRelease.id!,
              narrativeModuleExportId: releaseModuleExportId,
              origin: continuation ? "branch" : "release",
            })
          : gameSource?.kind === "build" && gameBuild && release && playable
            ? await createPreviewGameSession({
                ...sessionInput,
                worldId: scope.worldId,
                workId: scope.workId,
                worldReleaseId: release.id!,
                gameBuildId: gameBuild.id!,
                expectedPreviewHash: gameSource.expectedPreviewHash,
                runtimeSourceHash: playable.runtimeSourceHash,
                narrativeModuleExportId: releaseModuleExportId,
                origin: "preview",
              })
            : gameSource?.kind === "ttrpg-build" &&
                ttrpgBuild &&
                playable &&
                preparedTtrpgSession
              ? await insertPreparedTtrpgProductPreviewSessionV1(
                  preparedTtrpgSession,
                )
              : await createSimulationSession(sessionInput);
      if (definition?.version === 2) {
        let projected = structuredClone(initialState);
        const started = {
          projectId: scope.projectId,
          worldGroupId: input.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: 1,
          type: "narrative.started" as const,
          actorKey: null,
          targetKey: definition.entryNodeKey,
          payloadJson: JSON.stringify({
            entryNodeKey: definition.entryNodeKey,
            contentHash: definition.contentHash,
          }),
          createdAt: session.createdAt,
        };
        projected = applySimulationEvent(projected, started);
        const entered = {
          projectId: scope.projectId,
          worldGroupId: input.worldGroupId ?? null,
          sessionId: session.id!,
          sequence: 2,
          type: "narrative.node.entered" as const,
          actorKey: null,
          targetKey: definition.entryNodeKey,
          payloadJson: JSON.stringify({
            nodeKey: definition.entryNodeKey,
            causeSequence: 1,
          }),
          createdAt: session.createdAt,
        };
        projected = applySimulationEvent(projected, entered);
        await db.simulationEvents.bulkAdd([started, entered]);
        if (projected.narrative?.completed) {
          const ending = {
            projectId: scope.projectId,
            worldGroupId: input.worldGroupId ?? null,
            sessionId: session.id!,
            sequence: 3,
            type: "narrative.ending.reached" as const,
            actorKey: null,
            targetKey: definition.entryNodeKey,
            payloadJson: JSON.stringify({
              endingKey: definition.entryNodeKey,
              enteredSequence: 2,
            }),
            createdAt: session.createdAt,
          };
          applySimulationEvent(projected, ending);
          await db.simulationEvents.add(ending);
        }
      }
      await db.simulationSessions.update(session.id!, binding);
      const boundSession = { ...session, ...binding };
      if (gamePackage?.productType === "ttrpg") {
        await installInitialTtrpgParticipantsV2({
          session: boundSession,
          campaign: gamePackage.ttrpg!.campaign,
        });
        if (continuationParent) {
          await carryTtrpgContinuationParticipantsV2({
            parentSessionId: continuationParent.id!,
            child: boundSession,
            transitionKey: continuation!.transitionKey,
          });
        }
      }
      return boundSession;
    },
  );
}

/** GAMEPROD-1A3 unified launch boundary for Build Preview and formal Release. */
export async function createPlayableGameInstance(input: {
  scope: WorkspaceScope;
  source: PlayableGameSourceV1;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  const playable = await verifyPlayableGamePackageSource({
    scope: input.scope,
    source: input.source,
  });
  return createWorldInstance({
    scope: input.scope,
    gameSource: input.source,
    kind: sessionKindForProduct(playable.runtimePackage.productType),
    title: input.title,
    worldGroupId: input.worldGroupId,
    seed: input.seed,
  });
}

/**
 * Creates a distinct target-release Instance from an explicitly reviewed
 * continuation plan. The old Instance and its frozen RulePack remain intact.
 */
export async function createContinuedTtrpgGameInstanceV2(input: {
  scope: WorkspaceScope;
  targetGameReleaseId: number;
  title: string;
  continuation: TtrpgContinuationRequestV2;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({
    scope: input.scope,
    kind: "ttrpg",
    title: input.title,
    gameSource: { kind: "release", gameReleaseId: input.targetGameReleaseId },
    worldGroupId: input.worldGroupId,
    seed: input.seed,
    ttrpgContinuation: input.continuation,
  });
}

export async function createStoryGameInstance(input: {
  scope: WorkspaceScope;
  gameReleaseId: number;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: "storygame" });
}

export async function createInteractionGameInstance(input: {
  scope: WorkspaceScope;
  gameReleaseId: number;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: "chatgame" });
}

export async function createTextAdventureInstance(input: {
  scope: WorkspaceScope;
  gameReleaseId: number;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: "textadventure" });
}

export async function createAvgGameInstance(input: {
  scope: WorkspaceScope;
  gameReleaseId: number;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: "avg" });
}

export async function createNarrativeSimulationInstance(input: {
  scope: WorkspaceScope;
  gameReleaseId: number;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: "textsimulation" });
}

export async function createTextOpenWorldInstance(input: {
  scope: WorkspaceScope;
  gameReleaseId: number;
  title: string;
  worldGroupId?: number | null;
  seed?: string;
}): Promise<SimulationSession> {
  return createWorldInstance({ ...input, kind: "textworld" });
}

export async function readBoundInstances(
  scope: WorkspaceScope,
): Promise<SimulationSession[]> {
  const resolved = await resolveScope({ scope });
  const rows = await db.simulationSessions
    .where("projectId")
    .equals(resolved.projectId)
    .toArray();
  return rows.filter(
    (row) => row.worldId === resolved.worldId && row.workId === resolved.workId,
  );
}

export async function assertInstanceBinding(
  instanceId: number,
  scope: WorkspaceScope,
): Promise<SimulationSession> {
  const resolved = await resolveScope({ scope });
  const session = await db.simulationSessions.get(instanceId);
  if (
    !session ||
    session.projectId !== resolved.projectId ||
    session.worldId !== resolved.worldId ||
    session.workId !== resolved.workId
  ) {
    throw new Error("[instance] 实例不属于当前 World/Work");
  }
  const initialState = JSON.parse(
    session.initialStateJson,
  ) as SimulationRuntimeState;
  const hasReleaseSource = session.gameReleaseId != null;
  const hasBuildSource = session.gameBuildId != null;
  const hasTtrpgBuildSource = session.ttrpgBuildId != null;
  const playableSourceCount = [
    hasReleaseSource,
    hasBuildSource,
    hasTtrpgBuildSource,
  ].filter(Boolean).length;
  if (isFormalGameKind(session.kind) && initialState.narrative?.version === 2) {
    if (playableSourceCount === 0) {
      throw new Error(
        "[instance] 可玩来源绑定缺失；请从完整项目备份恢复 Release 或 Build 后再启动存档",
      );
    }
    if (playableSourceCount > 1) {
      throw new Error(
        "[instance] 正式游戏不能同时绑定多个 Release/Build Preview 来源",
      );
    }
  }
  if (session.worldReleaseId != null) {
    await assertReleaseUnchanged(session.worldReleaseId);
    // Product narrative belongs to the immutable Game/Product Release, not to
    // the semantic WorldRelease. Only legacy direct-world sessions may use a
    // WorldRelease narrative coordinate; product-bound sessions are verified
    // against their own release/build immediately below.
    if (session.narrativeModuleExportId != null && playableSourceCount === 0) {
      const release = await db.worldReleases.get(session.worldReleaseId);
      if (
        !release ||
        !releaseManifest(release).selectedNarrativeModules.some(
          (item) => item.exportId === session.narrativeModuleExportId,
        )
      ) {
        throw new Error("[instance] 实例发布叙事来源越界");
      }
    }
  }
  if (hasReleaseSource) {
    const verified = await verifyPlayableGamePackageSource({
      scope: resolved,
      source: { kind: "release", gameReleaseId: session.gameReleaseId! },
    });
    if (
      verified.sourceWorldReleaseId !== session.worldReleaseId ||
      (session.runtimeSourceHash != null &&
        verified.runtimeSourceHash !== session.runtimeSourceHash) ||
      (initialState.narrative?.version === 2 &&
        initialState.narrative.contentHash !== verified.runtimeSourceHash)
    ) {
      throw new Error(
        "[instance] 实例 GameRelease 来源越界或 RuntimePackage 已变化",
      );
    }
  }
  if (hasBuildSource) {
    const build = await db.gameBuilds.get(session.gameBuildId!);
    if (!build || !session.runtimeSourceHash) {
      throw new Error(
        "[instance] Build Preview 绑定缺失；请从完整项目备份恢复 Build 后再启动存档",
      );
    }
    const verified = await verifyPlayableGamePackageSource({
      scope: resolved,
      source: {
        kind: "build",
        gameBuildId: build.id!,
        expectedPreviewHash: build.previewHash,
      },
    });
    if (
      verified.sourceWorldReleaseId !== session.worldReleaseId ||
      verified.runtimeSourceHash !== session.runtimeSourceHash ||
      (initialState.narrative?.version === 2 &&
        initialState.narrative.contentHash !== verified.runtimeSourceHash)
    ) {
      throw new Error(
        "[instance] 实例 Build Preview 来源越界或 RuntimePackage 已变化",
      );
    }
  }
  if (hasTtrpgBuildSource) {
    if (session.kind !== "ttrpg" || !session.runtimeSourceHash) {
      throw new Error(
        "[instance] TTRPG Product Build 只能绑定 TTRPG 试玩实例",
      );
    }
    const build = await db.ttrpgProductionBuilds.get(session.ttrpgBuildId!);
    if (!build?.buildHash) {
      throw new Error(
        "[instance] TTRPG Product Build 绑定缺失；请从完整项目备份恢复 Build 后再启动存档",
      );
    }
    const verified = await verifyPlayableGamePackageSource({
      scope: resolved,
      source: {
        kind: "ttrpg-build",
        ttrpgBuildId: build.id!,
        expectedBuildHash: build.buildHash,
      },
    });
    if (
      verified.sourceWorldReleaseId !== (session.worldReleaseId ?? null) ||
      verified.runtimeSourceHash !== session.runtimeSourceHash ||
      (initialState.narrative?.version === 2 &&
        initialState.narrative.contentHash !== verified.runtimeSourceHash)
    ) {
      throw new Error(
        "[instance] TTRPG Product Build 来源越界或 RuntimePackage 已变化",
      );
    }
  }
  if (session.narrativeModuleId != null) {
    const module = await db.narrativeModules.get(session.narrativeModuleId);
    if (
      !module ||
      !(await assertRecordInScope(resolved, "narrativeModules", module))
    )
      throw new Error("[instance] 实例叙事来源越界");
  }
  return session;
}
