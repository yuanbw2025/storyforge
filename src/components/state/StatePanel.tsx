/**
 * C-4 角色状态卡聚合视图。
 *
 * 不改 DB schema：以 characters 为主卡，聚合 stateCards、章节、物品流水、
 * 角色基础地点与势力词条。旧的非角色状态卡保留在库中，但不再作为正式 UI 展示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { liveQuery } from 'dexie'
import {
  ArrowRight, BookOpenCheck, Download, Edit3, MapPin, Package, Save, Shield, Sparkles, UserRound, X,
} from 'lucide-react'
import type { Character, Project, StateCard, StateField, WorkspaceScope } from '../../lib/types'
import { readOwnedRows } from '../../lib/workspace/scope'
import { inspectStateFields, stringifyFields, STATE_CATEGORY_LABELS } from '../../lib/types/state-card'
import { useStateCardStore } from '../../stores/state-card'
import { useCharacterStore } from '../../stores/character'
import { useChapterStore } from '../../stores/chapter'
import { useItemLedgerStore } from '../../stores/item-ledger'
import { useCodexStore } from '../../stores/codex'
import { aggregateInventory } from '../../lib/types/item-ledger'
import { characterAxesLabel } from '../../lib/character/character-axes'
import { CInput } from '../shared/CompositionInput'
import {
  INITIAL_RECORD_TARGET_CLASS,
  initialRecordTargetAttributes,
  useInitialRecordTarget,
} from '../shared/initial-record-target'
import { useActiveWork } from '../../hooks/useActiveWork'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import { flushPendingEditsV1, registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import StateCardRepair from './StateCardRepair'

interface Props {
  project: Project
  onOpenInventory?: () => void
  initialStateCardId?: number | null
}

const LOCATION_KEYS = ['位置', '地点', '所在地', '当前地点', 'location']
const FACTION_KEYS = ['势力', '所属势力', '归属', '阵营', 'faction']
const ITEM_KEYS = ['持有物', '物品', '装备', '随身物品', 'item']

function findField(fields: StateField[], keys: string[]): string {
  const normalized = keys.map(key => key.toLocaleLowerCase())
  return fields.find(field => normalized.some(key => field.key.toLocaleLowerCase().includes(key)))?.value || ''
}

export default function StatePanel({ project, onOpenInventory, initialStateCardId }: Props) {
  const activeWork = useActiveWork(project)
  const projectId = project.id!
  const { cards, loading, loadAll, addCard, updateCard, buildStateContext } = useStateCardStore()
  const { characters, loadAll: loadCharacters } = useCharacterStore()
  const { chapters, loadAll: loadChapters } = useChapterStore()
  const { entries: itemEntries, loadAll: loadItems } = useItemLedgerStore()
  const { categories, entries: codexEntries, loadAll: loadCodex } = useCodexStore()
  const [editingCharacter, setEditingCharacter] = useState<number | null>(null)
  const [editError, setEditError] = useState('')
  const scope = useMemo<WorkspaceScope | null>(() => project.activeWorldId && project.activeWorkId
    ? { projectId, worldId: project.activeWorldId, workId: project.activeWorkId } : null,
  [projectId, project.activeWorldId, project.activeWorkId])
  const ownerKey = scope ? `${scope.projectId}:${scope.worldId}:${scope.workId}` : `${projectId}:unavailable`
  const toggleCharacter = (characterId: number) => {
    void flushPendingEditsV1().then(() => {
      setEditError('')
      setEditingCharacter(current => current === characterId ? null : characterId)
    }).catch(cause => setEditError(cause instanceof Error ? cause.message : '状态草稿尚未保存，已保留输入。'))
  }

  useEffect(() => {
    void Promise.all([
      loadAll(projectId),
      loadCharacters(projectId),
      loadChapters(projectId),
      loadItems(projectId),
      loadCodex(projectId),
    ])
  }, [projectId, loadAll, loadCharacters, loadChapters, loadItems, loadCodex])

  useEffect(() => {
    if (!scope) return
    // Refresh saved fields without toggling loading and unmounting dirty editors.
    const subscription = liveQuery(() => readOwnedRows<StateCard>(scope, 'stateCards', { owner: 'work' })).subscribe({
      next: rows => useStateCardStore.setState(state => {
        const view = state.loadedScope
        return view?.projectId === scope.projectId && view.worldId === scope.worldId && view.workId === scope.workId
          ? { cards: rows } : state
      }),
      error: () => setEditError('当前作品的状态更新读取失败，输入已保留；请重新打开后重试。'),
    })
    return () => subscription.unsubscribe()
  }, [scope])

  const characterCards = useMemo(
    () => cards.filter(card => card.category === 'character'),
    [cards],
  )
  const damagedCards = useMemo(() => cards.flatMap(card => {
    const result = inspectStateFields(card.fields)
    return result.ok ? [] : [{ card, error: result.error }]
  }), [cards])
  const cardErrors = useMemo(() => {
    const map = new Map<number, string | null>()
    for (const card of cards) {
      if (card.id == null) continue
      const result = inspectStateFields(card.fields)
      map.set(card.id, result.ok ? null : result.error)
    }
    return map
  }, [cards])
  const targetCard = cards.find(card => card.id === initialStateCardId) ?? null
  const targetCharacterExists = targetCard != null
    && targetCard.category === 'character'
    && characters.some(character => character.name === targetCard.entityName)
  useInitialRecordTarget(initialStateCardId, targetCard != null)
  const charInventory = useCallback(
    (characterId: number) => aggregateInventory(itemEntries, characterId).filter(item => item.quantity > 0),
    [itemEntries],
  )
  const chapterById = useMemo(
    () => new Map(chapters.filter(chapter => chapter.id != null).map(chapter => [chapter.id!, chapter])),
    [chapters],
  )
  const factionNames = useMemo(() => {
    const factionCategoryIds = new Set(
      categories.filter(category => category.builtInKey === 'faction').map(category => category.id),
    )
    return codexEntries
      .filter(entry => factionCategoryIds.has(entry.categoryId))
      .map(entry => entry.name)
  }, [categories, codexEntries])

  const handleExportText = () => {
    const text = buildStateContext()
    if (!text) return
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${activeWork?.title ?? '当前作品'}_角色状态卡.txt`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-5xl space-y-5">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-border/40">
        <div>
          <h2 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <UserRound className="w-5 h-5" /> 角色状态卡
          </h2>
          <p className="text-xs text-text-muted mt-1">
            以角色为中心聚合当前状态、地点、剧情进度、持有物与势力。章节编辑器的“提取状态”只会更新已登记角色。
          </p>
        </div>
        <button
          onClick={handleExportText}
          disabled={!characterCards.length || damagedCards.length > 0}
          title={damagedCards.length ? '请先修复状态字段；原始字段可在修复卡片中单独导出。' : '导出状态文本'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border bg-bg-elevated text-text-secondary disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" /> 导出
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Summary label="角色总数" value={characters.length} />
        <Summary label="已建立状态" value={characterCards.length} accent />
        <Summary label="待补状态" value={Math.max(0, characters.length - characterCards.length)} />
      </div>
      {editError && <p role="alert" className="text-xs text-error">{editError}</p>}

      {cards.map(card => card.id != null && (
        <StateCardRepair key={`repair:${ownerKey}:${card.id}`} card={card} error={cardErrors.get(card.id) ?? null}
          onSave={(fields, expectedFields) => updateCard(card.id!, { fields }, { expectedFields, scope: projectId })} />
      ))}

      {targetCard && !targetCharacterExists && (
        <StandaloneStateTargetCard
          card={targetCard}
          ownerKey={ownerKey}
          chapterTitle={targetCard.lastChapterId ? chapterById.get(targetCard.lastChapterId)?.title : undefined}
          onSave={(fields, expectedFields) => {
            if (!scope) return Promise.reject(new Error('当前作品身份不完整，输入已保留。'))
            return updateCard(targetCard.id!, { fields: stringifyFields(fields) }, { expectedFields, scope }).then(() => setEditError(''))
          }}
        />
      )}

      {loading ? (
        <div className="text-sm text-text-muted text-center py-10">加载中…</div>
      ) : characters.length === 0 ? (
        <div className="text-center py-12 text-text-muted">
          <UserRound className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">还没有角色</p>
          <p className="text-xs mt-1">先在“角色设计”登记角色，再从章节正文提取动态状态。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {characters.map(character => {
            const card = characterCards.find(item => item.entityName === character.name) || null
            if (card && !inspectStateFields(card.fields).ok && editingCharacter !== character.id) return null
            return (
              <CharacterStateCard
                key={character.id}
                character={character}
                card={card}
                ownerKey={ownerKey}
                chapterTitle={card?.lastChapterId ? chapterById.get(card.lastChapterId)?.title : undefined}
                protagonistItems={(() => { const items = charInventory(character.id!); return items.map(item => `${item.itemName} ×${item.quantity}`) })()}
                inventoryBacked={charInventory(character.id!).length > 0}
                onOpenInventory={onOpenInventory}
                knownFactions={factionNames}
                targeted={card?.id === initialStateCardId}
                editing={editingCharacter === character.id}
                onToggleEdit={() => toggleCharacter(character.id!)}
                onClose={() => { setEditError(''); setEditingCharacter(current => current === character.id ? null : current) }}
                onSave={async (fields, expectedFields) => {
                  if (!scope) throw new Error('当前作品身份不完整，输入已保留。')
                  if (card?.id) {
                    await updateCard(card.id, { fields: stringifyFields(fields) }, { expectedFields, scope })
                  } else {
                    await addCard({
                      projectId,
                      category: 'character',
                      entityName: character.name,
                      fields: stringifyFields(fields),
                    }, { scope })
                  }
                  setEditError('')
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

function Summary({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-xl font-semibold mt-1 ${accent ? 'text-accent' : 'text-text-primary'}`}>{value}</p>
    </div>
  )
}

type SaveStateFields = (fields: StateField[], expectedFields: unknown) => Promise<void>

/** One edit session owns its original record/writer until saved or explicitly discarded. */
function StateFieldsEditor({ rawFields, sourceKey, onSave, onClose }: {
  rawFields: string
  sourceKey: string
  onSave: SaveStateFields
  onClose: () => void
}) {
  const readable = useMemo(() => inspectStateFields(rawFields), [rawFields])
  const initial = readable.ok && readable.fields.length ? readable.fields : [{ key: '当前状态', value: '' }]
  const [draft, setDraft] = useState(initial)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [composing, setComposing] = useState(false)
  const draftRef = useRef(draft), baselineDraft = useRef(stringifyFields(initial))
  const baseline = useRef(rawFields), originalSource = useRef(sourceKey), commit = useRef(onSave)
  const dirty = useRef(false), errorRef = useRef(''), composingRef = useRef(false)
  const inFlight = useRef<Promise<void> | null>(null)
  const latest = useRef({ rawFields, sourceKey })
  latest.current = { rawFields, sourceKey }
  const changedOwner = sourceKey !== originalSource.current
  const conflict = !changedOwner && rawFields !== baseline.current

  const changeDraft = (fields: StateField[]) => {
    draftRef.current = fields
    dirty.current = stringifyFields(fields) !== baselineDraft.current
    setDraft(fields)
  }
  const saveDraft = useCallback((retry = false, reviewedFields?: string): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const externallyChanged = latest.current.sourceKey === originalSource.current && latest.current.rawFields !== baseline.current
    if (!dirty.current && !composingRef.current && !errorRef.current && !externallyChanged && reviewedFields === undefined) return Promise.resolve()
    const fail = (message: string) => {
      errorRef.current = message; setError(message)
      return Promise.reject(new Error(message))
    }
    if (composingRef.current) return fail('输入法仍在组合文字，请完成后保存；输入已保留。')
    if (errorRef.current && !retry) return Promise.reject(new Error(errorRef.current))
    if (reviewedFields === undefined && externallyChanged) {
      return fail('其他页面已更新状态，请先查看外部版本并明确选择；本地输入已保留。')
    }
    const submittedDraft = stringifyFields(draftRef.current)
    const fields = draftRef.current.filter(field => field.key.trim() || field.value.trim())
    if (fields.some(field => !field.key.trim())) {
      return fail('请补全字段名称后保存；输入和空值均已保留。')
    }
    const expectedFields = reviewedFields ?? baseline.current
    errorRef.current = ''; setError(''); setSaving(true)
    const operation = Promise.resolve().then(async () => {
      await commit.current(fields, expectedFields)
      baseline.current = stringifyFields(fields)
      baselineDraft.current = submittedDraft
      dirty.current = stringifyFields(draftRef.current) !== submittedDraft
      if (dirty.current) throw new Error('保存期间收到新输入，前一版本已保存；新输入仍保留，请再次保存。')
    }).catch(cause => {
      dirty.current = true
      errorRef.current = cause instanceof Error ? cause.message : '状态保存失败，输入已保留。'
      setError(errorRef.current)
      throw cause
    }).finally(() => { inFlight.current = null; setSaving(false) })
    inFlight.current = operation
    return operation
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(saveDraft), [saveDraft])
  useEffect(() => {
    if (dirty.current || inFlight.current || composingRef.current || errorRef.current) return
    const result = inspectStateFields(rawFields)
    if (!result.ok) return
    const fields = result.fields.length ? result.fields : [{ key: '当前状态', value: '' }]
    baseline.current = rawFields; baselineDraft.current = stringifyFields(fields)
    originalSource.current = sourceKey; commit.current = onSave
    draftRef.current = fields; setDraft(fields)
  }, [rawFields, sourceKey, onSave, saving])
  useBeforeUnload(dirty.current || saving || composing || Boolean(error))

  return <div className="mt-4 space-y-2"
    onCompositionStartCapture={() => { composingRef.current = true; setComposing(true) }}
    onCompositionEndCapture={() => { composingRef.current = false; setComposing(false) }}>
    <fieldset disabled={saving} className="space-y-2">
      {draft.map((field, index) => <div key={index} className="flex gap-2">
        <CInput value={field.key} placeholder="字段" className="w-28 rounded border border-border bg-bg-base px-2 py-1.5 text-xs"
          onChange={event => changeDraft(draftRef.current.map((item, i) => i === index ? { ...item, key: event.target.value } : item))} />
        <CInput value={field.value} placeholder="当前值" className="flex-1 rounded border border-border bg-bg-base px-2 py-1.5 text-xs"
          onChange={event => changeDraft(draftRef.current.map((item, i) => i === index ? { ...item, value: event.target.value } : item))} />
        <button type="button" aria-label="删除字段" onClick={() => changeDraft(draftRef.current.filter((_, i) => i !== index))}
          className="p-1 text-text-muted hover:text-red-400"><X className="h-3.5 w-3.5" /></button>
      </div>)}
      {changedOwner && <p role="alert" className="text-xs text-amber-400">当前作品或卡片已变化；本地输入仍属于原编辑目标，保存不会写入新目标。</p>}
      {conflict && <div role="alert" className="space-y-2 rounded border border-amber-500/30 p-2 text-xs text-amber-400">
        <p>其他页面已更新状态。本地输入已保留，请检查外部最新版本：</p>
        <pre className="whitespace-pre-wrap break-all">{readable.ok ? readable.fields.map(field => `${field.key}：${field.value}`).join('\n') || '（空状态）' : rawFields}</pre>
        <button type="button" className="mr-3 underline" disabled={!readable.ok}
          onClick={() => {
            if (!readable.ok) return
            const fields = readable.fields.length ? readable.fields : [{ key: '当前状态', value: '' }]
            baseline.current = rawFields; baselineDraft.current = stringifyFields(fields)
            draftRef.current = fields; dirty.current = false; errorRef.current = ''
            setDraft(fields); setError('')
          }}>重载外部版本（舍弃本地输入）</button>
        <button type="button" className="underline"
          onClick={() => { void saveDraft(true, rawFields).then(onClose).catch(() => undefined) }}>用本地输入替换已查看版本</button>
      </div>}
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
      <div className="flex items-center justify-between">
        <button type="button" className="text-xs text-accent" onClick={() => changeDraft([...draftRef.current, { key: '', value: '' }])}>+ 添加字段</button>
        <div className="flex items-center gap-3">
          {(dirty.current || error) && <button type="button" className="text-xs text-text-muted" onClick={() => {
            dirty.current = false; errorRef.current = ''; onClose()
          }}>放弃未保存输入</button>}
          <button type="button" onClick={() => { void saveDraft(true).then(onClose).catch(() => undefined) }}
            className="inline-flex items-center gap-1 rounded bg-accent px-2.5 py-1.5 text-xs text-white">
            <Save className="h-3.5 w-3.5" /> {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </fieldset>
  </div>
}

function StandaloneStateTargetCard({
  card,
  chapterTitle,
  ownerKey,
  onSave,
}: {
  card: StateCard
  chapterTitle?: string
  ownerKey: string
  onSave: SaveStateFields
}) {
  const result = useMemo(() => inspectStateFields(card.fields), [card.fields])
  const fields = useMemo(() => result.ok ? result.fields : [], [result])
  const [editing, setEditing] = useState(false)

  if (!result.ok && !editing) return null

  return (
    <article
      {...initialRecordTargetAttributes(true, card.id)}
      className={`rounded-xl border border-border bg-bg-surface p-4 ${INITIAL_RECORD_TARGET_CLASS}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-text-primary">{card.entityName}</h3>
            <span className="rounded bg-bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
              {STATE_CATEGORY_LABELS[card.category]}
            </span>
          </div>
          {chapterTitle && <p className="mt-1 text-xs text-text-muted">最近：{chapterTitle}</p>}
        </div>
        <button
          type="button"
          onClick={() => { void flushPendingEditsV1().then(() => setEditing(value => !value)).catch(() => undefined) }}
          className="p-1 text-text-muted hover:text-accent"
          title="编辑状态"
        >
          {editing ? <X className="h-4 w-4" /> : <Edit3 className="h-4 w-4" />}
        </button>
      </div>

      {editing ? (
        <StateFieldsEditor rawFields={card.fields} sourceKey={`${ownerKey}:card:${card.id}`} onSave={onSave} onClose={() => setEditing(false)} />
      ) : fields.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {fields.map((field, index) => (
            <span key={index} className="rounded-lg bg-bg-elevated px-2 py-1 text-xs text-text-secondary">
              <span className="text-text-muted">{field.key}：</span>{field.value}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-muted">暂无状态字段。</p>
      )}
    </article>
  )
}

function CharacterStateCard({
  character, card, chapterTitle, protagonistItems, inventoryBacked, onOpenInventory,
  knownFactions, targeted, editing, ownerKey, onToggleEdit, onClose, onSave,
}: {
  character: Character
  card: StateCard | null
  chapterTitle?: string
  protagonistItems: string[]
  inventoryBacked: boolean
  onOpenInventory?: () => void
  knownFactions: string[]
  targeted: boolean
  editing: boolean
  ownerKey: string
  onToggleEdit: () => void
  onClose: () => void
  onSave: SaveStateFields
}) {
  const cardFields = card ? card.fields : '[]'
  const result = useMemo(() => inspectStateFields(cardFields), [cardFields])
  const fields = useMemo(() => result.ok ? result.fields : [], [result])

  const location = findField(fields, LOCATION_KEYS) || character.location || '未记录'
  const faction = findField(fields, FACTION_KEYS)
    || knownFactions.find(name => fields.some(field => field.value.includes(name)))
    || '未记录'
  const stateItems = findField(fields, ITEM_KEYS)
  const heldItems = protagonistItems.length ? protagonistItems.join('、') : stateItems || '未记录'
  const coreFields = fields.filter(field =>
    ![...LOCATION_KEYS, ...FACTION_KEYS, ...ITEM_KEYS]
      .some(key => field.key.toLocaleLowerCase().includes(key.toLocaleLowerCase())),
  )

  return (
    <article
      {...initialRecordTargetAttributes(targeted, card?.id)}
      className={`rounded-xl border border-border bg-bg-surface p-4 ${
        targeted ? INITIAL_RECORD_TARGET_CLASS : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-accent/10 text-accent flex items-center justify-center font-semibold">
          {character.name.slice(0, 1)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-text-primary truncate">{character.name}</h3>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">{characterAxesLabel(character)}</span>
            {!card && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400">待提取</span>}
          </div>
          <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{character.shortDescription || '暂无角色简介'}</p>
        </div>
        <button onClick={onToggleEdit} className="p-1 text-text-muted hover:text-accent" title="编辑状态">
          {editing ? <X className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
        </button>
      </div>

      {editing ? (
        <StateFieldsEditor rawFields={cardFields} sourceKey={`${ownerKey}:card:${card?.id ?? `new:${character.id}`}`} onSave={onSave} onClose={onClose} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mt-4">
            <Fact icon={MapPin} label="所在地点" value={location} />
            <Fact icon={Shield} label="所属势力" value={faction} />
            <Fact icon={BookOpenCheck} label="剧情进度" value={chapterTitle || '未记录'} />
            <InventoryFact
              value={heldItems}
              source={inventoryBacked ? 'inventory' : 'state'}
              onOpenInventory={onOpenInventory}
            />
          </div>
          <div className="mt-3 pt-3 border-t border-border/50">
            <p className="text-[10px] uppercase tracking-wide text-text-muted flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> 当前状态
            </p>
            {coreFields.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {coreFields.map((field, index) => (
                  <span key={index} className="px-2 py-1 rounded-lg bg-bg-elevated text-xs text-text-secondary">
                    <span className="text-text-muted">{field.key}：</span>{field.value}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted mt-2">尚无动态状态。可在章节编辑器中点击“提取状态”。</p>
            )}
          </div>
        </>
      )}
    </article>
  )
}

export function InventoryFact({
  value,
  source,
  onOpenInventory,
}: {
  value: string
  source: 'inventory' | 'state'
  onOpenInventory?: () => void
}) {
  return (
    <div className="rounded-lg bg-bg-elevated/60 p-2.5 min-w-0" data-testid="state-inventory-fact">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-text-muted flex min-w-0 items-center gap-1">
          <Package className="w-3 h-3 shrink-0" /> 持有物
          <span className="truncate text-[9px] text-text-muted/70">
            · {source === 'inventory' ? '来自物品栏' : '来自状态字段'}
          </span>
        </p>
        {onOpenInventory && (
          <button
            type="button"
            onClick={onOpenInventory}
            title="去物品栏"
            aria-label="去物品栏"
            className="shrink-0 rounded p-0.5 text-text-muted hover:bg-accent/10 hover:text-accent"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{value}</p>
    </div>
  )
}

function Fact({ icon: Icon, label, value }: {
  icon: typeof MapPin
  label: string
  value: string
}) {
  return (
    <div className="rounded-lg bg-bg-elevated/60 p-2.5 min-w-0">
      <p className="text-[10px] text-text-muted flex items-center gap-1">
        <Icon className="w-3 h-3" /> {label}
      </p>
      <p className="text-xs text-text-secondary mt-1 line-clamp-2">{value}</p>
    </div>
  )
}
