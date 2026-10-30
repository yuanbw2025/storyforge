/** Product-owned deterministic runtime commands: character. */
import { db } from "../db/schema";
import {scopeTransactionTables} from '../workspace/scope';
import type {WorkspaceScope, ChatComposerDraftV1} from '../types';
import {ChatComposerConflictError, chatComposerAudienceEqualV1, parseChatComposerDraftV1} from './composer-draft-contract';
import {readChatComposerSessionV1} from './composer-draft-read';
import {replayChatRuntimeEventsV1} from './runtime-replay';
import {chatActionChoiceVersionForContractV1, parseChatActionChoiceVersionV1} from './action-choice-budget';
import {assertChatControlHandoffBindingsV1} from './control-handoff-wire';
import {assertChatTurnCompletionBindingV1} from './turn-completion';
import {chatInquiryEvidenceVersionForContractV1, parseChatInquiryEvidenceVersionV1} from './inquiry-evidence';
import type {ChatControlHandoffV1, ChatControlHandoffReviewV1} from './control-handoff-contract';
import type { ProductRuntimeCommandEnvelopeV1 } from "../product/runtime-command-id";
import { JsonObject, applyProductRuntimeEvent, assertFormalRuntimeSourceUnchangedV1, hashStateJson, normalizeCommandId, parseEventPayload, parseProductRuntimeState, readSessionEvents, replayProductRuntimeEvents, stableJson, updateProductRuntimeSessionHeadV1, verifyFormalRuntimeSourceV1 } from "../product/runtime-core";
import { assertTextOpenWorldRuntimeNewWorkV1 } from '../open-world/source-admission';
import type { ProductRuntimeEventType, ProductRuntimeEvent, InteractionMemoryKind } from "../types";
import type { ChatNarrativeActionV1, ChatNarrativeActionReviewV1, ChatNarrativeTriggerV1, ChatSituationDraftV1, ChatSituationReviewV1 } from "../types/chat-narrative";

