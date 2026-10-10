import { useState } from 'react'
import type { TextAdventureContentRevisionV1 } from '../../lib/types'
import type { ProductProductionReviewArtifactV1 } from '../../lib/product-production/service'
import { parseTextAdventureContentRevisionV1 } from '../../lib/product-production/contracts'
import { isTextContentRevisionKeyV1 } from '../../lib/product-production/text-content-revision'
import { canonicalProductProductionJsonV2 } from '../../lib/product-production/hash'
import { downloadTextFile } from '../../lib/export/text-export'

export function parseTextAdventureRevisionFileV1(text: string, buildNumber: number): TextAdventureContentRevisionV1[] {
  if (text.length > 1_200_000) throw new Error('修订文件超过大小限制')
  const value = JSON.parse(text)
  if (value?.schema !== 'storyforge.text-adventure-content-revision' || value.version !== 1
    || value.buildNumber !== buildNumber || !Array.isArray(value.revisions)
    || value.revisions.length < 1 || value.revisions.length > 24
    || Object.keys(value).sort().join(',') !== 'buildNumber,revisions,schema,version') throw new Error('修订文件格式或原版本不匹配')
  const revisions = value.revisions.map(parseTextAdventureContentRevisionV1)
  if (revisions.some((item: TextAdventureContentRevisionV1) => !isTextContentRevisionKeyV1(item.artifactKey))
    || new Set(revisions.map((item: TextAdventureContentRevisionV1) => item.artifactKey)).size !== revisions.length) throw new Error('修订项目超出文字范围或重复')
  return revisions
}

export default function TextAdventureContentRevisionPanel(props: {
  buildNumber: number
  artifacts: ProductProductionReviewArtifactV1[]
  imageCount: number
  busy: boolean
  onSubmit: (revisions: TextAdventureContentRevisionV1[]) => void
}) {
  const [revisions, setRevisions] = useState<TextAdventureContentRevisionV1[]>([])
  const [error, setError] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const load = async (file: File) => {
    setError(''); setRevisions([]); setConfirmed(false)
    try {
      if (file.size > 2_400_000) throw new Error('修订文件超过大小限制')
      const parsed = parseTextAdventureRevisionFileV1(await file.text(), props.buildNumber)
      const changed = parsed.filter(revision => {
        const original = props.artifacts.find(row => row.artifactKey === revision.artifactKey)
        if (!original || original.contentHash !== revision.expectedArtifactHash || original.version !== revision.expectedArtifactVersion) throw new Error('原稿已变化，请重新下载当前版本')
        return canonicalProductProductionJsonV2(original.payload) !== canonicalProductProductionJsonV2(JSON.parse(revision.authorDraftJson))
      })
      if (!changed.length) throw new Error('文件没有内容修改')
      setRevisions(changed)
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }
  const download = () => {
    const revisions = props.artifacts.filter(row => isTextContentRevisionKeyV1(row.artifactKey)).map(row => ({
      artifactKey: row.artifactKey, expectedArtifactVersion: row.version, expectedArtifactHash: row.contentHash,
      note: '文字修订', authorDraftJson: JSON.stringify(row.payload, null, 2),
    }))
    downloadTextFile(JSON.stringify({ schema: 'storyforge.text-adventure-content-revision', version: 1,
      buildNumber: props.buildNumber, revisions }, null, 2), `文字修订-Build${props.buildNumber}.json`, 'application/json')
  }
  return <details className="mt-4 rounded border border-border bg-bg-base p-4" data-testid="text-adventure-batch-content-revision">
    <summary className="cursor-pointer text-xs font-semibold">修订定稿并保留插图（高级）</summary>
    <p className="mt-3 text-xs leading-6 text-text-muted">适用于调整故事文字、任务和选择，保留现有角色、地点及美术设计。导入修改稿后会创建新版本，重新校验正文、审校对白、检查连贯性与插图，并重跑自动游玩。旧版本和存档保留，真人验收仍需另行完成。</p>
    <button type="button" disabled={props.busy} onClick={download} className="mt-3 rounded border border-border px-3 py-2 text-xs">下载可编辑的当前定稿</button>
    <label className="mt-3 grid gap-2 text-xs">导入修订文件<input type="file" accept="application/json,.json" disabled={props.busy}
      aria-label="导入文字冒险修订文件" onChange={event => { const file = event.target.files?.[0]; if (file) void load(file); event.target.value = '' }} /></label>
    {error && <p role="alert" className="mt-3 text-xs text-error">{error}</p>}
    {revisions.length > 0 && <><p className="mt-3 text-xs">已载入 {revisions.length} 项修改，将保留 {props.imageCount} 张插图。</p>
      <ul className="mt-2 space-y-1 text-xs text-text-muted">{revisions.map(item => <li key={item.artifactKey}>{item.note}</li>)}</ul>
      <label className="mt-3 flex items-start gap-2 text-xs leading-6"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />本次保留原有插图与美术设计；我了解新版本仍需独立审图和真人验收。</label>
      <button type="button" disabled={props.busy || !confirmed} onClick={() => props.onSubmit(revisions)} className="mt-3 rounded bg-accent px-4 py-2 text-xs text-white disabled:opacity-40">创建修订版并重新审校</button>
    </>}
  </details>
}
