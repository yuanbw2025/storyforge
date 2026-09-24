import { useCallback, useEffect, useRef, useState } from 'react'
import { useCompanionStore } from '../../stores/companion'
import { VoiceSession, type VoiceSnapshot } from '../../lib/longform-voice/session'

export function useCompanionVoice(
  scope: string,
  loading: boolean,
  busy: boolean,
  latestReply: { id?: number; content: string } | undefined,
  onTranscript: (text: string) => void,
) {
  const preferences = useCompanionStore((state) => state.preferences)
  const [state, setState] = useState<VoiceSnapshot>({ phase: 'idle', preview: '', error: '' })
  const session = useRef<VoiceSession | null>(null)
  const callback = useRef(onTranscript)
  useEffect(() => { callback.current = onTranscript }, [onTranscript])
  useEffect(() => {
    const current = new VoiceSession(setState, (text) => callback.current(text))
    session.current = current
    current.cancel()
    const onVisibility = () => { if (document.hidden) current.cancel() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => { current.dispose(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [scope])
  useEffect(() => { session.current?.cancel() }, [preferences])
  // Establish a fresh baseline when opening a conversation or enabling auto-read.
  const seenReply = useRef<number | undefined>(undefined)
  const initialized = useRef(false)
  useEffect(() => { initialized.current = false }, [scope, preferences.autoRead])
  useEffect(() => {
    if (loading) { initialized.current = false; return }
    if (!initialized.current) {
      seenReply.current = latestReply?.id
      initialized.current = true
      return
    }
    if (busy || !latestReply || latestReply.id === seenReply.current) return
    seenReply.current = latestReply.id
    if (preferences.autoRead && state.phase === 'idle') {
      void session.current?.speak(latestReply.content.slice(0, 400), preferences)
    }
  }, [loading, busy, latestReply, preferences, state.phase])
  const listen = useCallback(() => { void session.current?.listen(preferences) }, [preferences])
  const speak = useCallback((text: string) => { void session.current?.speak(text, preferences) }, [preferences])
  const finish = useCallback(() => session.current?.finish(), [])
  const cancel = useCallback(() => session.current?.cancel(), [])
  return { state, listen, speak, finish, cancel }
}