export interface ChatComposerSendBindingV1 {scope: WorkspaceScope; sessionId: number; revision: number; text: string; audienceKeys?: string[] | null}
export async function saveChatComposerDraftV1(input: {scope: WorkspaceScope; sessionId: number; expectedRevision: number; text: string; audienceKeys?: string[] | null}): Promise<ChatComposerDraftV1> {
  const request = structuredClone(input);
  return db.transaction('rw', scopeTransactionTables(db.productRuntimeSessions), async () => {
    const session = await readChatComposerSessionV1(request.scope, request.sessionId);
    if (!['active', 'paused'].includes(session.status)) throw new Error('已结束或归档的存档不能修改输入草稿。');
    const current = session.chatComposerDraft === undefined ? null : parseChatComposerDraftV1(session.chatComposerDraft);
    if ((current?.revision ?? 0) !== request.expectedRevision) throw new ChatComposerConflictError(current);
    // An old text-only caller cannot silently widen a saved private draft.
    const audienceKeys = request.audienceKeys === undefined ? current?.audienceKeys : request.audienceKeys;
    const draft = parseChatComposerDraftV1({version: 1, text: request.text, revision: request.expectedRevision + 1, updatedAt: Date.now(),
      ...(audienceKeys !== undefined ? {audienceKeys} : {})}, parseProductRuntimeState(session.initialStateJson).interaction?.profiles.map(p => p.participantKey) ?? []);
    await db.productRuntimeSessions.update(request.sessionId, {chatComposerDraft: draft});
    return draft;
  });
}
async function appendInteractionCommand(
  input: ProductRuntimeCommandEnvelopeV1 & {
    type: Extract<ProductRuntimeEventType, `interaction.${string}`>;
    actorKey?: string | null;
    targetKey?: string | null;
    payload: JsonObject;
    harnessRun?: {id: number; lastSequence: number};
    composerDraft?: ChatComposerSendBindingV1;
  },
): Promise<ProductRuntimeEvent> {
  input = structuredClone(input)
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
  if (input.type === 'interaction.narrative.action-reviewed.committed'
    && (input.payload.action as unknown as ChatNarrativeActionV1)?.turnCompletion != null && input.payload.actionChoiceVersion !== 1) {
    throw new Error('本轮结束必须绑定实际选择、表达与独立审查运行。');
  }
  // A retained OW command is its original immutable evidence, including when
  // the old Release is no longer present. This branch grants no new command.
  if (previewSession.kind === 'text-open-world' && !input.composerDraft) {
    const prior = previewEvents.find(event => event.commandId === commandId);
    if (prior) {
      const payload = { ...input.payload, commandId, baseSequence: input.baseSequence, baseStateHash };
      if (prior.type !== input.type || prior.baseSequence !== input.baseSequence || prior.baseStateHash !== baseStateHash
        || stableJson(parseEventPayload(prior)) !== stableJson(payload)) {
        throw new Error('互动命令 commandId 已被不同命令使用。');
      }
      return prior;
    }
  }
  const frozenOpenWorld = previewSession.kind === 'text-open-world'
    ? await verifyFormalRuntimeSourceV1(previewSession, ['text-open-world']) : null;
  const sourceTables = frozenOpenWorld ? [db.productReleases, db.productBuilds,
    db.productProductions, db.productProductionBriefs] : [];
  if (input.type === 'interaction.narrative.control-handoff.committed' && !previewEvents.some(event => event.commandId === commandId)) {
    if (!input.harnessRun) throw new Error('交还控制必须绑定原已审查运行。');
    const {assertChatActionChoiceCommitEvidenceV1} = await import('./action-choice-evidence');
    await assertChatActionChoiceCommitEvidenceV1({scope: {projectId: previewSession.projectId, worldId: previewSession.worldId, workId: previewSession.workId},
      runId: input.harnessRun.id, lastSequence: input.harnessRun.lastSequence, sessionId: input.sessionId, baseSequence: input.baseSequence,
      baseStateHash, commandId, actorKey: input.payload.actorKey as string, triggerSequence: input.payload.triggerSequence as number,
      outcome: 'handoff', handoff: input.payload.handoff as unknown as ChatControlHandoffV1, review: input.payload.review as unknown as ChatControlHandoffReviewV1});
  }
  if (input.type === 'interaction.narrative.action-reviewed.committed' && input.payload.actionChoiceVersion !== undefined
    && !previewEvents.some(event => event.commandId === commandId)) {
    if (!input.harnessRun) throw new Error('角色行动选择额度必须绑定原运行。');
    const run = await db.agentRuns.get(input.harnessRun.id);
    if (!run || chatActionChoiceVersionForContractV1(JSON.parse(run.contractJson)) !== parseChatActionChoiceVersionV1(input.payload.actionChoiceVersion)) {
      throw new Error('角色行动选择额度与原运行合同不一致。');
    }
    assertChatTurnCompletionBindingV1(input.payload.action as unknown as ChatNarrativeActionV1, JSON.parse(run.contractJson));
    const {assertChatActionChoiceCommitEvidenceV1} = await import('./action-choice-evidence');
    await assertChatActionChoiceCommitEvidenceV1({scope: {projectId: previewSession.projectId, worldId: previewSession.worldId, workId: previewSession.workId},
      runId: input.harnessRun.id, lastSequence: input.harnessRun.lastSequence, sessionId: input.sessionId, baseSequence: input.baseSequence,
      baseStateHash, commandId, actorKey: input.payload.actorKey as string, triggerSequence: input.payload.triggerSequence as number,
      messageId: input.payload.messageId as string, action: input.payload.action as unknown as ChatNarrativeActionV1,
      review: input.payload.review as unknown as ChatNarrativeActionReviewV1});
  }
  const previewState = previewSession.kind === 'character-interaction'
    ? replayChatRuntimeEventsV1(previewSession.initialStateJson, previewEvents)
    : replayProductRuntimeEvents(parseProductRuntimeState(previewSession.initialStateJson), previewEvents);
  if (previewSession.kind === 'character-interaction' && input.type === 'interaction.player.message.committed' && previewState.interaction?.chatNarrative) {
    const prior = previewEvents.find(event => event.commandId === commandId);
    // New narrative messages freeze their listeners in the reducer. An exact
    // retry of an old command keeps its original version and payload binding.
    const priorVersion = prior ? parseEventPayload(prior).playerAudienceVersion : undefined;
    if (!prior) input = {...input, payload: {...input.payload, playerAudienceVersion: 2}};
    else if (priorVersion === 1 || priorVersion === 2) input = {...input, payload: {...input.payload, playerAudienceVersion: priorVersion}};
  }
  const previewStateJson = JSON.stringify(previewState);
  const previewStateHash = await hashStateJson(previewStateJson);
  // A chat head is recoverable derived data, but it must be committed with the
  // exact event it describes. Prepare its hash before the IndexedDB transaction
  // and still replay/check the authoritative prefix inside that transaction.
  // Other products retain their existing command path.
  const preparedAt = Date.now();
  let preparedHead: {stateJson: string; stateHash: string} | undefined;
  if (previewSession.kind === 'character-interaction' && previewState.lastSequence === input.baseSequence
    && previewStateHash === baseStateHash && !previewEvents.some(event => event.commandId === commandId)) {
    const next = applyProductRuntimeEvent(previewState, {
      projectId: previewSession.projectId, worldGroupId: previewSession.worldGroupId ?? null, sessionId: input.sessionId,
      sequence: previewState.lastSequence + 1, type: input.type, actorKey: input.actorKey ?? null, targetKey: input.targetKey ?? null,
      commandId, baseSequence: input.baseSequence, baseStateHash,
      payloadJson: JSON.stringify({...input.payload, commandId, baseSequence: input.baseSequence, baseStateHash}), createdAt: preparedAt,
    });
    const stateJson = JSON.stringify(next);
    preparedHead = {stateJson, stateHash: await hashStateJson(stateJson)};
  }
  return db.transaction(
    "rw",
    input.composerDraft ? scopeTransactionTables(db.productRuntimeSessions, db.productRuntimeEvents, db.agentRuns, ...sourceTables)
      : [db.productRuntimeSessions, db.productRuntimeEvents, db.agentRuns, ...sourceTables],
    async () => {
      const session = await db.productRuntimeSessions.get(input.sessionId);
      if (!session) throw new Error("角色互动会话不存在。");
      if (input.composerDraft) {
        if (input.type !== 'interaction.player.message.committed' || input.composerDraft.sessionId !== input.sessionId) throw new Error('草稿只能由对应存档的玩家发送。');
        await readChatComposerSessionV1(input.composerDraft.scope, input.sessionId);
      }
      if (
        session.kind !== "character-interaction" &&
        session.kind !== "ai-town" &&
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
      if (frozenOpenWorld) {
        if (session.kind !== previewSession.kind || session.projectId !== previewSession.projectId
          || session.worldId !== previewSession.worldId || session.workId !== previewSession.workId
          || session.initialStateJson !== previewSession.initialStateJson) {
          throw new Error('开放世界互动实例在命令提交前发生变化。');
        }
        assertTextOpenWorldRuntimeNewWorkV1(frozenOpenWorld.runtimePackage, '新增互动兼容事件');
        await assertFormalRuntimeSourceUnchangedV1({ previewSession, session, frozen: frozenOpenWorld });
      }
      let consumedDraft: ChatComposerDraftV1 | undefined;
      if (input.composerDraft) {
        const current = session.chatComposerDraft === undefined ? null : parseChatComposerDraftV1(session.chatComposerDraft);
        if (!current || current.revision !== input.composerDraft.revision || current.text !== input.composerDraft.text
          || !chatComposerAudienceEqualV1(current.audienceKeys, input.composerDraft.audienceKeys)
          || !chatComposerAudienceEqualV1(current.audienceKeys, input.payload.audienceKeys as string[] | null)
          || current.text.trim() !== input.payload.text) throw new ChatComposerConflictError(current);
        consumedDraft = parseChatComposerDraftV1({...current, text: '', revision: current.revision + 1, updatedAt: Date.now()});
      }
      if (session.status !== "active")
        throw new Error("只有 active 会话可以提交互动命令。");
      if (input.harnessRun) {
        const run = await db.agentRuns.get(input.harnessRun.id);
        if (!run || run.projectId !== session.projectId || run.productRuntimeSessionId !== session.id
          || run.status !== 'running' || run.lastSequence !== input.harnessRun.lastSequence) {
          throw new Error('角色行动运行已取消、暂停或变化，未提交后果。');
        }
        if (input.type === 'interaction.narrative.action-reviewed.committed'
          && chatActionChoiceVersionForContractV1(JSON.parse(run.contractJson)) !== parseChatActionChoiceVersionV1(input.payload.actionChoiceVersion)) {
          throw new Error('角色行动选择额度与原运行合同不一致。');
        }
        if (input.type === 'interaction.narrative.control-handoff.committed') assertChatControlHandoffBindingsV1(JSON.parse(run.contractJson), input.payload.handoff as unknown as ChatControlHandoffV1);
        if (input.type === 'interaction.narrative.situation.committed'
          && chatInquiryEvidenceVersionForContractV1(JSON.parse(run.contractJson)) !== parseChatInquiryEvidenceVersionV1(input.payload.inquiryEvidenceVersion)) {
          throw new Error('询问前提证据与原运行合同不一致。');
        }
      } else if (input.type === 'interaction.narrative.action-reviewed.committed' && input.payload.actionChoiceVersion !== undefined) {
        throw new Error('角色行动选择额度必须绑定原运行。');
      } else if (input.type === 'interaction.narrative.control-handoff.committed') {
        throw new Error('交还控制必须绑定原已审查运行。');
      } else if (input.type === 'interaction.narrative.situation.committed' && input.payload.inquiryEvidenceVersion !== undefined) {
        throw new Error('询问前提证据必须绑定原已审查运行。');
      }
      const state = session.kind === 'character-interaction'
        ? replayChatRuntimeEventsV1(session.initialStateJson, events)
        : replayProductRuntimeEvents(parseProductRuntimeState(session.initialStateJson), events);
      if (!state.interaction)
        throw new Error("当前会话不是角色互动存档。");
      if (state.interaction.chatNarrative && input.type === 'interaction.relationship.changed')
        throw new Error('主动叙事关系变化必须随已审查的行动一起提交。');
      if (input.type.startsWith('interaction.narrative.') && session.kind !== 'character-interaction')
        throw new Error('主动叙事命令只属于角色聊天。');
      if (state.lastSequence !== input.baseSequence)
        throw new Error("互动状态已变化，请刷新后重试。");
      if (
        previewState.lastSequence !== state.lastSequence ||
        previewStateHash !== baseStateHash
      ) {
        throw new Error("互动状态哈希已变化，请刷新后重试。");
      }
      if (preparedHead && (JSON.stringify(state) !== previewStateJson || session.kind !== previewSession.kind
        || session.projectId !== previewSession.projectId || session.worldId !== previewSession.worldId || session.workId !== previewSession.workId
        || session.runtimeSourceHash !== previewSession.runtimeSourceHash || session.initialStateJson !== previewSession.initialStateJson)) throw new Error('互动状态已变化，请刷新后重试。');
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
        createdAt: preparedHead ? preparedAt : Date.now(),
      };
      const committed = applyProductRuntimeEvent(state, event);
      if (preparedHead && JSON.stringify(committed) !== preparedHead.stateJson) throw new Error('互动事件与预计算运行态不一致，未提交。');
      event.id = (await db.productRuntimeEvents.add(event)) as number;
      if (preparedHead) await updateProductRuntimeSessionHeadV1({sessionId: input.sessionId, sequence: committed.lastSequence,
        stateJson: preparedHead.stateJson, stateHash: preparedHead.stateHash, updatedAt: event.createdAt});
      await db.productRuntimeSessions.update(input.sessionId, {
        updatedAt: event.createdAt,
        ...(consumedDraft ? {chatComposerDraft: consumedDraft} : {}),
      });
      return event;
    },
  );
}

