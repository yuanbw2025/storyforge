import { Store, UserRound } from 'lucide-react'
import { projectTextOpenWorldActorsV1 } from '../../lib/open-world/actors'
import { parseTextOpenWorldModulesV1 } from '../../lib/open-world/modules'
import type { TextOpenWorldEffectStateV1, TextOpenWorldRuntimePackageV1 } from '../../lib/types'
import type { TextOpenWorldPlayerMediaVisualV1 } from '../../lib/open-world/player-media'

const TIER_LABELS = {
  mainline: '主线角色',
  significant: '重要角色',
  resident: '常驻居民',
  transient: '临时人物',
} as const

const ATTITUDE_LABELS = { good: '友好', neutral: '一般', bad: '冷淡' } as const

export default function TextOpenWorldActorsPanel(props: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
  attitudeByActorKey: Record<string, 'bad' | 'neutral' | 'good'>
  portraitByActorKey?: Readonly<Record<string, TextOpenWorldPlayerMediaVisualV1>>
}) {
  const modules = parseTextOpenWorldModulesV1(props.runtimePackage)
  const actors = projectTextOpenWorldActorsV1({
    runtimePackage: props.runtimePackage,
    state: props.state,
    attitudeByActorKey: props.attitudeByActorKey,
  })
  return <article className="rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-current-actors">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><UserRound className="h-4 w-4 text-accent" />当前位置人物</div>
    <div className="space-y-2">{actors.map(actor => {
      const faction = actor.factionKey ? modules.actors.factions.find(item => item.key === actor.factionKey)?.title ?? actor.factionKey : '中立'
      const portrait = props.portraitByActorKey?.[actor.key]
      return <div key={actor.key} className="open-world-actor-card rounded bg-bg-base p-2 text-xs" data-actor-key={actor.key}>
        {portrait && <figure
          className="open-world-actor-portrait"
          data-media-slot={portrait.slotKey}
          data-media-fallback={!portrait.url ? 'true' : undefined}
        >
          {portrait.url
            ? <img src={portrait.url} alt={portrait.altText} data-asset-key={portrait.assetKey ?? undefined} />
            : <span aria-label={portrait.fallbackText}>{actor.name.slice(0, 1)}</span>}
        </figure>}
        <div className="open-world-actor-copy">
          <span className="flex flex-wrap items-center justify-between gap-2"><strong>{actor.name}</strong><small className="text-text-muted">{TIER_LABELS[actor.tier]}</small></span>
          <p className="mt-1 text-text-muted">{actor.activity} · {faction} · {ATTITUDE_LABELS[actor.attitude]}</p>
          <p className="mt-1 text-[10px] text-text-muted">问候语气：{actor.greetingTone}{actor.optionalInteractionPolicy === 'may-refuse' ? ' · 可能拒绝非关键互动' : ''}</p>
          {actor.availableServices.map(service => <p key={service.key} className="mt-1 flex items-center gap-1 text-accent"><Store className="h-3 w-3" />{service.title}（营业中）</p>)}
        </div>
      </div>
    })}{!actors.length && <p className="text-xs text-text-muted">当前没有可交互人物。</p>}</div>
  </article>
}
