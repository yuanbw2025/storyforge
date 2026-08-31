import { useCallback, useEffect, useState } from 'react'
import {
  Gamepad2,
  GitBranch,
  Loader2,
  Rocket,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react'
import type {
  WorldGameProductionHandoffV2,
  WorldRelease,
  WorldRevision,
  WorkspaceScope,
} from '../../lib/types'
import type { WorldReleaseSection } from '../../lib/registry/types'
import { resolveScopeLike } from '../../lib/world-engine/scope'
import {
  createWorldRevision,
  diffWorldRevisions,
  listWorldReleases,
  listWorldRevisions,
  publishWorldRevision,
  WORLD_RELEASE_SECTIONS,
  worldReleaseSectionTables,
} from '../../lib/world-engine/releases'
import { useDialog } from '../shared/Dialog'

interface Props {
  projectId: number
  activeWorkId?: number | null
  onChanged: () => Promise<void> | void
  onOpenGameProduction: (handoff: WorldGameProductionHandoffV2) => void
}

export default function WorldNarrativeReleasePanel({
  projectId,
  activeWorkId,
  onChanged,
  onOpenGameProduction,
}: Props) {
  const dialog = useDialog()
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [revisions, setRevisions] = useState<WorldRevision[]>([])
  const [releases, setReleases] = useState<WorldRelease[]>([])
  const [revisionLabel, setRevisionLabel] = useState('')
  const [selectedReleaseId, setSelectedReleaseId] = useState<number | null>(null)
  const [selectedSections, setSelectedSections] = useState<Set<WorldReleaseSection>>(
    () => new Set(WORLD_RELEASE_SECTIONS.map(section => section.key)),
  )
  const [revisionDiff, setRevisionDiff] = useState<{
    added: string[]
    removed: string[]
    changed: string[]
  } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = useCallback(async () => {
    const resolved = await resolveScopeLike(projectId)
    const [revisionRows, releaseRows] = await Promise.all([
      listWorldRevisions(resolved),
      listWorldReleases(resolved),
    ])
    setScope(resolved)
    setRevisions(revisionRows)
    setReleases(releaseRows)
    setRevisionDiff(revisionRows.length > 1
      ? await diffWorldRevisions(revisionRows[1].id!, revisionRows[0].id!)
      : null)
    setSelectedReleaseId(previous => releaseRows.some(release => release.id === previous)
      ? previous
      : releaseRows[0]?.id ?? null)
  }, [projectId])

  useEffect(() => {
    void load().catch(cause => setMessage(cause instanceof Error ? cause.message : '读取世界版本失败'))
  }, [activeWorkId, load])

  const latestRevision = revisions[0] ?? null
  const latestRelease = releases[0] ?? null
  const selectedRelease = releases.find(release => release.id === selectedReleaseId) ?? null

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await action()
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      setBusy(false)
    }
  }

  const createRevision = () => run(async () => {
    if (!scope || selectedSections.size === 0) return
    await createWorldRevision({
      scope,
      label: revisionLabel,
      parentRevisionId: latestRevision?.id ?? null,
      selectedTables: [...selectedSections].flatMap(worldReleaseSectionTables),
    })
    setRevisionLabel('')
    setMessage('已冻结新的纯语义世界修订；上层产品、媒资和运行状态均未进入。')
    await load()
  })

  const publish = () => run(async () => {
    if (!latestRevision?.id) return
    const confirmed = await dialog.confirm({
      title: `发布修订 ${latestRevision.revision}？`,
      message: '发布后该 WorldRelease 保持不可变；后续草稿修改只会进入新修订。',
      confirmText: '发布世界版本',
    })
    if (!confirmed) return
    await publishWorldRevision(latestRevision.id)
    setMessage('不可变 WorldRelease 已发布，可在具体产品内引用。')
    await load()
    await onChanged()
  })

  const handoff = (productType: WorldGameProductionHandoffV2['productType']) => {
    if (!selectedRelease?.id) return
    onOpenGameProduction({
      schema: 'storyforge.world-game-production-handoff',
      version: 2,
      productType,
      worldReleaseId: selectedRelease.id,
      worldContentHash: selectedRelease.contentHash,
    })
  }

  return (
    <section className="sf-world-pipeline" aria-label="世界修订、发布与产品交接">
      <div className="sf-world-pipeline-heading">
        <div>
          <span className="sf-card-kicker"><GitBranch className="h-4 w-4" /> SEMANTIC WORLD RELEASE</span>
          <h3>冻结世界与交给具体产品</h3>
        </div>
        <span className="sf-project-status"><ShieldCheck className="h-3.5 w-3.5" />世界页不创建产品或运行实例</span>
      </div>

      <div className="sf-world-pipeline-grid">
        <div className="sf-world-pipeline-stage">
          <div className="sf-world-pipeline-stage-head"><span>1</span><div><strong>选择语义范围</strong><small>能力清单由 PROJECT_TABLES 的 worldSemantic 登记派生</small></div></div>
          <fieldset className="sf-world-release-sections">
            <legend>封存范围</legend>
            {WORLD_RELEASE_SECTIONS.map(section => (
              <label key={section.key} title={section.description}>
                <input
                  type="checkbox"
                  checked={selectedSections.has(section.key)}
                  onChange={event => setSelectedSections(previous => {
                    const next = new Set(previous)
                    if (event.target.checked) next.add(section.key)
                    else next.delete(section.key)
                    return next
                  })}
                />
                <span>{section.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="sf-world-pipeline-field">修订名称<input value={revisionLabel} onChange={event => setRevisionLabel(event.target.value)} placeholder={`例如：世界修订 ${revisions.length + 1}`} /></label>
          <div className="sf-world-pipeline-actions">
            <button className="sf-button sf-button-secondary" onClick={createRevision} disabled={busy || selectedSections.size === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}冻结修订
            </button>
            <button className="sf-button sf-button-primary" onClick={publish} disabled={busy || !latestRevision?.id || latestRelease?.revisionId === latestRevision.id}>
              <Rocket className="h-4 w-4" />发布版本
            </button>
          </div>
          <div className="sf-world-pipeline-status"><span>修订 {revisions.length}</span><span>发布 {releases.length}</span>{latestRelease && <span>当前 v{latestRelease.version}</span>}</div>
          {revisionDiff && <div className="sf-world-revision-diff" role="region" aria-label="最新修订差异">
            <strong>相对修订 {revisions[1]?.revision}</strong>
            <span>新增 {revisionDiff.added.length}</span>
            <span>变更 {revisionDiff.changed.length}</span>
            <span>移除 {revisionDiff.removed.length}</span>
          </div>}
        </div>

        <div className="sf-world-pipeline-stage">
          <div className="sf-world-pipeline-stage-head"><span>2</span><div><strong>显式交给产品</strong><small>只传 release ID + hash；产品继续完成设置、会谈和开始授权</small></div></div>
          <label className="sf-world-pipeline-field">冻结世界版本<select value={selectedReleaseId ?? ''} onChange={event => setSelectedReleaseId(Number(event.target.value) || null)}><option value="">选择 WorldRelease</option>{releases.map(release => <option key={release.id} value={release.id}>v{release.version} · {release.label}</option>)}</select></label>
          <p className="sf-world-pipeline-note">这里不会生成游戏、媒资、聊天会话或跑团实例。进入具体产品后，用户仍需确认产品设置和 Brief，并明确下达开始指令。</p>
          {selectedRelease && <code>{selectedRelease.sourceWorldCode}@v{selectedRelease.version} · {selectedRelease.contentHash.slice(0, 16)}…</code>}
          <div className="sf-world-pipeline-actions">
            <button className="sf-button sf-button-secondary" onClick={() => handoff('storygame')} disabled={!selectedRelease?.id}>
              <Gamepad2 className="h-4 w-4" />交给文字游戏
            </button>
            <button className="sf-button sf-button-primary" onClick={() => handoff('ttrpg')} disabled={!selectedRelease?.id}>
              <WandSparkles className="h-4 w-4" />交给跑团
            </button>
          </div>
        </div>
      </div>
      {message && <p className="sf-product-message" role="status">{message}</p>}
    </section>
  )
}
