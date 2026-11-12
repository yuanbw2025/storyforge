import { assembleContext } from '../registry/assemble-context'
import { FIELD_BY_TARGET } from '../registry/field-registry'
import { REGISTRY_BY_NAME } from '../registry/project-tables'
import { historicalCanonFieldPolicyHashV1 } from '../context-gateway/canon-provider'
import { isPortableResourceUidV1 } from '../context-gateway/resource-uid'
import type { RagOriginalFieldV1 } from '../retrieval/rag-library'
import type { RagAnnotationTargetStateV1 } from '../types/rag-library'
import { deriveNarrativeTargetStateV1 } from '../retrieval/narrative-target-state'
import type { WorkspaceScope } from '../types/world-ownership'
import type { NarrativeOwnerV1 } from '../types/narrative-ir'
import type { NarrativeDomainFieldsV1, NarrativeSourceFkV1 } from '../types/narrative-domain'
import { NARRATIVE_SOURCE_FKS_V1 } from '../types/narrative-domain'
import { mapNarrativeDomainReferencesV1, parseNarrativeDomainFieldV1, type NarrativeDomainFieldV1 } from '../narrative-domain/codec'
import { narrativeDomainReferenceTargetV1, portableNarrativeDomainFieldJsonV1 } from '../narrative-domain/references'
import { captureNarrativeDomainV1, hashNarrativeDomainSourceV1, type NarrativeDomainCaptureV1, type NarrativeDomainRowV1, resolveNarrativeDomainGroupV1 } from './narrative-domain-capture'
import { compileNarrativeDomainEvidenceV1, resolveNarrativeDomainReferenceV1 } from './narrative-domain-evidence'
import { projectNarrativeDomainCaptureV1 } from './narrative-domain-projection'
import { canonicalNarrativeJsonV1, compareUnicodeCodePointsV1, hashNarrativeBytesV1, hashNarrativeValueV1, narrativeFail } from './narrative-json'

export interface NarrativeCandidateSelectionV1 {
  table: string
  sourceUid: string
  owner: NarrativeOwnerV1
  entryKeys: string[]
  worldGroupUid?: string | null
}
export interface NarrativeCandidateSourceV1 { table: string; sourceUid: string; sourceHash: string; policyHash: string }
export interface NarrativeCandidateBaselineV1 {
  worldCode: string
  workCode: string
  sources: NarrativeCandidateSourceV1[]
  originalFields: RagOriginalFieldV1[]
  /** Absent in legacy v3 candidates; not included in quoted original fields. */
  targetState?: RagAnnotationTargetStateV1
}
export interface NarrativeAnnotationProposalV1 {
  annotations: Record<string, unknown>
  clearFields: NarrativeDomainFieldV1[]
}
export interface PreparedNarrativeCandidateV1 {
  selection: NarrativeCandidateSelectionV1
  baseline: NarrativeCandidateBaselineV1
  baselineHash: string
  capture: NarrativeDomainCaptureV1
  assembled: Awaited<ReturnType<typeof assembleContext>>
  catalogReadRestarts: number
}

/** These are the payloads required by the registered projector, not inferred
 * narrative content. A missing payload must be supplied or reviewed explicitly. */
export function narrativeAnnotationTargetContractV1(table: string) {
  const projector = REGISTRY_BY_NAME.get(table)?.worldSemantic?.projector
  if (!projector) narrativeFail('candidate-target', '目标尚未登记叙事注释投影')
  const requiredPayloads: Partial<Record<typeof projector.kind, NarrativeDomainFieldV1>> = {
    event: 'narrativeEventV1', 'epistemic-event': 'narrativeEpistemicV1',
    development: 'narrativeDevelopmentsV1', disclosure: 'narrativeDisclosuresV1',
  }
  return { semanticKind: projector.kind, requiredPayload: requiredPayloads[projector.kind] ?? null }
}

