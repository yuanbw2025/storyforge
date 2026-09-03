/** Product-owned deterministic runtime commands: open-world. */
import { applyProductRuntimeEvent, assertFormalRuntimeSourceUnchangedV1, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readSessionEvents, replayProductRuntimeEvents, stableJson, verifyFormalRuntimeSourceV1 } from "../product/runtime-core";
import { db } from "../db/schema";
import { planOpenWorldDraw, planOpenWorldTravel, planOpenWorldQuestDecision, planOpenWorldTick, openWorldMainlineProjection } from "./runtime";
import { planOpenWorldEvolutionTurn } from "./evolution-runtime";
import type { ProductRuntimeEvent, ProductRuntimeCheckpoint, ProductRuntimeState, ProductRuntimeEventType, TextOpenWorldProductRuntimePackageV1 } from "../types";
export async function commitOpenWorldEvolutionTurn(input: {
  sessionId: number;
  decisionKeys: string[];
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<{
  events: ProductRuntimeEvent[];
  checkpoint: ProductRuntimeCheckpoint;
  state: ProductRuntimeState;
}> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[text-open-world/evolution] 回合命令基线无效。");
  }
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !previewSession ||
    previewSession.kind !== "text-open-world" ||
    (previewSession.productReleaseId == null && previewSession.productBuildId == null)
  ) {
    throw new Error("[text-open-world] 当前实例不具备内部状态演化回合能力。");
  }
  const frozen = await verifyFormalRuntimeSourceV1(previewSession, ["text-open-world"]);
  const openWorldEvolutionContent = frozen.runtimePackage.openWorldEvolution;
  if (!openWorldEvolutionContent) {
    throw new Error("[text-open-world/evolution] 冻结 Product RuntimePackage 缺少状态演化模块。");
  }
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replayProductRuntimeEvents(
    parseProductRuntimeState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewPrior = previewEvents.find(
    (event) => event.commandId === commandId,
  );
  if (
    !previewState.openWorldEvolution ||
    previewState.openWorldEvolution.contentHash !== frozen.packageHash
  ) {
    throw new Error("[text-open-world/evolution] 实例冻结状态与 Product Release/Build 不一致。");
  }
  if (
    !previewPrior &&
    (previewState.lastSequence !== input.baseSequence ||
      (await hashStateJson(JSON.stringify(previewState))) !== baseStateHash)
  ) {
    throw new Error("[text-open-world/evolution] 演化状态已变化，请刷新后重试。");
  }
  if (!previewPrior) {
    planOpenWorldEvolutionTurn({
      content: openWorldEvolutionContent,
      state: previewState.openWorldEvolution,
      decisionKeys: input.decisionKeys,
      seed: previewSession.seed,
      startingSequence: previewState.lastSequence,
    });
  }

  return db.transaction(
    "rw",
    [
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.productRuntimeCheckpoints,
      db.productReleases,
      db.productBuilds,
      db.productProductions,
      db.productProductionBriefs,
    ],
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "text-open-world" ||
        (session.productReleaseId == null && session.productBuildId == null)
      ) {
        throw new Error("[text-open-world] 当前实例不具备内部状态演化回合能力。");
      }
      await assertFormalRuntimeSourceUnchangedV1({
        previewSession,
        session,
        frozen,
      });
      const events = await readSessionEvents(session);
      const prior = events.find((event) => event.commandId === commandId);
      if (prior) {
        const priorPayload = parseEventPayload(prior);
        if (
          prior.type !== "open-world-evolution.turn.started" ||
          prior.baseSequence !== input.baseSequence ||
          prior.baseStateHash !== baseStateHash ||
          stableJson(priorPayload.decisionKeys) !==
            stableJson(input.decisionKeys)
        ) {
          throw new Error("[text-open-world/evolution] commandId 已被不同回合命令使用。");
        }
        const turn = Number(priorPayload.turn);
        const ended = events.find(
          (event) =>
            event.sequence >= prior.sequence &&
            event.type === "open-world-evolution.turn.ended" &&
            Number(parseEventPayload(event).turn) === turn,
        );
        if (!ended) throw new Error("[text-open-world/evolution] 已提交回合缺少结束事件。");
        const commandEvents = events.filter(
          (event) =>
            event.sequence >= prior.sequence &&
            event.sequence <= ended.sequence,
        );
        const checkpoint = await db.productRuntimeCheckpoints
          .where("sessionId")
          .equals(session.id!)
          .filter((item) => item.throughSequence === ended.sequence)
          .first();
        if (!checkpoint) throw new Error("[text-open-world/evolution] 已提交回合缺少检查点。");
        const state = parseProductRuntimeState(checkpoint.stateJson);
        return { events: commandEvents, checkpoint, state };
      }
      if (session.status !== "active")
        throw new Error("[text-open-world/evolution] 只有 active 会话可以提交回合。");
      let state = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events,
      );
      const stateHash = await hashStateJson(JSON.stringify(state));
      if (
        state.lastSequence !== input.baseSequence ||
        stateHash !== baseStateHash ||
        state.lastSequence !== previewState.lastSequence
      ) {
        throw new Error("[text-open-world/evolution] 演化状态已变化，请刷新后重试。");
      }
      if (
        !state.openWorldEvolution ||
        state.openWorldEvolution.contentHash !== frozen.packageHash
      ) {
        throw new Error("[text-open-world/evolution] 实例冻结状态与 Product Release/Build 不一致。");
      }
      const settledTurn = state.openWorldEvolution.turn;
      const plan = planOpenWorldEvolutionTurn({
        content: openWorldEvolutionContent,
        state: state.openWorldEvolution,
        decisionKeys: input.decisionKeys,
        seed: session.seed,
        startingSequence: state.lastSequence,
      });
      const appended: ProductRuntimeEvent[] = [];
      const createdAt = Date.now();
      for (const [index, descriptor] of plan.descriptors.entries()) {
        const envelope = descriptor.commandEnvelope
          ? { commandId, baseSequence: input.baseSequence, baseStateHash }
          : {};
        const event: ProductRuntimeEvent = {
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
        state = applyProductRuntimeEvent(state, event);
        appended.push(event);
      }
      for (const event of appended)
        event.id = (await db.productRuntimeEvents.add(event)) as number;
      const stateJson = JSON.stringify(state);
      const throughSequence = appended[appended.length - 1].sequence;
      const checkpoint: ProductRuntimeCheckpoint = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        throughSequence,
        name: `第 ${settledTurn} 回合自动检查点`,
        stateJson,
        stateHash: await hashStateJson(stateJson),
        createdAt,
      };
      checkpoint.id = (await db.productRuntimeCheckpoints.add(
        checkpoint,
      )) as number;
      await db.productRuntimeSessions.update(session.id!, { updatedAt: createdAt });
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
    type: ProductRuntimeEventType;
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
      throw new Error("[text-open-world] 发现触发类型无效。");
    }
    return { kind: "draw", trigger: command.trigger };
  }
  if (command.kind === "travel") {
    const edgeKey = command.edgeKey.trim();
    if (!edgeKey || edgeKey.length > 160)
      throw new Error("[text-open-world] 交通边 key 无效。");
    return { kind: "travel", edgeKey };
  }
  if (command.kind === "quest-decision") {
    const instanceKey = command.instanceKey.trim();
    if (
      !instanceKey ||
      instanceKey.length > 200 ||
      !["accept", "decline"].includes(command.decision)
    ) {
      throw new Error("[text-open-world] 任务决策无效。");
    }
    return { kind: "quest-decision", instanceKey, decision: command.decision };
  }
  if (command.kind === "tick") return { kind: "tick" };
  throw new Error("[text-open-world] 未知开放世界命令。");
}

