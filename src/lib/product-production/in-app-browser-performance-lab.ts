import { db } from '../db/schema'
import type { WorkspaceScope } from '../types'
import { assertRecordInScope, resolveScope } from '../workspace/scope'
import {
  PRODUCT_BROWSER_PERFORMANCE_POLICY_V1,
  type ProductBrowserPerformanceMeasurementV1,
} from './browser-performance'
import { createBuildProductMediaResolver } from './media-resolver'
import { verifyProductBuildPreviewManifestV1 } from './preview-manifest'

export interface InAppBrowserPerformanceLabProgressV1 {
  phase: 'preparing' | 'warmup' | 'long-run' | 'recording'
  elapsedMs: number
  durationMs: number
  sceneSamples: number
  inputSamples: number
  memorySamples: number
  latestSceneLatencyMs: number | null
  latestInputLatencyMs: number | null
  latestHeapBytes: number | null
}

export interface BrowserPerformanceSampleCollectionV1 {
  cachedSceneLatenciesMs: number[]
  choiceInputLatenciesMs: number[]
  memorySamples: Array<{ elapsedMs: number; usedHeapBytes: number }>
}

function abortError(): DOMException {
  return new DOMException('浏览器性能验收已停止', 'AbortError')
}

function ensureActive(signal: AbortSignal): void {
  if (signal.aborted) throw abortError()
}

function waitWithSignal(durationMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    ensureActive(signal)
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', aborted)
      resolve()
    }, Math.max(0, durationMs))
    const aborted = () => {
      window.clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', aborted, { once: true })
  })
}

export async function collectBrowserPerformanceSamplesV1(input: {
  durationMs: number
  latencySampleIntervalMs: number
  memorySampleIntervalMs: number
  minimumLatencySamples: number
  signal: AbortSignal
  now: () => number
  wait: (durationMs: number, signal: AbortSignal) => Promise<void>
  measureTransition: () => Promise<{ sceneLatencyMs: number; inputLatencyMs: number }>
  readHeapBytes: () => Promise<number>
  onProgress?: (progress: Omit<InAppBrowserPerformanceLabProgressV1, 'phase' | 'durationMs'>) => void
}): Promise<BrowserPerformanceSampleCollectionV1> {
  if (!Number.isFinite(input.durationMs) || input.durationMs < 1
    || !Number.isFinite(input.latencySampleIntervalMs) || input.latencySampleIntervalMs < 1
    || !Number.isFinite(input.memorySampleIntervalMs) || input.memorySampleIntervalMs < 1
    || !Number.isInteger(input.minimumLatencySamples) || input.minimumLatencySamples < 1) {
    throw new Error('[product-browser-performance-lab] 采样参数无效')
  }
  const cachedSceneLatenciesMs: number[] = []
  const choiceInputLatenciesMs: number[] = []
  const memorySamples: Array<{ elapsedMs: number; usedHeapBytes: number }> = []
  let latestSceneLatencyMs: number | null = null
  let latestInputLatencyMs: number | null = null
  let latestHeapBytes: number | null = null
  const notify = (elapsedMs: number) => input.onProgress?.({
    elapsedMs, sceneSamples: cachedSceneLatenciesMs.length, inputSamples: choiceInputLatenciesMs.length,
    memorySamples: memorySamples.length, latestSceneLatencyMs, latestInputLatencyMs, latestHeapBytes,
  })
  for (let index = 0; index < input.minimumLatencySamples; index += 1) {
    ensureActive(input.signal)
    const sample = await input.measureTransition()
    if (!Number.isFinite(sample.sceneLatencyMs) || sample.sceneLatencyMs < 0
      || !Number.isFinite(sample.inputLatencyMs) || sample.inputLatencyMs < 0) {
      throw new Error('[product-browser-performance-lab] 浏览器延迟样本无效')
    }
    latestSceneLatencyMs = sample.sceneLatencyMs
    latestInputLatencyMs = sample.inputLatencyMs
    cachedSceneLatenciesMs.push(sample.sceneLatencyMs)
    choiceInputLatenciesMs.push(sample.inputLatencyMs)
    notify(0)
  }
  const startedAt = input.now()
  let nextMemoryAt = 0
  while (true) {
    ensureActive(input.signal)
    const elapsedMs = Math.max(0, input.now() - startedAt)
    if (elapsedMs >= nextMemoryAt) {
      latestHeapBytes = await input.readHeapBytes()
      if (!Number.isFinite(latestHeapBytes) || latestHeapBytes < 0) {
        throw new Error('[product-browser-performance-lab] 浏览器堆内存样本无效')
      }
      memorySamples.push({ elapsedMs, usedHeapBytes: latestHeapBytes })
      nextMemoryAt += input.memorySampleIntervalMs
    }
    notify(elapsedMs)
    if (elapsedMs >= input.durationMs) break
    const sample = await input.measureTransition()
    latestSceneLatencyMs = sample.sceneLatencyMs
    latestInputLatencyMs = sample.inputLatencyMs
    cachedSceneLatenciesMs.push(sample.sceneLatencyMs)
    choiceInputLatenciesMs.push(sample.inputLatencyMs)
    const remainingMs = input.durationMs - Math.max(0, input.now() - startedAt)
    if (remainingMs > 0) await input.wait(Math.min(input.latencySampleIntervalMs, remainingMs), input.signal)
  }
  const finalElapsedMs = Math.max(input.durationMs, input.now() - startedAt)
  if (!memorySamples.length || memorySamples[memorySamples.length - 1].elapsedMs < input.durationMs) {
    latestHeapBytes = await input.readHeapBytes()
    memorySamples.push({ elapsedMs: finalElapsedMs, usedHeapBytes: latestHeapBytes })
    notify(finalElapsedMs)
  }
  return { cachedSceneLatenciesMs, choiceInputLatenciesMs, memorySamples }
}

