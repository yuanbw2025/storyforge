import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, LoaderCircle, Rocket, ShieldCheck } from 'lucide-react'
import type { WorkspaceScope } from '../../lib/types'
import {
  prepareTextOpenWorldCreatorReleaseV1,
  publishTextOpenWorldCreatorReleaseV1,
  type PreparedTextOpenWorldCreatorPublicationV1,
  type TextOpenWorldCreatorPublicationAcknowledgementV1,
} from '../../lib/open-world/creator-release'
import type { ProductProductionPublishReceiptV1 } from '../../lib/product-production/adoption'

const EMPTY_ACKNOWLEDGEMENT: TextOpenWorldCreatorPublicationAcknowledgementV1 = {
  sourceAndRightsReviewed: false,
  buildAndQualityReviewed: false,
  immutableReleaseReviewed: false,
  publishNow: false,
}

const ACKNOWLEDGEMENT_ROWS: Array<{
  key: keyof TextOpenWorldCreatorPublicationAcknowledgementV1
  label: string
  description: string
}> = [
  { key: 'sourceAndRightsReviewed', label: '来源与权利已复核', description: '确认冻结的世界版本或小说 SourcePin、作者权利依据与实际读取清单正确。' },
  { key: 'buildAndQualityReviewed', label: 'Build 与质量证据已复核', description: '确认装配报告、灰盒试玩、问题处置和 G5-09 最终质量回执属于当前 Build。' },
  { key: 'immutableReleaseReviewed', label: '不可变版本规则已理解', description: '发布会创建不可变 ProductRelease；后续修复必须生成新 Build 和新版本。' },
  { key: 'publishNow', label: '立即正式发布', description: '确认现在执行最终 CAS 复验、媒资固化和原子发布。' },
]

