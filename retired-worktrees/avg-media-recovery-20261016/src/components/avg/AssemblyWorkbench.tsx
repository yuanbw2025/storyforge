import { useCallback, useEffect, useRef, useState } from 'react'
import type { AvgPresentationCue, FrozenRuntimeMediaAssetV2, ProductMediaKind, WorkspaceScope } from '../../lib/types'
import { PRODUCT_MEDIA_KINDS } from '../../lib/types'
import { AVG_AUTHORING_PRESETS_V1, createAvgAuthoringPresetV1 } from '../../lib/avg/authoring-presets'
import { parseAvgAuthorWorkspaceV1, type AvgAuthorWorkspaceV1 } from '../../lib/avg/author-workspace-contract'
import { saveAvgAuthorWorkspaceV1, importAvgMediaForAssemblyV1, listAvgDraftMediaV1 } from '../../lib/avg/editor-service'
import { readAvgAssemblyWorkspaceV1, prepareAvgAssemblyBriefV1, startAvgAssemblyV1, stageAvgWorkspaceInputV1, confirmAvgWorkspaceInputV1, runAvgAssemblyV1, restartAvgAssemblyFromDraftV1, saveAvgVisualBatchDraftV1, clearAvgVisualBatchDraftV1 } from '../../lib/avg/assembly-service'
import { startProductProductionPreviewV1 } from '../../lib/product-production/service'
import { canonicalProductProductionJsonV2 } from '../../lib/product-production/hash'
import { exportProjectJSON, downloadJSON } from '../../lib/export/json-export'
import { useBeforeUnload } from '../../hooks/useBeforeUnload'
import PrototypeReleasePanel from './PrototypeReleasePanel'
import MediaPreview, { AVG_MEDIA_KIND_LABELS as MEDIA_NAMES } from './MediaAssetPreview'
import MediaProductionPanel from './MediaProductionPanel'
import VoiceProductionPanel from './VoiceProductionPanel'
import { avgMediaProductionEnabledV2, avgVoiceProductionEnabledV3 } from '../../lib/avg/assembly-contract'
import { readAvgOptionalImageDefinitionV3 } from '../../lib/avg/media-production-definition'
import { parseAvgStoredAssemblyBriefV3 } from '../../lib/avg/voice-assembly-storage'
import { avgVoiceChoiceArtifactKeyV1 } from '../../lib/avg/voice-assembly-contract'
import { avgMediaChoiceArtifactKeyV1, avgRawMediaArtifactKeyV1 } from '../../lib/avg/media-production-contract'
import { AVG_MODULE_CONTRACTS_V1, avgNativeModuleSwitchesV1 } from '../../lib/avg/module-capabilities'

type View = Awaited<ReturnType<typeof readAvgAssemblyWorkspaceV1>>
type Section = 'dialogue' | 'system' | 'stage' | 'media' | 'production'
const SECTIONS: Array<[Section,string]> = [['dialogue','对白与选择'],['system','系统规则'],['stage','演出与配音'],['media','素材'],['production','制作与试玩']]
const CUE_NAMES: Partial<Record<AvgPresentationCue['type'],string>> = { 'set-tone':'色调','set-background':'背景','show-actor':'立绘','show-cg':'CG','play-audio':'声音',wait:'等待' }
const sectionForPage = (page: string): Section => page === 'variables' ? 'system' : ['visual','audio'].includes(page) ? 'stage' : page === 'media-all' ? 'media' : page === 'narrative' ? 'dialogue' : 'production'

