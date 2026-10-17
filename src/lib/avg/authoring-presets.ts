import type { AvgSystemPlan } from './system-contract'
import type { AvgAuthorWorkspaceV1 } from './author-workspace-contract'
import { parseAvgAuthorWorkspaceV1 } from './author-workspace-contract'

export const AVG_AUTHORING_PRESETS_V1 = [
  { key:'evidence',label:'选择、知识与物件' },
  { key:'linear',label:'线性阅读与舞台' },
] as const

/** Original engineering text, openly labelled as a system calibration sample. */
export function createAvgAuthoringPresetV1(kind: 'evidence' | 'linear' = 'evidence'): AvgAuthorWorkspaceV1 {
  const systemPlan: AvgSystemPlan = kind === 'linear' ? {
    schema:'storyforge.avg.system-plan',version:1,key:'avg.author.lights',title:'灯光校准',storyMode:'linear',characters:[],
    variables:[{key:'lit',kind:'boolean',initial:false,optional:false}],knowledge:[],relationships:[],entrySceneKey:'dark',
    scenes:[{key:'dark',title:'灯光关闭',kind:'entry',enterWhen:{},onEnter:[]},
      {key:'light',title:'灯光亮起',kind:'ending',enterWhen:{path:'avg.variables.lit',eq:true},onEnter:[]}],
    actions:[{key:'switch',fromSceneKey:'dark',toSceneKey:'light',label:'打开灯光',description:'',unavailableReason:'',visibleWhen:{},enabledWhen:{},
      effects:[{op:'set',path:'avg.variables.lit',value:true}]}],
  } : {
    schema:'storyforge.avg.system-plan',version:2,key:'avg.author.envelope',title:'信封校准',storyMode:'branching',
    characters:[{key:'keeper',displayName:'保管员'}],variables:[{key:'checks',kind:'number',initial:0,minimum:0,maximum:3,integer:true,optional:false}],
    knowledge:[{holderKey:'player',factKey:'seal',initial:false},{holderKey:'keeper',factKey:'seal',initial:false}],
    relationships:[{characterKey:'keeper',dimensionKey:'trust',initial:0,minimum:-2,maximum:2}],entrySceneKey:'desk',
    scenes:[{key:'desk',title:'桌前',kind:'entry',enterWhen:{},onEnter:[]},{key:'wait',title:'继续保管',kind:'ending',enterWhen:{},onEnter:[]},
      {key:'handover',title:'完成交接',kind:'ending',enterWhen:{path:'avg.knowledge.keeper.seal',eq:true},onEnter:[]}],
    actions:[{key:'share',fromSceneKey:'desk',toSceneKey:'handover',label:'确认交接',description:'',unavailableReason:'先检查并向保管员出示信封',
      visibleWhen:{},enabledWhen:{path:'avg.knowledge.keeper.seal',eq:true},effects:[{op:'increment',path:'avg.relationships.keeper.trust',value:1}]},
      {key:'wait',fromSceneKey:'desk',toSceneKey:'wait',label:'继续保管',description:'',unavailableReason:'',visibleWhen:{},enabledWhen:{},effects:[]}],
    inventory:{schema:'storyforge.avg.inventory-plan',version:1,
      items:[{key:'letter',category:'evidence',name:'封好的信封',description:'封口仍在，细节尚未检查。',unique:true,maxQuantity:1,
        states:['sealed','open'],transitions:[{from:'sealed',to:'open'}],visibleWhen:{},iconAssetKey:null,detailAssetKey:null,
        variants:[{key:'known',when:{path:'avg.knowledge.player.seal',eq:true},name:'带缺口的封印信',description:'封印边缘有一处旧缺口。',iconAssetKey:null,detailAssetKey:null}]}],
      instances:[{key:'envelope',itemKey:'letter',holderKey:'player',quantity:1,state:'sealed',inspected:false}],
      actions:[{key:'inspectLetter',instanceKey:'envelope',verb:'inspect',target:null,sceneKeys:['desk'],label:'检查信封',unavailableReason:'已经检查过',
        visibleWhen:{},enabledWhen:{},once:true,effects:[{op:'set',path:'avg.knowledge.player.seal',value:true},{op:'increment',path:'avg.variables.checks',value:1}],feedback:'你确认了封印上的旧缺口。'},
        {key:'presentLetter',instanceKey:'envelope',verb:'present',target:{kind:'character',key:'keeper'},sceneKeys:['desk'],label:'向保管员出示',
          unavailableReason:'先检查封口',visibleWhen:{},enabledWhen:{path:'avg.knowledge.player.seal',eq:true},once:true,
          effects:[{op:'set',path:'avg.knowledge.keeper.seal',value:true}],feedback:'保管员辨认了缺口，现在可以确认交接。'}]},
  }
  const text: Record<string,string> = kind === 'linear' ? {dark:'这是原创工程校准文本。点击开关，检查阅读与舞台的联动。',light:'灯光亮起，变量已生效。'}
    : {desk:'保管员将信封交给你。请打开背包，检查封口，再向保管员出示。',wait:'你把信封保留在身边。',handover:'保管员确认缺口，交接完成。'}
  return parseAvgAuthorWorkspaceV1({schema:'storyforge.avg.author-workspace',version:1,basePreviewHash:null,systemPlan,
    scripts:systemPlan.scenes.map(scene=>({schema:'storyforge.avg.scene-script',version:1,sceneKey:scene.key,
      lines:[{lineKey:`line.${scene.key}`,beatKey:`line.${scene.key}`,speakerKey:scene.key==='desk'?'keeper':null,text:text[scene.key],informationKeys:[],actionKeys:[]}],
      choices:systemPlan.actions.filter(action=>action.fromSceneKey===scene.key).map(action=>({choiceKey:action.key,text:action.label,actionKey:action.key}))})),
    presentation:{schema:'storyforge.avg.author-stage',version:1,aspectRatio:'16:9',
      stage:{version:1,cues:[{cueKey:'opening.tone',beatKey:`line.${systemPlan.entrySceneKey}`,type:'set-tone',tone:'night',phase:'before',durationMs:0,order:0,easing:'linear'},
        ...(kind==='linear'?[{cueKey:'light.tone',beatKey:'line.light',type:'set-tone',tone:'day',phase:'before',durationMs:0,order:1,easing:'linear'}]:[])],assets:[]},
      reading:{schema:'storyforge.avg.reading-plan',version:1,manualVoice:'wait',voiceFailure:'pause',maximumVoiceWaitMs:30_000,autoDelayMs:800,voices:[]}}})
}
