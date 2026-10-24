import { useEffect, useRef, useState } from 'react'
import type { WorkspaceScope } from '../../lib/types'
import type { ChatAuthoringDraftV1, ChatAuthoringSettings } from '../../lib/character-interaction/authoring-contract'
import { confirmChatSourceReviewV1, loadChatSourceProjectionV1 } from '../../lib/character-interaction/draft-service'
import { chatProjectionResourcesV1, readPreparedChatSourceProjectionViewV1, type ChatSourceClassificationV1, type ChatSourceFragmentV1, type ChatSourceProjectionDraftV1 } from '../../lib/character-interaction/source-projection'
import {CHAT_BACKGROUND_LABELS} from './BackgroundSourceSelection'
import { FIELD_BY_TARGET } from '../../lib/registry/field-registry'
import { MORAL_AXIS_LABELS, ORDER_AXIS_LABELS, ROLE_WEIGHT_LABELS } from '../../lib/character/character-axes'
import SourceSuggestions from './SourceSuggestions'
import RoleProfiles from './RoleProfiles'
import SourceUnits from './SourceUnits'

const PURPOSES = {identity: '身份与价值观', motivation: '目标与顾虑', voice: '语言与举止', knowledge: '事实与经历'} as const
const VISIBILITY = {unclassified: '待分类，暂不使用', public: '所有参与者知道', participants: '仅指定参与者知道', 'author-only': '仅作者掌握', discoverable: '暂时无人知道，允许调查发现'} as const
const FIELD_LABELS: Record<string, string> = {
  voice: '说话方式', roleWeight: '人物地位', moralAxis: '道德立场', orderAxis: '秩序立场',
  ...Object.fromEntries((FIELD_BY_TARGET.get('characters') ?? []).filter(field => field.labels?.length).map(field => [field.field, field.labels![0]])),
}
const fieldName = (pointer: string) => pointer.slice(1).replace(/~1/g, '/').replace(/~0/g, '~')
const BACKGROUND_FIELDS: Record<string, string> = {name: '名称', title: '标题', description: '说明', summary: '概述', content: '正文', label: '关系称谓', relationType: '关系类型', isBidirectional: '双向关系', stages: '发展阶段', globalNote: '总体规则', entries: '规则条目', customNodes: '自定义规则', mainPlot: '主线安排', subPlots: '支线安排', logline: '故事梗概', theme: '主题', centralConflict: '核心矛盾', plotPattern: '情节模式'}
const NESTED_FIELDS: Record<string, string> = {name: '名称', title: '标题', description: '说明', content: '正文', label: '名称', hints: '提示', historicalAnchors: '历史依据', fictionalAdaptations: '架空设定', priority: '冲突优先级'}
function passageLabel(fragment: ChatSourceFragmentV1, fragments: ChatSourceFragmentV1[], background = false): string {
  const path = fragment.pointer.slice(1).split('/').map(key => key.replace(/~1/g, '/').replace(/~0/g, '~'))
  const labels = background ? BACKGROUND_FIELDS : FIELD_LABELS
  const label = path.map((key, index) => {
    const names = index === 0 ? labels : NESTED_FIELDS
    return Object.prototype.hasOwnProperty.call(names, key) ? names[key] : key
  }).join(' · ')
  if (!fragment.textRange) return label
  const passages = fragments.filter(f => f.resourceKey === fragment.resourceKey && f.pointer === fragment.pointer)
  return `${label}（片段 ${passages.findIndex(f => f.fragmentKey === fragment.fragmentKey) + 1}/${passages.length}）`
}
function readableValue(pointer: string, valueJson: string): string {
  const value: unknown = JSON.parse(valueJson)
  const enums: Record<string, Record<string, string>> = {moralAxis: MORAL_AXIS_LABELS, orderAxis: ORDER_AXIS_LABELS, roleWeight: ROLE_WEIGHT_LABELS}
  return typeof value === 'string' ? enums[fieldName(pointer)]?.[value] ?? value : JSON.stringify(value, null, 2)
}

