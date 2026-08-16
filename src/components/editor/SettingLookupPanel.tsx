import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Search, X, BookOpen, Users, Scroll, Hash, Sparkles, Loader2, Send, FileText, Check } from 'lucide-react'
import type { CodexEntry, BuiltInCodexKey } from '../../lib/types/codex'
import type { Character } from '../../lib/types/character'
import type { WorldRuleNodeDef } from '../../lib/types/world-rules'
import { WORLD_RULE_TREE } from '../../lib/types/world-rules'
import { parseFieldSchema, parseEntryFields } from '../../lib/types/codex'
import { scoreCodexEntry } from '../../lib/codex/search'
import { chat, streamChat } from '../../lib/ai/client'
import type { AIConfig } from '../../lib/types'
import { useCodexStore } from '../../stores/codex'
import { useCharacterStore } from '../../stores/character'
import { useWorldRulesStore } from '../../stores/world-rules'

interface Props {
  aiConfig: AIConfig
  projectId: number
  onClose: () => void
}

interface SearchResult {
  type: 'codex' | 'character' | 'worldRule'
  id: number | string
  name: string
  summary: string
  category?: string
  icon?: string
  score: number
  data: CodexEntry | Character | { node: WorldRuleNodeDef; entry?: { historicalAnchors: string; fictionalAdaptations: string; priority: string } }
}

interface QAMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ExtractedSetting {
  id: string
  name: string
  category: string
  categoryKey: BuiltInCodexKey
  summary: string
  fields: Record<string, string>
  existingEntryId?: number
}

const STORAGE_KEY = 'storyforge-setting-qa-messages'

