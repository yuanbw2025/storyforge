import { db } from "../../db/schema";
import type { AgentRunScopeV1, WorkspaceScope } from "../../types";
import { hashCanonicalValue } from "./hash";

export interface RuntimeHarnessBoundaryV1 {
  scope: AgentRunScopeV1 & { runtime: NonNullable<AgentRunScopeV1["runtime"]> };
  boundaryHash: string;
}

function fail(message: string): never {
  throw new Error(`[runtime-harness] ${message}`);
}

// Runtime Skills are a formal but route-local subsystem. Lazy boundaries keep
// all product engines and release parsers out of the writing application's
// initial bundle while preserving one verified implementation at execution.
async function readRuntimeState(sessionId: number) {
  return (await import("../../product/runtime-api")).readProductRuntimeState(sessionId);
}

async function readRuntimeStateVersion(sessionId: number) {
  return (await import("../../product/runtime-api")).readProductRuntimeStateVersion(sessionId);
}

async function assertRuntimeInstanceBinding(sessionId: number, scope: WorkspaceScope) {
  return (await import("../../product/runtime-instances")).assertInstanceBinding(sessionId, scope);
}

async function frozenRuntimeSource(sessionId: number) {
  const session = await db.productRuntimeSessions.get(sessionId);
  if (!session) fail("运行实例不存在");
  if (
    session.worldId == null ||
    session.workId == null ||
    !session.runtimeSourceHash?.trim()
  ) {
    fail("正式运行实例缺少工作区或冻结运行源");
  }
  const verified = await (await import("../../product-production/preview-source"))
    .verifyProductRuntimeSessionSourceV1({
    scope: {
      projectId: session.projectId,
      worldId: session.worldId,
      workId: session.workId,
    },
    session,
  });
  if (verified.runtimeSourceHash !== session.runtimeSourceHash) {
    fail("运行实例与冻结 RuntimePackage 不一致");
  }
  return verified;
}

/** Capture the exact visible runtime input used by one character-facing model call. */
export async function captureRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
  participantKey: string;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertRuntimeInstanceBinding(
    input.productRuntimeSessionId,
    input.scope,
  );
  if (
    session.kind !== "character-interaction" &&
    session.kind !== "text-adventure" &&
    session.kind !== "text-open-world"
  ) {
    fail("角色互动技能只能绑定带冻结互动状态的正式实例");
  }
  const participantKey = input.participantKey.trim();
  if (!participantKey) fail("缺少角色参与者 key");
  const [version, state, frozen] = await Promise.all([
    readRuntimeStateVersion(session.id!),
    readRuntimeState(session.id!),
    frozenRuntimeSource(session.id!),
  ]);
  if (!state.interaction) fail("实例没有角色互动状态");
  const { interactionVisibilityView } = await import("../../character-interaction/runtime");
  const visibilityHash = await hashCanonicalValue(
    interactionVisibilityView(state.interaction, participantKey),
  );
  const runtime = {
    productRuntimeSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozen.runtimeSourceHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

/** Fail closed before a model retry or candidate adoption when SIM advanced. */
export async function assertRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
  participantKey: string;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
    participantKey: input.participantKey,
  });
  const expectedHash = await hashCanonicalValue(expected);
  if (current.boundaryHash !== expectedHash) {
    fail("运行状态、可见知识、场景参与者或发布来源已经变化");
  }
}

/** Capture the player-visible TEXTADV input without creating an AI side channel. */
export async function captureAdventureRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertRuntimeInstanceBinding(
    input.productRuntimeSessionId,
    input.scope,
  );
  if (
    (session.kind !== "text-adventure" && session.kind !== "text-open-world") ||
    (session.productReleaseId == null && session.productBuildId == null)
  ) {
    fail("文字冒险技能只能绑定带冻结冒险状态的正式实例");
  }
  const [version, state, frozen] = await Promise.all([
    readRuntimeStateVersion(session.id!),
    readRuntimeState(session.id!),
    frozenRuntimeSource(session.id!),
  ]);
  if (!state.adventure) fail("实例没有 TEXTADV-1 冒险状态");
  if (
    (frozen.runtimePackage.productType !== "text-adventure" &&
      frozen.runtimePackage.productType !== "text-open-world") ||
    !frozen.runtimePackage.adventure
  ) {
    fail("实例冻结 RuntimePackage 缺少冒险模块");
  }
  const {
    adventureNarrativeProjection,
    availableAdventureActions,
  } = await import("../../adventure/runtime");
  const visibilityHash = await hashCanonicalValue({
    adventure: adventureNarrativeProjection(state.adventure),
    actions: availableAdventureActions(
      frozen.runtimePackage.adventure,
      state.adventure,
      state.narrative?.variables,
    ).map((item) => ({
      key: item.action.key,
      available: item.available,
      reason: item.reason,
    })),
    narrative: {
      currentNodeKey: state.narrative?.currentNodeKey ?? null,
      visibleChoiceKeys: state.narrative?.visibleChoiceKeys ?? [],
      availableChoiceKeys: state.narrative?.availableChoiceKeys ?? [],
    },
  });
  const runtime = {
    productRuntimeSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozen.runtimeSourceHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertAdventureRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureAdventureRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("冒险状态、可用行动、叙事选择或发布来源已经变化");
  }
}