export function findNarrativeCandidateSourceV1(capture: NarrativeDomainCaptureV1, table: string, sourceUid: string) {
  const spec = REGISTRY_BY_NAME.get(table)
  if (!spec?.resourceIdentity || !spec.worldSemantic
    || !isPortableResourceUidV1(sourceUid, spec.resourceIdentity.resourceKind)) narrativeFail('candidate-source', '来源没有登记语义域或稳定身份')
  const peers = capture.peers.get(table)?.filter(row => row[spec.resourceIdentity!.field] === sourceUid) ?? []
  const rows = capture.rows.get(table)?.filter(row => row[spec.resourceIdentity!.field] === sourceUid) ?? []
  if (peers.length !== 1 || rows.length !== 1) narrativeFail('candidate-scope', '来源不存在、身份冲突或不属于当前作用域')
  return rows[0]
}

async function candidateSourceHash(capture: NarrativeDomainCaptureV1, table: string, row: NarrativeDomainRowV1, fields: readonly RagOriginalFieldV1[]) {
  if (REGISTRY_BY_NAME.get(table)?.worldSemantic?.projector) return hashNarrativeDomainSourceV1(capture, table, row)
  const sourceUid = row[REGISTRY_BY_NAME.get(table)!.resourceIdentity!.field]
  const originals = fields.filter(field => field.table === table && field.sourceUid === sourceUid).map(field => {
    const name = field.fieldPointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~')
    if (typeof row[name] !== 'string') narrativeFail('candidate-stale', '选定原文已不存在')
    return { pointer: field.fieldPointer, text: row[name] }
  }).sort((a, b) => compareUnicodeCodePointsV1(a.pointer, b.pointer))
  return hashNarrativeValueV1({ version: 1, table, sourceUid, worldCode: capture.worldCode, workCode: capture.workCode,
    worldGroupUid: resolveNarrativeDomainGroupV1(capture, table, row)?.ragDocumentId ?? null, originals })
}

