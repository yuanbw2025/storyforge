import {afterEach, beforeEach, expect, it, vi} from 'vitest'
import {act, createElement} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {useChatVoice, type ChatVoiceMessage} from '../../src/components/character-interaction/useChatVoice'
import ChatVoiceControls from '../../src/components/character-interaction/ChatVoiceControls'
import {CHAT_VOICE_PREFERENCES_KEY, readChatVoicePreferencesV1, saveChatVoicePreferenceV1} from '../../src/lib/character-interaction/voice-preferences'

class Recognition {
  static last: Recognition
  onstart?: () => void; onend?: () => void
  onresult?: (event: {results: Array<{isFinal: boolean; 0: {transcript: string}}>}) => void
  abort = vi.fn()
  constructor() {Recognition.last = this}
  start() {this.onstart?.()} stop() {this.onend?.()}
}
class Utterance {
  onstart?: () => void; onend?: () => void; volume = 1; voice?: SpeechSynthesisVoice
  constructor(public text: string) {}
}
type Props = Parameters<typeof useChatVoice>[0]
let root: Root, host: HTMLDivElement, voice: ReturnType<typeof useChatVoice>, available: SpeechSynthesisVoice[]
const speak = vi.fn(), cancel = vi.fn(), pause = vi.fn(), resume = vi.fn(), fetcher = vi.fn(), confirmed = vi.fn(() => true)
let events: EventTarget
function Probe(props: Props) {voice = useChatVoice(props); return createElement(ChatVoiceControls, {voice, profiles: [{participantKey: 'guard', name: '叶岑'}]})}
const message = (patch: Partial<ChatVoiceMessage> = {}): ChatVoiceMessage => ({messageId: 'reply', speakerKey: 'guard', role: 'character', text: '那就先休息。', audienceKeys: ['player', 'guard'], supersededBySequence: null, ...patch})
const props = (): Props => ({ownerKey: 'save-1:public', voiceScopeKey: '1'.repeat(64), enabled: true, busy: false, playerKey: 'player', messages: [message()], onConfirmTranscript: confirmed})
async function render(input: Props) {await act(async () => root.render(createElement(Probe, input)))}
async function say(text = '我想先休息。') {
  await act(async () => voice.listen())
  await act(async () => {
    Recognition.last.onresult?.({results: [{isFinal: true, 0: {transcript: text}}]})
    voice.finish()
  })
}
beforeEach(() => {
  vi.clearAllMocks(); confirmed.mockReturnValue(true)
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  events = new EventTarget()
  available = [{voiceURI: 'local.zh.one', name: '本地音色', lang: 'zh-CN', localService: true, default: true}]
  speak.mockImplementation((utterance: Utterance) => utterance.onstart?.())
  vi.stubGlobal('SpeechRecognition', Recognition); vi.stubGlobal('SpeechSynthesisUtterance', Utterance); vi.stubGlobal('fetch', fetcher)
  vi.stubGlobal('speechSynthesis', {speak, cancel, pause, resume, getVoices: () => available,
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events)})
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => {await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals()})

it('keeps transcription pending until explicit confirmation and never sends or invokes a model', async () => {
  await render(props()); expect(voice.available).toBe(true); expect(speak).not.toHaveBeenCalled()
  await say()
  expect(voice.transcript).toBe('我想先休息。'); expect(confirmed).not.toHaveBeenCalled()
  expect(host.querySelector('textarea')?.value).toBe('我想先休息。')
  confirmed.mockReturnValueOnce(false)
  await act(async () => voice.confirmTranscript())
  expect(voice.transcript).toBe('我想先休息。'); expect(voice.error).toContain('草稿')
  await act(async () => voice.confirmTranscript())
  expect(confirmed).toHaveBeenLastCalledWith('我想先休息。'); expect(voice.transcript).toBe('')
  expect(fetcher).not.toHaveBeenCalled(); expect(speak).not.toHaveBeenCalled()
})

it('cannot carry a pending or late transcript into another save or conversation audience', async () => {
  const input = props(); await render(input); await say('只对叶岑说的内容。')
  await render({...input, ownerKey: 'save-1:private-artisan'})
  expect(voice.transcript).toBe(''); await act(async () => voice.confirmTranscript()); expect(confirmed).not.toHaveBeenCalled()
  await act(async () => voice.listen())
  const lateResult = Recognition.last.onresult!, lateEnd = Recognition.last.onend!
  await render({...input, ownerKey: 'save-2:public'})
  await act(async () => {lateResult({results: [{isFinal: true, 0: {transcript: '迟到内容'}}]}); lateEnd()})
  expect(voice.transcript).toBe(''); expect(confirmed).not.toHaveBeenCalled()
})

