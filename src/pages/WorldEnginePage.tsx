import { canonicalPowerModule } from '../lib/workspace/module-alias'
import BrandIcon from '../components/shared/BrandIcon'
import WorldDraftSummary from '../components/world-engine/WorldDraftSummary'
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import { ArrowRight, BookOpen, CheckCircle2, Database, Globe2, Layers, Map, ScrollText, Sparkles, Users, Waypoints } from 'lucide-react'
import { db } from '../lib/db/schema'
import type { Project, World, Work, ProductProductionHandoffV1 } from '../lib/types'
import { isShareableWorld } from '../lib/world-engine/world-identity'
import { createWorkspace } from '../lib/workspace/create-workspace'
import { updateWorldDraftMetadata } from '../lib/world-engine/draft'
import { useWorldGroupStore } from '../stores/world-group'
import { useProjectStore } from '../stores/project'
import { flushPendingEditsV1 } from '../lib/authoring/pending-edit-coordinator'
import { useDialog } from '../components/shared/Dialog'
import { WORLD_PAGES, WORLD_CONTENT_PAGES, WORLD_PRIMARY_PAGES, worldPrimaryPage, worldModulePath } from '../components/world-engine/navigation'
import { PRODUCT_NAVIGATION } from '../components/navigation/product-navigation'
import WorldWorkManager from '../components/world-engine/WorldWorkManager'
import { useAutoBackup } from '../hooks/useAutoBackup'
import { useGistAutoBackup } from '../hooks/useGistAutoBackup'
import '../components/longform/longform.css'
import '../components/world-engine/panels.css'
import '../components/world-engine/world-engine.css'