export async function prepareNarrativeCandidateV1(input: { scope: WorkspaceScope; selection: NarrativeCandidateSelectionV1;
  /** Only legacy candidate revision uses the original context contract. */
  includeTargetState?: boolean
}): Promise<PreparedNarrativeCandidateV1> {
  // Detach the request before the first await: UI edits cannot change a pending read.
  const selection = JSON.parse(canonicalNarrativeJsonV1(input.selection)) as NarrativeCandidateSelectionV1
  if (!selection.entryKeys.length) narrativeFail('candidate-selection', '请明确选择抽取原文')
  const capture = await captureNarrativeDomainV1({ scope: input.scope, owner: selection.owner })
  if (!REGISTRY_BY_NAME.get(selection.table)?.worldSemantic?.projector) narrativeFail('candidate-target', '目标尚未登记叙事注释投影')
  const target = findNarrativeCandidateSourceV1(capture, selection.table, selection.sourceUid)
  selection.worldGroupUid ??= resolveNarrativeDomainGroupV1(capture, selection.table, target)?.ragDocumentId as string | null | undefined ?? null
  const group = selection.worldGroupUid == null ? null : capture.rows.get('worldGroups')?.find(row => row.ragDocumentId === selection.worldGroupUid)
  if (selection.worldGroupUid && !group) narrativeFail('candidate-group', '所选子世界不存在')
  const assembled = await assembleContext({ projectId: input.scope.projectId, scope: input.scope,
    worldGroupId: group?.id as number | null ?? null, sourceKeys: ['ragSelection'], ragReadMode: 'original-evidence-v1',
    ...(input.includeTargetState === false ? {} : { ragAnnotationTarget: { table: selection.table, sourceUid: selection.sourceUid } }),
    ragEntryKeys: selection.entryKeys, inputBudgetTokens: 12_000 })
  const source = assembled.sourceEvidence?.find(item => item.key === 'ragSelection')
  if (source?.status !== 'included' || source.delivery !== 'full') narrativeFail('candidate-context', '抽取原文未完整提供')
  const transport = JSON.parse(assembled.text) as { version: number; fields: RagOriginalFieldV1[]; catalogReadRestarts: number; targetState?: RagAnnotationTargetStateV1 }
  if (transport.version !== 1 || !Array.isArray(transport.fields) || transport.fields.length !== selection.entryKeys.length) narrativeFail('candidate-context', '登记原文闭集不完整')
  if (![0, 1].includes(transport.catalogReadRestarts)) narrativeFail('candidate-context', '目录读取次数超过合同上限')
  const originalFields = transport.fields
  if (!originalFields.some(field => field.table === selection.table && field.sourceUid === selection.sourceUid)) {
    narrativeFail('candidate-target', '抽取目标必须包含在明确选择的原文中')
  }
  const identities = new Map(originalFields.map(field => [field.table + ':' + field.sourceUid, { table: field.table, sourceUid: field.sourceUid }]))
  const sources: NarrativeCandidateSourceV1[] = []
  for (const source of identities.values()) {
    const row = findNarrativeCandidateSourceV1(capture, source.table, source.sourceUid)
    sources.push({ ...source, sourceHash: await candidateSourceHash(capture, source.table, row, originalFields),
      policyHash: await hashNarrativeValueV1({ policy: row.ragPolicy ?? {} }) })
  }
  sources.sort((a, b) => compareUnicodeCodePointsV1(a.table + ':' + a.sourceUid, b.table + ':' + b.sourceUid))
  if (input.includeTargetState !== false && (!transport.targetState
    || canonicalNarrativeJsonV1(transport.targetState) !== canonicalNarrativeJsonV1(deriveNarrativeTargetStateV1({ table: selection.table, sourceUid: selection.sourceUid }, target)))) {
    narrativeFail('candidate-stale', '目标既有注释在读取期间变化，请重新审阅')
  }
  const baseline = { worldCode: capture.worldCode, workCode: capture.workCode, sources, originalFields,
    ...(transport.targetState ? { targetState: transport.targetState } : {}) }
  // Re-read after the provider calls; a capture and its raw source must be one version.
  const current = await captureNarrativeDomainV1({ scope: input.scope, owner: selection.owner })
  await assertNarrativeCandidateBaselineV1(current, baseline)
  return { selection, baseline, baselineHash: await hashNarrativeValueV1(baseline), capture: current, assembled,
    catalogReadRestarts: transport.catalogReadRestarts }
}

/** Exact compatibility with saved field digests written before Canon began
 * including source dependencies. The caller already performed today's governed
 * read. Every other field, source, actual byte, grant and owner remains bound. */
export async function matchesSavedNarrativeBaselineV1(prepared: PreparedNarrativeCandidateV1, savedHash: string) {
  if (prepared.baselineHash === savedHash) return true
  const originalFields = await Promise.all(prepared.baseline.originalFields.map(async field => {
    const row = findNarrativeCandidateSourceV1(prepared.capture, field.table, field.sourceUid)
    const prefix = field.sourceUid + '::'
    if (!field.key.startsWith(prefix)) narrativeFail('candidate-selection', '选定原文的身份和字段不匹配')
    return { ...field, policyHash: await historicalCanonFieldPolicyHashV1(row, field.key.slice(prefix.length)) }
  }))
  return await hashNarrativeValueV1({ ...prepared.baseline, originalFields }) === savedHash
}

