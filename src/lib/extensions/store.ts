import { db } from '../db/schema'
import { readPackage, verifyInstalledPackage } from './package'
import { validateData } from './schema'
import type { ExtensionDefinition, ExtensionManifest, ExtensionPackage, ExtensionProfile, ExtensionRecord, ExtensionScope } from './types'

export async function extensionScope(projectId: number, owner: 'world' | 'work', workId?: number): Promise<ExtensionScope> {
  const project = await db.projects.get(projectId)
  if (!project) throw new Error('工作区不存在')
  if (owner === 'world') {
    const world = await db.worlds.get(project.activeWorldId ?? -1)
    if (!world || world.projectId !== projectId || world.identityKind !== 'world-draft') throw new Error('此插件需要一个可编辑世界')
    return { projectId, worldId: world.id!, workId: null, ownerKey: `world:${world.code}` }
  }
  const work = await db.works.get(workId ?? project.activeWorkId ?? -1)
  if (!work || work.projectId !== projectId) throw new Error('作品不存在或不属于当前工作区')
  return { projectId, worldId: null, workId: work.id!, ownerKey: `work:${work.code}` }
}
export async function assertExtensionScope(scope: ExtensionScope): Promise<void> {
  const project = await db.projects.get(scope.projectId)
  const owner = scope.worldId ? await db.worlds.get(scope.worldId) : await db.works.get(scope.workId ?? -1)
  if (!project || !owner || owner.projectId !== scope.projectId || (!!scope.worldId === !!scope.workId) || scope.ownerKey !== `${scope.worldId ? 'world' : 'work'}:${owner.code}`) throw new Error('插件作用域已失效')
}
export async function installPackage(bytes: ArrayBuffer): Promise<ExtensionPackage> {
  const verified = await readPackage(bytes)
  return db.transaction('rw', db.extensionPackages, async () => {
    const old = await db.extensionPackages.where('[pluginId+version]').equals([verified.manifest.id, verified.manifest.version]).first()
    if (old) {
      if (old.digest !== verified.digest) throw new Error('同一插件版本已存在不同内容，请作者增加版本号')
      return old
    }
    const row: ExtensionPackage = { pluginId: verified.manifest.id, version: verified.manifest.version, digest: verified.digest, manifest: verified.manifest, bytes: bytes.slice(0), installedAt: Date.now() }
    row.id = await db.extensionPackages.add(row)
    return row
  })
}
export function orderPackages(packages: ExtensionPackage[]): ExtensionPackage[] {
  const byId = new Map(packages.map(pkg => [pkg.pluginId, pkg]))
  if (byId.size !== packages.length) throw new Error('同一作用域不能同时运行一个插件的多个版本')
  const result: ExtensionPackage[] = [], visiting = new Set<string>(), done = new Set<string>(), replacements = new Set<string>(), services = new Set<string>()
  function visit(pkg: ExtensionPackage) {
    if (done.has(pkg.pluginId)) return
    if (visiting.has(pkg.pluginId)) throw new Error(`循环依赖：${pkg.pluginId}`)
    visiting.add(pkg.pluginId)
    for (const [id, version] of Object.entries(pkg.manifest.dependencies)) {
      const dependency = byId.get(id)
      if (!dependency || dependency.version !== version || dependency.manifest.owner !== pkg.manifest.owner) throw new Error(`缺少兼容依赖 ${id}@${version}`)
      visit(dependency)
    }
    for (const service of pkg.manifest.consumes) {
      const provider = packages.find(other => other.manifest.provides.includes(service))
      if (!provider || !Object.prototype.hasOwnProperty.call(pkg.manifest.dependencies, provider.pluginId)) throw new Error(`服务 ${service} 必须声明提供者依赖`)
    }
    for (const service of pkg.manifest.provides) {
      if (services.has(service)) throw new Error(`服务重复：${service}`)
      services.add(service)
    }
    for (const view of pkg.manifest.views.filter(view => view.mode === 'replace')) {
      if (replacements.has(view.target)) throw new Error(`已有插件替换 ${view.target}，请先停用该插件`)
      replacements.add(view.target)
    }
    visiting.delete(pkg.pluginId); done.add(pkg.pluginId); result.push(pkg)
  }
  packages.forEach(visit)
  return result
}
export async function activePackages(scope: ExtensionScope): Promise<{ profile: ExtensionProfile; pkg: ExtensionPackage }[]> {
  const profiles = (await db.extensionProfiles.where('projectId').equals(scope.projectId).toArray()).filter(p => p.ownerKey === scope.ownerKey && p.enabled)
  const rows = await Promise.all(profiles.map(async profile => {
    const pkg = await db.extensionPackages.where('[pluginId+version]').equals([profile.pluginId, profile.version]).first()
    if (!pkg || pkg.digest !== profile.digest) throw new Error(`缺少锁定插件 ${profile.pluginId}@${profile.version}，可在工坊重新安装或停用`)
    return { profile, pkg }
  }))
  return orderPackages(rows.map(row => row.pkg)).map(pkg => rows.find(row => row.pkg.pluginId === pkg.pluginId)!)
}
export async function enablePackage(pkg: ExtensionPackage, scope: ExtensionScope): Promise<void> {
  await assertExtensionScope(scope)
  const dependencies: ExtensionPackage[] = [], seen = new Set<string>()
  async function collect(next: ExtensionPackage) {
    if (seen.has(next.pluginId)) return
    if ((scope.worldId ? 'world' : 'work') !== next.manifest.owner) throw new Error('插件数据归属与目标不匹配')
    seen.add(next.pluginId)
    await verifyInstalledPackage(next)
    if (next.manifest.flows?.length) {
      const { compileExtensionFlow } = await import('./flows')
      next.manifest.flows.forEach(compileExtensionFlow)
    }
    dependencies.push(next)
    for (const [id, version] of Object.entries(next.manifest.dependencies)) {
      const row = await db.extensionPackages.where('[pluginId+version]').equals([id, version]).first()
      if (!row) throw new Error(`请先安装依赖 ${id}@${version}`)
      await collect(row)
    }
  }
  await collect(pkg)
  await db.transaction('rw', [db.projects, db.worlds, db.works, db.extensionPackages, db.extensionProfiles, db.extensionRecords, db.extensionContracts, db.extensionOperations], async () => {
    await assertExtensionScope(scope)
    const existing = await activePackages(scope)
    const desired = new Map(existing.map(row => [row.pkg.pluginId, row.pkg]))
    for (const next of dependencies) {
      const current = desired.get(next.pluginId)
      if (current && current.digest !== next.digest) throw new Error(`${next.manifest.name} 已启用其他版本，请使用升级`)
      desired.set(next.pluginId, next)
    }
    orderPackages([...desired.values()])
    for (const next of dependencies.reverse()) {
      const installed = await db.extensionPackages.get(next.id!)
      if (!installed || installed.digest !== next.digest) throw new Error('插件安装状态已变化，请重试')
      let profile = await db.extensionProfiles.where('[projectId+ownerKey+pluginId]').equals([scope.projectId, scope.ownerKey, next.pluginId]).first()
      if (profile && profile.digest !== next.digest) throw new Error(`${next.manifest.name} 已有数据版本，请使用升级`)
      const fresh = !profile
      profile = profile ?? { ...scope, pluginId: next.pluginId, version: next.version, digest: next.digest, generation: 1, revision: 0, enabled: false, updatedAt: Date.now() }
      profile.enabled = true; profile.revision++; profile.updatedAt = Date.now()
      profile.id = await db.extensionProfiles.put(profile)
      const contract = await db.extensionContracts.where('[profileId+digest]').equals([profile.id, next.digest]).first()
      if (!contract) await db.extensionContracts.add({ ...scope, profileId: profile.id, digest: next.digest, manifest: next.manifest, createdAt: Date.now() })
      if (fresh) for (const content of next.manifest.content ?? []) await db.extensionRecords.add({ ...scope, profileId: profile.id, pluginId: next.pluginId, key: content.key, schemaId: content.schemaId, schemaVersion: next.manifest.schemas[content.schemaId].version, generation: 1, revision: 1, payload: content.payload, chapterId: null, historyEventId: null, updatedAt: Date.now() })
      await db.extensionOperations.add({ ...scope, profileId: profile.id, kind: 'enable', fromGeneration: profile.generation, toGeneration: profile.generation, fromDigest: next.digest, toDigest: next.digest, detail: `${next.version} · ${next.digest}`, createdAt: Date.now() })
    }
  })
}
export async function disablePackage(profile: ExtensionProfile): Promise<void> {
  await db.transaction('rw', db.extensionProfiles, db.extensionContracts, db.extensionOperations, async () => {
    const rows = (await db.extensionProfiles.where('projectId').equals(profile.projectId).toArray()).filter(row => row.enabled && row.ownerKey === profile.ownerKey)
    for (const row of rows) {
      if (row.id === profile.id) continue
      const contract = await db.extensionContracts.where('[profileId+digest]').equals([row.id!, row.digest]).first()
      if (contract?.manifest.dependencies[profile.pluginId]) throw new Error(`请先停用依赖此插件的 ${row.pluginId}`)
    }
    const current = await db.extensionProfiles.get(profile.id!)
    if (!current) return
    await db.extensionProfiles.update(current.id!, { enabled: false, revision: current.revision + 1, updatedAt: Date.now() })
    await db.extensionOperations.add({ ...scopeOf(current), profileId: current.id!, kind: 'disable', fromGeneration: current.generation, toGeneration: current.generation, fromDigest: current.digest, toDigest: current.digest, detail: '保留数据和版本契约', createdAt: Date.now() })
  })
}
export async function uninstallPackage(pkg: ExtensionPackage): Promise<void> {
  await db.transaction('rw', db.extensionProfiles, db.extensionPackages, async () => {
    const active = (await db.extensionProfiles.where('pluginId').equals(pkg.pluginId).toArray()).some(profile => profile.digest === pkg.digest && profile.enabled)
    if (active) throw new Error('请先在所有作用域停用此版本；卸载会保留作品中的插件数据')
    await db.extensionPackages.delete(pkg.id!)
  })
}
export function scopeOf(row: ExtensionScope): ExtensionScope {
  return { projectId: row.projectId, worldId: row.worldId, workId: row.workId, ownerKey: row.ownerKey }
}
export async function checkActiveProfile(profile: ExtensionProfile): Promise<ExtensionProfile> {
  const latest = await db.extensionProfiles.get(profile.id!)
  if (!latest || !latest.enabled || latest.digest !== profile.digest || latest.generation !== profile.generation || latest.revision !== profile.revision) throw new Error('插件配置已变化，请重新打开功能')
  await assertExtensionScope(latest)
  return latest
}
export async function listExtensionRecords(profile: ExtensionProfile, schemaId?: string): Promise<ExtensionRecord[]> {
  await checkActiveProfile(profile)
  return (await db.extensionRecords.where('profileId').equals(profile.id!).toArray()).filter(row => row.generation === profile.generation && (!schemaId || row.schemaId === schemaId))
}
export async function putExtensionRecord(profile: ExtensionProfile, manifest: ExtensionManifest, input: { key: string; schemaId: string; payload: unknown; expectedRevision: number | null; chapterId?: number | null; historyEventId?: number | null }): Promise<ExtensionRecord> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(input.key)) throw new Error('记录键无效')
  const schema = manifest.schemas[input.schemaId]
  if (!schema) throw new Error('记录 schema 未声明')
  validateData(schema.schema, input.payload)
  const payload = structuredClone(input.payload)
  return db.transaction('rw', [db.projects, db.worlds, db.works, db.extensionProfiles, db.extensionRecords, db.chapters, db.historicalTimelineEvents], async () => {
    await checkActiveProfile(profile)
    if (input.chapterId != null) {
      const chapter = await db.chapters.get(input.chapterId)
      if (!chapter || chapter.projectId !== profile.projectId || (chapter as unknown as { workId: number }).workId !== profile.workId || profile.worldId) throw new Error('章节引用不属于插件作品')
    }
    if (input.historyEventId != null) {
      const event = await db.historicalTimelineEvents.get(input.historyEventId)
      if (!event || event.projectId !== profile.projectId || (event as unknown as { worldId: number }).worldId !== profile.worldId || profile.workId) throw new Error('历史引用不属于插件世界')
    }
    const old = await db.extensionRecords.where('[profileId+generation+key]').equals([profile.id!, profile.generation, input.key]).first()
    if ((old?.revision ?? null) !== input.expectedRevision) throw new Error('记录已被修改，请刷新后重试')
    const row: ExtensionRecord = { ...scopeOf(profile), id: old?.id, profileId: profile.id!, pluginId: profile.pluginId, key: input.key, schemaId: input.schemaId, schemaVersion: schema.version, generation: profile.generation, revision: (old?.revision ?? 0) + 1, payload, chapterId: input.chapterId ?? null, historyEventId: input.historyEventId ?? null, updatedAt: Date.now() }
    row.id = await db.extensionRecords.put(row)
    return row
  })
}
export async function removeExtensionRecord(profile: ExtensionProfile, key: string, expectedRevision: number): Promise<void> {
  await db.transaction('rw', [db.projects, db.worlds, db.works, db.extensionProfiles, db.extensionRecords], async () => {
    await checkActiveProfile(profile)
    const old = await db.extensionRecords.where('[profileId+generation+key]').equals([profile.id!, profile.generation, key]).first()
    if (!old || old.revision !== expectedRevision) throw new Error('记录已变化，请刷新后重试')
    await db.extensionRecords.delete(old.id!)
  })
}
export async function upgradePackage(profile: ExtensionProfile, pkg: ExtensionPackage, definition: ExtensionDefinition): Promise<void> {
  if (profile.enabled) throw new Error('升级前请先停用插件及依赖它的插件')
  if (profile.pluginId !== pkg.pluginId || (profile.worldId ? 'world' : 'work') !== pkg.manifest.owner) throw new Error('升级包身份或 owner 不一致')
  await verifyInstalledPackage(pkg)
  const priorContracts = await db.extensionContracts.where('profileId').equals(profile.id!).toArray()
  for (const [id, schema] of Object.entries(pkg.manifest.schemas)) {
    for (const prior of priorContracts) {
      const old = prior.manifest.schemas[id]
      if (old?.version === schema.version && JSON.stringify(old.schema) !== JSON.stringify(schema.schema)) throw new Error('相同 schema 版本不能改变定义，请增加 schema 版本')
      if (old && old.version > schema.version) throw new Error('不支持倒退 schema 版本；旧数据代仍保留')
    }
  }
  const rows = (await db.extensionRecords.where('profileId').equals(profile.id!).toArray()).filter(row => row.generation === profile.generation)
  const nextRows: ExtensionRecord[] = rows.map(row => {
    const schema = pkg.manifest.schemas[row.schemaId]
    if (!schema) throw new Error(`升级不允许丢弃 schema ${row.schemaId}`)
    const payload = schema.version === row.schemaVersion ? row.payload : definition.migrate?.(structuredClone(row), schema.version)
    validateData(schema.schema, payload)
    return { ...row, id: undefined, payload: structuredClone(payload), schemaVersion: schema.version, generation: profile.generation + 1, revision: 1, updatedAt: Date.now() }
  })
  for (const content of pkg.manifest.content ?? []) {
    if (!rows.some(row => row.key === content.key)) nextRows.push({ ...scopeOf(profile), profileId: profile.id!, pluginId: profile.pluginId, key: content.key, schemaId: content.schemaId, schemaVersion: pkg.manifest.schemas[content.schemaId].version, generation: profile.generation + 1, revision: 1, payload: structuredClone(content.payload), chapterId: null, historyEventId: null, updatedAt: Date.now() })
  }
  await db.transaction('rw', [db.projects, db.worlds, db.works, db.extensionPackages, db.extensionProfiles, db.extensionRecords, db.extensionContracts, db.extensionOperations], async () => {
    await assertExtensionScope(profile)
    const installed = await db.extensionPackages.get(pkg.id!)
    if (!installed || installed.digest !== pkg.digest) throw new Error('升级包已被卸载，请重新安装')
    const current = await db.extensionProfiles.get(profile.id!)
    if (!current || current.enabled || current.revision !== profile.revision) throw new Error('插件配置已变化，升级取消')
    const fresh = (await db.extensionRecords.where('profileId').equals(profile.id!).toArray()).filter(row => row.generation === profile.generation)
    if (JSON.stringify(fresh) !== JSON.stringify(rows)) throw new Error('升级期间数据已变化，原数据保留')
    await db.extensionRecords.bulkAdd(nextRows)
    const contract = await db.extensionContracts.where('[profileId+digest]').equals([profile.id!, pkg.digest]).first()
    if (!contract) await db.extensionContracts.add({ ...scopeOf(profile), profileId: profile.id!, digest: pkg.digest, manifest: pkg.manifest, createdAt: Date.now() })
    await db.extensionProfiles.update(profile.id!, { version: pkg.version, digest: pkg.digest, generation: profile.generation + 1, revision: profile.revision + 1, updatedAt: Date.now() })
    await db.extensionOperations.add({ ...scopeOf(profile), profileId: profile.id!, kind: 'migrate', fromGeneration: profile.generation, toGeneration: profile.generation + 1, fromDigest: profile.digest, toDigest: pkg.digest, detail: `${profile.version} → ${pkg.version}；旧代数据保留`, createdAt: Date.now() })
  })
}

