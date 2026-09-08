import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Footprints,
  Heart,
  Package,
  RotateCcw,
  Shield,
  Sparkles,
  Swords,
} from 'lucide-react'
import type {
  TextOpenWorldPlayerCombatActionGroupV1,
  TextOpenWorldPlayerCombatActionV1,
  TextOpenWorldPlayerCombatProjectionV1,
} from '../../lib/open-world/player-combat'

export interface TextOpenWorldCombatActionRequestV1 {
  sessionId: number
  /** Submission guard only; never render this value. */
  combatInstanceKey: string
  expectedBaseSequence: number
  actionKey: string
  targetKey: string | null
}

interface TextOpenWorldCombatPanelProps {
  projection: TextOpenWorldPlayerCombatProjectionV1 | null
  synchronizing?: boolean
  busy: boolean
  onExecute(request: TextOpenWorldCombatActionRequestV1): void
  onRetry(): void
  onDismissResult(): void
}

const GROUPS: ReadonlyArray<{
  key: TextOpenWorldPlayerCombatActionGroupV1
  title: string
  description: string
  icon: typeof Swords
}> = [
  { key: 'attack', title: '普通攻击', description: '零资源消耗的稳定攻击', icon: Swords },
  { key: 'skill', title: '技能', description: '消耗资源，并遵循回合冷却', icon: Sparkles },
  { key: 'item', title: '道具', description: '消耗背包中的战斗道具', icon: Package },
  { key: 'escape', title: '逃跑', description: '按当前遭遇规则尝试脱离', icon: Footprints },
]

function percentage(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100)))
}

function actionMeta(action: TextOpenWorldPlayerCombatActionV1): string[] {
  const values: string[] = [...action.effectDetails]
  if (action.resourceCost > 0) values.push(`消耗 ${action.resourceCost} 点技能资源`)
  if (action.cooldownTurns > 0) values.push(`冷却 ${action.cooldownTurns} 回合`)
  if (action.cooldownRemainingTurns > 0) values.push(`剩余 ${action.cooldownRemainingTurns} 回合`)
  if (action.quantity != null) values.push(`持有 ${action.quantity}`)
  if (action.targetMode === 'all-enemies') values.push('作用于全部存活敌人')
  if (action.targetMode === 'self') values.push('作用于自身')
  return values
}

