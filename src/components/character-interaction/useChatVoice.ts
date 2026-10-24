import {useEffect, useRef, useState} from 'react'
import {VoiceSession, type VoiceSnapshot} from '../../lib/longform-voice/session'
import {DEFAULT_COMPANION, VOICE_MAX_TEXT} from '../../lib/longform-voice/contract'
import {CHAT_VOICE_PREFERENCES_KEY, chatRoleVoiceV1, readChatVoicePreferencesV1, saveChatVoicePreferenceV1} from '../../lib/character-interaction/voice-preferences'

export interface ChatVoiceMessage {
  messageId: string; speakerKey: string; role: string; text: string
  audienceKeys: string[] | null; supersededBySequence: number | null
}
const idle = (): VoiceSnapshot => ({phase: 'idle', preview: '', error: '', paused: false})

/** A presentation-only controller. It can read an existing visible message or
 * offer a transcript for confirmation; it has no story/DB/adoption capability. */
export function useChatVoice(input: {
  ownerKey: string; voiceScopeKey: string; enabled: boolean; busy: boolean; playerKey: string
  messages: readonly ChatVoiceMessage[]; onConfirmTranscript(text: string): boolean
}) {
  const current = useRef(input); current.current = input
  const owner = useRef<{key: string; session: VoiceSession; speakingId: string | null; speakingText: string | null} | null>(null)
  const [loaded, setLoaded] = useState<{key: string; state: VoiceSnapshot; speakingId: string | null}>({key: '', state: idle(), speakingId: null})
  const [pending, setPending] = useState<{key: string; text: string} | null>(null)
  const [localError, setLocalError] = useState<{key: string; text: string} | null>(null)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [device, setDevice] = useState(readChatVoicePreferencesV1)
  const volume = device.preferences.volume
  const identity = JSON.stringify({owner: input.ownerKey, enabled: input.enabled})
  useEffect(() => {
    if (!input.enabled || !input.ownerKey) return
    const entry = {key: identity, session: null as unknown as VoiceSession, speakingId: null as string | null, speakingText: null as string | null}
    entry.session = new VoiceSession(state => {
      if (owner.current === entry) setLoaded({key: identity, state, speakingId: state.phase === 'idle' ? null : entry.speakingId})
    }, text => {
      if (owner.current === entry && current.current.enabled && !current.current.busy) setPending({key: identity, text})
    }, 'character-chat')
    owner.current = entry
    entry.session.cancel()
    const hidden = () => {if (document.hidden) {entry.session.cancel(); setPending(null)}}
    document.addEventListener('visibilitychange', hidden)
    return () => {entry.session.dispose(); if (owner.current === entry) owner.current = null; document.removeEventListener('visibilitychange', hidden)}
  }, [identity]) // eslint-disable-line react-hooks/exhaustive-deps -- immutable owner key includes save, source and conversation audience
  useEffect(() => {
    const sync = () => setVoices(window.speechSynthesis?.getVoices() ?? [])
    sync(); window.speechSynthesis?.addEventListener('voiceschanged', sync)
    return () => window.speechSynthesis?.removeEventListener('voiceschanged', sync)
  }, [])
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key !== CHAT_VOICE_PREFERENCES_KEY && event.key !== null) return
      owner.current?.session.cancel()
      setDevice(readChatVoicePreferencesV1())
    }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  }, [])
  useEffect(() => {if (input.busy) {owner.current?.session.cancel(); setPending(null)}}, [input.busy])
  useEffect(() => {
    const entry = owner.current
    if (entry?.speakingId && !input.messages.some(item => item.messageId === entry.speakingId && item.text === entry.speakingText
      && item.role === 'character' && item.supersededBySequence == null && (item.audienceKeys == null || item.audienceKeys.includes(input.playerKey)))) entry.session.cancel()
  }, [input.messages, input.playerKey])
  useEffect(() => {owner.current?.session.setVolume(volume)}, [volume, identity])
  const state = loaded.key === identity ? loaded.state : idle()
  const transcript = pending?.key === identity ? pending.text : ''
  const error = localError?.key === identity ? localError.text : state.error
  function ready() {return input.enabled && !input.busy && owner.current?.key === identity ? owner.current : null}
  function clearError() {setLocalError(null)}
  function stop() {owner.current?.session.cancel(); setPending(null); clearError()}
  function speak(messageId: string) {
    const entry = ready(); if (!entry) return
    const message = current.current.messages.find(item => item.messageId === messageId && item.role === 'character'
      && item.supersededBySequence == null && (item.audienceKeys == null || item.audienceKeys.includes(current.current.playerKey)))
    if (!message) {entry.session.cancel(); setLocalError({key: identity, text: '这条消息已不可朗读，请选择当前可见的角色消息。'}); return}
    if (message.text.length > VOICE_MAX_TEXT) {entry.session.cancel(); setLocalError({key: identity, text: `这条消息超过单次朗读的 ${VOICE_MAX_TEXT} 字上限，请继续阅读完整文字。`}); return}
    const selectedVoice = chatRoleVoiceV1(device.preferences, input.voiceScopeKey, message.speakerKey)
    if (selectedVoice && !voices.some(voice => voice.voiceURI === selectedVoice)) {entry.session.cancel(); setLocalError({key: identity, text: '此设备已找不到所选音色，请重新选择。'}); return}
    clearError(); entry.speakingId = messageId; entry.speakingText = message.text
    void entry.session.speak(message.text, {...DEFAULT_COMPANION, browserVoice: selectedVoice})
  }
  function listen() {
    const entry = ready(); if (!entry || transcript) return
    clearError(); entry.speakingId = null
    void entry.session.listen({...DEFAULT_COMPANION})
  }
  function confirmTranscript() {
    if (!ready() || !transcript) return
    if (current.current.onConfirmTranscript(transcript)) {setPending(null); clearError()}
    else setLocalError({key: identity, text: '输入框暂时无法接收这段文字；请检查草稿状态或缩短输入后再确认。'})
  }
  return {state, transcript, error, preferencesError: device.error, voices, volume, speakingId: loaded.key === identity ? loaded.speakingId : null,
    available: !!ready(), speak, listen, confirmTranscript, stop,
    finish: () => ready()?.session.finish(), pause: () => ready()?.session.pause(), resume: () => {void ready()?.session.resume()},
    setVolume: (value: number) => {if (Number.isFinite(value) && value >= 0 && value <= 1) setDevice(saveChatVoicePreferenceV1(device, {volume: value}))},
    voiceFor: (key: string) => chatRoleVoiceV1(device.preferences, input.voiceScopeKey, key),
    setVoice: (key: string, uri: string) => {if (ready() && (uri === '' || voices.some(voice => voice.voiceURI === uri))) {
      owner.current?.session.cancel(); setDevice(saveChatVoicePreferenceV1(device, {sourceHash: input.voiceScopeKey, participantKey: key, voiceURI: uri}))
    }},
  }
}