export default function SourceReview(props: {
  scope: WorkspaceScope
  draft: ChatAuthoringDraftV1
  settings: ChatAuthoringSettings
  dirty: boolean
  onConfirmed: () => void
}) {
  const [projection, setProjection] = useState<ChatSourceProjectionDraftV1 | null>(null)
  const [decisions, setDecisions] = useState<ChatSourceClassificationV1[]>([])
  const [viewer, setViewer] = useState('player')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggestionKeys, setSuggestionKeys] = useState<string[]>([])
  const generation = useRef({value: 0}).current
  useEffect(() => { generation.value++; setProjection(null); setDecisions([]); setSuggestionKeys([]); setError(''); setViewer('player'); setBusy(false)
    return () => { generation.value++ }
  }, [generation, props.scope.workId, props.draft.revision])
  const load = async () => {
    const ticket = ++generation.value
    setBusy(true); setError('')
    try {
      const next = await loadChatSourceProjectionV1(props.scope, props.draft.revision)
      const saved = props.settings.version !== 1 && props.settings.sourceReview?.projectionHash === next.projectionHash ? props.settings.sourceReview : null
      if (saved) readPreparedChatSourceProjectionViewV1({draft: next, review: saved, viewerKey: 'player'})
      const savedDecisions = new Map(saved?.classifications.map(row => [row.fragmentKey, row]))
      const nextDecisions = chatProjectionResourcesV1(next).flatMap(c => c.fragments.map(fragment => savedDecisions.get(fragment.fragmentKey) ?? ({
        projectionHash: next.projectionHash, fragmentKey: fragment.fragmentKey,
        purpose: 'knowledge' as const, visibility: 'unclassified' as const, audienceKeys: [],
      })))
      readPreparedChatSourceProjectionViewV1({draft: next, review: {projectionHash: next.projectionHash, classifications: nextDecisions}, viewerKey: 'player'})
      if (ticket !== generation.value) return
      setProjection(next); setDecisions(nextDecisions); setSuggestionKeys([])
    } catch (reason) { if (ticket === generation.value) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (ticket === generation.value) setBusy(false) }
  }
  const change = (fragmentKey: string, patch: Partial<ChatSourceClassificationV1>) => {
    setDecisions(rows => rows.map(row => {
      if (row.fragmentKey !== fragmentKey) return row
      const next = {...row, ...patch}
      if (!next.discovery) delete next.discovery
      if (!['participants', 'discoverable'].includes(next.visibility)) delete next.discovery
      if (next.visibility === 'discoverable' && !next.discovery) {
        next.purpose = 'knowledge'
        next.discovery = {actorKeys: projection?.characters.slice(0, 1).map(c => c.resourceKey) ?? [], condition: '', prerequisiteFragmentKeys: []}
      }
      if (next.discovery) next.discovery = {...next.discovery, actorKeys: next.discovery.actorKeys.filter(key => !next.audienceKeys.includes(key))}
      return next
    }))
  }
  const saveReview = async () => {
    if (!projection) return
    const ticket = ++generation.value
    setBusy(true); setError('')
    try {
      await confirmChatSourceReviewV1(props.scope, props.draft.revision, {projectionHash: projection.projectionHash, classifications: decisions})
      if (ticket !== generation.value) return
      setProjection(null)
      props.onConfirmed()
    } catch (reason) { if (ticket === generation.value) setError(reason instanceof Error ? reason.message : String(reason)) }
    finally { if (ticket === generation.value) setBusy(false) }
  }
  const disabled = busy || props.dirty
  const discoveryEnabled = props.settings.version === 3 && !!props.settings.narrative.permissions.maxDiscoveriesPerSituation
  const decisionsByKey = new Map(decisions.map(row => [row.fragmentKey, row]))
  const audiences = [{key: 'player', name: '玩家'}, ...(projection?.characters.map(c => ({key: c.resourceKey, name: c.label})) ?? [])]
  const suggestionActors = (projection?.characters ?? []).map(character => {
    let knownFragmentKeys: string[] | null = null
    if (projection && props.settings.version !== 1 && props.settings.sourceReview) {
      try {knownFragmentKeys = readPreparedChatSourceProjectionViewV1({draft: projection, review: props.settings.sourceReview, viewerKey: character.resourceKey}).map(fragment => fragment.fragmentKey)}
      catch { /* Stale or incomplete decisions cannot authorize actor-scoped reading. */ }
    }
    return {key: character.resourceKey, label: character.label, knownFragmentKeys}
  })
  let preview: ReturnType<typeof readPreparedChatSourceProjectionViewV1> = [], previewIssue = ''
  if (projection) try {preview = readPreparedChatSourceProjectionViewV1({draft: projection, review: {projectionHash: projection.projectionHash, classifications: decisions}, viewerKey: viewer})}
  catch (reason) {previewIssue = (reason instanceof Error ? reason.message : String(reason)).replace(/^\[chat-source-projection\] /, '')}
  return <section className="mt-6 space-y-3 border-t border-border pt-4" aria-label="角色来源资料检查">
    <h4>角色来源资料与知识范围</h4>
    <p>逐项决定谁知道什么。角色自己未知的真相、未来结局可保留给作者；待分类资料不会进入聊天。目标与顾虑表示角色的意愿。</p>
    <p>编辑本体验新角色的资料后，也需要重新确认知情范围。</p>
    <p>背景资料与人物资料使用同一知情范围。未发生的故事安排和不打算在聊天中揭示的真相，请保留为作者资料或待分类。背景范围改变后也需要重新确认。</p>
    {discoveryEnabled && <p>已经成立、允许调查揭示的世界隐情，可单独设置发现条件。真相保持原文；角色只能在实际调查满足条件后获知。“仅作者掌握”的资料仍不会进入聊天。</p>}
    <p>长文本按原文顺序分段保留，每段可分别设置用途和知情者；未确认的片段不会自动沿用相邻段落的设置。</p>
    <p>较长的资料列表与结构按原有层级展开，条目分别确认；拆开显示不代表其中的内容已经公开。</p>
    <p>{props.settings.version === 1 ? '当前方案使用旧版人物摘要。确认完整资料后，新制作将使用分角色的知识范围；已有发布与存档保持原样。'
      : props.settings.sourceReview ? '已保存资料确认。更换角色或世界后需要重新检查。' : '开始新制作前，请检查并确认角色资料的可见范围。'}</p>
    {props.dirty && <p>请先保存方案，再检查资料。</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    <button type="button" className="lf-action" disabled={disabled} onClick={() => void load()}>{busy ? '正在处理…' : '读取并检查完整资料'}</button>
    {projection && <>
      {props.settings.version === 3 && <SourceUnits scope={props.scope} revision={props.draft.revision} projection={projection} selectedKeys={suggestionKeys} disabled={disabled}
        draft={props.draft} settings={props.settings} onConfirmed={props.onConfirmed}/>}
      {props.settings.version !== 1 && <SourceSuggestions scope={props.scope} revision={props.draft.revision} projectionHash={projection.projectionHash}
        fragmentKeys={suggestionKeys} disabled={disabled} actors={suggestionActors} labels={new Map(chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(fragment =>
          [fragment.fragmentKey, `${resource.label} · ${passageLabel(fragment, resource.fragments, 'resourceKind' in resource)}`] as const)))}/>}
      {props.settings.version !== 1 && <RoleProfiles scope={props.scope} draft={props.draft} settings={props.settings} projection={projection}
        selectedKeys={suggestionKeys} disabled={disabled} onConfirmed={props.onConfirmed}/>}
      <div className="space-y-3">{chatProjectionResourcesV1(projection).map(character => <details key={character.resourceKey} open>
        <summary>{character.label}{'origin' in character && character.origin === 'product-private' && <span className="ml-2 text-xs text-text-muted">本体验新角色</span>}{projection.playerCharacter?.resourceKey === character.resourceKey && <span className="ml-2 text-xs text-text-muted">玩家扮演</span>}{'resourceKind' in character && <span className="ml-2 text-xs text-text-muted">{CHAT_BACKGROUND_LABELS[String(character.resourceKind)] ?? '世界背景'}</span>}</summary>
        {'relatedResourceKeys' in character && Array.isArray(character.relatedResourceKeys) && <p className="text-xs text-text-muted">关联人物：{character.relatedResourceKeys.map(key => projection.playerCharacter?.resourceKey === key ? '玩家' : audiences.find(a => a.key === key)?.name ?? '未加入聊天的人物').join('、')}</p>}
        {character.fragments.map(fragment => {
          const background = 'resourceKind' in character
          const playerCharacter = projection.playerCharacter?.resourceKey === character.resourceKey
          const label = passageLabel(fragment, character.fragments, background)
          const decision: ChatSourceClassificationV1 = decisionsByKey.get(fragment.fragmentKey) ?? {projectionHash: projection.projectionHash, fragmentKey: fragment.fragmentKey, purpose: 'knowledge', visibility: 'unclassified', audienceKeys: []}
          return <div key={fragment.fragmentKey} data-testid="chat-source-fragment" className="my-3 space-y-2 rounded border border-border p-3">
            <strong>{label}</strong>
            {props.settings.version !== 1 && <label className="ml-3 text-xs"><input type="checkbox" aria-label={`${character.label} ${label} 加入整理建议`}
              disabled={disabled || suggestionKeys.length >= 12 && !suggestionKeys.includes(fragment.fragmentKey)} checked={suggestionKeys.includes(fragment.fragmentKey)}
              onChange={e => setSuggestionKeys(keys => e.target.checked ? [...keys, fragment.fragmentKey] : keys.filter(key => key !== fragment.fragmentKey))}/>加入整理建议</label>}
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{readableValue(fragment.pointer, fragment.valueJson)}</pre>
            <div className="flex flex-wrap gap-3">
              <label>资料用途<select disabled={disabled || background || !!decision.discovery} aria-label={`${character.label} ${label} 用途`} value={decision.purpose} onChange={e => change(fragment.fragmentKey, {purpose: e.target.value as ChatSourceClassificationV1['purpose']})}>{Object.entries(PURPOSES).filter(([value]) => !playerCharacter || ['identity', 'knowledge'].includes(value)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>谁知道<select disabled={disabled} aria-label={`${character.label} ${label} 可见范围`} value={decision.visibility} onChange={e => change(fragment.fragmentKey, {visibility: e.target.value as ChatSourceClassificationV1['visibility'], audienceKeys: e.target.value === 'participants' ? [playerCharacter ? 'player' : background ? projection.characters[0].resourceKey : character.resourceKey] : []})}>{Object.entries(VISIBILITY).filter(([value]) => discoveryEnabled || value !== 'discoverable').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>
            {decision.visibility === 'participants' && <div data-testid="chat-initial-audience" className="flex flex-wrap gap-3">{audiences.map(audience => <label key={audience.key}><input type="checkbox" disabled={disabled || decision.audienceKeys.length === 1 && decision.audienceKeys.includes(audience.key)} checked={decision.audienceKeys.includes(audience.key)} onChange={e => change(fragment.fragmentKey, {audienceKeys: e.target.checked ? [...decision.audienceKeys, audience.key] : decision.audienceKeys.filter(key => key !== audience.key)})}/>{audience.name}</label>)}</div>}
            {discoveryEnabled && decision.visibility === 'participants' && <label><input type="checkbox" disabled={disabled || !decision.discovery && projection.characters.every(c => decision.audienceKeys.includes(c.resourceKey))} checked={!!decision.discovery} onChange={e => change(fragment.fragmentKey, {purpose: 'knowledge', discovery: e.target.checked ? {actorKeys: projection.characters.filter(c => !decision.audienceKeys.includes(c.resourceKey)).slice(0, 1).map(c => c.resourceKey), condition: '', prerequisiteFragmentKeys: []} : undefined})}/>允许其他角色调查发现</label>}
            {decision.discovery && <div data-testid="chat-source-discovery" className="space-y-2 rounded bg-surface-secondary p-3">
              <label className="block">发现条件<textarea aria-label={`${character.label} ${label} 发现条件`} className="w-full" disabled={disabled} maxLength={2000} value={decision.discovery.condition} onChange={e => change(fragment.fragmentKey, {discovery: {...decision.discovery!, condition: e.target.value}})}/></label>
              <p className="text-xs text-text-muted">说明实际完成什么调查才能知道整段事实。只看到物品不能证明是谁放的或为什么放；未发生的结局不能当作既定真相。</p>
              <fieldset><legend>允许调查的角色</legend>{projection.characters.filter(c => !decision.audienceKeys.includes(c.resourceKey)).map(c => <label className="mr-3 inline-flex gap-1" key={c.resourceKey}><input type="checkbox" disabled={disabled} checked={decision.discovery!.actorKeys.includes(c.resourceKey)} onChange={e => change(fragment.fragmentKey, {discovery: {...decision.discovery!, actorKeys: e.target.checked ? [...decision.discovery!.actorKeys, c.resourceKey] : decision.discovery!.actorKeys.filter(key => key !== c.resourceKey)}})}/>{c.label}</label>)}</fieldset>
              <fieldset className="max-h-48 overflow-auto"><legend>必要前提（所选角色已经知道的事实资料）</legend>{chatProjectionResourcesV1(projection).flatMap(resource => resource.fragments.map(item => {
                const known = decisionsByKey.get(item.fragmentKey), rule = decision.discovery!
                const selected = rule.prerequisiteFragmentKeys.includes(item.fragmentKey)
                const eligible = item.fragmentKey !== fragment.fragmentKey && known?.purpose === 'knowledge' && (known.visibility === 'public' || known.visibility === 'participants' && rule.actorKeys.every(key => known.audienceKeys.includes(key)))
                if (!eligible && !selected) return null
                return <label className="block text-sm" key={item.fragmentKey}><input type="checkbox" disabled={disabled} checked={selected} onChange={e => change(fragment.fragmentKey, {discovery: {...rule, prerequisiteFragmentKeys: e.target.checked ? [...rule.prerequisiteFragmentKeys, item.fragmentKey] : rule.prerequisiteFragmentKeys.filter(key => key !== item.fragmentKey)}})}/>{resource.label} · {passageLabel(item, resource.fragments, 'resourceKind' in resource)}：{readableValue(item.pointer, item.valueJson)}{!eligible && <span className="block text-danger">此项已不满足前提要求；请取消选择或修改对应资料。</span>}</label>
              }))}</fieldset>
              <p className="text-xs text-text-muted">前提应提供角色开展调查的依据。缺少可选项时，先将对应资料设为“事实与经历”，再确认角色的知情范围。</p>
            </div>}
          </div>
        })}
      </details>)}</div>
      <details><summary>检查参与者实际获得的资料</summary><label>查看视角<select value={viewer} onChange={e => setViewer(e.target.value)}>{audiences.map(a => <option key={a.key} value={a.key}>{a.name}</option>)}</select></label>
        {preview.length ? preview.map(fragment => <p className="whitespace-pre-wrap break-words text-xs" key={fragment.fragmentKey}>{PURPOSES[fragment.purpose]} · {passageLabel(fragment, chatProjectionResourcesV1(projection).flatMap(c => c.fragments), !!projection.background?.some(r => r.resourceKey === fragment.resourceKey))}：{readableValue(fragment.pointer, fragment.valueJson)}</p>) : <p>这个视角还没有获准读取的来源资料。</p>}
      </details>
      {previewIssue && <p role="alert" className="text-danger">请补全资料确认：{previewIssue}</p>}
      <button type="button" className="lf-action lf-action-primary" disabled={disabled || !!previewIssue} onClick={() => void saveReview()}>确认可见范围并用于新制作</button>
    </>}
  </section>
}
