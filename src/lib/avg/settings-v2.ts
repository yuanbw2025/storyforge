import { DEFAULT_AVG_SETTINGS, parseAvgAuthoringSettingsV1, type AvgAuthoringSettingsV1 } from './authoring-contract'
import { avgBoolean, avgEnum, avgHash, avgKeys, avgList, avgNumber, avgProtocolBody, avgRecord, avgText, avgUnique } from './protocol-validation'
import { AVG_MODULE_NAMES_V1, type AvgModuleNameV1 } from './module-capabilities'

/** An author's desired scope, never a claim that a compiler, renderer or provider is ready. */
export interface AvgAuthoringSettingsV2 {
  version: 2
  intent: Omit<AvgAuthoringSettingsV1, 'version'>
  storyMode: 'linear' | 'branching'
  modules: Array<{ name: AvgModuleNameV1; version: 1 }>
  viewpoint: { perspective: 'first-person' | 'third-person-limited' | 'external'; anchorSubjectKey: string | null; allowSwitch: boolean }
  cameraGrammar: 'fixed-stage' | 'cinematic-static'
  presentation: { visualMode: 'text' | 'static'; voice: 'off' | 'key-lines' | 'full'; referencePolicy: 'original-only' | 'authorized-reference' }
  delivery: { textLocale: 'zh-CN'; voiceLocale: 'zh-CN'; devices: Array<'desktop' | 'touch'>; offline: boolean }
  qualityTarget: {
    references: Array<{ title: string; platform: string; releaseVersion: string; locale: string; sceneLocator: string; sourceUrl: string; observation: 'text' | 'visual' | 'audio' | 'interaction' }>
    criteria: string[]
    unobserved: string[]
  }
  investment: {
    totalCostUsd: number | null
    manualHours: { writing: number | null; art: number | null; listening: number | null }
    batch: { modelCalls: number; mediaCalls: number; inputTokens: number; outputTokens: number; durationMs: number; maxAttempts: number }
  }
  /** A derivation pins the original bytes without changing the original settings or save. */
  derivedFrom: { version: 1; settingsHash: string } | null
}
const MODULES = AVG_MODULE_NAMES_V1
function optionalLimit(value: unknown, label: string): number | null {
  return value === null ? null : avgNumber(value, label, 0, 1_000_000, false)
}
export function parseAvgAuthoringSettingsV2(value: unknown): AvgAuthoringSettingsV2 {
  const row = avgRecord(avgProtocolBody(value), ['version','intent','storyMode','modules','viewpoint','cameraGrammar','presentation','delivery','qualityTarget','investment','derivedFrom'], 'settings V2')
  if (row.version !== 2) throw new Error('[avg] settings V2 版本不支持')
  const intent = parseAvgAuthoringSettingsV1({ ...avgRecord(row.intent, Object.keys(DEFAULT_AVG_SETTINGS).filter(key => key !== 'version'), 'intent'), version: 1 })
  const { version: _version, ...parsedIntent } = intent
  const modules = avgUnique(avgList(row.modules, 'modules', (value, label) => {
    const module = avgRecord(value, ['name','version'], label)
    if (module.version !== 1) throw new Error('[avg] module 版本不支持')
    return { name: avgEnum(module.name, MODULES, label), version: 1 as const }
  }, MODULES.length), value => value.name, 'modules')
  if (!modules.some(value => value.name === 'narrative')) throw new Error('[avg] 缺少 narrative 模块')
  if (modules.some(value => value.name === 'evidence') && !modules.some(value => value.name === 'inventory')) throw new Error('[avg] evidence 依赖 inventory')
  const viewpoint = avgRecord(row.viewpoint, ['perspective','anchorSubjectKey','allowSwitch'], 'viewpoint')
  const presentation = avgRecord(row.presentation, ['visualMode','voice','referencePolicy'], 'presentation')
  const delivery = avgRecord(row.delivery, ['textLocale','voiceLocale','devices','offline'], 'delivery')
  const quality = avgRecord(row.qualityTarget, ['references','criteria','unobserved'], 'qualityTarget')
  const investment = avgRecord(row.investment, ['totalCostUsd','manualHours','batch'], 'investment')
  const hours = avgRecord(investment.manualHours, ['writing','art','listening'], 'manualHours')
  const batch = avgRecord(investment.batch, ['modelCalls','mediaCalls','inputTokens','outputTokens','durationMs','maxAttempts'], 'batch')
  const derived = row.derivedFrom === null ? null : avgRecord(row.derivedFrom, ['version','settingsHash'], 'derivedFrom')
  if (derived && derived.version !== 1) throw new Error('[avg] derivedFrom 版本不支持')
  if (viewpoint.perspective !== 'external' && viewpoint.anchorSubjectKey === null) throw new Error('[avg] 限定视角缺少主体锚点')
  if (!Array.isArray(delivery.devices) || !delivery.devices.length) throw new Error('[avg] 缺少目标设备')
  const references = avgList(quality.references, 'references', (value, label) => {
    const reference = avgRecord(value, ['title','platform','releaseVersion','locale','sceneLocator','sourceUrl','observation'], label)
    const sourceUrl = avgText(reference.sourceUrl, 'sourceUrl', 2000)
    if (!/^https?:\/\//.test(sourceUrl)) throw new Error('[avg] reference URL 无效')
    return { title: avgText(reference.title, 'title', 200), platform: avgText(reference.platform, 'platform', 200),
      releaseVersion: avgText(reference.releaseVersion, 'releaseVersion', 200), locale: avgText(reference.locale, 'locale', 100),
      sceneLocator: avgText(reference.sceneLocator, 'sceneLocator', 1000), sourceUrl,
      observation: avgEnum(reference.observation, ['text','visual','audio','interaction'] as const, 'observation') }
  }, 100)
  return {
    version: 2, intent: parsedIntent, storyMode: avgEnum(row.storyMode, ['linear','branching'] as const, 'storyMode'), modules,
    viewpoint: { perspective: avgEnum(viewpoint.perspective, ['first-person','third-person-limited','external'] as const, 'perspective'),
      anchorSubjectKey: viewpoint.anchorSubjectKey === null ? null : avgKeys([viewpoint.anchorSubjectKey], 'anchor')[0],
      allowSwitch: avgBoolean(viewpoint.allowSwitch, 'allowSwitch') },
    cameraGrammar: avgEnum(row.cameraGrammar, ['fixed-stage','cinematic-static'] as const, 'cameraGrammar'),
    presentation: { visualMode: avgEnum(presentation.visualMode, ['text','static'] as const, 'visualMode'),
      voice: avgEnum(presentation.voice, ['off','key-lines','full'] as const, 'voice'),
      referencePolicy: avgEnum(presentation.referencePolicy, ['original-only','authorized-reference'] as const, 'referencePolicy') },
    delivery: { textLocale: avgEnum(delivery.textLocale, ['zh-CN'] as const, 'textLocale'), voiceLocale: avgEnum(delivery.voiceLocale, ['zh-CN'] as const, 'voiceLocale'),
      devices: avgUnique(avgList(delivery.devices, 'devices', value => avgEnum(value, ['desktop','touch'] as const, 'device'), 2), value => value, 'devices'),
      offline: avgBoolean(delivery.offline, 'offline') },
    qualityTarget: { references, criteria: avgList(quality.criteria, 'criteria', avgText, 100), unobserved: avgList(quality.unobserved, 'unobserved', avgText, 100) },
    investment: { totalCostUsd: optionalLimit(investment.totalCostUsd, 'totalCostUsd'),
      manualHours: { writing: optionalLimit(hours.writing, 'writing'), art: optionalLimit(hours.art, 'art'), listening: optionalLimit(hours.listening, 'listening') },
      batch: { modelCalls: avgNumber(batch.modelCalls, 'modelCalls', 0, 1000), mediaCalls: avgNumber(batch.mediaCalls, 'mediaCalls', 0, 1000),
        inputTokens: avgNumber(batch.inputTokens, 'inputTokens', 0, 10_000_000), outputTokens: avgNumber(batch.outputTokens, 'outputTokens', 0, 1_000_000),
        durationMs: avgNumber(batch.durationMs, 'durationMs', 1, 86_400_000), maxAttempts: avgNumber(batch.maxAttempts, 'maxAttempts', 1, 3) } },
    derivedFrom: derived ? { version: 1, settingsHash: avgHash(derived.settingsHash, 'settingsHash') } : null,
  }
}

/** Explicit, inert proposal. The caller must confirm it; it does not save, start or migrate. */
export async function deriveAvgAuthoringSettingsV2(value: AvgAuthoringSettingsV1): Promise<AvgAuthoringSettingsV2> {
  const legacy = parseAvgAuthoringSettingsV1(value)
  const { hashProductProductionValueV2 } = await import('../product-production/hash')
  const { version: _version, ...intent } = legacy
  return parseAvgAuthoringSettingsV2({
    version: 2, intent, storyMode: legacy.targetEndingCount === 1 ? 'linear' : 'branching', modules: [{ name: 'narrative', version: 1 }],
    viewpoint: { perspective: 'external', anchorSubjectKey: null, allowSwitch: false }, cameraGrammar: 'fixed-stage',
    presentation: { visualMode: legacy.visualLevel === 'none' ? 'text' : 'static', voice: 'off', referencePolicy: 'original-only' },
    delivery: { textLocale: 'zh-CN', voiceLocale: 'zh-CN', devices: ['desktop'], offline: false },
    qualityTarget: { references: [], criteria: [], unobserved: ['continuous-reference','professional-review','real-generation'] },
    investment: { totalCostUsd: null, manualHours: { writing: null, art: null, listening: null },
      batch: { modelCalls: 0, mediaCalls: 0, inputTokens: 0, outputTokens: 0, durationMs: 60_000, maxAttempts: 1 } },
    derivedFrom: { version: 1, settingsHash: await hashProductProductionValueV2(legacy) },
  })
}

/** Null totals mean no author-imposed ceiling, not zero price or an authorized run. */
export function assertAvgV2ProductionReady(): never {
  throw new Error('[avg] V2 专业生产尚未就绪；设置不得降级进入 V1 生产')
}

export function parseAvgAuthoringSettings(value: unknown): AvgAuthoringSettingsV1 | AvgAuthoringSettingsV2 {
  const raw = avgProtocolBody(value)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('[avg] settings 必须为对象')
  const version = (raw as Record<string, unknown>).version
  if (version === 1) return parseAvgAuthoringSettingsV1(raw)
  if (version === 2) return parseAvgAuthoringSettingsV2(raw)
  throw new Error('[avg] settings schema/version 无效')
}

/** The existing Brief/compiler is V1-only until the registered V2 production path arrives. */
export function parseAvgSettingsForLegacyProduction(value: unknown): AvgAuthoringSettingsV1 {
  const parsed = parseAvgAuthoringSettings(value)
  if (parsed.version === 2) assertAvgV2ProductionReady()
  return parsed
}
