import { useEffect, useMemo, useRef, useState } from 'react'
import { createLatestSnapshotReadQueue } from './latest-snapshot-read'
import type { WorkspaceScope } from '../../lib/types'
import { readMediaBlobObjectData } from '../../lib/product-production/media-blob-store'
import { readTextOpenWorldVisualReviewWorkspaceV1, recordTextOpenWorldVisualReviewV1 } from '../../lib/open-world/creator-quality'
import type { TextOpenWorldVisualDecisionV1 } from '../../lib/open-world/creator-visual-review-contract'

type Workspace = Awaited<ReturnType<typeof readTextOpenWorldVisualReviewWorkspaceV1>>
type Asset = Workspace['assets'][number]

function ReviewImage(props: { scope: WorkspaceScope; asset: Asset; onViewed: (key: string) => void }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const { projectId, worldId, workId } = props.scope
  const { blobObjectId, contentHash, mimeType, byteSize } = props.asset
  useEffect(() => {
    let active = true
    let created = ''
    setUrl(''); setError('')
    void readMediaBlobObjectData({
      scope: { projectId, worldId, workId }, blobObjectId, expected: { contentHash, mimeType, byteSize },
    }).then(bytes => {
      if (!active) return
      created = URL.createObjectURL(new Blob([bytes], { type: mimeType }))
      setUrl(created)
    }).catch(() => { if (active) setError('图片字节校验失败，请返修') })
    return () => { active = false; if (created) URL.revokeObjectURL(created) }
  }, [projectId, worldId, workId, blobObjectId, contentHash, mimeType, byteSize])
  if (error) return <p role="alert">{error}</p>
  if (!url) return <p>正在校验图片…</p>
  return <img src={url} alt={props.asset.alt} className="max-h-80 w-full object-contain"
    onLoad={() => props.onViewed(props.asset.artifactKey)} onError={() => setError('图片无法解码，请返修')} />
}