/** Capture the text-open-world internal openWorldEvolution state and player-visible reports. */
export async function captureOpenWorldEvolutionRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertRuntimeInstanceBinding(
    input.productRuntimeSessionId,
    input.scope,
  );
  if (
    session.kind !== "text-open-world" ||
    (session.productReleaseId == null && session.productBuildId == null)
  ) {
    fail("开放世界状态演化技能只能绑定带冻结状态演化数据的正式实例");
  }
  const [version, state, frozen] = await Promise.all([
    readRuntimeStateVersion(session.id!),
    readRuntimeState(session.id!),
    frozenRuntimeSource(session.id!),
  ]);
  if (!state.openWorldEvolution) fail("文字开放世界实例没有内部开放世界状态演化状态");
  if (
    frozen.runtimePackage.productType !== "text-open-world" ||
    !frozen.runtimePackage.openWorldEvolution
  ) {
    fail("实例冻结 RuntimePackage 缺少开放世界状态演化模块");
  }
  const {
    availableOpenWorldEvolutionActions,
    openWorldEvolutionProjection,
    visibleOpenWorldEvolutionReports,
  } = await import("../../open-world/evolution-runtime");
  const visibilityHash = await hashCanonicalValue({
    openWorldEvolution: openWorldEvolutionProjection(state.openWorldEvolution),
    actions: availableOpenWorldEvolutionActions(
      frozen.runtimePackage.openWorldEvolution,
      state.openWorldEvolution,
    ).map((item) => ({
      key: item.action.key,
      available: item.available,
      reason: item.reason,
    })),
    reports: visibleOpenWorldEvolutionReports(
      state.openWorldEvolution,
      "player",
    ),
    narrative: {
      currentNodeKey: state.narrative?.currentNodeKey ?? null,
      visibleChoiceKeys: state.narrative?.visibleChoiceKeys ?? [],
      availableChoiceKeys: state.narrative?.availableChoiceKeys ?? [],
    },
  });
  const runtime = {
    productRuntimeSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozen.runtimeSourceHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertOpenWorldEvolutionRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureOpenWorldEvolutionRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("开放世界状态演化状态、玩家可见报告、可用行动、叙事选择或发布来源已经变化");
  }
}

/** Capture the exact player-visible text-open-world region/task boundary. */
export async function captureOpenWorldRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const session = await assertRuntimeInstanceBinding(
    input.productRuntimeSessionId,
    input.scope,
  );
  if (
    session.kind !== "text-open-world" ||
    (session.productReleaseId == null && session.productBuildId == null)
  ) {
    fail("开放世界技能只能绑定正式 text-open-world 实例");
  }
  const [version, state, frozen] = await Promise.all([
    readRuntimeStateVersion(session.id!),
    readRuntimeState(session.id!),
    frozenRuntimeSource(session.id!),
  ]);
  if (!state.openWorld) fail("文字开放世界实例没有区域状态");
  if (frozen.runtimePackage.productType !== "text-open-world" || !frozen.runtimePackage.openWorld) {
    fail("实例冻结 RuntimePackage 缺少开放世界模块");
  }
  const region = frozen.runtimePackage.openWorld.regions.find(
    (item) => item.key === state.openWorld!.currentRegionKey,
  );
  const projection = state.openWorld.regionalProjections.find(
    (item) => item.regionKey === state.openWorld!.currentRegionKey,
  );
  if (!region || !projection) fail("当前区域投影不完整");
  const { openWorldMainlineProjection } = await import("../../open-world/runtime");
  const visibilityHash = await hashCanonicalValue({
    world: openWorldMainlineProjection(
      state.openWorld,
      state.openWorld.mainlineQuestKeys,
    ),
    region,
    projection,
    visibleQuests: state.openWorld.questInstances.filter((item) =>
      ["revealed", "active", "resolved", "failed"].includes(item.status),
    ),
    narrative: {
      currentNodeKey: state.narrative?.currentNodeKey ?? null,
      visibleChoiceKeys: state.narrative?.visibleChoiceKeys ?? [],
      availableChoiceKeys: state.narrative?.availableChoiceKeys ?? [],
    },
  });
  const runtime = {
    productRuntimeSessionId: session.id!,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: frozen.runtimeSourceHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: session.worldGroupId ?? null,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertOpenWorldRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureOpenWorldRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("开放世界区域、任务、叙事选择或发布来源已经变化");
  }
}