export default function AssemblyWorkbench({scope,productionId,page,onSource,onPreviewStarted,onRegisterFlush}: {
  scope:WorkspaceScope;productionId:number|null;page:string;onSource:()=>void;onPreviewStarted:(sessionId:number)=>void;
  onRegisterFlush?:(flush:(()=>Promise<void>)|null)=>void
}) {
  const [view,setView]=useState<View|null>(null),[model,setModel]=useState<AvgAuthorWorkspaceV1>(()=>createAvgAuthoringPresetV1())
  const [section,setSection]=useState<Section>(sectionForPage(page)),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[sceneKey,setSceneKey]=useState('')
  const [advanced,setAdvanced]=useState(''),[jsonPending,setJsonPending]=useState(false),[reviewed,setReviewed]=useState<Record<string,boolean>>({})
  const [declaration,setDeclaration]=useState('使用原创工程校准文本及我提供的合法媒资；已核对当前候选及素材来源授权。')
  const [selectedAsset,setSelectedAsset]=useState<FrozenRuntimeMediaAssetV2|null>(null)
  const [file,setFile]=useState<File|null>(null),[mediaKind,setMediaKind]=useState<ProductMediaKind>('background')
  const [mediaName,setMediaName]=useState(''),[license,setLicense]=useState(''),[alt,setAlt]=useState(''),[character,setCharacter]=useState('')
  const [autoConfigure,setAutoConfigure]=useState(true),[itemTarget,setItemTarget]=useState('')
  const [replaceAssetKey,setReplaceAssetKey]=useState('')
  const [imagePending,setImagePending]=useState(false),[voicePending,setVoicePending]=useState(false),[mediaRunning,setMediaRunning]=useState(false)
  const mediaPending=imagePending||voicePending
  const mediaAbort=useRef<AbortController|null>(null)
  const alive=useRef(false),busyRef=useRef(false),loadSequence=useRef(0)
  useBeforeUnload(dirty||jsonPending||mediaPending||mediaRunning)
  const reload=useCallback(async()=>{
    const sequence=++loadSequence.current
    const next=await readAvgAssemblyWorkspaceV1(scope,productionId)
    const workspace=next.draft.editorJson?parseAvgAuthorWorkspaceV1(next.draft.editorJson):createAvgAuthoringPresetV1()
    if(!alive.current||sequence!==loadSequence.current)return
    setView(next);setModel(workspace);setAdvanced(JSON.stringify(workspace,null,2));setJsonPending(false);setDirty(false)
    setSceneKey(current=>workspace.systemPlan.scenes.some(scene=>scene.key===current)?current:workspace.systemPlan.entrySceneKey)
  },[scope,productionId])
  useEffect(()=>{alive.current=true;void reload().catch(cause=>{if(alive.current)setError(String(cause))});return()=>{alive.current=false;mediaAbort.current?.abort()}},[reload])
  useEffect(()=>{
    if(!mediaRunning)return
    let active=true,reading=false
    const sequence=loadSequence.current
    const timer=window.setInterval(()=>{if(reading)return;reading=true;void readAvgAssemblyWorkspaceV1(scope,productionId).then(next=>{
      if(active&&alive.current&&sequence===loadSequence.current)setView(next)
    }).catch(cause=>{if(active&&alive.current)setError(String(cause))}).finally(()=>{reading=false})},4000)
    return()=>{active=false;window.clearInterval(timer)}
  },[mediaRunning,scope,productionId])
  useEffect(()=>setSection(sectionForPage(page)),[page])
  const run=async(task:()=>Promise<void>)=>{
    if(busyRef.current)return
    busyRef.current=true;setBusy(true);setError('');setNotice('')
    try{await task()}catch(cause){if(alive.current)setError(cause instanceof Error?cause.message:String(cause))}
    finally{busyRef.current=false;if(alive.current)setBusy(false)}
  }
  const edit=(change:(next:AvgAuthorWorkspaceV1)=>void)=>{
    const next=structuredClone(model);change(next);setModel(next);setAdvanced(JSON.stringify(next,null,2));setDirty(true)
  }
  const persist=useCallback(async()=>{
    if(jsonPending)throw new Error('请先应用或撤销高级配置，再保存或切换页面')
    if(!view)throw new Error('编辑草稿尚未读取')
    const parsed=parseAvgAuthorWorkspaceV1(model)
    const draft=await saveAvgAuthorWorkspaceV1(scope,view.draft.revision,parsed)
    if(alive.current){setView({...view,draft});setModel(parsed);setAdvanced(JSON.stringify(parsed,null,2));setDirty(false);setNotice('编辑草稿已保存；正式采用状态见制作步骤。')}
  },[jsonPending,view,model,scope])
  const flush=useCallback(async()=>{
    if(busyRef.current)throw new Error('当前操作正在完成，请稍后切换页面')
    if(mediaPending)throw new Error('请先保存或撤销媒资需求及审听观察，再切换页面')
    if(!dirty&&!jsonPending)return
    busyRef.current=true;setBusy(true)
    try{await persist()}catch(cause){if(alive.current)setError(String(cause));throw cause}
    finally{busyRef.current=false;if(alive.current)setBusy(false)}
  },[dirty,jsonPending,mediaPending,persist])
  useEffect(()=>{onRegisterFlush?.(flush);return()=>onRegisterFlush?.(null)},[onRegisterFlush,flush])

  const build=view?.details?.build,details=view?.details
  const frozen=!!build?.previewHash
  const canAdopt=!!build&&['authorized','building'].includes(build.status)
  const activeBuild=!!build&&!frozen&&details?.production.status!=='brief-ready'
  const canEditMediaDomain=!activeBuild
  const currentScene=model.systemPlan.scenes.find(scene=>scene.key===sceneKey)??model.systemPlan.scenes[0]
  const script=model.scripts.find(script=>script.sceneKey===currentScene?.key)
  const lines=model.scripts.flatMap(script=>script.lines)
  const assets=model.presentation.stage.assets
  const moduleSwitches=avgNativeModuleSwitchesV1({systemPlan:model.systemPlan,reading:model.presentation.reading})
  const accepted=(key:string)=>view?.artifacts.find(row=>row.artifactKey===key&&row.status==='accepted')
  const imageDefinition=details?.executionBrief?readAvgOptionalImageDefinitionV3(details.executionBrief):null
  const mediaBatch=imageDefinition?.mediaBatch??null
  const storedAssembly=details?.executionBrief?.avgAssembly
  const voiceBatch=storedAssembly?.version===3?parseAvgStoredAssemblyBriefV3(storedAssembly).assembly.voice.batch:null
  const choiceKeys=[...(mediaBatch?.requirements.map(r=>avgMediaChoiceArtifactKeyV1(r.requirementKey))??[]),
    ...(voiceBatch?.requirements.map(r=>avgVoiceChoiceArtifactKeyV1(r.requirementKey))??[])]
  const sourceLocked=!!(mediaBatch||voiceBatch)&&Object.keys((JSON.parse(build?.budgetLedgerJson??'{}') as {tasks?:object}).tasks??{}).length>0
  const humanKeys=details?.executionBrief?.avgAssembly?['avg.system.plan',...details.executionBrief.avgAssembly.sceneKeys.map(key=>`avg.content.scene-script.${key}`),'avg.author.stage']:[]
  const sourcesReady=humanKeys.length>0&&humanKeys.filter(key=>key!=='avg.author.stage').every(key=>!!accepted(key))
  const allAccepted=humanKeys.length>0&&[...humanKeys,...choiceKeys].every(key=>!!accepted(key))
  const imagesConfigured=!mediaBatch||mediaBatch.requirements.every(r=>{
    const choice=accepted(avgMediaChoiceArtifactKeyV1(r.requirementKey));if(!choice)return false
    if(r.consumer.domain==='reference')return !assets.some(a=>a.assetKey===r.assetKey)
    try{if(!assets.some(a=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(JSON.parse(choice.payloadJson).asset)))return false}catch{return false}
    if(r.consumer.domain!=='stage')return true
    const type=r.consumer.slot==='actor'?'show-actor':r.consumer.slot==='background'?'set-background':'show-cg'
    return model.presentation.stage.cues.some(cue=>cue.type===type&&cue.assetKey===r.assetKey&&cue.beatKey===r.triggerBeatKey&&(type!=='show-actor'||cue.actorKey===r.consumer.subjectKey))
  })
  const voicesConfigured=!voiceBatch||voiceBatch.requirements.every(r=>{
    const choice=accepted(avgVoiceChoiceArtifactKeyV1(r.requirementKey));if(!choice)return false
    try{
      const asset=JSON.parse(choice.payloadJson).asset
      if(!assets.some(a=>canonicalProductProductionJsonV2(a)===canonicalProductProductionJsonV2(asset)))return false
      return model.presentation.reading?.voices.some(v=>v.assetKey===r.assetKey&&v.lineKey===r.lineKey&&v.text===r.text&&v.textRevision===r.textRevision&&v.speakerKey===r.speakerKey&&v.locale===r.locale)??false
    }catch{return false}
  })
  const mediaConfigured=imagesConfigured&&voicesConfigured
  const selectedRequirement=mediaBatch?.requirements.find(r=>r.assetKey===selectedAsset?.assetKey)
  const selectedRaw=selectedRequirement?accepted(avgRawMediaArtifactKeyV1(selectedRequirement.requirementKey)):undefined
  const selectedInherited=model.presentation.inheritedImages?.find(entry=>entry.assetKey===selectedAsset?.assetKey)
  const updateCue=(index:number,patch:Partial<AvgPresentationCue>)=>edit(next=>Object.assign(next.presentation.stage.cues[index],patch))
  const addCue=(type:'set-background'|'show-actor'|'show-cg'|'play-audio'|'wait')=>{
    const beatKey=script?.lines[0]?.lineKey??lines[0]?.lineKey
    if(!beatKey){setError('请先添加场景对白，再配置演出位置');return}
    edit(next=>{
    const asset=next.presentation.stage.assets.find(asset=>type==='set-background'?asset.kind==='background':type==='show-actor'?asset.kind.startsWith('character-'):type==='show-cg'?asset.kind==='cg':['bgm','ambience','sfx'].includes(asset.kind))
    next.presentation.stage.cues.push({cueKey:`cue.${crypto.randomUUID()}`,beatKey,type,phase:'before',
      durationMs:type==='wait'?500:0,easing:'linear',order:next.presentation.stage.cues.length,...(type==='wait'?{}:{assetKey:asset?.assetKey??null}),
      ...(type==='show-actor'?{actorKey:next.systemPlan.characters[0]?.key??null,x:0.65,y:1,scale:1,layer:'actor-front' as const}:{}),
      ...(type==='play-audio'?{volume:0.8,loop:asset?.kind==='bgm'||asset?.kind==='ambience'}:{})})
    })
  }
  const readyForStage=!!view&&!dirty&&!jsonPending&&!busy&&!mediaPending
  const bindVoice=(lineKey:string,assetKey:string)=>{
    if(!script) return
    const source=accepted(`avg.content.scene-script.${script.sceneKey}`)
    if(!source||canonicalProductProductionJsonV2(script)!==canonicalProductProductionJsonV2(JSON.parse(source.payloadJson)))throw new Error('请先确认当前场景脚本，再绑定准确台词配音')
    const line=script.lines.find(line=>line.lineKey===lineKey)!
    edit(next=>{
      const reading=next.presentation.reading??{schema:'storyforge.avg.reading-plan' as const,version:1 as const,manualVoice:'wait' as const,voiceFailure:'pause' as const,maximumVoiceWaitMs:30_000,autoDelayMs:800,voices:[]}
      reading.voices=reading.voices.filter(voice=>voice.lineKey!==lineKey)
      if(assetKey)reading.voices.push({lineKey,assetKey,text:line.text,textRevision:source.version,speakerKey:line.speakerKey,locale:'zh-CN'})
      next.presentation.reading=reading
    })
  }
  const importFile=async()=>{
    if(!file||!view)throw new Error('请先选择文件')
    if(file.size<1||file.size>32*1024*1024)throw new Error('单个素材需为 1 字节～32 MiB')
    const aliases:Record<string,string>={'audio/x-wav':'audio/wav','audio/wave':'audio/wav','audio/x-m4a':'audio/mp4','audio/mp3':'audio/mpeg'}
    const extension=file.name.split('.').pop()?.toLowerCase()??''
    const byExtension:Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',wav:'audio/wav',mp3:'audio/mpeg',ogg:'audio/ogg',m4a:'audio/mp4'}
    const asset=await importAvgMediaForAssemblyV1({scope,data:await file.arrayBuffer(),mimeType:(aliases[file.type]??file.type)||byExtension[extension]||'',name:mediaName||file.name,
      kind:mediaKind,license,altText:alt||mediaName||file.name,characterTag:character})
    if(!alive.current)return
    edit(next=>{
      const replaced=next.presentation.stage.assets.find(row=>row.assetKey===replaceAssetKey&&row.kind===asset.kind)
      if(replaced){
        next.presentation.stage.assets=next.presentation.stage.assets.map(row=>row.assetKey===replaced.assetKey?asset:row)
        if(next.presentation.inheritedImages)next.presentation.inheritedImages=next.presentation.inheritedImages.filter(row=>row.assetKey!==replaced.assetKey)
        for(const cue of next.presentation.stage.cues)if(cue.assetKey===replaced.assetKey)cue.assetKey=asset.assetKey
        for(const voice of next.presentation.reading?.voices??[])if(voice.assetKey===replaced.assetKey)voice.assetKey=asset.assetKey
        if(next.systemPlan.version===2)for(const item of next.systemPlan.inventory.items)for(const variant of [item,...item.variants]){
          if(variant.iconAssetKey===replaced.assetKey)variant.iconAssetKey=asset.assetKey
          if(variant.detailAssetKey===replaced.assetKey)variant.detailAssetKey=asset.assetKey
        }
      }else next.presentation.stage.assets.push(asset)
      if(replaced){ /* Keep existing timing/line bindings; stale text still requires explicit rebinding. */ }
      else if(itemTarget&&next.systemPlan.version===2&&['ui','cg'].includes(asset.kind)){
        const item=next.systemPlan.inventory.items.find(item=>item.key===itemTarget)
        if(item)for(const variant of [item,...item.variants])variant[asset.kind==='ui'?'iconAssetKey':'detailAssetKey']=asset.assetKey
      }else if(autoConfigure&&(script?.lines[0]?.lineKey??lines[0]?.lineKey)&&['background','character-pose','character-expression','cg','bgm','ambience','sfx'].includes(asset.kind)){
        const type=asset.kind==='background'?'set-background':asset.kind.startsWith('character-')?'show-actor':asset.kind==='cg'?'show-cg':'play-audio'
        next.presentation.stage.cues.push({cueKey:`cue.${crypto.randomUUID()}`,beatKey:script?.lines[0]?.lineKey??lines[0].lineKey,type,phase:'before',durationMs:0,
          easing:'linear',order:next.presentation.stage.cues.length,assetKey:asset.assetKey,
          ...(type==='show-actor'?{actorKey:character,x:0.65,y:1,scale:1,layer:'actor-front' as const}:{}),
          ...(type==='play-audio'?{volume:0.8,loop:asset.kind==='bgm'||asset.kind==='ambience'}:{})})
      }
    });setSelectedAsset(asset);setReplaceAssetKey('')
    const media=await listAvgDraftMediaV1(scope)
    if(alive.current){setView(current=>current?{...current,media}:current);setNotice('实际文件已解码并保留在导入历史。请保存草稿，再确认演出采用。')}
  }

  return <section className="avg-assembly" aria-label="系统与效果组装（实验）">
    <section className="lf-paper"><h3>系统与效果组装 <small>实验</small></h3>
      <p>编辑规则、对白、演出和合法媒资，逐项确认后生成试玩预览。内置文本用于工程校准，专业故事与艺术质量另行验收。</p>
      {error&&<p role="alert" className="avg-assembly-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
      {!view?<p>{error?'当前工作区无法打开，请按错误提示处理或返回作品库。':'读取作者工作区…'}</p>:<><div className="avg-actions">
        <button className="lf-action lf-action-primary" disabled={busy||jsonPending||mediaPending} onClick={()=>void run(persist)}>保存编辑草稿</button>
        <button className="lf-action" disabled={busy||dirty||jsonPending||mediaPending} onClick={()=>void run(reload)}>读取已保存版本</button>
        <button className="lf-action" disabled={busy||mediaPending} onClick={onSource}>{view.draft.worldReleaseId?'查看冻结世界来源':'选择冻结世界来源'}</button>
        <span>{dirty||jsonPending?'有未保存修改':view.draft.editorJson?'草稿已保存':'校准配置尚未保存'}{build?` · Build #${build.buildNumber}`:''}</span>
      </div>
      <label>工程配置<select disabled={busy||activeBuild||jsonPending||mediaPending} value={model.systemPlan.key==='avg.author.envelope'?'evidence':model.systemPlan.key==='avg.author.lights'?'linear':'custom'} onChange={event=>{
        const next=createAvgAuthoringPresetV1(event.target.value as 'evidence'|'linear');next.basePreviewHash=build?.previewHash||model.basePreviewHash
        setModel(next);setAdvanced(JSON.stringify(next,null,2));setDirty(true);setSceneKey(next.systemPlan.entrySceneKey)
      }}><option value="custom" disabled>自定义配置</option>{AVG_AUTHORING_PRESETS_V1.map(preset=><option key={preset.key} value={preset.key}>{preset.label}</option>)}</select></label>
      <nav className="avg-actions" aria-label="组装编辑分区">{SECTIONS.map(([key,label])=><button className="lf-action" key={key} aria-current={section===key?'page':undefined} disabled={mediaPending||mediaRunning} onClick={()=>setSection(key)}>{label}</button>)}</nav></>}
    </section>
    {view&&<section className="lf-paper" aria-label="模块能力"><details><summary>当前草稿的模块能力</summary>
      <p>状态根据规则与演出配置读取，保存和采用时仍须完整校验。规划中的模块保持关闭；当前作品的正式能力以冻结版本为准。</p>
      <ul>{moduleSwitches.map(module=><li key={module.name}><label><input type="checkbox" checked={module.enabled} disabled/>{AVG_MODULE_CONTRACTS_V1[module.name].label} · {module.reason==='not-implemented'?'规划中，未实现':module.enabled?'已配置':'未配置'}</label></li>)}</ul>
      <p>物品与证据由系统规则配置；阅读与配音由演出配置，关闭配置后不会在新版本声明相应能力。旧版本与旧存档保持原配置。</p>
    </details></section>}
    {view&&<>
      {section==='dialogue'&&<section className="lf-paper"><h4>规范对白与选项</h4><fieldset disabled={busy||jsonPending}>
        <label>场景<select value={currentScene?.key??''} onChange={event=>setSceneKey(event.target.value)}>{model.systemPlan.scenes.map(scene=><option key={scene.key} value={scene.key}>{scene.title}</option>)}</select></label>
        {script?.lines.map((line,index)=><div className="avg-assembly-row" key={line.lineKey}>
          <label>第 {index+1} 句<textarea aria-label={`${currentScene.title}第${index+1}句`} value={line.text} onChange={event=>edit(next=>{next.scripts.find(row=>row.sceneKey===script.sceneKey)!.lines[index].text=event.target.value})}/></label>
          <label>说话人<select value={line.speakerKey??''} onChange={event=>edit(next=>{next.scripts.find(row=>row.sceneKey===script.sceneKey)!.lines[index].speakerKey=event.target.value||null})}><option value="">旁白</option>{model.systemPlan.characters.map(character=><option key={character.key} value={character.key}>{character.displayName}</option>)}</select></label>
          <button className="lf-action" disabled={script.lines.length<2} onClick={()=>edit(next=>{next.scripts.find(row=>row.sceneKey===script.sceneKey)!.lines.splice(index,1)})}>删除此句</button>
        </div>)}
        <button className="lf-action" disabled={!script} onClick={()=>edit(next=>{const key=`line.${crypto.randomUUID()}`;next.scripts.find(row=>row.sceneKey===script!.sceneKey)!.lines.push({lineKey:key,beatKey:key,speakerKey:null,text:'新对白',informationKeys:[],actionKeys:[]})})}>增加一句</button>
        {script?.choices.map((choice,index)=><label key={choice.choiceKey}>选项 {index+1}<input value={choice.text} onChange={event=>edit(next=>{next.scripts.find(row=>row.sceneKey===script.sceneKey)!.choices[index].text=event.target.value})}/></label>)}
      </fieldset></section>}
      {section==='system'&&<section className="lf-paper"><h4>规则与状态</h4><fieldset disabled={busy||jsonPending}>
        <p>变量、知识、关系和物件由同一规则骨架执行。分支条件及效果可在高级配置中编辑，采用前会进行类型、范围与图检查。</p>
        {model.systemPlan.variables.map((variable,index)=><div className="avg-assembly-row" key={variable.key}><strong>{variable.key}</strong>
          <label>初值{variable.kind==='boolean'?<input type="checkbox" checked={variable.initial} onChange={event=>edit(next=>{const row=next.systemPlan.variables[index];if(row.kind==='boolean')row.initial=event.target.checked})}/>:
            variable.kind==='enum'?<select value={variable.initial} onChange={event=>edit(next=>{const row=next.systemPlan.variables[index];if(row.kind==='enum')row.initial=event.target.value})}>{variable.values.map(value=><option key={value}>{value}</option>)}</select>:
            <input type={variable.kind==='number'?'number':'text'} value={variable.initial} onChange={event=>edit(next=>{const row=next.systemPlan.variables[index];if(row.kind==='number')row.initial=Number(event.target.value);else if(row.kind==='string')row.initial=event.target.value})}/>}</label>
          {variable.kind==='number'&&<><label>下限<input type="number" value={variable.minimum} onChange={event=>edit(next=>{const row=next.systemPlan.variables[index];if(row.kind==='number')row.minimum=Number(event.target.value)})}/></label><label>上限<input type="number" value={variable.maximum} onChange={event=>edit(next=>{const row=next.systemPlan.variables[index];if(row.kind==='number')row.maximum=Number(event.target.value)})}/></label></>}
        </div>)}
        {model.systemPlan.scenes.map((scene,index)=><label key={scene.key}>场景标题<input value={scene.title} onChange={event=>edit(next=>{next.systemPlan.scenes[index].title=event.target.value})}/></label>)}
        <p>知识 {model.systemPlan.knowledge.length} 项 · 关系 {model.systemPlan.relationships.length} 项 · {model.systemPlan.version===2?`物件 ${model.systemPlan.inventory.items.length} 类`:'物件模块关闭'}</p>
        <p>热点、话题、消息与跨周目鉴赏按后续模块合同接入，当前编辑器未开放这些能力。</p>
      </fieldset></section>}
      {section==='stage'&&<section className="lf-paper"><h4>舞台演出</h4><fieldset disabled={busy||jsonPending}>
        <label>画面比例<select value={model.presentation.aspectRatio} onChange={event=>edit(next=>{next.presentation.aspectRatio=event.target.value as '16:9'|'4:3'})}><option>16:9</option><option>4:3</option></select></label>
        <div className="avg-actions"><button className="lf-action" disabled={!assets.some(asset=>asset.kind==='background')} onClick={()=>addCue('set-background')}>添加背景</button>
          <button className="lf-action" disabled={!assets.some(asset=>asset.kind.startsWith('character-'))||!model.systemPlan.characters.length} onClick={()=>addCue('show-actor')}>添加立绘</button>
          <button className="lf-action" disabled={!assets.some(asset=>asset.kind==='cg')} onClick={()=>addCue('show-cg')}>添加 CG</button>
          <button className="lf-action" disabled={!assets.some(asset=>['bgm','ambience','sfx'].includes(asset.kind))} onClick={()=>addCue('play-audio')}>添加声音</button><button className="lf-action" onClick={()=>addCue('wait')}>添加等待</button></div>
        {model.presentation.stage.cues.map((cue,index)=><div className="avg-assembly-row" key={cue.cueKey}><strong>{CUE_NAMES[cue.type]??cue.type}</strong>
          <label>对白位置<select value={cue.beatKey} onChange={event=>updateCue(index,{beatKey:event.target.value})}>{lines.map(line=><option key={line.lineKey} value={line.lineKey}>{line.text.slice(0,40)}</option>)}</select></label>
          <label>时机<select value={cue.phase} onChange={event=>updateCue(index,{phase:event.target.value as AvgPresentationCue['phase']})}><option value="before">句前</option><option value="during">句中</option><option value="after">句后</option></select></label>
          {cue.assetKey!==undefined&&<label>素材<select value={cue.assetKey??''} onChange={event=>updateCue(index,{assetKey:event.target.value||null})}><option value="">选择素材</option>{assets.filter(asset=>cue.type==='set-background'?asset.kind==='background':cue.type==='show-actor'?asset.kind.startsWith('character-'):cue.type==='show-cg'?asset.kind==='cg':cue.type==='play-audio'?['bgm','ambience','sfx'].includes(asset.kind):true).map(asset=><option key={asset.assetKey} value={asset.assetKey}>{asset.name}</option>)}</select></label>}
          {cue.type==='set-tone'&&<label>色调<input value={cue.tone??''} onChange={event=>updateCue(index,{tone:event.target.value})}/></label>}
          {cue.type==='show-actor'&&<><label>角色<select value={cue.actorKey??''} onChange={event=>updateCue(index,{actorKey:event.target.value})}>{model.systemPlan.characters.map(character=><option key={character.key} value={character.key}>{character.displayName}</option>)}</select></label><label>横向位置<input type="number" step="0.05" value={cue.x??0.5} onChange={event=>updateCue(index,{x:Number(event.target.value)})}/></label></>}
          <label>时长（毫秒）<input type="number" min="0" max="60000" value={cue.durationMs} onChange={event=>updateCue(index,{durationMs:Number(event.target.value)})}/></label>
          <button className="lf-action" onClick={()=>edit(next=>{next.presentation.stage.cues.splice(index,1)})}>移除此演出</button>
        </div>)}
        <h4>逐句配音绑定</h4><p>请先确认场景脚本并试听素材，再按当前已确认台词绑定。改句会使旧绑定过期。</p>
        <label>配音场景<select value={currentScene?.key??''} onChange={event=>setSceneKey(event.target.value)}>{model.systemPlan.scenes.map(scene=><option key={scene.key} value={scene.key}>{scene.title}</option>)}</select></label>
        <label>配音未结束时<select value={model.presentation.reading?.manualVoice??'wait'} onChange={event=>edit(next=>{if(next.presentation.reading)next.presentation.reading.manualVoice=event.target.value as 'wait'|'interrupt'})}><option value="wait">等待结束</option><option value="interrupt">允许手动打断</option></select></label>
        {script?.lines.map(line=>{const voice=model.presentation.reading?.voices.find(voice=>voice.lineKey===line.lineKey);return <div className="avg-assembly-row" key={line.lineKey}><span>{line.text}</span><label>配音片段<select value={voice?.assetKey??''} disabled={!accepted(`avg.content.scene-script.${script.sceneKey}`)} onChange={event=>{try{bindVoice(line.lineKey,event.target.value)}catch(cause){setError(String(cause))}}}><option value="">无配音</option>{assets.filter(asset=>asset.kind==='voice').map(asset=><option key={asset.assetKey} value={asset.assetKey}>{asset.name}</option>)}</select></label>{voice&&<button className="lf-action" onClick={()=>{try{bindVoice(line.lineKey,voice.assetKey)}catch(cause){setError(String(cause))}}}>按当前台词重新绑定</button>}</div>})}
      </fieldset></section>}
      {(avgMediaProductionEnabledV2()||model.mediaBatch||mediaBatch)&&<div hidden={section!=='media'}><MediaProductionPanel scope={scope} view={view} workspace={model}
        disabled={busy||dirty||jsonPending||voicePending} canEdit={canEditMediaDomain} canAdopt={canAdopt} sourcesReady={sourcesReady} declaration={declaration} generating={mediaRunning} visible={section==='media'}
        onPending={setImagePending} onAction={run} onReload={reload} onClear={async()=>{await clearAvgVisualBatchDraftV1({scope,expectedDraftRevision:view.draft.revision});await reload();setNotice('未使用的生成批次已移除，参考图与制作记录仍保留。')}} onNotice={setNotice} onCancel={()=>mediaAbort.current?.abort()}
        onSave={async requirements=>{
          await saveAvgVisualBatchDraftV1({scope,expectedDraftRevision:view.draft.revision,batchKey:model.mediaBatch?.batchKey??`batch.${crypto.randomUUID()}`,
            revision:(model.mediaBatch?.revision??0)+1,requirements,visualReviewPolicy:'author-visual-v1'})
          await reload();setNotice('图片需求和准确来源已保存，请到制作页核对方案后明确开始。')
        }} onGenerate={()=>run(async()=>{
          if(!details?.production.id)throw new Error('请先核对方案并明确开始')
          const controller=new AbortController();mediaAbort.current=controller;setMediaRunning(true)
          try{const result=await runAvgAssemblyV1({scope,productionId:details.production.id,signal:controller.signal});await reload();setNotice(result.buildStatus==='building'?'本批媒资步骤已执行，请逐项查看图片或审听配音并确认。':`当前媒资生产状态：${result.buildStatus}`)}
          finally{mediaAbort.current=null;if(alive.current)setMediaRunning(false)}
        })}/></div>}
      {avgMediaProductionEnabledV2()&&<div hidden={section!=='media'}><VoiceProductionPanel scope={scope} view={view} workspace={model}
        visible={section==='media'} disabled={busy||dirty||jsonPending||imagePending} canEdit={canEditMediaDomain} canAdopt={canAdopt}
        sourcesReady={sourcesReady} declaration={declaration} generating={mediaRunning} onPending={setVoicePending} onAction={run} onReload={reload}
        onNotice={setNotice} onCancel={()=>mediaAbort.current?.abort()} onGenerate={()=>run(async()=>{
          if(!details?.production.id)throw new Error('请先核对方案并明确开始')
          const controller=new AbortController();mediaAbort.current=controller;setMediaRunning(true)
          try{const result=await runAvgAssemblyV1({scope,productionId:details.production.id,signal:controller.signal});await reload();setNotice(`当前媒资生产状态：${result.buildStatus}`)}
          finally{mediaAbort.current=null;if(alive.current)setMediaRunning(false)}
        })}/></div>}
      {section==='media'&&<section className="lf-paper"><h4>导入与配置媒资</h4><p>单文件最多 32 MiB，当前联合预览最多 128 项/64 MiB。开始后素材目录固定，新增媒资在下一 Build 采用。</p>
        <fieldset disabled={busy||jsonPending||mediaPending||!canEditMediaDomain} className="avg-form"><label>文件<input type="file" accept="image/png,image/jpeg,image/webp,audio/mpeg,audio/wav,audio/ogg,audio/mp4" onChange={event=>{const next=event.target.files?.[0]??null;setFile(next);if(next&&!mediaName)setMediaName(next.name)}}/></label>
          <label>素材名称<input value={mediaName} onChange={event=>setMediaName(event.target.value)}/></label><label>用途<select value={mediaKind} onChange={event=>{const kind=event.target.value as ProductMediaKind;if(kind!==mediaKind){setMediaKind(kind);setReplaceAssetKey('');setItemTarget('')}}}>{PRODUCT_MEDIA_KINDS.map(kind=><option key={kind} value={kind}>{MEDIA_NAMES[kind]}</option>)}</select></label>
          <label>替换本次组装中的媒资<select value={replaceAssetKey} onChange={event=>setReplaceAssetKey(event.target.value)}><option value="">新增素材</option>{assets.filter(asset=>asset.kind===mediaKind).map(asset=><option key={asset.assetKey} value={asset.assetKey}>{asset.name}</option>)}</select></label>
          <p>替换会在编辑草稿中更新已有演出、物件和配音引用，保留原时机与台词绑定；改句后的配音仍需重新核对。</p>
          <label>来源与授权说明<input value={license} onChange={event=>setLicense(event.target.value)}/></label><label>替代文本<input value={alt} onChange={event=>setAlt(event.target.value)}/></label>
          <label>角色标识<select value={character} onChange={event=>setCharacter(event.target.value)}><option value="">不绑定角色</option>{model.systemPlan.characters.map(character=><option key={character.key} value={character.key}>{character.displayName}</option>)}</select></label>
          <label><input type="checkbox" checked={autoConfigure} onChange={event=>setAutoConfigure(event.target.checked)}/>导入后配置到当前场景（背景、立绘、CG、音乐/音效）</label>
          {model.systemPlan.version===2&&['ui','cg'].includes(mediaKind)&&<label>物件用途（所有状态）<select value={itemTarget} onChange={event=>setItemTarget(event.target.value)}><option value="">不绑定物件</option>{model.systemPlan.inventory.items.map(item=><option key={item.key} value={item.key}>{item.name} · {mediaKind==='ui'?'图标':'详情图'}</option>)}</select></label>}
          <button className="lf-action" disabled={!file||!license.trim()} onClick={()=>void run(importFile)}>实际解码并导入</button>
        </fieldset>
        <h4>已选媒资</h4>{assets.length===0&&<p>尚未选用媒资，仍可验证文字与规则。</p>}
        {assets.map(asset=><div className="avg-assembly-media-row" key={asset.assetKey}><button className="lf-action" onClick={()=>setSelectedAsset(asset)}>{asset.name} · {MEDIA_NAMES[asset.kind]}</button><span>{asset.license}</span><button className="lf-action" disabled={busy||mediaPending||!canEditMediaDomain||jsonPending} onClick={()=>edit(next=>{next.presentation.stage.assets=next.presentation.stage.assets.filter(row=>row.assetKey!==asset.assetKey);if(next.presentation.inheritedImages)next.presentation.inheritedImages=next.presentation.inheritedImages.filter(row=>row.assetKey!==asset.assetKey)})}>移出本次组装</button></div>)}
        {selectedAsset&&<MediaPreview key={`${scope.workId}:${selectedAsset.assetKey}:${selectedAsset.blobContentHash}`} scope={scope} asset={selectedAsset} productionId={details?.production.id} generatedSource={selectedRaw?undefined:selectedInherited?.source} raw={selectedRequirement&&selectedRaw?{requirementKey:selectedRequirement.requirementKey,version:selectedRaw.version,contentHash:selectedRaw.contentHash}:undefined}/>}
        {model.systemPlan.version===2&&<><h4>物件图标与详情图</h4><fieldset disabled={busy||jsonPending||mediaPending}>{model.systemPlan.inventory.items.flatMap((item,itemIndex)=>[item,...item.variants].map((variant,variantIndex)=><div className="avg-assembly-row" key={`${item.key}:${variantIndex}`}><strong>{variant.name}</strong>{(['iconAssetKey','detailAssetKey'] as const).map(field=><label key={field}>{field==='iconAssetKey'?'图标':'详情图'}<select value={variant[field]??''} onChange={event=>edit(next=>{if(next.systemPlan.version!==2)return;const target=variantIndex===0?next.systemPlan.inventory.items[itemIndex]:next.systemPlan.inventory.items[itemIndex].variants[variantIndex-1];target[field]=event.target.value||null})}><option value="">无</option>{assets.filter(asset=>field==='iconAssetKey'?asset.kind==='ui':['ui','cg'].includes(asset.kind)).map(asset=><option key={asset.assetKey} value={asset.assetKey}>{asset.name}</option>)}</select></label>)}</div>))}</fieldset></>}
        <details><summary>导入历史与刷新恢复</summary><p>导入成功的文件留在作品中，可恢复到尚未开始的组装草稿。</p>{view.media.items.map(({asset})=><div className="avg-assembly-media-row" key={asset.assetKey}><button className="lf-action" onClick={()=>setSelectedAsset(asset)}>{asset.name}</button><button className="lf-action" disabled={busy||mediaPending||!canEditMediaDomain||jsonPending||assets.some(row=>row.assetKey===asset.assetKey)} onClick={()=>edit(next=>next.presentation.stage.assets.push(asset))}>加入本次组装</button></div>)}{view.media.nextCursor&&<button className="lf-action" disabled={busy} onClick={()=>void run(async()=>{const media=await listAvgDraftMediaV1(scope,view.media.nextCursor!);if(alive.current)setView({...view,media})})}>读取更早导入</button>}</details>
      </section>}
      {section==='production'&&<section className="lf-paper"><h4>制作与联合预览</h4>
        <ol><li>保存编辑草稿，核对冻结世界与场景/媒资清单。</li><li>准备制作方案并明确开始，逐项查看、确认候选。</li><li>执行组装，检查实际舞台；修订生成新 Build，旧预览和存档保留。</li></ol>
        <p>场景 {model.systemPlan.scenes.length} 个 · 媒资 {assets.length} 项 · {model.mediaBatch||model.voiceProduction?`已配置 ${model.mediaBatch?.requirements.length??0} 项图片需求${model.voiceProduction?'及逐句配音需求':''}，生成须另行明确开始；专业故事调用为 0。`:'本流程模型/媒资生成调用为 0。'}</p>
        <div className="avg-actions"><button className="lf-action" disabled={!readyForStage||!view.draft.editorJson||!view.draft.worldReleaseId||activeBuild||mediaPending||!!model.voiceProduction&&!avgVoiceProductionEnabledV3()} onClick={()=>void run(async()=>{await prepareAvgAssemblyBriefV1({scope,expectedDraftRevision:view.draft.revision});await reload();setNotice('制作方案已准备，请核对后明确开始。')})}>{frozen?'准备新版本方案':'准备制作方案'}</button>
          <button className="lf-action lf-action-primary" disabled={!readyForStage||details?.production.status!=='brief-ready'||!!model.voiceProduction&&!avgVoiceProductionEnabledV3()} onClick={()=>void run(async()=>{await startAvgAssemblyV1({scope,productionId:details!.production.id!,expectedBriefHash:details!.brief!.briefHash});await reload();setNotice('已明确开始，等待逐项作者确认。')})}>确认方案并开始组装</button>
          {frozen&&<button className="lf-action" disabled={busy||jsonPending} onClick={()=>edit(next=>{next.basePreviewHash=build!.previewHash})}>以此预览开始修订</button>}
        </div>
        {mediaBatch&&<p>确认系统与全部脚本后，到素材分区生成本批图片、确认选图并配置演出；返回此页确认演出后再生成预览。</p>}{details?.brief&&<details><summary>当前制作方案与投入边界</summary><pre>{JSON.stringify(JSON.parse(details.brief.briefJson),null,2)}</pre></details>}
        {build&&!frozen&&<div className="avg-actions"><button className="lf-action" disabled={busy||jsonPending} onClick={()=>void run(async()=>{
          if(dirty)await persist()
          const actual=await readAvgAssemblyWorkspaceV1(scope,details!.production.id!)
          await restartAvgAssemblyFromDraftV1({scope,productionId:details!.production.id!,expectedBuildId:build.id!,expectedDraftRevision:actual.draft.revision})
          await reload();setNotice('旧组装与输入已保留，新方案等待明确开始和重新确认。')
        })}>停止并保留当前组装，准备新版本</button>
          {!build.planRevision&&<button className="lf-action" disabled={busy||dirty||jsonPending} onClick={()=>void run(async()=>{await runAvgAssemblyV1({scope,productionId:details!.production.id!});await reload();setNotice('已恢复制作计划，等待作者确认。')})}>恢复已开始的制作计划</button>}
        </div>}
        {humanKeys.map(key=>{const current=accepted(key),pending=view.artifacts.find(row=>row.artifactKey===key&&row.status==='pending'),hash=pending?String(JSON.parse(pending.metadataJson).candidateHash):''
          const label=key==='avg.system.plan'?'系统规则':key==='avg.author.stage'?'演出与媒资':`场景：${model.systemPlan.scenes.find(scene=>key===`avg.content.scene-script.${scene.key}`)?.title??key}`
          const upstreamReady=key==='avg.system.plan'?!sourceLocked:key==='avg.author.stage'?sourcesReady&&mediaConfigured:!sourceLocked&&!!accepted('avg.system.plan')
          return <article className="avg-assembly-candidate" aria-label={`作者确认：${label}`} key={key}><h4>{label}</h4><p>{current?`已采用 v${current.version}`:'等待作者输入'}{pending?` · 候选 v${pending.version}`:''}</p>
            <button className="lf-action" disabled={!readyForStage||!canAdopt||!upstreamReady} onClick={()=>void run(async()=>{await stageAvgWorkspaceInputV1({scope,productionId:details!.production.id!,expectedDraftRevision:view.draft.revision,artifactKey:key,declaration});await reload();setNotice('候选已保存，请查看准确内容后确认。')})}>保存候选：{label}</button>
            {pending&&<><details><summary>查看候选 v{pending.version} 的准确内容</summary><pre>{JSON.stringify(JSON.parse(pending.payloadJson),null,2)}</pre></details><label><input type="checkbox" checked={reviewed[hash]??false} disabled={!canAdopt||busy} onChange={event=>setReviewed({...reviewed,[hash]:event.target.checked})}/>我已核对该候选内容及素材来源授权</label><button className="lf-action" disabled={!readyForStage||!canAdopt||!reviewed[hash]} onClick={()=>void run(async()=>{await confirmAvgWorkspaceInputV1({scope,productionId:details!.production.id!,artifactKey:key,candidateVersion:pending.version,candidateHash:hash});await reload();setNotice('该准确版本已确认采用。')})}>确认采用：{label}</button></>}
          </article>})}
        <label>作者输入声明<textarea value={declaration} disabled={busy} onChange={event=>setDeclaration(event.target.value)} maxLength={2000}/></label>
        <div className="avg-actions"><button className="lf-action lf-action-primary" disabled={!readyForStage||!allAccepted||!build||!['authorized','building','integrating'].includes(build.status)} onClick={()=>void run(async()=>{const result=await runAvgAssemblyV1({scope,productionId:details!.production.id!});await reload();setNotice(result.buildStatus==='preview-ready'?'新预览已冻结，可以开始试玩。':`当前组装状态：${result.buildStatus}`)})}>执行组装并生成新预览</button>
          <button className="lf-action" disabled={busy||jsonPending||!frozen} onClick={()=>void run(async()=>{if(dirty)await persist();const result=await startProductProductionPreviewV1({scope,productionId:details!.production.id!,expectedBuildId:build!.id,expectedPreviewHash:build!.previewHash});if(alive.current)onPreviewStarted(result.sessionId)})}>试玩此预览</button>
          <button className="lf-action" disabled={busy} onClick={()=>void run(async()=>{downloadJSON(await exportProjectJSON(scope.projectId),'avg-workspace-backup.json')})}>导出完整备份</button>
        </div>
        {build&&<><p>Build #{build.buildNumber} · {build.status}{build.previewHash?` · 预览 ${build.previewHash.slice(0,12)}`:''}</p>{build.failureJson!=='{}'&&<pre role="status">{build.failureJson}</pre>}<details><summary>版本与验收证据</summary><p>根回执：{build.rootTerminalReceiptHash||'待组装完成'}</p><pre>{build.qualityReportJson}</pre></details></>}
        {frozen&&details?.production.id&&<PrototypeReleasePanel key={`${scope.workId}:${build!.id}:${build!.previewHash}`} scope={scope} productionId={details.production.id} build={build!} disabled={busy||dirty||jsonPending} onChanged={reload} onStarted={onPreviewStarted} onBusyChange={value=>{busyRef.current=value;setBusy(value)}}/>}
      </section>}
      <section className="lf-paper"><details><summary>高级配置：完整规则、脚本与演出</summary><p>配置作为编辑草稿保存；正式采用前会严格校验，不能写入脚本代码或未登记模块。</p>
        <textarea aria-label="高级组装配置" className="avg-assembly-json" spellCheck={false} disabled={busy||mediaPending} value={advanced} onChange={event=>{setAdvanced(event.target.value);setJsonPending(true)}}/>
        <div className="avg-actions"><button className="lf-action" disabled={busy||!jsonPending} onClick={()=>{try{const next=parseAvgAuthorWorkspaceV1(advanced);setModel(next);setDirty(true);setJsonPending(false);setError('')}catch(cause){setError(String(cause))}}}>应用高级配置到编辑草稿</button><button className="lf-action" disabled={busy||!jsonPending} onClick={()=>{setAdvanced(JSON.stringify(model,null,2));setJsonPending(false)}}>撤销高级配置输入</button></div>
      </details></section>
    </>}
  </section>
}
