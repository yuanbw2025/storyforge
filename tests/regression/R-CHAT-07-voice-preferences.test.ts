import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {CHAT_VOICE_PREFERENCES_KEY, chatRoleVoiceV1, readChatVoicePreferencesV1, saveChatVoicePreferenceV1} from '../../src/lib/character-interaction/voice-preferences'

const first = '1'.repeat(64), second = '2'.repeat(64)
beforeEach(() => localStorage.clear())
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllGlobals()})

it('persists device choices across reopening, isolates release identity, and never saves speech or credentials', () => {
  let page = readChatVoicePreferencesV1()
  page = saveChatVoicePreferenceV1(page, {sourceHash: first, participantKey: 'guard', voiceURI: 'device.zh'})
  page = saveChatVoicePreferenceV1(page, {volume: .35})
  const reopened = readChatVoicePreferencesV1()
  expect(reopened).toEqual(page)
  expect(chatRoleVoiceV1(reopened.preferences, first, 'guard')).toBe('device.zh')
  expect(chatRoleVoiceV1(reopened.preferences, second, 'guard')).toBe('')
  expect(chatRoleVoiceV1(reopened.preferences, first, 'artisan')).toBe('')
  expect(JSON.parse(localStorage.getItem(CHAT_VOICE_PREFERENCES_KEY)!)).toEqual({version: 1, volume: .35,
    voices: [{sourceHash: first, participantKey: 'guard', voiceURI: 'device.zh'}]})
  saveChatVoicePreferenceV1(reopened, {sourceHash: first, participantKey: 'guard', voiceURI: ''})
  expect(readChatVoicePreferencesV1().preferences.voices).toEqual([])
})

it('merges one explicit change with newer device settings from another page', () => {
  const old = readChatVoicePreferencesV1()
  saveChatVoicePreferenceV1(old, {sourceHash: first, participantKey: 'guard', voiceURI: 'first.voice'})
  const current = saveChatVoicePreferenceV1(old, {sourceHash: second, participantKey: 'guard', voiceURI: 'second.voice'})
  expect(current.preferences.voices).toHaveLength(2)
  const final = saveChatVoicePreferenceV1(old, {volume: .2})
  expect(final.preferences.voices).toEqual(current.preferences.voices)
})

it('keeps consecutive changes in page memory when quota writes fail and reports the failure', () => {
  const original = localStorage, setter = vi.fn(() => {throw new DOMException('full', 'QuotaExceededError')})
  vi.stubGlobal('localStorage', {getItem: original.getItem.bind(original), setItem: setter})
  let page = saveChatVoicePreferenceV1(readChatVoicePreferencesV1(), {sourceHash: first, participantKey: 'guard', voiceURI: 'device.zh'})
  page = saveChatVoicePreferenceV1(page, {volume: .2})
  expect(page.error).toContain('当前页面')
  expect(chatRoleVoiceV1(page.preferences, first, 'guard')).toBe('device.zh')
  expect(page.preferences.volume).toBe(.2)
  expect(readChatVoicePreferencesV1().preferences.voices).toEqual([])
  expect(setter).toHaveBeenCalledTimes(2)
  vi.unstubAllGlobals()
  page = saveChatVoicePreferenceV1(page, {volume: .4})
  expect(page.error).toBe(''); expect(readChatVoicePreferencesV1()).toEqual(page)
})

it('does not silently overwrite corrupt or denied storage during read, and rejects invalid updates', () => {
  localStorage.setItem(CHAT_VOICE_PREFERENCES_KEY, '{broken')
  expect(readChatVoicePreferencesV1().error).toContain('无法读取')
  expect(localStorage.getItem(CHAT_VOICE_PREFERENCES_KEY)).toBe('{broken')
  for (const raw of [{version: 1, volume: 2, voices: []}, {version: 1, volume: 1, voices: [], apiKey: 'forbidden'},
    {version: 1, volume: 1, voices: [{sourceHash: 'unfrozen', participantKey: 'guard', voiceURI: 'device'}]}]) {
    localStorage.setItem(CHAT_VOICE_PREFERENCES_KEY, JSON.stringify(raw))
    expect(readChatVoicePreferencesV1().error).toBeTruthy()
  }
  const page = readChatVoicePreferencesV1()
  expect(() => saveChatVoicePreferenceV1(page, {volume: NaN})).toThrow('音量')
  expect(() => saveChatVoicePreferenceV1(page, {sourceHash: 'unfrozen', participantKey: 'guard', voiceURI: 'device'})).toThrow('绑定')
  vi.stubGlobal('localStorage', {getItem: () => {throw new DOMException('denied', 'SecurityError')}})
  expect(readChatVoicePreferencesV1().error).toContain('无法读取')
})

it('bounds retained old role choices without storing conversation history', () => {
  let page = readChatVoicePreferencesV1()
  for (let i = 0; i < 260; i++) page = saveChatVoicePreferenceV1(page, {sourceHash: first, participantKey: `role.${i}`, voiceURI: 'device'})
  expect(page.preferences.voices).toHaveLength(256)
  expect(chatRoleVoiceV1(page.preferences, first, 'role.0')).toBe('')
  expect(chatRoleVoiceV1(page.preferences, first, 'role.259')).toBe('device')
})
