import type { WorldReleaseSemanticContentV4 } from '../types/narrative-release'
import type { NarrativeCompilationResultV1, NarrativeIncrementalBaseV1 } from './narrative-incremental'
import { canonicalNarrativeJsonV1, hashNarrativeValueV1 } from './narrative-json'

export const NARRATIVE_COMPILE_WORKER_BUDGET_V1 = Object.freeze({ timeoutMs: 60_000 })
export type NarrativeCompileProgressV1 = 'worker-started' | 'inline-fallback'
function aborted(): Error { return new DOMException('叙事世界编译已取消，原封存保留', 'AbortError') }

async function verifyWorkerTransfer(input: Omit<WorldReleaseSemanticContentV4, 'narrative'>, result: NarrativeCompilationResultV1): Promise<NarrativeCompilationResultV1> {
  if (!result?.manifest || !result.index || typeof result.manifestJson !== 'string') throw Error('[narrative-worker] 后台未返回完整编译结果')
  const { narrative, semanticRootHash, indexDescriptor, ...source } = result.manifest
  const { indexHash, ...indexBody } = result.index
  if (canonicalNarrativeJsonV1(source) !== canonicalNarrativeJsonV1(input)
    || canonicalNarrativeJsonV1(result.manifest) !== result.manifestJson
    || await hashNarrativeValueV1(result.manifest) !== result.contentHash
    || await hashNarrativeValueV1({ ...source, narrative }) !== semanticRootHash
    || indexDescriptor.inputRootHash !== semanticRootHash || result.index.inputRootHash !== semanticRootHash
    || indexDescriptor.recipeVersion !== result.index.recipeVersion || indexDescriptor.indexHash !== indexHash
    || await hashNarrativeValueV1(indexBody) !== indexHash) throw Error('[narrative-worker] 后台传输结果与捕获来源或 hash 不一致')
  return result
}

/** Registered pure compiler in a dedicated worker. A platform without Worker
 * explicitly reports inline fallback. A dispatched worker failure never
 * silently retries; callers retain their checkpoint and previous release. */
export async function compileNarrativeReleaseInWorkerV1(input: Omit<WorldReleaseSemanticContentV4, 'narrative'>, options: {
  baseline?: NarrativeIncrementalBaseV1
  signal?: AbortSignal
  onProgress?: (phase: NarrativeCompileProgressV1) => void
} = {}): Promise<NarrativeCompilationResultV1> {
  if (options.signal?.aborted) throw aborted()
  const bytes = canonicalNarrativeJsonV1(input)
  const baseline = options.baseline && JSON.parse(canonicalNarrativeJsonV1(options.baseline)) as NarrativeIncrementalBaseV1 | undefined
  const frozen = JSON.parse(bytes) as typeof input
  let result: NarrativeCompilationResultV1
  if (typeof Worker === 'undefined') {
    options.onProgress?.('inline-fallback')
    const { compileWorldReleaseContentV4 } = await import('./narrative-release-v4')
    if (options.signal?.aborted) throw aborted()
    result = baseline ? await (await import('./narrative-incremental')).compileNarrativeReleaseIncrementalV1(frozen, baseline) : await compileWorldReleaseContentV4(frozen)
  } else {
    result = await new Promise<NarrativeCompilationResultV1>((resolve, reject) => {
      const worker = new Worker(new URL('./narrative-release.worker.ts', import.meta.url), { type: 'module' })
      let finished = false
      const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener('abort', onAbort); worker.terminate() }
      const finish = (error?: Error, value?: NarrativeCompilationResultV1) => {
        if (finished) return
        finished = true; cleanup()
        if (error) reject(error); else resolve(value!)
      }
      const onAbort = () => finish(aborted())
      const timer = setTimeout(() => finish(Error('[narrative-worker] 后台编译超时，未写入新封存')), NARRATIVE_COMPILE_WORKER_BUDGET_V1.timeoutMs)
      options.signal?.addEventListener('abort', onAbort, { once: true })
      worker.onmessage = event => {
        if (event.data?.status === 'compiling') {
          try { options.onProgress?.('worker-started') } catch (error) { finish(error instanceof Error ? error : Error('编译进度处理失败')) }
        } else if (event.data?.status === 'complete') finish(undefined, event.data.result as NarrativeCompilationResultV1)
        else if (event.data?.status === 'failed') finish(Error('[narrative-worker] ' + String(event.data.error)))
        else finish(Error('[narrative-worker] 后台返回未知状态'))
      }
      worker.onerror = () => finish(Error('[narrative-worker] 后台编译被中断，未写入新封存'))
      worker.onmessageerror = () => finish(Error('[narrative-worker] 无法传输编译结果'))
      if (options.signal?.aborted) onAbort()
      else {
        try { worker.postMessage({ version: 1, input: frozen, baseline }) }
        catch (error) { finish(error instanceof Error ? error : Error('无法发送编译输入')) }
      }
    })
  }
  if (options.signal?.aborted) throw aborted()
  if (baseline) {
    const update = result.update
    if (!update || update.version !== 1 || update.baseContentHash !== baseline.contentHash
      || update.impact.nextRevisionVector.semanticRootHash !== result.manifest.semanticRootHash) throw Error('[narrative-worker] 增量回执缺失或绑定错误')
    const { planHash, ...body } = update.impact
    if (await hashNarrativeValueV1(body) !== planHash) throw Error('[narrative-worker] 修改影响计划传输校验失败')
  } else if (result.update) throw Error('[narrative-worker] 全量任务不能接收未请求的增量回执')
  const verified = await verifyWorkerTransfer(frozen, result)
  if (options.signal?.aborted) throw aborted()
  return verified
}