function planOpenWorldCommand(input: {
  manifest: TextOpenWorldProductRuntimePackageV1;
  state: ProductRuntimeState;
  seed: string;
  command: OpenWorldCommand;
}): OpenWorldEventPlan {
  if (
    !input.state.openWorld ||
    !input.state.adventure ||
    !input.state.openWorldEvolution
  ) {
    throw new Error("[text-open-world] 实例缺少开放世界、冒险或演化冻结状态。");
  }
  const common = {
    content: input.manifest.openWorld,
    state: input.state.openWorld,
    startingSequence: input.state.lastSequence,
  };
  if (input.command.kind === "draw") {
    return planOpenWorldDraw({
      ...common,
      openWorldEvolution: input.manifest.openWorldEvolution,
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
      openWorldEvolution: input.manifest.openWorldEvolution,
      instanceKey: input.command.instanceKey,
      decision: input.command.decision,
    });
  }
  return planOpenWorldTick({
    ...common,
    openWorldEvolution: input.manifest.openWorldEvolution,
    seed: input.seed,
  });
}

/** Text-open-world authoritative command path. Every command expands to replayable
 * shared adventure/world events, a verified narrative projection, and one
 * atomic checkpoint. */
export async function commitOpenWorldCommand(input: {
  sessionId: number;
  command: OpenWorldCommand;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
}): Promise<{
  events: ProductRuntimeEvent[];
  checkpoint: ProductRuntimeCheckpoint;
  state: ProductRuntimeState;
}> {
  const commandId = normalizeCommandId(input.commandId);
  const command = normalizeOpenWorldCommand(input.command);
  const baseStateHash = input.baseStateHash.trim();
  if (
    !Number.isInteger(input.baseSequence) ||
    input.baseSequence < 0 ||
    !/^[a-f0-9]{64}$/.test(baseStateHash)
  ) {
    throw new Error("[text-open-world] 命令基线无效。");
  }
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !previewSession ||
    previewSession.kind !== "text-open-world" ||
    (previewSession.productReleaseId == null && previewSession.productBuildId == null)
  ) {
    throw new Error("[text-open-world] 正式文字开放世界实例不存在。");
  }
  const [frozen, previewEvents] = await Promise.all([
    verifyFormalRuntimeSourceV1(previewSession, ["text-open-world"]),
    readSessionEvents(previewSession),
  ]);
  const previewManifest = frozen.runtimePackage as TextOpenWorldProductRuntimePackageV1;
  if (
    !previewManifest.openWorld ||
    !previewManifest.adventure ||
    !previewManifest.openWorldEvolution ||
    !previewManifest.interaction
  ) {
    throw new Error("[text-open-world] 冻结 Product RuntimePackage 缺少开放世界模块闭包。");
  }
  const previewState = replayProductRuntimeEvents(
    parseProductRuntimeState(previewSession.initialStateJson),
    previewEvents,
  );
  const prior = previewEvents.find((event) => event.commandId === commandId);
  if (
    !prior &&
    (previewState.lastSequence !== input.baseSequence ||
      (await hashStateJson(JSON.stringify(previewState))) !== baseStateHash)
  ) {
    throw new Error("[text-open-world] 世界状态已变化，请刷新后重试。");
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
      ? `TEXT-OPEN-WORLD:${commandId}`
      : `TEXT-OPEN-WORLD:${commandId.slice(0, 120)}:${(await hashStateJson(JSON.stringify(commandId))).slice(0, 64)}`;

  return db.transaction(
    "rw",
    [
      db.productRuntimeSessions,
      db.productRuntimeEvents,
      db.productRuntimeCheckpoints,
      db.productReleases,
      db.productBuilds,
      db.productProductions,
      db.productProductionBriefs,
    ],
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "text-open-world" ||
        (session.productReleaseId == null && session.productBuildId == null)
      ) {
        throw new Error("[text-open-world] 正式文字开放世界实例不存在。");
      }
      await assertFormalRuntimeSourceUnchangedV1({
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
          throw new Error("[text-open-world] commandId 已被不同命令使用。");
        }
        const checkpoint = await db.productRuntimeCheckpoints
          .where("sessionId")
          .equals(session.id!)
          .filter((item) => item.name === checkpointName)
          .first();
        if (!checkpoint || checkpoint.throughSequence < existing.sequence) {
          throw new Error("[text-open-world] 已提交命令缺少检查点。");
        }
        return {
          events: events.filter(
            (event) =>
              event.sequence >= existing.sequence &&
              event.sequence <= checkpoint.throughSequence,
          ),
          checkpoint,
          state: parseProductRuntimeState(checkpoint.stateJson),
        };
      }
      if (session.status !== "active")
        throw new Error("[text-open-world] 只有 active 实例可以提交命令。");
      let state = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events,
      );
      if (
        state.lastSequence !== input.baseSequence ||
        state.lastSequence !== previewState.lastSequence ||
        (await hashStateJson(JSON.stringify(state))) !== baseStateHash
      ) {
        throw new Error("[text-open-world] 世界状态已变化，请刷新后重试。");
      }
      if (
        !state.openWorld ||
        !state.adventure ||
        !state.openWorldEvolution ||
        state.openWorld.contentHash !== frozen.packageHash ||
        state.adventure.contentHash !== frozen.packageHash ||
        state.openWorldEvolution.contentHash !== frozen.packageHash
      ) {
        throw new Error("[text-open-world] 实例冻结状态与 Product Release/Build 不一致。");
      }
      const plan = planOpenWorldCommand({
        manifest,
        state,
        seed: session.seed,
        command,
      });
      const appended: ProductRuntimeEvent[] = [];
      const createdAt = Date.now();
      const append = (
        descriptor: OpenWorldEventPlan["descriptors"][number],
        envelope = false,
      ) => {
        const commandEnvelope = envelope
          ? { commandId, baseSequence: input.baseSequence, baseStateHash }
          : {};
        const event: ProductRuntimeEvent = {
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
        state = applyProductRuntimeEvent(state, event);
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
        event.id = (await db.productRuntimeEvents.add(event)) as number;
      const stateJson = JSON.stringify(state);
      const checkpoint: ProductRuntimeCheckpoint = {
        projectId: session.projectId,
        worldGroupId: session.worldGroupId ?? null,
        sessionId: session.id!,
        throughSequence: state.lastSequence,
        name: checkpointName,
        stateJson,
        stateHash: await hashStateJson(stateJson),
        createdAt,
      };
      checkpoint.id = (await db.productRuntimeCheckpoints.add(
        checkpoint,
      )) as number;
      await db.productRuntimeSessions.update(session.id!, { updatedAt: createdAt });
      return { events: appended, checkpoint, state };
    },
  );
}
