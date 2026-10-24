/** Device preferences, not Work content or a portable voice license. No text,
 * microphone data, service endpoints or credentials belong in this record. */
export const CHAT_VOICE_PREFERENCES_KEY = 'storyforge-chat-voice-preferences-v1'
const MAX_ROLE_VOICES = 256
export interface ChatVoicePreferencesV1 {
  version: 1
  volume: number
  voices: Array<{sourceHash: string; participantKey: string; voiceURI: string}>
}
const defaults = (): ChatVoicePreferencesV1 => ({version: 1, volume: 1, voices: []})
const storageError = '浏览器无法保存语音设置，本次修改仅在当前页面有效。'
function validBinding(value: unknown): value is ChatVoicePreferencesV1['voices'][number] {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Object.keys(v).sort().join(',') === 'participantKey,sourceHash,voiceURI'
    && typeof v.sourceHash === 'string' && /^[a-f0-9]{64}$/.test(v.sourceHash)
    && typeof v.participantKey === 'string' && !!v.participantKey.trim() && v.participantKey.length <= 2000
    && typeof v.voiceURI === 'string' && !!v.voiceURI && v.voiceURI.length <= 2000
}
function parse(raw: string | null): ChatVoicePreferencesV1 {
  if (!raw) return defaults()
  if (raw.length > 1_100_000) throw new Error('语音设置过大')
  const value = JSON.parse(raw) as ChatVoicePreferencesV1
  if (!value || Object.keys(value).sort().join(',') !== 'version,voices,volume' || value.version !== 1
    || !Number.isFinite(value.volume) || value.volume < 0 || value.volume > 1
    || !Array.isArray(value.voices) || value.voices.length > MAX_ROLE_VOICES || !value.voices.every(validBinding)
    || new Set(value.voices.map(v => JSON.stringify([v.sourceHash, v.participantKey]))).size !== value.voices.length) throw new Error('语音设置无效')
  return value
}
export function readChatVoicePreferencesV1(): {preferences: ChatVoicePreferencesV1; error: string} {
  try {return {preferences: parse(localStorage.getItem(CHAT_VOICE_PREFERENCES_KEY)), error: ''}}
  catch {return {preferences: defaults(), error: '无法读取此设备的语音设置，暂用默认设置；文字聊天可继续。'}}
}
export function chatRoleVoiceV1(preferences: ChatVoicePreferencesV1, sourceHash: string, participantKey: string): string {
  return preferences.voices.find(v => v.sourceHash === sourceHash && v.participantKey === participantKey)?.voiceURI ?? ''
}
/** Read the latest device record before applying one explicit user change.
 * On denied/quota storage keep the new preference in the caller's page only. */
export function saveChatVoicePreferenceV1(current: {preferences: ChatVoicePreferencesV1; error: string}, change: {volume: number} | {sourceHash: string; participantKey: string; voiceURI: string}) {
  if ('volume' in change) {
    if (!Number.isFinite(change.volume) || change.volume < 0 || change.volume > 1) throw new Error('音量必须在 0 到 1 之间。')
  } else if (!validBinding({...change, voiceURI: change.voiceURI || 'default'})) throw new Error('角色音色绑定无效')
  const latest = readChatVoicePreferencesV1(), base = current.error || latest.error ? current.preferences : latest.preferences
  const preferences: ChatVoicePreferencesV1 = 'volume' in change ? {...base, volume: change.volume} : {
    ...base,
    voices: [...base.voices.filter(v => v.sourceHash !== change.sourceHash || v.participantKey !== change.participantKey),
      ...(change.voiceURI ? [change] : [])].slice(-MAX_ROLE_VOICES),
  }
  try {localStorage.setItem(CHAT_VOICE_PREFERENCES_KEY, JSON.stringify(preferences)); return {preferences, error: ''}}
  catch {return {preferences, error: storageError}}
}