function compactHash(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

export default function TextOpenWorldCreatorReleaseStudio(props: {
  scope: WorkspaceScope
  productionId: number
  buildId: number
  refreshToken: string
  disabled?: boolean
  onPublished: (receipt: ProductProductionPublishReceiptV1) => void | Promise<void>
}) {
  const [prepared, setPrepared] = useState<PreparedTextOpenWorldCreatorPublicationV1 | null>(null)
  const [releaseLabel, setReleaseLabel] = useState('')
  const [acknowledgement, setAcknowledgement] = useState(EMPTY_ACKNOWLEDGEMENT)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receipt, setReceipt] = useState<ProductProductionPublishReceiptV1 | null>(null)
  const loadGeneration = useRef(0)
  const authorizationNonce = useRef(crypto.randomUUID())

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current
    setLoading(true)
    setError('')
    try {
      const next = await prepareTextOpenWorldCreatorReleaseV1({
        scope: props.scope, productionId: props.productionId, expectedBuildId: props.buildId,
      })
      if (generation !== loadGeneration.current) return
      setPrepared(next)
      setReleaseLabel(`${next.title} v${next.releaseVersion}`)
      setAcknowledgement(EMPTY_ACKNOWLEDGEMENT)
      setReceipt(null)
      authorizationNonce.current = crypto.randomUUID()
    } catch (cause) {
      if (generation !== loadGeneration.current) return
      setPrepared(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }, [props.buildId, props.productionId, props.scope])

  useEffect(() => {
    void load()
    return () => { loadGeneration.current += 1 }
  }, [load, props.refreshToken])

  const allAcknowledged = useMemo(
    () => Object.values(acknowledgement).every(Boolean),
    [acknowledgement],
  )

  const publish = async () => {
    if (!prepared) return
    setBusy(true)
    setError('')
    try {
      const result = await publishTextOpenWorldCreatorReleaseV1({
        scope: props.scope,
        productionId: props.productionId,
        prepared,
        releaseLabel,
        acknowledgement,
        authorizationNonce: authorizationNonce.current,
      })
      setReceipt(result.receipt)
      await props.onPublished(result.receipt)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  return <section className="mt-5 rounded border border-success/30 bg-bg-elevated p-5" data-testid="text-open-world-creator-release-studio">
    <div className="flex items-center gap-2"><Rocket className="h-4 w-4 text-success" /><h2 className="text-sm font-semibold">正式发布 ProductRelease</h2></div>
    <p className="mt-2 text-[10px] leading-5 text-text-muted">发布前重新读取完整权威链，并在一个事务中冻结来源、受治理产物、装配报告、质量回执、媒资与作者授权。</p>
    {loading && <p className="mt-4 flex items-center gap-2 text-xs text-text-muted" role="status"><LoaderCircle className="h-4 w-4 animate-spin" />正在复验发布候选…</p>}
    {error && <p className="mt-4 rounded border border-error/30 bg-error/5 p-3 text-xs text-error" role="alert">{error}</p>}
    {prepared && !receipt && <>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3" data-testid="text-open-world-creator-release-evidence">
        {[
          ['来源', prepared.creatorRelease.sourceKind === 'world-release' ? '冻结 WorldRelease' : '小说 SourcePin'],
          ['下一版本', `v${prepared.releaseVersion}`], ['Build', `#${prepared.intent.buildNumber}`],
          ['Build Manifest', compactHash(prepared.intent.manifestHash)], ['RuntimePackage', compactHash(prepared.intent.packageHash)],
          ['SourcePin', compactHash(prepared.creatorRelease.sourcePinHash)], ['SourceManifest', compactHash(prepared.creatorRelease.sourceManifestHash)],
          ['Artifact 集合', compactHash(prepared.creatorRelease.artifactSetHash)], ['装配报告', compactHash(prepared.creatorRelease.integrationReportHash)],
          ['治理快照', compactHash(prepared.creatorRelease.governanceSnapshotHash)], ['最终质量回执', compactHash(prepared.creatorRelease.releaseQualityReceiptHash)],
          ['媒资', `${prepared.mediaAssetKeys.length} 项`],
        ].map(([label, value]) => <div key={label} className="rounded bg-bg-base p-3 text-[10px]"><span className="block text-text-muted">{label}</span><code className="mt-1 block break-all text-text-primary">{value}</code></div>)}
      </div>
      <label className="mt-4 block text-xs text-text-muted">发布名称<input aria-label="Creator Release 发布名称" maxLength={500} value={releaseLabel} onChange={event => setReleaseLabel(event.target.value)} className="mt-2 block w-full rounded border border-border bg-bg-base p-3 text-text-primary" /></label>
      <fieldset className="mt-4 grid gap-2" disabled={busy || props.disabled}>
        <legend className="mb-2 flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="h-4 w-4 text-success" />作者最终确认</legend>
        {ACKNOWLEDGEMENT_ROWS.map(row => <label key={row.key} className="flex gap-3 rounded border border-border bg-bg-base p-3 text-xs">
          <input type="checkbox" checked={acknowledgement[row.key]} onChange={event => setAcknowledgement(current => ({ ...current, [row.key]: event.target.checked }))} />
          <span><strong className="block text-text-primary">{row.label}</strong><span className="mt-1 block text-[10px] leading-5 text-text-muted">{row.description}</span></span>
        </label>)}
      </fieldset>
      <button type="button" disabled={busy || props.disabled || !allAcknowledged || !releaseLabel.trim()} onClick={() => void publish()} className="mt-4 flex items-center gap-2 rounded bg-success px-4 py-2 text-xs text-white disabled:opacity-40">
        {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}复验并原子发布 v{prepared.releaseVersion}
      </button>
    </>}
    {receipt && <div className="mt-4 rounded border border-success/30 bg-success/5 p-4 text-xs text-success" data-testid="text-open-world-creator-release-success">
      <strong className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />ProductRelease v{receipt.releaseVersion} 已发布</strong>
      <p className="mt-2">玩家运行时将读取不可变 Release；后续修复不会改写这一版本。</p><code className="mt-2 block break-all">{receipt.releaseContentHash}</code>
    </div>}
  </section>
}
