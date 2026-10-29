import AcknowledgedTextField from '../shared/AcknowledgedTextField'
import type { Character } from '../../lib/types'
import { dimensionsByGroup, type CharacterDimensionKey, type CharacterDimensionSpec } from '../../lib/character/character-dimensions'

interface Props {
  character: Character
  onChange: (patch: Partial<Character>, expected?: Partial<Character>) => void | Promise<void>
  /** 行内已显示、此处不重复的维度（如 NPC 行已有 简介/地点） */
  exclude?: CharacterDimensionKey[]
}

interface DimensionFieldProps {
  dimension: Pick<CharacterDimensionSpec, 'label' | 'rows'>
  value: unknown
  onCommit: (value: string, expected: unknown) => void | Promise<void>
  input?: boolean
  placeholder?: string
  className?: string
}

export function CharacterDraftField({ dimension, ...props }: DimensionFieldProps) {
  return <AcknowledgedTextField {...props} label={dimension.label} rows={dimension.rows} />
}

/**
 * 角色完整维度的展示/编辑区(共享)——按 CHARACTER_DIMENSIONS 分组渲染。
 * NPC / 次要 / 路人 / 主要面板复用,让 AI 生成的完整内容在各自页面都能看到、能改。
 * 加一个维度只改 CHARACTER_DIMENSIONS + FIELD_REGISTRY,这里自动出现。
 */
export default function CharacterDimensionFields({ character, onChange, exclude = [] }: Props) {
  const skip = new Set<CharacterDimensionKey>(exclude)

  return (
    <div className="space-y-3">
      {dimensionsByGroup().map(({ group, dims }) => {
        const shown = dims.filter(d => !skip.has(d.key))
        if (!shown.length) return null
        return (
          <div key={group}>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-text-muted/70">{group}</div>
            <div className="space-y-1.5">
              {shown.map(d => (
                <div key={d.key} className="flex gap-2">
                  <span className="w-20 flex-shrink-0 pt-1.5 text-xs text-text-muted">{d.label}</span>
                  <CharacterDraftField
                    key={`${character.id ?? 'draft'}:${d.key}`}
                    dimension={d}
                    value={character[d.key]}
                    onCommit={(value, expected) => onChange({ [d.key]: value } as Partial<Character>, { [d.key]: expected } as Partial<Character>)}
                  />
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
