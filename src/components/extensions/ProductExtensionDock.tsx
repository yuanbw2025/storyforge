import { lazy, Suspense, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { liveQuery } from 'dexie'
import { db } from '../../lib/db/schema'
import { effectiveNovelProfile, effectiveWorkKind } from '../../lib/workspace/work-kind'
import './extensions.css'
const Surface = lazy(() => import('./ExtensionSurface'))
const kinds: Record<string,string> = {short:'novel',script:'screenplay',comic:'comic',motion:'motion-drama',town:'ai-town',ttrpg:'ttrpg',chat:'character-interaction',avg:'avg',adventure:'text-adventure',openworld:'text-open-world'}
export default function ProductExtensionDock({product}:{product:string}) {
  const [params]=useSearchParams(),[open,setOpen]=useState(false),[scope,setScope]=useState<{projectId:number;workId:number;title:string}>()
  const projectId=Number(params.get('project')),workId=Number(params.get('work'))
  useEffect(()=>{const sub=liveQuery(async()=>{const project=projectId>0?await db.projects.get(projectId):undefined;const work=await db.works.get(workId||project?.activeWorkId||-1);if(!work||!work.id||(projectId&&work.projectId!==projectId))return undefined;if(product==='world'){if(!project||project.workspacePurpose!=='world-engine'||work.worldId!==project.activeWorldId)return undefined}else if(!['adventure','openworld'].includes(product)&&effectiveWorkKind(work)!==kinds[product]||(product==='short'&&effectiveNovelProfile(work)!=='short'))return undefined;return{projectId:work.projectId,workId:work.id,title:work.title}}).subscribe({next:setScope,error:()=>setScope(undefined)});return()=>sub.unsubscribe()},[product,projectId,workId])
  if(!scope)return null
  const path=`/workshop/workbench?project=${scope.projectId}&work=${scope.workId}&owner=${product==='world'?'world':'work'}`
  // World editing already embeds scoped extension surfaces; one entry avoids duplicate activation.
  if(product==='world')return <Link className="sf-product-plugin-entry" to={path}>世界插件工作台</Link>
  return <><button className="sf-product-plugin-entry" aria-expanded={open} onClick={()=>setOpen(!open)}>作品插件工作台</button>{open&&<aside className="sf-product-plugin-dock" aria-label="当前作品插件"><header className="sf-extension-actions"><h3>{scope.title} · 插件</h3><button onClick={()=>setOpen(false)}>关闭插件工作台</button><Link to={path}>管理与历史</Link></header><Suspense fallback={<p>加载作品插件…</p>}><Surface projectId={scope.projectId} workId={scope.workId} owner="work"/></Suspense></aside>}</>
}