type MemoryPerformance = Performance & {
  memory?: { usedJSHeapSize?: number }
  measureUserAgentSpecificMemory?: () => Promise<{ bytes?: number }>
}

async function readBrowserHeapBytes(): Promise<number> {
  const measured = performance as MemoryPerformance
  if (typeof measured.measureUserAgentSpecificMemory === 'function') {
    try {
      const result = await measured.measureUserAgentSpecificMemory()
      if (Number.isFinite(result.bytes) && Number(result.bytes) >= 0) return Number(result.bytes)
    } catch {
      // Chromium exposes performance.memory more broadly on local workspaces.
    }
  }
  const used = measured.memory?.usedJSHeapSize
  if (!Number.isFinite(used) || Number(used) < 0) {
    throw new Error('[product-browser-performance-lab] 当前浏览器没有可验证的 JS 堆内存接口')
  }
  return Number(used)
}

function nextPaint(signal: AbortSignal): Promise<number> {
  return new Promise((resolve, reject) => {
    ensureActive(signal)
    const aborted = () => reject(abortError())
    signal.addEventListener('abort', aborted, { once: true })
    requestAnimationFrame(timestamp => {
      signal.removeEventListener('abort', aborted)
      if (signal.aborted) reject(abortError())
      else resolve(timestamp)
    })
  })
}

