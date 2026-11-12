import type { AiTownBriefSettingsV1 } from '../types/ai-town';
export const DEFAULT_AI_TOWN_SETTINGS: AiTownBriefSettingsV1 = {
  playerRole: 'new-resident', playerName: '新居民', homeConcept: '一间靠近公共空间、可安全休息的小屋',
  townTitle: '', elapsedDays: 90, romance: 'off', residentTarget: 6, majorLocationTarget: 4,
  actionsPerDay: 3, offlineEnabled: true, offlineMaximumDays: 3,
  resourceKeys: ['materials', 'food', 'care'], startingMoney: 200,
  sharedProjectConcept: '修复一处让居民能够共同生活与相遇的公共设施',
  portraits: true, expressions: true, locationCards: true, ambientAudio: false,
};
export interface AiTownAuthoringSettingsV1 { town: Omit<AiTownBriefSettingsV1,'townTitle'>; openingSituation: string; qualityProfile: 'prototype'|'internal'|'commercial-candidate' }
export const defaultAiTownSettings = ():AiTownAuthoringSettingsV1 => {const town:Partial<AiTownBriefSettingsV1>=structuredClone(DEFAULT_AI_TOWN_SETTINGS);delete town.townTitle;return {town:town as AiTownAuthoringSettingsV1['town'],openingSituation:'',qualityProfile:'prototype'};};
export interface AiTownAuthoringDraftV1 {
 id?:number;projectId:number;worldId:number;workId:number;revision:number;settingsJson:string;
 worldReleaseId:number|null;productionId:number|null;selectionJson:string|null;suggestionKey:string|null;preparedRevision:number|null;
  sourcePurpose?: import('../world-engine/source-purpose-contract').WorldSourcePurposeProofV1;
 conversationJson:string;createdAt:number;updatedAt:number;
}
export function parseAiTownSettings(value:unknown):AiTownAuthoringSettingsV1 {
 const fail=()=>{throw new Error('小镇方案字段或取值无效')};
 if(!value||typeof value!=='object'||Array.isArray(value))return fail();
 const s=value as AiTownAuthoringSettingsV1;
 if(Object.keys(s).sort().join()!=='openingSituation,qualityProfile,town'||typeof s.openingSituation!=='string'||s.openingSituation.length>2000||!['prototype','internal','commercial-candidate'].includes(s.qualityProfile))return fail();
 const t=s.town;
 if(!t||typeof t!=='object'||Object.keys(t).sort().join()!==Object.keys(DEFAULT_AI_TOWN_SETTINGS).filter(k=>k!=='townTitle').sort().join())return fail();
 for(const k of ['playerName','homeConcept','sharedProjectConcept'] as const)if(typeof t[k]!=='string'||t[k].length>1000)return fail();
 for(const k of ['offlineEnabled','portraits','expressions','locationCards','ambientAudio'] as const)if(typeof t[k]!=='boolean')return fail();
 for(const [k,min,max] of [['elapsedDays',1,36500],['residentTarget',4,8],['majorLocationTarget',4,12],['actionsPerDay',1,6],['offlineMaximumDays',1,3],['startingMoney',0,100000]] as const)if(!Number.isInteger(t[k])||t[k]<min||t[k]>max)return fail();
 if(!['new-resident','caretaker'].includes(t.playerRole)||!['off','canon-only','opt-in'].includes(t.romance))return fail();
 if(!Array.isArray(t.resourceKeys)||t.resourceKeys.length<1||t.resourceKeys.length>3||new Set(t.resourceKeys).size!==t.resourceKeys.length||t.resourceKeys.some(v=>typeof v!=='string'||!v.trim()||v.length>80||!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(v)))return fail();
 return structuredClone(s);
}
export function settingsFromAiTownDraft(row:AiTownAuthoringDraftV1){return parseAiTownSettings(JSON.parse(row.settingsJson));}
export function serializeAiTownSettings(s:AiTownAuthoringSettingsV1){return {settingsJson:JSON.stringify(parseAiTownSettings(s))};}
