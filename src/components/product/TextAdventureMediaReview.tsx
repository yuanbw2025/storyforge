import { useEffect, useState } from 'react'
import {
  readTextAdventureMediaAssetBytesV1,
  type ProductProductionReviewArtifactV1,
  type TextAdventureMediaAssetV1,
} from '../../lib/product-production/service'
import { isTextAdventureReadableGlyphViolationV1 } from '../../lib/product-production/text-adventure-quality'
import type { WorkspaceScope } from '../../lib/types'

export function visualReviewRepairTargets(artifact: ProductProductionReviewArtifactV1 | undefined): Array<{
  artifactKey: string
  verdict: string
  issues: Array<{ severity: string; category: string; detail: string; recommendation: string }>
}> {
  if (!artifact?.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) return []
  const reviews = (artifact.payload as Record<string, unknown>).reviews
  if (!Array.isArray(reviews)) return []
  return reviews.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const row = value as Record<string, unknown>
    if (typeof row.artifactKey !== 'string' || !Array.isArray(row.issues)) return []
    const issues = row.issues.flatMap(issueValue => {
      if (!issueValue || typeof issueValue !== 'object' || Array.isArray(issueValue)) return []
      const issue = issueValue as Record<string, unknown>
      return typeof issue.severity === 'string' && typeof issue.category === 'string'
        && typeof issue.detail === 'string' && typeof issue.recommendation === 'string'
        ? [{
            severity: isTextAdventureReadableGlyphViolationV1(issue) ? 'blocking' : issue.severity,
            category: issue.category,
            detail: issue.detail,
            recommendation: issue.recommendation,
          }]
        : []
    })
    const verdict = String(row.verdict ?? '')
    return verdict === 'revise' || verdict === 'replace' || verdict === 'human-review'
      || issues.some(issue => issue.severity === 'blocking')
      ? [{ artifactKey: row.artifactKey, verdict, issues }]
      : []
  })
}

