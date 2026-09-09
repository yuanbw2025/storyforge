import { useEffect, useMemo, useRef, useState } from 'react'
import {
  recoverLatestTextOpenWorldCreatorBriefSessionV1,
  type TextOpenWorldCreatorBriefSessionV1,
} from '../../lib/open-world/creator-brief'
import type {
  ProductProductionHandoffV1,
  TextOpenWorldCreatorSourceSelectionV1,
  WorkspaceScope,
} from '../../lib/types'
import {
  TextOpenWorldCreatorStudio,
  type CreatorSourceKindV1,
} from './TextOpenWorldCreatorStudio'
import { TextOpenWorldCreatorBriefStudio } from './TextOpenWorldCreatorBriefStudio'

export interface TextOpenWorldCreatorWorkflowProps {
  worldScope?: WorkspaceScope | null
  novelScope?: WorkspaceScope | null
  worldGroupId?: number | null
  initialSource?: ProductProductionHandoffV1 | null
  initialSourceKind?: CreatorSourceKindV1
}

type WorkflowViewV1 = 'recovering' | 'source' | 'brief'

function sameScope(left: WorkspaceScope, right: WorkspaceScope): boolean {
  return left.projectId === right.projectId
    && left.worldId === right.worldId
    && left.workId === right.workId
}

function matchesExplicitHandoff(
  session: TextOpenWorldCreatorBriefSessionV1,
  handoff: ProductProductionHandoffV1 | null | undefined,
  worldScope: WorkspaceScope | null | undefined,
): boolean {
  if (!handoff) return true
  return session.sourceBinding.kind === 'world-release'
    && session.production.creatorSourceWorldReleaseId === handoff.worldReleaseId
    && session.production.creatorSourceVersionHash === handoff.worldContentHash
    && (!worldScope || sameScope(session.scope, worldScope))
}

function selectionIdentity(selection: TextOpenWorldCreatorSourceSelectionV1): string {
  return selection.sourceKind === 'world-release'
    ? `world:${selection.localReleaseRecordId}:${selection.expectedReleaseHash}`
    : `novel:${selection.preview.sourceVersionHash}:${selection.preview.sourceBoundaryHash}`
}

export function TextOpenWorldCreatorWorkflow(props: TextOpenWorldCreatorWorkflowProps) {
  const worldProjectId = props.worldScope?.projectId ?? null
  const worldId = props.worldScope?.worldId ?? null
  const worldWorkId = props.worldScope?.workId ?? null
  const novelProjectId = props.novelScope?.projectId ?? null
  const novelWorldId = props.novelScope?.worldId ?? null
  const novelWorkId = props.novelScope?.workId ?? null
  const handoffReleaseId = props.initialSource?.worldReleaseId ?? null
  const handoffHash = props.initialSource?.worldContentHash ?? null
  const worldScope = useMemo<WorkspaceScope | null>(() => (
    worldProjectId == null || worldId == null || worldWorkId == null
      ? null
      : { projectId: worldProjectId, worldId, workId: worldWorkId }
  ), [worldId, worldProjectId, worldWorkId])
  const novelScope = useMemo<WorkspaceScope | null>(() => (
    novelProjectId == null || novelWorldId == null || novelWorkId == null
      ? null
      : { projectId: novelProjectId, worldId: novelWorldId, workId: novelWorkId }
  ), [novelProjectId, novelWorldId, novelWorkId])
  const explicitHandoff = useMemo<ProductProductionHandoffV1 | null>(() => (
    handoffReleaseId == null || !handoffHash
      ? null
      : {
          schema: 'storyforge.product-production-handoff',
          version: 1,
          productType: 'text-open-world',
          worldReleaseId: handoffReleaseId,
          worldContentHash: handoffHash,
        }
  ), [handoffHash, handoffReleaseId])
  const [view, setView] = useState<WorkflowViewV1>('recovering')
  const [selection, setSelection] = useState<TextOpenWorldCreatorSourceSelectionV1 | null>(null)
  const [session, setSession] = useState<TextOpenWorldCreatorBriefSessionV1 | null>(null)
  const [recoveryNotice, setRecoveryNotice] = useState('')
  const generation = useRef(0)

  useEffect(() => {
    const current = ++generation.current
    const scopes = [worldScope, novelScope].filter((scope): scope is WorkspaceScope => scope != null)
    setView('recovering')
    setSelection(null)
    setSession(null)
    setRecoveryNotice('')
    if (scopes.length === 0) {
      setView('source')
      return
    }
    void recoverLatestTextOpenWorldCreatorBriefSessionV1(scopes).then(recovered => {
      if (generation.current !== current) return
      if (recovered && matchesExplicitHandoff(recovered, explicitHandoff, worldScope)) {
        setSession(recovered)
        setSelection(recovered.selection)
        setView('brief')
        return
      }
      setView('source')
    }).catch(() => {
      if (generation.current !== current) return
      setRecoveryNotice('未能恢复上次会谈，请重新核验来源；已有数据不会因此被覆盖。')
      setView('source')
    })
    return () => { generation.current += 1 }
  }, [explicitHandoff, novelScope, props.initialSourceKind, worldScope])

  const continueToBrief = (next: TextOpenWorldCreatorSourceSelectionV1) => {
    generation.current += 1
    setRecoveryNotice('')
    setSession(null)
    setSelection(next)
    setView('brief')
  }

  const returnToSource = () => {
    generation.current += 1
    setSession(null)
    setSelection(null)
    setRecoveryNotice('已保留会谈草稿；重新选择来源后会建立对应的独立会谈。')
    setView('source')
  }

  if (view === 'recovering') {
    return <main className="mx-auto w-full max-w-6xl p-5" data-testid="text-open-world-creator-workflow-recovering">
      <section className="rounded-xl border border-border bg-bg-elevated p-6 text-sm text-text-muted" role="status">
        正在恢复最近一次文字开放世界创作者会谈…
      </section>
    </main>
  }

  if (view === 'brief' && (session || selection)) {
    const key = session?.sourceBindingHash ?? selectionIdentity(selection!)
    return <TextOpenWorldCreatorBriefStudio
      key={key}
      selection={selection}
      initialSession={session}
      onBack={returnToSource}
      onConfirmed={setSession}
    />
  }

  return <>
    {recoveryNotice && <p
      className="mx-5 mt-4 rounded border border-warning/30 bg-warning/5 px-4 py-3 text-xs leading-5 text-text-muted"
      data-testid="text-open-world-creator-recovery-notice"
      role="status"
    >{recoveryNotice}</p>}
    <TextOpenWorldCreatorStudio
      worldScope={worldScope}
      novelScope={novelScope}
      worldGroupId={props.worldGroupId}
      initialSource={explicitHandoff}
      initialSourceKind={props.initialSourceKind}
      onContinue={continueToBrief}
    />
  </>
}

export default TextOpenWorldCreatorWorkflow
