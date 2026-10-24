import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {CHAT_UPGRADE_BLOCKER_LABELS_V1} from '../../lib/character-interaction/release-upgrade-contract'
import {readChatReleaseUpgradePlanV1, type ChatReleaseUpgradePlanV1} from '../../lib/character-interaction/release-upgrade-plan'
import {copyChatSaveToReleaseV1} from '../../lib/character-interaction/release-upgrade'
import ExperienceInfo from './ExperienceInfo'

const blockers: Record<ChatReleaseUpgradePlanV1['blockers'][number], string> = {
  'closed-save': '这个存档已结束或归档，请继续使用原存档。',
  'unfinished-run': '还有未结束或结果待确认的生成任务，请先在原存档恢复或取消。',
  'pending-edit': '请先完成或取消原存档中的历史改写。',
  'pending-situation': '请先在原存档完成当前新情境的处理。',
}
const changes = {title: '作品名称', description: '作品介绍', pictures: '图片', 'release-metadata': '版本说明'}

export default function ReleaseUpgrade({scope, sessionId, disabled, releases, rollback, onCopied, onRollback}: {
  scope: WorkspaceScope; sessionId: number; disabled: boolean
  releases: Array<{id: number; title: string; version: number}>
  rollback?: {id: number; title: string}
  onCopied: (sessionId: number) => Promise<void>
  onRollback: (sessionId: number) => Promise<void>
}) {
  const [target, setTarget] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<{plan: ChatReleaseUpgradePlanV1; commandId: string} | null>(null)
  const generation = useRef(0), working = useRef(false)
  useEffect(() => () => {generation.current++}, [])
  const act = async (operation: (generation: number) => Promise<void>) => {
    if (disabled || working.current) return
    const id = generation.current
    working.current = true; setBusy(true); setError('')
    try {await operation(id)}
    catch (cause) {if (generation.current === id) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (generation.current === id) {working.current = false; setBusy(false)}}
  }
  if (!releases.length && !rollback) return null
  return <details aria-label="存档版本升级" className="my-3 min-w-0 rounded border border-border p-3 text-xs">
    <summary>为当前存档检查新版本</summary>
    {rollback && <div className="my-3"><p>原存档：{rollback.title}。返回后继续原来的进度，副本中的新对话仍单独保留。</p>
      <button type="button" className="lf-action" disabled={disabled || busy} onClick={() => void act(async id => {if (generation.current === id) await onRollback(rollback.id)})}>返回原存档</button></div>}
    {releases.length > 0 && <><label className="my-3 block">目标版本<select aria-label="升级目标版本" className="block max-w-full" value={target} disabled={disabled || busy}
      onChange={event => {generation.current++; setTarget(event.target.value); setPreview(null); setError('')}}>
      <option value="">选择已安装版本</option>{releases.map(release => <option key={release.id} value={release.id}>{release.title} · 本机版本 {release.version}</option>)}
    </select></label>
    <button type="button" className="lf-action" disabled={disabled || busy || !releases.some(release => String(release.id) === target)} onClick={() => void act(async id => {
      setPreview(null)
      const plan = await readChatReleaseUpgradePlanV1({scope, parentSessionId: sessionId, targetReleaseId: Number(target)})
      if (generation.current === id) setPreview({plan, commandId: `chat.upgrade:${crypto.randomUUID()}`})
    })}>检查存档兼容性</button></>}
    {busy && <p role="status">正在检查或保存存档副本…</p>}
    {error && <p role="alert">{error}</p>}
    {preview && <section aria-label="存档升级预览" className="my-3 space-y-2">
      <p>原存档：{preview.plan.sourceTitle}；目标：{preview.plan.targetTitle}。</p>
      {'sourceExperienceInfo' in preview.plan.compatibility && <div className="space-y-3">
        <section aria-label="原版本作品说明"><p>原版本作品说明</p><ExperienceInfo value={preview.plan.compatibility.sourceExperienceInfo}/></section>
        <section aria-label="目标版本作品说明"><p>目标版本作品说明</p><ExperienceInfo value={preview.plan.compatibility.targetExperienceInfo}/></section>
      </div>}
      {preview.plan.compatibility.changes.length > 0 && <p>版本变化：{preview.plan.compatibility.changes.map(change => changes[change]).join('、')}。</p>}
      {preview.plan.canCopy ? <>
        <p>可以创建保留已有对话、记忆、关系和剧情进展的新副本。原存档保持原版本；不会自动生成新的剧情。</p>
        <p>未发送草稿留在原存档。已有旧消息若需改写，请返回原存档；新对话在副本中继续。</p>
        <button type="button" className="lf-action lf-action-primary" disabled={disabled || busy} onClick={() => void act(async id => {
          const child = await copyChatSaveToReleaseV1({scope, title: `${preview.plan.sourceTitle.slice(0, 180)} · 新版本副本`,
            request: {parentSessionId: sessionId, targetReleaseId: preview.plan.targetReleaseId, expectedPlanHash: preview.plan.planHash, commandId: preview.commandId}})
          if (generation.current === id) await onCopied(child.id!)
        })}>确认创建升级副本</button>
      </> : <>
        <p>{preview.plan.compatibility.disposition === 'same-version' ? '已经是同一版本，无需升级。' : '当前不能承接到这个版本。可以继续原存档，或从目标版本开始新故事。'}</p>
        <ul>{preview.plan.compatibility.blockers.map(reason => <li key={reason}>{CHAT_UPGRADE_BLOCKER_LABELS_V1[reason]}</li>)}
          {preview.plan.blockers.map(reason => <li key={reason}>{blockers[reason]}</li>)}</ul>
      </>}
      <button type="button" className="lf-action" disabled={busy} onClick={() => {generation.current++; setPreview(null); setError('')}}>取消升级</button>
    </section>}
  </details>
}