export default function TextOpenWorldVisualReview(props: {
  scope: WorkspaceScope; productionId: number; buildId: number; disabled?: boolean
  onChanged?: () => void | Promise<void>
}) {
  const { projectId, worldId, workId } = props.scope
  const scope = useMemo(() => ({ projectId, worldId, workId }), [projectId, worldId, workId])
  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [decisions, setDecisions] = useState<Record<string, TextOpenWorldVisualDecisionV1>>({})
  const [viewed, setViewed] = useState<Set<string>>(new Set())
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const request = useRef({ generation: 0 })
  const readQueue = useRef(createLatestSnapshotReadQueue())
  useEffect(() => {
    let active = true
    const token = request.current
    const queue = readQueue.current
    token.generation++; setBusy(false)
    setWorkspace(null); setError(''); setDecisions({}); setViewed(new Set()); setConfirmed(false)
    void queue.enqueue(async isCurrent => {
      try {
        const value = await readTextOpenWorldVisualReviewWorkspaceV1({
          scope, productionId: props.productionId, buildId: props.buildId,
        })
        if (active && isCurrent()) setWorkspace(value)
      } catch (cause) {
        if (active && isCurrent()) setError(cause instanceof Error ? cause.message : '图片审查暂不可用')
      }
    })
    return () => { active = false; token.generation++; queue.invalidate() }
  }, [scope, props.productionId, props.buildId, revision])
  const complete = workspace && workspace.assets.length > 0 && workspace.assets.every(asset => viewed.has(asset.artifactKey)
    && decisions[asset.artifactKey] && (decisions[asset.artifactKey].decision !== 'rejected'
      || decisions[asset.artifactKey].note.trim().length >= 5))
  const save = async () => {
    if (!workspace || !complete || !confirmed) return
    const id = request.current.generation
    setBusy(true); setError('')
    try {
      const result = await recordTextOpenWorldVisualReviewV1({
        scope, productionId: props.productionId, buildId: props.buildId,
        expectedAssetsHash: workspace.consistency.assetsHash,
        decisions: Object.values(decisions), characterConsistencyConfirmed: true,
        imagesActuallyViewed: true, noAutomationProxy: true,
      })
      if (request.current.generation !== id) return
      setWorkspace(result)
      await props.onChanged?.()
    } catch (cause) { if (request.current.generation === id) setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { if (request.current.generation === id) setBusy(false) }
  }
  return <section aria-label="图片人工确认" className="mt-5 rounded border border-border bg-bg-elevated p-4">
    <h2 className="text-sm font-semibold">图片人工确认</h2>
    <p className="mt-2 text-xs leading-5 text-text-muted">逐张检查头像、背景与 UI 图片；同一角色的外观请一起核对。
      基础检查只验证身份与消费绑定，视觉相似度由你判断。退回后可通过媒资工作台导入或生成新的子 Build。</p>
    {error && <p role="alert" className="mt-3 break-words text-xs text-error">{error}
      <button type="button" onClick={() => setRevision(value => value + 1)} className="ml-2 underline">重新核验</button></p>}
    {!workspace && !error && <p role="status" className="mt-3 text-xs">正在核验图片集合…</p>}
    {workspace && <>
      {workspace.assets.length === 0 && <p className="mt-3">当前 Build 没有需要逐图确认的图片。</p>}
      {workspace.consistency.issues.map(issue => <p className="mt-2 text-xs text-error" key={issue}>{issue}</p>)}
      <details className="mt-3 text-xs"><summary className="cursor-pointer">角色一致性检查组</summary>
        {workspace.consistency.characterGroups.map(group => <p key={group.characterKey} className="mt-2 break-all">
          {group.characterKey}：{group.artifactKeys.join('、')}
        </p>)}
        <p className="mt-2 text-text-muted">只纳入显式绑定到角色的图片；未标明角色的背景不推测其中人物身份。</p>
      </details>
      <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{workspace.assets.map(asset => <article
        key={asset.artifactKey} className="min-w-0 rounded border border-border bg-bg-base p-3 text-xs">
        <ReviewImage scope={scope} asset={asset} onViewed={key => setViewed(current => (
          current.has(key) ? current : new Set([...current, key])
        ))} />
        <strong className="mt-2 block break-all">{asset.alt}</strong>
        <p>{asset.width}×{asset.height} · {asset.mimeType}</p>
        <p className="break-all">{asset.source} · {asset.license}</p>
        <code className="block break-all text-[10px]">{asset.artifactKey} · {asset.contentHash.slice(0, 12)}</code>
        {!workspace.immutableRelease && <>
          <label className="mt-2 block">判断
            <select aria-label={`图片判断 ${asset.artifactKey}`} disabled={!viewed.has(asset.artifactKey) || busy || props.disabled}
              value={decisions[asset.artifactKey]?.decision ?? ''}
              onChange={event => setDecisions(current => ({ ...current, [asset.artifactKey]: {
                artifactKey: asset.artifactKey, decision: event.target.value as TextOpenWorldVisualDecisionV1['decision'],
                note: current[asset.artifactKey]?.note ?? '',
              } }))} className="ml-2 rounded border border-border bg-bg-base p-2">
              <option value="" disabled>请选择</option><option value="approved">接受</option><option value="rejected">退回</option>
            </select>
          </label>
          <textarea aria-label={`图片意见 ${asset.artifactKey}`} maxLength={2000}
            value={decisions[asset.artifactKey]?.note ?? ''} disabled={!decisions[asset.artifactKey] || busy}
            onChange={event => setDecisions(current => ({ ...current, [asset.artifactKey]: {
              ...current[asset.artifactKey], note: event.target.value,
            } }))} placeholder="退回时至少写五字说明原因" className="mt-2 w-full rounded border border-border bg-bg-base p-2" />
        </>}
      </article>)}</div>
      {workspace.receipt && <p role="status" className="mt-3 break-all text-xs">
        已冻结逐图回执：{workspace.receipt.status === 'passed' ? '全部接受' : '含退回图片'} · {workspace.receipt.receiptHash}
      </p>}
      {!workspace.immutableRelease && <><label className="mt-3 flex items-start gap-2 text-xs leading-5">
        <input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />
        我已亲自查看全部图片、核对角色一致性，并逐图记录判断；未使用自动化或模型代签。
      </label>
        <button type="button" disabled={!complete || !confirmed || busy || props.disabled || workspace.consistency.issues.length > 0}
          onClick={() => void save()} className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">
          冻结逐图确认回执
        </button></>}
    </>}
  </section>
}