export async function assertNarrativeCandidateBaselineV1(capture: NarrativeDomainCaptureV1, baseline: NarrativeCandidateBaselineV1) {
  if (capture.worldCode !== baseline.worldCode || capture.workCode !== baseline.workCode) narrativeFail('candidate-owner', '候选不能跨世界或作品采纳')
  for (const source of baseline.sources) {
    const row = findNarrativeCandidateSourceV1(capture, source.table, source.sourceUid)
    if (await candidateSourceHash(capture, source.table, row, baseline.originalFields) !== source.sourceHash) narrativeFail('candidate-stale', '候选的来源或注释已变化，请重新审阅')
    if (await hashNarrativeValueV1({ policy: row.ragPolicy ?? {} }) !== source.policyHash) narrativeFail('candidate-policy', '候选的来源读取策略已变化')
  }
  for (const field of baseline.originalFields) {
    const row = findNarrativeCandidateSourceV1(capture, field.table, field.sourceUid)
    const name = field.fieldPointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~')
    const policy = row.ragPolicy as { enabled?: boolean; fields?: Record<string, { enabled?: boolean }> } | undefined
    if (policy?.enabled === false || policy?.fields?.[name]?.enabled === false) narrativeFail('candidate-policy', '候选的原文读取授权已停用')
    // The projector hash covers semantic fields, not every field explicitly
    // selected as model input. Recheck those raw bytes at every resume/adoption
    // boundary, including registered descriptions outside the old IR schema.
    if (typeof row[name] !== 'string' || await hashNarrativeBytesV1(row[name] as string) !== field.contentHash) {
      narrativeFail('candidate-stale', '候选的已选原文已变化，请重新审阅')
    }
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) narrativeFail('candidate-shape', '候选必须是对象')
  return value as Record<string, unknown>
}
function exact(value: Record<string, unknown>, keys: readonly string[]) {
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.prototype.hasOwnProperty.call(value, key))) narrativeFail('candidate-shape', '候选字段不符合闭集合同')
}
function rejectSystemFields(value: unknown): void {
  if (Array.isArray(value)) { value.forEach(rejectSystemFields); return }
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (['id', 'projectId', 'worldId', 'workId', 'narrativeAuthorityV1', 'confirmationUid', 'contentHash', 'confirmedAt'].includes(key)) {
      narrativeFail('candidate-authority', '模型或编辑草稿不能携带本地身份或系统确认凭据')
    }
    if (key in NARRATIVE_SOURCE_FKS_V1 && child !== null) narrativeFail('candidate-coordinate', '候选引用只能携带稳定 UID，不能携带本地编号')
    rejectSystemFields(child)
  }
}

/** Model evidence supplies a quote, not a fabricated hash or byte coordinate.
 * Exact occurrence selection is explicit; repeated quotes are never guessed. */
async function compileQuoteEvidence(value: unknown, selection: NarrativeCandidateSelectionV1, baseline: NarrativeCandidateBaselineV1): Promise<unknown> {
  if (Array.isArray(value)) return Promise.all(value.map(item => compileQuoteEvidence(item, selection, baseline)))
  if (!value || typeof value !== 'object') return value
  const row = object(value)
  if ('evidenceKey' in row && 'quote' in row) {
    exact(row, ['evidenceKey', 'source', 'fieldPointer', 'quote', 'occurrence', 'supportRole'])
    if (typeof row.quote !== 'string' || !row.quote.length || !Number.isSafeInteger(row.occurrence) || (row.occurrence as number) < 0) narrativeFail('candidate-quote', '证据必须是非空逐字引文并指定出现序号')
    const source = object(row.source)
    let table = selection.table, uid = selection.sourceUid
    if (source.self !== true) {
      const fk = Object.keys(NARRATIVE_SOURCE_FKS_V1).find(key => Object.prototype.hasOwnProperty.call(source, key)) as NarrativeSourceFkV1 | undefined
      if (!fk) narrativeFail('candidate-reference', '证据来源必须是分类型稳定引用')
      exact(source, [fk, 'sourceUid'])
      table = NARRATIVE_SOURCE_FKS_V1[fk].table; uid = source.sourceUid as string
    } else exact(source, ['self'])
    const field = baseline.originalFields.find(item => item.table === table && item.sourceUid === uid && item.fieldPointer === row.fieldPointer)
    if (!field) narrativeFail('candidate-evidence', '证据未在本次登记原文闭集中')
    let offset = -1
    for (let index = 0; index <= (row.occurrence as number); index++) {
      offset = field.text.indexOf(row.quote, offset + 1)
      if (offset === -1) narrativeFail('candidate-quote', '逐字引文或出现序号与原文不符')
    }
    const start = new TextEncoder().encode(field.text.slice(0, offset)).length
    return { evidenceKey: row.evidenceKey, source: row.source, fieldPointer: row.fieldPointer,
      sourceContentHash: field.contentHash, normalizationVersion: 'raw-utf8-v1', start,
      end: start + new TextEncoder().encode(row.quote).length, spanHash: await hashNarrativeBytesV1(row.quote), supportRole: row.supportRole }
  }
  const result: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(row)) {
    if (key === 'narrativeEvidenceV1' && (!Array.isArray(child) || child.some(item => !item || !Object.prototype.hasOwnProperty.call(item, 'quote')))) {
      narrativeFail('candidate-evidence', '候选证据必须使用逐字引文，不能自报哈希或坐标')
    }
    result[key] = await compileQuoteEvidence(child, selection, baseline)
  }
  return result
}

