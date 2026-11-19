import { assertAtlasPaintPackageV2, type AtlasPaintPackageV2 } from '../world-map/atlas/paint-package'
import type { AtlasViewStyle } from '../world-map/atlas/view-style'
import type { AtlasSymbolStyle } from '../world-map/atlas/symbols'
import { authorViewCache } from '../storage/author-view-cache'

/** Browser-owned, disposable author-view cache. Never a world semantic table or a
 * portable project asset. Explicit paint packages remain the portable backup. */
const prefix = '/__storyforge_atlas_author_view__/'
interface Entry { owner: string; art: AtlasPaintPackageV2; error?: string }
const memory = new Map<string, Entry>()
const queues = new Map<string, Promise<unknown>>()
function cacheKey(owner: string, style: AtlasViewStyle, symbols: AtlasSymbolStyle) {
  if (!owner || owner.length > 300) throw Error('地图视图缺少有效归属。')
  return prefix + encodeURIComponent(owner) + '/' + style + '/' + symbols
}
function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const next = (queues.get(key) || Promise.resolve()).catch(() => undefined).then(task)
  queues.set(key, next)
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key) }).catch(() => undefined)
  return next
}
export async function readAtlasView(owner: string, style: AtlasViewStyle, symbols: AtlasSymbolStyle): Promise<Entry | undefined> {
  const key = cacheKey(owner, style, symbols)
  await queues.get(key)?.catch(() => undefined)
  if (memory.has(key)) return structuredClone(memory.get(key))
  const value = await authorViewCache.get(key) as Entry | undefined
  if (!value) return undefined
  assertAtlasPaintPackageV2(value.art)
  if (value.owner !== owner || value.art.style !== style || value.art.symbols !== symbols) throw Error('本机增强图归属无效。')
  memory.set(key, value)
  return structuredClone(value)
}
export function saveAtlasView(owner: string, art: AtlasPaintPackageV2): Promise<void> {
  const snapshot = structuredClone(art)
  assertAtlasPaintPackageV2(snapshot)
  const key = cacheKey(owner, snapshot.style, snapshot.symbols), entry: Entry = { owner, art: snapshot }
  memory.set(key, entry)
  return serial(key, async () => {
    try {
      await authorViewCache.put(key, { owner, art: snapshot })
      delete entry.error
    } catch {
      entry.error = '增强图本机保存失败，当前仅本次查看可用。请导出底图包保留结果。'
      throw Error(entry.error)
    }
  })
}
export function removeAtlasView(owner: string, style: AtlasViewStyle, symbols: AtlasSymbolStyle): Promise<void> {
  const key = cacheKey(owner, style, symbols)
  return serial(key, async () => {
    await authorViewCache.remove(key)
    memory.delete(key)
  })
}
export async function clearAtlasWorkspaceViews(workspaceUid: string) {
  const start = prefix + encodeURIComponent(workspaceUid + ':')
  await Promise.all([...queues].filter(([key]) => key.startsWith(start)).map(([, pending]) => pending.catch(() => undefined)))
  // One native transaction: a failed cleanup retains both disk and memory views.
  await authorViewCache.removePrefix(start)
  for (const key of memory.keys()) if (key.startsWith(start)) memory.delete(key)
}
