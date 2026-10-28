import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import type { Character, Project, WorldGroup } from '../../lib/types'
import {
  MORAL_AXIS_LABELS,
  ORDER_AXIS_LABELS,
  ROLE_WEIGHT_LABELS,
} from '../../lib/character/character-axes'
import { InlineInput, InlineTextarea } from '../shared/InlineEdit'
import CharacterAxesPicker from './CharacterAxesPicker'
import CharacterDimensionFields from './CharacterDimensionFields'
import CharacterStatusPanel from './CharacterStatusPanel'
import CharacterSupplementAction from './CharacterSupplementAction'
import CharacterLifecycleAction from './CharacterLifecycleAction'
import CharacterWorldAffiliations from './CharacterWorldAffiliations'
import { flushPendingEditsV1, registerPendingDraftFlusherV1 } from '../../lib/authoring/pending-edit-coordinator'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'

interface Props {
  char: Character
  glyphColor: string
  project: Project
  multiWorld?: boolean
  worldGroups?: WorldGroup[]
  activeWorldGroupId?: number | null
  onUpdateField: (field: keyof Character, value: string) => void | Promise<void>
  onPatch: (patch: Partial<Character>, expected?: Partial<Character>) => void | Promise<void>
  onReload: () => void
  onDelete: () => void
}

export default function CharacterDetailCard({
  char,
  glyphColor,
  project,
  multiWorld,
  worldGroups = [],
  activeWorldGroupId = null,
  onUpdateField,
  onPatch,
  onReload,
  onDelete,
}: Props) {
  const [expanded, setExpanded] = useState(true)
  const [patchError, setPatchError] = useState('')
  const [patchSaving, setPatchSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const pendingPatch = useRef<{ data: Partial<Character>; save: Props['onPatch'] } | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const flushPatch = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current
    const pending = pendingPatch.current
    if (!pending) return Promise.resolve()
    setPatchSaving(true)
    const operation = Promise.resolve().then(() => pending.save(pending.data)).then(() => {
      if (pendingPatch.current === pending) pendingPatch.current = null
      setPatchError('')
    }).catch(cause => { setPatchError(cause instanceof Error ? cause.message : '角色关联保存失败。'); throw cause })
      .finally(() => { inFlight.current = null; setPatchSaving(false) })
    inFlight.current = operation
    return operation
  }, [])
  useEffect(() => registerPendingDraftFlusherV1(flushPatch), [flushPatch])
  useBeforeUnload(patchSaving || Boolean(patchError))
  const saveSelection = (data: Partial<Character>) => {
    pendingPatch.current = { data, save: onPatch }
    void flushPatch().catch(() => undefined)
  }
  const displayChar = pendingPatch.current ? { ...char, ...pendingPatch.current.data } : char

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-serif font-bold shrink-0 ${glyphColor}`}>
          {typeof char.name === 'string' ? char.name.charAt(0) : '?'}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs text-text-muted mb-0.5">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-border bg-bg-elevated text-text-secondary">
              {ROLE_WEIGHT_LABELS[char.roleWeight]}
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-border bg-bg-elevated text-text-secondary">
              {ORDER_AXIS_LABELS[char.orderAxis]}{MORAL_AXIS_LABELS[char.moralAxis]}
            </span>

            {multiWorld && (
              <select
                aria-label="角色所属世界"
                disabled={patchSaving}
                value={displayChar.isCrossWorld ? 'cross' : (displayChar.homeWorldGroupId ?? '')}
                onChange={event => {
                  const value = event.target.value
                  saveSelection(value === 'cross'
                    ? { isCrossWorld: true, homeWorldGroupId: null }
                    : {
                        isCrossWorld: false,
                        homeWorldGroupId: value ? Number(value) : null,
                        raceEntryId: null,
                        cultivationSystemId: null,
                        cultivationStageId: null,
                      })
                }}
                className="px-1.5 py-0.5 bg-bg-elevated text-text-secondary text-[10px] rounded border border-border focus:outline-none focus:border-accent cursor-pointer"
                title="角色所属世界"
              >
                <option value="cross">🌐 跨世界</option>
                {worldGroups.map(group => (
                  <option key={group.id} value={group.id}>{group.icon || '🌐'} {group.name}</option>
                ))}
              </select>
            )}
          </div>

          <InlineInput
            value={char.name}
            onChange={value => onUpdateField('name', value)}
            className="text-2xl font-bold font-serif text-text-primary"
          />
          <InlineInput
            value={char.shortDescription || ''}
            onChange={value => onUpdateField('shortDescription', value)}
            className={`text-sm mt-1 italic ${char.shortDescription ? 'text-text-secondary' : 'text-text-muted'}`}
            prefix={char.shortDescription ? '“' : undefined}
            suffix={char.shortDescription ? '”' : undefined}
            placeholder="点击添加一句话简介…"
          />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <CharacterLifecycleAction
            character={char}
            project={project}
            worldGroupId={char.isCrossWorld ? activeWorldGroupId : (char.homeWorldGroupId ?? null)}
            onDone={onReload}
          />
          <CharacterSupplementAction
            character={char}
            project={project}
            worldGroupId={char.isCrossWorld ? activeWorldGroupId : (char.homeWorldGroupId ?? null)}
            onDone={onReload}
          />
          <button
            onClick={() => { void flushPendingEditsV1().then(() => { setExpanded(value => !value); setActionError('') }).catch(cause => setActionError(cause instanceof Error ? cause.message : '角色草稿尚未保存。')) }}
            className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
            aria-label={expanded ? '收起角色详情' : '展开角色详情'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-text-muted hover:text-error rounded transition-colors"
            aria-label="删除角色"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {actionError && <p role="alert" className="text-sm text-error">{actionError}</p>}
      {patchError && <div role="alert" className="text-sm text-error">{patchError}；选择已保留。
        <button type="button" className="ml-2 underline" onClick={() => { void flushPatch().catch(() => undefined) }}>重试保存角色关联</button>
      </div>}
      <fieldset disabled={patchSaving}>
      <CharacterAxesPicker
        roleWeight={displayChar.roleWeight}
        moralAxis={displayChar.moralAxis}
        orderAxis={displayChar.orderAxis}
        onChange={axes => {
          if (!axes.roleWeight || !axes.moralAxis || !axes.orderAxis) return
          saveSelection(axes as Pick<Character, 'roleWeight' | 'moralAxis' | 'orderAxis'>)
        }}
        compact
      />

      </fieldset>

      <CharacterStatusPanel projectId={project.id!} characterName={typeof char.name === 'string' ? char.name : ''} />

      <fieldset disabled={patchSaving}>
      <CharacterWorldAffiliations
        character={displayChar}
        projectId={project.id!}
        worldGroups={worldGroups}
        onChange={saveSelection}
      />
      </fieldset>

      {expanded && (
        <div className="space-y-4">
          <CharacterDimensionFields
            character={char}
            onChange={onPatch}
            exclude={['shortDescription']}
          />
          <div className="flex gap-2">
            <span className="w-20 flex-shrink-0 pt-1.5 text-xs text-text-muted">人物关系</span>
            <div className="flex-1 min-w-0">
              <InlineTextarea
                value={char.relationships || ''}
                onChange={value => onUpdateField('relationships', value)}
                placeholder="点击填写人物关系…"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
