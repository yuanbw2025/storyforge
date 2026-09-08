import { Activity, BookOpen, HeartPulse, Shield, Sparkles, WandSparkles } from 'lucide-react'
import {
  projectTextOpenWorldPlayerCharacterV1,
  type TextOpenWorldPlayerCharacterProjectionV1,
} from '../../lib/open-world/player-character'
import type { TextOpenWorldSessionProjectionV1 } from '../../lib/types'

function portraitInitial(name: string): string {
  return Array.from(name.trim())[0] ?? '主'
}

function signed(value: number, displayValue: string): string {
  return value > 0 ? `+${displayValue}` : displayValue
}

function ResourceMeter(props: {
  resource: TextOpenWorldPlayerCharacterProjectionV1['resources']['health' | 'skillResource']
}) {
  const { resource } = props
  const hasCapacity = resource.maximum > 0
  return <div className="grid gap-2 rounded border border-border/70 bg-bg-base/70 p-3">
    <span className="flex items-center justify-between gap-3 text-xs">
      <strong>{resource.label}</strong>
      <b className="font-mono text-accent">{resource.current}/{resource.maximum}</b>
    </span>
    <progress
      aria-label={`${resource.label} ${resource.current}/${resource.maximum}`}
      className="h-2 w-full accent-accent"
      max={hasCapacity ? resource.maximum : 1}
      value={hasCapacity ? resource.current : 0}
    />
    {!hasCapacity && <small className="text-text-muted">暂无资源容量</small>}
  </div>
}

