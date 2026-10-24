import {useEffect, useState} from 'react'
import type {WorkspaceScope} from '../../lib/types'
import type {ChatAuthoringSettings} from '../../lib/character-interaction/authoring-contract'
import {loadChatBackgroundOptionsV1} from '../../lib/character-interaction/background-source'

export const CHAT_BACKGROUND_LABELS: Record<string, string> = {
  location: '地点', 'codex-entry': '百科与组织', 'character-relation': '人物关系', 'story-core': '故事设定',
  'story-arc': '故事线', 'storyline-progress': '故事进展', worldview: '世界观', geography: '地理', history: '历史',
  'world-rules': '世界规则', 'power-system': '力量体系', 'cultivation-system': '修炼体系', 'historical-event': '历史事件',
  'outline-node': '大纲', 'detailed-outline': '场景细纲', chapter: '正文', foreshadow: '伏笔',
}

export default function BackgroundSourceSelection(props: {
  scope: WorkspaceScope; worldReleaseId: number | null; settings: ChatAuthoringSettings; disabled: boolean
  onChange: (keys: string[]) => void
}) {
  const {projectId, worldId, workId} = props.scope
  const [options, setOptions] = useState<Awaited<ReturnType<typeof loadChatBackgroundOptionsV1>>>([])
  const [error, setError] = useState(''), [loading, setLoading] = useState(false), [query, setQuery] = useState(''), [limit, setLimit] = useState(40)
  useEffect(() => {
    let active = true
    setOptions([]); setError(''); setQuery(''); setLimit(40); setLoading(!!props.worldReleaseId)
    if (props.worldReleaseId) void loadChatBackgroundOptionsV1({projectId, worldId, workId}, props.worldReleaseId)
      .then(rows => {if (active) setOptions(rows)})
      .catch(reason => {if (active) setError(reason instanceof Error ? reason.message : String(reason))})
      .finally(() => {if (active) setLoading(false)})
    return () => {active = false}
  }, [projectId, worldId, workId, props.worldReleaseId])
  if (props.settings.version === 1) return <p>确认下方的完整人物资料后，可以选择世界背景资料。</p>
  const selected = props.settings.backgroundResourceKeys ?? []
  const shown = options.filter(option => `${option.label} ${CHAT_BACKGROUND_LABELS[option.resourceKind] ?? '世界资料'}`.includes(query.trim()))
  return <details className="mt-5 space-y-3 rounded border border-border p-3" data-testid="chat-background-selection">
    <summary className="cursor-pointer">世界背景资料（已选 {selected.length} 项）</summary>
    <p className="text-sm text-text-muted">选择本次故事会用到的地点、规则、人物关系或原作片段。保存方案后，在下方逐项决定谁知道哪些内容；选择资料本身不会公开内容，也不会调用模型。</p>
    {loading && <p role="status">正在读取可选资料…</p>}
    {error && <p role="alert" className="text-danger">{error}</p>}
    {!props.worldReleaseId && <p>先选择冻结的世界版本。</p>}
    {!!options.length && <>
      <label className="block text-sm">查找背景资料<input aria-label="查找背景资料" value={query} onChange={event => {setQuery(event.target.value); setLimit(40)}} className="mt-1 w-full" /></label>
      <div className="space-y-2">{shown.slice(0, limit).map(option => <label key={option.resourceKey} className="flex items-start gap-2 break-words text-sm">
        <input type="checkbox" aria-label={`背景资料：${option.label}`} checked={selected.includes(option.resourceKey)} disabled={props.disabled || !selected.includes(option.resourceKey) && selected.length >= 128}
          onChange={event => props.onChange(event.target.checked ? [...selected, option.resourceKey] : selected.filter(key => key !== option.resourceKey))} />
        <span>{option.label}<span className="ml-2 text-xs text-text-muted">{CHAT_BACKGROUND_LABELS[option.resourceKind] ?? '世界资料'}</span></span>
      </label>)}</div>
      {!shown.length && <p>没有匹配的资料。</p>}
      {shown.length > limit && <button type="button" className="lf-action" onClick={() => setLimit(limit + 40)}>显示更多背景资料</button>}
    </>}
    {!!props.worldReleaseId && !loading && !error && !options.length && <p>这个世界版本暂无可选背景资料。</p>}
    <p className="text-xs text-text-muted">最多选择 128 项；修改范围后，原来的资料确认需要重新检查。</p>
  </details>
}
