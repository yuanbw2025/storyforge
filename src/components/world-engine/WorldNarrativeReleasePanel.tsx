import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import {
  Bot,
  Check,
  GitBranch,
  Gamepad2,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  ShieldCheck,
  WandSparkles,
} from 'lucide-react'
import type {
  NarrativeModule,
  Project,
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
import { publishStoryGameDraft } from '../../lib/text-game/authoring'
import { publishAdventureGameDraft } from '../../lib/adventure/authoring'
import { publishAvgGame } from '../../lib/avg/authoring'
import {
  generateAdventureGameFromWorldRelease,
  generateAvgGameFromWorldRelease,
  generateStoryGameFromWorldRelease,
  loadWorldGameSourceCatalog,
} from '../../lib/text-game/world-generation'
import type { WorldGameSourceCatalog } from '../../lib/text-game/world-generation'
import { createWorldInstance } from '../../lib/world-engine/instances'
import { installMistHarborDemoWorld } from '../../lib/world-engine/mist-harbor-demo'
import { changeRecordScope } from '../../lib/world-engine/scope-conversion'
import { db } from '../../lib/db/schema'
import { useDialog } from '../shared/Dialog'
import { useMasterCopilot } from '../agent/useMasterCopilot'
import {
  createWorldGameTargetInstructionV1,
} from '../../lib/agent/world-game-copilot'
import type { WorldGameCopilotSnapshotV1 } from '../../lib/agent/world-game-copilot'
import type { WorldGameAuthoringProductV1 } from '../../lib/text-game/agent-contract'

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
  { value: 'npc-evolution', label: 'NPC 演进' },
]

interface Props {
  project: Project
  projectId: number
  activeWorkId?: number | null
  onChanged: () => Promise<void> | void
  onOpenRuntime: () => void
  onOpenGame: (product: 'storygame' | 'text-adventure' | 'avg') => void
}

