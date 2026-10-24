import { updateWorkTitle } from "../workspace/works";
import { db } from "../db/schema";
import type { WorkspaceScope } from "../types";
import { createWorkspace, workspaceCreationTransactionTablesV1, } from "../workspace/create-workspace";
import { assertRecordInScope, resolveScope, scopeTransactionTables, stampNewRecord, } from "../workspace/scope";
import { cacheWorldReferenceForProductV1 } from "../world-engine/reference-cache";
import { DEFAULT_CHAT_SETTINGS, DEFAULT_CHAT_SETTINGS_V2, DEFAULT_CHAT_SETTINGS_V3, parseChatAuthoringSettings, type ChatAuthoringDraftV1, type ChatAuthoringSettings, } from "./authoring-contract";
import { loadProductProductionConsultationSourceV2, loadProductProductionWorldSourceCatalogV2 } from '../product-production/world-source';
import { readChatSourceProjectionViewV1, type ChatSourceReviewV1 } from './source-projection';
import { canonicalStringify } from '../agent/run/hash';
export async function createChatDraftV1(title: string, settings: ChatAuthoringSettings = DEFAULT_CHAT_SETTINGS) {
    if (!title.trim() || title.length > 200)
        throw new Error("请填写 1～200 字的 角色聊天 名称");
    const parsed = parseChatAuthoringSettings(settings);
    if (parsed.version !== 1 && parsed.sourceReview !== null)
        throw new Error('新作品须选择来源后通过资料检查确认可见范围');
    return db.transaction("rw", [...workspaceCreationTransactionTablesV1(), db.chatAuthoringDrafts], async () => {
        const created = await createWorkspace({
            name: title.trim(),
            description: "",
            genres: [],
            status: "drafting",
            targetWordCount: 10000,
        }, { kind: "character-interaction" });
        const now = Date.now();
        await db.chatAuthoringDrafts.add(stampNewRecord(created.scope, "chatAuthoringDrafts", {
            ...created.scope,
            revision: 0,
            settingsJson: JSON.stringify(parsed),
            conversationJson: "[]",
            worldReleaseId: null,
            productionId: null,
            createdAt: now,
            updatedAt: now,
        }, { owner: "work" }));
        return created;
    });
}
/** New authoring entry; a new Work must review its own selected source first. */
export async function createChatDraftV2(title: string, settings: ChatAuthoringSettings = DEFAULT_CHAT_SETTINGS_V2) {
    if (settings.version === 3) return createChatDraftV1(title, {...settings, sourceReview: null});
    return createChatDraftV1(title, {...settings, version: 2, sourceReview: null});
}
export async function createChatDraftV3(title: string) {
    return createChatDraftV1(title, structuredClone(DEFAULT_CHAT_SETTINGS_V3));
}
export async function readChatDraftV1(scopeInput: WorkspaceScope): Promise<ChatAuthoringDraftV1> {
    const scope = await resolveScope({ scope: scopeInput });
    const row = await db.chatAuthoringDrafts
        .where("workId")
        .equals(scope.workId)
        .first();
    if (!row ||
        !(await assertRecordInScope(scope, "chatAuthoringDrafts", row, {
            owner: "work",
        })))
        throw new Error("角色聊天 方案不存在或不属于当前作品");
    parseChatAuthoringSettings(JSON.parse(row.settingsJson));
    return row;
}
export async function saveChatDraftV1(scope: WorkspaceScope, revision: number, settings: ChatAuthoringSettings, title?: string) {
    const parsed = parseChatAuthoringSettings(settings);
    if (title !== undefined && (!title.trim() || title.length > 200))
        throw new Error("请填写 1～200 字的作品名称");
    return db.transaction("rw", scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision)
            throw new Error("角色聊天 方案已在其他页面修改，请刷新后再保存");
        const previous = parseChatAuthoringSettings(JSON.parse(row.settingsJson));
        if (parsed.version < previous.version)
            throw new Error('旧版方案候选不能覆盖已确认的资料范围，请重新讨论当前方案');
        if (parsed.version !== 1 && parsed.sourceReview !== null && canonicalStringify(parsed.sourceReview) !==
            canonicalStringify(previous.version !== 1 ? previous.sourceReview : null))
            throw new Error('请通过资料检查确认新的可见范围');
        // A change of cast/order changes projection identity. Keep other edits,
        // but require the author to review the new viewpoints before a build.
        if (parsed.version !== 1 && (previous.mode !== parsed.mode ||
            (previous.version === 3 ? previous.narrative.playerCharacterKey : undefined) !== (parsed.version === 3 ? parsed.narrative.playerCharacterKey : undefined) ||
            canonicalStringify(previous.version === 3 ? previous.privateCharacters ?? [] : []) !== canonicalStringify(parsed.version === 3 ? parsed.privateCharacters ?? [] : []) ||
            JSON.stringify(previous.characters.map(c => c.sourceKey)) !== JSON.stringify(parsed.characters.map(c => c.sourceKey)) ||
            JSON.stringify(previous.version === 1 ? [] : previous.backgroundResourceKeys ?? []) !== JSON.stringify(parsed.backgroundResourceKeys ?? [])))
            parsed.sourceReview = null;
        const next = {
            ...row,
            settingsJson: JSON.stringify(parsed),
            revision: revision + 1,
            updatedAt: Date.now(),
        };
        await db.chatAuthoringDrafts.put(next);
        if (title !== undefined)
            await updateWorkTitle(scope, title);
        return next;
    });
}
export async function selectChatWorldV1(scope: WorkspaceScope, revision: number, releaseId: number) {
    const current = await readChatDraftV1(scope);
    if (current.revision !== revision)
        throw new Error("角色聊天 方案已变化，请刷新后重新选择世界");
    const localId = await cacheWorldReferenceForProductV1(scope, releaseId);
    return db.transaction("rw", scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision)
            throw new Error("角色聊天 方案已变化，请刷新后重新选择世界");
        const settings = parseChatAuthoringSettings(JSON.parse(row.settingsJson));
        if (row.worldReleaseId !== localId) {
            settings.characters = [];
            if (settings.version === 3) delete settings.narrative.playerCharacterKey;
            if (settings.version !== 1) {settings.sourceReview = null; if (settings.backgroundResourceKeys) settings.backgroundResourceKeys = [];}
        }
        const next = {
            ...row,
            worldReleaseId: localId,
            settingsJson: JSON.stringify(settings),
            revision: revision + 1,
            updatedAt: Date.now(),
        };
        await db.chatAuthoringDrafts.put(next);
        return next;
    });
}

