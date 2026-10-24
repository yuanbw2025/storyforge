import {CHAT_OPENING_AGENCY_CREATION_RULE_V2} from './opening-agency'
import { canonicalStringify } from '../agent/run/hash'
import { canonicalProductProductionJsonV2, hashProductProductionValueV2 } from '../product-production/hash'
import type { ChatAuthoringSettingsV3 } from './authoring-contract'
import { parseChatAuthoringSettings } from './authoring-contract'
import { parseFrozenChatNarrativeV1 } from './narrative-contract'
import { parseFrozenChatSourceV1 } from './runtime'
import {createChatPersonaV1} from './persona-source'
import type { ChatSituationV1, FrozenChatNarrativeV1 } from '../types/chat-narrative'
import type { FrozenChatSourceProjectionV1 } from '../types/character-interaction'
import type { ProductRuntimePackageV1 } from '../types'

export interface ChatNarrativeProductionSourceV1 {
  schema: 'storyforge.chat-narrative-production-source'
  version: 1
  settings: ChatAuthoringSettingsV3
  source: FrozenChatSourceProjectionV1
  participants: Array<{participantKey: string; characterKey: string; name: string; voiceRules: string}>
}

export interface ChatSituationOptionV1 {
  optionKey: string
  title: string
  pitch: string
  /** The seed and author-confirmed provenance are added only at the selection boundary. */
  situation: Omit<ChatSituationV1, 'seed'>
}
export interface ChatSituationCandidatesV1 {
  schema: 'storyforge.chat-situation-candidates'
  version: 1
  options: ChatSituationOptionV1[]
}
export interface ChatSituationSelectionV1 {
  schema: 'storyforge.chat-situation-selection'
  version: 1
  candidatesHash: string
  sourceHash: string
  selectedOptionKey: string
  authorCommandId: string
}

function fail(message: string): never {throw new Error(`[chat-production] ${message}`)}
function record(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== fields.split(',').sort().join(',')) fail('情境生产字段无效')
  return value as Record<string, unknown>
}
function text(value: unknown, max: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('情境生产文本无效')
}
function key(value: unknown): asserts value is string {
  text(value, 160)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(value)) fail('情境候选标识无效')
}

export function validateChatNarrativeProductionSourceV1(value: ChatNarrativeProductionSourceV1): void {
  record(value, 'schema,version,settings,source,participants')
  if (value.schema !== 'storyforge.chat-narrative-production-source' || value.version !== 1) fail('情境来源类型无效')
  const settings = parseChatAuthoringSettings(value.settings)
  if (settings.version !== 3 || !settings.sourceReview || !settings.playerRole.trim() || !settings.openingSituation.trim()) fail('情境制作需要已确认资料、玩家虚构背景和开场种子')
  if (settings.privateCharacters !== undefined) fail('情境模型不能读取未分类的体验新角色原文')
  if (settings.visuals !== undefined) fail('画面草稿不能进入情境模型或成为故事事实')
  if (settings.experienceInfo !== undefined) fail('作品署名与使用说明不能进入情境模型或成为故事事实')
  if (settings.sourceReview.projectionHash !== value.source.projectionHash) fail('情境来源确认已过期')
  if (!Array.isArray(value.participants) || !value.participants.length || value.participants.length > 8 || settings.mode === 'single' && value.participants.length !== 1) fail('情境参与角色与模式不符')
  const resourceKeys = value.participants.map(p => p.characterKey)
  if (new Set(resourceKeys).size !== resourceKeys.length
    || canonicalStringify([...resourceKeys].sort()) !== canonicalStringify([...settings.characters.map(c => c.sourceKey), ...(value.source.privateCharacterSources ?? []).map(c => c.resourceKey)].sort())) fail('情境参与者与作者选择不符')
  const participantKeys = value.participants.map(p => p.participantKey)
  if (participantKeys.includes('player') || new Set(participantKeys).size !== participantKeys.length) fail('情境角色身份重复')
  for (const p of value.participants) {record(p, 'participantKey,characterKey,name,voiceRules'); key(p.participantKey); text(p.name, 240); text(p.voiceRules, 8000)}
  parseFrozenChatSourceV1(value.source, participantKeys, resourceKeys)
  createChatPersonaV1(settings, value.source)
}

function frozen(option: ChatSituationOptionV1, input: ChatNarrativeProductionSourceV1): FrozenChatNarrativeV1 {
  return {
    schema: 'storyforge.chat-narrative-content', version: 1, worldReleaseHash: input.source.worldReleaseHash,
    persona: createChatPersonaV1(input.settings, input.source),
    permissions: structuredClone(input.settings.narrative.permissions),
    initialSituation: {...structuredClone(option.situation), seed: {text: input.settings.openingSituation, origin: 'author-confirmed', sourceEventSequence: 0, sourceThreadKey: null}},
  }
}

