import { useEffect, useRef, useState } from 'react'
import { sha256MediaData } from '../../lib/product-production/media-blob-store'

type Source = { data: ArrayBuffer; asset: { contentHash: string; mimeType: string; durationMs: number | null } }
type Props = { identityKey: string; expectedContentHash: string; loadSource: () => Promise<Source>; disabled: boolean }

/** A read-only original for A/B comparison. It exposes no audition capture,
 * review callback, author command or adoption interface. The parent unmounts
 * the candidate audition before mounting this player. */
export default function OriginalAudioComparisonPlayer({ identityKey, expectedContentHash, loadSource, disabled }: Props) {
  const [source, setSource] = useState<{ url: string; contentHash: string; durationMs: number } | null>(null)
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0)
  const audio = useRef<HTMLAudioElement | null>(null)
  useEffect(() => {
    let active = true, url: string | null = null
    setSource(null); setError('')
    void (async () => {
      const loaded = await loadSource(), asset = { ...loaded.asset }, data = loaded.data.slice(0)
      if (data.byteLength < 1 || data.byteLength > 32 * 1024 * 1024 || asset.contentHash !== expectedContentHash
        || !['audio/wav', 'audio/ogg', 'audio/mpeg', 'audio/mp4'].includes(asset.mimeType)
        || asset.durationMs === null || !Number.isFinite(asset.durationMs) || asset.durationMs <= 0
        || await sha256MediaData(data) !== expectedContentHash) throw new Error('原始对照音频与准确来源字节不一致')
      if (!active) return
      url = URL.createObjectURL(new Blob([data], { type: asset.mimeType }))
      setSource({ url, contentHash: asset.contentHash, durationMs: asset.durationMs })
    })().catch(cause => { if (active) setError(cause instanceof Error ? cause.message : String(cause)) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [identityKey, expectedContentHash, loadSource, attempt])
  useEffect(() => {
    const player = audio.current
    if (disabled) player?.pause()
    return () => player?.pause()
  }, [disabled, source?.url])
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') audio.current?.pause() }
    document.addEventListener('visibilitychange', hidden)
    return () => document.removeEventListener('visibilitychange', hidden)
  }, [])
  return <section aria-label="原始音频只读对照">
    <p>原始版本供只读对照，不计入加工版的听取观察。要记录新的加工版观察，请返回加工候选并从头审听。</p>
    {error ? <><p role="alert">{error}</p><button className="lf-action" disabled={disabled} onClick={() => setAttempt(value => value + 1)}>重新读取原始对照音频</button></>
      : source ? <><p>原始版本 · {source.durationMs} 毫秒 · {source.contentHash.slice(0, 12)}</p>
        <audio ref={audio} aria-label="原始版本对照播放器" src={source.url} controls={!disabled} preload="none" style={{ width: '100%', maxWidth: 480 }}
          onPlay={() => { if (disabled || document.visibilityState === 'hidden') audio.current?.pause() }}
          onError={() => { audio.current?.pause(); setError('原始对照音频无法播放，请重新核对准确字节') }}/></>
        : <p role="status">正在核验原始对照音频…</p>}
  </section>
}