/** Read-only S2 inspection of exactly the selected frozen roles. */
export async function loadChatSourceProjectionV1(scope: WorkspaceScope, revision: number) {
    const row = await readChatDraftV1(scope);
    if (row.revision !== revision) throw new Error('方案已变化，请保存并重新检查资料');
    const settings = parseChatAuthoringSettings(JSON.parse(row.settingsJson));
    const keys = settings.characters.map(c => c.sourceKey);
    const privateCharacters = settings.version === 3 ? settings.privateCharacters ?? [] : [];
    const background = settings.version === 1 ? [] : settings.backgroundResourceKeys ?? [];
    const player = settings.version === 3 && settings.narrative.playerCharacterKey ? [settings.narrative.playerCharacterKey] : [];
    if (!row.worldReleaseId || keys.length + privateCharacters.length === 0 || (settings.mode === 'single' && keys.length + privateCharacters.length !== 1))
        throw new Error('请先选择冻结世界和参与角色，单角色模式须选择一人');
    const source = await loadProductProductionConsultationSourceV2({scope, worldReleaseId: row.worldReleaseId});
    const catalog = await loadProductProductionWorldSourceCatalogV2({scope, worldReleaseId: row.worldReleaseId,
        chatPrivateCharacters: privateCharacters,
        selection: {schema: 'storyforge.product-world-source-selection', version: 1, productType: 'character-interaction',
            worldReferenceHash: source.worldReference.referenceHash, resourceKeys: [...keys, ...player, ...background].sort(), roleBindings: {characters: keys, ...(player.length ? {chatPlayer: player} : {}), ...(background.length ? {chatBackground: background} : {})}}});
    if (!catalog.chatSourceProjection) throw new Error('角色来源投影未就绪');
    return catalog.chatSourceProjection;
}

/** The author confirms the displayed classification; no model call or world write. */
export async function confirmChatSourceReviewV1(scope: WorkspaceScope, revision: number, review: ChatSourceReviewV1) {
    const snapshot = structuredClone(review);
    const projection = await loadChatSourceProjectionV1(scope, revision);
    if (projection.projectionHash !== snapshot.projectionHash) throw new Error('来源投影已变化，请重新检查');
    await readChatSourceProjectionViewV1({draft: projection, classifications: snapshot.classifications, viewerKey: 'player'});
    return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision) throw new Error('方案已变化，本次资料确认未保存');
        const previous = parseChatAuthoringSettings(JSON.parse(row.settingsJson));
        const settings = parseChatAuthoringSettings({...previous, version: previous.version === 3 ? 3 : 2, sourceReview: snapshot});
        const next = {...row, settingsJson: JSON.stringify(settings), revision: revision + 1, updatedAt: Date.now()};
        await db.chatAuthoringDrafts.put(next);
        return next;
    });
}
export interface ChatConversationTurnV1 {
    archived?: boolean;
    id: string;
    question: string;
    answer: string;
    settings: ChatAuthoringSettings | null;
    runId: number | null;
    error: string;
    createdAt: number;
}
export async function saveChatConversationV1(scope: WorkspaceScope, revision: number, turn: ChatConversationTurnV1) {
    if (turn.question.length > 5000 || turn.answer.length > 12000)
        throw new Error("角色聊天 会谈内容过长");
    if (turn.settings)
        parseChatAuthoringSettings(turn.settings);
    return db.transaction("rw", scopeTransactionTables(db.chatAuthoringDrafts), async () => {
        const row = await readChatDraftV1(scope);
        if (row.revision !== revision)
            throw new Error("方案已变化，候选保留在任务记录中，请重新对照当前方案");
        const history = JSON.parse(row.conversationJson) as ChatConversationTurnV1[];
        const next = {
            ...row,
            conversationJson: JSON.stringify([
                ...history.filter((t) => t.id !== turn.id),
                turn,
            ]),
            revision: revision + 1,
            updatedAt: Date.now(),
        };
        await db.chatAuthoringDrafts.put(next);
        return next;
    });
}

/** Keep the ledger while starting a fresh consultation on the same saved settings. */
export async function archiveChatConversationV1(scope: WorkspaceScope, revision: number) {
  return db.transaction('rw', scopeTransactionTables(db.chatAuthoringDrafts), async () => {
    const row = await readChatDraftV1(scope)
    if (row.revision !== revision) throw new Error('会谈已变化，请刷新后再开始新会谈')
    const history = JSON.parse(row.conversationJson) as ChatConversationTurnV1[]
    const next = {...row, conversationJson: JSON.stringify(history.map(turn => ({...turn, archived: true}))), revision: revision + 1, updatedAt: Date.now()}
    await db.chatAuthoringDrafts.put(next)
    return next
  })
}
