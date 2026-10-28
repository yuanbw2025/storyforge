import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import OriginalAudioComparisonPlayer from '../../src/components/avg/OriginalAudioComparisonPlayer'
import { sha256MediaData } from '../../src/lib/product-production/media-blob-store'

type Source = Awaited<ReturnType<ComponentProps<typeof OriginalAudioComparisonPlayer>['loadSource']>>
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:original-comparison')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Comparison may not request a provider') }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function original(): Promise<Source> {
  const data = new ArrayBuffer(60), view = new DataView(data)
  const text = (at: number, value: string) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
  text(0, 'RIFF'); view.setUint32(4, 52, true); text(8, 'WAVE'); text(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 16, true)
  return { data, asset: { mimeType: 'audio/wav', contentHash: await sha256MediaData(data), durationMs: .5 } }
}
const mount = (source: Source, loadSource = vi.fn(async () => source), disabled = false) => act(async () => root.render(
  <OriginalAudioComparisonPlayer identityKey="original.exact" expectedContentHash={source.asset.contentHash} loadSource={loadSource} disabled={disabled}/>))
const settled = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })

describe('AVG original audio comparison has no review or adoption interface', () => {
  it('verifies original bytes before creating a read-only player and revokes its URL on unmount', async () => {
    const source = await original(), load = vi.fn(async () => source)
    await mount(source, load); await settled()
    expect(load).toHaveBeenCalledTimes(1); expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    const player = host.querySelector('audio')!
    expect(player.getAttribute('aria-label')).toBe('原始版本对照播放器'); expect(player.controls).toBe(true)
    expect(host.textContent).toContain('不计入加工版的听取观察'); expect(fetch).not.toHaveBeenCalled()
    await act(async () => root.render(null))
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:original-comparison')
  })
  it('rejects bytes with an incorrect hash and requires an explicit retry before loading the exact original', async () => {
    const source = await original(), bad = source.data.slice(0); new Uint8Array(bad)[44] = 1
    const load = vi.fn().mockResolvedValueOnce({ ...source, data: bad }).mockResolvedValue(source)
    await mount(source, load); await settled()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('准确来源字节不一致')
    expect(host.querySelector('audio')).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(load).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector('button')!.click()); await settled()
    expect(load).toHaveBeenCalledTimes(2); expect(host.querySelector('audio')).not.toBeNull()
  })
  it('does not create a late player or Blob URL after the author leaves comparison', async () => {
    const source = await original(); let resolve!: (value: Source) => void
    const load = vi.fn(() => new Promise<Source>(done => { resolve = done }))
    await mount(source, load); await act(async () => root.render(null))
    await act(async () => resolve(source)); await settled()
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(host.querySelector('audio')).toBeNull()
  })
  it('pauses when disabled or hidden and prevents hidden playback without creating an observation', async () => {
    const source = await original(), load = vi.fn(async () => source)
    await mount(source, load); await settled()
    const pause = vi.mocked(HTMLMediaElement.prototype.pause); pause.mockClear()
    await mount(source, load, true)
    expect(host.querySelector('audio')!.controls).toBe(false); expect(pause).toHaveBeenCalled()
    await mount(source, load); pause.mockClear()
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    await act(async () => document.dispatchEvent(new Event('visibilitychange')))
    expect(pause).toHaveBeenCalledTimes(1)
    await act(async () => host.querySelector('audio')!.dispatchEvent(new Event('play')))
    expect(pause).toHaveBeenCalledTimes(2); expect(fetch).not.toHaveBeenCalled()
  })
})