/** Restore by copying into a fresh generation, retaining all newer edits for later recovery. */
export async function restoreGeneration(profile: ExtensionProfile, generation: number): Promise<void> {
  if (profile.enabled || !Number.isInteger(generation) || generation < 1 || generation >= profile.generation) throw new Error('请先停用插件，选择较早的数据代')
  await db.transaction('rw', [db.projects, db.worlds, db.works, db.extensionProfiles, db.extensionRecords, db.extensionContracts, db.extensionOperations, db.extensionPackages], async () => {
    await assertExtensionScope(profile)
    const current = await db.extensionProfiles.get(profile.id!)
    if (!current || current.enabled || current.revision !== profile.revision) throw new Error('配置已变化，恢复取消')
    const operations = await db.extensionOperations.where('profileId').equals(profile.id!).toArray()
    const receipt = operations.find(row => row.toGeneration === generation && ['enable', 'migrate', 'restore-generation'].includes(row.kind))
    const contract = receipt && await db.extensionContracts.where('[profileId+digest]').equals([profile.id!, receipt.toDigest]).first()
    if (!contract) throw new Error('缺少该数据代的版本契约，无法自动恢复')
    const rows = (await db.extensionRecords.where('profileId').equals(profile.id!).toArray()).filter(row => row.generation === generation)
    for (const row of rows) {
      const schema = contract.manifest.schemas[row.schemaId]
      if (!schema || schema.version !== row.schemaVersion) throw new Error('旧数据与契约不匹配')
      validateData(schema.schema, row.payload)
    }
    const nextGeneration = current.generation + 1
    await db.extensionRecords.bulkAdd(rows.map(row => ({ ...row, id: undefined, generation: nextGeneration, revision: 1, updatedAt: Date.now() })))
    await db.extensionProfiles.update(profile.id!, { digest: contract.digest, version: contract.manifest.version, generation: nextGeneration, revision: current.revision + 1, updatedAt: Date.now() })
    await db.extensionOperations.add({ ...scopeOf(current), profileId: profile.id!, kind: 'restore-generation', fromGeneration: current.generation, toGeneration: nextGeneration, fromDigest: current.digest, toDigest: contract.digest, detail: `从数据代 ${generation} 复制恢复；较新的内容仍然保留`, createdAt: Date.now() })
  })
}
