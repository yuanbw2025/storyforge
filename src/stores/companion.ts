import { create } from 'zustand'
import { DEFAULT_COMPANION, type CompanionPreferences, type VoiceService } from '../lib/longform-voice/contract'

export const COMPANION_KEY = 'storyforge-longform-companion-v1'
const SESSION_KEY = 'storyforge-longform-voice-keys-v1'

function service(raw: unknown): VoiceService {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const text = (key: string) => typeof value[key] === 'string' ? value[key].slice(0, 2000) : ''
  return { baseUrl: text('baseUrl'), model: text('model'), voice: text('voice'), apiKey: '' }
}
export function sanitizeCompanion(raw: unknown): CompanionPreferences {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const text = (key: string) => typeof value[key] === 'string' ? value[key].slice(0, 2000) : ''
  return {
    ...DEFAULT_COMPANION,
    visible: value.visible !== false,
    portrait: typeof value.portrait === 'string' && value.portrait.length < 2_800_000
      && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.portrait) ? value.portrait : '',
    inputMode: value.inputMode === 'service' ? 'service' : 'browser',
    outputMode: value.outputMode === 'service' ? 'service' : 'browser',
    inputDeviceId: text('inputDeviceId'), outputDeviceId: text('outputDeviceId'),
    browserVoice: text('browserVoice'), autoRead: value.autoRead === true,
    input: service(value.input), output: service(value.output),
  }
}
function loadPreferences(): CompanionPreferences {
  try {
    const preferences = sanitizeCompanion(JSON.parse(localStorage.getItem(COMPANION_KEY) || '{}'))
    const keys = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}')
    preferences.input.apiKey = typeof keys.input === 'string' ? keys.input : ''
    preferences.output.apiKey = typeof keys.output === 'string' ? keys.output : ''
    return preferences
  } catch { return sanitizeCompanion({}) }
}
interface Store {
  preferences: CompanionPreferences
  storageError: string
  update: (patch: Partial<CompanionPreferences>) => void
}
export const useCompanionStore = create<Store>((set, get) => ({
  preferences: loadPreferences(), storageError: '',
  update: (patch) => {
    const merged = { ...get().preferences, ...patch }
    const next = sanitizeCompanion(merged)
    next.input.apiKey = merged.input.apiKey
    next.output.apiKey = merged.output.apiKey
    try {
      localStorage.setItem(COMPANION_KEY, JSON.stringify({
        ...next, input: { ...next.input, apiKey: '' }, output: { ...next.output, apiKey: '' },
      }))
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ input: next.input.apiKey, output: next.output.apiKey }))
      set({ preferences: next, storageError: '' })
    } catch {
      set({ preferences: next, storageError: '浏览器存储空间或权限不足，本次设置仅在当前页面有效。' })
    }
  },
}))
