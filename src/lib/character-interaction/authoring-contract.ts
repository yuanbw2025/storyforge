import { parseChatSourceReviewV1, type ChatSourceReviewV1 } from './source-projection';
import { DEFAULT_CHAT_NARRATIVE_SETUP_V1, parseChatNarrativeSetupV1, type ChatNarrativeSetupV1 } from './narrative-setup';
import {isChatPrivateCharacterKeyV1, parseChatPrivateCharactersV1, type ChatPrivateCharacterV1} from './private-character';
import {parseChatVisualIntentV1, type ChatVisualIntentV1} from './visual-intent';
import {parseChatExperienceInfoV1, type ChatExperienceInfoV1} from './experience-info';
/** Product-owned S2 settings; these never mutate a source WorldRelease. */
export interface ChatAuthoringSettingsV1 {
    version: 1;
    playerRole: string;
    openingSituation: string;
    experience: string;
    mode: 'single' | 'multi';
    targetPlayMinutes: number;
    maxTurns: number;
    replyBudget: number;
    maxMemoryEntries: number;
    relationshipThreshold: number;
    contentBoundaries: string;
    qualityProfile: 'prototype' | 'internal' | 'commercial-candidate';
    characters: {
        sourceKey: string;
        voiceRules: string;
        privateKnowledge: string;
        initialTrust: number;
    }[];
}
/** Explicit upgrade only; existing drafts and frozen releases retain v1. */
export interface ChatAuthoringSettingsV2 extends Omit<ChatAuthoringSettingsV1, 'version'> {
    version: 2;
    sourceReview: ChatSourceReviewV1 | null;
    /** Explicit frozen-world background selection; absent in historical drafts. */
    backgroundResourceKeys?: string[];
}
/** Explicit opt-in until the full narrative production/runtime path is verified. */
export interface ChatAuthoringSettingsV3 extends Omit<ChatAuthoringSettingsV2, 'version'> {
    version: 3;
    narrative: ChatNarrativeSetupV1;
    /** Explicit author-created cast; absent in historical settings. */
    privateCharacters?: ChatPrivateCharacterV1[];
    /** Explicit public presentation draft; absent means the historical text-only contract. */
    visuals?: ChatVisualIntentV1;
    /** Author-entered publication statements; excluded from model contexts. */
    experienceInfo?: ChatExperienceInfoV1;
}
export type ChatAuthoringSettings = ChatAuthoringSettingsV1 | ChatAuthoringSettingsV2 | ChatAuthoringSettingsV3;
export function parseChatAuthoringSettings(value: unknown): ChatAuthoringSettings {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('角色聊天方案必须是对象');
    const row = value as Record<string, unknown>;
    if (row.version === 3) {
        const {narrative, privateCharacters, visuals, experienceInfo, ...base} = row;
        const parsed = parseChatAuthoringSettingsV2({...base, version: 2});
        const setup = parseChatNarrativeSetupV1(narrative);
        const authored = Object.prototype.hasOwnProperty.call(row, 'privateCharacters') ? parseChatPrivateCharactersV1(privateCharacters) : undefined;
        if (parsed.characters.some(c => isChatPrivateCharacterKeyV1(c.sourceKey)) || isChatPrivateCharacterKeyV1(setup.playerCharacterKey)) throw new Error('体验新角色不能伪装成世界人物或玩家来源');
        if (parsed.characters.length + (authored?.length ?? 0) > 8) throw new Error('世界人物与体验新角色合计最多 8 人');
        if (setup.playerCharacterKey && parsed.characters.some(c => c.sourceKey === setup.playerCharacterKey)) throw new Error('同一世界人物不能同时由玩家与 AI 扮演');
        if (parsed.sourceReview?.classifications.some(c => c.discovery) && !setup.permissions.maxDiscoveriesPerSituation) throw new Error('世界隐情发现需要明确启用调查额度');
        return {...parsed, version: 3, narrative: setup, ...(authored === undefined ? {} : {privateCharacters: authored}),
            ...(Object.prototype.hasOwnProperty.call(row, 'visuals') ? {visuals: parseChatVisualIntentV1(visuals)} : {}),
            ...(Object.prototype.hasOwnProperty.call(row, 'experienceInfo') ? {experienceInfo: parseChatExperienceInfoV1(experienceInfo)} : {})};
    }
    if (row.version === 1) return parseChatAuthoringSettingsV1(row);
    const parsed = parseChatAuthoringSettingsV2(row);
    if (parsed.sourceReview?.classifications.some(c => c.discovery)) throw new Error('世界隐情发现需要实验叙事方案及明确授权');
    return parsed;
}
function parseChatAuthoringSettingsV2(row: Record<string, unknown>): ChatAuthoringSettingsV2 {
    if (row.version !== 2 || !Object.prototype.hasOwnProperty.call(row, 'sourceReview'))
        throw new Error('角色聊天方案版本无效');
    const {sourceReview, backgroundResourceKeys, ...base} = row;
    const hasBackground = Object.prototype.hasOwnProperty.call(row, 'backgroundResourceKeys');
    if (hasBackground && (!Array.isArray(backgroundResourceKeys) || backgroundResourceKeys.length > 128
        || backgroundResourceKeys.some(key => typeof key !== 'string' || !key || key.length > 500)
        || new Set(backgroundResourceKeys).size !== backgroundResourceKeys.length)) throw new Error('背景资料最多选择 128 个不同的冻结资源');
    return {...parseChatAuthoringSettingsV1({...base, version: 1}), version: 2,
        ...(hasBackground ? {backgroundResourceKeys: [...backgroundResourceKeys as string[]].sort()} : {}),
        sourceReview: sourceReview === null ? null : parseChatSourceReviewV1(sourceReview)};
}
export const DEFAULT_CHAT_SETTINGS: ChatAuthoringSettingsV1 = { version: 1, playerRole: '', openingSituation: '', experience: '', mode: 'single', targetPlayMinutes: 30, maxTurns: 60, replyBudget: 120, maxMemoryEntries: 120, relationshipThreshold: 20, contentBoundaries: '不替玩家决定行动；不披露角色不知道的信息。', qualityProfile: 'prototype', characters: [] };
export const DEFAULT_CHAT_SETTINGS_V2: ChatAuthoringSettingsV2 = {...DEFAULT_CHAT_SETTINGS, version: 2, sourceReview: null};
export const DEFAULT_CHAT_SETTINGS_V3: ChatAuthoringSettingsV3 = {...DEFAULT_CHAT_SETTINGS_V2, version: 3, narrative: structuredClone(DEFAULT_CHAT_NARRATIVE_SETUP_V1)};
export function parseChatAuthoringSettingsV1(value: unknown): ChatAuthoringSettingsV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('角色聊天方案必须是对象');
    const row = value as Record<string, unknown>;
    if (Object.keys(row).length !== Object.keys(DEFAULT_CHAT_SETTINGS).length || Object.keys(row).some(k => !(k in DEFAULT_CHAT_SETTINGS)) || row.version !== 1)
        throw new Error('角色聊天方案字段或版本无效');
    for (const key of ['playerRole', 'openingSituation', 'experience', 'contentBoundaries'])
        if (typeof row[key] !== 'string' || String(row[key]).length > 5000)
            throw new Error(`${key} 最多 5000 字符`);
    if (!['single', 'multi'].includes(String(row.mode)) || !['prototype', 'internal', 'commercial-candidate'].includes(String(row.qualityProfile)))
        throw new Error('角色聊天模式无效');
    for (const [key, max] of [['targetPlayMinutes', 900], ['maxTurns', 1000], ['replyBudget', 10000], ['maxMemoryEntries', 1000], ['relationshipThreshold', 100]] as const)
        if (!Number.isInteger(row[key]) || Number(row[key]) < 1 || Number(row[key]) > max)
            throw new Error(`${key} 必须为 1～${max} 的整数`);
    if (!Array.isArray(row.characters) || row.characters.length > 8)
        throw new Error('最多配置 8 个角色');
    const keys = new Set<string>();
    for (const c of row.characters) {
        if (!c || typeof c !== 'object' || Object.keys(c).sort().join(',') !== 'initialTrust,privateKnowledge,sourceKey,voiceRules' || typeof c.sourceKey !== 'string' || !c.sourceKey || c.sourceKey.length > 500 || keys.has(c.sourceKey) || typeof c.voiceRules !== 'string' || c.voiceRules.length > 5000 || typeof c.privateKnowledge !== 'string' || c.privateKnowledge.length > 5000 || !Number.isInteger(c.initialTrust) || c.initialTrust < -100 || c.initialTrust > 100)
            throw new Error('人物设置无效：请选择独立来源并填写合法关系初值');
        keys.add(c.sourceKey);
    }
    return structuredClone(value) as ChatAuthoringSettingsV1;
}
export interface ChatAuthoringDraftV1 {
    id?: number;
    projectId: number;
    worldId: number;
    workId: number;
    revision: number;
    settingsJson: string;
    /** Optional in historical drafts; governed, author-confirmed product interpretations. */
    roleProfilesJson?: string;
    /** Optional source interpretations, requiring independent review and explicit author confirmation. */
    sourceUnitsJson?: string;
    worldReleaseId: number | null;
    productionId: number | null;
    conversationJson: string;
    createdAt: number;
    updatedAt: number;
}