export default function TextOpenWorldCombatPanel({
  projection,
  synchronizing = false,
  busy,
  onExecute,
  onRetry,
  onDismissResult,
}: TextOpenWorldCombatPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const previousIdentityRef = useRef<string | null>(null)
  const announcementCursorRef = useRef<{ identity: string; sequence: number } | null>(null)
  const [selectedEnemy, setSelectedEnemy] = useState<{ identity: string; key: string } | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const identity = projection
    ? `${projection.operationIdentity.sessionId}:${projection.operationIdentity.combatInstanceKey ?? 'legacy'}`
    : null
  const selectedEnemyKey = selectedEnemy?.identity === identity
    && projection?.enemies.some(enemy => enemy.combatantKey === selectedEnemy.key && !enemy.defeated)
    ? selectedEnemy.key
    : null
  const latestLog = projection?.log[projection.log.length - 1] ?? null

  useEffect(() => {
    if (!identity || previousIdentityRef.current === identity) return
    previousIdentityRef.current = identity
    announcementCursorRef.current = {
      identity,
      sequence: latestLog?.eventSequence ?? projection?.operationIdentity.expectedBaseSequence ?? 0,
    }
    setAnnouncement('')
    queueMicrotask(() => headingRef.current?.focus())
  }, [identity, latestLog?.eventSequence, projection?.operationIdentity.expectedBaseSequence])

  useEffect(() => {
    if (!identity || !latestLog) return
    const cursor = announcementCursorRef.current
    if (!cursor || cursor.identity !== identity) {
      announcementCursorRef.current = { identity, sequence: latestLog.eventSequence }
      return
    }
    if (latestLog.eventSequence <= cursor.sequence) return
    announcementCursorRef.current = { identity, sequence: latestLog.eventSequence }
    setAnnouncement(latestLog.summary)
  }, [identity, latestLog])

  const actionsByGroup = useMemo(() => new Map(GROUPS.map(group => [
    group.key,
    projection?.actions.filter(action => action.group === group.key) ?? [],
  ])), [projection])

  if (synchronizing || !projection) return <section
    className="open-world-combat-panel is-synchronizing"
    data-testid="text-open-world-combat-panel"
    data-open-world-ui-key="overlay.combat"
    role="status"
    aria-live="polite"
  >
    <header className="open-world-combat-heading">
      <span><Shield aria-hidden="true" />战斗记录核对中</span>
      <small>正在等待同一 Session 的正式事件与状态对齐。</small>
    </header>
    <p>核对完成前不会开放按钮，也不会根据不完整数据猜测战斗结果。</p>
  </section>

  const execute = (action: TextOpenWorldPlayerCombatActionV1) => {
    const combatInstanceKey = projection.operationIdentity.combatInstanceKey
    if (!combatInstanceKey || !action.available || busy) return
    const targetKey = action.targetMode === 'single-enemy'
      ? selectedEnemyKey && action.validEnemyTargetKeys.includes(selectedEnemyKey) ? selectedEnemyKey : null
      : action.targetMode === 'fixed-item' ? action.fixedTargetKey : null
    if (action.targetMode === 'single-enemy' && !targetKey) return
    onExecute({
      sessionId: projection.operationIdentity.sessionId,
      combatInstanceKey,
      expectedBaseSequence: projection.operationIdentity.expectedBaseSequence,
      actionKey: action.actionKey,
      targetKey,
    })
  }

  return <section
    className={`open-world-combat-panel is-${projection.mode}`}
    data-testid="text-open-world-combat-panel"
    data-open-world-ui-key="overlay.combat"
    aria-labelledby="text-open-world-combat-title"
  >
    <div className="open-world-game-live-announcement" role="status" aria-live="polite" aria-atomic="true">
      {announcement}
    </div>

    <header className="open-world-combat-hero">
      <div>
        <span><Swords aria-hidden="true" />{projection.encounter.intensityLabel}</span>
        <h1 id="text-open-world-combat-title" ref={headingRef} tabIndex={-1}>{projection.encounter.title}</h1>
        <p>{projection.encounter.openingText}</p>
      </div>
      <dl>
        <div><dt>状态</dt><dd>{projection.phase.statusLabel}</dd></div>
        {projection.phase.round != null && <div><dt>回合</dt><dd>{projection.phase.round}</dd></div>}
        <div><dt>阶段</dt><dd>{projection.phase.phaseLabel}</dd></div>
        <div><dt>行动者</dt><dd>{projection.phase.actorLabel ?? '系统结算'}</dd></div>
        <div><dt>建议等级</dt><dd>{projection.encounter.recommendedLevel}</dd></div>
      </dl>
    </header>

    {projection.compatibility.notice && <aside className="open-world-combat-compatibility" role="note">
      {projection.compatibility.notice}
    </aside>}

    <div className="open-world-combat-board">
      <article className={`open-world-combat-player ${projection.player.activeActor ? 'is-active' : ''}`}>
        <header><strong>{projection.player.label}</strong><small>等级 {projection.player.level}</small></header>
        <label>
          <span><Heart aria-hidden="true" />生命 {projection.player.currentHealth}/{projection.player.maximumHealth}</span>
          <progress value={projection.player.currentHealth} max={projection.player.maximumHealth} />
          <small>{percentage(projection.player.healthRatio)}%</small>
        </label>
        <label>
          <span><Sparkles aria-hidden="true" />技能资源 {projection.player.skillResource}/{projection.player.maximumSkillResource}</span>
          <progress value={projection.player.skillResource} max={projection.player.maximumSkillResource} />
        </label>
        <div className="open-world-combat-statuses" aria-label="玩家状态">
          {projection.player.statuses.map((status, index) => <span
            key={`${status.title}:${index}`}
            data-polarity={status.polarity}
            title={[status.description, ...status.effectDetails].join('；')}
            aria-label={[status.title, ...status.effectDetails].join('；')}
          >
            {status.title}{status.stacks != null && status.stacks > 1 ? ` ×${status.stacks}` : ''}
            {status.remainingTurns != null ? ` · ${status.remainingTurns} 回合` : ''}
          </span>)}
          {!projection.player.statuses.length && <small>当前没有状态效果</small>}
        </div>
      </article>

      {projection.compatibility.turnState && <fieldset className="open-world-combat-enemies">
        <legend>选择敌人目标</legend>
        {projection.enemies.map((enemy, index) => {
          const inputId = `text-open-world-combat-target-${index}`
          return <label key={enemy.combatantKey} className={`${enemy.activeActor ? 'is-active' : ''} ${enemy.defeated ? 'is-defeated' : ''}`} htmlFor={inputId}>
            <input
              id={inputId}
              type="radio"
              name="text-open-world-combat-target"
              value={String(index)}
              checked={selectedEnemyKey === enemy.combatantKey}
              disabled={busy || enemy.defeated}
              onChange={() => identity && setSelectedEnemy({ identity, key: enemy.combatantKey })}
            />
            <span>
              <strong>{enemy.label}</strong>
              <small>等级 {enemy.level}{enemy.defeated ? ' · 已击败' : enemy.activeActor ? ' · 正在行动' : ''}</small>
            </span>
            <span className="open-world-combat-enemy-health">
              <span>生命 {enemy.currentHealth}/{enemy.maximumHealth}</span>
              <progress value={enemy.currentHealth} max={enemy.maximumHealth} />
              <small>{percentage(enemy.healthRatio)}%</small>
            </span>
            {enemy.description && <small>{enemy.description}</small>}
            {!!enemy.statuses.length && <span className="open-world-combat-statuses" aria-label={`${enemy.label}的状态`}>
              {enemy.statuses.map((status, statusIndex) => <span
                key={`${status.title}:${statusIndex}`}
                data-polarity={status.polarity}
                title={[status.description, ...status.effectDetails].join('；')}
                aria-label={[status.title, ...status.effectDetails].join('；')}
              >
                {status.title}{status.stacks != null && status.stacks > 1 ? ` ×${status.stacks}` : ''}
                {status.remainingTurns != null ? ` · ${status.remainingTurns} 回合` : ''}
              </span>)}
            </span>}
          </label>
        })}
        {!projection.enemies.length && <p>此版本没有可验证的敌人生命投影。</p>}
      </fieldset>}
    </div>

    {projection.phase.waitingForSettlement && !projection.compatibility.readOnly && <p className="open-world-combat-settling" role="status">
      {projection.phase.actorLabel && !projection.phase.playerTurn
        ? `${projection.phase.actorLabel}正在行动，系统会自动完成结算。`
        : '正在完成本回合的正式结算。'}
    </p>}

    {!projection.compatibility.readOnly && projection.result.status === 'none' && <section className="open-world-combat-actions" aria-label="战斗操作">
      {GROUPS.map(group => {
        const Icon = group.icon
        const actions = actionsByGroup.get(group.key) ?? []
        return <article key={group.key} data-action-group={group.key}>
          <header><span><Icon aria-hidden="true" /><strong>{group.title}</strong></span><small>{group.description}</small></header>
          <div>
            {actions.map((action, index) => {
              const reasons = [...action.unavailableReasons]
              const targetMissing = action.targetMode === 'single-enemy'
                && (!selectedEnemyKey || !action.validEnemyTargetKeys.includes(selectedEnemyKey))
              if (targetMissing) reasons.push('请先选择一名仍可行动的敌人。')
              const disabled = busy || !action.available || targetMissing
              const reasonId = `text-open-world-combat-${group.key}-reason-${index}`
              const meta = actionMeta(action)
              return <div key={action.actionKey}>
                <button
                  type="button"
                  disabled={disabled}
                  aria-describedby={reasons.length ? reasonId : undefined}
                  onClick={() => execute(action)}
                >
                  <strong>{action.label}</strong>
                  <span>{action.description}</span>
                  {!!meta.length && <small>{meta.join(' · ')}</small>}
                </button>
                {!!reasons.length && <small id={reasonId} className="open-world-combat-action-reason">{uniqueForRender(reasons).join('；')}</small>}
              </div>
            })}
            {!actions.length && <p>当前版本没有这一类可用操作。</p>}
          </div>
        </article>
      })}
    </section>}

    {!!projection.log.length && <section className="open-world-combat-log" aria-label="本场战斗记录">
      <header><strong>战斗记录</strong><small>仅显示本场已结算的正式事件</small></header>
      <ol>
        {projection.log.slice(-16).reverse().map(entry => <li key={entry.id} data-tone={entry.tone}>
          <div><span>{entry.round == null ? '结算' : `第 ${entry.round} 回合`}</span><p>{entry.summary}</p></div>
          {!!entry.details.length && <details>
            <summary>结算详情</summary>
            <ul>{entry.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
          </details>}
        </li>)}
      </ol>
    </section>}

    {projection.result.status !== 'none' && <section
      className={`open-world-combat-result is-${projection.result.status}`}
      data-testid="text-open-world-combat-result"
      role={projection.result.status === 'defeat' ? 'alert' : 'status'}
    >
      <header>
        <strong>{projection.result.status === 'defeat' ? '本次战斗失败' : projection.result.title}</strong>
        <small>{projection.phase.statusLabel}</small>
      </header>
      {projection.result.text && <p>{projection.result.text}</p>}
      {projection.result.status === 'victory' && <div className="open-world-combat-reward">
        <strong>{projection.reward.status === 'granted' ? projection.reward.title ?? '战斗奖励' : '战斗奖励'}</strong>
        {projection.reward.status === 'granted' ? <ul>
          {projection.reward.items.map((item, index) => <li key={`${item.kind}:${index}`}>{item.label}</li>)}
          {!projection.reward.items.length && <li>奖励已结算，本次没有可展示的数值变化。</li>}
        </ul> : projection.reward.status === 'settling'
          ? <p>奖励正在按正式记录结算，请稍候。</p>
          : projection.reward.status === 'none' ? <p>本场遭遇没有奖励。</p>
            : <p>此旧版记录无法证明实际奖励，不作推测。</p>}
      </div>}
      {projection.result.status === 'defeat' && <div className="open-world-combat-recovery" data-testid="text-open-world-defeat-recovery">
        <p>战前重试会保留这条失败时间线，并从战斗开始前建立新分支；复活会保留已经发生的消耗与事件，在所选安全点恢复。两者都不会使主线失败。</p>
        <div>
          <button type="button" disabled={busy || !projection.recovery.retryAvailable} onClick={onRetry}>
            <RotateCcw aria-hidden="true" />战前重试（新分支）
          </button>
          {projection.recovery.respawnActions.map(action => <button
            key={action.actionKey}
            type="button"
            disabled={busy || !action.available}
            onClick={() => {
              const combatInstanceKey = projection.operationIdentity.combatInstanceKey
              if (!combatInstanceKey || !action.available) return
              onExecute({
                sessionId: projection.operationIdentity.sessionId,
                combatInstanceKey,
                expectedBaseSequence: projection.operationIdentity.expectedBaseSequence,
                actionKey: action.actionKey,
                targetKey: null,
              })
            }}
          >
            <Heart aria-hidden="true" />{action.title}（保留进度）
          </button>)}
        </div>
        {projection.recovery.retryUnavailableReason && <small>{projection.recovery.retryUnavailableReason}</small>}
        {!projection.recovery.respawnActions.some(action => action.available) && <small>当前没有已解锁的安全复活点，仍可使用读档。</small>}
      </div>}
      {(projection.result.status === 'victory' || projection.result.status === 'escaped') && <button
        type="button"
        className="open-world-combat-return"
        disabled={busy || projection.reward.status === 'settling'}
        onClick={onDismissResult}
      >
        返回当前场景
      </button>}
    </section>}
  </section>
}

function uniqueForRender(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}