export async function compileNarrativeAnnotationProposalV1(input: {
  raw: string
  selection: NarrativeCandidateSelectionV1
  baseline: NarrativeCandidateBaselineV1
  capture: NarrativeDomainCaptureV1
  /** Keys allocated in a persisted candidate, in addition to the target's existing children. */
  allowedSubKeys?: readonly string[]
}): Promise<{ proposal: NarrativeAnnotationProposalV1; annotations: Partial<NarrativeDomainFieldsV1>; portableAnnotations: Record<string, unknown>; subKeys: string[] }> {
  const root = object(JSON.parse(input.raw))
  canonicalNarrativeJsonV1(root)
  exact(root, ['annotations', 'clearFields'])
  rejectSystemFields(root)
  const annotations = object(root.annotations)
  const fields = FIELD_BY_TARGET.get(input.selection.table)?.filter(field => field.adoptionPolicy === 'narrative-annotation-v1').map(field => field.field as NarrativeDomainFieldV1) ?? []
  if (!Object.keys(annotations).length && !(Array.isArray(root.clearFields) && root.clearFields.length)) narrativeFail('candidate-empty', '候选没有可审核的修改')
  if (Object.keys(annotations).some(field => !fields.includes(field as NarrativeDomainFieldV1))) narrativeFail('candidate-field', '候选包含未登记注释字段')
  if (!Array.isArray(root.clearFields) || root.clearFields.some(field => typeof field !== 'string' || !fields.includes(field as NarrativeDomainFieldV1) || field in annotations)
    || new Set(root.clearFields).size !== root.clearFields.length) narrativeFail('candidate-clear', '清除字段必须已登记且不能与写入重复')
  const subKeys: string[] = []
  const target = findNarrativeCandidateSourceV1(input.capture, input.selection.table, input.selection.sourceUid)
  for (const field of ['narrativeDevelopmentsV1', 'narrativeDisclosuresV1']) {
    const children = annotations[field]
    if (children === undefined) continue
    if (!Array.isArray(children)) narrativeFail('candidate-children', '子记录必须是数组')
    const existing = (target[field] as Array<{ semanticSubKey: string }> | undefined) ?? []
    const allowed = new Set([...existing.map(child => child.semanticSubKey), ...(input.allowedSubKeys ?? [])])
    for (const child of children) {
      const row = object(child)
      if ('semanticSubKey' in row && !allowed.has(row.semanticSubKey as string)) narrativeFail('candidate-subkey', '模型不能签发或替换子记录身份')
      if (!('semanticSubKey' in row) && existing.length) narrativeFail('candidate-subkey', '已有子记录必须保留稳定身份；不能根据文字重建身份，请保留此字段或明确选择原子记录')
      row.semanticSubKey ??= 'sub:v1:' + crypto.randomUUID()
      subKeys.push(row.semanticSubKey as string)
    }
  }
  if (new Set(subKeys).size !== subKeys.length) narrativeFail('candidate-subkey', '子记录身份重复')
  const proposal = { annotations, clearFields: root.clearFields as NarrativeDomainFieldV1[] }
  const quoted = object(await compileQuoteEvidence(annotations, input.selection, input.baseline))
  const local: Partial<NarrativeDomainFieldsV1> = {}, portableAnnotations: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(quoted)) {
    const decoded = parseNarrativeDomainFieldV1(field as NarrativeDomainFieldV1, value)
    const mapped = mapNarrativeDomainReferencesV1(field as NarrativeDomainFieldV1, decoded, reference => {
      const target = narrativeDomainReferenceTargetV1(reference)
      if (!input.baseline.sources.some(source => source.table === target.table && source.sourceUid === target.sourceUid)) narrativeFail('candidate-reference', '引用超出本次原文闭集')
      const row = findNarrativeCandidateSourceV1(input.capture, target.table, target.sourceUid)
      return { [target.field]: row.id, sourceUid: target.sourceUid } as typeof reference
    })
    Object.assign(local, { [field]: mapped })
    portableAnnotations[field] = JSON.parse(portableNarrativeDomainFieldJsonV1(field as NarrativeDomainFieldV1, mapped))
  }
  const next: NarrativeDomainRowV1 = { ...target, ...local }
  for (const field of proposal.clearFields) delete next[field]
  const { semanticKind, requiredPayload } = narrativeAnnotationTargetContractV1(input.selection.table)
  if (requiredPayload && (next[requiredPayload] == null
    || (Array.isArray(next[requiredPayload]) && !(next[requiredPayload] as unknown[]).length))) {
    narrativeFail('candidate-required-payload', `${input.selection.table} 的 ${semanticKind} 投影必须包含 ${requiredPayload}；请按该字段的完整结构补充有原文支持的注释。未知来源事件或修正前记录用 null，不能只给通用性质或证据。`)
  }
  for (const field of fields) if (next[field] !== undefined) {
    mapNarrativeDomainReferencesV1(field, next[field], reference => { resolveNarrativeDomainReferenceV1(input.capture, reference); return reference })
  }
  for (const group of [next, ...(next.narrativeDevelopmentsV1 ?? []), ...(next.narrativeDisclosuresV1 ?? [])]) {
    for (const evidence of group.narrativeEvidenceV1 ?? []) await compileNarrativeDomainEvidenceV1(input.capture, input.selection.table, next, evidence, evidence.evidenceKey)
  }
  // Exercise the same deterministic semantics that downstream readers use.
  // This ephemeral receipt is never returned or persisted as author approval.
  const preview: NarrativeDomainRowV1 = { ...next, narrativeAuthorityV1: { version: 1,
    confirmationUid: 'confirmation:v1:00000000-0000-4000-8000-000000000001', mode: 'candidate-adoption',
    confirmedAt: Date.now(), contentHash: await hashNarrativeDomainSourceV1(input.capture, input.selection.table, next) } }
  const rows = new Map(input.capture.rows)
  rows.set(input.selection.table, rows.get(input.selection.table)!.map(row => row.id === target.id ? preview : row))
  const projection = await projectNarrativeDomainCaptureV1({ ...input.capture, rows }, { branchKey: 'canon' })
  const sourceKey = REGISTRY_BY_NAME.get(input.selection.table)!.resourceIdentity!.contextKind + ':' + input.selection.sourceUid
  const gaps = projection.coverage.gaps.filter(gap => gap.sourceKey === sourceKey)
  if (gaps.length || !projection.coverage.projectedSourceKeys.includes(sourceKey)) {
    narrativeFail('candidate-projection', gaps.map(gap => gap.detail).join('；') || '候选不能形成可用的领域语义，请补全来源或注释')
  }
  return { proposal, annotations: local, portableAnnotations, subKeys }
}
