import { avgBoolean, avgEnum, avgHash, avgKey, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { parseAvgConsumerV1, type AvgConsumerV1 } from './runtime-contract-v2'
import { parseAvgSoundChannelV1, type AvgSoundChannelV1 } from './sound-plan-contract'
import { parseAvgSoundPublisherLibrarySourceV2, type AvgSoundPublisherLibrarySourceV2 } from './sound-publisher-library'

/** Unverified locators in a frozen declaration. The real local producer must
 * prove the original archive/member bytes and included licence separately. */
export interface AvgSoundLibrarySourceV1 {
  sourceKey: string; publisherPage: string; license: 'CC0-1.0'
  archiveHash: string; memberPath: string; memberHash: string
}
export type AvgSoundLibrarySource = AvgSoundLibrarySourceV1 | AvgSoundPublisherLibrarySourceV2
export interface AvgSoundTemplateV1 {
  requirementKey: string; assetKey: string; channel: AvgSoundChannelV1
  consumer: AvgConsumerV1; purpose: string; constraints: string[]
  cue: { cueKey: string; beatKey: string; phase: 'before' | 'during' | 'after'; order: number; volume: number; loop: boolean }
  source: { kind: 'generate-music'; durationSeconds: number; seed: number; bpm: number; keyscale: string }
    | { kind: 'licensed-library'; allowedSourceKeys: string[] }
}
export interface AvgSoundPlanningScopeV1 {
  schema: 'storyforge.avg.sound-planning-scope'; version: 1; sourceInputHash: string
  templates: AvgSoundTemplateV1[]; librarySources: AvgSoundLibrarySource[]
}

function parseLibraryV1(value: unknown): AvgSoundLibrarySourceV1 {
  const r = avgRecord(value, ['sourceKey', 'publisherPage', 'license', 'archiveHash', 'memberPath', 'memberHash'], 'sound library source')
  const page = avgText(r.publisherPage, 'audio publisher page', 1000), url = new URL(page)
  if (url.protocol !== 'https:' || url.hostname !== 'kenney.nl' || url.username || url.password || url.port || url.search || url.hash
    || !/^\/assets\/[a-z0-9-]+$/.test(url.pathname)) throw new Error('[avg-sound] 当前音效库只接受准确原发布者资源页')
  const memberPath = avgText(r.memberPath, 'audio archive member', 512)
  if (memberPath.startsWith('/') || memberPath.split('/').some(p => !p || p === '.' || p === '..')
    || !/^[A-Za-z0-9 _./()-]+\.(wav|ogg)$/i.test(memberPath)) throw new Error('[avg-sound] 音效来源必须是准确安全的音频成员路径')
  return { sourceKey: avgKey(r.sourceKey, 'sound library key'), publisherPage: page,
    license: avgEnum(r.license, ['CC0-1.0'] as const, 'audio library licence'),
    archiveHash: avgHash(r.archiveHash, 'audio archive hash'), memberPath, memberHash: avgHash(r.memberHash, 'audio member hash') }
}

function parseLibrary(value: unknown): AvgSoundLibrarySource {
  return (value as { version?: unknown } | null)?.version === 2
    ? parseAvgSoundPublisherLibrarySourceV2(value) : parseLibraryV1(value)
}

function parseTemplate(value: unknown): AvgSoundTemplateV1 {
  const r = avgRecord(value, ['requirementKey', 'assetKey', 'channel', 'consumer', 'purpose', 'constraints', 'cue', 'source'], 'sound template')
  const channel = parseAvgSoundChannelV1(r.channel), consumer = parseAvgConsumerV1(r.consumer)
  const c = avgRecord(r.cue, ['cueKey', 'beatKey', 'phase', 'order', 'volume', 'loop'], 'sound target Cue')
  const cue = { cueKey: avgKey(c.cueKey, 'sound Cue key'), beatKey: avgKey(c.beatKey, 'sound beat key'),
    phase: avgEnum(c.phase, ['before', 'during', 'after'] as const, 'sound Cue phase'), order: avgNumber(c.order, 'sound Cue order', 0, 1e6),
    volume: avgNumber(c.volume, 'sound volume', 0, 1, false), loop: avgBoolean(c.loop, 'sound loop intent') }
  if (consumer.domain !== 'stage' || consumer.slot !== channel || consumer.sceneKey === null || consumer.lineKey !== null
    || cue.loop && channel === 'sfx') throw new Error('[avg-sound] 声音必须绑定准确场景/通道；一次性音效不能循环')
  const sourceRow = avgRecord(r.source, (r.source as { kind?: unknown } | null)?.kind === 'generate-music'
    ? ['kind', 'durationSeconds', 'seed', 'bpm', 'keyscale'] : ['kind', 'allowedSourceKeys'], 'sound source policy')
  let source: AvgSoundTemplateV1['source']
  if (sourceRow.kind === 'generate-music') {
    const keyscale = avgText(sourceRow.keyscale, 'music key', 16)
    if (channel !== 'bgm' || !/^[A-G](?:#|b)? (?:Major|Minor)$/.test(keyscale)) throw new Error('[avg-sound] 音乐生成仅用于已校准的BGM与准确调性')
    source = { kind: 'generate-music', durationSeconds: avgNumber(sourceRow.durationSeconds, 'music seconds', 10, 30),
      seed: avgNumber(sourceRow.seed, 'music seed', 0, 2147483647), bpm: avgNumber(sourceRow.bpm, 'music BPM', 30, 300), keyscale }
  } else {
    if (sourceRow.kind !== 'licensed-library' || channel === 'bgm') throw new Error('[avg-sound] 当前音效库用于环境/一次性音效，不冒充音乐生成')
    const allowedSourceKeys = avgUnique(avgList(sourceRow.allowedSourceKeys, 'allowed sound sources', avgKey, 8), v => v, 'allowed sound sources')
    if (!allowedSourceKeys.length) throw new Error('[avg-sound] 音效库需求缺少明确来源范围')
    source = { kind: 'licensed-library', allowedSourceKeys }
  }
  const requirementKey = avgKey(r.requirementKey, 'sound requirement')
  for (const prefix of ['avg.sound.generate.', 'avg.sound.raw.', 'avg.review.audio.', 'avg.sound.choice.', 'avg.author.sound-review.']) {
    avgKey(prefix + requirementKey, 'derived sound task/artifact')
  }
  return { requirementKey, assetKey: avgKey(r.assetKey, 'sound asset'), channel, consumer, cue, source,
    purpose: avgText(r.purpose, 'sound purpose', 2000), constraints: avgList(r.constraints, 'sound constraints', (v, label) => avgText(v, label, 1000), 16) }
}

export function parseAvgSoundPlanningScopeV1(value: unknown): AvgSoundPlanningScopeV1 {
  const r = avgRecord(avgProtocolBody(value), ['schema', 'version', 'sourceInputHash', 'templates', 'librarySources'], 'sound planning scope')
  if (r.schema !== 'storyforge.avg.sound-planning-scope' || r.version !== 1) throw new Error('[avg-sound] 声音范围版本无效')
  const templates = avgUnique(avgList(r.templates, 'sound templates', parseTemplate, 8), t => t.requirementKey, 'sound templates')
  if (!templates.length) throw new Error('[avg-sound] 声音范围不能为空')
  avgUnique(templates, t => t.assetKey, 'sound asset'); avgUnique(templates, t => t.consumer.consumerKey, 'sound consumer')
  avgUnique(templates, t => t.cue.cueKey, 'sound Cue')
  avgUnique(templates, t => JSON.stringify([t.cue.beatKey, t.cue.phase, t.channel]), '同拍同阶段声音通道')
  const librarySources = avgUnique(avgList(r.librarySources, 'audio library sources', parseLibrary, 32), s => s.sourceKey, 'audio library sources')
  const used = new Set(templates.flatMap(t => t.source.kind === 'licensed-library' ? t.source.allowedSourceKeys : []))
  if (used.size !== librarySources.length || librarySources.some(s => !used.has(s.sourceKey))
    || [...used].some(key => !librarySources.some(s => s.sourceKey === key))) throw new Error('[avg-sound] 声音来源目录须准确覆盖授权闭集')
  return { schema: r.schema, version: 1, sourceInputHash: avgHash(r.sourceInputHash, 'sound source input hash'), templates, librarySources }
}
