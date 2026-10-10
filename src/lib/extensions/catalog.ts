import { readBoundedResponse } from './response'
import { isObject } from './schema'
import { installPackage } from './store'
import { MAX_PACKAGE_BYTES, sha256, readPackage } from './package'
import type { ExtensionPackage } from './types'
export interface CatalogEntry { id: string; version: string; name: string; description: string; author: string; kind: 'feature' | 'content' | 'bundle'; owner: 'world' | 'work'; url: string; digest: string; dependencies: Record<string, string> }
export interface ExtensionCatalog { format: 1; name: string; entries: CatalogEntry[] }
export const defaultCatalogUrl = () => new URL(`${import.meta.env.BASE_URL}workshop/catalog.json`, location.origin).href
export async function readCatalog(address = defaultCatalogUrl()): Promise<ExtensionCatalog> {
  const url = new URL(address)
  if (url.origin !== location.origin && url.protocol !== 'https:') throw new Error('目录地址需要 HTTPS')
  const response = await fetch(url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`目录读取失败 ${response.status}`)
  const body = new TextDecoder().decode(await readBoundedResponse(response, 1_000_000)); if (body.length > 1_000_000) throw new Error('目录体积过大')
  const value: unknown = JSON.parse(body)
  if (!isObject(value) || value.format !== 1 || typeof value.name !== 'string' || !Array.isArray(value.entries) || value.entries.length > 1000) throw new Error('目录格式不兼容')
  const identities = new Set<string>()
  for (const entry of value.entries) {
    if (!isObject(entry) || ['id','version','name','description','author','url','digest'].some(key => typeof entry[key] !== 'string') || !isObject(entry.dependencies) || Object.values(entry.dependencies).some(version => typeof version !== 'string') || !['feature','content','bundle'].includes(String(entry.kind)) || !['world','work'].includes(String(entry.owner)) || !/^[a-f0-9]{64}$/.test(String(entry.digest))) throw new Error('目录条目无效')
    const identity = `${entry.id}@${entry.version}`; if (identities.has(identity)) throw new Error('目录版本重复'); identities.add(identity)
    const packageUrl = new URL(String(entry.url), url)
    if (packageUrl.protocol !== 'https:' && packageUrl.origin !== location.origin) throw new Error('安装包地址需要 HTTPS')
    if (packageUrl.username || packageUrl.password) throw new Error('安装包地址不能携带凭证')
    entry.url = packageUrl.href
  }
  return value as unknown as ExtensionCatalog
}
export async function installFromCatalog(entry: CatalogEntry, catalog: ExtensionCatalog): Promise<ExtensionPackage[]> {
  const result: ExtensionPackage[] = [], visiting = new Set<string>(), done = new Map<string, string>()
  async function install(next: CatalogEntry) {
    if (done.has(next.id)) { if (done.get(next.id) !== next.version) throw new Error(`目录依赖要求 ${next.id} 的冲突版本`); return }
    if (visiting.has(next.id)) throw new Error('目录存在循环依赖')
    visiting.add(next.id)
    for (const [id, version] of Object.entries(next.dependencies)) { const dep = catalog.entries.find(row => row.id === id && row.version === version); if (!dep) throw new Error(`目录缺少依赖 ${id}@${version}`); await install(dep) }
    const response = await fetch(next.url, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) })
    if (!response.ok) throw new Error(`下载失败 ${response.status}`)
    if (Number(response.headers.get('Content-Length')) > MAX_PACKAGE_BYTES) throw new Error('下载包体积过大')
    const bytes = await readBoundedResponse(response, MAX_PACKAGE_BYTES)
    if (await sha256(bytes) !== next.digest) throw new Error('下载内容与目录哈希不一致')
    // Installation never activates code; previously downloaded dependencies remain available on failure.
    const verified = await readPackage(bytes)
    if (verified.manifest.id !== next.id || verified.manifest.version !== next.version || JSON.stringify(verified.manifest.dependencies) !== JSON.stringify(next.dependencies)) throw new Error('目录与安装包身份或依赖不一致')
    const pkg = await installPackage(bytes)
    result.push(pkg); done.set(next.id, next.version); visiting.delete(next.id)
  }
  await install(entry)
  return result
}
