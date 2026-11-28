import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import { PowerAuthoringButtonV1 } from './PowerAuthoringControls'
import { useAuthorRecordSavesV1 } from '../shared/AuthorRecordSaveScope'
import type { LocalSaveIntentV1 } from '../../lib/authoring/local-save-evidence'
import { inputAreaLayoutV1 } from '../../lib/input-area-layout'
import { useWorldviewStore } from '../../stores/worldview'
import { useWorldGroupStore } from '../../stores/world-group'
import { InlineInput, InlineTextarea } from '../shared/InlineEdit'
import type { Project, PowerSystem } from '../../lib/types'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'

/** Structured rules belong to the origin/power editor. Keep record IDs stable for
 * character references, source manifests, impact receipts and backup round trips. */
export default function PowerSystemDetails({ project, initialRecordId, resizableInputs = false }: {
  project: Project
  resizableInputs?: boolean
  initialRecordId?: number | null
}) {
  const { powerSystem, powerSystems, savePowerSystem, loading, loadError, loadedScope } = useWorldviewStore()
  const activeGroupId = useWorldGroupStore(state => state.activeGroupId)
  const worldGroupId = project.enableMultiWorld ? activeGroupId : (powerSystem?.worldGroupId ?? null)
  const ready = !loading && !loadError && loadedScope != null && loadedScope.projectId === project.id && loadedScope.worldId === project.activeWorldId && loadedScope.workId === project.activeWorkId
  const scopeKey = `${project.id}:${project.activeWorldId}:${project.activeWorkId}:${worldGroupId}`
  const retained = useRef<PowerSystem[]>([])
  if (ready) retained.current = powerSystems
  const visible = ready ? powerSystems : retained.current
  const rows = useMemo(() => visible.filter(row => row.projectId === project.id && Reflect.get(row, 'worldId') === project.activeWorldId
    && (row.worldGroupId ?? null) === worldGroupId), [visible, project.id, project.activeWorldId, worldGroupId])
  const [choice, setChoice] = useState<{ key: string; id: number } | null>(null)
  const [error, setError] = useState('')
  const [selecting, setSelecting] = useState(false)
  const selectionRequest = useRef(0)
  const select = useCallback(async (id: number) => {
    const request = ++selectionRequest.current
    setError(''); setSelecting(true)
    try { await flushPendingEditsV1(); if (selectionRequest.current === request) setChoice({ key: scopeKey, id }) }
    catch (cause) { if (selectionRequest.current === request) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (selectionRequest.current === request) setSelecting(false) }
  }, [scopeKey])
  useEffect(() => { const pending = selectionRequest; setSelecting(false); return () => { pending.current++ } }, [scopeKey])
  const requestedId = choice?.key === scopeKey ? choice.id : initialRecordId ?? (rows.length === 1 ? rows[0].id! : null)
  useEffect(() => {
    if (ready && initialRecordId == null && choice?.key !== scopeKey && requestedId != null) setChoice({ key: scopeKey, id: requestedId })
  }, [ready, initialRecordId, scopeKey, choice?.key, requestedId])
  useEffect(() => { if (initialRecordId != null) void select(initialRecordId) }, [initialRecordId, select])
  const loadedRecord = rows.find(row => row.id === requestedId) ?? null
  const retainedRecord = useRef<{ key: string; row: PowerSystem } | null>(null)
  if (loadedRecord) retainedRecord.current = { key: scopeKey, row: loadedRecord }
  const record = loadedRecord ?? (retainedRecord.current?.key === scopeKey && retainedRecord.current.row.id === requestedId ? retainedRecord.current.row : null)
  const missing = ready && requestedId != null && !loadedRecord
  const ambiguous = rows.length > 1 && requestedId == null
  useInitialRecordTarget(initialRecordId, loadedRecord?.id === initialRecordId)
  const localSave = useAuthorRecordSavesV1('powerSystems', record)
  const save = (patch: Partial<PowerSystem>, confirmation?: LocalSaveIntentV1) => savePowerSystem({
    projectId: project.id!, worldGroupId, ...(requestedId != null ? { id: requestedId } : {}), ...patch,
  }, { projectId: project.id!, worldId: project.activeWorldId!, workId: project.activeWorkId! }, confirmation)
  return <fieldset
    disabled={!ready || selecting || (project.enableMultiWorld && activeGroupId == null)}
    aria-label="力量体系规则明细"
    {...initialRecordTargetAttributes(loadedRecord?.id === initialRecordId, loadedRecord?.id)}
    className={`mt-6 space-y-4 rounded-lg border border-border p-4 ${record?.id === initialRecordId ? INITIAL_RECORD_TARGET_CLASS : ''}`}
  >
    <legend className="px-2 text-base font-semibold">{record?.name || '力量体系规则'}</legend>
    <p className="text-xs text-text-muted">在同一处维护体系名称、等级与约束。已有明细原样保留；若与上方概述不一致，请核对后修改。</p>
    <p className="text-[11px] text-text-muted">概述、规则明细和成长路径各自保留原始来源。下方成长路径属于当前世界，与这里选中的规则记录没有父属关系。</p>
    {(rows.length > 1 || missing) && <label className="block text-xs">规则明细记录
      <select aria-label="选择力量规则明细" value={requestedId ?? ''} onChange={event => { void select(Number(event.target.value)) }} className="mt-1 w-full rounded-lg border border-border bg-bg-base px-3 py-2">
        <option value="" disabled>有 {rows.length} 条明细，请先明确选择</option>
        {missing && <option value={requestedId!} disabled>原记录 #{requestedId} 已删除或不在当前分区</option>}
        {rows.map(row => <option value={row.id} key={row.id}>{row.name || '未命名明细'} · #{row.id}</option>)}
      </select>
    </label>}
    {(error || missing) && <p role="alert" className="text-xs text-error">{error || '原规则记录已删除或不属于当前分区。原输入仍保留，请先处理未保存编辑，再明确选择其他记录。'}</p>}
    {ambiguous && <p className="text-xs text-text-muted">未选择目标，不会默认编辑第一条记录。</p>}
    <fieldset disabled={ambiguous || missing && !record} className="contents" aria-label="选定力量规则编辑">
    <div><h3 className="mb-1 text-sm font-medium">体系名称<PowerAuthoringButtonV1 target={loadedRecord?.id ? { table: 'powerSystems', recordId: loadedRecord.id, field: 'name' } : null}/></h3>
      <InlineInput value={record?.name ?? ''} localSave={localSave('name')} onChange={(name, intent) => save({ name }, intent)} placeholder="如：灵气修炼体系、魔法等级…"/>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">{([
      ['description', '规则明细·体系描述', '简述力量体系的核心原理…'],
      ['rules', '规则与代价', '修炼条件、突破瓶颈、禁忌…'],
    ] as const).map(([key, label, placeholder]) => <div key={key}>
      <h3 className="mb-1 text-sm font-medium">{label}<PowerAuthoringButtonV1 target={loadedRecord?.id ? { table: 'powerSystems', recordId: loadedRecord.id, field: key } : null}/></h3>
      <InlineTextarea markdownRead inputAreaLayout={inputAreaLayoutV1(resizableInputs, `power.${key}`)} value={record?.[key] ?? ''} localSave={localSave(key)} onChange={(value, intent) => save({ [key]: value }, intent)} placeholder={placeholder}/>
    </div>)}</div>
    <details className="text-xs text-text-muted"><summary>已有层级说明（独立保留）</summary>
      <p className="my-2">下方路径阶段图是阶段身份和前置关系的依据。这里保留已有文字说明；如与概览、规则或阶段图不一致，请核对来源后在对应字段裁决，不自动互相覆盖。</p>
      <InlineTextarea markdownRead inputAreaLayout={inputAreaLayoutV1(resizableInputs, 'power.levels')} value={record?.levels ?? ''} localSave={localSave('levels')} onChange={(levels, intent) => save({ levels }, intent)} placeholder="原有层级说明…"/>
    </details>
    </fieldset>
  </fieldset>
}
