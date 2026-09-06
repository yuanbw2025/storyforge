import { Scale, UsersRound } from 'lucide-react'
import { parseTextOpenWorldModulesV1 } from '../../lib/open-world/modules'
import { projectTextOpenWorldRelationshipsV1 } from '../../lib/open-world/relationships'
import type { TextOpenWorldEffectStateV1, TextOpenWorldRuntimePackageV1 } from '../../lib/types'

export default function TextOpenWorldRelationshipsPanel(props: {
  runtimePackage: TextOpenWorldRuntimePackageV1
  state: TextOpenWorldEffectStateV1
}) {
  const modules = parseTextOpenWorldModulesV1(props.runtimePackage)
  const actorKeys = modules.actors.actors.filter(actor => {
    const runtime = props.state.actors[actor.key]
    return runtime?.alive && runtime.present && runtime.locationKey === props.state.map.currentLocationKey
  }).map(actor => actor.key)
  const relationship = projectTextOpenWorldRelationshipsV1({
    runtimePackage: props.runtimePackage,
    state: props.state,
    actorKeys,
    parsedModules: modules,
  })
  return <article className="rounded border border-border bg-bg-surface p-4" data-testid="text-open-world-relationships">
    <div className="mb-2 flex items-center gap-2 text-sm font-semibold"><Scale className="h-4 w-4 text-accent" />道德与关系</div>
    <p className="text-xs"><strong>道德值 {relationship.morality.value}</strong><span className="ml-2 text-text-muted">范围 {relationship.morality.minimum}～{relationship.morality.maximum}</span></p>
    <div className="mt-3 space-y-1">{relationship.factions.map(faction => <p key={faction.key} className="flex justify-between rounded bg-bg-base px-2 py-1 text-xs">
      <span className="flex items-center gap-1"><UsersRound className="h-3 w-3" />{faction.title}</span>
      <strong>亲合度 {faction.affinity}</strong>
    </p>)}</div>
    <div className="mt-3 space-y-2">{relationship.actors.map(actor => <div key={actor.actorKey} className="rounded border border-border/70 p-2 text-xs">
      <span className="flex justify-between gap-2"><strong>{actor.actorName}</strong><span>{actor.label}</span></span>
      <p className="mt-1 text-text-muted">问候语气：{actor.greetingTone}</p>
      <p className="mt-1 text-[10px] text-text-muted">影响：道德 {actor.reasons.morality} · 阵营 {actor.reasons.factionAffinity} · 已经历故事 {actor.reasons.experiencedStory}</p>
      <p className="mt-1 text-[10px] text-text-muted">交易：买入 ×{actor.buyPriceMultiplier} · 卖出 ×{actor.sellPriceMultiplier}{actor.optionalInteractionPolicy === 'may-refuse' ? ' · 可能拒绝非关键互动' : ''}</p>
    </div>)}</div>
    {!relationship.actors.length && <p className="mt-2 text-xs text-text-muted">当前位置没有可显示的角色关系。</p>}
  </article>
}