/** Validates model drafts against the exact reviewed source, not an author-workspace summary. */
export function parseChatSituationCandidatesV1(value: unknown, input: ChatNarrativeProductionSourceV1): ChatSituationCandidatesV1 {
  validateChatNarrativeProductionSourceV1(input)
  const row = record(value, 'schema,version,options')
  if (row.schema !== 'storyforge.chat-situation-candidates' || row.version !== 1) fail('情境候选版本无效')
  if (!Array.isArray(row.options) || row.options.length !== input.settings.narrative.openingCount) fail('情境候选数量与作者设置不符')
  validateOptions(row.options, input)
  return structuredClone(value) as ChatSituationCandidatesV1
}

/** Repair planning only: every retained option must be valid before requesting
 * missing options. Formal adoption still requires the complete candidate set. */
export function validateChatSituationOptionSubsetV1(options: unknown[], input: ChatNarrativeProductionSourceV1): void {
  validateChatNarrativeProductionSourceV1(input)
  if (!Array.isArray(options) || options.length < 1 || options.length > input.settings.narrative.openingCount) fail('待修复情境数量无效')
  validateOptions(options, input)
}

function validateOptions(options: unknown[], input: ChatNarrativeProductionSourceV1): void {
  const seen = new Set<string>(), bodies = new Set<string>()
  for (const raw of options) {
    const item = record(raw, 'optionKey,title,pitch,situation')
    key(item.optionKey); text(item.title, 1000); text(item.pitch, 2000)
    if (seen.has(item.optionKey)) fail('情境候选身份重复')
    seen.add(item.optionKey)
    const situation = record(item.situation, 'situationKey,sceneKey,title,location,timeLabel,facts,goals,beliefs,threads,possibilities')
    const setup = input.settings.narrative
    if (setup.location && situation.location !== setup.location || setup.timeLabel && situation.timeLabel !== setup.timeLabel) fail('情境候选改写了指定时间或地点')
    const content = frozen(raw as ChatSituationOptionV1, input)
    parseFrozenChatNarrativeV1(content, {source: input.source, participantKeys: input.participants.map(p => p.participantKey),
      characterKeys: input.participants.map(p => p.characterKey), sceneKeys: [content.initialSituation.sceneKey]})
    if (input.participants.some(p => !content.initialSituation.goals.some(g => g.actorKey === p.participantKey))) fail('每位参与角色都需要自身目标')
    if (setup.permissions.mode === 'story' && !content.initialSituation.threads.length) fail('剧情模式需要可以推进或收束的未完成事项')
    const body = canonicalStringify({...situation, situationKey: '', sceneKey: '', title: ''})
    if (bodies.has(body)) fail('不同开场不能只替换标题和标识')
    bodies.add(body)
  }
}

export async function selectChatNarrativeCandidateV1(input: {
  candidates: unknown; source: ChatNarrativeProductionSourceV1; selection: ChatSituationSelectionV1
}): Promise<FrozenChatNarrativeV1> {
  const candidates = parseChatSituationCandidatesV1(input.candidates, input.source)
  const row = record(input.selection, 'schema,version,candidatesHash,sourceHash,selectedOptionKey,authorCommandId')
  if (row.schema !== 'storyforge.chat-situation-selection' || row.version !== 1) fail('情境选择版本无效')
  key(row.selectedOptionKey); text(row.authorCommandId, 200)
  if (row.candidatesHash !== await hashProductProductionValueV2(candidates) || row.sourceHash !== await hashProductProductionValueV2(input.source)) fail('作者选择的情境或来源已变化，需要重新确认')
  const selected = candidates.options.find(option => option.optionKey === row.selectedOptionKey)
  if (!selected) fail('作者选定的情境不存在')
  return frozen(selected, input.source)
}

/** Public package navigation only. Hidden setup and future possibilities stay
 * in the interaction module and never become authored future dialogue. */
export function chatNarrativeShellV1(content: FrozenChatNarrativeV1): ProductRuntimePackageV1['narrative'] & {
  schema: 'storyforge.product-narrative-artifact'; version: 1
} {
  const situation = content.initialSituation
  const text = [situation.location, situation.timeLabel].filter(Boolean).join(' · ')
  return {
    schema: 'storyforge.product-narrative-artifact', version: 1,
    moduleKind: 'main', moduleTitle: situation.title, entryNodeKey: situation.sceneKey,
    nodes: [{key: situation.sceneKey, kind: 'entry', title: situation.title, summary: text,
      conditionJson: '{}', effectsJson: '[]', successorKeys: []}],
    beats: [{beatKey: 'chat.setting', nodeKey: situation.sceneKey, kind: 'narration', speakerKey: null, text, order: 0}],
    choices: [],
  }
}

export function isChatNarrativeShellV1(narrative: ProductRuntimePackageV1['narrative'], content: FrozenChatNarrativeV1): boolean {
  const {schema: _schema, version: _version, ...expected} = chatNarrativeShellV1(content)
  return canonicalProductProductionJsonV2(narrative) === canonicalProductProductionJsonV2(expected)
}