const Workspace=lazy(()=>import('./WorkspacePage'))
const Versions=lazy(()=>import('../components/world-engine/WorldNarrativeReleasePanel'))
const Sharing=lazy(()=>import('../components/product/WorldSharingPanel'))
const Outlet=lazy(()=>import('../components/world-engine/WorldResourceBrowser'))
const Settings=lazy(()=>import('../components/settings/SettingsPage'))
type Row={project:Project;world:World;work:Work}
const contentIcons=[Sparkles,Map,Layers,Users,ScrollText,BookOpen,Waypoints,Globe2]
export default function WorldEnginePage(){
 const contentRef=useRef<HTMLDivElement>(null)
 const contentNavRef=useRef<HTMLElement>(null)
 const {pageId='worlds'}=useParams();const definition=WORLD_PAGES.find(p=>p.id===pageId)??WORLD_PAGES[0]
 const [params]=useSearchParams();const navigate=useNavigate();const dialog=useDialog()
 const projectId=Number(params.get('project'))||null
 const module=definition.modules?.find(([id])=>id===canonicalPowerModule(params.get('module')))?.[0]??definition.modules?.[0]?.[0]
 const [rows,setRows]=useState<Row[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[choosing,setChoosing]=useState(params.has('create')),[menu,setMenu]=useState(false),[title,setTitle]=useState(''),[description,setDescription]=useState(''),[search,setSearch]=useState(''),[revision,setRevision]=useState(0)
 const [contentMenu,setContentMenu]=useState(false)
 const row=rows.find(r=>r.project.id===projectId)
 useEffect(()=>{contentRef.current?.scrollTo(0,0)},[definition.id,module,projectId])
 useAutoBackup(row?.project.id??null);useGistAutoBackup(row?.project.id??null)
 useEffect(()=>{const sub=liveQuery(async()=>{
  const [projects,worlds,works]=await Promise.all([db.projects.toArray(),db.worlds.toArray(),db.works.toArray()])
  return projects.flatMap(project=>{
   const world=worlds.find(w=>w.id===project.activeWorldId&&w.projectId===project.id&&isShareableWorld(w))
   const work=works.find(w=>w.id===project.activeWorkId&&w.projectId===project.id&&w.worldId===world?.id)
   return world&&work?[{project,world,work}]:[]
  })
 }).subscribe({next:value=>{setRows(value);setLoading(false)},error:c=>{setError(String(c));setLoading(false)}});return()=>sub.unsubscribe()},[])
 const path=(id:string,pid:number|null=projectId)=>`/world/${id}${pid?`?project=${pid}`:''}`
 const go=async(url:string)=>{try{await flushPendingEditsV1();setChoosing(false);setMenu(false);setContentMenu(false);setError('');navigate(url)}catch(c){setError(String(c))}}
 const refresh=async()=>{await useProjectStore.getState().loadProjects();setRevision(value=>value+1)}
 const create=async()=>{if(busy||!title.trim())return;setBusy(true);setError('');try{
  await flushPendingEditsV1()
  const created=await createWorkspace({name:title.trim(),description:description.trim(),genres:[],status:'drafting',targetWordCount:300000},{purpose:'world-engine',kind:'novel',novelProfile:'long'})
  await refresh();setTitle('');setDescription('');await go(path(definition.id==='worlds'?'basics':definition.id,created.project.id!))
 }catch(c){setError(String(c))}finally{setBusy(false)}}
 const editMetadata=async(target:Row)=>{try{
  const name=await dialog.prompt({title:'世界名称',defaultValue:target.world.name});if(name===null)return
  const description=await dialog.prompt({title:'世界简介',defaultValue:target.world.description});if(description===null)return
  await updateWorldDraftMetadata({projectId:target.project.id!,worldId:target.world.id!,workId:target.work.id!},{name,description},target.world.updatedAt)
 }catch(c){setError(String(c))}}
 const enableMultiWorld=async()=>{if(!row||busy)return;setBusy(true);try{await flushPendingEditsV1();if(await useWorldGroupStore.getState().enableMultiWorld(row.project.id!)){await refresh()}}catch(c){setError(String(c))}finally{setBusy(false)}}
 const remove=async(target:Row)=>{try{await flushPendingEditsV1();await useProjectStore.getState().deleteProject(target.project.id!);if(projectId===target.project.id&&!(await db.projects.get(projectId!)))await go('/world/worlds')}catch(c){setError(String(c))}}
 const handoff=(value:ProductProductionHandoffV1)=>{const base=value.productType==='ttrpg'?'ttrpg/source':value.productType==='avg'?'avg/source':value.productType==='text-open-world'?'openworld/runtime':'adventure/runtime';void go(`/${base}?worldHandoff=${encodeURIComponent(JSON.stringify(value))}`)}
 const modules=definition.modules??[]
 const primaryId=worldPrimaryPage(definition.id)
 const isWorldbuilding=primaryId==='worldbuilding'
 const hasContentNav=isWorldbuilding||modules.length>1
 useEffect(()=>{contentNavRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({block:'nearest'})},[definition.id,module,contentMenu])
 return <div className={`longform-app world-engine-app ${menu?'lf-navigation-open':''} ${contentMenu?'lf-step-menu-open':''}`} data-testid="world-engine-page">
  <header className="lf-top"><button className="lf-brand" aria-label="返回首页" onClick={()=>void go('/')}><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></button><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(item=><Link key={item.id} to={item.path} aria-current={item.id==='world'?'page':undefined} onClick={e=>{e.preventDefault();void go(item.path)}}>{item.label}</Link>)}</nav></header>
  <aside className="lf-sidebar"><small>WORLD ENGINE</small><h1>世界引擎</h1><p>让世界成为故事的土壤。</p><button className="lf-current" onClick={()=>setChoosing(!choosing)}><Globe2/><span>{row?.world.name??'选择或创建世界'}</span></button><nav aria-label="世界页面导航">{WORLD_PRIMARY_PAGES.map(p=><button key={p.id} aria-current={p.id===primaryId?'page':undefined} onClick={()=>void go(path(p.id))}>{p.label}</button>)}</nav></aside>
  <section className="lf-main"><header className="lf-heading"><small>世界引擎 › {isWorldbuilding&&definition.id!=='worldbuilding'?'世界设定 › ':''}{definition.label}{row?` · ${row.world.code}`:''}</small><h2>{isWorldbuilding?'世界设定':definition.label}</h2>{row&&definition.id==='story'&&<small>当前叙事：{row.work.title}</small>}<div className="lf-mobile-controls"><button aria-expanded={menu} onClick={()=>{setMenu(!menu);setContentMenu(false)}}>世界目录</button>{hasContentNav&&<button aria-expanded={contentMenu} onClick={()=>{setContentMenu(!contentMenu);setMenu(false)}}>{isWorldbuilding?'设定目录':'内容目录'}</button>}</div></header>
  <div className={`lf-body ${hasContentNav?'lf-with-steps':''}`}>
   {hasContentNav&&<aside ref={contentNavRef} className="lf-steps we-content-sidebar"><h3>{isWorldbuilding?'设定分类':definition.label}</h3><nav aria-label="世界内容导航">{isWorldbuilding?<>
    <button aria-current={definition.id==='worldbuilding'?'page':undefined} onClick={()=>void go(path('worldbuilding'))}>设定总览</button>
    {WORLD_CONTENT_PAGES.map(group=><div className="we-content-group" key={group.id}>
     <button className="we-content-family" aria-expanded={definition.id===group.id} onClick={()=>void go(path(group.id))}>{group.label}</button>
     {definition.id===group.id&&<div className="we-content-modules">{group.modules?.map(([id,label])=><button key={id} aria-current={id===module?'page':undefined} onClick={()=>void go(projectId?worldModulePath(projectId,id):`/world/${group.id}?module=${id}`)}>{label}</button>)}</div>}
    </div>)}
   </>:modules.map(([id,label])=><button key={id} aria-current={id===module?'page':undefined} onClick={()=>void go(projectId?worldModulePath(projectId,id):`/world/${definition.id}?module=${id}`)}>{label}</button>)}</nav></aside>}
   <div ref={contentRef} className="lf-content">
    {error&&<p className="we-error" role="alert">{error}</p>}
    {choosing&&<section className="lf-paper"><h3>选择或创建世界</h3><p>浏览页面不需要世界；保存、生成与封存时需要一个明确的世界。</p><div className="we-actions">{rows.map(r=><button className="lf-action" key={r.world.id} onClick={()=>void go(path(definition.id,r.project.id!))}>{r.world.name} · {r.world.code}</button>)}</div><form onSubmit={e=>{e.preventDefault();void create()}}><fieldset disabled={busy}><label>世界名称<input aria-label="新世界名称" value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label><label>世界简介<textarea aria-label="新世界简介" value={description} maxLength={20000} onChange={e=>setDescription(e.target.value)}/></label><div className="we-actions"><button className="lf-action lf-action-primary" disabled={!title.trim()}>{busy?'正在创建…':'创建世界'}</button><button className="lf-action" type="button" onClick={()=>setChoosing(false)}>继续浏览</button></div></fieldset></form></section>}
    {loading?<p role="status">读取世界…</p>:definition.id==='worlds'?<>
     <section className="lf-paper"><div className="we-actions"><button className="lf-action lf-action-primary" onClick={()=>setChoosing(true)}>新建世界</button><button className="lf-action" onClick={()=>void go(path('sharing'))}>导入世界包</button><input aria-label="搜索本地世界" placeholder="搜索世界名称、简介或编号" value={search} onChange={e=>setSearch(e.target.value)}/></div><p>本地世界可编辑；封存版本供其他产品引用。当前编号搜索仅查找本地已保存的世界。</p></section>
     <div className="lf-library-grid">{rows.filter(r=>`${r.world.name} ${r.world.code} ${r.world.description}`.toLowerCase().includes(search.toLowerCase())).map(r=><article className="lf-paper" key={r.world.id}><small>{r.world.code} · {r.world.currentVersion?`已发布 v${r.world.currentVersion}`:'尚未发布'}</small><h3>{r.world.name}</h3><p>{r.world.description||'尚未填写世界简介'}</p><div className="we-actions"><button className="lf-action lf-action-primary" onClick={()=>void go(path('basics',r.project.id!))}>编辑世界</button><button className="lf-action" onClick={()=>void go(path('versions',r.project.id!))}>版本与封存</button><button onClick={()=>void editMetadata(r)}>名称与简介</button><button onClick={()=>void remove(r)}>删除世界</button></div></article>)}</div>{!rows.length&&<section className="lf-paper"><h3>从一个世界开始</h3><p>可以先浏览所有内容页，准备好后再创建或导入。</p></section>}
    </>:definition.id==='worldbuilding'?<div className="we-overview-layout">
     <section className="lf-paper we-setting-overview"><small>WORLD BUILDING</small><h3>{row?.world.name??'让世界逐渐成形'}</h3><p>{row?.world.description||definition.description}</p><div className="we-setting-grid">{WORLD_CONTENT_PAGES.map((group,index)=>{const Icon=contentIcons[index];return <button key={group.id} className="we-setting-card" onClick={()=>void go(path(group.id))}><span className="we-setting-icon"><Icon size={22}/></span><span><strong>{group.label}</strong><small>{group.description}</small></span><ArrowRight size={17}/></button>})}</div></section>
     <aside className="we-overview-context" aria-label="世界状态与出口">
      <section className="lf-paper we-world-status"><h3><CheckCircle2 size={21}/>世界状态</h3>{row?<><dl><div><dt>当前世界</dt><dd>{row.world.name}</dd></div><div><dt>正在编辑</dt><dd>世界草稿</dd></div><div><dt>封存版本</dt><dd>{row.world.currentVersion?`v${row.world.currentVersion}`:'尚未封存'}</dd></div><div><dt>世界信息更新</dt><dd>{new Date(row.world.updatedAt).toLocaleDateString('zh-CN')}</dd></div></dl><p>编辑草稿后，需重新封存才会更新可供引用的版本。</p></>:<p>可以先浏览设定分类；准备保存内容时，再选择或创建世界。</p>}<button className="lf-action lf-action-primary" onClick={()=>row?void go(path('versions')):setChoosing(true)}>{row?'检查与封存':'选择或创建世界'}</button></section>
      <section className="lf-paper we-world-outlet"><h3><Database size={21}/>数据出口</h3><p>查看封存版本的资源目录、能力范围和原文；供各产品按需引用。</p><button className="lf-action" onClick={()=>void go(path('outlet'))}>查看数据出口<ArrowRight size={16}/></button></section>
     </aside>
    </div>:<Suspense fallback={<p role="status">打开世界功能…</p>}>
     {isWorldbuilding&&<div className="we-content-heading"><h3>{definition.label}</h3><p>{definition.description}</p></div>}
     {['sharing','community'].includes(definition.id)?<>{definition.id==='community'&&<section className="lf-paper"><h3>世界分享与发行准备</h3><p>先封存世界版本，再配置署名、许可和用途，通过文件交给其他作者。在线社区发布和社区数据尚未接入。</p><button className="lf-action" onClick={()=>void go(path('versions'))}>管理封存版本</button></section>}<Sharing key={projectId??'empty'} project={row?.project} worldReleaseRevision={revision} onImported={async id=>{await refresh();await go(path('basics',id))}}/></>:definition.id==='settings'&&!row?<Settings/>:!row?<section className="lf-paper"><h3>{module?modules.find(([id])=>id===module)?.[1]:definition.label}</h3>{!isWorldbuilding&&<p>{definition.description}</p>}<p>{projectId?'指定世界不存在或不属于可编辑的世界目录。':'尚未选择世界，仍可浏览所有页面。'}</p><button className="lf-action lf-action-primary" onClick={()=>setChoosing(true)}>选择或创建世界</button></section>:<>
      {definition.id==='basics'&&<WorldDraftSummary project={row.project}/>}
      {definition.id==='versions'?<Versions key={`${projectId}:${row.work.id}`} projectId={projectId!} activeWorkId={row.work.id} onChanged={refresh} onOpenProductProduction={handoff}/>:definition.id==='outlet'?<Outlet key={`${projectId}:${revision}`} projectId={projectId!} worldId={row.world.id!} onEdit={()=>void go(path('basics'))} onVersions={()=>void go(path('versions'))}/>:module?<>
       {definition.id==='story'&&module==='info'&&<section className="lf-paper"><p>此处管理世界内的叙事内容。世界名称与简介在“我的世界”修改。</p><WorldWorkManager projectId={projectId!} activeWorkId={row.work.id} onChanged={refresh}/></section>}
       {definition.id==='multiverse'&&!row.project.enableMultiWorld?<section className="lf-paper"><h3>启用多世界管理</h3><p>将现有设定归入主世界，再添加其他世界、位面与通道。</p><button className="lf-action lf-action-primary" disabled={busy} onClick={()=>void enableMultiWorld()}>启用多世界</button></section>:<div className={`we-editor ${definition.id==='map'?'we-map-editor':''}`}><Workspace key={`${projectId}:${row.work.id}`} embeddedProjectId={projectId!} embeddedModule={module}/></div>}
      </>:null}
     </>}
    </Suspense>}
   </div>
  </div></section>
 </div>
}
