/** Product-owned deterministic runtime commands: character. */
import { db } from "../db/schema";
import type { ProductRuntimeCommandEnvelopeV1 } from "../product/runtime-command-id";
import { JsonObject, applyProductRuntimeEvent, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readSessionEvents, replayProductRuntimeEvents, stableJson } from "../product/runtime-core";
import type { ProductRuntimeEventType, ProductRuntimeEvent, InteractionMemoryKind } from "../types";
async function appendInteractionCommand(
  input: ProductRuntimeCommandEnvelopeV1 & {
    type: Extract<ProductRuntimeEventType, `interaction.${string}`>;
    actorKey?: string | null;
    targetKey?: string | null;
    payload: JsonObject;
  },
): Promise<ProductRuntimeEvent> {
  const commandId = normalizeCommandId(input.commandId);
  const baseStateHash = input.baseStateHash.trim();
  if (!Number.isInteger(input.baseSequence) || input.baseSequence < 0) {
    throw new Error("互动命令 baseSequence 无效。");
  }
  if (!/^[a-f0-9]{64}$/.test(baseStateHash))
    throw new Error("互动命令 baseStateHash 无效。");
  const previewSession = await db.productRuntimeSessions.get(input.sessionId);
  if (!previewSession) throw new Error("角色互动会话不存在。");
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
      if (!session) throw new Error("角色互动会话不存在。");
      if (
        session.kind !== "character-interaction" &&
        session.kind !== "text-adventure" &&
        session.kind !== "text-open-world"
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
      const state = replayProductRuntimeEvents(
        parseProductRuntimeState(session.initialStateJson),
        events,
      );
      if (!state.interaction)
        throw new Error("当前会话不是角色互动存档。");
      if (state.lastSequence !== input.baseSequence)
        throw new Error("互动状态已变化，请刷新后重试。");
      if (
        previewState.lastSequence !== state.lastSequence ||
        previewStateHash !== baseStateHash
      ) {
        throw new Error("互动状态哈希已变化，请刷新后重试。");
      }
      const event: ProductRuntimeEvent = {
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
      applyProductRuntimeEvent(state, event);
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      await db.productRuntimeSessions.update(input.sessionId, {
        updatedAt: event.createdAt,
      });
      return event;
    },
  );
}

export async function startInteractionScene(
  input: ProductRuntimeCommandEnvelopeV1 & {
    sceneId: string;
    sceneKey: string;
  },
): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.scene.started",
    targetKey: input.sceneKey.trim(),
    payload: { sceneId: input.sceneId.trim(), sceneKey: input.sceneKey.trim() },
  });
}

export async function endInteractionScene(
  input: ProductRuntimeCommandEnvelopeV1 & {
    sceneId: string;
    reason: string;
  },
): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.scene.ended",
    targetKey: input.sceneId.trim(),
    payload: { sceneId: input.sceneId.trim(), reason: input.reason.trim() },
  });
}

export async function joinInteractionParticipant(
  input: ProductRuntimeCommandEnvelopeV1 & {
    participantKey: string;
  },
): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.participant.joined",
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: { participantKey: input.participantKey.trim() },
  });
}

export async function leaveInteractionParticipant(
  input: ProductRuntimeCommandEnvelopeV1 & {
    participantKey: string;
  },
): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.participant.left",
    actorKey: input.participantKey.trim(),
    targetKey: input.participantKey.trim(),
    payload: { participantKey: input.participantKey.trim() },
  });
}

export async function commitInteractionPlayerMessage(
  input: ProductRuntimeCommandEnvelopeV1 & {
    messageId: string;
    text: string;
    audienceKeys?: string[] | null;
  },
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
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
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
    memoryId: string;
    participantKey: string;
    kind: InteractionMemoryKind;
    content: string;
    importance: number;
    sourceEventSequences: number[];
    evidenceExcerpt: string;
  },
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
    memoryId: string;
    resolution: "accepted" | "rejected";
  },
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
    memoryId: string;
    supersededByMemoryId: string;
  },
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
    knowledgeKey: string;
    fromParticipantKey: string;
    toParticipantKeys: string[];
    sourceEventSequence: number;
    evidenceExcerpt: string;
  },
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
    fromParticipantKey: string;
    toParticipantKey: string;
    dimensionKey: string;
    delta: number;
    reason: string;
    ruleKey: string;
    sourceEventSequence: number;
    significantEventKey?: string | null;
  },
): Promise<ProductRuntimeEvent> {
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
  input: ProductRuntimeCommandEnvelopeV1 & {
    threadKey: string;
    title: string;
  },
): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({
    ...input,
    type: "interaction.thread.opened",
    targetKey: input.threadKey.trim(),
    payload: { threadKey: input.threadKey.trim(), title: input.title.trim() },
  });
}

export async function resolveInteractionThread(
  input: ProductRuntimeCommandEnvelopeV1 & {
    threadKey: string;
    resolution: string;
  },
): Promise<ProductRuntimeEvent> {
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