export function chatSituationProductionPromptV1(atomicSources = false, groundedAgency = false): string {
  return (groundedAgency ? CHAT_OPENING_AGENCY_CREATION_RULE_V2 + '\n' : '') + (atomicSources ? '本次使用来源 v6：sourceUnits 保留完整原文与限制，仅供幕后一致性检查，不是任何角色的可知内容。knowledge 中 source.unit 标记作者逐项审定的事实正文；每一条都必须在每个候选中作为唯一 reviewed-world 事实完整保留，包括初始无人知晓且没有 discovery 的事实，audienceKeys 必须精确相同。不要把整段原文、相邻事实或限制另写为公开事实；不能从一项证据开放其他单位。\n' : '') + `你是角色聊天的初始情境编辑。只使用输入中经过作者确认的聊天来源。输出严格 JSON，不加 Markdown。
生成 settings.narrative.openingCount 个不同且符合 openingSituation 的初始局面；不是完整故事，不写未来分支、结局或玩家承诺。
保留种子真正要处理的事情。可把眼前的准备或工具检查作为第一步，但不要用它替换原目标；其受阻时仍能选择其他有依据的办法或明确暂停原任务，不能把准备结束当作原任务完成。目标和事项可以保持精简，不要求每个开场都增加主支线。给角色可自行尝试的当前条件，不把所有可能都交还玩家安排。谨慎等人物特征影响方法，不扩成无依据的全面退缩。
每个局面包含：已发生的背景事实、每位角色自身的欲望/顾虑/边界、角色当前所信、未完成事项及可收束信号、若干可能方向。可能方向不是事实或必须发生的剧情。
尊重 settings.narrative.permissions 的模式、强度和事项数量；陪伴模式可以没有冲突，允许休息、拒绝和改道。玩家虚构身份来自 playerRole，不推断现实用户信息，不替玩家设定目标、心理、行动或台词。
使用 participants 中精确的 participantKey。player 是玩家。所有事实与事项必须明确 audienceKeys；未知或秘密不得扩大传播。每个 goal、belief、possibility 只属于该角色，证据必须是该角色可见的事实。
reviewed-world 事实只能逐字引用 source.knowledge 中 purpose 为 identity 或 knowledge 的内容，sourceKnowledgeKey 必须对应，不能扩大其 audienceKeys。motivation 与 voice 是性格/意图，不是假定发生的事实。新增初始背景用 author-private，sourceKnowledgeKey=null，等待作者选择后才生效。
只有 settings.narrative.permissions.maxDiscoveriesPerSituation>0 时，才可为作者确认的 author-private 初始事实附加 discovery:{sceneKey,actorKeys,condition,prerequisiteFactKeys}。这是可发现隐情，不是未来情节；优先将可观察事实与历史原因、人物动机拆开。condition 描述什么实际调查足以得知整条事实，prerequisiteFactKeys 引用允许调查的角色已知前提，不能包含本条隐情或其他未知真相；actorKeys 只能是参与角色，不含 player，sceneKey 是当前场景。条件及隐情只供作者选定与情境协调，不提前写入角色目标、打算、公开标题或 pitch。reviewed-world 仅能使用 source.knowledge 中已经携带 discovery 的逐条作者授权：每一条这样的来源必须在每个候选中保留唯一原文事实，初始 audienceKeys 不得扩大；discovery.condition 和 actorKeys 原样保留，sceneKey 绑定本候选场景，prerequisiteFactKeys 逐项指向 prerequisiteKnowledgeKeys 对应的 reviewed-world 原文事实（这些前提也必须收入候选），不能删除、改写条件或把隐情改成 author-private 来逃避来源。未授权的世界资料不得附加 discovery。未授权时不得输出 discovery。
所有 sourceEventSequence/updatedSequence=0；目标 status=active，事项 status=open。事实最多100条，事项不超过 maxActiveThreads。故事模式至少1个未完成事项，每位角色至少1个自身目标。不要输出 seed、Persona、权限或作者确认字段。
精确结构：{"schema":"storyforge.chat-situation-candidates","version":1,"options":[{"optionKey":"opening-1","title":"开场标题","pitch":"供作者比较的差异和体验方向","situation":{"situationKey":"situation-1","sceneKey":"scene-1","title":"场景标题","location":"地点","timeLabel":"时间","facts":[{"factKey":"fact-1","text":"已经成立的初始背景","audienceKeys":["player","participant.001"],"origin":"author-private","sourceKnowledgeKey":null,"sourceEventSequence":0}],"goals":[{"goalKey":"goal-1","actorKey":"participant.001","desire":"自身期望","concern":"顾虑","boundary":"不会做什么","evidenceFactKeys":["fact-1"],"status":"active","updatedSequence":0}],"beliefs":[{"beliefKey":"belief-1","actorKey":"participant.001","text":"当前看法，可以出错但不能当全知事实","evidenceFactKeys":["fact-1"],"updatedSequence":0}],"threads":[{"threadKey":"thread-1","title":"未完成事项","question":"可以被推进或放下的问题","audienceKeys":["player","participant.001"],"participantKeys":["participant.001"],"evidenceFactKeys":["fact-1"],"closureSignals":["可观察的收束信号"],"status":"open","updatedSequence":0}],"possibilities":[{"actorKey":"participant.001","text":"可能尝试的方向，可被拒绝","evidenceFactKeys":["fact-1"]}]}}]}。实际候选数量必须匹配设置，不能只换标题；地点和时间若有指定必须精确保留。`
}
