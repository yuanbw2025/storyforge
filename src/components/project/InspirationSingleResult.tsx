import {
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  UserCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReverseCharacter, ReverseResult } from '../../lib/ai/inspiration-reverse'
import { characterAxesLabel } from '../../lib/character/character-axes'

interface Props {
  result: ReverseResult
  expandedSections: ReadonlySet<string>
  adoptedSections: ReadonlySet<string>
  selectedChars: ReadonlySet<number>
  adopting: boolean
  onToggleSection: (key: string) => void
  onToggleCharacter: (index: number) => void
  onAdoptWorldview: () => void
  onAdoptStoryCore: () => void
  onAdoptCharacters: () => void
  onAdoptAll: () => void
}

export default function InspirationSingleResult({
  result,
  expandedSections,
  adoptedSections,
  selectedChars,
  adopting,
  onToggleSection,
  onToggleCharacter,
  onAdoptWorldview,
  onAdoptStoryCore,
  onAdoptCharacters,
  onAdoptAll,
}: Props) {
  const allAdopted = adoptedSections.has('worldview')
    && adoptedSections.has('storyCore')
    && adoptedSections.has('characters')

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-text-primary">反推结果</h3>
        {!allAdopted && (
          <button
            onClick={onAdoptAll}
            disabled={adopting}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {adopting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            一键全部采纳
          </button>
        )}
      </div>

      <ResultCard
        title="世界观草稿"
        icon={<Globe className="w-4 h-4 text-blue-500" />}
        expanded={expandedSections.has('worldview')}
        onToggle={() => onToggleSection('worldview')}
        adopted={adoptedSections.has('worldview')}
        onAdopt={onAdoptWorldview}
        adopting={adopting}
        adoptLabel="写入世界观"
      >
        <div className="space-y-2 text-sm">
          {result.worldview.worldOrigin && <FieldRow label="世界来源" value={result.worldview.worldOrigin} />}
          {result.worldview.powerHierarchy && <FieldRow label="力量体系" value={result.worldview.powerHierarchy} />}
          {result.worldview.continentLayout && <FieldRow label="地貌分布" value={result.worldview.continentLayout} />}
          {result.worldview.climateByRegion && <FieldRow label="气候环境" value={result.worldview.climateByRegion} />}
          {result.worldview.historyLine && <FieldRow label="世界历史" value={result.worldview.historyLine} />}
          {result.worldview.races && <FieldRow label="种族民族" value={result.worldview.races} />}
          {result.worldview.factionLayout && <FieldRow label="势力分布" value={result.worldview.factionLayout} />}
        </div>
      </ResultCard>

      <ResultCard
        title="故事核心"
        icon={<BookOpen className="w-4 h-4 text-purple-500" />}
        expanded={expandedSections.has('storyCore')}
        onToggle={() => onToggleSection('storyCore')}
        adopted={adoptedSections.has('storyCore')}
        onAdopt={onAdoptStoryCore}
        adopting={adopting}
        adoptLabel="写入故事设计"
      >
        <div className="space-y-2 text-sm">
          {result.storyCore.logline && <FieldRow label="一句话故事" value={result.storyCore.logline} highlight />}
          {result.storyCore.theme && <FieldRow label="主题" value={result.storyCore.theme} />}
          {result.storyCore.centralConflict && <FieldRow label="核心冲突" value={result.storyCore.centralConflict} />}
          {result.storyCore.plotPattern && <FieldRow label="情节模式" value={result.storyCore.plotPattern} />}
          {result.storyCore.mainPlot && <FieldRow label="主线" value={result.storyCore.mainPlot} />}
        </div>
      </ResultCard>

      <ResultCard
        title={`初始角色（${result.characters.length} 个）`}
        icon={<UserCircle className="w-4 h-4 text-orange-500" />}
        expanded={expandedSections.has('characters')}
        onToggle={() => onToggleSection('characters')}
        adopted={adoptedSections.has('characters')}
        onAdopt={onAdoptCharacters}
        adopting={adopting}
        adoptLabel={`写入角色库（${selectedChars.size} 个）`}
      >
        <div className="space-y-3">
          {result.characters.map((character, index) => (
            <CharacterCard
              key={index}
              char={character}
              selected={selectedChars.has(index)}
              onToggle={() => onToggleCharacter(index)}
              adopted={adoptedSections.has('characters')}
            />
          ))}
        </div>
      </ResultCard>
    </section>
  )
}

function ResultCard({
  title,
  icon,
  expanded,
  onToggle,
  adopted,
  onAdopt,
  adopting,
  adoptLabel,
  children,
}: {
  title: string
  icon: ReactNode
  expanded: boolean
  onToggle: () => void
  adopted: boolean
  onAdopt: () => void
  adopting: boolean
  adoptLabel: string
  children: ReactNode
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-2.5 bg-bg-surface cursor-pointer hover:bg-bg-hover transition-colors"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" /> : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
          {icon}
          <span className="text-sm font-medium text-text-primary">{title}</span>
        </div>
        {adopted ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="w-3.5 h-3.5" /> 已采纳
          </span>
        ) : (
          <button
            onClick={event => {
              event.stopPropagation()
              onAdopt()
            }}
            disabled={adopting}
            className="flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            {adopting ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowDownToLine className="w-3 h-3" />}
            {adoptLabel}
          </button>
        )}
      </div>
      {expanded && <div className="px-4 py-3 border-t border-border">{children}</div>}
    </div>
  )
}

function FieldRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <span className="text-xs text-text-muted">{label}：</span>
      <span className={`text-text-primary ${highlight ? 'font-medium text-accent' : ''}`}>{value}</span>
    </div>
  )
}

function CharacterCard({
  char,
  selected,
  onToggle,
  adopted,
}: {
  char: ReverseCharacter
  selected: boolean
  onToggle: () => void
  adopted: boolean
}) {
  return (
    <div className={`border rounded-lg p-3 transition-colors ${selected ? 'border-accent bg-accent/10' : 'border-border'}`}>
      <div className="flex items-center gap-2 mb-2">
        {!adopted && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="accent-accent"
          />
        )}
        <span className="text-sm font-medium text-text-primary">{char.name}</span>
        <span className="text-xs px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">
          {characterAxesLabel(char)}
        </span>
      </div>
      {char.shortDescription && <p className="text-xs text-accent mb-1">{char.shortDescription}</p>}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-muted">
        {char.personality && <span>性格：{char.personality}</span>}
        {char.motivation && <span>动机：{char.motivation}</span>}
        {char.background && <span className="col-span-2">背景：{char.background}</span>}
        {char.arc && <span className="col-span-2">弧光：{char.arc}</span>}
      </div>
    </div>
  )
}
