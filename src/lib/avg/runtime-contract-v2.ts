import { avgBoolean, avgEnum, avgHash, avgKey, avgKeys, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'

export const AVG_CONSUMER_SLOTS_V1 = {
  stage: ['background','actor','cg','bgm','ambience','sfx'],
  dialogue: ['avatar','voice'],
  inventory: ['icon'],
  evidence: ['detail'],
  menu: ['cover','skin'],
  gallery: ['entry'],
  archive: ['illustration'],
  marketing: ['cover','key-art'],
  reference: ['identity','style','voice'],
} as const
export type AvgConsumerDomainV1 = keyof typeof AVG_CONSUMER_SLOTS_V1
export interface AvgConsumerV1 {
  consumerKey: string
  domain: AvgConsumerDomainV1
  slot: string
  subjectKey: string
  sceneKey: string | null
  lineKey: string | null
  required: boolean
  fallback: 'none' | 'text' | 'silence' | 'omit'
}
export interface AvgMediaBindingV1 {
  schema: 'storyforge.avg.media-binding'
  version: 1
  bindingKey: string
  requirement: { key: string; revision: number; contentHash: string }
  family: { subjectKey: string; familyKey: string; variantKey: string; revision: number }
  consumer: AvgConsumerV1
  locale: 'zh-CN'
  visibility: { requiredFactKeys: string[]; stateKey: string | null }
  layout: { anchor: 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right'; scale: number }
  asset: { key: string; blobHash: string; mimeType: string; adoptionRevision: number; processingRevision: number; inputHashes: string[] }
  voice: { textHash: string; performanceHash: string; durationMs: number } | null
}
export interface AvgPresentationContentV2 {
  schema: 'storyforge.avg.presentation'
  version: 2
  aspectRatio: '16:9' | '4:3'
  consumers: AvgConsumerV1[]
  /** Cue semantics are admitted by 02A2, after the real renderer is ready. */
  cues: never[]
}
export interface AvgRuntimeModuleV1 {
  schema: 'storyforge.avg.runtime-module'
  version: 1
  storyMode: 'linear' | 'branching'
  capabilities: Array<{ name: 'narrative'; version: 1; dependsOn: never[] }>
  subjects: Array<{ key: string; kind: 'character' | 'location' | 'item'; displayName: string }>
  lines: Array<{ lineKey: string; sceneKey: string; speakerKey: string | null; text: string; textRevision: number; locale: 'zh-CN' }>
  /** State/action extensions remain closed until the rules package registers them. */
  stateDefinitions: never[]
  actions: never[]
  transitions: never[]
  presentation: AvgPresentationContentV2
  mediaBindings: never[]
  progressPolicy: 'off'
  assistPolicy: 'off'
}
function empty(value: unknown, label: string): never[] {
  if (!Array.isArray(value) || value.length !== 0) throw new Error(`[avg] ${label} 含未就绪能力`)
  return []
}
function nullableKey(value: unknown, label: string): string | null {
  return value === null ? null : avgKey(value, label)
}
export function parseAvgConsumerV1(value: unknown, label = 'consumer'): AvgConsumerV1 {
  const row = avgRecord(value, ['consumerKey','domain','slot','subjectKey','sceneKey','lineKey','required','fallback'], label)
  const domain = avgEnum(row.domain, Object.keys(AVG_CONSUMER_SLOTS_V1) as AvgConsumerDomainV1[], 'domain')
  const slot = avgEnum(row.slot, AVG_CONSUMER_SLOTS_V1[domain], 'slot')
  const required = avgBoolean(row.required, 'required')
  const fallback = avgEnum(row.fallback, ['none','text','silence','omit'] as const, 'fallback')
  const sceneKey = nullableKey(row.sceneKey, 'sceneKey')
  const lineKey = nullableKey(row.lineKey, 'lineKey')
  if (required && fallback !== 'none') throw new Error('[avg] 必需 consumer 不得隐式降级')
  if (domain === 'dialogue' && (!lineKey || !sceneKey)) throw new Error('[avg] dialogue consumer 缺少 scene/line')
  if (domain !== 'dialogue' && lineKey !== null) throw new Error('[avg] 非 dialogue consumer 不得绑定 line')
  if (domain === 'stage' && !sceneKey) throw new Error('[avg] stage consumer 缺少 scene')
  if (['marketing','reference'].includes(domain) && required) throw new Error('[avg] 研究/宣传 consumer 不属于 runtime 必需闭包')
  const audio = ['bgm','ambience','sfx','voice'].includes(slot)
  if ((fallback === 'silence' && !audio) || (fallback === 'text' && audio)) throw new Error('[avg] consumer fallback 与用途不符')
  return { consumerKey: avgKey(row.consumerKey, 'consumerKey'), domain, slot, subjectKey: avgKey(row.subjectKey, 'subjectKey'),
    sceneKey, lineKey, required, fallback }
}
export function parseAvgMediaBindingV1(value: unknown): AvgMediaBindingV1 {
  const row = avgRecord(avgProtocolBody(value), ['schema','version','bindingKey','requirement','family','consumer','locale','visibility','layout','asset','voice'], 'media binding')
  if (row.schema !== 'storyforge.avg.media-binding' || row.version !== 1) throw new Error('[avg] binding schema/version 无效')
  const requirement = avgRecord(row.requirement, ['key','revision','contentHash'], 'requirement')
  const family = avgRecord(row.family, ['subjectKey','familyKey','variantKey','revision'], 'family')
  const visibility = avgRecord(row.visibility, ['requiredFactKeys','stateKey'], 'visibility')
  const layout = avgRecord(row.layout, ['anchor','scale'], 'layout')
  const asset = avgRecord(row.asset, ['key','blobHash','mimeType','adoptionRevision','processingRevision','inputHashes'], 'asset')
  const consumer = parseAvgConsumerV1(row.consumer)
  const subjectKey = avgKey(family.subjectKey, 'subjectKey')
  if (consumer.subjectKey !== subjectKey) throw new Error('[avg] binding 主体与 consumer 不一致')
  const mimeType = avgText(asset.mimeType, 'mimeType', 100)
  const audio = ['bgm','ambience','sfx','voice'].includes(consumer.slot)
  if (!(audio ? ['audio/mpeg','audio/wav','audio/ogg','audio/mp4'] : ['image/png','image/jpeg','image/webp']).includes(mimeType)) throw new Error('[avg] binding MIME 与 consumer 用途不符')
  const rawVoice = row.voice === null ? null : avgRecord(row.voice, ['textHash','performanceHash','durationMs'], 'voice')
  if ((consumer.domain === 'dialogue' && consumer.slot === 'voice') !== (rawVoice !== null)) throw new Error('[avg] voice binding 必须有准确文本/演法/实际时长')
  return { schema: 'storyforge.avg.media-binding', version: 1, bindingKey: avgKey(row.bindingKey, 'bindingKey'),
    requirement: { key: avgKey(requirement.key, 'requirementKey'), revision: avgNumber(requirement.revision, 'requirementRevision', 1, 1_000_000), contentHash: avgHash(requirement.contentHash, 'requirementHash') },
    family: { subjectKey, familyKey: avgKey(family.familyKey, 'familyKey'), variantKey: avgKey(family.variantKey, 'variantKey'), revision: avgNumber(family.revision, 'familyRevision', 1, 1_000_000) },
    consumer, locale: avgEnum(row.locale, ['zh-CN'] as const, 'locale'),
    visibility: { requiredFactKeys: avgKeys(visibility.requiredFactKeys, 'requiredFactKeys'), stateKey: nullableKey(visibility.stateKey, 'stateKey') },
    layout: { anchor: avgEnum(layout.anchor, ['center','bottom-left','bottom-center','bottom-right'] as const, 'anchor'), scale: avgNumber(layout.scale, 'scale', 0.01, 4, false) },
    asset: { key: avgKey(asset.key, 'assetKey'), blobHash: avgHash(asset.blobHash, 'blobHash'), mimeType,
      adoptionRevision: avgNumber(asset.adoptionRevision, 'adoptionRevision', 1, 1_000_000), processingRevision: avgNumber(asset.processingRevision, 'processingRevision', 0, 1_000_000),
      inputHashes: avgUnique(avgList(asset.inputHashes, 'inputHashes', avgHash, 100), value => value, 'inputHashes') },
    voice: rawVoice ? { textHash: avgHash(rawVoice.textHash, 'textHash'), performanceHash: avgHash(rawVoice.performanceHash, 'performanceHash'), durationMs: avgNumber(rawVoice.durationMs, 'durationMs', 1, 600_000) } : null }
}
export function parseAvgPresentationContentV2(value: unknown): AvgPresentationContentV2 {
  const row = avgRecord(value, ['schema','version','aspectRatio','consumers','cues'], 'presentation V2')
  if (row.schema !== 'storyforge.avg.presentation' || row.version !== 2) throw new Error('[avg] presentation schema/version 无效')
  const consumers = avgUnique(avgList(row.consumers, 'consumers', parseAvgConsumerV1, 10_000), value => value.consumerKey, 'consumers')
  avgUnique(consumers, value => [value.domain,value.slot,value.subjectKey,value.sceneKey,value.lineKey].join('\u0000'), 'consumer targets')
  if (consumers.some(value => ['marketing','reference'].includes(value.domain))) throw new Error('[avg] 研究/宣传 consumer 禁止进入 runtime presentation')
  return { schema: 'storyforge.avg.presentation', version: 2, aspectRatio: avgEnum(row.aspectRatio, ['16:9','4:3'] as const, 'aspectRatio'), consumers, cues: empty(row.cues, 'cues') }
}
export function parseAvgRuntimeModuleV1(value: unknown): AvgRuntimeModuleV1 {
  const raw = avgProtocolBody(value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)
    || (raw as Record<string, unknown>).schema !== 'storyforge.avg.runtime-module'
    || (raw as Record<string, unknown>).version !== 1) throw new Error('[avg] 未登记模块 schema/version')
  const row = avgRecord(raw, ['schema','version','storyMode','capabilities','subjects','lines','stateDefinitions','actions','transitions','presentation','mediaBindings','progressPolicy','assistPolicy'], 'runtime module')
  if (row.schema !== 'storyforge.avg.runtime-module' || row.version !== 1) throw new Error('[avg] 未登记模块 schema/version')
  const capabilities = avgList(row.capabilities, 'capabilities', value => {
    const cap = avgRecord(value, ['name','version','dependsOn'], 'capability')
    if (cap.name !== 'narrative' || cap.version !== 1) throw new Error('[avg] capability 尚未就绪')
    return { name: 'narrative' as const, version: 1 as const, dependsOn: empty(cap.dependsOn, 'dependsOn') }
  }, 1)
  if (capabilities.length !== 1) throw new Error('[avg] 缺少 narrative capability')
  const subjects = avgUnique(avgList(row.subjects, 'subjects', value => {
    const subject = avgRecord(value, ['key','kind','displayName'], 'subject')
    return { key: avgKey(subject.key, 'subjectKey'), kind: avgEnum(subject.kind, ['character','location','item'] as const, 'subject.kind'), displayName: avgText(subject.displayName, 'displayName', 200) }
  }), value => value.key, 'subjects')
  const lines = avgUnique(avgList(row.lines, 'lines', value => {
    const line = avgRecord(value, ['lineKey','sceneKey','speakerKey','text','textRevision','locale'], 'line')
    return { lineKey: avgKey(line.lineKey, 'lineKey'), sceneKey: avgKey(line.sceneKey, 'sceneKey'), speakerKey: nullableKey(line.speakerKey, 'speakerKey'),
      text: avgText(line.text, 'text', 10000), textRevision: avgNumber(line.textRevision, 'textRevision', 1, 1_000_000), locale: avgEnum(line.locale, ['zh-CN'] as const, 'locale') }
  }, 50_000), value => value.lineKey, 'lines')
  const subjectsByKey = new Map(subjects.map(subject => [subject.key, subject]))
  const linesByKey = new Map(lines.map(line => [line.lineKey, line]))
  const sceneKeys = new Set(lines.map(line => line.sceneKey))
  for (const line of lines) if (line.speakerKey && subjectsByKey.get(line.speakerKey)?.kind !== 'character') throw new Error('[avg] line speaker 不在 character 目录')
  const presentation = parseAvgPresentationContentV2(row.presentation)
  for (const consumer of presentation.consumers) {
    const subject = subjectsByKey.get(consumer.subjectKey)
    if (!subject) throw new Error('[avg] consumer 主体不存在')
    const expectedKind = ['inventory','evidence'].includes(consumer.domain) ? 'item'
      : consumer.domain === 'dialogue' || consumer.slot === 'actor' ? 'character'
      : consumer.slot === 'background' ? 'location' : null
    if (expectedKind && subject.kind !== expectedKind) throw new Error('[avg] consumer 主体类型与用途不符')
    if (consumer.sceneKey && !sceneKeys.has(consumer.sceneKey)) throw new Error('[avg] consumer 场景不存在')
    const line = consumer.lineKey ? linesByKey.get(consumer.lineKey) : null
    if (consumer.lineKey && (!line || line.sceneKey !== consumer.sceneKey
      || line.speakerKey !== consumer.subjectKey)) throw new Error('[avg] dialogue consumer 与 line/speaker 不一致')
  }
  return { schema: 'storyforge.avg.runtime-module', version: 1, storyMode: avgEnum(row.storyMode, ['linear','branching'] as const, 'storyMode'), capabilities, subjects, lines,
    stateDefinitions: empty(row.stateDefinitions, 'stateDefinitions'), actions: empty(row.actions, 'actions'), transitions: empty(row.transitions, 'transitions'),
    presentation, mediaBindings: empty(row.mediaBindings, 'mediaBindings'), progressPolicy: avgEnum(row.progressPolicy, ['off'] as const, 'progressPolicy'), assistPolicy: avgEnum(row.assistPolicy, ['off'] as const, 'assistPolicy') }
}