function browserName(userAgent: string): string {
  if (/Edg\//.test(userAgent)) return 'edge'
  if (/Chrome\//.test(userAgent)) return 'chromium'
  if (/Firefox\//.test(userAgent)) return 'firefox'
  if (/Safari\//.test(userAgent)) return 'safari'
  return 'browser'
}

export async function runInAppBrowserPerformanceLabV1(input: {
  scope: WorkspaceScope
  productBuildId: number
  host: HTMLElement
  signal: AbortSignal
  onProgress?: (progress: InAppBrowserPerformanceLabProgressV1) => void
  /** Test/smoke override. Commercial UI always omits this and runs the policy duration. */
  durationMs?: number
}): Promise<ProductBrowserPerformanceMeasurementV1> {
  ensureActive(input.signal)
  const durationMs = input.durationMs ?? PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLongRunDurationMs
  const scope = await resolveScope({ scope: input.scope })
  const build = await db.productBuilds.get(input.productBuildId)
  if (!build || !await assertRecordInScope(scope, 'productBuilds', build, { owner: 'work' })) {
    throw new Error('[product-browser-performance-lab] Build 不存在或跨 Work')
  }
  if (!['preview-ready', 'release-ready', 'released'].includes(build.status)) {
    throw new Error('[product-browser-performance-lab] Build 尚未达到浏览器验收状态')
  }
  const preview = await verifyProductBuildPreviewManifestV1(build.previewManifestJson)
  if (preview.packageHash !== build.packageHash || preview.previewHash !== build.previewHash) {
    throw new Error('[product-browser-performance-lab] Preview 与 Build hash 不一致')
  }
  const artifacts = await db.productBuildArtifacts.where('buildId').equals(build.id!).toArray()
  for (const artifact of artifacts) {
    if (!await assertRecordInScope(scope, 'productBuildArtifacts', artifact, { owner: 'work' })) {
      throw new Error('[product-browser-performance-lab] Build Artifact 跨 Work')
    }
  }
  const firstInteractiveBytes = new TextEncoder().encode(build.previewManifestJson).byteLength
    + artifacts.filter(artifact => artifact.blobObjectId != null)
      .reduce((sum, artifact) => sum + Number(artifact.byteSize || 0), 0)
  const resolver = await createBuildProductMediaResolver({ scope, productBuildId: build.id!, preview })
  const assetKeys = (preview.runtimePackage.presentation?.assets ?? []).map(asset => asset.assetKey)
  const maximumBytes = (preview.runtimePackage.presentation?.assets ?? [])
    .reduce((sum, asset) => sum + asset.byteSize, 0)
  input.onProgress?.({
    phase: 'preparing', elapsedMs: 0, durationMs, sceneSamples: 0, inputSamples: 0,
    memorySamples: 0, latestSceneLatencyMs: null, latestInputLatencyMs: null, latestHeapBytes: null,
  })
  const catalog = await resolver.preload({ assetKeys, maximumBytes })
  if (catalog.failures.length) {
    resolver.dispose()
    throw new Error(`[product-browser-performance-lab] 媒资预加载失败:${catalog.failures.map(row => row.assetKey).join(',')}`)
  }
  const surface = document.createElement('section')
  surface.setAttribute('aria-label', '当前 Build 浏览器性能采样舞台')
  surface.style.cssText = 'position:relative;overflow:hidden;width:100%;height:180px;border-radius:8px;background:#111827;color:#f8fafc;contain:layout paint style;'
  const visual = document.createElement('div')
  visual.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;'
  const label = document.createElement('strong')
  label.style.cssText = 'position:absolute;left:12px;bottom:12px;z-index:3;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.65);font-size:12px;'
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '基准选择'
  button.style.cssText = 'position:absolute;right:12px;bottom:12px;z-index:4;padding:6px 10px;border-radius:6px;background:#a44b32;color:white;'
  const images = (preview.runtimePackage.presentation?.assets ?? [])
    .filter(asset => asset.mimeType.startsWith('image/') && catalog.urls[asset.assetKey])
    .map(asset => {
      const image = document.createElement('img')
      image.src = catalog.urls[asset.assetKey]
      image.alt = ''
      image.decoding = 'async'
      image.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;'
      visual.appendChild(image)
      return image
    })
  for (const asset of preview.runtimePackage.presentation?.assets ?? []) {
    if (!asset.mimeType.startsWith('audio/') || !catalog.urls[asset.assetKey]) continue
    const audio = document.createElement('audio')
    audio.preload = 'auto'; audio.src = catalog.urls[asset.assetKey]
    surface.appendChild(audio)
  }
  const sceneLabels = preview.runtimePackage.narrative.nodes.map(node => node.title)
  let sceneIndex = 0
  const renderScene = () => {
    sceneIndex = (sceneIndex + 1) % Math.max(1, sceneLabels.length, images.length)
    surface.dataset.sceneIndex = String(sceneIndex)
    label.textContent = sceneLabels[sceneIndex % Math.max(1, sceneLabels.length)] ?? `缓存场景 ${sceneIndex + 1}`
    images.forEach((image, index) => { image.style.opacity = index === sceneIndex % images.length ? '1' : '0' })
  }
  button.addEventListener('click', renderScene)
  visual.append(label, button)
  surface.appendChild(visual)
  input.host.replaceChildren(surface)
  try {
    await Promise.all(images.map(image => image.decode().catch(() => undefined)))
    renderScene()
    const measureTransition = async () => {
      ensureActive(input.signal)
      const startedAt = performance.now()
      button.click()
      const inputPaintedAt = await nextPaint(input.signal)
      const scenePaintedAt = await nextPaint(input.signal)
      return {
        inputLatencyMs: Math.max(0, inputPaintedAt - startedAt),
        sceneLatencyMs: Math.max(0, scenePaintedAt - startedAt),
      }
    }
    input.onProgress?.({
      phase: 'warmup', elapsedMs: 0, durationMs, sceneSamples: 0, inputSamples: 0,
      memorySamples: 0, latestSceneLatencyMs: null, latestInputLatencyMs: null, latestHeapBytes: null,
    })
    const samples = await collectBrowserPerformanceSamplesV1({
      durationMs, latencySampleIntervalMs: 5_000, memorySampleIntervalMs: 30_000,
      minimumLatencySamples: PRODUCT_BROWSER_PERFORMANCE_POLICY_V1.minimumLatencySamples,
      signal: input.signal, now: () => performance.now(), wait: waitWithSignal,
      measureTransition, readHeapBytes: readBrowserHeapBytes,
      onProgress: progress => input.onProgress?.({ ...progress, phase: 'long-run', durationMs }),
    })
    input.onProgress?.({
      phase: 'recording', elapsedMs: durationMs, durationMs,
      sceneSamples: samples.cachedSceneLatenciesMs.length,
      inputSamples: samples.choiceInputLatenciesMs.length,
      memorySamples: samples.memorySamples.length,
      latestSceneLatencyMs: samples.cachedSceneLatenciesMs[samples.cachedSceneLatenciesMs.length - 1] ?? null,
      latestInputLatencyMs: samples.choiceInputLatenciesMs[samples.choiceInputLatenciesMs.length - 1] ?? null,
      latestHeapBytes: samples.memorySamples[samples.memorySamples.length - 1]?.usedHeapBytes ?? null,
    })
    const userAgent = navigator.userAgent || 'unknown-browser'
    return {
      runtimeVerifier: 'in-app-browser-lab',
      browserName: browserName(userAgent), browserVersion: userAgent,
      platform: navigator.platform || 'desktop',
      viewport: { width: Math.max(1, window.innerWidth), height: Math.max(1, window.innerHeight) },
      packageHash: build.packageHash, previewHash: build.previewHash, firstInteractiveBytes,
      ...samples, measuredAt: Date.now(),
    }
  } finally {
    input.host.replaceChildren()
    resolver.dispose()
  }
}
