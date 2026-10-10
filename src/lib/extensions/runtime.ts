import { readBoundedResponse } from './response'
import * as react from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import type { ComponentType } from 'react'
import { createHistory, listHistory } from './domain'
import { activePackages, listExtensionRecords, putExtensionRecord, removeExtensionRecord, scopeOf } from './store'
import { safePath, verifyInstalledPackage } from './package'
import { assertJson } from './schema'
import type { ExtensionContext, ExtensionDefinition, ExtensionFactory, ExtensionPackage, ExtensionReviewRequest, ExtensionScope, Json, RegisteredView } from './types'

export function safeStartup(): boolean { return new URLSearchParams(location.search).get('safe-plugins') === '1' || sessionStorage.getItem('storyforge.plugins.safe') === '1' }
export function setSafeStartup(enabled: boolean): void { if (enabled) sessionStorage.setItem('storyforge.plugins.safe', '1'); else sessionStorage.removeItem('storyforge.plugins.safe') }
export async function loadDefinition(pkg: ExtensionPackage): Promise<{ definition: ExtensionDefinition; dispose(): void }> {
  if (safeStartup()) throw new Error('安全模式不执行插件或迁移代码')
  const { manifest, zip } = await verifyInstalledPackage(pkg)
  if (!manifest.entry) return { definition: { activate() {} }, dispose() {} }
  const bytes = await zip.file(manifest.entry)!.async('arraybuffer')
  const url = URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
  try {
    const module = await import(/* @vite-ignore */ url) as { default?: ExtensionFactory }
    if (typeof module.default !== 'function') throw new Error('插件入口必须导出 SDK 工厂函数')
    const definition = module.default({ react, jsxRuntime })
    if (!definition || typeof definition.activate !== 'function') throw new Error('插件缺少 activate 生命周期')
    return { definition, dispose: () => URL.revokeObjectURL(url) }
  } catch (error) { URL.revokeObjectURL(url); throw new Error(`加载失败；请检查插件或浏览器 Blob/CSP 支持：${String(error)}`) }
}
export interface ExtensionSession {
  views: RegisteredView[]
  errors: string[]
  dispose(): Promise<void>
}
export async function startExtensions(scope: ExtensionScope, onReview: (request: ExtensionReviewRequest) => void, signal?: AbortSignal): Promise<ExtensionSession> {
  const views: RegisteredView[] = [], errors: string[] = [], cleanups: (() => void | Promise<void>)[] = []
  const services = new Map<string, { pluginId: string; methods: Record<string, (input: Json) => Json | Promise<Json>> }>()
  const completed = new Set<string>()
  const sessionController = new AbortController()
  const dispose = async () => {
    sessionController.abort()
    for (const cleanup of cleanups.splice(0).reverse()) { try { await cleanup() } catch (error) { errors.push(String(error)) } }
    services.clear(); views.splice(0)
  }
  signal?.addEventListener('abort', () => { void dispose() }, { once: true })
  if (safeStartup() || signal?.aborted) return { views, errors, dispose }
  let packages
  try { packages = await activePackages(scope) } catch (error) { errors.push(String(error)); return { views, errors, dispose } }
  for (const { profile, pkg } of packages) {
    if (sessionController.signal.aborted) break
    const localCleanups: (() => void | Promise<void>)[] = [], registered: RegisteredView[] = []
    const controller = new AbortController()
    const stop = async () => { controller.abort(); for (const cleanup of localCleanups.splice(0).reverse()) { try { await cleanup() } catch (error) { errors.push(String(error)) } } }
    const stopOnAbort = () => { void stop() }
    sessionController.signal.addEventListener('abort', stopOnAbort, { once: true })
    localCleanups.push(() => sessionController.signal.removeEventListener('abort', stopOnAbort))
    const assertLive = () => { if (controller.signal.aborted || sessionController.signal.aborted) throw new Error('插件已停止') }
    const permit = (permission: typeof pkg.manifest.permissions[number]) => { assertLive(); if (!pkg.manifest.permissions.includes(permission)) throw new Error(`插件未声明 ${permission}`) }
    try {
      for (const id of Object.keys(pkg.manifest.dependencies)) if (!completed.has(id)) throw new Error(`依赖 ${id} 未成功激活`)
      const loaded = await loadDefinition(pkg)
      localCleanups.push(loaded.dispose)
      assertLive()
      const context: ExtensionContext = {
        scope: Object.freeze(scopeOf(profile)), manifest: Object.freeze(structuredClone(pkg.manifest)), signal: controller.signal,
        ui: { registerView(id, component: ComponentType) {
          assertLive()
          const declaration = pkg.manifest.views.find(view => view.id === id)
          if (!declaration || registered.some(view => view.id === id) || typeof component !== 'function') throw new Error(`界面 ${id} 未声明、重复或无效`)
          registered.push({ ...declaration, pluginId: pkg.pluginId, component })
        } },
        services: {
          provide(id, methods) { assertLive(); if (!pkg.manifest.provides.includes(id) || services.has(id) || Object.values(methods).some(method => typeof method !== 'function')) throw new Error(`服务 ${id} 未声明或无效`); services.set(id, { pluginId: pkg.pluginId, methods }); localCleanups.push(() => { services.delete(id) }) },
          async call(id, method, input) { assertLive(); assertJson(input); if (!pkg.manifest.consumes.includes(id)) throw new Error(`服务 ${id} 未声明`); const methods = services.get(id)?.methods; const fn = methods && Object.prototype.hasOwnProperty.call(methods, method) ? methods[method] : undefined; if (typeof fn !== 'function' || ['__proto__', 'constructor', 'prototype'].includes(method)) throw new Error('服务方法不存在'); const result = await fn(structuredClone(input)); assertLive(); assertJson(result); return structuredClone(result) },
        },
        data: {
          list(schemaId) { permit('data'); return listExtensionRecords(profile, schemaId) },
          put(input) { permit('data'); return putExtensionRecord(profile, pkg.manifest, input) },
          remove(key, expectedRevision) { permit('data'); return removeExtensionRecord(profile, key, expectedRevision) },
        },
        domain: { history: { list() { permit('history.read'); return listHistory(profile) }, create(input) { permit('history.write'); return createHistory(profile, input) } } },
        ai: { propose(taskId, recordKey, instruction = '') { permit('ai.tasks'); if (!pkg.manifest.aiTasks?.some(task => task.id === taskId) || !/^[a-zA-Z0-9_-]{1,100}$/.test(recordKey) || typeof instruction !== 'string' || instruction.length > 8000) throw new Error('AI 任务或目标无效'); onReview({ scope: scopeOf(profile), pluginId: pkg.pluginId, digest: pkg.digest, kind: 'task', taskId, recordKey, instruction, profileId: profile.id }) }, openReview(kind, instruction) { if (kind !== 'history' && kind !== 'timeline') throw new Error('未知 AI 入口'); permit(kind === 'history' ? 'ai.history' : 'ai.timeline'); if (typeof instruction !== 'string' || instruction.length > 8000 || (kind === 'history' ? !scope.worldId : !scope.workId)) throw new Error('AI 请求作用域或说明无效'); onReview({ scope: scopeOf(profile), pluginId: pkg.pluginId, digest: pkg.digest, kind, instruction }) } },
        flows: { open(id) { permit('flows'); const flow = pkg.manifest.flows?.find(flow => flow.id === id); if (!flow) throw new Error('流程未声明'); onReview({ scope: scopeOf(profile), pluginId: pkg.pluginId, digest: pkg.digest, kind: 'workflow', instruction: flow.name, flowId: id, profileId: profile.id }) } },
        world: { publish(semanticId, recordKeys) { permit('world.publish'); if (!pkg.manifest.worldSemantics?.some(item => item.id === semanticId) || !Array.isArray(recordKeys) || recordKeys.length < 1 || recordKeys.length > 100 || recordKeys.some(key => typeof key !== 'string')) throw new Error('世界语义投影或记录选择无效'); onReview({ scope: scopeOf(profile), pluginId: pkg.pluginId, digest: pkg.digest, kind: 'world-semantics', semanticId, recordKeys, profileId: profile.id, instruction: '确认后复制所选语义字段到世界词条；插件界面、运行数据和未选择字段不会进入世界封存。' }) } },
        rules: { install(ruleId) { permit('product.rules'); if (!pkg.manifest.rulePacks?.some(item=>item.id===ruleId)) throw new Error('规则包未声明'); onReview({ scope: scopeOf(profile), pluginId: pkg.pluginId, digest: pkg.digest, kind: 'rule-pack', ruleId, profileId: profile.id, instruction: '导入当前跑团作品的规则库；在作品制作中选择后，规则内容随正式发布冻结。' }) } },
        tools: { open(connectorId, tool, input) { permit('mcp'); assertJson(input); if (!pkg.manifest.connectors?.find(item => item.id === connectorId)?.tools.includes(tool) || !input || Array.isArray(input) || typeof input !== 'object') throw new Error('MCP 工具未声明或参数无效'); onReview({ scope: scopeOf(profile), pluginId: pkg.pluginId, digest: pkg.digest, profileId: profile.id, kind: 'tool', connectorId, tool, toolInput: structuredClone(input), instruction: '检查工具、发送内容和服务地址后再执行。' }) } },
        network: { async fetch(address, options) {
          permit('network'); const url = new URL(address)
          if (options?.method !== undefined && !['GET', 'POST'].includes(options.method)) throw new Error('连接只支持 GET/POST')
          if (options?.body !== undefined && (typeof options.body !== 'string' || options.body.length > 1_000_000)) throw new Error('请求内容无效或过大')
          if (!pkg.manifest.networkOrigins.includes(url.origin) || url.username || url.password) throw new Error('连接地址未声明')
          const response = await fetch(url, { method: options?.method ?? 'GET', body: options?.body, credentials: 'omit', redirect: 'error', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30000)]), headers: options?.body ? { 'Content-Type': 'application/json' } : undefined })
          if (!response.ok) throw new Error(`外部连接失败 ${response.status}`)
          const text = new TextDecoder().decode(await readBoundedResponse(response, 1_000_000)); if (text.length > 1_000_000) throw new Error('外部响应过大')
          const result: unknown = JSON.parse(text); assertJson(result); assertLive(); return result
        } },
        resources: { async url(path) { assertLive(); if (!safePath(path) || path === 'manifest.json' || path.endsWith('.js')) throw new Error('资源路径无效'); const verified = await verifyInstalledPackage(pkg); const file = verified.zip.file(path); if (!file) throw new Error('包内资源不存在'); const bytes = await file.async('arraybuffer'); assertLive(); const url = URL.createObjectURL(new Blob([bytes])); localCleanups.push(() => URL.revokeObjectURL(url)); return url } },
        lifecycle: { onDispose(cleanup) { assertLive(); localCleanups.push(cleanup) } },
      }
      if (loaded.definition.deactivate) localCleanups.push(() => loaded.definition.deactivate!())
      const activation = loaded.definition.activate(context)
      let timeout: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([Promise.resolve(activation), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('插件激活超过 10 秒')), 10000) })]) } finally { clearTimeout(timeout) }
      assertLive()
      if (registered.length !== pkg.manifest.views.length || pkg.manifest.provides.some(id => services.get(id)?.pluginId !== pkg.pluginId)) throw new Error('插件未注册全部声明的界面或服务')
      completed.add(pkg.pluginId); views.push(...registered); cleanups.push(stop)
    } catch (error) { await stop(); errors.push(`${pkg.manifest.name}：${String(error)}`) }
  }
  if (sessionController.signal.aborted) await dispose()
  return { views, errors, dispose }
}