export default function SettingLookupPanel({
  aiConfig,
  projectId,
  onClose,
}: Props) {
  const [mode, setMode] = useState<'search' | 'qa'>('search')
  const [query, setQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'codex' | 'character' | 'worldRule'>('all')
  const [selectedResult, setSelectedResult] = useState<SearchResult | null>(null)
  const [qaMessages, setQaMessages] = useState<QAMessage[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved ? JSON.parse(saved) : []
    } catch {
      return []
    }
  })
  const [isGenerating, setIsGenerating] = useState(false)
  const [showExtractModal, setShowExtractModal] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractedSettings, setExtractedSettings] = useState<ExtractedSetting[]>([])
  const [selectedSettings, setSelectedSettings] = useState<Set<string>>(new Set())

  const chatContainerRef = useRef<HTMLDivElement>(null)

  const { categories: codexCategories, entries: codexEntries, addEntry, updateEntry } = useCodexStore()
  const { characters } = useCharacterStore()
  const { profile: worldRulesProfile } = useWorldRulesStore()

  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    }
  }, [qaMessages])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(qaMessages))
  }, [qaMessages])

  const results = useMemo<SearchResult[]>(() => {
    if (!query.trim() || mode === 'qa') return []

    const q = query.trim()
    const allResults: SearchResult[] = []

    if (activeTab === 'all' || activeTab === 'codex') {
      for (const entry of codexEntries) {
        const category = codexCategories.find(c => c.id === entry.categoryId)
        const fields = parseEntryFields(entry.fields)
        const fieldsText = Object.values(fields).join(' ')
        const score = scoreCodexEntry(entry.name, entry.summary, fieldsText, q)
        if (score > 0) {
          allResults.push({
            type: 'codex',
            id: entry.id!,
            name: entry.name,
            summary: entry.summary,
            category: category?.name,
            icon: category?.icon,
            score,
            data: entry,
          })
        }
      }
    }

    if (activeTab === 'all' || activeTab === 'character') {
      for (const char of characters) {
        const score = scoreCodexEntry(
          char.name,
          char.shortDescription || '',
          `${char.role || ''} ${char.personality || ''} ${char.background || ''}`,
          q,
        )
        if (score > 0) {
          allResults.push({
            type: 'character',
            id: char.id!,
            name: char.name,
            summary: char.shortDescription || '暂无简介',
            category: char.role || '角色',
            icon: '👤',
            score,
            data: char,
          })
        }
      }
    }

    if (activeTab === 'all' || activeTab === 'worldRule') {
      const traverseTree = (nodes: WorldRuleNodeDef[], parentLabel?: string) => {
        for (const node of nodes) {
          const entry = worldRulesProfile?.entries[node.id]
          const content = entry
            ? `${entry.historicalAnchors} ${entry.fictionalAdaptations}`
            : node.label + (node.hints?.join(' ') || '')
          const score = scoreCodexEntry(node.label, content, '', q)
          if (score > 0) {
            allResults.push({
              type: 'worldRule',
              id: node.id,
              name: node.label,
              summary: entry
                ? (entry.historicalAnchors || entry.fictionalAdaptations).slice(0, 100) +
                  ((entry.historicalAnchors || entry.fictionalAdaptations).length > 100 ? '...' : '')
                : '暂无设定',
              category: parentLabel || '世界规则',
              icon: node.icon || '📜',
              score,
              data: {
                node,
                entry: entry
                  ? {
                      historicalAnchors: entry.historicalAnchors,
                      fictionalAdaptations: entry.fictionalAdaptations,
                      priority: entry.priority,
                    }
                  : undefined,
              },
            })
          }
          if (node.children) {
            traverseTree(node.children, node.label)
          }
        }
      }
      traverseTree(WORLD_RULE_TREE)
    }

    return allResults.sort((a, b) => b.score - a.score).slice(0, 20)
  }, [query, activeTab, codexEntries, codexCategories, characters, worldRulesProfile, mode])

  const buildKnowledgeContext = useCallback(() => {
    const parts: string[] = []

    if (codexEntries.length > 0) {
      const catById = new Map(codexCategories.map(c => [c.id!, c]))
      parts.push('【设定词条】')
      for (const entry of codexEntries) {
        const category = catById.get(entry.categoryId)
        const fields = parseEntryFields(entry.fields)
        const fieldDefs = parseFieldSchema(category?.fieldSchema || '')
        const fieldLines = fieldDefs
          .map(d => {
            const v = fields[d.key]
            return v ? `${d.label}: ${v}` : ''
          })
          .filter(Boolean)
        parts.push(`- ${entry.name}${entry.summary ? `（${entry.summary}）` : ''}`)
        if (fieldLines.length > 0) {
          parts.push('  ' + fieldLines.join('；'))
        }
      }
    }

    if (characters.length > 0) {
      parts.push('\n【角色信息】')
      for (const char of characters) {
        parts.push(`- ${char.name}${char.identity ? `（${char.identity}）` : ''}`)
        if (char.shortDescription) parts.push(`  简介：${char.shortDescription}`)
        if (char.personality) parts.push(`  性格：${char.personality}`)
        if (char.background) parts.push(`  背景：${char.background}`)
      }
    }

    if (worldRulesProfile) {
      parts.push('\n【世界规则】')
      const traverseRules = (nodes: WorldRuleNodeDef[], prefix: string = '') => {
        for (const node of nodes) {
          const entry = worldRulesProfile.entries[node.id]
          if (entry) {
            const content = [
              entry.historicalAnchors ? `📜 ${entry.historicalAnchors}` : '',
              entry.fictionalAdaptations ? `✨ ${entry.fictionalAdaptations}` : '',
            ].filter(Boolean).join('\n')
            parts.push(`${prefix}- ${node.label}`)
            if (content) parts.push(prefix + '  ' + content)
          }
          if (node.children) {
            traverseRules(node.children, prefix + '  ')
          }
        }
      }
      traverseRules(WORLD_RULE_TREE)
    }

    return parts.join('\n')
  }, [codexEntries, codexCategories, characters, worldRulesProfile])

  const handleQASubmit = useCallback(async () => {
    if (!query.trim() || isGenerating) return

    const userQuestion = query.trim()
    setIsGenerating(true)
    setQuery('')

    setQaMessages(prev => [...prev, { role: 'user', content: userQuestion }])

    const knowledgeContext = buildKnowledgeContext()
    const systemPrompt = `你是一位设定专家，专门协助作者讨论和完善小说设定。

当前设定信息：
${knowledgeContext}

对话规则：
1. 用户可能会询问现有设定，也可能提出新的设定想法进行讨论
2. 如果设定中没有相关信息，明确说明"设定中未提及"，并可以提出建议
3. 当用户提出新设定想法时，积极参与讨论，帮助完善细节
4. 回答要简洁明了，直接给出答案或建议
5. 如果需要推断，请说明推断依据`

    try {
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        ...qaMessages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: userQuestion },
      ]

      setQaMessages(prev => [...prev, { role: 'assistant', content: '' }])

      for await (const chunk of streamChat(messages, aiConfig, undefined, undefined, { category: 'setting-qa', projectId })) {
        setQaMessages(prev => {
          const last = [...prev]
          last[last.length - 1] = { role: 'assistant', content: last[last.length - 1].content + chunk }
          return last
        })
      }
    } catch (error) {
      console.error('QA error:', error)
      setQaMessages(prev => [...prev, { role: 'assistant', content: '抱歉，AI 回答失败，请重试' }])
    } finally {
      setIsGenerating(false)
    }
  }, [query, isGenerating, buildKnowledgeContext, aiConfig, projectId, qaMessages])

  const handleExtractSettings = useCallback(async () => {
    if (qaMessages.length === 0 || isExtracting) return

    setIsExtracting(true)
    setShowExtractModal(true)
    setExtractedSettings([])

    const conversationText = qaMessages.map(m => `${m.role === 'user' ? '用户' : 'AI'}：${m.content}`).join('\n\n')
    const knowledgeContext = buildKnowledgeContext()

    const extractPrompt = `你是一位设定提取专家。请分析以下对话内容，提取其中讨论的新设定或对现有设定的修改。

当前已有设定：
${knowledgeContext}

对话历史：
${conversationText}

请从对话中提取出需要添加或修改的设定条目。每个条目应该是一个独立的实体（地点、物品、角色、势力等）。

输出格式要求：
请输出 JSON 数组，每个元素包含以下字段：
- name: 词条名称
- category: 分类名称（如：城池重镇、人工器物、种族民族等）
- categoryKey: 分类的内置键（如：city、artifact、race、faction、mineral、herb、beast 等）
- summary: 一句话简介
- fields: 对象，包含该词条的字段及其值

如果对话中没有讨论任何新设定或修改，请返回空数组。

注意：
1. 只提取对话中明确讨论的内容，不要凭空猜测
2. 如果是对现有词条的修改，请确保 name 与现有词条完全匹配
3. categoryKey 必须是以下之一：city, artifact, race, faction, mineral, herb, beast, natStructure, natDimension, natTerrain, natWater, natClimate, humEra, humEvent, humSociety, humConflict, originPower, originDeity`

    try {
      const response = await chat(
        [
          { role: 'system', content: extractPrompt },
        ],
        aiConfig,
        { category: 'setting-extract', projectId },
      )

      const jsonMatch = response.match(/\[.*\]/s)
      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]) as ExtractedSetting[]
        setExtractedSettings(extracted.map((s, idx) => ({ ...s, id: `${idx}` })))
        setSelectedSettings(new Set(extracted.map((_, idx) => `${idx}`)))
      } else {
        setExtractedSettings([])
      }
    } catch (error) {
      console.error('Extract error:', error)
      setExtractedSettings([])
    } finally {
      setIsExtracting(false)
    }
  }, [qaMessages, isExtracting, buildKnowledgeContext, aiConfig, projectId])

  const handleSaveSettings = useCallback(async () => {
    const toSave = extractedSettings.filter(s => selectedSettings.has(s.id))
    
    for (const setting of toSave) {
      const category = codexCategories.find(c => c.builtInKey === setting.categoryKey)
      if (!category) continue

      const existingEntry = codexEntries.find(e => e.categoryId === category.id && e.name === setting.name)

      if (existingEntry) {
        const fields = parseEntryFields(existingEntry.fields)
        Object.assign(fields, setting.fields)
        await updateEntry(existingEntry.id!, {
          fields: JSON.stringify(fields),
          summary: setting.summary || existingEntry.summary,
        })
      } else {
        await addEntry({
          projectId,
          categoryId: category.id!,
          name: setting.name,
          summary: setting.summary,
          description: '',
          fields: JSON.stringify(setting.fields),
          order: codexEntries.filter(e => e.categoryId === category.id!).length,
        })
      }
    }

    setShowExtractModal(false)
    setExtractedSettings([])
    setSelectedSettings(new Set())

    setQaMessages(prev => [...prev, { role: 'assistant', content: `✅ 已将 ${toSave.length} 条设定加入系统。您可以继续提问或清空对话。` }])
  }, [extractedSettings, selectedSettings, codexCategories, codexEntries, projectId, addEntry, updateEntry])

  const renderDetail = () => {
    if (!selectedResult) return null

    if (selectedResult.type === 'codex') {
      const entry = selectedResult.data as CodexEntry
      const category = codexCategories.find(c => c.id === entry.categoryId)
      const fields = parseEntryFields(entry.fields)
      const fieldDefs = parseFieldSchema(category?.fieldSchema || '')

      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{category?.icon}</span>
            <div>
              <h3 className="font-semibold text-text-primary">{entry.name}</h3>
              <span className="text-xs text-text-muted">{category?.name}</span>
            </div>
          </div>
          {entry.summary && (
            <p className="text-sm text-text-secondary">{entry.summary}</p>
          )}
          {entry.description && (
            <div className="p-3 bg-bg-base rounded-lg text-sm text-text-secondary whitespace-pre-wrap">
              {entry.description}
            </div>
          )}
          {Object.keys(fields).length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-text-muted">详细信息</p>
              {fieldDefs.map(def => {
                const value = fields[def.key]
                if (!value) return null
                return (
                  <div key={def.key} className="flex items-start gap-2">
                    <span className="text-xs text-text-muted w-20 shrink-0">{def.label}</span>
                    <span className="text-xs text-text-secondary break-all">{value}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )
    }

    if (selectedResult.type === 'character') {
      const char = selectedResult.data as Character
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">👤</span>
            <div>
              <h3 className="font-semibold text-text-primary">{char.name}</h3>
              {char.identity && <span className="text-xs text-text-muted">身份：{char.identity}</span>}
            </div>
          </div>
          {char.shortDescription && (
            <p className="text-sm text-text-secondary">{char.shortDescription}</p>
          )}
          {char.personality && (
            <div className="p-3 bg-bg-base rounded-lg">
              <p className="text-xs text-text-muted mb-1">性格</p>
              <p className="text-sm text-text-secondary">{char.personality}</p>
            </div>
          )}
          {char.background && (
            <div className="p-3 bg-bg-base rounded-lg">
              <p className="text-xs text-text-muted mb-1">背景</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{char.background}</p>
            </div>
          )}
          {char.abilities && (
            <div className="p-3 bg-bg-base rounded-lg">
              <p className="text-xs text-text-muted mb-1">能力</p>
              <p className="text-sm text-text-secondary whitespace-pre-wrap">{char.abilities}</p>
            </div>
          )}
        </div>
      )
    }

    if (selectedResult.type === 'worldRule') {
      const data = selectedResult.data as { node: WorldRuleNodeDef; entry?: { historicalAnchors: string; fictionalAdaptations: string; priority: string } }
      return (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="text-2xl">{data.node.icon || '📜'}</span>
            <div>
              <h3 className="font-semibold text-text-primary">{data.node.label}</h3>
              <span className="text-xs text-text-muted">{selectedResult.category}</span>
            </div>
          </div>
          {data.node.hints && data.node.hints.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.node.hints.map((hint, idx) => (
                <span key={idx} className="px-2 py-0.5 text-[10px] bg-bg-base rounded text-text-muted">
                  {hint}
                </span>
              ))}
            </div>
          )}
          {data.entry && (
            <>
              {data.entry.historicalAnchors && (
                <div className="p-3 bg-bg-base rounded-lg">
                  <p className="text-xs text-text-muted mb-1">📜 取自真实</p>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{data.entry.historicalAnchors}</p>
                </div>
              )}
              {data.entry.fictionalAdaptations && (
                <div className="p-3 bg-bg-base rounded-lg">
                  <p className="text-xs text-text-muted mb-1">✨ 架空改造</p>
                  <p className="text-sm text-text-secondary whitespace-pre-wrap">{data.entry.fictionalAdaptations}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-text-muted">⚖️ 冲突时优先：</span>
                <span className={`text-xs px-2 py-0.5 rounded ${
                  data.entry.priority === 'historical' ? 'bg-blue-500/10 text-blue-400' :
                  data.entry.priority === 'fictional' ? 'bg-purple-500/10 text-purple-400' :
                  'bg-gray-500/10 text-gray-400'
                }`}>
                  {data.entry.priority === 'historical' ? '史实优先' :
                   data.entry.priority === 'fictional' ? '架空优先' : '均衡'}
                </span>
              </div>
            </>
          )}
          {!data.entry && (
            <p className="text-xs text-text-muted">暂无设定</p>
          )}
        </div>
      )
    }

    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl mx-4 bg-bg-elevated border border-border rounded-xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-medium text-text-primary">设定查询</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-bg-hover rounded transition-colors"
          >
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="p-4 border-b border-border">
          <div className="flex gap-1 mb-3">
            <button
              onClick={() => setMode('search')}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                mode === 'search'
                  ? 'bg-accent text-white'
                  : 'bg-bg-base text-text-muted hover:text-text-secondary'
              }`}
            >
              <Search className="w-3 h-3" />
              硬查询
            </button>
            <button
              onClick={() => {
                setMode('qa')
                setSelectedResult(null)
              }}
              className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                mode === 'qa'
                  ? 'bg-accent text-white'
                  : 'bg-bg-base text-text-muted hover:text-text-secondary'
              }`}
            >
              <Sparkles className="w-3 h-3" />
              AI 问答
            </button>
          </div>

          {mode === 'search' && (
            <>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="搜索武功招式、角色、地点、物品、规则..."
                  className="w-full pl-9 pr-4 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex gap-1 mt-3">
                {[
                  { key: 'all', label: '全部', icon: Hash },
                  { key: 'codex', label: '词条', icon: BookOpen },
                  { key: 'character', label: '角色', icon: Users },
                  { key: 'worldRule', label: '规则', icon: Scroll },
                ].map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setActiveTab(tab.key as typeof activeTab)
                      setSelectedResult(null)
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-colors ${
                      activeTab === tab.key
                        ? 'bg-accent text-white'
                        : 'bg-bg-base text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    <tab.icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'qa' && (
            <p className="text-[10px] text-text-muted">
              💡 AI 问答支持多轮对话讨论设定。讨论确定后，点击下方按钮一键整理并加入设定。对话历史会自动保存，关闭后重新打开仍可见。
            </p>
          )}

          </div>

        {mode === 'search' ? (
          <div className="flex h-80">
            <div className="w-1/2 border-r border-border overflow-y-auto">
              {results.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <Search className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">输入关键词搜索设定</p>
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {results.map(result => (
                    <button
                      key={`${result.type}-${result.id}`}
                      onClick={() => setSelectedResult(result)}
                      className={`w-full text-left p-2 rounded-lg transition-colors ${
                        selectedResult?.id === result.id && selectedResult?.type === result.type
                          ? 'bg-accent/10'
                          : 'hover:bg-bg-hover'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="text-lg">{result.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-text-primary truncate">{result.name}</p>
                          {result.category && (
                            <p className="text-[10px] text-text-muted">{result.category}</p>
                          )}
                          <p className="text-xs text-text-secondary truncate mt-0.5">
                            {result.summary}
                          </p>
                        </div>
                        <span className="text-[10px] text-text-muted/50">
                          {result.type === 'codex' ? '词条' : result.type === 'character' ? '角色' : '规则'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="w-1/2 overflow-y-auto p-4">
              {selectedResult ? (
                renderDetail()
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <BookOpen className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">选择一个结果查看详情</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-col h-96">
            <div ref={chatContainerRef} className="flex-1 overflow-y-auto p-4 space-y-3">
              {qaMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-text-muted">
                  <Sparkles className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-xs">输入问题让 AI 分析设定</p>
                  <p className="text-[10px] mt-1">支持多轮对话讨论设定，讨论确定后一键加入</p>
                </div>
              ) : (
                qaMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
                  >
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                      msg.role === 'user' ? 'bg-accent text-white' : 'bg-bg-base text-text-muted'
                    }`}>
                      {msg.role === 'user' ? '👤' : '🤖'}
                    </div>
                    <div className={`max-w-[70%] ${
                      msg.role === 'user' ? 'items-end' : 'items-start'
                    }`}>
                      <div className={`p-3 rounded-lg ${
                        msg.role === 'user' ? 'bg-accent text-white rounded-tr-none' : 'bg-bg-base text-text-secondary rounded-tl-none'
                      }`}>
                        <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
              {isGenerating && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-bg-base flex items-center justify-center text-xs text-text-muted">
                    🤖
                  </div>
                  <div className="p-3 bg-bg-base rounded-lg rounded-tl-none">
                    <div className="flex items-center gap-1">
                      <Loader2 className="w-4 h-4 animate-spin text-accent" />
                      <span className="text-xs text-text-muted">AI 正在分析设定...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-border space-y-3">
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleQASubmit()
                  }
                }}
                placeholder="输入问题..."
                rows={3}
                className="w-full px-4 py-2 bg-bg-base border border-border rounded-lg text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-none"
                disabled={isGenerating}
              />

              <div className="flex gap-2">
                <button
                  onClick={handleExtractSettings}
                  disabled={isExtracting || qaMessages.length === 0}
                  className="flex-1 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                >
                  <FileText className="w-3 h-3" />
                  {isExtracting ? '提取中...' : '整理并加入设定'}
                </button>
                <button
                  onClick={handleQASubmit}
                  disabled={isGenerating || !query.trim()}
                  className="px-4 py-1.5 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                >
                  {isGenerating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                  {isGenerating ? '思考中' : '发送'}
                </button>
                <button
                  onClick={() => {
                    setQaMessages([])
                    localStorage.removeItem(STORAGE_KEY)
                  }}
                  className="px-4 py-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
                >
                  清空
                </button>
              </div>
            </div>
          </div>
        )}

        {showExtractModal && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
            <div className="w-full max-w-lg mx-4 bg-bg-elevated border border-border rounded-xl shadow-xl overflow-hidden max-h-[80vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <h3 className="text-sm font-medium text-text-primary">整理设定</h3>
                <button
                  onClick={() => {
                    setShowExtractModal(false)
                    setExtractedSettings([])
                    setSelectedSettings(new Set())
                  }}
                  className="p-1 hover:bg-bg-hover rounded transition-colors"
                >
                  <X className="w-4 h-4 text-text-muted" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4">
                {isExtracting ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-muted">
                    <Loader2 className="w-8 h-8 animate-spin mb-2 opacity-50" />
                    <p className="text-xs">AI 正在分析对话提取设定...</p>
                  </div>
                ) : extractedSettings.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-text-muted">
                    <FileText className="w-8 h-8 mb-2 opacity-30" />
                    <p className="text-xs">对话中未发现需要添加的设定</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {extractedSettings.map(setting => (
                      <div
                        key={setting.id}
                        className={`p-3 rounded-lg border transition-colors ${
                          selectedSettings.has(setting.id)
                            ? 'border-accent bg-accent/5'
                            : 'border-border bg-bg-base'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <input
                                type="checkbox"
                                checked={selectedSettings.has(setting.id)}
                                onChange={(e) => {
                                  const next = new Set(selectedSettings)
                                  if (e.target.checked) {
                                    next.add(setting.id)
                                  } else {
                                    next.delete(setting.id)
                                  }
                                  setSelectedSettings(next)
                                }}
                                className="w-3 h-3 rounded border-border text-accent focus:ring-accent"
                              />
                              <span className="text-sm font-medium text-text-primary">{setting.name}</span>
                              <span className="text-[10px] text-text-muted px-1.5 py-0.5 bg-bg-hover rounded">
                                {setting.category}
                              </span>
                            </div>
                            {setting.summary && (
                              <p className="text-xs text-text-secondary mb-2">{setting.summary}</p>
                            )}
                            {Object.keys(setting.fields).length > 0 && (
                              <div className="space-y-1">
                                {Object.entries(setting.fields).map(([key, value]) => (
                                  <div key={key} className="flex items-start gap-2">
                                    <span className="text-xs text-text-muted w-16 shrink-0">{key}</span>
                                    <span className="text-xs text-text-secondary">{value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!isExtracting && extractedSettings.length > 0 && (
                <div className="flex gap-2 p-4 border-t border-border">
                  <button
                    onClick={() => {
                      setShowExtractModal(false)
                      setExtractedSettings([])
                      setSelectedSettings(new Set())
                    }}
                    className="flex-1 px-4 py-2 text-xs bg-bg-base text-text-secondary rounded-lg hover:bg-bg-hover transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveSettings}
                    disabled={selectedSettings.size === 0}
                    className="flex-1 px-4 py-2 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                  >
                    <Check className="w-3 h-3" />
                    保存 {selectedSettings.size} 条设定
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}