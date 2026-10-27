/** Portable evidence of a real frozen-world read; never substitutes a new context read. */
import { db } from '../db/schema'
import { hashCanonicalValue, canonicalStringify } from '../agent/run/hash'
import { readAgentRunV1, type AgentRunSnapshotV1 } from '../agent/run/event-store'
import { readAgentRunArtifactExactV1 } from '../memory/artifact-store'
import { readContextGatewayManifestV3ForAttemptV1 } from '../context-gateway/attempt-evidence'
import { describeWorldSemanticReleaseV1 } from '../context-gateway/world-release-client'
import { createWorldReferenceV1, resolveWorldReferenceResourceScopeV1, WorldReferenceErrorV1 } from '../world-engine/world-reference'

interface PortableWorldContextBindingV1 {
  schema: 'storyforge.portable-world-context-binding'; version: 1
  manifestHash: string; sourceScopeFingerprint: string; worldReleaseUid: string; worldReleaseHash: string; bindingHash: string
}
const HASH = /^[a-f0-9]{64}$/
async function parseBindings(json: string | undefined): Promise<PortableWorldContextBindingV1[]> {
  if (json === undefined) return []
  if (typeof json !== 'string' || json.length > 8000000) throw new Error('[world-context-portability] 世界读取证明超过便携预算')
  const rows: unknown = JSON.parse(json)
  if (!Array.isArray(rows) || rows.length > 10000) throw new Error('[world-context-portability] 世界读取证明必须有界')
  const result: PortableWorldContextBindingV1[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('[world-context-portability] 世界读取证明损坏')
    const value = row as PortableWorldContextBindingV1
    const keys = ['schema','version','manifestHash','sourceScopeFingerprint','worldReleaseUid','worldReleaseHash','bindingHash'].sort()
    if (Object.keys(value).sort().join() !== keys.join() || value.schema !== 'storyforge.portable-world-context-binding' || value.version !== 1
      || ![value.manifestHash,value.sourceScopeFingerprint,value.worldReleaseHash,value.bindingHash].every(v => typeof v === 'string' && HASH.test(v))
      || typeof value.worldReleaseUid !== 'string' || !value.worldReleaseUid.trim() || value.worldReleaseUid.length > 512) throw new Error('[world-context-portability] 世界读取证明字段不合法')
    const { bindingHash,...body } = value
    if (bindingHash !== await hashCanonicalValue(body)) throw new Error('[world-context-portability] 世界读取证明 hash 不一致')
    if (result.some(r => r.manifestHash === value.manifestHash)) throw new Error('[world-context-portability] 世界读取证明重复')
    result.push(value)
  }
  return result
}
export async function assertPortableWorldContextBindingsV1(json: string | undefined): Promise<void> {
  await parseBindings(json)
}
function importedAndReverified(snapshot: AgentRunSnapshotV1) {
  if (snapshot.projection.state !== 'completed') return false
  const stale = [...snapshot.events].reverse().find(e => e.type === 'verification.staled')
  if (stale?.type !== 'verification.staled' || stale.payload.reason !== 'project-import-scope-rebound') return false
  const started = snapshot.events.find(e => e.sequence > stale.sequence && e.type === 'verification.started' && e.payload.verifierSetVersion === 'product-production-task-import-rebind-v1')
  return !!started && snapshot.events.some(e => e.sequence > started.sequence && e.type === 'verification.accepted'
    && e.payload.receiptHash === stale.payload.previousReceiptHash && e.payload.receiptHash === snapshot.projection.terminalReceiptHash)
}

