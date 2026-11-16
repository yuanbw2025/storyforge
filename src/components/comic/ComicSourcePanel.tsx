import { useEffect, useRef, useState } from 'react'
import type { AdaptationProject, AdaptationSourceUnit, ComicTargetSpecV1, WorkspaceScope } from '../../lib/types'
import { updateComicTargetSpecV1, readComicAuthorDraft, saveComicAuthorDraft } from '../../lib/comic/authoring'
import { assertComicTargetSpecV1 } from '../../lib/adaptation/contracts'
import { queueCandidateDraftV1, flushCandidateDraftsV1 } from '../../lib/agent/candidate-draft-coordinator'
import { registerPendingDraftFlusherV1, flushPendingEditsV1 } from '../../lib/authoring/pending-edit-coordinator'
import ComicSource from './ComicSource'
import ComicTargetFields from './ComicTargetFields'

type ComicRoot = AdaptationProject & { medium: 'comic' }
interface TargetEditorProps { scope: WorkspaceScope; root: ComicRoot; onChanged: () => Promise<void> }

export default function ComicSourcePanel({ scope, root, units, onChanged }: TargetEditorProps & { units: AdaptationSourceUnit[] }) {
  if (!root.id || root.projectId !== scope.projectId || root.worldId !== scope.worldId || root.workId !== scope.workId) {
    return <p role="status">正在读取当前漫画作品…</p>
  }
  // A new owner resets the editor; metadata/revision refreshes keep local input.
  const ownerKey = `${scope.projectId}:${scope.worldId}:${scope.workId}:${root.id}`
  return <><ComicSource key={`source:${ownerKey}`} scope={scope} root={root} units={units} />
    <ComicTargetEditor key={`target:${ownerKey}`} scope={scope} root={root} onChanged={onChanged} /></>
}

function ComicTargetEditor({ scope, root, onChanged }: TargetEditorProps) {
  // Keep the rendered text and its write basis in the same snapshot.
  const [draft, setDraft] = useState(() => ({ spec: root.targetSpec, scope: { ...scope },
    revision: root.revision, key: `target:r${root.revision}` }))
  const spec = draft.spec
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const edited = useRef(false), active = useRef(true), readingRevision = useRef<number | null>(null)
  const prefix = `comic:${scope.workId}:`
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  useEffect(() => {
    if (edited.current || readingRevision.current === root.revision
      || (readingRevision.current !== null && (loading || !loaded))) return
    const revision = root.revision
    readingRevision.current = revision
    const basis = { scope: { ...scope }, revision, key: `target:r${revision}` }
    setDraft({ ...basis, spec: root.targetSpec }); setLoading(true); setLoaded(false); setError('')
    // Same-revision metadata does not cancel/restart this real read. Dirty
    // input retains its original revision rather than borrowing a later CAS.
    void readComicAuthorDraft(basis.scope, basis.key).then(text => {
      if (!active.current || readingRevision.current !== revision) return
      if (!edited.current) {
        const next: ComicTargetSpecV1 = text ? JSON.parse(text) : root.targetSpec
        assertComicTargetSpecV1(next)
        if (text) edited.current = true
        setDraft({ ...basis, spec: next })
      }
      setLoaded(true)
    }).catch(cause => {
      if (active.current && readingRevision.current === revision) setError(String(cause))
    }).finally(() => {
      if (active.current && readingRevision.current === revision) setLoading(false)
    })
  }, [scope, root.revision, root.targetSpec, loading, loaded])
  useEffect(() => registerPendingDraftFlusherV1(() => flushCandidateDraftsV1(prefix)), [prefix])
  const change = (next: ComicTargetSpecV1) => {
    if (!active.current || busy || root.status === 'complete') return
    edited.current = true; setDraft({ ...draft, spec: next })
    const { scope: owner, key } = draft
    queueCandidateDraftV1({ key: prefix + key, draft: JSON.stringify(next),
      persist: text => saveComicAuthorDraft(owner, key, text),
      onError: cause => { if (active.current) setError(cause.message) } })
  }
  const save = async () => {
    if (loading || (!loaded && !edited.current) || busy || root.status === 'complete') return
    const { scope: owner, revision } = draft
    setBusy(true); setError('')
    try {
      await flushPendingEditsV1()
      if (!active.current) return
      await updateComicTargetSpecV1({ scope: owner, expectedRevision: revision, targetSpec: spec })
      if (active.current) { setLoaded(true); edited.current = false; await onChanged() }
    } catch (cause) { if (active.current) setError(String(cause)) }
    finally { if (active.current) setBusy(false) }
  }
  return <section className="cp-planning"><h3>作品规格</h3>
    <p>修改后需要重新确认改编方案和视觉设定，并重新审校受影响的页面。已有内容和发布版本保留。</p>
    {error && <p role="alert">{error}</p>}
    <fieldset disabled={busy || root.status === 'complete'}><div className="cp-fields">
      <ComicTargetFields value={spec} onChange={change} /></div>
      <button className="primary" disabled={loading || (!loaded && !edited.current)} onClick={() => void save()}>保存制作规格</button>
    </fieldset>
  </section>
}
