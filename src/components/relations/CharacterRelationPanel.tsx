import { useState } from 'react'
import { Plus, Trash2, ArrowRightLeft, ArrowRight, Users } from 'lucide-react'
import { useCharacterRelationStore } from '../../stores/character-relation'
import { useCharacterStore } from '../../stores/character'
import type { Project, RelationType } from '../../lib/types'

const RELATION_TYPES: { value: RelationType; label: string }[] = [
  { value: 'family', label: '👨‍👩‍👧 亲属' },
  { value: 'lover', label: '❤️ 恋人' },
  { value: 'friend', label: '🤝 朋友' },
  { value: 'rival', label: '⚔️ 对手' },
  { value: 'enemy', label: '💀 敌人' },
  { value: 'master', label: '🎓 师父' },
  { value: 'student', label: '📖 弟子' },
  { value: 'ally', label: '🤜 盟友' },
  { value: 'subordinate', label: '📋 上下级' },
  { value: 'other', label: '🔗 其他' },
]

interface Props {
  project: Project
}

export default function CharacterRelationPanel({ project }: Props) {
  const { relations, addRelation, updateRelation, deleteRelation } = useCharacterRelationStore()
  const { characters } = useCharacterStore()
  const projectId = project.id!

  const [editingId, setEditingId] = useState<number | null>(null)

  // 新建关系
  const handleAdd = async () => {
    if (characters.length < 2) return
    await addRelation({
      projectId,
      fromCharacterId: characters[0]?.id ?? 0,
      toCharacterId: characters[1]?.id ?? 0,
      relationType: 'friend',
      label: '新关系',
      description: '',
      isBidirectional: true,
    })
  }

  const getCharacterName = (id: number) => {
    return characters.find((c) => c.id === id)?.name || `角色#${id}`
  }

  const projectRelations = relations.filter((r) => r.projectId === projectId)

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-accent" />
          <h1 className="text-2xl font-bold text-text-primary">角色关系</h1>
          <span className="text-sm text-text-muted">({projectRelations.length} 条关系)</span>
        </div>
        <button
          onClick={handleAdd}
          disabled={characters.length < 2}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-white rounded-lg text-sm hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={characters.length < 2 ? '需要至少 2 个角色才能创建关系' : '添加关系'}
        >
          <Plus className="w-4 h-4" />
          添加关系
        </button>
      </div>

      {/* 提示 */}
      {characters.length < 2 && (
        <div className="bg-accent/10 border border-accent/20 rounded-lg p-4 text-sm text-text-secondary">
          💡 请先在「角色」模块中创建至少 2 个角色，才能建立角色关系。
        </div>
      )}

      {/* 关系列表 */}
      {projectRelations.length === 0 && characters.length >= 2 && (
        <div className="text-center py-16 text-text-muted">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>还没有角色关系</p>
          <p className="text-sm mt-1">点击「添加关系」开始定义角色间的关系</p>
        </div>
      )}

      <div className="space-y-3">
        {projectRelations.map((rel) => {
          const isEditing = editingId === rel.id
          return (
            <div
              key={rel.id}
              className="bg-bg-surface border border-border rounded-lg p-4 hover:border-accent/30 transition-colors"
            >
              {/* 关系概览行 */}
              <div className="flex items-center gap-3 mb-3">
                {/* 角色 A */}
                <select
                  value={rel.fromCharacterId}
                  onChange={(e) =>
                    updateRelation(rel.id!, { fromCharacterId: Number(e.target.value) })
                  }
                  className="bg-bg-base border border-border rounded px-2 py-1.5 text-sm text-text-primary flex-1 max-w-[180px]"
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {/* 方向指示器 */}
                <button
                  onClick={() =>
                    updateRelation(rel.id!, { isBidirectional: !rel.isBidirectional })
                  }
                  className="text-accent hover:text-accent/80 transition-colors"
                  title={rel.isBidirectional ? '双向关系（点击改为单向）' : '单向关系（点击改为双向）'}
                >
                  {rel.isBidirectional ? (
                    <ArrowRightLeft className="w-5 h-5" />
                  ) : (
                    <ArrowRight className="w-5 h-5" />
                  )}
                </button>

                {/* 角色 B */}
                <select
                  value={rel.toCharacterId}
                  onChange={(e) =>
                    updateRelation(rel.id!, { toCharacterId: Number(e.target.value) })
                  }
                  className="bg-bg-base border border-border rounded px-2 py-1.5 text-sm text-text-primary flex-1 max-w-[180px]"
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                {/* 关系类型 */}
                <select
                  value={rel.relationType}
                  onChange={(e) =>
                    updateRelation(rel.id!, { relationType: e.target.value as RelationType })
                  }
                  className="bg-bg-base border border-border rounded px-2 py-1.5 text-sm text-text-primary"
                >
                  {RELATION_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>

                {/* 展开/折叠 & 删除 */}
                <button
                  onClick={() => setEditingId(isEditing ? null : rel.id!)}
                  className="text-xs text-text-muted hover:text-text-primary transition-colors"
                >
                  {isEditing ? '收起' : '编辑'}
                </button>
                <button
                  onClick={() => deleteRelation(rel.id!)}
                  className="text-text-muted hover:text-red-400 transition-colors"
                  title="删除关系"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* 关系标签（始终显示） */}
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                <span className="font-medium text-text-primary">{getCharacterName(rel.fromCharacterId)}</span>
                <span className="text-accent">
                  {rel.isBidirectional ? '⇄' : '→'}
                </span>
                <span className="font-medium text-text-primary">{getCharacterName(rel.toCharacterId)}</span>
                <span className="text-text-muted">：</span>
                {isEditing ? (
                  <input
                    value={rel.label}
                    onChange={(e) => updateRelation(rel.id!, { label: e.target.value })}
                    className="bg-bg-base border border-border rounded px-2 py-1 text-sm text-text-primary flex-1"
                    placeholder="关系标签，如：父子、宿敌、暗恋对象"
                  />
                ) : (
                  <span className="text-accent font-medium">{rel.label || '未命名关系'}</span>
                )}
              </div>

              {/* 展开的编辑区域 */}
              {isEditing && (
                <div className="mt-3 pt-3 border-t border-border">
                  <label className="block text-xs text-text-muted mb-1">关系描述</label>
                  <textarea
                    value={rel.description}
                    onChange={(e) => updateRelation(rel.id!, { description: e.target.value })}
                    rows={3}
                    className="w-full bg-bg-base border border-border rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent"
                    placeholder="描述这段关系的背景、变化、冲突等..."
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