export async function setChatMessageRetrieval(input: ProductRuntimeCommandEnvelopeV1 & {messageId: string; excluded: boolean}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.message-retrieval.changed', actorKey: 'player', payload: {messageId: input.messageId, excluded: input.excluded}});
}

export async function updateChatMessageEditDraft(input: ProductRuntimeCommandEnvelopeV1 & {text: string; cancel?: boolean}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: input.cancel ? 'interaction.narrative.edit.cancelled' : 'interaction.narrative.edit.requested', actorKey: 'player', payload: {text: input.cancel ? null : input.text.trim()}});
}

export async function requestChatNarrativeTrigger(input: ProductRuntimeCommandEnvelopeV1 & {
  kind: ChatNarrativeTriggerV1; sourceEventSequence: number; seed?: string | null; direction?: import('../types/chat-narrative').ChatTurnDirectionV1;
}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.trigger.requested', actorKey: 'player',
    payload: {kind: input.kind, sourceEventSequence: input.sourceEventSequence, seed: input.seed ?? null, ...(input.direction === undefined ? {} : {direction: input.direction})}});
}

export async function commitChatNarrativeAction(input: ProductRuntimeCommandEnvelopeV1 & {
  actorKey: string; triggerSequence: number; messageId: string; action: ChatNarrativeActionV1; review: ChatNarrativeActionReviewV1;
  factEvidenceVersion?: 1;
  resolutionEvidenceVersion?: 1;
  actionChoiceVersion?: 1;
  harnessRun?: {id: number; lastSequence: number};
}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.action-reviewed.committed',
    payload: {actorKey: input.actorKey, triggerSequence: input.triggerSequence, messageId: input.messageId, action: input.action, review: input.review,
      ...(input.factEvidenceVersion === undefined ? {} : {factEvidenceVersion: input.factEvidenceVersion}),
      ...(input.actionChoiceVersion === undefined ? {} : {actionChoiceVersion: input.actionChoiceVersion}),
      ...(input.resolutionEvidenceVersion === undefined ? {} : {resolutionEvidenceVersion: input.resolutionEvidenceVersion})}});
}

