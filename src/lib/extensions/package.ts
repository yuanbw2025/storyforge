import JSZip from 'jszip'
import { assertJson, checkSchema, isObject, validateData } from './schema'
import type { ExtensionManifest, ExtensionPackage } from './types'

export const EXTENSION_API = 1
export const MAX_PACKAGE_BYTES = 16 * 1024 * 1024
const idPattern = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
const localId = /^[a-z][a-z0-9-]{0,63}$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const manifestKeys = ['format', 'api', 'id', 'version', 'name', 'description', 'author', 'license', 'kind', 'owner', 'entry', 'dependencies', 'permissions', 'networkOrigins', 'views', 'schemas', 'provides', 'consumes', 'content', 'flows', 'aiTasks', 'worldSemantics', 'rulePacks', 'connectors']
export function parseManifest(value: unknown): ExtensionManifest {
  assertJson(value)
  if (!isObject(value) || JSON.stringify(value).length > 256000) throw new Error('插件清单无效或过大')
  for (const key of Object.keys(value)) if (!manifestKeys.includes(key)) throw new Error(`未知清单字段：${key}`)
  if (value.format !== 1 || value.api !== EXTENSION_API) throw new Error('插件包格式或 SDK 版本不兼容')
  if (typeof value.id !== 'string' || value.id.length > 120 || !idPattern.test(value.id)) throw new Error('插件 id 必须使用作者命名空间，如 author.calendar')
  if (typeof value.version !== 'string' || !versionPattern.test(value.version)) throw new Error('插件版本必须为 x.y.z')
  for (const key of ['name', 'description', 'author', 'license']) if (typeof value[key] !== 'string' || !(value[key] as string).trim() || (value[key] as string).length > 4000) throw new Error(`清单 ${key} 缺失或过长`)
  if (!['feature', 'content', 'bundle'].includes(String(value.kind)) || !['world', 'work'].includes(String(value.owner))) throw new Error('插件种类或数据归属无效')
  if (value.kind === 'feature') { if (typeof value.entry !== 'string' || !safePath(value.entry) || !value.entry.endsWith('.js')) throw new Error('功能插件需要包内 .js 入口') }
  else if (value.entry !== undefined) throw new Error('内容包、组合包不能包含执行入口')
  if (!isObject(value.dependencies) || Object.entries(value.dependencies).some(([id, version]) => !idPattern.test(id) || id === value.id || typeof version !== 'string' || !versionPattern.test(version))) throw new Error('依赖必须为其他插件的准确版本')
  for (const field of ['permissions', 'networkOrigins', 'provides', 'consumes']) {
    if (!Array.isArray(value[field]) || (value[field] as unknown[]).some(item => typeof item !== 'string') || new Set(value[field] as string[]).size !== (value[field] as string[]).length) throw new Error(`${field} 必须为无重复的字符串数组`)
  }
  const permissions = value.permissions as string[]
  if (permissions.some(item => !['data', 'history.read', 'history.write', 'ai.history', 'ai.timeline', 'ai.tasks', 'world.publish', 'product.rules', 'mcp', 'network', 'flows'].includes(item))) throw new Error('插件请求了不支持的能力')
  for (const origin of value.networkOrigins as string[]) {
    const url = new URL(origin)
    if (url.origin !== origin || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('外部连接只允许 HTTPS 或本机 HTTP origin')
  }
  if ((value.networkOrigins as string[]).length && !permissions.includes('network')) throw new Error('连接地址需要 network 声明')
  if ((value.provides as string[]).some(id => !id.startsWith(`${value.id}.`) || !idPattern.test(id)) || (value.consumes as string[]).some(id => !idPattern.test(id))) throw new Error('服务 ID 必须使用命名空间')
  if (!Array.isArray(value.views) || value.views.length > 20) throw new Error('views 无效')
  const viewIds = new Set<string>()
  for (const view of value.views) {
    if (!isObject(view) || Object.keys(view).some(key => !['id', 'title', 'target', 'mode'].includes(key)) || typeof view.id !== 'string' || !localId.test(view.id) || viewIds.has(view.id) || typeof view.title !== 'string' || !view.title.trim() || !['workbench', 'history', 'story-timeline'].includes(String(view.target)) || !['add', 'replace'].includes(String(view.mode))) throw new Error('界面贡献无效或 ID 重复')
    if (view.mode === 'replace' && (view.target === 'workbench' || (view.target === 'history' ? value.owner !== 'world' : value.owner !== 'work'))) throw new Error('替换面板与数据 owner 不匹配')
    viewIds.add(view.id)
  }
  if (!isObject(value.schemas) || Object.keys(value.schemas).length > 20) throw new Error('schemas 无效')
  for (const [id, definition] of Object.entries(value.schemas)) {
    if (!localId.test(id) || !isObject(definition) || Object.keys(definition).some(key => !['version', 'schema'].includes(key)) || !Number.isInteger(definition.version) || Number(definition.version) < 1) throw new Error('schema 名称或版本无效')
    checkSchema(definition.schema)
  }
  if (value.connectors !== undefined) {
    if (!Array.isArray(value.connectors) || value.connectors.length > 10 || !permissions.includes('mcp')) throw new Error('MCP 连接需要 mcp 能力，最多 10 个')
    const ids = new Set<string>()
    for (const connector of value.connectors) {
      if (!isObject(connector) || Object.keys(connector).some(key => !['id','title','url','protocol','tools'].includes(key)) || typeof connector.id !== 'string' || !localId.test(connector.id) || ids.has(connector.id) || typeof connector.title !== 'string' || !connector.title.trim() || connector.title.length > 120 || typeof connector.url !== 'string' || connector.url.length > 2000 || !['2026-07-28','legacy'].includes(String(connector.protocol)) || !Array.isArray(connector.tools) || !connector.tools.length || connector.tools.length > 50 || connector.tools.some(tool => typeof tool !== 'string' || !/^[a-zA-Z0-9_.-]{1,100}$/.test(tool)) || new Set(connector.tools).size !== connector.tools.length) throw new Error('MCP 连接声明无效')
      const endpoint = new URL(connector.url)
      if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['https:','http:'].includes(endpoint.protocol) || (endpoint.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) throw new Error('MCP 地址只允许无凭据的 HTTPS 或本机 HTTP，不允许查询参数')
      ids.add(connector.id)
    }
  }
  if (value.worldSemantics !== undefined) {
    if (!Array.isArray(value.worldSemantics) || value.worldSemantics.length > 20 || value.owner !== 'world' || !permissions.includes('world.publish') || !permissions.includes('data')) throw new Error('世界语义声明需要 world owner 与 world.publish/data 能力')
    const ids = new Set<string>()
    for (const item of value.worldSemantics) {
      if (!isObject(item) || Object.keys(item).some(key => !['id','title','schemaId','domain','titleField','summaryField','descriptionField','fields'].includes(key)) || typeof item.id !== 'string' || !localId.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || !['origin','natural','humanity'].includes(String(item.domain)) || typeof item.schemaId !== 'string' || !isObject(value.schemas[item.schemaId]) || !Array.isArray(item.fields) || item.fields.length > 20 || item.fields.includes('extensionSource') || new Set(item.fields).size !== item.fields.length) throw new Error('世界语义投影声明无效')
      const definition = value.schemas[item.schemaId] as Record<string, unknown>
      const schema = definition.schema as Record<string, unknown>, properties = schema.properties
      if (schema.type !== 'object' || !isObject(properties)) throw new Error('世界语义必须来自对象 schema')
      for (const key of [item.titleField,item.summaryField,item.descriptionField,...item.fields]) if (typeof key !== 'string' || !isObject(properties[key]) || !['string','number','integer','boolean'].includes(String((properties[key] as Record<string,unknown>).type))) throw new Error('语义字段只能引用明确声明的文本、数字或布尔值')
      for (const key of [item.titleField,item.summaryField,item.descriptionField]) if ((properties[key as string] as Record<string,unknown>).type !== 'string') throw new Error('语义标题、摘要和描述需要文本字段')
      ids.add(item.id)
    }
  }
  if (value.rulePacks !== undefined) {
    if (!Array.isArray(value.rulePacks) || value.rulePacks.length > 10 || value.owner !== 'work' || !permissions.includes('product.rules')) throw new Error('规则包需要 work owner 与 product.rules 能力')
    const ids = new Set<string>()
    for (const rule of value.rulePacks) {
      if (!isObject(rule) || Object.keys(rule).some(key => !['id','title','asset'].includes(key)) || typeof rule.id !== 'string' || !localId.test(rule.id) || ids.has(rule.id) || typeof rule.title !== 'string' || !rule.title.trim() || typeof rule.asset !== 'string' || !safePath(rule.asset) || !rule.asset.endsWith('.json')) throw new Error('规则包声明无效')
      ids.add(rule.id)
    }
  }
  if (value.aiTasks !== undefined) {
    if (!Array.isArray(value.aiTasks) || value.aiTasks.length > 20 || !permissions.includes('ai.tasks') || !permissions.includes('data')) throw new Error('AI 任务需要 ai.tasks 与 data 能力')
    const ids = new Set<string>()
    for (const task of value.aiTasks) {
      if (!isObject(task) || Object.keys(task).some(key => !['id', 'title', 'instruction', 'outputSchema', 'contextSources'].includes(key)) || typeof task.id !== 'string' || !localId.test(task.id) || ids.has(task.id) || typeof task.title !== 'string' || !task.title.trim() || task.title.length > 120 || typeof task.instruction !== 'string' || !task.instruction.trim() || task.instruction.length > 8000 || typeof task.outputSchema !== 'string' || !isObject(value.schemas[task.outputSchema]) || !Array.isArray(task.contextSources) || new Set(task.contextSources).size !== task.contextSources.length || task.contextSources.some(key => !['worldview', 'storyCore', 'characters', 'historical', 'storyTimeline'].includes(String(key)))) throw new Error('AI 任务声明无效')
      const definition = value.schemas[task.outputSchema] as Record<string, unknown>
      if (!isObject(definition.schema) || definition.schema.type !== 'object') throw new Error('AI 任务输出必须是已声明的对象 schema')
      ids.add(task.id)
    }
  }
  if (value.flows !== undefined) {
    if (value.owner !== 'work' || !Array.isArray(value.flows) || value.flows.length > 10 || !permissions.includes('flows')) throw new Error('流程声明需要作品归属和 flows 能力')
    const ids = new Set<string>()
    for (const flow of value.flows) {
      if (!isObject(flow) || Object.keys(flow).some(key => !['id','name','nodes','edges'].includes(key)) || typeof flow.id !== 'string' || !localId.test(flow.id) || ids.has(flow.id) || typeof flow.name !== 'string' || !flow.name.trim() || !Array.isArray(flow.nodes) || flow.nodes.length < 1 || flow.nodes.length > 40 || !Array.isArray(flow.edges) || flow.edges.length > 100) throw new Error('流程声明无效')
      ids.add(flow.id)
      for (const node of flow.nodes) if (!isObject(node) || Object.keys(node).some(key => !['id','templateId','config'].includes(key)) || typeof node.id !== 'string' || !localId.test(node.id) || typeof node.templateId !== 'string' || !isObject(node.config)) throw new Error('流程节点无效')
      for (const edge of flow.edges) if (!isObject(edge) || Object.keys(edge).some(key => !['source','target','sourcePort','targetPort'].includes(key)) || ['source','target','sourcePort','targetPort'].some(key => typeof edge[key] !== 'string')) throw new Error('流程连接无效')
    }
  }
  if (value.content !== undefined) {
    if (!Array.isArray(value.content) || value.content.length > 1000) throw new Error('内容包记录无效')
    const keys = new Set<string>()
    for (const record of value.content) {
      if (!isObject(record) || Object.keys(record).some(key => !['schemaId', 'key', 'payload'].includes(key)) || typeof record.key !== 'string' || !localId.test(record.key) || keys.has(record.key) || typeof record.schemaId !== 'string') throw new Error('内容记录键无效或重复')
      const definition = value.schemas[record.schemaId]
      if (!isObject(definition)) throw new Error('内容记录引用了未知 schema')
      validateData(definition.schema as unknown as import('./types').DataSchema, record.payload)
      keys.add(record.key)
    }
  }
  if (value.kind !== 'feature' && ((value.views as unknown[]).length || (value.provides as unknown[]).length || (value.consumes as unknown[]).length)) throw new Error('无代码包不能声明界面或服务')
  return structuredClone(value) as unknown as ExtensionManifest
}
export function safePath(path: string): boolean {
  return path.length < 240 && !path.startsWith('/') && !path.includes('\\') && !path.includes(':') && path.split('/').every(part => part && part !== '.' && part !== '..')
}
export async function sha256(bytes: ArrayBuffer): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
}
/** Reject oversized, encrypted and ZIP64 archives before JSZip allocates expanded entries. */
function inspectZip(bytes: ArrayBuffer): Map<string, { size: number; crc: number }> {
  const entries = new Map<string, { size: number; crc: number }>()
  const view = new DataView(bytes)
  let end = -1
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) throw new Error('不是受支持的单卷 ZIP 插件包')
  const count = view.getUint16(end + 10, true)
  let offset = view.getUint32(end + 16, true), expanded = 0
  if (count < 1 || count > 256) throw new Error('插件包文件数量越界')
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50 || (view.getUint16(offset + 8, true) & 1)) throw new Error('插件 ZIP 目录无效或已加密')
    const size = view.getUint32(offset + 24, true), crc = view.getUint32(offset + 16, true)
    const nameLength = view.getUint16(offset + 28, true)
    const name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, offset + 46, nameLength))
    if (entries.has(name)) throw new Error('插件包文件重名')
    entries.set(name, { size, crc })
    expanded += size
    if (expanded > MAX_PACKAGE_BYTES * 2) throw new Error('插件解压体积超过 32 MB')
    offset += 46 + view.getUint16(offset + 28, true) + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true)
  }
  if (offset > end) throw new Error('插件 ZIP 目录越界')
  return entries
}
export async function readPackage(bytes: ArrayBuffer): Promise<{ manifest: ExtensionManifest; zip: JSZip; digest: string }> {
  if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error('插件包超过 16 MB')
  const entries = inspectZip(bytes)
  const zip = await JSZip.loadAsync(bytes)
  if (Object.keys(zip.files).length !== entries.size) throw new Error('插件包目录不一致')
  for (const [path, file] of Object.entries(zip.files)) {
    const original = (file as typeof file & { unsafeOriginalName?: string }).unsafeOriginalName
    if (!safePath(file.dir ? path.slice(0, -1) : path) || (original && original !== path)) throw new Error('插件包路径不安全')
    const expected = entries.get(path)
    if (!expected) throw new Error('插件包目录不一致')
    if (!file.dir) await new Promise<void>((resolve, reject) => {
      let length = 0, crc = -1
      // JSZip documents this streaming API; its bundled types omit the ZipObject method.
      const stream = (file as typeof file & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
      stream.on('data', chunk => {
        length += chunk.length
        if (length > expected.size || length > MAX_PACKAGE_BYTES * 2) { stream.pause(); reject(new Error('插件实际解压体积超出声明')); return }
        for (const byte of chunk) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0) }
      }).on('error', reject).on('end', () => {
        if (length !== expected.size || ((crc ^ -1) >>> 0) !== expected.crc) reject(new Error('插件文件大小或 CRC 校验失败'))
        else resolve()
      }).resume()
    })
  }
  const manifestFile = zip.file('manifest.json')
  if (!manifestFile) throw new Error('插件包缺少 manifest.json')
  const manifest = parseManifest(JSON.parse(await manifestFile.async('string')))
  if (manifest.entry && !zip.file(manifest.entry)) throw new Error('插件入口文件不存在')
  for (const rule of manifest.rulePacks ?? []) if (!zip.file(rule.asset)) throw new Error('规则包资源不存在')
  return { manifest, zip, digest: await sha256(bytes) }
}
export async function verifyInstalledPackage(pkg: ExtensionPackage) {
  const verified = await readPackage(pkg.bytes)
  if (verified.digest !== pkg.digest || verified.manifest.id !== pkg.pluginId || verified.manifest.version !== pkg.version || JSON.stringify(verified.manifest) !== JSON.stringify(pkg.manifest)) throw new Error('已安装插件内容与锁定身份不一致')
  return verified
}