export function TextAdventureMediaThumbnail(props: { scope: WorkspaceScope; asset: TextAdventureMediaAssetV1 }) {
  const identity = `${props.scope.projectId}:${props.scope.worldId}:${props.scope.workId}:`
    + `${props.asset.assetKey}:${props.asset.blobObjectId}:${props.asset.contentHash}`
  const [loaded, setLoaded] = useState<{ identity: string; url: string } | null>(null)
  const [failedIdentity, setFailedIdentity] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  useEffect(() => {
    let active = true
    let objectUrl = ''
    setFailedIdentity(null)
    setExpanded(false)
    void readTextAdventureMediaAssetBytesV1({ scope: props.scope, asset: props.asset })
      .then(data => {
        if (!active) return
        objectUrl = URL.createObjectURL(new Blob([data], { type: props.asset.mimeType }))
        setLoaded({ identity, url: objectUrl })
      })
      .catch(() => { if (active) setFailedIdentity(identity) })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [identity, props.asset, props.scope])
  useEffect(() => {
    if (!expanded) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [expanded])
  const url = loaded?.identity === identity ? loaded.url : ''
  if (failedIdentity === identity) return <div className="flex min-h-40 items-center justify-center bg-error/5 text-[10px] text-error">图片校验失败</div>
  if (!url) return <div className="flex min-h-40 items-center justify-center bg-bg-surface text-[10px] text-text-muted">正在校验图片…</div>
  const altText = String(props.asset.metadata.altText ?? '')
  return <>
    <div className="relative flex min-h-40 items-center justify-center bg-bg-surface p-2">
      <img src={url} alt={altText} className="max-h-[32rem] w-full object-contain" data-testid={`text-adventure-media-image-${props.asset.artifactKey}`} />
      <button type="button" onClick={() => setExpanded(true)} className="absolute bottom-3 right-3 rounded border border-border bg-bg-base/90 px-2 py-1 text-[10px] text-text-primary shadow" aria-label={`放大查看 ${props.asset.artifactKey}`}>放大原图</button>
    </div>
    {expanded && <div role="dialog" aria-modal="true" aria-label={`${props.asset.artifactKey} 原图审查`} className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4" data-testid={`text-adventure-media-lightbox-${props.asset.artifactKey}`}>
      <div className="mb-3 flex items-center justify-between gap-3 text-xs text-white"><span>{props.asset.artifactKey} · 原比例完整图</span><div className="flex gap-2"><a href={url} target="_blank" rel="noreferrer" className="rounded border border-white/40 px-3 py-1.5">新窗口打开</a><button type="button" onClick={() => setExpanded(false)} className="rounded border border-white/40 px-3 py-1.5">关闭</button></div></div>
      <img src={url} alt={altText} className="min-h-0 flex-1 object-contain" />
    </div>}
  </>
}

interface MediaRequirementDisplayV1 {
  artifactKey: string
  mediaKind: string
  sceneTag: string
  beatKey: string
  prompt: string
  altText: string
  width: number
  height: number
  characterAnchorRefs: string[]
  hardConstraints: string[]
}

export function mediaRequirementDisplay(
  artifacts: ProductProductionReviewArtifactV1[],
): Map<string, MediaRequirementDisplayV1> {
  const artifact = artifacts.find(item => item.artifactKey === 'media.requirements')
  if (!artifact?.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) return new Map()
  const visual = (artifact.payload as Record<string, unknown>).visual
  if (!Array.isArray(visual)) return new Map()
  return new Map(visual.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    if (typeof item.artifactKey !== 'string' || typeof item.mediaKind !== 'string'
      || typeof item.sceneTag !== 'string' || typeof item.beatKey !== 'string'
      || typeof item.prompt !== 'string' || typeof item.altText !== 'string'
      || !Number.isFinite(item.width) || !Number.isFinite(item.height)
      || !Array.isArray(item.characterAnchorRefs) || !Array.isArray(item.hardConstraints)) return []
    return [[item.artifactKey, {
      artifactKey: item.artifactKey, mediaKind: item.mediaKind,
      sceneTag: item.sceneTag, beatKey: item.beatKey, prompt: item.prompt, altText: item.altText,
      width: Number(item.width), height: Number(item.height),
      characterAnchorRefs: item.characterAnchorRefs.filter((key): key is string => typeof key === 'string'),
      hardConstraints: item.hardConstraints.filter((rule): rule is string => typeof rule === 'string'),
    }] as const]
  }))
}

interface MediaVisualReviewDisplayV1 {
  verdict: string
  scores: Record<string, number> | null
  issues: Array<{ severity: string; category: string; detail: string; recommendation: string }>
}

export function mediaVisualReviewDisplay(
  artifacts: ProductProductionReviewArtifactV1[],
): Map<string, MediaVisualReviewDisplayV1> {
  const artifact = artifacts.find(item => item.artifactKey === 'quality.visual-review')
  if (!artifact?.payload || typeof artifact.payload !== 'object' || Array.isArray(artifact.payload)) return new Map()
  const reviews = (artifact.payload as Record<string, unknown>).reviews
  if (!Array.isArray(reviews)) return new Map()
  return new Map(reviews.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return []
    const item = value as Record<string, unknown>
    if (typeof item.artifactKey !== 'string' || typeof item.verdict !== 'string' || !Array.isArray(item.issues)) return []
    const scores = item.scores && typeof item.scores === 'object' && !Array.isArray(item.scores)
      ? Object.fromEntries(Object.entries(item.scores as Record<string, unknown>)
          .filter((entry): entry is [string, number] => typeof entry[1] === 'number')) : null
    const issues = item.issues.flatMap(issueValue => {
      if (!issueValue || typeof issueValue !== 'object' || Array.isArray(issueValue)) return []
      const issue = issueValue as Record<string, unknown>
      return typeof issue.severity === 'string' && typeof issue.category === 'string'
        && typeof issue.detail === 'string' && typeof issue.recommendation === 'string'
        ? [{ severity: issue.severity, category: issue.category, detail: issue.detail, recommendation: issue.recommendation }]
        : []
    })
    return [[item.artifactKey, { verdict: item.verdict, scores, issues }] as const]
  }))
}

