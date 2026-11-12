import { useAdaptationActiveProject, useAdaptationSourceChapters } from '../hooks/useAdaptationPageSource'
import BrandIcon from '../components/shared/BrandIcon'
import ExampleLibrary from '../components/examples/ExampleLibrary'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import { BookOpen } from 'lucide-react'
import { db } from '../lib/db/schema'
import type { Work, WorkspaceScope, ScreenplayTargetSpecV1 } from '../lib/types'
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
import '../components/screenplay/screenplay-pages.css'
const Studio=lazy(()=>import('../components/screenplay/ScreenplayStudio'))
const Settings=lazy(()=>import('../components/settings/SettingsPage'))
const Data=lazy(()=>import('../components/data/DataManagementPanel'))
const pages=[['library','我的剧本'],['source','原作与来源'],['brief','改编目标'],['structure','结构与节拍'],['scenes','场次目录'],['editor','剧本编辑'],['grounding','原作一致性'],['review','戏剧性审校'],['versions','版本与导出'],['settings','通用设置']] as const
const descriptions:Record<string,string>={source:'选择原文范围，查看证据，确认事实与因果关系。',brief:'确定类型、时长、观众与改编取舍。',structure:'安排幕、集与节拍，让每次转折都有原因。',scenes:'确认场次卡，再进入逐场写作。',editor:'编排动作、角色、对白与转场，逐场保存和审定。',grounding:'对照原作，检查事实、来源与连续性。',review:'检查冲突、行动、对白与节奏，修订后重新审查。',versions:'完成作者审定，固定版本，导出 Fountain、FDX 或打印。'}
export function defaultScreenplayTargetSpec():ScreenplayTargetSpecV1{return {format:'film',language:'zh-CN',episodeCount:null,targetMinutesPerEpisode:100,rating:'PG-13',dialogueDensity:'balanced',productionScale:'standard',preserveVoiceOver:false,titlePage:{creditLine:'小说改编',authorDisplayName:'作者',contactText:'',copyrightNotice:'',draftLabel:'第一稿'},exportDefaults:['fountain','fdx','pdf']}}
export default function ScreenplayPage(){
 const main=useRef<HTMLElement>(null)
 const {pageId='library'}=useParams();const current=pages.some(([id])=>id===pageId)?pageId:'library'
 useEffect(()=>{main.current?.scrollTo(0,0);window.scrollTo(0,0)},[current])
 const [params]=useSearchParams();const workId=Number(params.get('work'))||null;const navigate=useNavigate();const dialog=useDialog()
 const [works,setWorks]=useState<Work[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false),[creating,setCreating]=useState(params.has('create')),[menu,setMenu]=useState(false),[search,setSearch]=useState(''),[filter,setFilter]=useState('all')
 const [title,setTitle]=useState(''),[sourceId,setSourceId]=useState(''),[sourceMode,setSourceMode]=useState('local'),[text,setText]=useState(''),[sourceReady,setSourceReady]=useState<WorkspaceScope|null>(null),[range,setRange]=useState('all'),[spec,setSpec]=useState(defaultScreenplayTargetSpec)
 const work=works.find(w=>w.id===workId&&effectiveWorkKind(w)==='screenplay');const library=works.filter(w=>effectiveWorkKind(w)==='screenplay');const sources=works.filter(w=>effectiveWorkKind(w)==='novel')
 // Keep the scope object stable while live Work metadata changes.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 const scope=useMemo(()=>work?{projectId:work.projectId,workId:work.id!,worldId:work.worldId}:null,[work?.id,work?.projectId,work?.worldId])
 const project=useAdaptationActiveProject(work,setError)
 useAutoBackup(work?.projectId??null);useGistAutoBackup(work?.projectId??null)
 useEffect(()=>{const sub=liveQuery(()=>db.works.toArray()).subscribe({next:rows=>{setWorks(rows);setLoading(false)},error:c=>{setError(String(c));setLoading(false)}});return()=>sub.unsubscribe()},[])
 const {chapters,selection,setSelection}=useAdaptationSourceChapters(sourceId,sources,setError)
 const path=(id:string,selected:number|null=workId)=>`/script/${id}${selected?`?work=${selected}`:''}`
 const go=async(url:string)=>{try{await flushPendingEditsV1();setMenu(false);navigate(url)}catch(c){setError(String(c))}}
 const choose=async(w:Work,id=current==='library'?'source':current)=>{try{await flushPendingEditsV1();await switchActiveWork(w.projectId,w.id!);setCreating(false);await go(path(id,w.id!))}catch(c){setError(String(c))}}
 const create=async()=>{if(busy)return;setBusy(true);setError('');try{
 if(!title.trim())throw new Error('请填写剧本名称')
 const source=sourceMode==='local'?sources.find(w=>String(w.id)===sourceId):undefined
 let sourceScope=source?{projectId:source.projectId,worldId:source.worldId,workId:source.id!}:sourceReady
 if(sourceMode==='import'&&!sourceScope){if(!text.trim())throw new Error('请粘贴或上传原作内容');const result=await createWorkspace({name:`${title.trim()} · 原作`,description:'作者导入的剧本改编来源',genres:[],status:'drafting',targetWordCount:Math.max(5000,text.length)},{purpose:'independent-work',kind:'novel',novelProfile:'long',importedNovelText:text});sourceScope=result.scope;setSourceReady(sourceScope)}
 if(!sourceScope)throw new Error('请选择一部小说作为来源')
 if(sourceMode==='local'&&range==='selected'&&!selection.length)throw new Error('至少选择一章')
 const result=await createAdaptation({sourceScope,sourceWorkId:sourceScope.workId,title:title.trim(),sourceSelection:sourceMode==='local'&&range==='selected'?{mode:'chapters',chapterIds:selection}:{mode:'entire-work'},medium:'screenplay',targetSpec:{...spec,episodeCount:spec.format==='film'?null:spec.episodeCount??1}})
 setCreating(false);setTitle('');setSourceReady(null);await go(path('source',result.targetWork.id!))
 }catch(c){setError(String(c))}finally{setBusy(false)}}
 const rename=async(w:Work)=>{const title=await dialog.prompt({title:'剧本名称',defaultValue:w.title});if(!title?.trim())return;try{await switchActiveWork(w.projectId,w.id!);await updateActiveWork(w.projectId,{title:title.trim()})}catch(c){setError(String(c))}}
 const remove=async(w:Work)=>{if(!await dialog.confirm({title:'删除这部剧本？',message:'只删除这部剧本及其改编数据、版本，不删除源小说。建议先下载备份。',confirmText:'删除剧本'}))return;try{await flushPendingEditsV1();await deleteWork(w.id!);if(workId===w.id)await go('/script/library')}catch(c){setError(String(c))}}
 return <div className={`longform-app screenplay-app ${menu?'lf-navigation-open':''}`}>
 <header className="lf-top"><button className="lf-brand" aria-label="返回首页" onClick={()=>void go('/')}><BrandIcon/><span><strong>StoryForge</strong><small>故事熔炉</small></span></button><nav aria-label="产品导航">{PRODUCT_NAVIGATION.map(item=><Link key={item.id} to={item.path} aria-current={item.id==='script'?'page':undefined} onClick={e=>{e.preventDefault();void go(item.path)}}>{item.label}</Link>)}</nav></header>
 <aside className="lf-sidebar"><small>SCREENPLAY ADAPTATION</small><h1>小说转剧本</h1><p>让文字成为可以被看见的行动。</p><button className="lf-current" onClick={()=>setCreating(!creating)}><BookOpen/><span>{work?.title??'选择或创建剧本'}</span></button><nav aria-label="剧本页面导航">{pages.map(([id,label])=><button key={id} aria-current={id===current?'page':undefined} onClick={()=>void go(path(id))}>{label}</button>)}</nav></aside>
 <section ref={main} className="lf-main"><header className="lf-heading"><small>小说转剧本 › {pages.find(([id])=>id===current)?.[1]}</small><h2>{pages.find(([id])=>id===current)?.[1]}</h2><div className="lf-mobile-controls"><button onClick={()=>setMenu(!menu)}>剧本导航</button></div></header><div className="lf-body"><div className="lf-content">
 {error&&<p role="alert" className="sp-error">{error}</p>}
 {creating&&<section className="lf-paper sp-create"><h3>选择或创建剧本改编</h3>{library.length>0&&<div className="sp-choose">{library.map(w=><button key={w.id} onClick={()=>void choose(w)}>{w.title}</button>)}</div>}<form onSubmit={e=>{e.preventDefault();void create()}}><fieldset disabled={busy}><div className="sp-fields"><label className="sp-wide">剧本名称<input aria-label="剧本名称" value={title} onChange={e=>setTitle(e.target.value)}/></label><label>来源方式<select aria-label="来源方式" value={sourceMode} onChange={e=>{setSourceMode(e.target.value);setSourceReady(null)}}><option value="local">选择本地小说</option><option value="import">粘贴或上传原作</option></select></label><label>剧本类型<select aria-label="剧本类型" value={spec.format} onChange={e=>setSpec({...spec,format:e.target.value as ScreenplayTargetSpecV1['format'],episodeCount:e.target.value==='film'?null:1})}><option value="film">电影</option><option value="series">剧集</option><option value="short-drama">短剧</option></select></label><label>单集目标分钟<input aria-label="单集目标分钟" type="number" min="1" max="300" value={spec.targetMinutesPerEpisode} onChange={e=>setSpec({...spec,targetMinutesPerEpisode:Number(e.target.value)})}/></label>{spec.format!=='film'&&<label>集数<input aria-label="集数" type="number" min="1" value={spec.episodeCount??1} onChange={e=>setSpec({...spec,episodeCount:Number(e.target.value)})}/></label>}
 {sourceMode==='local'?<><label className="sp-wide">小说来源<select aria-label="小说来源" value={sourceId} onChange={e=>setSourceId(e.target.value)}><option value="">请选择小说</option>{sources.map(w=><option key={w.id} value={w.id}>{w.title}</option>)}</select></label><label>改编范围<select aria-label="改编范围" value={range} onChange={e=>setRange(e.target.value)}><option value="all">整部小说</option><option value="selected">选择章节</option></select></label>{range==='selected'&&<div className="sp-wide sp-chapter-picks">{chapters.map(c=><label key={c.id}><input type="checkbox" checked={selection.includes(c.id)} onChange={e=>setSelection(e.target.checked?[...selection,c.id]:selection.filter(id=>id!==c.id))}/>{c.title} · {c.wordCount} 字</label>)}</div>}</>:<label className="sp-wide">原作内容<textarea aria-label="导入原作内容" rows={8} value={text} onChange={e=>{setText(e.target.value);setSourceReady(null)}}/><input aria-label="上传原作文档" type="file" accept=".txt,.md,.docx,.pdf" onChange={e=>{const file=e.target.files?.[0];if(file){setBusy(true);void import('../lib/doc-parser').then(m=>m.extractTextFromFile(file)).then(result=>{setText(result.text);setSourceReady(null)}).catch(c=>setError(String(c))).finally(()=>setBusy(false))}}}/><small>导入文本将保存为独立的源小说，再创建剧本。后续编辑剧本不修改原作。</small></label>}
 </div><button className="lf-action" type="submit">{busy?'正在创建…':'冻结来源并创建剧本'}</button><button type="button" onClick={()=>setCreating(false)}>取消</button></fieldset></form></section>}
 {current==='library'?<section className="sp-library"><div className="sp-library-tools"><button className="lf-action" onClick={()=>setCreating(true)}>新建剧本改编</button><input aria-label="搜索剧本" placeholder="搜索作品" value={search} onChange={e=>setSearch(e.target.value)}/><select aria-label="筛选剧本" value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">全部作品</option><option value="draft">制作中</option><option value="complete">已完稿</option></select></div>{loading?<p>读取作品库…</p>:<div className="sp-books">{library.filter(w=>w.title.includes(search)&&(filter==='all'||(filter==='complete'?w.status==='completed':w.status!=='completed'))).map(w=><article key={w.id} className="lf-paper"><div className="sp-cover"><BookOpen/><h3>{w.title}</h3><small>{w.status==='completed'?'已完稿':'改编中'}</small></div><p>{w.description||'从原作走向场次与对白。'}</p><button className="lf-action" onClick={()=>void choose(w,'editor')}>打开剧本</button><div className="sp-book-actions"><button onClick={()=>void rename(w)}>重命名</button><button onClick={()=>void exportProjectJSON(w.projectId).then(data=>downloadJSON(data,`${w.title}-完整备份.json`)).catch(c=>setError(String(c)))}>备份</button><button onClick={()=>void remove(w)}>删除</button></div></article>)}</div>}{!loading&&!library.length&&<section className="lf-paper"><h3>还没有剧本改编</h3><p>可以先浏览左侧页面，准备好后再选择小说或上传原作。</p></section>}</section>:current==='settings'?<Suspense fallback={<p>读取设置…</p>}><Settings project={project??undefined} onOpenDataManagement={()=>void go(path('versions'))}/></Suspense>:scope?<Suspense fallback={<p>读取剧本…</p>}><Studio key={scope.workId} scope={scope} page={current}/>{current==='versions'&&project&&<details className="lf-paper"><summary>数据备份与恢复</summary><Data project={project}/></details>}</Suspense>:<section className="lf-paper sp-empty"><h3>{pages.find(([id])=>id===current)?.[1]}</h3><p>{descriptions[current]}</p><p>尚未选择剧本，可以浏览全部页面。开始编辑或生成时，需要一部带有原作来源的剧本。</p><button className="lf-action" onClick={()=>setCreating(true)}>选择或创建剧本</button></section>}
 {current==='library'&&<ExampleLibrary kind="script"/>}
 </div></div></section></div>
}
