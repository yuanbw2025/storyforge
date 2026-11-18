import { canonicalPowerModule } from '../lib/workspace/module-alias'
import ProjectStorageFolderField from '../components/shared/ProjectStorageFolderField'
import { bindCreatedProjectStorageWorkspace } from '../lib/storage/project-storage-workspace'
import ExampleLibrary from '../components/examples/ExampleLibrary'
import { useDialog } from '../components/shared/Dialog'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, BookOpen, ImagePlus, MoreHorizontal, Plus, Search } from 'lucide-react'
import { liveQuery } from 'dexie'
import { useNavigate, useSearchParams } from 'react-router'
import { db } from '../lib/db/schema'
import type { Project, Work } from '../lib/types'
import { readWorkLibraryProjectionV1, switchActiveWork } from '../lib/workspace/works'
import { deleteWork } from '../lib/workspace/lifecycle'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { createWorkspace } from '../lib/workspace/create-workspace'
import { effectiveNovelProfile, effectiveWorkKind } from '../lib/workspace/work-kind'
import { useProjectStore } from '../stores/project'
import { LONGFORM_SECTIONS, LONGFORM_STEPS, sectionForModule, type LongformSection, type LongformMode } from '../components/longform/navigation'
import type { SidebarModule } from '../components/layout/sidebar-tree'
import LongformBrowsePage from '../components/longform/LongformBrowsePage'
import LongformLayout from '../components/longform/LongformLayout'
import { useBeforeUnload } from '../hooks/useBeforeUnload'
import type { WorkspaceScope } from '../lib/types'
import '../components/longform/longform-library.css'