export function mediaArtifactPurposeLabel(artifactKey: string): string {
  return ({
    'media.visual.001': '封面与开场背景', 'media.visual.002': '主角视觉锚点',
    'media.visual.003': '区域地图', 'media.visual.004': '第一幕主线转折 CG',
    'media.visual.005': '次级区域锚点', 'media.visual.006': '第一件重要物品',
    'media.visual.007': '核心配角视觉锚点', 'media.visual.008': '第二幕主线转折 CG',
    'media.visual.009': '辅助角色视觉锚点', 'media.visual.010': '第三幕主线转折 CG',
    'media.visual.011': '第二件重要物品', 'media.visual.012': '结局后果 CG',
  } as Record<string, string>)[artifactKey] ?? '插图职责'
}

export function TextAdventureMediaEvidence({ asset, requirement, visualReview }: {
  asset: TextAdventureMediaAssetV1
  requirement?: MediaRequirementDisplayV1
  visualReview?: MediaVisualReviewDisplayV1
}) {
  const actualWidth = Number(asset.metadata.width ?? 0)
  const actualHeight = Number(asset.metadata.height ?? 0)
  return <div className="mt-3 grid gap-2 rounded border border-border bg-bg-surface p-3" data-testid={`text-adventure-media-contract-${asset.artifactKey}`}>
    <p><strong>职责：</strong>{mediaArtifactPurposeLabel(asset.artifactKey)} · {requirement?.mediaKind ?? asset.mediaKind}</p>
    <p><strong>场景 / 节拍：</strong>{requirement?.sceneTag ?? String(asset.metadata.sceneTag ?? '—')} / {requirement?.beatKey ?? '—'}</p>
    <p><strong>请求 / 实际尺寸：</strong>{requirement ? `${requirement.width}×${requirement.height}` : '—'} / {actualWidth > 0 && actualHeight > 0 ? `${actualWidth}×${actualHeight}` : '—'}</p>
    <p><strong>替代文本：</strong>{requirement?.altText ?? String(asset.metadata.altText ?? '—')}</p>
    <p><strong>角色锚点：</strong>{requirement?.characterAnchorRefs.join('、') || '无'}</p>
    <div><strong>硬约束：</strong>{requirement?.hardConstraints.length ? <ul className="mt-1 grid gap-1 text-text-muted">{requirement.hardConstraints.map(rule => <li key={rule}>· {rule}</li>)}</ul> : <span className="text-text-muted">无</span>}</div>
    <div className={`rounded border p-2 ${visualReview?.verdict === 'accept' ? 'border-success/30 bg-success/5' : 'border-accent/30 bg-accent/5'}`}>
      <p><strong>Visual QA：</strong>{visualReview?.verdict ?? '等待审查'}</p>
      {visualReview?.scores && (
        <dl className="mt-1 grid grid-cols-2 gap-1 text-text-muted">
          {Object.entries(visualReview.scores).map(([key, score]) => (
            <div key={key}>
              <dt className="inline">{key}</dt>
              <dd className="ml-1 inline font-semibold text-text-primary">{score}/5</dd>
            </div>
          ))}
        </dl>
      )}
      {visualReview?.issues.length ? (
        <ul className="mt-2 grid gap-1">
          {visualReview.issues.map((issue, index) => (
            <li key={`${issue.category}:${index}`} className={issue.severity === 'blocking' ? 'text-error' : 'text-accent'}>
              <strong>{issue.severity} · {issue.category}：</strong>{issue.detail}
              <span className="block pl-3 text-text-muted">建议：{issue.recommendation}</span>
            </li>
          ))}
        </ul>
      ) : visualReview && <p className="mt-1 text-success">未报告问题</p>}
    </div>
  </div>
}
