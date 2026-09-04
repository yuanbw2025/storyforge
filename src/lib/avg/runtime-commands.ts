/** Product-owned deterministic runtime commands: avg. */
import { applyProductRuntimeEvent, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readSessionEvents, replayProductRuntimeEvents } from "../product/runtime-core";
import { db } from "../db/schema";
import type { ProductRuntimeEvent } from "../types";
export async function reachAvgPresentationBeat(input: {
  sessionId: number;
  beatKey: string;
  commandId: string;
  baseSequence: number;
  baseStateHash: string;
  snapshotKey?: string | null;
}): Promise<ProductRuntimeEvent> {
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
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (
    !previewSession ||
    previewSession.kind !== "avg" ||
    (previewSession.productReleaseId == null && previewSession.productBuildId == null)
  ) {
    throw new Error("[avg] AVG Release/Build Preview 实例不存在");
  }
  const previewEvents = await readSessionEvents(previewSession);
  const previewState = replayProductRuntimeEvents(
    parseProductRuntimeState(previewSession.initialStateJson),
    previewEvents,
  );
  const previewHash = await hashStateJson(JSON.stringify(previewState));
  return db.transaction(
    "rw",
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "avg" ||
        (session.productReleaseId == null && session.productBuildId == null)
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
      const state = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
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
      const event: ProductRuntimeEvent = {
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
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      await db.productRuntimeSessions.update(session.id!, {
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
}): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const assetKey = input.assetKey.trim();
  const reason = input.reason.trim() || "资源不可用";
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(assetKey))
    throw new Error("[avg] 失败媒资 key 无效");
  if (reason.length > 2_000) throw new Error("[avg] 媒资失败原因过长");
  return db.transaction(
    "rw",
    db.productRuntimeSessions,
    db.productRuntimeEvents,
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (
        !session ||
        session.kind !== "avg" ||
        (session.productReleaseId == null && session.productBuildId == null)
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
      const state = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events,
      );
      const event: ProductRuntimeEvent = {
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
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      await db.productRuntimeSessions.update(session.id!, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}
