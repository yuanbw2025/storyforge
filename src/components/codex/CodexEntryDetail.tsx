import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Star } from 'lucide-react'
import { CInput } from '../shared/CompositionInput'
import { InlineTextarea } from '../shared/InlineEdit'
import {
  codexEntryInWorld,
  codexCategoryFormatIssueV1,
  codexEntryFormatIssueV1,
  parseEntryFields,
  parseEntryRefs,
  parseFieldSchema,
  stringifyEntryFields,
  stringifyEntryRefs,
} from '../../lib/types/codex'
import type {
  CodexCategory,
  CodexEntry,
  CodexFieldDef,
} from '../../lib/types/codex'
import { parseCultivationStages } from '../../lib/types/cultivation'
import { useCultivationStore } from '../../stores/cultivation'
import { useLocationStore } from '../../stores/location'
import { useCodexEntryDraft, type SaveCodexDraft } from './useCodexEntryDraft'
import type { CodexLocalSaveContractV1 } from '../../lib/authoring/codex-local-save-evidence'
import { flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'

interface Props {
  entry: CodexEntry
  category: CodexCategory
  allCategories: CodexCategory[]
  allEntries: CodexEntry[]
  nameDuplicate?: boolean
  onChange: SaveCodexDraft
  localSave?: CodexLocalSaveContractV1
}

export default function CodexEntryDetail({
  entry: canonicalEntry,
  category,
  allCategories,
  allEntries,
  nameDuplicate,
  onChange: save,
  localSave,
}: Props) {
  const { draft: entry, change: onChange, saving, error, flush, composition, localSaveStatus } = useCodexEntryDraft(canonicalEntry, save, localSave)
  const sourceIdentity = `${canonicalEntry.projectId}:${canonicalEntry.id}:${canonicalEntry.ragDocumentId}`
  const [sourceDrafts, setSourceDrafts] = useState<{ identity: string; values: Record<string, string> }>({ identity: sourceIdentity, values: {} })
  const schema = useMemo(() => parseFieldSchema(category.fieldSchema), [category.fieldSchema])
  const fields = useMemo(() => parseEntryFields(entry.fields), [entry.fields])
  const refs = useMemo(() => parseEntryRefs(entry.refs), [entry.refs])
  const sourceDirty = sourceDrafts.identity === sourceIdentity && Object.entries(sourceDrafts.values).some(([key, value]) =>
    key === 'description' ? value !== entry.description
      : schema.some(definition => definition.type === 'longtext' && `field:${definition.key}` === key) && value !== (fields[key.slice(6)] ?? ''))
  const saveStatus = localSaveStatus === 'failed' || localSaveStatus === 'saving' ? localSaveStatus : sourceDirty ? 'dirty' : localSaveStatus
  const tags = useMemo(() => {
    try {
      const parsed = JSON.parse(entry.tags || '[]')
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }, [entry.tags])

  const issue = codexCategoryFormatIssueV1(category) || codexEntryFormatIssueV1(entry)
  if (issue) {
    let original: string
    try { original = JSON.stringify({ entry, fieldSchema: category.fieldSchema }, null, 2) } catch { original = '无法显示完整记录；请使用备份保留原数据。' }
    return <div role="alert" className="p-4 text-sm text-amber-400">词条格式异常：{issue}。原始数据已保留，编辑暂时关闭，请从有效备份恢复。
      <details><summary>查看原始词条</summary><pre className="whitespace-pre-wrap text-xs">{original}</pre></details>
    </div>
  }

  const saveLinkedPatch = (patch: Partial<CodexEntry>) => {
    onChange(patch)
    const operation = flush()
    void operation.catch(() => undefined)
    return operation
  }
  const setField = (key: string, value: string) => {
    onChange(latest => ({ fields: stringifyEntryFields({ ...parseEntryFields(latest.fields), [key]: value }) }))
  }
  const setRef = (key: string, ids: number[]) => {
    onChange(latest => ({ refs: stringifyEntryRefs({ ...parseEntryRefs(latest.refs), [key]: ids }) }))
  }

  return (
    <div className="p-4 space-y-3 max-w-2xl" {...composition}
      // Observe after the editor's input dispatch. A capture-phase state update
      // can restore the old controlled DOM value before React onChange reads it.
      onInput={event => {
        const target = event.target
        if (!(target instanceof HTMLTextAreaElement)) return
        const key = target.closest('[data-codex-source-field]')?.getAttribute('data-codex-source-field')
        if (key) {
          const raw = target.value
          setSourceDrafts(current => ({ identity: sourceIdentity, values: { ...(current.identity === sourceIdentity ? current.values : {}), [key]: raw } }))
        }
      }}
      onKeyDownCapture={event => {
        const target = event.target
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || !(target instanceof HTMLTextAreaElement)) return
        const key = target.closest('[data-codex-source-field]')?.getAttribute('data-codex-source-field')
        // Only a successfully closed source editor cancels this UI draft.
        // Failed/in-flight saves keep their textarea and remain visibly dirty.
        if (key) setTimeout(() => {
          if (!target.isConnected) setSourceDrafts(current => {
            if (current.identity !== sourceIdentity) return current
            const { [key]: _discarded, ...retained } = current.values
            return { identity: sourceIdentity, values: retained }
          })
        }, 0)
      }}>
      {localSave ? <p role="status" data-codex-local-save-status={saveStatus} className="min-h-5 text-xs text-text-muted"
        title="已保存到本机表示原记录已通过数据库确认；同一浏览器、同一站点重开可保留。云同步与外部备份需分别完成。">
        {saveStatus === 'saved' ? '已保存到本机' : saveStatus === 'saving' ? '正在保存词条…' : saveStatus === 'failed' ? '保存失败' : saveStatus === 'dirty' ? '未保存' : '未确认'}
      </p> : saving && <p role="status" className="text-xs text-text-muted">正在保存词条…</p>}
      {error && <div role="alert" className="text-xs text-red-400">{error}；输入已保留。
        <button type="button" onClick={() => { void flushPendingEditsV1().catch(() => undefined) }} className="ml-2 underline">重试保存词条</button>
      </div>}
      <div className="flex items-center gap-2">
        <CInput
          value={entry.icon || ''}
          onChange={event => onChange({ icon: event.target.value })}
          placeholder="图标"
          className="w-14 text-center px-2 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
        />
        <div className="flex-1">
          <CInput
            value={entry.name}
            onChange={event => onChange({ name: event.target.value })}
            placeholder="名称"
            className={`w-full px-3 py-2 rounded-lg bg-bg-elevated border text-sm font-medium ${nameDuplicate ? 'border-amber-400/60' : 'border-border'}`}
          />
          {nameDuplicate && <p className="mt-1 text-[11px] text-amber-400">⚠ 本分类下已有同名词条，注意是否重复</p>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-muted w-12">重要度</span>
        <div className="flex items-center gap-0.5">
          {[1, 2, 3, 4, 5].map(value => (
            <button
              key={value}
              type="button"
              title={`${value} 星`}
              onClick={() => onChange({ importance: entry.importance === value ? 0 : value })}
              className="p-0.5 hover:scale-110 transition-transform"
            >
              <Star className={`w-4 h-4 ${(entry.importance ?? 0) >= value ? 'fill-amber-400 text-amber-400' : 'text-text-muted'}`} />
            </button>
          ))}
        </div>
        {(entry.importance ?? 0) > 0 && <span className="text-[11px] text-amber-400/80">{entry.importance} 星</span>}
      </div>
      <CInput
        value={entry.summary}
        onChange={event => onChange({ summary: event.target.value })}
        placeholder="一句话简介"
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
      />
      <CInput
        value={tags.join('、')}
        onChange={event => onChange({
          tags: JSON.stringify(event.target.value.split(/[、,，]/).map(tag => tag.trim()).filter(Boolean)),
        })}
        placeholder="标签（用顿号或逗号分隔）"
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm"
      />
      <div data-codex-source-field="description"><InlineTextarea markdownRead
        key={`description:${canonicalEntry.id}`}
        value={entry.description}
        onChange={value => { onChange({ description: value }); return flush() }}
        placeholder="详细描述"
        minRows={3}
        className="w-full px-3 py-2 rounded-lg bg-bg-elevated border border-border text-sm resize-y"
      /></div>

      {category.builtInKey === 'beast' && (
        <CodexCultivationLink entry={entry} onChange={saveLinkedPatch} />
      )}
      {category.builtInKey === 'city' && (
        <CodexImportantLocationLink entry={entry} onChange={saveLinkedPatch} />
      )}

      {schema.length > 0 && <div className="border-t border-border pt-3 text-xs text-text-muted">专属属性</div>}
      {schema.map(definition => (
        <CodexFieldRow
          key={definition.key}
          definition={definition}
          value={fields[definition.key] || ''}
          refIds={refs[definition.key] || []}
          allCategories={allCategories}
          allEntries={allEntries}
          currentEntryId={entry.id!}
          worldGroupId={entry.worldGroupId ?? null}
          onValue={value => setField(definition.key, value)}
          onCommit={flush}
          onRef={ids => setRef(definition.key, ids)}
        />
      ))}
    </div>
  )
}

function CodexImportantLocationLink({
  entry,
  onChange,
}: {
  entry: CodexEntry
  onChange: (patch: Partial<CodexEntry>) => void | Promise<void>
}) {
  const locations = useLocationStore(state => state.locations)
  const loadAll = useLocationStore(state => state.loadAll)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle')
  const saveSequence = useRef(0)
  useEffect(() => { void loadAll(entry.projectId) }, [entry.projectId, loadAll])
  const projectLocations = locations.filter(location => location.projectId === entry.projectId)

  const saveLocation = async (value: string) => {
    const sequence = ++saveSequence.current
    setSaveState('saving')
    try {
      await onChange({ importantLocationId: value ? Number(value) : null })
      if (saveSequence.current === sequence) setSaveState('saved')
    } catch {
      if (saveSequence.current === sequence) setSaveState('failed')
    }
  }

  return (
    <label className="block border-t border-border pt-3">
      <span className="block text-xs text-text-muted mb-1">结构化重要地点</span>
      <select
        aria-label="城池重要地点"
        value={entry.importantLocationId ?? ''}
        onChange={event => { void saveLocation(event.target.value) }}
        className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm"
      >
        <option value="">未关联</option>
        {projectLocations.map(location => (
          <option key={location.id} value={location.id}>{location.name}</option>
        ))}
      </select>
      <span className="block mt-1 text-[11px] text-text-muted">
        地点树负责空间层级；这里保留城池的人文属性。删除地点只会断开关联，不会删除词条。
      </span>
      {saveState !== 'idle' && (
        <span role="status" className={`block mt-1 text-[11px] ${saveState === 'failed' ? 'text-red-400' : 'text-text-muted'}`}>
          {saveState === 'saving' ? '地点关联保存中…' : saveState === 'saved' ? '地点关联已保存' : '地点关联保存失败'}
        </span>
      )}
    </label>
  )
}

function CodexCultivationLink({
  entry,
  onChange,
}: {
  entry: CodexEntry
  onChange: (patch: Partial<CodexEntry>) => void | Promise<void>
}) {
  const worldIdValue: unknown = Reflect.get(entry, 'worldId')
  const worldId = typeof worldIdValue === 'number' ? worldIdValue : undefined
  const systems = useCultivationStore(state => state.systems)
  const systemsScope = useCultivationStore(state => state.loadedScope)
  const loadAll = useCultivationStore(state => state.loadAll)
  const [retry, setRetry] = useState(0)
  const identity = `${entry.projectId}:${worldId}`
  const [read, setRead] = useState<{ identity: string; ready: boolean; error: string | null } | null>(null)
  useEffect(() => {
    let active = true
    setRead({ identity, ready: false, error: null })
    void loadAll(entry.projectId).then(() => {
      const state = useCultivationStore.getState()
      if (state.loadError) throw new Error(state.loadError)
      if (state.loadedScope?.projectId !== entry.projectId || (worldId != null && state.loadedScope.worldId !== worldId)) throw new Error('修炼来源已切换，请重新读取。')
      if (active) setRead({ identity, ready: true, error: null })
    }).catch(error => {
      if (active) setRead({ identity, ready: false, error: error instanceof Error ? error.message : String(error) })
    })
    return () => { active = false }
  }, [entry.projectId, worldId, identity, loadAll, retry])
  const ready = read?.identity === identity && read.ready && systemsScope?.projectId === entry.projectId
    && (worldId == null || systemsScope.worldId === worldId)
  const readError = read?.error || (read?.ready && !ready ? '修炼来源已切换，请重新读取。' : null)
  const visible = (ready ? systems : []).filter(system => system.projectId === entry.projectId
    && (worldId == null || Reflect.get(system, 'worldId') === worldId)
    && (system.worldGroupId ?? null) === (entry.worldGroupId ?? null))
  const selected = visible.find(system => system.id === entry.cultivationSystemId)
  const stages = parseCultivationStages(selected?.stages)
  return (
    <div className="grid grid-cols-2 gap-2 border-t border-border pt-3">
      {!ready && <div className="col-span-2 text-xs text-text-muted">
        {readError ? <><p role="alert">修炼关联读取失败：{readError}；原关联未更改。</p><button type="button" onClick={() => setRetry(value => value + 1)}>重新读取</button></> : <p role="status">正在读取修炼关联…</p>}
      </div>}
      <label>
        <span className="block text-xs text-text-muted mb-1">结构化修炼体系</span>
        <select
          aria-label="异兽修炼体系"
          disabled={!ready}
          value={entry.cultivationSystemId ?? ''}
          onChange={event => ready && onChange({
            cultivationSystemId: event.target.value ? Number(event.target.value) : null,
            cultivationStageId: null,
          })}
          className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm"
        >
          <option value="">未关联</option>
          {visible.map(system => <option key={system.id} value={system.id}>{system.name}</option>)}
        </select>
      </label>
      <label>
        <span className="block text-xs text-text-muted mb-1">当前境界</span>
        <select
          aria-label="异兽当前境界"
          disabled={!selected}
          value={entry.cultivationStageId ?? ''}
          onChange={event => ready && onChange({ cultivationStageId: event.target.value || null })}
          className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm disabled:opacity-40"
        >
          <option value="">未指定</option>
          {stages.map(stage => <option key={stage.id} value={stage.id}>{stage.name}</option>)}
        </select>
      </label>
    </div>
  )
}

function CodexFieldRow({
  definition,
  value,
  refIds,
  allCategories,
  allEntries,
  currentEntryId,
  worldGroupId,
  onValue,
  onCommit,
  onRef,
}: {
  definition: CodexFieldDef
  value: string
  refIds: number[]
  allCategories: CodexCategory[]
  allEntries: CodexEntry[]
  currentEntryId: number
  worldGroupId: number | null
  onValue: (value: string) => void
  onCommit: () => Promise<void>
  onRef: (ids: number[]) => void
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-2 items-start" data-codex-source-field={definition.type === 'longtext' ? `field:${definition.key}` : undefined}>
      <label className="text-xs text-text-muted pt-2 text-right">{definition.label}</label>
      <div className="min-w-0">
        {definition.type === 'longtext' && (
          <InlineTextarea markdownRead key={`${currentEntryId}:${definition.key}`} value={value}
            onChange={text => { onValue(text); return onCommit() }} placeholder={definition.placeholder} minRows={2}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm resize-y" />
        )}
        {definition.type === 'select' && (
          <select value={value} onChange={event => onValue(event.target.value)} aria-label={definition.label}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm">
            <option value="">（未选择）</option>
            {(definition.options || []).map(option => <option key={option} value={option}>{option}</option>)}
          </select>
        )}
        {definition.type === 'number' && (
          <CInput value={value} onChange={event => onValue(event.target.value)} placeholder={definition.placeholder}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm" />
        )}
        {definition.type === 'ref' && (
          <CodexRefSelector
            refCategory={definition.refCategory}
            multi={definition.refMulti !== false}
            value={refIds}
            allCategories={allCategories}
            allEntries={allEntries}
            currentEntryId={currentEntryId}
            worldGroupId={worldGroupId}
            onChange={onRef}
          />
        )}
        {definition.type === 'text' && (
          <CInput value={value} onChange={event => onValue(event.target.value)} placeholder={definition.placeholder}
            className="w-full px-3 py-1.5 rounded-lg bg-bg-elevated border border-border text-sm" />
        )}
      </div>
    </div>
  )
}

function CodexRefSelector({
  refCategory,
  multi,
  value,
  allCategories,
  allEntries,
  currentEntryId,
  worldGroupId,
  onChange,
}: {
  refCategory?: string
  multi: boolean
  value: number[]
  allCategories: CodexCategory[]
  allEntries: CodexEntry[]
  currentEntryId: number
  worldGroupId: number | null
  onChange: (ids: number[]) => void
}) {
  const [open, setOpen] = useState(false)
  const candidates = useMemo(() => {
    const hintCategoryIds = refCategory
      ? allCategories.filter(category => category.builtInKey === refCategory).map(category => category.id)
      : []
    return allEntries
      .filter(entry => entry.id !== currentEntryId)
      .filter(entry => codexEntryInWorld(entry, worldGroupId))
      .filter(entry => hintCategoryIds.length === 0 || hintCategoryIds.includes(entry.categoryId))
      .filter(entry => typeof entry.name === 'string')
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [allCategories, allEntries, currentEntryId, refCategory, worldGroupId])
  const selected = allEntries.filter(entry => value.includes(entry.id!))

  const toggle = (id: number) => {
    if (multi) onChange(value.includes(id) ? value.filter(item => item !== id) : [...value, id])
    else {
      onChange(value.includes(id) ? [] : [id])
      setOpen(false)
    }
  }

  return (
    <div className="rounded-lg bg-bg-elevated border border-border">
      <button onClick={() => setOpen(current => !current)} className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-left">
        <ChevronRight className={`w-3.5 h-3.5 text-text-muted transition ${open ? 'rotate-90' : ''}`} />
        {selected.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {selected.map(entry => (
              <span key={entry.id} className="px-1.5 py-0.5 rounded bg-accent/10 text-accent text-xs">{entry.icon} {entry.name}</span>
            ))}
          </span>
        ) : <span className="text-text-muted">点击关联词条…</span>}
      </button>
      {open && (
        <div className="border-t border-border max-h-48 overflow-y-auto p-1">
          {candidates.length === 0 && <p className="text-xs text-text-muted px-2 py-2">暂无可关联的词条</p>}
          {candidates.map(entry => (
            <label key={entry.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-hover cursor-pointer text-sm">
              <input type="checkbox" checked={value.includes(entry.id!)} onChange={() => toggle(entry.id!)} />
              <span>{entry.icon}</span>
              <span className="truncate">{entry.name}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