export default function LongformLibraryPage() {
  const navigate = useNavigate()
  const dialog = useDialog()
  const [renameDraft, setRenameDraft] = useState<{ scope: WorkspaceScope; original: string; value: string } | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameError, setRenameError] = useState('')
  const renameBusyRef = useRef(false)
  const renameComposingRef = useRef(false)
  useBeforeUnload(Boolean(renameDraft && (renaming || renameDraft.value !== renameDraft.original)))
  const [params, setParams] = useSearchParams()
  const requestedSection = params.get('section')
  const section: LongformSection = LONGFORM_SECTIONS.some(([id]) => id === requestedSection) ? requestedSection as LongformSection : 'library'
  const requestedModule = canonicalPowerModule(params.get('module'))
  const validModules = [...LONGFORM_STEPS.flatMap(step => step.modules.map(([id]) => id)), 'version-history', 'export', 'settings', 'usage-stats', 'import-doc', 'visual-workflows']
  const module = validModules.includes(requestedModule ?? '') ? requestedModule as SidebarModule : section === 'versions' ? 'version-history' : section === 'settings' ? 'settings' : section === 'import' ? 'import-doc' : 'info'
  const mode: LongformMode = params.get('mode') === 'agent' ? 'agent' : params.get('mode') === 'nodes' ? 'nodes' : 'steps'
  const [choosing, setChoosing] = useState(false)
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const chooserRef = useRef<HTMLElement>(null)
  const destination = (projectId: number) => section === 'library' ? `/workspace/${projectId}?module=info` : `/workspace/${projectId}?section=${section}&module=${module}&mode=${mode}${params.get('module') === 'power-system' || params.get('originField') === 'power' ? '&originField=power' : ''}`
  const browse = (nextSection: LongformSection, nextModule: SidebarModule = 'info', nextMode: LongformMode = 'steps') => {
    setChoosing(false); setCreating(false); setError('')
    setParams(nextSection === 'library' ? {} : { section: nextSection, module: nextModule, mode: nextMode })
  }
  const requireWork = () => { setChoosing(true); setError('') }
  useEffect(() => { if (choosing) chooserRef.current?.scrollIntoView({ block: 'nearest' }) }, [choosing])
  const [rows, setRows] = useState<{ project: Project; work: Work }[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [projectFolder, setProjectFolder] = useState<FileSystemDirectoryHandle | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const sub = liveQuery(async () => {
      const projects = await db.projects.toArray()
      const result: { project: Project; work: Work }[] = []
      for (const project of projects) {
        if (project.workspacePurpose !== 'independent-work') continue
        const works = await db.works.where('projectId').equals(project.id!).toArray()
        for (const work of works) if (effectiveWorkKind(work) === 'novel' && effectiveNovelProfile(work) === 'long') result.push({ project, work: await readWorkLibraryProjectionV1(work) })
      }
      return result.sort((a, b) => b.work.updatedAt - a.work.updatedAt)
    }).subscribe({ next: value => { setRows(value); setLoading(false) }, error: cause => { setError(String(cause)); setLoading(false) } })
    return () => sub.unsubscribe()
  }, [])
  const create = async () => {
    if (!title.trim() || busy) return
    setBusy(true); setError('')
    try {
      const result = await createWorkspace({ name: title.trim(), genres: [], description: '', targetWordCount: 300000, status: 'drafting' }, { purpose: 'independent-work', kind: 'novel', novelProfile: 'long' })
      if (projectFolder) {
        try { await bindCreatedProjectStorageWorkspace(result.project.id!, projectFolder) }
        catch (cause) { await dialog.alert({title:'作品已创建，文件夹尚未绑定',message:`${String(cause)}。可在通用设置中重新选择，作品内容已保存在浏览器。`}) }
      }
      await useProjectStore.getState().loadProjects()
      navigate(destination(result.project.id!))
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const rename = (project: Project, work: Work) => {
    setRenameError('')
    setRenameDraft({ scope: { projectId: project.id!, worldId: work.worldId, workId: work.id! }, original: work.title, value: work.title })
  }
  const saveRename = async () => {
    if (!renameDraft || !renameDraft.value.trim() || renameBusyRef.current || renameComposingRef.current) return
    const snapshot = renameDraft
    renameBusyRef.current = true
    setRenaming(true); setRenameError('')
    try {
      await useProjectStore.getState().updateActiveWork(snapshot.scope.projectId, { title: snapshot.value.trim() }, snapshot.scope)
      setRenameDraft(current => current === snapshot ? null : current)
    } catch (cause) { setRenameError(cause instanceof Error ? cause.message : String(cause)) }
    finally { renameBusyRef.current = false; setRenaming(false) }
  }
  const open = async (project: Project, work: Work, path = destination(project.id!)) => {
    try { await switchActiveWork(project.id!, work.id!); navigate(path) }
    catch (cause) { setError(String(cause)) }
  }
  const remove = async (project: Project, work: Work) => {
    try {
      if (await db.works.where('projectId').equals(project.id!).count() === 1) await useProjectStore.getState().deleteProject(project.id!)
      else if (await requireBackupBefore({ operation: '删除长篇作品', projectId: project.id!, details: '删除这部长篇及其正文，保留同一工作区的剧本等其他作品。已有改编会失去原作读取来源。' })) { await deleteWork(work.id!); await useProjectStore.getState().loadProjects() }
    }
    catch (cause) { setError(String(cause)) }
  }
  const visibleRows = rows.filter(({ work }) => `${work.title} ${work.description}`.toLowerCase().includes(search.toLowerCase()))
  return <LongformLayout section={section} mode={mode} module={module} onHome={() => navigate('/')}
    onSection={next => browse(next, next === 'versions' ? 'version-history' : next === 'import' ? 'import-doc' : next === 'settings' ? 'settings' : 'info')}
    onMode={next => browse('workbench', next === 'nodes' ? 'visual-workflows' : 'info', next)}
    onModule={next => browse(sectionForModule(next), next)}>
    {renameDraft && <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/55 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="longform-rename-title" className="lf-paper w-full max-w-lg p-6">
        <h2 id="longform-rename-title">重命名长篇</h2>
        <form onSubmit={event => { event.preventDefault(); void saveRename() }} className="mt-4 space-y-4">
          <input aria-label="新作品名称" autoFocus maxLength={200} value={renameDraft.value} disabled={renaming}
            onCompositionStart={() => { renameComposingRef.current = true }}
            onCompositionEnd={event => { const value = event.currentTarget.value; renameComposingRef.current = false; setRenameDraft(current => current ? { ...current, value } : current) }}
            onChange={event => { const value = event.target.value; setRenameDraft(current => current ? { ...current, value } : current) }}
            onKeyDown={event => { if (event.nativeEvent.isComposing || renameComposingRef.current) { if (event.key === 'Enter') event.preventDefault(); return } if (event.key === 'Escape' && !renameBusyRef.current) setRenameDraft(null) }} />
          {renameError && <p role="alert">未保存：{renameError}。名称仍保留，可以重试。</p>}
          {renaming && <p role="status">正在保存作品名称…</p>}
          <div className="flex justify-end gap-2"><button type="button" className="lf-action" disabled={renaming} onClick={() => setRenameDraft(null)}>取消</button>
            <button type="submit" className="lf-action lf-action-primary" disabled={renaming || !renameDraft.value.trim()}>保存名称</button></div>
        </form>
      </section>
    </div>}
    {section !== 'library' && choosing && <section ref={chooserRef} className="lf-paper" aria-label="选择操作的作品">
      <h3>选择或创建一部作品</h3><p role="status">这个操作需要一部作品。选择后会进入当前功能页，由你继续操作。</p>
      {rows.length > 0 && <div className="flex flex-wrap gap-3 mb-4"><select aria-label="选择长篇作品" value={selectedProjectId} onChange={event => setSelectedProjectId(event.target.value)}><option value="">请选择作品</option>{rows.map(row => <option key={row.work.id} value={row.work.id}>{row.work.title}</option>)}</select><button className="lf-action lf-action-primary" disabled={!selectedProjectId || !rows.some(row => String(row.work.id) === selectedProjectId)} onClick={() => { const row = rows.find(item => String(item.work.id) === selectedProjectId); if (row) void open(row.project, row.work) }}>使用这部作品</button></div>}
      <form onSubmit={event => { event.preventDefault(); void create() }} className="flex flex-wrap gap-3"><ProjectStorageFolderField value={projectFolder} onChange={setProjectFolder} disabled={busy}/><input aria-label="新长篇名称" value={title} onChange={event => setTitle(event.target.value)} placeholder="新长篇名称" maxLength={200}/><button className="lf-action lf-action-primary" disabled={busy || loading || !title.trim()}>{busy ? '创建中…' : '创建并进入当前页面'}</button><button className="lf-action" type="button" onClick={() => setChoosing(false)}>继续浏览</button></form>
      {error && <p role="alert">{error}</p>}
    </section>}
    {section !== 'library' ? <LongformBrowsePage section={section} mode={mode} module={module} onModule={next => browse(section, next, mode)} onRequireWork={requireWork}/> : <div className="lf-library">
    <section className="lf-paper lf-library-tools" aria-label="长篇作品库工具">
      <div className="lf-library-toolbar">
        <span className="lf-library-count">{loading ? '读取作品…' : `${rows.length} 部长篇`}</span>
        <label className="lf-library-search"><Search size={17} aria-hidden="true"/><input aria-label="搜索长篇" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索作品名称或简介"/></label>
        <button className="lf-action lf-action-primary" aria-expanded={creating} onClick={() => setCreating(value => !value)}><Plus size={17} aria-hidden="true"/>新建长篇</button>
      </div>
      {creating && <form className="lf-library-create" onSubmit={event => { event.preventDefault(); void create() }}>
        <h3>新建长篇</h3>
        <input aria-label="新长篇名称" autoFocus value={title} onChange={event => setTitle(event.target.value)} placeholder="为这部作品起个名字" maxLength={200}/>
        <ProjectStorageFolderField value={projectFolder} onChange={setProjectFolder} disabled={busy}/>
        <div className="lf-library-create-actions"><button type="button" className="lf-action" disabled={busy} onClick={() => setCreating(false)}>取消</button><button className="lf-action lf-action-primary" disabled={busy || !title.trim()}>{busy ? '创建中…' : '创建并进入工作台'}</button></div>
      </form>}
      {error && <p role="alert">{error}</p>}
    </section>
    {loading ? <p role="status">正在读取作品库…</p> : !rows.length ? <section className="lf-paper lf-library-empty"><BookOpen size={30} aria-hidden="true"/><div><h3>从你的第一个故事开始</h3><p>新建长篇后，就可以逐步完善世界、故事与人物，写下正文。</p></div></section> : !visibleRows.length ? <section className="lf-paper lf-library-empty" role="status"><Search size={28} aria-hidden="true"/><div><h3>没有找到匹配的长篇</h3><p>试试其他书名或简介关键词。</p><button className="lf-action" onClick={() => setSearch('')}>清除搜索</button></div></section> : <div className="lf-library-books">{visibleRows.map(({ project, work }) => <article className="lf-paper lf-library-card" key={work.id} aria-label={work.title}>
      <div className="lf-library-book">
        <button type="button" className="lf-library-cover" aria-label={`修改封面：${work.title}`} onClick={() => void open(project, work, `/home/cover?work=${work.id}`)}>
          {work.coverImage ? <img src={work.coverImage} alt=""/> : <span className="lf-library-cover-placeholder"><BookOpen size={28} aria-hidden="true"/><span>暂无封面</span></span>}
          <span className="lf-library-cover-action"><ImagePlus size={14} aria-hidden="true"/>{work.coverImage ? '更换封面' : '上传封面'}</span>
        </button>
        <div className="lf-library-book-info"><h3>{work.title}</h3><p className="lf-library-description">{work.description || '尚未填写作品简介'}</p><div className="lf-library-meta"><span>{work.currentWordCount.toLocaleString()} 字</span><span>最近编辑 <time dateTime={new Date(work.updatedAt).toJSON() ?? undefined}>{new Date(work.updatedAt).toLocaleDateString('zh-CN')}</time></span></div></div>
      </div>
      <div className="lf-library-card-actions">
        <button className="lf-action lf-action-primary" onClick={() => void open(project, work, `/workspace/${project.id}?module=info`)}>进入长篇工作台<ArrowRight size={16} aria-hidden="true"/></button>
        <details className="lf-library-more" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus() } }}>
          <summary className="lf-action" aria-label={`更多操作：${work.title}`}>更多操作<MoreHorizontal size={17} aria-hidden="true"/></summary>
          <div className="lf-library-menu">
            <button onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); rename(project, work) }}>重命名</button>
            <button onClick={() => void open(project, work, `/home/cover?work=${work.id}`)}>修改封面</button>
            <button onClick={() => void open(project, work, `/workspace/${project.id}?module=export`)}>导出与备份</button>
            <button className="lf-library-delete" onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); void remove(project, work) }}>删除作品</button>
          </div>
        </details>
      </div>
    </article>)}</div>}
    <ExampleLibrary kind="long"/>
    </div> }
  </LongformLayout>
}
