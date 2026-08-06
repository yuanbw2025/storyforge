import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Check,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
} from 'lucide-react'
import type {
  NarrativeModule,
  SimulationSessionKind,
  WorldRelease,
  WorldReleaseManifestV2,
  WorldRevision,
  WorkspaceScope,
} from '../../lib/types'
import type { WorldReleaseSection } from '../../lib/registry/types'
import {
  createStarterNarrativeModule,
  projectStoryArcsToNarrative,
  validateNarrativeModule,
} from '../../lib/narrative/blueprint'
import { readOwnedRows, resolveScopeLike } from '../../lib/world-engine/scope'
import { selectWorkNarrativeModule } from '../../lib/world-engine/works'
import {
  createWorldRevision,
  diffWorldRevisions,
  listWorldReleases,
  listWorldRevisions,
  publishWorldRevision,
  WORLD_RELEASE_SECTIONS,
  worldReleaseSectionTables,
} from '../../lib/world-engine/releases'
import { createWorldInstance } from '../../lib/world-engine/instances'
import { changeRecordScope } from '../../lib/world-engine/scope-conversion'
import { db } from '../../lib/db/schema'
import { useDialog } from '../shared/Dialog'

const KIND_LABELS: Record<NarrativeModule['kind'], string> = {
  main: '主线',
  side: '支线',
  quest: '任务',
  opening: '开局',
  free: '自由探索',
}

const INSTANCE_KINDS: Array<{ value: SimulationSessionKind; label: string }> = [
  { value: 'ttrpg', label: '跑团' },
  { value: 'chatgame', label: '角色聊天' },
  { value: 'storygame', label: '文字游戏' },
  { value: 'npc-evolution', label: 'NPC 演进' },
]

interface Props {
  projectId: number
  activeWorkId?: number | null
  onChanged: () => Promise<void> | void
  onOpenRuntime: () => void
}

