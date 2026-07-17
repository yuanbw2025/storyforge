import { ArrowDownToLine, BookOpen, Check, Globe, Loader2, UserCircle } from 'lucide-react'
import type { ReverseMultiWorldResult } from '../../lib/ai/inspiration-reverse'
import { characterAxesLabel } from '../../lib/character/character-axes'

interface Props {
  result: ReverseMultiWorldResult
  adopted: boolean
  adopting: boolean
  onAdopt: () => void
}

export default function InspirationMultiWorldResult({ result, adopted, adopting, onAdopt }: Props) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">多世界反推结果（{result.worlds.length} 个世界）</h3>
        <button
          onClick={onAdopt}
          disabled={adopting || adopted}
          className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
        >
          {adopting ? <Loader2 className="w-3 h-3 animate-spin" /> : adopted ? <Check className="w-3 h-3" /> : <ArrowDownToLine className="w-3 h-3" />}
          {adopted ? '已采纳' : '一键创建多世界'}
        </button>
      </div>

      <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-1 text-sm">
        <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1">
          <BookOpen className="w-3.5 h-3.5" /> 故事主线
        </div>
        {result.storyCore.logline && <FieldRow label="一句话" value={result.storyCore.logline} />}
        {result.storyCore.mainPlot && <FieldRow label="主线" value={result.storyCore.mainPlot} />}
        {result.storyCore.centralConflict && <FieldRow label="核心冲突" value={result.storyCore.centralConflict} />}
      </div>

      {result.worlds.map((world, index) => (
        <div key={index} className="bg-bg-surface border border-border rounded-lg p-3 space-y-1 text-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1">
            <Globe className="w-3.5 h-3.5" /> {world.name}
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-elevated text-text-muted">{world.type}</span>
          </div>
          {world.worldOrigin && <FieldRow label="世界来源" value={world.worldOrigin} />}
          {world.powerHierarchy && <FieldRow label="力量体系" value={world.powerHierarchy} />}
          {world.factionLayout && <FieldRow label="势力分布" value={world.factionLayout} />}
          {world.entryCondition && <FieldRow label="进入条件" value={world.entryCondition} />}
          {world.powerRestriction && <FieldRow label="能力限制" value={world.powerRestriction} />}
        </div>
      ))}

      {result.characters.length > 0 && (
        <div className="bg-bg-surface border border-border rounded-lg p-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary mb-1">
            <UserCircle className="w-3.5 h-3.5" /> 初始角色（{result.characters.length}）
          </div>
          {result.characters.map((character, index) => (
            <div key={index} className="text-xs">
              <span className="text-text-primary font-medium">{character.name}</span>
              <span className="text-text-muted"> · {characterAxesLabel(character)}</span>
              {character.isCrossWorld
                ? <span className="ml-1 text-accent">🌐 跨世界</span>
                : character.homeWorld && <span className="ml-1 text-text-muted">@{character.homeWorld}</span>}
              {character.shortDescription && <span className="text-text-muted"> — {character.shortDescription}</span>}
            </div>
          ))}
        </div>
      )}

      {adopted && (
        <p className="text-xs text-green-400">
          ✓ 已创建 {result.worlds.length} 个世界。前往「世界总览」查看，或在世界观面板切换世界编辑。
        </p>
      )}
    </section>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-text-muted">{label}：</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}
