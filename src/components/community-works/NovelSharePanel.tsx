import { useEffect, useState } from 'react'
import type { Chapter, OutlineNode } from '../../lib/types/outline'
import type { WorkspaceScope } from '../../lib/types/world-ownership'
import { readOwnedRows } from '../../lib/workspace/scope'
import { loadSelectedNovelPreview } from '../../lib/community-works/local-preview'
import CommunityShareFlow from './CommunityShareFlow'

export default function NovelSharePanel({ scope, onClose }: { scope: WorkspaceScope; onClose: () => void }) {
  const [chapters, setChapters] = useState<Chapter[]>([])
  const [selected, setSelected] = useState<number[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    let active = true
    setState('loading'); setSelected([])
    void Promise.all([
      readOwnedRows<Chapter>(scope, 'chapters', { owner: 'work' }),
      readOwnedRows<OutlineNode>(scope, 'outlineNodes', { owner: 'work' }),
    ]).then(([rows, nodes]) => {
      if (!active) return
      const owned = new Set(nodes.flatMap(node => node.id == null ? [] : [node.id]))
      setChapters(rows.filter(row => row.id != null && owned.has(row.outlineNodeId) && row.content.trim())
        .sort((a, b) => a.order - b.order || (a.id ?? 0) - (b.id ?? 0)))
      setState('ready')
    }).catch(() => { if (active) setState('error') })
    return () => { active = false }
  }, [scope.projectId, scope.worldId, scope.workId])
  const ids = chapters.flatMap(chapter => chapter.id == null ? [] : [chapter.id])
  const chosen = ids.filter(id => selected.includes(id))
  return <section aria-label="选择小说公开章节" className="space-y-4 bg-bg-surface border border-border rounded-xl p-4 mt-4">
    <div className="flex justify-between items-center gap-2"><h3 className="font-semibold">分享小说到社区作品集</h3>
      <button type="button" onClick={onClose} aria-label="关闭小说分享">关闭</button></div>
    <p className="text-xs text-text-muted">默认不选任何章节。可按需要分享任意数量已写正文的章节，并按作品顺序展示。</p>
    {state === 'loading' && <p role="status">正在读取当前作品章节…</p>}
    {state === 'error' && <p role="alert">章节读取失败；没有上传任何内容。</p>}
    {state === 'ready' && <><div className="flex gap-3 text-xs">
      <button type="button" onClick={() => setSelected(ids)}>选择全部 {ids.length} 章</button>
      <button type="button" onClick={() => setSelected([])}>全部取消</button></div>
      <div className="max-h-64 overflow-y-auto space-y-1" role="group" aria-label="选择公开章节">
        {chapters.map((chapter, index) => <label key={chapter.id} className="flex gap-2 items-start text-xs p-2 border border-border rounded">
          <input type="checkbox" checked={selected.includes(chapter.id!)} onChange={event => setSelected(current =>
            event.target.checked ? [...current, chapter.id!] : current.filter(id => id !== chapter.id))} />
          <span>{index + 1}. {chapter.title} · {chapter.content.length.toLocaleString()} 字</span></label>)}
        {chapters.length === 0 && <p>当前作品还没有可分享的章节正文。</p>}
      </div>
      {chosen.length > 0 && <CommunityShareFlow selectionRevision={chosen.join(',')}
        buildSnapshot={() => loadSelectedNovelPreview({ scope, selectedChapterIds: chosen, publicRightsConfirmed: true })} />}
    </>}
  </section>
}
