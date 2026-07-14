import { useState } from 'react'
import { ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import type { Character, WorldGroup } from '../../lib/types'
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

interface Props {
  char: Character
  glyphColor: string
  projectId: number
  multiWorld?: boolean
  worldGroups?: WorldGroup[]
  onUpdateField: (field: keyof Character, value: string) => void
  onPatch: (patch: Partial<Character>) => void
  onReload: () => void
  onDelete: () => void
}

export default function CharacterDetailCard({
  char,
  glyphColor,
  projectId,
  multiWorld,
  worldGroups = [],
  onUpdateField,
  onPatch,
  onReload,
  onDelete,
}: Props) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div className={`w-16 h-16 rounded-xl flex items-center justify-center text-3xl font-serif font-bold shrink-0 ${glyphColor}`}>
          {char.name.charAt(0)}
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
                value={char.isCrossWorld ? 'cross' : (char.homeWorldGroupId ?? '')}
                onChange={event => {
                  const value = event.target.value
                  onPatch(value === 'cross'
                    ? { isCrossWorld: true, homeWorldGroupId: null }
                    : { isCrossWorld: false, homeWorldGroupId: value ? Number(value) : null })
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
          <CharacterSupplementAction
            character={char}
            projectId={projectId}
            worldGroupId={char.homeWorldGroupId ?? null}
            onDone={onReload}
          />
          <button
            onClick={() => setExpanded(value => !value)}
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

      <CharacterAxesPicker
        roleWeight={char.roleWeight}
        moralAxis={char.moralAxis}
        orderAxis={char.orderAxis}
        onChange={axes => {
          if (!axes.roleWeight || !axes.moralAxis || !axes.orderAxis) return
          onPatch(axes as Pick<Character, 'roleWeight' | 'moralAxis' | 'orderAxis'>)
        }}
        compact
      />

      <CharacterStatusPanel projectId={projectId} characterName={char.name} />

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