/** Capture the exact formal GM-only view for one post-resolution narration. */
export async function captureTtrpgGmRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const view = await (await import("../../ttrpg/gm-context")).loadTtrpgGmRuntimeViewV1(input);
  if (!view.safety.completed || !view.scene || !view.latestAction) {
    fail("可信 AI GM 需要已完成 Session Zero、已打开场景和最近正式规则行动");
  }
  const [version, state] = await Promise.all([
    readRuntimeStateVersion(view.session.id),
    readRuntimeState(view.session.id),
  ]);
  if (
    version.sequence !== view.session.eventSequence ||
    state.ttrpg?.product?.gmNarrations.some(
      (item) => item.actionSequence === view.latestAction!.eventSequence,
    )
  ) {
    fail("最近正式规则行动已经变化或已有 GM 叙事");
  }
  const visibilityHash = await hashCanonicalValue(view);
  const runtime = {
    productRuntimeSessionId: view.session.id,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: view.session.releaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: view.session.worldGroupId,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertTtrpgGmRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 runtime 输入边界");
  const current = await captureTtrpgGmRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("TTRPG 场景、正式裁定、线索可见性、安全约束或发布来源已经变化");
  }
}

/** Capture one GM-controlled NPC turn before the RulePack action is chosen. */
export async function captureTtrpgGmActorRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
}): Promise<RuntimeHarnessBoundaryV1> {
  const view = await (await import("../../ttrpg/gm-context")).loadTtrpgGmRuntimeViewV1(input);
  if (
    !view.safety.completed ||
    view.safety.status !== "active" ||
    !view.scene ||
    !view.activeTurn ||
    !["ai", "hybrid"].includes(view.activeTurn.gmController) ||
    !view.activeTurn.availableActions.length
  ) {
    fail(
      "AI KP 角色行动需要活动场景、AI/混合 GM 权威和当前 NPC 的合法行动闭集",
    );
  }
  const version = await readRuntimeStateVersion(view.session.id);
  if (version.sequence !== view.session.eventSequence)
    fail("AI KP 角色行动上下文已经变化");
  const visibilityHash = await hashCanonicalValue(view);
  const runtime = {
    productRuntimeSessionId: view.session.id,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: view.session.releaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: view.session.worldGroupId,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertTtrpgGmActorRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("AI KP 角色行动 RunContract 缺少 runtime 输入边界");
  const current = await captureTtrpgGmActorRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("AI KP 当前 NPC、合法行动、场景、安全约束或发布来源已经变化");
  }
}

/** Capture exactly one AI player's visible state and currently legal actions. */
export async function captureTtrpgPlayerRuntimeHarnessBoundaryV1(input: {
  scope: WorkspaceScope;
  productRuntimeSessionId: number;
  actorKey: string;
}): Promise<RuntimeHarnessBoundaryV1> {
  const view = await (await import("../../ttrpg/player-context")).loadTtrpgPlayerRuntimeViewV1(input);
  const [version, state] = await Promise.all([
    readRuntimeStateVersion(view.session.id),
    readRuntimeState(view.session.id),
  ]);
  if (
    version.sequence !== view.session.eventSequence ||
    state.ttrpg?.product?.safety.status !== "active" ||
    !view.projection.availableActions.length
  ) {
    fail("AI 玩家可见状态或可用行动已经变化");
  }
  const visibilityHash = await hashCanonicalValue(view);
  const runtime = {
    productRuntimeSessionId: view.session.id,
    baseSequence: version.sequence,
    stateHash: version.stateHash,
    visibilityHash,
    releaseHash: view.session.releaseHash,
  };
  return {
    scope: {
      projectId: input.scope.projectId,
      worldGroupId: view.session.worldGroupId,
      runtime,
    },
    boundaryHash: await hashCanonicalValue(runtime),
  };
}

export async function assertTtrpgPlayerRuntimeHarnessFreshV1(input: {
  scope: WorkspaceScope;
  contractScope: AgentRunScopeV1;
  actorKey: string;
}): Promise<void> {
  const expected = input.contractScope.runtime;
  if (!expected) fail("RunContract 缺少 AI 玩家 runtime 输入边界");
  const current = await captureTtrpgPlayerRuntimeHarnessBoundaryV1({
    scope: input.scope,
    productRuntimeSessionId: expected.productRuntimeSessionId,
    actorKey: input.actorKey,
  });
  if (current.boundaryHash !== (await hashCanonicalValue(expected))) {
    fail("TTRPG 玩家可见场景、行动、线索、席位授权或发布来源已经变化");
  }
}