/** Export-time authority: resolve the actual original local scope before IDs are removed. */
export async function freezeTtrpgWorldContextBindingsForExportV1(runId: number): Promise<string | undefined> {
  const row = await db.agentRuns.get(runId)
  if (!row?.productBuildId || row.workId == null) return row?.portableWorldContextBindingsJson
  const build = await db.productBuilds.get(row.productBuildId), work = await db.works.get(row.workId)
  const production = build && await db.productProductions.get(build.productionId)
  if (production?.productType !== 'ttrpg' || !work) return row.portableWorldContextBindingsJson
  const scope = { projectId: row.projectId,worldId: work.worldId,workId: row.workId }
  const snapshot = await readAgentRunV1(scope,runId), bindings = await parseBindings(row.portableWorldContextBindingsJson)
  const imported = snapshot.events.some(e => e.type === 'verification.staled' && e.payload.reason === 'project-import-scope-rebound')
  for (const event of snapshot.events) if (event.type === 'context.assembled') {
    const refs = snapshot.events.filter(e => e.type === 'evidence.artifact.recorded' && e.payload.artifactKind === 'context-manifest'
      && e.payload.stepId === event.payload.stepId && e.payload.attempt === event.payload.attempt)
    let version3 = false
    for (const ref of refs) if (ref.type === 'evidence.artifact.recorded') {
      const body = await readAgentRunArtifactExactV1({ projectId: row.projectId,artifactKind: 'context-manifest',contentHash: ref.payload.contentHash })
      const parsed = JSON.parse(body)
      if (parsed.version === 3 && parsed.manifestHash === event.payload.manifestHash) version3 = true
    }
    if (!version3) continue
    const { manifest } = await readContextGatewayManifestV3ForAttemptV1({ scope,runId,stepId: event.payload.stepId,attempt: event.payload.attempt })
    const trace = manifest.gateway.retrievalTrace
    const decisions = [...trace.mandatory,...trace.autoSelected,...trace.agentReads].filter(d => d.sourceKey === 'worldRelease')
    if (!decisions.length) continue
    const previous = bindings.find(b => b.manifestHash === manifest.manifestHash)
    if (previous && importedAndReverified(snapshot)) continue
    const refsForWorld = decisions.flatMap(d => d.sourceRefs)
    const ids = new Set(refsForWorld.map(r => r.recordId))
    if (refsForWorld.some(r => r.table !== 'worldReleases') || ids.size !== 1) throw new Error('[world-context-portability] 世界读取来源不唯一')
    const reference = await createWorldReferenceV1(Number(refsForWorld[0].recordId)).catch(error => {
      if (imported && error instanceof WorldReferenceErrorV1 && error.code === 'release-missing') return null
      throw error
    })
    if (!reference) continue // Older backups stay exportable; absence never grants publication authority.
    const sourceScope = await resolveWorldReferenceResourceScopeV1(reference)
    const fingerprint = (await describeWorldSemanticReleaseV1({ localReleaseRecordId: reference.localReleaseRecordId,
      expectedProjectId: sourceScope.projectId,expectedWorldId: sourceScope.worldId })).description.scopeFingerprint
    const uid = reference.releaseUid
    if (fingerprint !== manifest.gateway.scopeFingerprint || refsForWorld.some(r => r.revision !== uid)) {
      if (imported) continue
      throw new Error('[world-context-portability] 原 Context Manifest 与世界版本不闭合')
    }
    const body = { schema: 'storyforge.portable-world-context-binding' as const,version: 1 as const,manifestHash: manifest.manifestHash,
      sourceScopeFingerprint: fingerprint,worldReleaseUid: uid,worldReleaseHash: reference.releaseHash }
    const binding = { ...body,bindingHash: await hashCanonicalValue(body) }
    if (previous && previous.bindingHash !== binding.bindingHash) throw new Error('[world-context-portability] 同一读取证明发生漂移')
    if (!previous) bindings.push(binding)
  }
  return bindings.length ? canonicalStringify(bindings.sort((a,b) => a.manifestHash.localeCompare(b.manifestHash))) : undefined
}

export async function verifyImportedWorldContextBindingV1(input: {
  snapshot: AgentRunSnapshotV1; manifestHash: string; sourceScopeFingerprint: string; worldReleaseUid: string; worldReleaseHash: string
}): Promise<boolean> {
  if (!importedAndReverified(input.snapshot)) return false
  const bindings = await parseBindings(input.snapshot.run.portableWorldContextBindingsJson)
  return bindings.some(b => b.manifestHash === input.manifestHash && b.sourceScopeFingerprint === input.sourceScopeFingerprint
    && b.worldReleaseUid === input.worldReleaseUid && b.worldReleaseHash === input.worldReleaseHash)
}