export async function commitChatControlHandoff(input: ProductRuntimeCommandEnvelopeV1 & {
  actorKey: string; triggerSequence: number; handoff: ChatControlHandoffV1; review: ChatControlHandoffReviewV1;
  harnessRun: {id: number; lastSequence: number};
}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.control-handoff.committed',
    payload: {actorKey: input.actorKey, triggerSequence: input.triggerSequence, handoff: input.handoff, review: input.review}});
}

export async function commitChatSituation(input: ProductRuntimeCommandEnvelopeV1 & {
  triggerSequence: number; draft: ChatSituationDraftV1; review: ChatSituationReviewV1;
  factEvidenceVersion?: 1;
  inquiryEvidenceVersion?: 1 | 2 | 3 | 4 | 5;
  harnessRun?: {id: number; lastSequence: number};
}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.situation.committed', actorKey: 'player',
    payload: {triggerSequence: input.triggerSequence, draft: input.draft, review: input.review,
      ...(input.factEvidenceVersion === undefined ? {} : {factEvidenceVersion: input.factEvidenceVersion}),
      ...(input.inquiryEvidenceVersion === undefined ? {} : {inquiryEvidenceVersion: input.inquiryEvidenceVersion})}});
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
    composerDraft?: ChatComposerSendBindingV1;
  },
): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({
    ...input,
    ...(input.composerDraft ? {composerDraft: structuredClone(input.composerDraft)} : {}),
    type: "interaction.player.message.committed",
    actorKey: "player",
    payload: {
      messageId: input.messageId.trim(),
      text: input.text.trim(),
      audienceKeys: input.audienceKeys == null ? null : [...input.audienceKeys],
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
    contentReview?: import('../types/chat-memory').ChatMemoryReviewReceiptV1;
    harnessRun?: {id: number; lastSequence: number};
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
      ...(input.contentReview === undefined ? {} : {contentReview: input.contentReview}),
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

export async function changeChatMemoryUse(input: ProductRuntimeCommandEnvelopeV1 & {
  memoryId: string; action: 'disable' | 'enable' | 'revoke' | 'pin' | 'unpin'; reason: string;
}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.memory-control.changed', actorKey: 'player',
    targetKey: input.memoryId.trim(), payload: {memoryId: input.memoryId.trim(), action: input.action, reason: input.reason.trim()}});
}

export async function correctChatMemory(input: ProductRuntimeCommandEnvelopeV1 & {
  memoryId: string; replacementMemoryId: string; content: string; sourceEventSequences: number[]; evidenceExcerpt: string; reason: string;
}): Promise<ProductRuntimeEvent> {
  return appendInteractionCommand({...input, type: 'interaction.narrative.memory.corrected', actorKey: 'player', targetKey: input.memoryId.trim(),
    payload: {memoryId: input.memoryId.trim(), replacementMemoryId: input.replacementMemoryId.trim(), content: input.content.trim(),
      sourceEventSequences: input.sourceEventSequences, evidenceExcerpt: input.evidenceExcerpt.trim(), reason: input.reason.trim()}});
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
