import BrandIcon from '../components/shared/BrandIcon'
import ExampleLibrary from '../components/examples/ExampleLibrary'
import { ensureShortNovelProductionV1, reopenShortNovelProductionV1 } from '../lib/short-novel/service'
import { useAutoBackup } from '../hooks/useAutoBackup'
import { useGistAutoBackup } from '../hooks/useGistAutoBackup'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import { BookOpen } from 'lucide-react'
import { db } from '../lib/db/schema'
import type { Project, Work } from '../lib/types'
import { createWorkspace } from '../lib/workspace/create-workspace'
import { effectiveNovelProfile, effectiveWorkKind } from '../lib/workspace/work-kind'
import { deleteWork } from '../lib/workspace/lifecycle'
import { requireBackupBefore } from '../lib/safety/require-backup-before'
import { switchActiveWork, switchNovelProfile } from '../lib/workspace/works'
import { useProjectStore } from '../stores/project'
import { useDialog } from '../components/shared/Dialog'
import { PRODUCT_NAVIGATION } from '../components/navigation/product-navigation'
import { flushPendingEditsV1 } from '../lib/authoring/pending-edit-coordinator'
import { downloadJSON, exportProjectJSON } from '../lib/export/json-export'
import type { Stage } from '../components/short-novel/ShortNovelStudio'
import '../components/longform/longform.css'
import '../components/short-novel/shortform.css'