export default function WorldNarrativeReleasePanel({ projectId, activeWorkId, onChanged, onOpenRuntime }: Props) {
  const dialog = useDialog()
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [modules, setModules] = useState<NarrativeModule[]>([])
  const [validity, setValidity] = useState<Record<number, boolean>>({})
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null)
  const [revisions, setRevisions] = useState<WorldRevision[]>([])
  const [releases, setReleases] = useState<WorldRelease[]>([])
  const [revisionLabel, setRevisionLabel] = useState('')
  const [instanceKind, setInstanceKind] = useState<SimulationSessionKind>('storygame')
  const [instanceTitle, setInstanceTitle] = useState('')
  const [releaseId, setReleaseId] = useState<number | null>(null)
  const [releaseNarrativeExportId, setReleaseNarrativeExportId] = useState<number | null>(null)
  const [newModuleKind, setNewModuleKind] = useState<NarrativeModule['kind']>('quest')
  const [newModuleTitle, setNewModuleTitle] = useState('')
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
    const [rows, work, revisionRows, releaseRows] = await Promise.all([
      readOwnedRows<NarrativeModule>(resolved, 'narrativeModules'),
      db.works.get(resolved.workId),
      listWorldRevisions(resolved),
      listWorldReleases(resolved),
    ])
    const checks = await Promise.all(rows.map(async module => [
      module.id!,
      (await validateNarrativeModule(resolved, module.id!)).valid,
    ] as const))
    setScope(resolved)
    setModules(rows)
    setValidity(Object.fromEntries(checks))
    setActiveModuleId(work?.activeNarrativeModuleId ?? null)
    setSelectedIds(previous => {
      const available = new Set(rows.map(module => module.id!))
      const retained = [...previous].filter(id => available.has(id))
      return new Set(retained.length ? retained : rows.map(module => module.id!))
    })
    setRevisions(revisionRows)
    setReleases(releaseRows)
    setRevisionDiff(revisionRows.length > 1
      ? await diffWorldRevisions(revisionRows[1].id!, revisionRows[0].id!)
      : null)
    setReleaseId(previous => releaseRows.some(release => release.id === previous)
      ? previous
      : releaseRows[0]?.id ?? null)
  }, [projectId])

  useEffect(() => {
    void load().catch(cause => setMessage(cause instanceof Error ? cause.message : '读取叙事蓝图失败'))
  }, [activeWorkId, load])

  const latestRevision = revisions[0] ?? null
  const latestRelease = releases[0] ?? null
  const selectedRelease = releases.find(release => release.id === releaseId) ?? null
  const releaseNarrativeModules = useMemo(() => {
    if (!selectedRelease) return []
    try {
      return (JSON.parse(selectedRelease.manifestJson) as WorldReleaseManifestV2).selectedNarrativeModules
    } catch { return [] }
  }, [selectedRelease])
  const selectedReleaseModule = releaseNarrativeModules.find(module => module.exportId === releaseNarrativeExportId) ?? null
  const canRevise = selectedSections.size > 0 && [...selectedIds].every(id => validity[id])

  useEffect(() => {
    setReleaseNarrativeExportId(previous => releaseNarrativeModules.some(module => module.exportId === previous)
      ? previous
      : releaseNarrativeModules[0]?.exportId ?? null)
  }, [releaseNarrativeModules])

  const run = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setMessage('')
    try { await action() } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : '操作失败')
    } finally { setBusy(false) }
  }

  const projectArcs = () => run(async () => {
    if (!scope) return
    const projected = await projectStoryArcsToNarrative(scope)
    setMessage(projected.length ? `已同步 ${projected.length} 条主线/支线。` : '当前作品还没有可投影的故事线。')
    await load()
  })

  const createModule = () => run(async () => {
    if (!scope || !newModuleTitle.trim()) return
    const created = await createStarterNarrativeModule({
      scope,
      owner: 'work',
      kind: newModuleKind,
      title: newModuleTitle,
    })
    await selectWorkNarrativeModule(scope, created.id!)
    setNewModuleTitle('')
    setMessage(`已创建可执行${KIND_LABELS[created.kind]}“${created.title}”，并设为当前叙事。`)
    await load()
  })

  const createRevision = () => run(async () => {
    if (!scope || !canRevise) return
    await createWorldRevision({
      scope,
      label: revisionLabel,
      parentRevisionId: latestRevision?.id ?? null,
      selectedTables: [...selectedSections].flatMap(worldReleaseSectionTables),
      selectedNarrativeModuleIds: [...selectedIds],
    })
    setRevisionLabel('')
    setMessage('已冻结新的世界草稿修订。')
    await load()
  })

  const publish = () => run(async () => {
    if (!latestRevision?.id) return
    const confirmed = await dialog.confirm({
      title: `发布修订 ${latestRevision.revision}？`,
      message: '发布后该版本保持不可变；后续修改会进入新的草稿修订。',
      confirmText: '发布版本',
    })
    if (!confirmed) return
    await publishWorldRevision(latestRevision.id)
    setMessage('不可变世界版本已发布。')
    await load()
    await onChanged()
  })

  const startInstance = () => run(async () => {
    if (!scope || !releaseId || releaseNarrativeExportId == null || !selectedReleaseModule) return
    const instance = await createWorldInstance({
      scope,
      kind: instanceKind,
      title: instanceTitle.trim() || `${INSTANCE_KINDS.find(item => item.value === instanceKind)?.label ?? '互动'} · ${selectedReleaseModule.title}`,
      releaseId,
      releaseNarrativeModuleExportId: releaseNarrativeExportId,
    })
    setMessage(`已创建独立实例“${instance.title}”。`)
    setInstanceTitle('')
    await onChanged()
  })

  return (
    <section className="sf-world-pipeline" aria-label="叙事蓝图与世界发布">
      <div className="sf-world-pipeline-heading">
        <div><span className="sf-card-kicker"><GitBranch className="h-4 w-4" /> 可执行叙事</span><h3>叙事蓝图与发布</h3></div>
        <button className="sf-button sf-button-secondary" onClick={projectArcs} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}同步主线与支线
        </button>
      </div>

      <div className="sf-world-pipeline-grid">
        <div className="sf-world-pipeline-stage">
          <div className="sf-world-pipeline-stage-head"><span>1</span><div><strong>选择叙事</strong><small>同一来源供分步骤创作和互动实例使用</small></div></div>
          <div className="sf-world-module-create">
            <select aria-label="新叙事类型" value={newModuleKind} onChange={event => setNewModuleKind(event.target.value as NarrativeModule['kind'])}>
              {Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <input aria-label="新叙事名称" value={newModuleTitle} onChange={event => setNewModuleTitle(event.target.value)} placeholder="新叙事名称" />
            <button className="sf-icon-button" title="创建叙事" aria-label="创建叙事" onClick={createModule} disabled={busy || !newModuleTitle.trim()}><Plus className="h-4 w-4" /></button>
          </div>
          <div className="sf-world-module-list">
            {modules.map(module => (
              <div key={module.id} className={`sf-world-module-row ${module.id === activeModuleId ? 'active' : ''}`}>
                <input
                  type="checkbox"
                  aria-label={`纳入发布 ${module.title}`}
                  checked={selectedIds.has(module.id!)}
                  onChange={event => setSelectedIds(previous => {
                    const next = new Set(previous)
                    if (event.target.checked) next.add(module.id!); else next.delete(module.id!)
                    return next
                  })}
                />
                <button onClick={() => run(async () => {
                  if (!scope) return
                  await selectWorkNarrativeModule(scope, module.id!)
                  setActiveModuleId(module.id!)
                  setMessage(`当前作品已选择${KIND_LABELS[module.kind]}“${module.title}”。`)
                })}>
                  <span><strong>{module.title}</strong><small>{KIND_LABELS[module.kind]}</small></span>
                  <span className={validity[module.id!] ? 'ready' : 'warning'}>{validity[module.id!] ? '可执行' : '待补全'}</span>
                </button>
                <select
                  aria-label={`共享范围 ${module.title}`}
                  value={module.worldId != null ? 'world' : 'work'}
                  disabled={busy}
                  onChange={event => run(async () => {
                    if (!scope) return
                    const targetOwner = event.target.value as 'world' | 'work'
                    await changeRecordScope({ scope, tableName: 'narrativeModules', recordId: module.id!, targetOwner })
                    setMessage(targetOwner === 'world'
                      ? `“${module.title}”已设为整个世界可复用的叙事。`
                      : `“${module.title}”已收回当前作品。`)
                    await load()
                  })}
                >
                  <option value="work">本作品</option>
                  <option value="world">整个世界</option>
                </select>
              </div>
            ))}
            {!modules.length && <p>先在“主线与支线”中建立故事线，再同步为可执行蓝图。</p>}
          </div>
        </div>

        <div className="sf-world-pipeline-stage">
          <div className="sf-world-pipeline-stage-head"><span>2</span><div><strong>冻结并发布</strong><small>逐次修订可比较，发布版本不可变</small></div></div>
          <fieldset className="sf-world-release-sections">
            <legend>发布范围</legend>
            {WORLD_RELEASE_SECTIONS.map(section => (
              <label key={section.key} title={section.description}>
                <input
                  type="checkbox"
                  checked={selectedSections.has(section.key)}
                  onChange={event => setSelectedSections(previous => {
                    const next = new Set(previous)
                    if (event.target.checked) next.add(section.key); else next.delete(section.key)
                    return next
                  })}
                />
                <span>{section.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="sf-world-pipeline-field">修订名称<input value={revisionLabel} onChange={event => setRevisionLabel(event.target.value)} placeholder={`例如：世界修订 ${revisions.length + 1}`} /></label>
          <div className="sf-world-pipeline-actions">
            <button className="sf-button sf-button-secondary" onClick={createRevision} disabled={busy || !canRevise}><ShieldCheck className="h-4 w-4" />冻结修订</button>
            <button className="sf-button sf-button-primary" onClick={publish} disabled={busy || !latestRevision?.id || latestRelease?.revisionId === latestRevision.id}><Rocket className="h-4 w-4" />发布版本</button>
          </div>
          <div className="sf-world-pipeline-status"><span>修订 {revisions.length}</span><span>发布 {releases.length}</span>{latestRelease && <span>当前 v{latestRelease.version}</span>}</div>
          {revisionDiff && (
            <div className="sf-world-revision-diff" role="region" aria-label="最新修订差异">
              <strong>相对修订 {revisions[1]?.revision}</strong>
              <span>新增 {revisionDiff.added.length}</span>
              <span>变更 {revisionDiff.changed.length}</span>
              <span>移除 {revisionDiff.removed.length}</span>
              {!!revisionDiff.changed.length && <small title={revisionDiff.changed.join(', ')}>{revisionDiff.changed.join('、')}</small>}
            </div>
          )}
        </div>

        <div className="sf-world-pipeline-stage">
          <div className="sf-world-pipeline-stage-head"><span>3</span><div><strong>启动独立实例</strong><small>每个实例单独记录事件、分支和检查点</small></div></div>
          <div className="sf-world-pipeline-selects">
            <select value={instanceKind} onChange={event => setInstanceKind(event.target.value as SimulationSessionKind)}>{INSTANCE_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            <select value={releaseId ?? ''} onChange={event => setReleaseId(Number(event.target.value) || null)}><option value="">选择发布版本</option>{releases.map(release => <option key={release.id} value={release.id}>v{release.version} · {release.label}</option>)}</select>
          </div>
          <label className="sf-world-pipeline-field">冻结叙事<select value={releaseNarrativeExportId ?? ''} onChange={event => setReleaseNarrativeExportId(event.target.value === '' ? null : Number(event.target.value))}><option value="">选择发布版本中的叙事</option>{releaseNarrativeModules.map(module => <option key={module.exportId} value={module.exportId}>{KIND_LABELS[module.kind]} · {module.title}</option>)}</select></label>
          <label className="sf-world-pipeline-field">实例名称<input value={instanceTitle} onChange={event => setInstanceTitle(event.target.value)} placeholder={selectedReleaseModule ? `基于“${selectedReleaseModule.title}”` : '先选择冻结叙事'} /></label>
          <div className="sf-world-pipeline-actions">
            <button className="sf-button sf-button-primary" onClick={startInstance} disabled={busy || !releaseId || !selectedReleaseModule}><Play className="h-4 w-4" />创建实例</button>
            <button className="sf-button sf-button-secondary" onClick={onOpenRuntime}><Check className="h-4 w-4" />查看实例</button>
          </div>
        </div>
      </div>
      {message && <p className="sf-product-message" role="status">{message}</p>}
    </section>
  )
}