export default function TextOpenWorldCharacterPanel(props: {
  projection: TextOpenWorldSessionProjectionV1
}) {
  // Deliberately recompute from the authoritative Projection on every render.
  // Restores may replace nested state without changing its outer object identity.
  const character = projectTextOpenWorldPlayerCharacterV1(props.projection)
  const { identity, progression, resources } = character
  const experiencePercent = progression.atMaximumLevel
    ? 100
    : Math.round(progression.progressRatio * 10_000) / 100

  return <section
    className="grid min-w-0 gap-4"
    data-testid="text-open-world-character-panel"
    data-open-world-ui-key="overlay.character"
    aria-label="角色与成长"
  >
    <header
      className="grid min-w-0 grid-cols-[72px_minmax(0,1fr)] gap-4 rounded border border-accent/25 bg-gradient-to-br from-accent/10 via-bg-surface to-bg-surface p-4 sm:grid-cols-[88px_minmax(0,1fr)] sm:p-5"
      data-testid="text-open-world-character-identity"
    >
      <span
        role="img"
        aria-label={`${identity.name}的头像占位`}
        className="grid h-[72px] w-[72px] place-items-center rounded-xl border border-accent/35 bg-bg-base font-serif text-3xl text-accent sm:h-[88px] sm:w-[88px]"
        data-testid="text-open-world-character-portrait-placeholder"
      >
        {portraitInitial(identity.name)}
      </span>
      <div className="min-w-0 self-center">
        <small className="font-mono text-[8px] tracking-[0.16em] text-accent">主角档案</small>
        <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="min-w-0 break-words font-serif text-2xl font-medium text-text-primary sm:text-3xl">
            {identity.name}
          </h1>
          <span className="rounded-full border border-border px-2 py-1 text-[9px] text-text-muted">
            Lv.{progression.level}{identity.pronouns ? ` · ${identity.pronouns}` : ''}
          </span>
        </div>
        <p className="mt-2 break-words text-xs leading-6 text-text-muted">
          {identity.background || '这位主角的公开背景仍有待故事展开。'}
        </p>
      </div>
      <div className="col-span-2 grid gap-2 border-t border-border/70 pt-4 sm:grid-cols-2">
        <p className="m-0 min-w-0 break-words text-xs leading-5">
          <strong className="text-accent">近期目标：</strong>{identity.shortGoal || '未设置'}
        </p>
        <p className="m-0 min-w-0 break-words text-xs leading-5">
          <strong className="text-accent">长期目标：</strong>{identity.longGoal || '未设置'}
        </p>
        {(identity.appearance || identity.personality || identity.publicKnowledge) && <details className="col-span-full text-[10px] text-text-muted">
          <summary className="cursor-pointer text-accent">查看公开角色设定</summary>
          <div className="mt-2 grid gap-2 rounded bg-bg-base/70 p-3 sm:grid-cols-2">
            {identity.appearance && <p className="m-0 break-words"><strong>外貌：</strong>{identity.appearance}</p>}
            {identity.personality && <p className="m-0 break-words"><strong>性格：</strong>{identity.personality}</p>}
            {identity.publicKnowledge && <p className="m-0 break-words sm:col-span-2"><strong>公开经历：</strong>{identity.publicKnowledge}</p>}
          </div>
        </details>}
      </div>
    </header>

    <div className="grid min-w-0 gap-4 lg:grid-cols-2">
      <article
        className="rounded border border-border bg-bg-surface p-4"
        data-testid="text-open-world-character-progression"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-accent" aria-hidden="true" />成长进度
        </div>
        <div className="mt-4 grid gap-2" data-testid="text-open-world-character-experience">
          <span className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
            <strong>等级 {progression.level} / {progression.maximumLevel}</strong>
            <span className="font-mono text-[10px] text-text-muted">累计 {progression.experience} EXP</span>
          </span>
          <progress
            aria-label={`等级经验进度 ${experiencePercent}%`}
            className="h-2 w-full accent-accent"
            max={100}
            value={experiencePercent}
          />
          <small className="text-text-muted">
            {progression.atMaximumLevel
              ? `已达 ${progression.maximumLevel} 级上限`
              : `本级 ${progression.experienceIntoLevel}/${progression.experienceForNextLevel} EXP`}
          </small>
        </div>
      </article>

      <article
        className="rounded border border-border bg-bg-surface p-4"
        data-testid="text-open-world-character-resources"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <HeartPulse className="h-4 w-4 text-accent" aria-hidden="true" />当前资源
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <ResourceMeter resource={resources.health} />
          <ResourceMeter resource={resources.skillResource} />
        </div>
      </article>
    </div>

    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <article
        className="rounded border border-border bg-bg-surface p-4"
        data-testid="text-open-world-character-attributes"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Activity className="h-4 w-4 text-accent" aria-hidden="true" />核心属性
        </div>
        <p className="mt-1 text-[10px] text-text-muted">属性随等级自动成长，不需要手动分配点数。</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
          {character.attributes.map(attribute => <section
            key={attribute.semantic}
            className="rounded border border-border/70 bg-bg-base/70 p-3"
          >
            <span className="flex items-baseline justify-between gap-2">
              <strong className="text-xs">{attribute.label}</strong>
              <b className="font-mono text-lg text-accent">{attribute.value}</b>
            </span>
            <small className="mt-1 block text-text-muted">
              初始 {attribute.initialValue} · 等级成长 +{attribute.levelGrowth}
            </small>
          </section>)}
        </div>
      </article>

      <article
        className="rounded border border-border bg-bg-surface p-4"
        data-testid="text-open-world-character-derived-stats"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-accent" aria-hidden="true" />派生战斗属性
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
          {character.derivedStats.map(stat => <details
            key={stat.semantic}
            className="min-w-0 rounded border border-border/70 bg-bg-base/70 p-3"
            data-testid="text-open-world-character-stat-breakdown"
          >
            <summary className="cursor-pointer list-none">
              <span className="flex items-baseline justify-between gap-2">
                <strong className="text-xs">{stat.label}</strong>
                <b className="font-mono text-base text-accent">{stat.displayValue}</b>
              </span>
              <small className="mt-1 block text-text-muted">展开查看数值来源</small>
            </summary>
            <ul className="mt-3 grid gap-1 border-t border-border/70 pt-2 text-[10px] text-text-muted">
              {stat.sources.map((source, index) => <li
                key={`${source.kind}:${source.label}:${index}`}
                className="flex min-w-0 justify-between gap-2"
              >
                <span className="min-w-0 break-words">{source.label}</span>
                <strong className="shrink-0 font-mono text-text-primary">{signed(source.value, source.displayValue)}</strong>
              </li>)}
            </ul>
          </details>)}
        </div>
      </article>
    </div>

    <article
      className="rounded border border-border bg-bg-surface p-4"
      data-testid="text-open-world-character-skills"
      data-open-world-ui-key="overlay.skills"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <WandSparkles className="h-4 w-4 text-accent" aria-hidden="true" />技能
      </div>
      <p className="mt-1 text-[10px] text-text-muted">
        技能效果由已发布规则确定；“条件就绪”只表示资源、冷却和公开使用条件满足，实际能否施放仍由战斗回合判定。
      </p>
      <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
        {character.skills.map((skill, index) => <section
          key={`${skill.title}:${index}`}
          className="grid min-w-0 gap-2 rounded border border-border/70 bg-bg-base/70 p-3"
          data-skill-state={skill.learned ? 'learned' : 'locked'}
        >
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <strong className="break-words text-sm">{skill.title}</strong>
              <small className="mt-1 block text-text-muted">{skill.activationLabel} · {skill.kindLabel} · {skill.targetLabel}</small>
            </div>
            <span className={skill.learned
              ? 'rounded-full bg-accent/15 px-2 py-1 text-[9px] text-accent'
              : 'rounded-full bg-bg-elevated px-2 py-1 text-[9px] text-text-muted'}>
              {skill.stateLabel}
            </span>
          </header>
          <p className="m-0 break-words text-xs leading-5 text-text-muted">{skill.description}</p>
          {!!skill.tags.length && <div className="flex flex-wrap gap-1" aria-label="技能标签">
            {skill.tags.map(tag => <span key={tag} className="rounded border border-border px-2 py-0.5 text-[8px] text-text-muted">{tag}</span>)}
          </div>}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
            <div><dt className="inline text-text-muted">状态：</dt><dd className="inline">{skill.availabilityLabel}</dd></div>
            <div><dt className="inline text-text-muted">消耗：</dt><dd className="inline">{skill.resourceCost ? `${skill.resourceCost} 技能资源` : '无'}</dd></div>
            <div><dt className="inline text-text-muted">规则冷却：</dt><dd className="inline">{skill.cooldownTurns ? `${skill.cooldownTurns} 回合` : '无'}</dd></div>
            {skill.learned && skill.activationLabel === '主动技能' && <div>
              <dt className="inline text-text-muted">当前冷却：</dt>
              <dd className="inline">{skill.cooldownRemainingTurns ? `剩余 ${skill.cooldownRemainingTurns} 回合` : '已结束'}</dd>
            </div>}
            {skill.scalingAttributeLabel && <div className="col-span-2"><dt className="inline text-text-muted">成长属性：</dt><dd className="inline">{skill.scalingAttributeLabel}</dd></div>}
          </dl>
          {!!skill.unavailableReasons.length && <p className="m-0 rounded border border-warning/25 bg-warning/5 px-2 py-1 text-[9px] text-warning">
            {skill.unavailableReasons.join('；')}
          </p>}
          <div className="border-t border-border/70 pt-2">
            <small className="text-text-muted">可能获得方式</small>
            <ul className="mt-1 grid gap-1 text-[10px]">
              {skill.acquisition.map((source, sourceIndex) => <li key={`${source.kind}:${sourceIndex}`}>· {source.label}</li>)}
            </ul>
          </div>
        </section>)}
        {!character.skills.length && <p className="text-xs text-text-muted">这个世界尚未发布技能。</p>}
      </div>
    </article>

    <article
      className="rounded border border-border bg-bg-surface p-4"
      data-testid="text-open-world-character-statuses"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <BookOpen className="h-4 w-4 text-accent" aria-hidden="true" />当前状态
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {character.statuses.map((status, index) => <section
          key={`${status.title}:${index}`}
          className="rounded border border-border/70 bg-bg-base/70 p-3"
        >
          <span className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-xs">{status.title}</strong>
            <small className="rounded-full border border-border px-2 py-0.5 text-[8px] text-accent">{status.polarityLabel}</small>
          </span>
          <p className="mt-2 break-words text-[10px] leading-5 text-text-muted">{status.description}</p>
        </section>)}
        {!character.statuses.length && <p className="text-xs text-text-muted">当前没有持续状态。</p>}
      </div>
    </article>
  </section>
}
