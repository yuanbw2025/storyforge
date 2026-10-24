import type {ChatNarrativeSetupV1} from '../../lib/character-interaction/narrative-setup'
import type {ChatNarrativePermissionsV1} from '../../lib/types/chat-narrative'
import {parseChatSourceUnitSetV1} from '../../lib/character-interaction/source-unit-authorization'

export default function NarrativeSetup({value, onChange, characters, aiCharacterKeys, hasSourceDiscoveries = false, sourceUnitsJson}: {
  value: ChatNarrativeSetupV1; onChange: (value: ChatNarrativeSetupV1) => void
  characters: readonly {resourceKey: string; name: string}[]; aiCharacterKeys: readonly string[]
  hasSourceDiscoveries?: boolean
  sourceUnitsJson?: string
}) {
  if (sourceUnitsJson !== undefined) {
    try {hasSourceDiscoveries ||= parseChatSourceUnitSetV1(JSON.parse(sourceUnitsJson)).bundles.some(bundle => bundle.permissions.some(row => row.discovery))}
    catch {hasSourceDiscoveries = true}
  }
  const permissions = value.permissions
  const change = (patch: Partial<ChatNarrativeSetupV1>) => onChange({...value, ...patch})
  const permit = (patch: Partial<ChatNarrativePermissionsV1>) => change({permissions: {...permissions, ...patch}})
  const triggers: Array<[ChatNarrativePermissionsV1['triggers'][number], string]> = [
    ['scene-start', '进入场景时'], ['player-response', '我说话以后'], ['continue', '我点击继续时'], ['return', '我返回聊天时'], ['player-seed', '我提出新情景时'],
  ]
  const kinds: Array<[ChatNarrativePermissionsV1['allowedNewFactKinds'][number], string]> = [
    ['observation', '观察到的新细节'], ['object', '新物件'], ['place', '新地点'], ['temporary-character', '临时登场人物'],
  ]
  return <section className="col-span-full" data-testid="chat-narrative-setup">
    <h4>故事如何开始和推进</h4>
    <p>你提出情景后，先比较并选定初始局面，再由角色依据自身目标持续行动。玩家身份指故事中的虚构角色。</p>
    <div className="avg-form">
      <label>玩家人物来源<select value={value.playerCharacterKey ?? ''} onChange={e => {
        const next = {...value}
        if (e.target.value) next.playerCharacterKey = e.target.value
        else delete next.playerCharacterKey
        onChange(next)
      }}><option value="">自定义人物</option>
        {value.playerCharacterKey && !characters.some(c => c.resourceKey === value.playerCharacterKey) && <option value={value.playerCharacterKey}>已选人物（等待来源载入）</option>}
        {characters.map(c => <option key={c.resourceKey} value={c.resourceKey} disabled={aiCharacterKeys.includes(c.resourceKey)}>{c.name}{aiCharacterKeys.includes(c.resourceKey) ? '（已由 AI 扮演）' : ''}</option>)}
      </select></label>
      <p className="col-span-full">可自定义人物，也可扮演所选世界中的人物。玩家人物由你控制，不能同时作为 AI 参与角色；保存后请在“角色与场景”重新确认资料。</p>
      <label>玩家虚构角色的称呼<input value={value.personaName} maxLength={200} onChange={e => change({personaName: e.target.value})}/></label>
      <p className="col-span-full">称呼与“玩家身份”会告诉所有角色。选择世界人物后，请核对这些已有文字；私有经历应在资料检查中设置知情者，不会自动填入公开身份。</p>
      <label>地点（可留空）<input value={value.location} maxLength={1000} onChange={e => change({location: e.target.value})}/></label>
      <label>时间（可留空）<input value={value.timeLabel} maxLength={1000} onChange={e => change({timeLabel: e.target.value})}/></label>
      <label>供比较的开场数<select value={value.openingCount} onChange={e => change({openingCount: Number(e.target.value)})}>{[3, 4, 5].map(n => <option key={n} value={n}>{n} 个</option>)}</select></label>
      <label>互动节奏<select value={permissions.mode} onChange={e => permit({mode: e.target.value as ChatNarrativePermissionsV1['mode']})}><option value="story">故事：围绕未完成的事推进</option><option value="companionship">陪伴：允许平静相处，不强求冲突</option></select></label>
      <label>情境强度<select value={permissions.intensity} onChange={e => permit({intensity: e.target.value as ChatNarrativePermissionsV1['intensity']})}><option value="everyday">日常</option><option value="tension">有张力</option><option value="danger">有危险</option></select></label>
      <fieldset><legend>允许角色主动行动的时机</legend>{triggers.map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions.triggers.includes(key)} onChange={e => permit({triggers: e.target.checked ? [...permissions.triggers, key] : permissions.triggers.filter(t => t !== key)})}/>{label}</label>)}</fieldset>
      <fieldset><legend>允许引入的内容</legend>{kinds.map(([key, label]) => <label key={key}><input type="checkbox" checked={permissions.allowedNewFactKinds.includes(key)} onChange={e => permit({allowedNewFactKinds: e.target.checked ? [...permissions.allowedNewFactKinds, key] : permissions.allowedNewFactKinds.filter(t => t !== key), ...(!e.target.checked && key === 'observation' && permissions.allowInquiryResults ? {allowInquiryResults: false} : {})})}/>{label}</label>)}</fieldset>
      <label><input type="checkbox" disabled={hasSourceDiscoveries} checked={permissions.allowActorSituationExpansion === true} onChange={e => permit({allowActorSituationExpansion: e.target.checked, ...(!e.target.checked && permissions.allowInquiryResults ? {allowInquiryResults: false} : {}), ...(!e.target.checked && permissions.allowActorThreadFollowups ? {allowActorThreadFollowups: false} : {}), ...(!e.target.checked && permissions.allowPlayerFollowupSituations ? {allowPlayerFollowupSituations: false} : {}), ...(!e.target.checked && permissions.maxDiscoveriesPerSituation ? {maxDiscoveriesPerSituation: 0} : {})})}/>允许角色依据未完成事项发展新局面</label>
      <label><input type="checkbox" disabled={permissions.allowActorSituationExpansion !== true} checked={permissions.allowPlayerFollowupSituations === true} onChange={e => permit({allowPlayerFollowupSituations: e.target.checked})}/>一件事结束后，允许角色承接我明确提出的新事项</label>
      <label><input type="checkbox" disabled={permissions.allowActorSituationExpansion !== true} checked={permissions.allowActorThreadFollowups === true} onChange={e => permit({allowActorThreadFollowups: e.target.checked})}/>完成自己的一个目标后，允许角色接续参与中的未完成事项</label>
      <label><input type="checkbox" disabled={permissions.allowActorSituationExpansion !== true || !permissions.allowedNewFactKinds.includes('observation') || permissions.maxNewFactsPerAction < 1} checked={permissions.allowInquiryResults === true} onChange={e => permit({allowInquiryResults: e.target.checked})}/>允许已在场的场景人物回应角色实际提出的问题</label>
      <p className="col-span-full">答复保留实际听众；对方说过不等于内容为真。涉及隐情时仍须满足逐项发现条件，不代替玩家或参与演绎的主角色回答。</p>
      <label>每次调查最多揭示<select aria-label="每次调查最多揭示" disabled={permissions.allowActorSituationExpansion !== true} value={permissions.maxDiscoveriesPerSituation ?? 0} onChange={e => permit({maxDiscoveriesPerSituation: Number(e.target.value)})}><option value={0} disabled={hasSourceDiscoveries}>暂不启用隐情发现</option>{[1, 2, 3].map(n => <option key={n} value={n}>{n} 条已确认隐情</option>)}</select></label>
      <p className="col-span-full">隐情发现用于你确认的开场背景和已授权的世界事实。世界来源在角色资料中逐项设置条件；选定开场前可再次检查。角色实际调查并通过检查后才会获知，标为“仅作者”的资料不会加入。</p>
      {hasSourceDiscoveries && <p className="col-span-full">已有来源事实的发现授权。请先在角色来源资料中取消原文发现授权，或移除、重新确认逐项事实整理，再关闭调查发现；其他资料设置会保留。</p>}
      <label>同时推进的事项上限<input type="number" min={1} max={8} value={permissions.maxActiveThreads} onChange={e => permit({maxActiveThreads: Number(e.target.value)})}/></label>
      <label>每次触发的角色行动上限<input type="number" min={1} max={3} value={permissions.maxActionsPerTrigger} onChange={e => permit({maxActionsPerTrigger: Number(e.target.value)})}/></label>
      <label>每次行动可新增的事实数<input type="number" min={0} max={5} value={permissions.maxNewFactsPerAction} onChange={e => permit({maxNewFactsPerAction: Number(e.target.value), ...(Number(e.target.value) < 1 && permissions.allowInquiryResults ? {allowInquiryResults: false} : {})})}/></label>
      <label>每次行动文字上限<input type="number" min={100} max={8000} value={permissions.maxActionCharacters} onChange={e => permit({maxActionCharacters: Number(e.target.value)})}/></label>
    </div>
  </section>
}
