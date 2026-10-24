import {useEffect, useRef, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import {createChatStarterDraftV1, listChatStarterExperiencesV1, previewChatStarterExperienceV1} from '../../lib/character-interaction/starter-experiences'

/** Author-only, opt-in entry. The normal blank Work keeps its current mode. */
export default function StarterExperiences({disabled, onCreated}: {disabled: boolean; onCreated: (scope: WorkspaceScope) => void | Promise<void>}) {
  const [enabled, setEnabled] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<ReturnType<typeof previewChatStarterExperienceV1> | null>(null)
  const working = useRef(false), generation = useRef(0), created = useRef<WorkspaceScope | null>(null)
  useEffect(() => () => {generation.current++}, [])
  const createFromPreview = async () => {
    if (!preview || disabled || working.current) return
    const id = generation.current
    working.current = true; setBusy(true); setError('')
    try {
      // A navigation failure retries the same created Work, not its creation.
      const scope = created.current ?? (await createChatStarterDraftV1(preview.id)).scope
      created.current = scope
      if (generation.current === id) await onCreated(scope)
    } catch (cause) {if (generation.current === id) setError(cause instanceof Error ? cause.message : String(cause))}
    finally {if (generation.current === id) {working.current = false; setBusy(false)}}
  }
  return <section className="lf-paper" aria-label="原创体验起稿">
    <label><input type="checkbox" checked={enabled} disabled={disabled || busy} onChange={event => {
      generation.current++; setEnabled(event.target.checked); setPreview(null); setError(''); created.current = null
    }}/>查看原创体验起稿（实验性）</label>
    {enabled && <div className="space-y-3">
      <p>这三份方案是待制作的原创草稿。选择后会创建新的聊天作品，接着选择冻结世界、确认人物知情范围并制作；暂不能直接游玩。</p>
      <p>只含文本设定，不附带图片、音色或已验收的模型效果。现有作品保留不动。</p>
      {listChatStarterExperiencesV1().map(item => <article key={item.id} className="rounded border border-border p-3">
        <h3>{item.title} · {item.category}</h3><p>{item.summary}</p>
        <button type="button" className="lf-action" disabled={disabled || busy} onClick={() => {
          generation.current++; setPreview(previewChatStarterExperienceV1(item.id)); setError(''); created.current = null
        }}>查看《{item.title}》方案</button>
      </article>)}
      {preview && <section aria-label="原创体验方案预览" className="space-y-3 rounded border border-border p-3">
        <h3>{preview.title}</h3><p>{preview.worldRequirement}</p>
        <h4>玩家身份</h4><p>{preview.settings.playerRole}</p>
        <h4>初始情境</h4><p>{preview.settings.openingSituation}</p>
        <h4>角色如何主动推进</h4><p>{preview.settings.experience}</p>
        <h4>边界与退出</h4><p className="whitespace-pre-wrap">{preview.settings.contentBoundaries}</p>
        <details><summary>作者查看人物背景与隐情</summary>{preview.settings.privateCharacters!.map(character => <article key={character.characterKey} className="my-3">
          <h4>{character.name}</h4><p>{character.identity}</p><p>{character.background}</p><p>{character.personality}</p><p>{character.voice}</p>
        </article>)}</details>
        <p>人物会以本体验的新角色起稿。后续仍须逐项确认哪些资料公开、谁知情、哪些仅供作者了解；不会自动成为世界角色或已发布内容。</p>
        <button type="button" className="lf-action lf-action-primary" disabled={disabled || busy} onClick={() => void createFromPreview()}>使用此方案新建作品（实验性）</button>
        <button type="button" className="lf-action" disabled={busy} onClick={() => {generation.current++; setPreview(null); setError(''); created.current = null}}>取消起稿</button>
      </section>}
    </div>}
    {busy && <p role="status">正在创建作品草稿…</p>}
    {error && <p role="alert">{error}</p>}
  </section>
}