const Studio = lazy(() => import('../components/short-novel/ShortNovelStudio'))
const Worlds = lazy(() => import('../components/longform/LongformWorlds'))
const DataManagement = lazy(() => import('../components/data/DataManagementPanel'))
const Settings = lazy(() => import('../components/settings/SettingsPage'))
const pages = [['library','作品库'],['intent','创作意图'],['story','故事设计'],['chapters','章节卡'],['editor','正文'],['review','全篇审校'],['versions','版本与导出'],['derive','扩展与派生'],['community','社区与发行'],['settings','通用设置']] as const
const stages: Record<string,Stage> = {intent:'brief',story:'design',chapters:'plan',editor:'draft',review:'review',versions:'release'}
const descriptions: Record<string,string> = {
  intent:'填写故事前提、核心变化、主导情绪、读者与叙事承诺，确认这篇故事的创作方向。',
  story:'安排主人公的欲望、压力、升级、转折、高潮选择与结尾余韵。',
  chapters:'为 3～8 章安排叙事目标、开场压力、冲突、转折、离场状态与字数预算。',
  editor:'选择一章写作或生成候选。逐章确认，保留每次编辑与修改。',
  review:'通读全篇，依据原文证据处理问题；选择问题后可以生成整章重写候选。',
  versions:'检查完成条件，封存不可变版本，导出 Markdown、TXT、JSON，或备份整个作品。',
  derive:'将短篇扩写为长篇，或从已确认内容派生独立世界。',
  community:'管理这部作品派生的世界与本地分享包。',
}
export default function ShortformPage() {
  const { pageId = 'library' } = useParams()
  const current = pages.some(([id])=>id===pageId) ? pageId : 'library'
  const [params] = useSearchParams()
  const projectId = Number(params.get('project')) || null
  const navigate = useNavigate()
  const dialog = useDialog()
  const [rows,setRows] = useState<{project:Project;work:Work}[]>([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState(false)
  const [metadataRevision,setMetadataRevision] = useState(0)
  const [choosing,setChoosing] = useState(false)
  const [menu,setMenu] = useState(false)
  const [title,setTitle] = useState('')
  const [target,setTarget] = useState(8000)
  const [count,setCount] = useState(4)
  const [search,setSearch] = useState('')
  const [selected,setSelected] = useState('')
  const row = rows.find(item=>item.project.id===projectId)
  const [readyWorkId,setReadyWorkId] = useState<number|null>(null)
  useAutoBackup(row?.project.id ?? null)
  useGistAutoBackup(row?.project.id ?? null)
  const selectedWorkId = row?.work.id
  const selectedWorldId = row?.work.worldId
  const scope = useMemo(()=>projectId && selectedWorkId && selectedWorldId ? {projectId,workId:selectedWorkId,worldId:selectedWorldId} : null,[projectId,selectedWorkId,selectedWorldId])
  useEffect(()=>{
    const subscription = liveQuery(async()=>{
      const projects = await db.projects.toArray()
      const works = await db.works.toArray()
      return projects.flatMap(project=>{
        const work=works.find(item=>item.projectId===project.id&&effectiveWorkKind(item)==='novel'&&effectiveNovelProfile(item)==='short')
        return project.workspacePurpose==='independent-work'&&work&&effectiveWorkKind(work)==='novel'&&effectiveNovelProfile(work)==='short' ? [{project,work}] : []
      }).sort((a,b)=>b.work.updatedAt-a.work.updatedAt)
    }).subscribe({next:value=>{setRows(value);setLoading(false)},error:cause=>{setError(String(cause));setLoading(false)}})
    return ()=>subscription.unsubscribe()
  },[])
  useEffect(()=>{
    let cancelled=false
    if(projectId&&selectedWorkId)void switchActiveWork(projectId,selectedWorkId).then(()=>{if(!cancelled)setReadyWorkId(selectedWorkId)}).catch(cause=>{if(!cancelled)setError(String(cause))})
    else setReadyWorkId(null)
    return ()=>{cancelled=true}
  },[projectId,selectedWorkId])
  const go = useCallback(async(path:string)=>{
    try { await flushPendingEditsV1();setChoosing(false);setMenu(false);setError('');navigate(path) }
    catch(cause){setError(String(cause))}
  },[navigate])
  const pagePath = (id:string, targetProject:number|null=projectId)=>`/short/${id}${targetProject?`?project=${targetProject}`:''}`
  const onStageChange = useCallback((stage:Stage)=>{ const id=Object.keys(stages).find(key=>stages[key]===stage)!;navigate(`/short/${id}?project=${projectId}`) },[navigate,projectId])
  const create = async()=>{
    if(busy||!title.trim())return
    setBusy(true);setError('')
    try {
      if(!Number.isInteger(count)||count<3||count>8)throw new Error('短篇需要 3～8 章')
      const result=await createWorkspace({name:title.trim(),description:'',genres:[],targetWordCount:target,status:'drafting'},{purpose:'independent-work',kind:'novel',novelProfile:'short',preferredChapterCount:count})
      await useProjectStore.getState().loadProjects()
      await go(pagePath(current==='library'?'intent':current,result.project.id!))
    }catch(cause){setError(String(cause))}finally{setBusy(false)}
  }
  const openDraft = async(project:Project,work:Work)=>{
    await switchActiveWork(project.id!,work.id!)
    const targetScope={projectId:project.id!,workId:work.id!,worldId:work.worldId}
    const production=await ensureShortNovelProductionV1(targetScope)
    if(production.phase==='complete')await reopenShortNovelProductionV1({scope:targetScope,expectedRevision:production.revision})
  }
  const rename = async(project:Project,work:Work)=>{
    const value=await dialog.prompt({title:'重命名短篇',defaultValue:work.title,confirmText:'保存名称'})
    if(value?.trim())try{await flushPendingEditsV1();await openDraft(project,work);await useProjectStore.getState().updateActiveWork(project.id!,{title:value.trim()});setMetadataRevision(value=>value+1)}catch(cause){setError(String(cause))}
  }
  const describe = async(project:Project,work:Work)=>{
    const value=await dialog.prompt({title:'编辑短篇简介',message:'简介会作为 AI 创作的作品背景，正式创作意图仍需在表单中确认。',defaultValue:work.description,confirmText:'保存简介'})
    if(value!==null)try{await flushPendingEditsV1();await openDraft(project,work);await useProjectStore.getState().updateActiveWork(project.id!,{description:value.trim()});setMetadataRevision(value=>value+1)}catch(cause){setError(String(cause))}
  }
  const remove = async(project:Project,work:Work)=>{try{
    if(await db.works.where('projectId').equals(project.id!).count()===1)await useProjectStore.getState().deleteProject(project.id!)
    else if(await requireBackupBefore({operation:'删除短篇作品',projectId:project.id!,details:'删除这部短篇及其正文，保留同一工作区的剧本等其他作品。已有改编会失去原作读取来源。'})){await deleteWork(work.id!);await useProjectStore.getState().loadProjects()}
  }catch(cause){setError(String(cause))}}
  const expand = async()=>{
    if(!row||busy)return
    if(!await dialog.confirm({title:'扩写为长篇？',message:'保留这部作品的正文和短篇历史版本，记录转换来源，并下载转换前备份；后续进入长篇工作台。',confirmText:'备份并扩写'}))return
    setBusy(true);setError('')
    try{
      await flushPendingEditsV1()
      const backup=await exportProjectJSON(row.project.id!)
      await downloadJSON(backup,`${row.work.title}-短篇转换前备份.json`)
      await switchNovelProfile({projectId:row.project.id!,workId:row.work.id!,profile:'long',targetWordCount:Math.max(100000,row.work.targetWordCount)})
      await useProjectStore.getState().loadProjects()
      navigate(`/workspace/${row.project.id}?module=info`)
    }catch(cause){setError(String(cause))}finally{setBusy(false)}
  }
  return <div className={`longform-app shortform-app ${menu?'lf-navigation-open':''}`}>
    <header className="lf-top"><button className="lf-brand" aria-label="返回首页" onClick={()=>void go('/')}><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></button><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(item=><Link key={item.id} to={item.path} aria-current={item.id==='short'?'page':undefined} onClick={event=>{event.preventDefault();void go(item.path)}}>{item.label}</Link>)}</nav></header>
    <aside className="lf-sidebar"><small>SHORT FICTION</small><h1>短篇创作</h1><p>短短一篇，也能容纳完整的余韵。</p>{row&&<button className="lf-current" onClick={()=>setChoosing(true)}><BookOpen/><span>{row.work.title}</span></button>}<nav aria-label="短篇页面导航">{pages.map(([id,label])=><button key={id} aria-current={id===current?'page':undefined} onClick={()=>void go(pagePath(id))}>{label}</button>)}</nav></aside>
    <section className="lf-main"><header className="lf-heading"><h2>{pages.find(([id])=>id===current)?.[1]}</h2>{row&&<div className="short-work-tools" aria-label="当前短篇作品"><span title={row.work.description||row.work.title}>{row.work.title}</span><button className="lf-action" onClick={()=>void rename(row.project,row.work)}>修改作品名称</button><button className="lf-action" onClick={()=>void describe(row.project,row.work)}>编辑作品简介</button></div>}<div className="lf-mobile-controls"><button onClick={()=>setMenu(!menu)}>短篇导航</button></div></header><div className="lf-body"><div className="lf-content">
      {error&&<p className="short-error" role="alert">{error}</p>}
      {choosing&&<section className="lf-paper" aria-label="选择或创建短篇"><h3>这个操作需要一部短篇</h3>{rows.length>0&&<div className="short-choose"><select aria-label="选择短篇作品" value={selected} onChange={event=>setSelected(event.target.value)}><option value="">请选择作品</option>{rows.map(item=><option key={item.project.id} value={item.project.id}>{item.work.title}</option>)}</select><button className="lf-action" disabled={!rows.some(item=>String(item.project.id)===selected)} onClick={()=>void go(pagePath(current==='library'?'intent':current,Number(selected)))}>使用这部短篇</button></div>}<form onSubmit={event=>{event.preventDefault();void create()}}><div className="short-fields"><label>作品名称<input aria-label="新短篇名称" value={title} onChange={event=>setTitle(event.target.value)} maxLength={200}/></label><label>目标字数<input aria-label="新短篇目标字数" type="number" value={target} onChange={event=>setTarget(Number(event.target.value))}/></label><label>章节数<input aria-label="新短篇章节数" type="number" value={count} onChange={event=>setCount(Number(event.target.value))}/></label></div><button className="lf-action lf-action-primary" disabled={busy||!title.trim()}>{busy?'创建中…':'创建并进入当前页面'}</button><button type="button" className="lf-action" onClick={()=>setChoosing(false)}>继续浏览</button></form></section>}
      {(loading||(current!=='library'&&row&&readyWorkId!==row.work.id))?<p role="status">正在读取短篇作品…</p>:current==='library'?<><section className="lf-paper"><div className="short-between"><h3>我的短篇</h3><button className="lf-action lf-action-primary" onClick={()=>setChoosing(true)}>新建短篇</button></div><input aria-label="搜索短篇" placeholder="搜索作品名称或简介" value={search} onChange={event=>setSearch(event.target.value)}/></section><div className="lf-library-grid">{rows.filter(item=>`${item.work.title} ${item.work.description}`.includes(search)).map(item=><article className="lf-paper" key={item.work.id}><h3>{item.work.title}</h3><p>{item.work.description||'尚未填写故事简介'}</p><p>{item.work.currentWordCount} 字 · {item.work.status==='completed'?'已完成':'创作中'}</p><button className="lf-action lf-action-primary" onClick={()=>void go(pagePath('intent',item.project.id!))}>继续创作</button><div className="short-row-actions"><button onClick={()=>void rename(item.project,item.work)}>重命名</button><button onClick={()=>void go(pagePath('versions',item.project.id!))}>版本与备份</button><button onClick={()=>void remove(item.project,item.work)}>删除作品</button></div></article>)}</div>{rows.length===0&&<section className="lf-paper"><h3>从一个念头开始</h3><p>先浏览创作页面，准备好时再新建短篇。</p></section>}<ExampleLibrary kind="short"/></>:current==='settings'?<Suspense fallback={<p>加载设置…</p>}><div className="short-settings"><Settings project={row?.project}/></div></Suspense>:!row||!scope?<section className="lf-paper" aria-label="未选择短篇的功能页"><h3>{pages.find(([id])=>id===current)?.[1]}</h3><p>{descriptions[current]}</p><p>{projectId?'这部短篇不存在或已转换为其他作品。':'尚未选择作品，可以先浏览各个功能页。'}</p><button className="lf-action lf-action-primary" onClick={()=>setChoosing(true)}>选择或创建短篇</button></section>:<Suspense fallback={<p role="status">正在打开短篇功能…</p>}>

        {stages[current]&&<Studio key={`${scope.workId}:${metadataRevision}`} project={row.project} scope={scope} activeStage={stages[current]} onStageChange={onStageChange} structured/>}
        {current==='versions'&&<details className="lf-paper"><summary>完整备份、导入与恢复</summary><DataManagement project={row.project} onImported={async id=>{const imported=await db.projects.get(id);const work=imported?.activeWorkId?await db.works.get(imported.activeWorkId):null;navigate(work&&effectiveWorkKind(work)==='novel'&&effectiveNovelProfile(work)==='short'?`/short/intent?project=${id}`:`/workspace/${id}`)}} onOpenStorageSettings={()=>void go(pagePath('settings'))}/></details>}
        {(current==='derive'||current==='community')&&<>{current==='derive'&&<section className="lf-paper"><h3>扩写为长篇</h3><p>保留正文与历史版本，转入长篇工作台继续创作。与派生世界分别进行。</p><button className="lf-action lf-action-primary" disabled={busy} onClick={()=>void expand()}>扩写为长篇</button></section>}<Worlds project={row.project} community={current==='community'} onOpen={id=>navigate(`/workspace/${id}`)}/></>}
      </Suspense>}
    </div></div></section>
  </div>
}
