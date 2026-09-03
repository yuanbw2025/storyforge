import { describe, expect, it } from 'vitest'
import { collectBrowserPerformanceSamplesV1 } from '../../src/lib/product-production/in-app-browser-performance-lab'

describe('R-PRODUCTPROD-1I · in-app browser performance lab', () => {
  it('先满足最小延迟样本，再按真实经过时间采集长期内存序列', async () => {
    let now = 0
    let transition = 0
    const result = await collectBrowserPerformanceSamplesV1({
      durationMs: 100, latencySampleIntervalMs: 25, memorySampleIntervalMs: 40,
      minimumLatencySamples: 2, signal: new AbortController().signal,
      now: () => now,
      wait: async durationMs => { now += durationMs },
      measureTransition: async () => ({ sceneLatencyMs: 30 + transition++, inputLatencyMs: 10 }),
      readHeapBytes: async () => 1024 + now,
    })
    expect(result.cachedSceneLatenciesMs.length).toBeGreaterThanOrEqual(6)
    expect(result.choiceInputLatenciesMs).toHaveLength(result.cachedSceneLatenciesMs.length)
    expect(result.memorySamples.map(sample => sample.elapsedMs)).toEqual([0, 50, 100])
  })

  it('用户停止后立即 fail closed，不返回可写入的测量', async () => {
    const controller = new AbortController()
    controller.abort('author-stop')
    await expect(collectBrowserPerformanceSamplesV1({
      durationMs: 100, latencySampleIntervalMs: 25, memorySampleIntervalMs: 40,
      minimumLatencySamples: 2, signal: controller.signal,
      now: () => 0, wait: async () => undefined,
      measureTransition: async () => ({ sceneLatencyMs: 1, inputLatencyMs: 1 }),
      readHeapBytes: async () => 1,
    })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