it('reads only committed visible character messages by ID and rejects hidden, replaced, player and unknown text', async () => {
  await render({...props(), messages: [message(), message({messageId: 'secret', text: '不能听到的秘密', audienceKeys: ['guard']}),
    message({messageId: 'old', supersededBySequence: 8}), message({messageId: 'player', role: 'player'}), message({messageId: 'long', text: '长'.repeat(2001)})]})
  for (const id of ['secret', 'old', 'player', 'candidate-not-committed', 'long']) await act(async () => voice.speak(id))
  expect(speak).not.toHaveBeenCalled(); expect(voice.error).toContain('2000')
  await act(async () => voice.speak('reply'))
  expect(speak).toHaveBeenCalledOnce(); expect(speak.mock.calls[0][0].text).toBe('那就先休息。')
  expect(fetcher).not.toHaveBeenCalled()
})

it('uses the chosen role voice, pauses and resumes without replay, and retains the voice across audience changes', async () => {
  const input = props(); await render(input)
  await act(async () => {voice.setVoice('guard', 'local.zh.one'); voice.setVolume(.25)})
  await act(async () => voice.speak('reply'))
  expect(speak.mock.calls[0][0]).toMatchObject({voice: available[0], volume: .25})
  await act(async () => voice.pause()); expect(voice.state.paused).toBe(true)
  await act(async () => voice.resume()); expect(voice.state.paused).toBe(false)
  expect(speak).toHaveBeenCalledOnce(); expect(pause).toHaveBeenCalledOnce(); expect(resume).toHaveBeenCalledOnce()
  await render({...input, ownerKey: 'save-1:private-guard'})
  expect(voice.voiceFor('guard')).toBe('local.zh.one'); expect(voice.state.phase).toBe('idle')
  await render({...input, ownerKey: 'save-2:public', voiceScopeKey: '2'.repeat(64)})
  expect(voice.voiceFor('guard')).toBe(''); expect(speak).toHaveBeenCalledOnce()
})

it('stops a message that becomes hidden or changes, and never auto-reads after reload or newly arrived messages', async () => {
  const input = props(); await render(input)
  await act(async () => voice.speak('reply'))
  await render({...input, messages: [message({text: '修订后的消息'})]})
  expect(voice.state.phase).toBe('idle'); expect(cancel).toHaveBeenCalled()
  await render({...input, messages: [message(), message({messageId: 'second', text: '新消息'})]})
  await render({...input, ownerKey: 'reopened-save'})
  expect(speak).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled()
})

it('stops on a new story operation or backgrounding and refuses a missing selected voice instead of changing it silently', async () => {
  const input = props(); await render(input)
  await act(async () => voice.setVoice('guard', 'local.zh.one'))
  await act(async () => voice.speak('reply'))
  // The device list can change before its browser notification reaches React.
  available = []
  await act(async () => voice.speak('reply'))
  expect(voice.error).toContain('找不到所选音色'); expect(voice.state.phase).toBe('idle')
  expect(speak).toHaveBeenCalledOnce(); speak.mockClear()
  available = []; await act(async () => events.dispatchEvent(new Event('voiceschanged')))
  await act(async () => voice.speak('reply'))
  expect(voice.error).toContain('找不到所选音色'); expect(speak).not.toHaveBeenCalled()
  await act(async () => voice.setVoice('guard', '')); await say()
  await render({...input, busy: true}); expect(voice.transcript).toBe(''); expect(voice.available).toBe(false)
  await render(input); await act(async () => voice.speak('reply'))
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  await act(async () => document.dispatchEvent(new Event('visibilitychange')))
  expect(voice.state.phase).toBe('idle'); expect(fetcher).not.toHaveBeenCalled()
})

it('restores device choices on remount without replay, and another page changing them stops current audio', async () => {
  const input = props(); await render(input)
  await act(async () => voice.setVoice('guard', 'local.zh.one'))
  await act(async () => voice.setVolume(.3))
  await act(async () => root.unmount()); root = createRoot(host)
  await render(input)
  expect(voice.voiceFor('guard')).toBe('local.zh.one'); expect(voice.volume).toBe(.3)
  expect(speak).not.toHaveBeenCalled()
  await act(async () => voice.speak('reply'))
  saveChatVoicePreferenceV1(readChatVoicePreferencesV1(), {sourceHash: input.voiceScopeKey, participantKey: 'guard', voiceURI: ''})
  await act(async () => window.dispatchEvent(new StorageEvent('storage', {key: CHAT_VOICE_PREFERENCES_KEY})))
  expect(voice.voiceFor('guard')).toBe(''); expect(voice.state.phase).toBe('idle')
  expect(speak).toHaveBeenCalledOnce(); expect(fetcher).not.toHaveBeenCalled()
})
