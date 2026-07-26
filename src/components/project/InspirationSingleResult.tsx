import {
  ArrowDownToLine,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Globe,
  Loader2,
  Network,
  UserCircle,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { ReverseCharacter, ReverseResult } from '../../lib/ai/inspiration-reverse'
import { characterAxesLabel } from '../../lib/character/character-axes'
import { FACTION_TYPES, FACTION_STATUSES, FACTION_RELATION_TYPES } from '../../lib/types/faction'

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
  onAdoptFactions: () => void
  onAdoptFactionRelations: () => void
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
  onAdoptFactions,
  onAdoptFactionRelations,
  onAdoptAll,
}: Props) {
  const allAdopted = adoptedSections.has('worldview')
    && adoptedSections.has('storyCore')
    && adoptedSections.has('characters')
    && adoptedSections.has('factions')
    && adoptedSections.has('factionRelations')

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

      <ResultCard
        title={`势力（${result.factions.length} 个）`}
        icon={<Network className="w-4 h-4 text-cyan-500" />}
        expanded={expandedSections.has('factions')}
        onToggle={() => onToggleSection('factions')}
        adopted={adoptedSections.has('factions')}
        onAdopt={onAdoptFactions}
        adopting={adopting}
        adoptLabel="写入势力库"
      >
        {result.factions.length === 0 ? (
          <p className="text-xs text-text-muted">本次反推未生成势力建议</p>
        ) : (
          <div className="space-y-2 text-sm">
            {result.factions.map((f, i) => (
              <div key={i} className="border border-border rounded p-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-text-primary">{f.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">
                    {FACTION_TYPES.find(t => t.value === f.type)?.label ?? f.type}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">
                    {FACTION_STATUSES.find(s => s.value === f.status)?.label ?? f.status}
                  </span>
                </div>
                {f.leader && <FieldRow label="首领" value={f.leader} />}
                {f.memberNames.length > 0 && <FieldRow label="成员" value={f.memberNames.join('、')} />}
                {f.ideology && <FieldRow label="理念" value={f.ideology} />}
                {f.baseLocation && <FieldRow label="根据地" value={f.baseLocation} />}
                {f.power && <FieldRow label="实力" value={f.power} />}
                {f.resources && <FieldRow label="资源" value={f.resources} />}
                {f.secret && <FieldRow label="暗线" value={f.secret} />}
              </div>
            ))}
          </div>
        )}
      </ResultCard>

      <ResultCard
        title={`势力关系（${result.factionRelations.length} 条）`}
        icon={<Network className="w-4 h-4 text-rose-500" />}
        expanded={expandedSections.has('factionRelations')}
        onToggle={() => onToggleSection('factionRelations')}
        adopted={adoptedSections.has('factionRelations')}
        onAdopt={onAdoptFactionRelations}
        adopting={adopting}
        adoptLabel="写入势力关系"
      >
        {result.factionRelations.length === 0 ? (
          <p className="text-xs text-text-muted">本次反推未生成势力关系建议</p>
        ) : (
          <div className="space-y-2 text-sm">
            {result.factionRelations.map((r, i) => (
              <div key={i} className="border border-border rounded p-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-text-primary">{r.fromFactionName}</span>
                  <span className="text-text-muted">—[{FACTION_RELATION_TYPES.find(t => t.value === r.relationType)?.label ?? r.relationType}{r.isBidirectional ? '/双向' : '/单向'}]→</span>
                  <span className="text-text-primary">{r.toFactionName}</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-bg-hover rounded text-text-muted">强度 {r.intensity}</span>
                </div>
                {r.label && <FieldRow label="标签" value={r.label} />}
                {r.description && <FieldRow label="描述" value={r.description} />}
              </div>
            ))}
          </div>
        )}
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