export default function WorldNarrativeReleasePanel({ project, projectId, activeWorkId, onChanged, onOpenRuntime, onOpenGame }: Props) {
  const dialog = useDialog()
  const gameCopilot = useMasterCopilot({ project, worldGroupId: null })
  const [scope, setScope] = useState<WorkspaceScope | null>(null)
  const [modules, setModules] = useState<NarrativeModule[]>([])
  const [validity, setValidity] = useState<Record<number, boolean>>({})
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [activeModuleId, setActiveModuleId] = useState<number | null>(null)
  const [revisions, setRevisions] = useState<WorldRevision[]>([])
  const [releases, setReleases] = useState<WorldRelease[]>([])
  const [revisionLabel, setRevisionLabel] = useState('')
  const [instanceKind, setInstanceKind] = useState<SimulationSessionKind>('ttrpg')
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
  const [generatedStoryTitle, setGeneratedStoryTitle] = useState('')
  const [generatedProduct, setGeneratedProduct] = useState<'storygame' | 'text-adventure' | 'avg'>('storygame')
  const [sourceCatalog, setSourceCatalog] = useState<WorldGameSourceCatalog | null>(null)
  const [selectedCharacterExportIds, setSelectedCharacterExportIds] = useState<Set<number>>(new Set())
  const [selectedLocationExportIds, setSelectedLocationExportIds] = useState<Set<number>>(new Set())
  const [selectedArtifactExportIds, setSelectedArtifactExportIds] = useState<Set<number>>(new Set())
  const [selectedLoreExportIds, setSelectedLoreExportIds] = useState<Set<number>>(new Set())
  const [selectedMediaExportIds, setSelectedMediaExportIds] = useState<Set<number>>(new Set())
  const [aiProduct, setAiProduct] = useState<WorldGameAuthoringProductV1>('storygame')
  const [creativeBrief, setCreativeBrief] = useState('请沿用所选世界资产，但设计一个新的当下危机，让玩家通过有后果的选择推进剧情，并产生至少两个明显不同的结局。')

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

  useEffect(() => {
    let cancelled = false
    if (!scope || !releaseId) { setSourceCatalog(null); return () => { cancelled = true } }
    void loadWorldGameSourceCatalog({ scope, worldReleaseId: releaseId }).then(catalog => {
      if (cancelled) return
      setSourceCatalog(catalog)
      setSelectedCharacterExportIds(new Set(catalog.characters.map(item => item.exportId)))
      setSelectedLocationExportIds(new Set(catalog.locations.map(item => item.exportId)))
      setSelectedArtifactExportIds(new Set(catalog.artifacts.map(item => item.exportId)))
      setSelectedLoreExportIds(new Set(catalog.loreEntries.map(item => item.exportId)))
      setSelectedMediaExportIds(new Set(catalog.mediaAssets.map(item => item.exportId)))
    }).catch(cause => {
      if (!cancelled) { setSourceCatalog(null); setMessage(cause instanceof Error ? cause.message : '读取冻结世界资产失败') }
    })
    return () => { cancelled = true }
  }, [scope, releaseId])

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

  const generateStoryGame = () => run(async () => {
    if (!scope || !releaseId || releaseNarrativeExportId == null || !selectedReleaseModule) return
    const generated = await generateStoryGameFromWorldRelease({
      scope,
      worldReleaseId: releaseId,
      narrativeModuleExportId: releaseNarrativeExportId,
      title: selectedReleaseModule.title,
    })
    const publication = await publishStoryGameDraft({
      scope,
      gameDefinitionId: generated.definition.id!,
      label: `${generated.definition.title} · 世界投影`,
    })
    setGeneratedStoryTitle(generated.definition.title)
    setGeneratedProduct('storygame')
    setMessage(`已从冻结世界生成、校验并发布“${generated.definition.title}” v${publication.gameRelease.version}。`)
    await load()
    await onChanged()
  })

  const generateAdventureGame = () => run(async () => {
    if (!scope || !releaseId || releaseNarrativeExportId == null || !selectedReleaseModule) return
    const generated = await generateAdventureGameFromWorldRelease({
      scope,
      worldReleaseId: releaseId,
      narrativeModuleExportId: releaseNarrativeExportId,
      characterExportIds: [...selectedCharacterExportIds],
      locationExportIds: [...selectedLocationExportIds],
      artifactExportIds: [...selectedArtifactExportIds],
      codexEntryExportIds: [...selectedLoreExportIds],
    })
    const publication = await publishAdventureGameDraft({
      scope,
      gameDefinitionId: generated.definition.id!,
      label: `${generated.definition.title} · 世界投影`,
    })
    setGeneratedStoryTitle(generated.definition.title)
    setGeneratedProduct('text-adventure')
    setMessage(`已从冻结角色、地点与 artifact 道具生成并发布“${generated.definition.title}” v${publication.gameRelease.version}。`)
    await load()
    await onChanged()
  })

  const generateAvgGame = () => run(async () => {
    if (!scope || !releaseId || releaseNarrativeExportId == null || !selectedReleaseModule) return
    const generated = await generateAvgGameFromWorldRelease({
      scope,
      worldReleaseId: releaseId,
      narrativeModuleExportId: releaseNarrativeExportId,
      characterExportIds: [...selectedCharacterExportIds],
      mediaAssetExportIds: [...selectedMediaExportIds],
    })
    const publication = await publishAvgGame({
      scope,
      gameDefinitionId: generated.definition.id!,
      label: `${generated.definition.title} · 世界投影`,
    })
    setGeneratedStoryTitle(generated.definition.title)
    setGeneratedProduct('avg')
    setMessage(`已从冻结叙事与媒资生成并发布“${generated.definition.title}” v${publication.gameRelease.version}。${generated.warnings[0] ?? ''}`)
    await load()
    await onChanged()
  })

  const startAiGameAuthoring = () => run(async () => {
    if (!scope || !selectedRelease?.id || releaseNarrativeExportId == null || !sourceCatalog) return
    const selectedCharacters = new Set(selectedCharacterExportIds)
    const request = {
      schema: 'storyforge.world-game-authoring-request',
      version: 1,
      productType: aiProduct,
      worldReleaseId: selectedRelease.id,
      worldContentHash: selectedRelease.contentHash,
      narrativeModuleExportId: releaseNarrativeExportId,
      characterExportIds: [...selectedCharacterExportIds].sort((a, b) => a - b),
      characterRelationExportIds: sourceCatalog.relationships
        .filter(item => selectedCharacters.has(item.fromCharacterExportId) && selectedCharacters.has(item.toCharacterExportId))
        .map(item => item.exportId)
        .sort((a, b) => a - b),
      importantLocationExportIds: [...selectedLocationExportIds].sort((a, b) => a - b),
      artifactExportIds: [...selectedArtifactExportIds].sort((a, b) => a - b),
      codexEntryExportIds: [...selectedLoreExportIds].sort((a, b) => a - b),
      storyArcExportIds: sourceCatalog.storyArcs.map(item => item.exportId).sort((a, b) => a - b),
      avgMediaAssetExportIds: [...selectedMediaExportIds].sort((a, b) => a - b),
      creativeBrief: creativeBrief.trim(),
    } as const
    const instruction = createWorldGameTargetInstructionV1(request)
    await gameCopilot.submitTargetedRequest(instruction, {
      agentId: 'outline',
      skillId: 'outline.world-game',
      instruction,
      id: `world-game-${aiProduct}`,
    })
    setMessage('主 Agent 已接收冻结世界创作包；生成完成后请检查候选，再采纳发布。')
  })

  const aiCandidates = gameCopilot.pendingCandidates.filter(candidate => (
    candidate.payload.skillId === 'outline.world-game'
  ))

  const adoptAndPublishAiGame = (candidate: typeof aiCandidates[number]) => run(async () => {
    if (!scope || !selectedRelease) return
    const candidateRequest = (candidate.payload.baseSnapshot as WorldGameCopilotSnapshotV1).request
    if (candidateRequest.worldReleaseId !== selectedRelease.id
      || candidateRequest.worldContentHash !== selectedRelease.contentHash) {
      throw new Error('当前选择的世界版本与这个 AI 候选不一致，请切回原版本或重新生成。')
    }
    const candidateProduct = candidateRequest.productType
    const adopted = await gameCopilot.adoptCandidate(candidate)
    if (!adopted) throw new Error(gameCopilot.error || '主 Agent 游戏候选采纳失败。')
    const definitions = await db.gameDefinitions.where('workId').equals(scope.workId).toArray()
    const definition = definitions
      .filter(item => item.productType === candidateProduct && item.sourceWorldContentHash === selectedRelease.contentHash)
      .sort((left, right) => right.updatedAt - left.updatedAt)[0]
    if (!definition?.id) throw new Error('AI 游戏候选已采纳，但没有找到对应游戏草稿。')
    if (candidateProduct === 'storygame') {
      await publishStoryGameDraft({ scope, gameDefinitionId: definition.id, label: `${definition.title} · AI 演化发布` })
    } else if (candidateProduct === 'text-adventure') {
      await publishAdventureGameDraft({ scope, gameDefinitionId: definition.id, label: `${definition.title} · AI 演化发布` })
    } else {
      await publishAvgGame({ scope, gameDefinitionId: definition.id, label: `${definition.title} · AI 演化发布` })
    }
    setGeneratedStoryTitle(definition.title)
    setGeneratedProduct(candidateProduct)
    setMessage(`主 Agent 创作的“${definition.title}”已经校验、冻结并发布，可立即试玩。`)
    await load()
    await onChanged()
  })

  const installMistHarbor = () => run(async () => {
    if (!scope) return
    const confirmed = await dialog.confirm({
      title: '建立雾港演示世界？',
      message: '会在当前世界中补齐正式世界设定、规则、地理、历史、角色、关系、故事核心、十章大纲/细纲/正文、伏笔、artifact 道具、主线和本地视觉媒资；不会覆盖你后来手写的章节正文，也不会绕过发布流程。',
      confirmText: '建立演示世界',
    })
    if (!confirmed) return
    const result = await installMistHarborDemoWorld({ scope })
    setSelectedIds(previous => new Set([...previous, result.narrativeModuleId]))
    setMessage(`雾港世界已就绪：${result.characterCount} 名完整角色、${result.locationCount} 个重要地点、${result.worldRuleEntryCount} 条世界规则、${result.chapterCount} 章正文、${result.detailedOutlineCount} 章细纲、${result.foreshadowCount} 条伏笔、${result.artifactCount} 件道具和 ${result.mediaAssetCount} 项视觉媒资。下一步冻结并发布 WorldRelease。`)
    await load()
    await onChanged()
  })

  const toggleExportId = (setter: Dispatch<SetStateAction<Set<number>>>, exportId: number) => {
    setter(previous => {
      const next = new Set(previous)
      if (next.has(exportId)) next.delete(exportId); else next.add(exportId)
      return next
    })
  }

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
          <p className="sf-world-pipeline-note">文字游戏需先在作者工作台生成 GameRelease，再从文字游戏产品页开始；这里仅保留其他互动实例。</p>
          <div className="sf-world-pipeline-selects">
            <select aria-label="互动实例类型" value={instanceKind} onChange={event => setInstanceKind(event.target.value as SimulationSessionKind)}>{INSTANCE_KINDS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
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
      <section className="sf-world-game-bridge" aria-label="世界到文字游戏">
        <div>
          <span className="sf-card-kicker"><Gamepad2 className="h-4 w-4" /> WORLD → STORYGAME</span>
          <h3>从冻结世界生成文字游戏</h3>
          <p>主 Agent 会读取所选 WorldRelease 的便携创作包，在世界事实之上继续创作新的危机、推进、分支和结局；作者确认后才生成并发布游戏。</p>
          <button className="sf-button sf-button-secondary" onClick={installMistHarbor} disabled={busy}>
            <WandSparkles className="h-4 w-4" />建立雾港演示世界
          </button>
        </div>
        <div className="sf-world-game-bridge-source">
          <strong>{selectedRelease ? `v${selectedRelease.version} · ${selectedRelease.label}` : '先发布一个世界版本'}</strong>
          <span>{selectedReleaseModule ? `${KIND_LABELS[selectedReleaseModule.kind]} · ${selectedReleaseModule.title}` : '选择冻结叙事'}</span>
          {selectedRelease && <code>{selectedRelease.contentHash.slice(0, 16)}…</code>}
        </div>
        {sourceCatalog && (
          <div className="sf-world-game-selection" aria-label="选择冻结世界资产">
            <fieldset>
              <legend>角色 · {selectedCharacterExportIds.size}/{sourceCatalog.characters.length}</legend>
              {sourceCatalog.characters.map(item => <label key={item.exportId}><input type="checkbox" checked={selectedCharacterExportIds.has(item.exportId)} onChange={() => toggleExportId(setSelectedCharacterExportIds, item.exportId)} /><span>{item.name}</span></label>)}
            </fieldset>
            <fieldset>
              <legend>地点 · {selectedLocationExportIds.size}/{sourceCatalog.locations.length}</legend>
              {sourceCatalog.locations.map(item => <label key={item.exportId}><input type="checkbox" checked={selectedLocationExportIds.has(item.exportId)} onChange={() => toggleExportId(setSelectedLocationExportIds, item.exportId)} /><span>{item.name}</span></label>)}
            </fieldset>
            <fieldset>
              <legend>artifact 道具 · {selectedArtifactExportIds.size}/{sourceCatalog.artifacts.length}</legend>
              {sourceCatalog.artifacts.map(item => <label key={item.exportId}><input type="checkbox" checked={selectedArtifactExportIds.has(item.exportId)} onChange={() => toggleExportId(setSelectedArtifactExportIds, item.exportId)} /><span>{item.name}</span></label>)}
            </fieldset>
            <fieldset>
              <legend>世界词条 · {selectedLoreExportIds.size}/{sourceCatalog.loreEntries.length}</legend>
              {sourceCatalog.loreEntries.map(item => <label key={item.exportId}><input type="checkbox" checked={selectedLoreExportIds.has(item.exportId)} onChange={() => toggleExportId(setSelectedLoreExportIds, item.exportId)} /><span>{item.name}</span></label>)}
            </fieldset>
            <fieldset>
              <legend>AVG 媒资 · {selectedMediaExportIds.size}/{sourceCatalog.mediaAssets.length}</legend>
              {sourceCatalog.mediaAssets.map(item => <label key={item.exportId}><input type="checkbox" checked={selectedMediaExportIds.has(item.exportId)} onChange={() => toggleExportId(setSelectedMediaExportIds, item.exportId)} /><span>{item.name}</span></label>)}
            </fieldset>
          </div>
        )}
        <div className="sf-world-pipeline-stage">
          <div className="sf-world-pipeline-stage-head"><span><Bot className="h-4 w-4" /></span><div><strong>交给主 Agent 演化</strong><small>同一对话、Harness、候选确认和正式采纳链路</small></div></div>
          <div className="sf-world-pipeline-selects">
            <select aria-label="AI 游戏类型" value={aiProduct} disabled={aiCandidates.length > 0} onChange={event => setAiProduct(event.target.value as WorldGameAuthoringProductV1)}>
              <option value="storygame">分支互动叙事</option>
              <option value="text-adventure">文字冒险</option>
              <option value="avg">AVG</option>
            </select>
          </div>
          <label className="sf-world-pipeline-field">希望游戏怎样演化
            <textarea aria-label="游戏演化要求" rows={4} maxLength={2000} value={creativeBrief} onChange={event => setCreativeBrief(event.target.value)} />
          </label>
          <div className="sf-world-pipeline-actions">
            <button className="sf-button sf-button-primary" onClick={startAiGameAuthoring} disabled={busy || gameCopilot.busy || gameCopilot.loading || !releaseId || !selectedReleaseModule || !creativeBrief.trim() || gameCopilot.pendingCandidates.length > 0}>
              {gameCopilot.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <WandSparkles className="h-4 w-4" />}主 Agent 生成游戏候选
            </button>
            <button className="sf-button sf-button-secondary" onClick={() => onOpenGame(generatedProduct)} disabled={busy || gameCopilot.busy || !generatedStoryTitle}><Play className="h-4 w-4" />立即试玩</button>
          </div>
          {gameCopilot.error && <p className="sf-product-message" role="alert">{gameCopilot.error}</p>}
          {aiCandidates.map(candidate => (
            <div key={candidate.event.id} className="sf-world-game-ai-candidate">
              <strong>待确认 · {candidate.payload.label}</strong>
              <small>这是真实 AI 输出；可直接编辑 JSON，确认后才会写入游戏数据。</small>
              <textarea aria-label="AI 游戏候选内容" rows={16} value={candidate.event.content} disabled={busy || gameCopilot.busy} onChange={event => { void gameCopilot.updateCandidate(candidate.event.id!, event.target.value) }} />
              <div className="sf-world-pipeline-actions">
                <button className="sf-button sf-button-secondary" disabled={busy || gameCopilot.busy} onClick={() => { void gameCopilot.rejectCandidate(candidate) }}>拒绝候选</button>
                <button className="sf-button sf-button-primary" disabled={busy || gameCopilot.busy} onClick={() => adoptAndPublishAiGame(candidate)}><Rocket className="h-4 w-4" />采纳、发布并准备试玩</button>
              </div>
            </div>
          ))}
        </div>
        <details className="sf-world-game-fallback">
          <summary>无需 AI 的快速映射（演示备用）</summary>
          <p>只把冻结叙事和资产确定性映射为游戏，不会继续创作新剧情。</p>
          <div className="sf-world-pipeline-actions">
            <button className="sf-button sf-button-secondary" onClick={generateStoryGame} disabled={busy || !releaseId || !selectedReleaseModule}><GitBranch className="h-4 w-4" />快速映射分支叙事</button>
            <button className="sf-button sf-button-secondary" onClick={generateAdventureGame} disabled={busy || !releaseId || !selectedReleaseModule}><Gamepad2 className="h-4 w-4" />快速映射文字冒险</button>
            <button className="sf-button sf-button-secondary" onClick={generateAvgGame} disabled={busy || !releaseId || !selectedReleaseModule}><Play className="h-4 w-4" />快速映射 AVG</button>
          </div>
        </details>
      </section>
      {message && <p className="sf-product-message" role="status">{message}</p>}
    </section>
  )
}
