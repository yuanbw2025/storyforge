import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import maleSample from '../../assets/ttrpg/narration-qwen-uncle_fu-v1.wav'
import femaleSample from '../../assets/ttrpg/narration-qwen-serena-v1.wav'
import legacySample from '../../assets/ttrpg/narration-preview.wav'
import { applyTtrpgNarrationRateV1, saveTtrpgNarrationRateV1, saveTtrpgNarratorVoiceV1, TTRPG_NARRATION_RATES_V1,
  TTRPG_NARRATOR_VOICES_V1, useTtrpgNarrationRateV1, useTtrpgNarratorVoiceV1, type TtrpgNarratorVoiceV1 } from '../../lib/ttrpg/narration-listening-preferences'

const samples = { 'qwen.uncle_fu': maleSample, 'qwen.serena': femaleSample, 'melo.zh': legacySample }

/** A public fixed sample; playing it reveals no session text or private role. */
export default function TtrpgNarrationListeningSettings({ paused = false }: { paused?: boolean }) {
  const rate = useTtrpgNarrationRateV1(), audio = useRef<HTMLAudioElement | null>(null)
  const voice = useTtrpgNarratorVoiceV1()
  const [error, setError] = useState('')
  useLayoutEffect(() => { if (audio.current) applyTtrpgNarrationRateV1(audio.current, rate) }, [rate, voice, paused])
  useLayoutEffect(() => {
    const element = audio.current
    if (paused) element?.pause()
    return () => element?.pause()
  }, [voice, paused])
  useEffect(() => {
    const stop = () => audio.current?.pause()
    const hidden = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', stop)
    return () => { stop(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', stop) }
  }, [])
  return <section className="sf-open-table-card" data-testid="ttrpg-narration-listening-settings">
    <h3>旁白试听与选择</h3>
    <p>先试听男声或女声，再选适合自己的语速。设置会保存在当前浏览器，进入冒险后也可调整。</p>
    <label>旁白语速<select aria-label="旁白语速" value={rate} onChange={event => {
      setError(saveTtrpgNarrationRateV1(Number(event.target.value)) ? '' : '浏览器暂不能保存设置，请检查存储权限。')
    }}>{TTRPG_NARRATION_RATES_V1.map(value => <option key={value} value={value}>{value.toFixed(2)} 倍{value === 0.9 ? '（默认，稍慢）' : value === 1 ? '（原速）' : ''}</option>)}</select></label>
    <label>试听声线<select aria-label="旁白试听声线" value={voice} onChange={event => {
      audio.current?.pause()
      setError(saveTtrpgNarratorVoiceV1(event.target.value as TtrpgNarratorVoiceV1) ? '' : '浏览器暂不能保存设置，请检查存储权限。')
    }}>{TTRPG_NARRATOR_VOICES_V1.map(value => <option key={value.id} value={value.id}>{value.label} · {value.name}</option>)}</select></label>
    <p>新生成的旁白使用所选声线，已有旁白保留原来的声音。播放语速可随时调整。</p>
    <audio key={voice} ref={audio} src={paused ? undefined : samples[voice]} controls preload="none" aria-label="旁白语速试听" onPlay={event => {
      if (paused) event.currentTarget.pause()
      else applyTtrpgNarrationRateV1(event.currentTarget, rate)
    }} onError={() => setError('试听暂不可用，仍可继续文字游玩。')}/>
    {error && <p role="status">{error}</p>}
  </section>
}
