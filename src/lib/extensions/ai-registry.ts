import Dexie from 'dexie'
import { db } from '../db/schema'
import { canonicalStringify, hashCanonicalValue } from '../agent/run/hash'
import type { AdoptInput, AdoptResult, AssembleContextInput } from '../registry/types'
import { parseManifest } from './package'
import { checkActiveProfile, listExtensionRecords, putExtensionRecord } from './store'
import { isObject, validateData } from './schema'
import { domainScope } from './domain'
import type { ExtensionProfile, ExtensionRegistrySnapshot } from './types'

export async function freezeExtensionRegistry(profileId: number, taskId: string, recordKey: string): Promise<ExtensionRegistrySnapshot> {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(recordKey)) throw new Error('AI 目标记录键无效')
  const profile = await db.extensionProfiles.get(profileId)
  if (!profile) throw new Error('插件配置不存在')
  await checkActiveProfile(profile)
  const contract = await db.extensionContracts.where('profileId').equals(profileId).filter(row => row.digest === profile.digest).first()
  if (!contract) throw new Error('插件冻结声明缺失')
  const manifest = parseManifest(contract.manifest)
  if (!manifest.aiTasks?.some(task => task.id === taskId)) throw new Error('AI 任务未声明')
  const record = (await listExtensionRecords(profile)).find(row => row.key === recordKey)
  const body = { version: 1 as const, profile, manifest, taskId, recordKey, expectedRevision: record?.revision ?? null }
  return { ...body, hash: await hashCanonicalValue(body) }
}

/** Integrity is readable without installed code. Current authority is checked separately. */
export async function verifyExtensionRegistry(snapshot: ExtensionRegistrySnapshot): Promise<void> {
  const { hash, ...body } = snapshot
  if (snapshot.version !== 1 || hash !== await Dexie.waitFor(hashCanonicalValue(body))) throw new Error('插件注册快照校验失败')
  const manifest = parseManifest(snapshot.manifest)
  if (manifest.id !== snapshot.profile.pluginId || manifest.version !== snapshot.profile.version || !manifest.aiTasks?.some(task => task.id === snapshot.taskId)) throw new Error('插件快照身份不一致')
}
export async function assertCurrentExtensionRegistry(snapshot: ExtensionRegistrySnapshot): Promise<ExtensionProfile> {
  await verifyExtensionRegistry(snapshot)
  const profile = await checkActiveProfile(snapshot.profile)
  const contract = await db.extensionContracts.where('profileId').equals(profile.id!).filter(row => row.digest === profile.digest).first()
  if (!contract || await Dexie.waitFor(hashCanonicalValue(contract.manifest)) !== await Dexie.waitFor(hashCanonicalValue(snapshot.manifest))) throw new Error('插件声明已变化')
  return profile
}
export async function readExtensionContext(input: AssembleContextInput): Promise<string> {
  const snapshot = input.extensionSnapshot
  if (!snapshot || !input.scope) throw new Error('读取插件上下文需要冻结任务与明确作用域')
  const profile = await assertCurrentExtensionRegistry(snapshot)
  const scope = await domainScope(profile)
  if (scope.projectId !== input.scope.projectId || scope.worldId !== input.scope.worldId || scope.workId !== input.scope.workId) throw new Error('插件上下文越界')
  const rows = await listExtensionRecords(profile)
  const content = canonicalStringify({ task: snapshot.manifest.aiTasks!.find(task => task.id === snapshot.taskId), schemas: snapshot.manifest.schemas, records: rows.sort((a,b) => a.key.localeCompare(b.key)).map(row => ({ key: row.key, schemaId: row.schemaId, revision: row.revision, payload: row.payload })) })
  if (content.length > 64000) throw new Error('插件上下文超过 64000 字符，请在独立作用域拆分任务；不会静默截断')
  return content
}
export async function adoptExtensionPayload(input: AdoptInput): Promise<AdoptResult> {
  const snapshot = input.extensionSnapshot
  if (!snapshot || !input.scope || !isObject(input.data) || Object.keys(input.data).some(key => key !== 'payload') || input.mode !== 'add' || input.recordId != null || input.compareAndSet) throw new Error('插件采纳必须绑定冻结任务，仅接受 payload')
  const profile = await assertCurrentExtensionRegistry(snapshot)
  const scope = await domainScope(profile)
  if (scope.projectId !== input.scope.projectId || scope.worldId !== input.scope.worldId || scope.workId !== input.scope.workId) throw new Error('插件采纳作用域不一致')
  const task = snapshot.manifest.aiTasks!.find(task => task.id === snapshot.taskId)!
  validateData(snapshot.manifest.schemas[task.outputSchema].schema, input.data.payload)
  const row = await putExtensionRecord(profile, snapshot.manifest, { key: snapshot.recordKey, schemaId: task.outputSchema, payload: input.data.payload, expectedRevision: snapshot.expectedRevision })
  return { written: [{ id: row.id!, fields: ['payload'] }], unknown: [], typeErrors: [], fkErrors: [], skipped: [] }
}
