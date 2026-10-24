import type {useChatVoice} from './useChatVoice'

export default function ChatVoiceControls({voice, profiles}: {
  voice: ReturnType<typeof useChatVoice>; profiles: readonly {participantKey: string; name: string}[]
}) {
  const phase = voice.state.phase
  return <details className="chat-media-details" data-testid="chat-voice-controls"><summary aria-live="polite">语音{voice.error ? ' · 提示' : phase !== 'idle' ? ' · 进行中' : voice.transcript ? ' · 待确认' : ''}</summary>
    <div className="chat-media-gallery space-y-3" aria-label="聊天语音">
      <p>浏览器识别可能使用浏览器厂商的服务。转写需确认后加入输入框，再由你发送。</p>
      {voice.error && <p role="alert">{voice.error}</p>}
      {voice.preferencesError && <p role="status">{voice.preferencesError}</p>}
      {phase === 'idle' && !voice.transcript && <button type="button" className="lf-action" disabled={!voice.available} onClick={voice.listen}>开始语音输入</button>}
      {phase === 'requesting' && <p role="status">等待麦克风权限…</p>}
      {phase === 'listening' && <><p role="status">正在听… {voice.state.preview}</p><button type="button" className="lf-action" onClick={voice.finish}>结束录音并查看转写</button></>}
      {phase === 'transcribing' && <p role="status">正在整理转写…</p>}
      {phase === 'preparing' && <p role="status">正在准备朗读…</p>}
      {phase === 'speaking' && <button type="button" className="lf-action" onClick={voice.state.paused ? voice.resume : voice.pause}>{voice.state.paused ? '继续朗读' : '暂停朗读'}</button>}
      {phase !== 'idle' && <button type="button" className="lf-action" onClick={voice.stop}>{phase === 'speaking' || phase === 'preparing' ? '停止朗读' : '放弃录音'}</button>}
      {voice.transcript && <div><label className="block">待确认的转写<textarea aria-label="待确认的语音转写" readOnly value={voice.transcript} rows={3} className="w-full rounded border border-border p-2"/></label>
        <div className="flex flex-wrap gap-2"><button type="button" className="lf-action" disabled={!voice.available} onClick={voice.confirmTranscript}>添加到输入框</button><button type="button" className="lf-action" onClick={voice.stop}>放弃转写</button></div></div>}
      <label className="block">朗读音量<input aria-label="朗读音量" type="range" min={0} max={1} step={.05} value={voice.volume} onChange={event => voice.setVolume(Number(event.target.value))}/></label>
      <details><summary>此设备的角色音色</summary><p>按作品版本记住音色；换设备后需要重新选择。</p>{profiles.map(profile => <label key={profile.participantKey} className="block">{profile.name}<select className="w-full min-w-0" disabled={!voice.available} aria-label={`${profile.name}的朗读音色`} value={voice.voiceFor(profile.participantKey)} onChange={event => voice.setVoice(profile.participantKey, event.target.value)}>
        <option value="">设备默认音色</option>{voice.voices.map(item => <option key={item.voiceURI} value={item.voiceURI}>{item.name} · {item.lang}{item.localService ? '' : ' · 网络音色'}</option>)}
        {voice.voiceFor(profile.participantKey) && !voice.voices.some(item => item.voiceURI === voice.voiceFor(profile.participantKey)) && <option value={voice.voiceFor(profile.participantKey)}>所选音色暂不可用</option>}
      </select></label>)}</details>
    </div>
  </details>
}
