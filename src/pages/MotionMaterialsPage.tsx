import { useAdaptationActiveProject, useAdaptationSourceChapters } from '../hooks/useAdaptationPageSource'
import { useCompactCategoryScroll } from '../hooks/useCompactCategoryScroll'
import BrandIcon from '../components/shared/BrandIcon'
import ExampleLibrary from '../components/examples/ExampleLibrary'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import { BookOpen } from 'lucide-react'
import { db } from '../lib/db/schema'
import type { Work, WorkspaceScope, MotionDramaTargetSpecV1 } from '../lib/types'
import { effectiveWorkKind } from '../lib/workspace/work-kind'
import { createWorkspace } from '../lib/workspace/create-workspace'
import { switchActiveWork, updateActiveWork } from '../lib/workspace/works'
import { deleteWork } from '../lib/workspace/lifecycle'
import { createAdaptation } from '../lib/adaptation/source-manifest'
import { flushPendingEditsV1 } from '../lib/authoring/pending-edit-coordinator'
import { PRODUCT_NAVIGATION } from '../components/navigation/product-navigation'
import { useDialog } from '../components/shared/Dialog'
import { useAutoBackup } from '../hooks/useAutoBackup'
import { useGistAutoBackup } from '../hooks/useGistAutoBackup'
import { downloadJSON, exportProjectJSON } from '../lib/export/json-export'
import '../components/longform/longform.css'
import '../components/motion-drama/motion-materials.css'
import { MOTION_PAGES, MOTION_GROUPS, MOTION_CONTENT_GROUPS, motionDescription } from '../components/motion-drama/navigation'
import { countWords } from '../lib/utils/html'
const Studio=lazy(()=>import('../components/motion-drama/MotionDramaStudio'))
const Settings=lazy(()=>import('../components/settings/SettingsPage'))
const Data=lazy(()=>import('../components/data/DataManagementPanel'))
const pages=MOTION_PAGES
const descriptions=motionDescription
export function defaultMotionTargetSpec(): MotionDramaTargetSpecV1 { return {format:'motion-drama',language:'zh-CN',episodeCount:12,targetSecondsPerEpisode:60,aspectRatio:'9:16',narrativeMode:'animated-comic',audience:'类型故事观众',rating:'PG-13',dialogueDensity:'balanced',artDirection:'稳定人物、清晰线条与克制的电影化光影',providerTargets:['seedance']} }
export default function MotionMaterialsPage(){
 const main=useRef<HTMLElement>(null)
 const {pageId='library'}=useParams();const current=pages.some(([id])=>id===pageId)?pageId:'library'
 useEffect(()=>{main.current?.scrollTo(0,0);window.scrollTo(0,0);const nav=main.current?.querySelector<HTMLElement>('.mm-subnav');const active=nav?.querySelector<HTMLElement>('button[aria-current="page"]');if(nav&&active)nav.scrollTop+=active.getBoundingClientRect().top-nav.getBoundingClientRect().top-nav.clientHeight/2},[current])
 useCompactCategoryScroll(main, '.mm-subnav', current)
 const [params]=useSearchParams();const workId=Number(params.get('work'))||null;const navigate=useNavigate();const dialog=useDialog()
 const [works,setWorks]=useState<Work[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[creating,setCreating]=useState(params.has('create')),[menu,setMenu]=useState(false),[search,setSearch]=useState(''),[filter,setFilter]=useState('all')
 const [premise,setPremise]=useState('')
 const [title,setTitle]=useState(''),[sourceId,setSourceId]=useState(''),[sourceMode,setSourceMode]=useState('local'),[text,setText]=useState(''),[sourceReady,setSourceReady]=useState<WorkspaceScope|null>(null),[range,setRange]=useState('all'),[spec,setSpec]=useState(defaultMotionTargetSpec)
 const work=works.find(w=>w.id===workId&&effectiveWorkKind(w)==='motion-drama');const library=works.filter(w=>effectiveWorkKind(w)==='motion-drama');const sources=works.filter(w=>effectiveWorkKind(w)==='novel')
 // Keep the scope object stable while live Work metadata changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const scope=useMemo(()=>work?{projectId:work.projectId,workId:work.id!,worldId:work.worldId}:null,[work?.id,work?.projectId,work?.worldId])
 const [releasedWorks,setReleasedWorks]=useState<number[]>([])
 const project=useAdaptationActiveProject(work,setError)
 useAutoBackup(work?.projectId??null);useGistAutoBackup(work?.projectId??null)
 useEffect(()=>{const sub=liveQuery(async()=>({works:await db.works.toArray(),releases:await db.creationReleases.filter(row=>row.productKind==='motion-drama').toArray()})).subscribe({next:value=>{setWorks(value.works);setReleasedWorks(value.releases.map(r=>r.workId));setLoading(false)},error:c=>{setError(String(c));setLoading(false)}});return()=>sub.unsubscribe()},[])
 const {chapters,selection,setSelection}=useAdaptationSourceChapters(sourceId,sources,setError)
 const path=(id:string,selected:number|null=workId)=>`/motion/${id}${selected?`?work=${selected}`:''}`
 const go=async(url:string)=>{try{await flushPendingEditsV1();setMenu(false);navigate(url)}catch(c){setError(String(c))}}
 const choose=async(w:Work,id=current==='library'?'source':current)=>{try{await flushPendingEditsV1();await switchActiveWork(w.projectId,w.id!);setCreating(false);await go(path(id,w.id!))}catch(c){setError(String(c))}}
 const create=async()=>{if(busy)return;setBusy(true);setError('');try{
 if(!title.trim())throw new Error('请填写漫剧素材名称')
 const source=sourceMode==='local'?sources.find(w=>String(w.id)===sourceId):undefined
 let sourceScope=source?{projectId:source.projectId,worldId:source.worldId,workId:source.id!}:sourceReady
 if(sourceMode!=='local'&&!sourceScope){
 const imported=sourceMode==='import'?text.trim():undefined
 if(sourceMode==='import'&&!imported)throw new Error('请填写来源正文')
 if(imported&&countWords(imported)>25000)throw new Error('超过 25,000 字的原著请先在长篇中导入，再选择本地小说')
 if(sourceMode==='premise'&&!premise.trim())throw new Error('请填写一句话故事')
 const result=await createWorkspace({name:`${title.trim()} · 原著`,description:premise.trim()||imported?.slice(0,240)||'',genres:[],status:'drafting',targetWordCount:imported?Math.max(5000,countWords(imported)):20000},{purpose:'independent-work',kind:'novel',novelProfile:'short',initialChapterSummary:premise.trim()||'作者导入的原著',initialChapterContent:imported})
 sourceScope=result.scope;setSourceReady(sourceScope)
 }
 if(!sourceScope)throw new Error('请选择一部小说作为来源')
 if(sourceMode==='local'&&range==='selected'&&!selection.length)throw new Error('至少选择一章')
 const result=await createAdaptation({sourceScope,sourceWorkId:sourceScope.workId,title:title.trim(),sourceSelection:sourceMode==='local'&&range==='selected'?{mode:'chapters',chapterIds:selection}:{mode:'entire-work'},medium:'motion-drama',targetSpec:spec})
 setCreating(false);setTitle('');setSourceReady(null);await go(path('source',result.targetWork.id!))
 }catch(c){setError(String(c))}finally{setBusy(false)}}
 const rename=async(w:Work)=>{const title=await dialog.prompt({title:'漫剧素材名称',defaultValue:w.title});if(!title?.trim())return;try{await switchActiveWork(w.projectId,w.id!);await updateActiveWork(w.projectId,{title:title.trim()})}catch(c){setError(String(c))}}
 const remove=async(w:Work)=>{if(!await dialog.confirm({title:'删除这部漫剧素材？',message:'只删除这部漫剧素材及其改编数据、版本，不删除源小说。建议先下载备份。',confirmText:'删除漫剧素材'}))return;try{await flushPendingEditsV1();await deleteWork(w.id!);if(workId===w.id)await go('/motion/library')}catch(c){setError(String(c))}}
 return <div className={`longform-app motion-materials-app ${menu?'lf-navigation-open':''}`}>
 <header className="lf-top"><button className="lf-brand" aria-label="返回首页" onClick={()=>void go('/')}><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></button><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(item=><Link key={item.id} to={item.path} aria-current={item.id==='motion'?'page':undefined} onClick={e=>{e.preventDefault();void go(item.path)}}>{item.label}</Link>)}</nav></header>
 <aside className="lf-sidebar"><small>MOTION MATERIALS</small><h1>漫剧素材</h1><p>从原著到可供 Seedance 使用的提示词。</p><button className="lf-current" onClick={()=>setCreating(!creating)}><BookOpen/><span>{work?.title??'选择或创建漫剧素材'}</span></button><nav aria-label="漫剧素材页面导航">{MOTION_GROUPS.map(group=><button key={group.id} aria-current={group.pages.includes(current)?'page':undefined} onClick={()=>void go(path(group.id))}>{group.label}</button>)}</nav></aside>
 <section ref={main} className="lf-main"><header className="lf-heading"><small>漫剧素材 › {pages.find(([id])=>id===current)?.[1]}</small><h2>{MOTION_GROUPS.find(g=>g.pages.includes(current))?.label}</h2><div className="lf-mobile-controls"><button onClick={()=>setMenu(!menu)}>漫剧素材导航</button></div></header><div className="lf-body"><div className="lf-content">{(MOTION_GROUPS.find(g=>g.pages.includes(current))?.pages.length??0)>1&&<nav className="mm-subnav" aria-label="漫剧素材内容分类">{MOTION_CONTENT_GROUPS.map(group=>{const items=group.pages.filter(id=>MOTION_GROUPS.find(g=>g.pages.includes(current))?.pages.includes(id));return items.length>0&&<section key={group.id}><small>{items.length>1?group.label:null}</small>{items.map(id=><button key={id} aria-current={id===current?'page':undefined} onClick={()=>void go(path(id))}>{pages.find(([key])=>key===id)?.[1]}</button>)}</section>})}</nav>}
 {error&&<p role="alert" className="mm-error">{error}</p>}
 {creating&&<section className="lf-paper mm-create"><h3>选择或创建素材项目</h3>{library.length>0&&<div className="mm-choose">{library.map(w=><button key={w.id} onClick={()=>void choose(w)}>{w.title}</button>)}</div>}<form onSubmit={e=>{e.preventDefault();void create()}}><fieldset disabled={busy}><div className="mm-fields"><label className="mm-wide">漫剧素材名称<input aria-label="漫剧素材名称" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>来源方式<select aria-label="来源方式" value={sourceMode} onChange={e=>{setSourceMode(e.target.value);setSourceReady(null)}}><option value="local">选择本地小说</option><option value="import">粘贴或上传原作</option><option value="premise">从一句话开始</option></select></label><label>计划集数<input aria-label="计划集数" type="number" min="1" max="200" value={spec.episodeCount} onChange={e=>setSpec({...spec,episodeCount:Number(e.target.value)})}/></label><label>单集目标秒数<input aria-label="单集目标秒数" type="number" min="1" max="600" value={spec.targetSecondsPerEpisode} onChange={e=>setSpec({...spec,targetSecondsPerEpisode:Number(e.target.value)})}/></label><label>画幅<select aria-label="画幅" value={spec.aspectRatio} onChange={e=>setSpec({...spec,aspectRatio:e.target.value as MotionDramaTargetSpecV1['aspectRatio']})}><option>9:16</option><option>16:9</option><option>1:1</option></select></label><label>叙事形态<select value={spec.narrativeMode} onChange={e=>setSpec({...spec,narrativeMode:e.target.value as MotionDramaTargetSpecV1['narrativeMode']})}><option value="animated-comic">动态漫画</option><option value="illustrated-motion">插画动效</option><option value="hybrid">混合表现</option></select></label><label className="mm-wide">美术方向<textarea aria-label="美术方向" value={spec.artDirection} onChange={e=>setSpec({...spec,artDirection:e.target.value})}/></label><label>目标观众<input value={spec.audience} onChange={e=>setSpec({...spec,audience:e.target.value})}/></label><label>语言<input value={spec.language} onChange={e=>setSpec({...spec,language:e.target.value as 'zh-CN'})}/></label><small>默认准备 Seedance 提示词；已有项目的其他工具适配仍可使用。</small>

 {sourceMode==='local'?<><label className="mm-wide">小说来源<select aria-label="小说来源" value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">请选择小说</option>{sources.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label><label>改编范围<select aria-label="改编范围" value={range} onChange={e=>setRange(e.target.value)}><option value="all">整部小说</option><option value="selected">选择章节</option></select></label>{range==='selected'&&<div className="mm-wide mm-chapter-picks">{chapters.map(c=><label key={c.id}><input type="checkbox" checked={selection.includes(c.id)} onChange={e=>setSelection(e.target.checked?[...selection,c.id]:selection.filter(id=>id!==c.id))}/>{c.title} · {c.wordCount} 字</label>)}</div>}</>:sourceMode==='premise'?<label className="mm-wide">一句话故事<textarea aria-label="一句话故事" value={premise} onChange={e=>{setPremise(e.target.value);setSourceReady(null)}}/><small>先完成原著正文，再冻结为素材制作依据。</small></label>:<label className="mm-wide">原作内容<textarea aria-label="导入原作内容" rows={8} value={text} onChange={e=>{setText(e.target.value);setSourceReady(null)}}/><input aria-label="上传原作文档" type="file" accept=".txt,.md,.docx,.pdf" onChange={e=>{const file=e.target.files?.[0];if(file){setBusy(true);void import('../lib/doc-parser').then(m=>m.extractTextFromFile(file)).then(result=>{setText(result.text);setSourceReady(null)}).catch(c=>setError(String(c))).finally(()=>setBusy(false))}}}/><small>导入文本将保存为独立的源小说，再创建漫剧素材。后续编辑漫剧素材不修改原作。</small></label>}
 </div><button className="lf-action" type="submit">{busy?'正在创建…':'创建漫剧素材'}</button><button type="button" onClick={()=>setCreating(false)}>取消</button></fieldset></form></section>}
 {current==='library'?<section className="mm-library"><div className="mm-library-tools"><button className="lf-action" onClick={()=>setCreating(true)}>新建素材项目</button><input aria-label="搜索漫剧素材" placeholder="搜索作品" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="筛选漫剧素材" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部作品</option><option value="draft">制作中</option><option value="complete">已有交付版本</option></select></div>{loading?<p>读取作品库…</p>:<div className="mm-books">{library.filter(w=>w.title.includes(search)&&(filter==='all'||(filter==='complete'?releasedWorks.includes(w.id!):!releasedWorks.includes(w.id!)))).map(w=><article key={w.id} className="lf-paper"><div className="mm-cover"><BookOpen/><h3>{w.title}</h3><small>{releasedWorks.includes(w.id!)?'已有交付版本':'改编中'}</small></div><p>{w.description||'准备物料、分镜与逐镜提示词。'}</p><button className="lf-action" onClick={()=>void choose(w,'source')}>打开漫剧素材</button><div className="mm-book-actions"><button onClick={()=>void rename(w)}>重命名</button><button onClick={()=>void exportProjectJSON(w.projectId).then(data=>downloadJSON(data,`${w.title}-完整备份.json`)).catch(c=>setError(String(c)))}>备份</button><button onClick={()=>void remove(w)}>删除</button></div></article>)}</div>}{!loading&&!library.length&&<section className="lf-paper"><h3>还没有素材项目</h3><p>可以先浏览左侧页面，准备好后再选择小说或上传原作。</p></section>}</section>:current==='settings'?<Suspense fallback={<p>读取设置…</p>}><Settings project={project??undefined} onOpenDataManagement={()=>void go(path('versions'))}/></Suspense>:scope?<Suspense fallback={<p>读取漫剧素材…</p>}>{project&&<Studio key={scope.workId} project={project} scope={scope} page={current}/>}{current==='versions'&&project&&<details className="lf-paper"><summary>数据备份与恢复</summary><Data project={project}/></details>}</Suspense>:<section className="lf-paper mm-empty"><h3>{pages.find(([id])=>id===current)?.[1]}</h3><p>{descriptions[current]}</p><p>尚未选择漫剧素材，可以浏览全部页面。开始编辑或生成时，需要一部带有原作来源的漫剧素材。</p><button className="lf-action" onClick={()=>setCreating(true)}>选择或创建漫剧素材</button></section>}
 {current==='library'&&<ExampleLibrary kind="motion"/>}
 </div></div></section></div>
}
