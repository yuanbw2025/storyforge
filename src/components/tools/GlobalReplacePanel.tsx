import { useState, useMemo, useCallback, useEffect } from 'react'
import { Search, Replace, BookOpen, Users, Scroll, Hash, Loader2, Check, GitBranch, Globe, Star, Zap } from 'lucide-react'
import { useCodexStore } from '../../stores/codex'
import { useCharacterStore } from '../../stores/character'
import { useWorldRulesStore } from '../../stores/world-rules'
import { useChapterStore } from '../../stores/chapter'
import { useStoryArcStore } from '../../stores/story-arc'
import { useWorldviewStore } from '../../stores/worldview'
import { parseEntryFields } from '../../lib/types/codex'
import { WORLD_RULE_TREE } from '../../lib/types/world-rules'
import { parseStages } from '../../lib/types/story-arc'
import { useToast } from '../shared/Toast'
import { useDialog } from '../shared/Dialog'
import type { Project } from '../../lib/types'

interface Props {
  project: Project
}

interface ReplaceMatch {
  type: 'codex' | 'character' | 'worldRule' | 'chapter' | 'storyArc' | 'worldview' | 'storyCore' | 'powerSystem'
  id: number | string
  name: string
  field?: string
  snippet: string
  category?: string
}

type SearchScope = 'all' | 'codex' | 'character' | 'worldRule' | 'chapter' | 'storyArc' | 'worldview' | 'storyCore' | 'powerSystem'

export default function GlobalReplacePanel({ project }: Props) {
  const toast = useToast()
  const dialog = useDialog()
  const { entries: codexEntries, loadAll: loadCodex, updateEntry } = useCodexStore()
  const { characters, loadAll: loadCharacters, updateCharacter } = useCharacterStore()
  const { profile: worldRulesProfile, loadProfile: loadWorldRules } = useWorldRulesStore()
  const { chapters, loadAll: loadChapters, updateChapter } = useChapterStore()
  const { arcs, loadAll: loadStoryArcs, updateArc, updateStages } = useStoryArcStore()
  const { worldview, storyCore, powerSystem, loadAll: loadWorldview, saveWorldview, saveStoryCore, savePowerSystem } = useWorldviewStore()

  // 加载所有数据
  useEffect(() => {
    loadCodex(project.id!)
    loadCharacters(project.id!)
    loadWorldRules(project.id!)
    loadChapters(project.id!)
    loadStoryArcs(project.id!)
    loadWorldview(project.id!)
  }, [project.id, loadCodex, loadCharacters, loadWorldRules, loadChapters, loadStoryArcs, loadWorldview])

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [scope, setScope] = useState<SearchScope>('all')
  const [isReplacing, setIsReplacing] = useState(false)

  const findReplaceMatches = useMemo(() => {
    if (!query.trim()) return []

    const q = query.trim().toLowerCase()
    const matches: ReplaceMatch[] = []

    const addMatch = (type: ReplaceMatch['type'], id: number | string, name: string, field: string, text: string, category?: string) => {
      const idx = text.toLowerCase().indexOf(q)
      if (idx >= 0) {
        const start = Math.max(0, idx - 20)
        const end = Math.min(text.length, idx + q.length + 20)
        const snippet = `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`
        matches.push({ type, id, name, field, snippet, category })
      }
    }

    if (scope === 'all' || scope === 'codex') {
      for (const entry of codexEntries) {
        if (entry.projectId !== project.id!) continue
        if (entry.name.toLowerCase().includes(q)) {
          addMatch('codex', entry.id!, entry.name, '名称', entry.name)
        }
        if (entry.summary && entry.summary.toLowerCase().includes(q)) {
          addMatch('codex', entry.id!, entry.name, '摘要', entry.summary)
        }
        if (entry.description && entry.description.toLowerCase().includes(q)) {
          addMatch('codex', entry.id!, entry.name, '描述', entry.description)
        }
        const fields = parseEntryFields(entry.fields)
        for (const [key, value] of Object.entries(fields)) {
          if (value && value.toLowerCase().includes(q)) {
            addMatch('codex', entry.id!, entry.name, key, value)
          }
        }
      }
    }

    if (scope === 'all' || scope === 'character') {
      for (const char of characters) {
        if (char.projectId !== project.id!) continue
        if (char.name.toLowerCase().includes(q)) {
          addMatch('character', char.id!, char.name, '名称', char.name)
        }
        if (char.identity && char.identity.toLowerCase().includes(q)) {
          addMatch('character', char.id!, char.name, '身份', char.identity)
        }
        if (char.shortDescription && char.shortDescription.toLowerCase().includes(q)) {
          addMatch('character', char.id!, char.name, '简介', char.shortDescription)
        }
        if (char.personality && char.personality.toLowerCase().includes(q)) {
          addMatch('character', char.id!, char.name, '性格', char.personality)
        }
        if (char.background && char.background.toLowerCase().includes(q)) {
          addMatch('character', char.id!, char.name, '背景', char.background)
        }
        if (char.abilities && char.abilities.toLowerCase().includes(q)) {
          addMatch('character', char.id!, char.name, '能力', char.abilities)
        }
      }
    }

    if (scope === 'all' || scope === 'worldRule') {
      const traverseRules = (nodes: typeof WORLD_RULE_TREE) => {
        for (const node of nodes) {
          const entry = worldRulesProfile?.entries[node.id]
          if (node.label.toLowerCase().includes(q)) {
            addMatch('worldRule', node.id, node.label, '规则名称', node.label)
          }
          if (entry?.historicalAnchors && entry.historicalAnchors.toLowerCase().includes(q)) {
            addMatch('worldRule', node.id, node.label, '取自真实', entry.historicalAnchors)
          }
          if (entry?.fictionalAdaptations && entry.fictionalAdaptations.toLowerCase().includes(q)) {
            addMatch('worldRule', node.id, node.label, '架空改造', entry.fictionalAdaptations)
          }
          if (node.children) {
            traverseRules(node.children)
          }
        }
      }
      traverseRules(WORLD_RULE_TREE)
    }

    if (scope === 'all' || scope === 'chapter') {
      for (const chapter of chapters) {
        if (chapter.projectId !== project.id!) continue
        if (chapter.title && chapter.title.toLowerCase().includes(q)) {
          addMatch('chapter', chapter.id!, chapter.title, '标题', chapter.title)
        }
        if (chapter.summary && chapter.summary.toLowerCase().includes(q)) {
          addMatch('chapter', chapter.id!, chapter.title, '摘要', chapter.summary)
        }
        if (chapter.content && chapter.content.toLowerCase().includes(q)) {
          addMatch('chapter', chapter.id!, chapter.title, '正文', chapter.content)
        }
      }
    }

    if (scope === 'all' || scope === 'storyArc') {
      for (const arc of arcs) {
        if (arc.projectId !== project.id!) continue
        // 搜索故事线名称
        if (arc.name.toLowerCase().includes(q)) {
          addMatch('storyArc', arc.id!, arc.name, '名称', arc.name)
        }
        // 搜索故事线描述
        if (arc.description && arc.description.toLowerCase().includes(q)) {
          addMatch('storyArc', arc.id!, arc.name, '描述', arc.description)
        }
        // 搜索各个阶段
        const stages = parseStages(arc.stages)
        for (const stage of stages) {
          if (stage.title.toLowerCase().includes(q)) {
            addMatch('storyArc', arc.id!, `${arc.name} - ${stage.title}`, '阶段标题', stage.title)
          }
          if (stage.description && stage.description.toLowerCase().includes(q)) {
            addMatch('storyArc', arc.id!, `${arc.name} - ${stage.title}`, '阶段描述', stage.description)
          }
          if (stage.turningPoint && stage.turningPoint.toLowerCase().includes(q)) {
            addMatch('storyArc', arc.id!, `${arc.name} - ${stage.title}`, '转折点', stage.turningPoint)
          }
          // 搜索关键事件
          for (let i = 0; i < stage.keyEvents.length; i++) {
            const event = stage.keyEvents[i]
            if (event.toLowerCase().includes(q)) {
              addMatch('storyArc', arc.id!, `${arc.name} - ${stage.title}`, `关键事件 ${i + 1}`, event)
            }
          }
        }
      }
    }

    // 世界观搜索
    if ((scope === 'all' || scope === 'worldview') && worldview) {
      const wvFields: [string, string][] = [
        ['地理环境', worldview.geography],
        ['历史年表', worldview.history],
        ['社会结构', worldview.society],
        ['文化宗教', worldview.culture],
        ['经济体系', worldview.economy],
        ['世界规则', worldview.rules],
        ['精华摘要', worldview.summary],
        ['世界来源', worldview.worldOrigin || ''],
        ['力量体系', worldview.powerHierarchy || ''],
        ['神明层级', worldview.divineDesign?.divineRank || ''],
        ['神明列表', worldview.divineDesign?.divineNames || ''],
        ['神明规则', worldview.divineDesign?.divineRules || ''],
        ['世界结构', worldview.worldStructure || ''],
        ['世界尺寸', worldview.worldDimensions || ''],
        ['大陆分布', worldview.continentLayout || ''],
        ['区域面积', worldview.regionDimensions || ''],
        ['山川河流', worldview.mountainsRivers || ''],
        ['分区域气候', worldview.climateByRegion || ''],
        ['自然资源概述', worldview.naturalResourceOverview || ''],
        ['珍禽异兽', worldview.naturalResources?.rareCreatures || ''],
        ['灵药草药', worldview.naturalResources?.herbs || ''],
        ['矿石', worldview.naturalResources?.minerals || ''],
        ['其他特产', worldview.naturalResources?.others || ''],
        ['世界历史线', worldview.historyLine || ''],
        ['世界大事记', worldview.worldEvents || ''],
        ['种族设定', worldview.races || ''],
        ['势力分布', worldview.factionLayout || ''],
        ['政治经济文化', worldview.politicsEconomyCulture || ''],
        ['矛盾冲突', worldview.internalConflicts || ''],
        ['道具设计', worldview.itemDesign || ''],
      ]

      for (const [fieldName, fieldValue] of wvFields) {
        if (fieldValue && fieldValue.toLowerCase().includes(q)) {
          addMatch('worldview', worldview.id || 'worldview', '世界观', fieldName, fieldValue)
        }
      }
    }

    // 故事核心搜索
    if ((scope === 'all' || scope === 'storyCore') && storyCore) {
      const scFields: [string, string][] = [
        ['主题', storyCore.theme],
        ['核心冲突', storyCore.centralConflict],
        ['情节模式', storyCore.plotPattern],
        ['故事线', storyCore.storyLines],
        ['一句话故事', storyCore.logline || ''],
        ['故事概念', storyCore.concept || ''],
        ['故事主线', storyCore.mainPlot || ''],
        ['故事副线', storyCore.subPlots || ''],
      ]

      for (const [fieldName, fieldValue] of scFields) {
        if (fieldValue && fieldValue.toLowerCase().includes(q)) {
          addMatch('storyCore', storyCore.id || 'storyCore', '故事核心', fieldName, fieldValue)
        }
      }
    }

    // 力量体系搜索
    if ((scope === 'all' || scope === 'powerSystem') && powerSystem) {
      const psFields: [string, string][] = [
        ['体系名称', powerSystem.name],
        ['体系描述', powerSystem.description],
        ['等级列表', powerSystem.levels],
        ['体系规则', powerSystem.rules],
      ]

      for (const [fieldName, fieldValue] of psFields) {
        if (fieldValue && fieldValue.toLowerCase().includes(q)) {
          addMatch('powerSystem', powerSystem.id || 'powerSystem', '力量体系', fieldName, fieldValue)
        }
      }
    }

    return matches.slice(0, 100)
  }, [query, scope, codexEntries, characters, worldRulesProfile, chapters, arcs, worldview, storyCore, powerSystem, project.id])

  const executeReplace = useCallback(async () => {
    if (!query.trim() || !replacement || findReplaceMatches.length === 0) return

    const q = query.trim()
    const escapedQ = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const replaceRegex = new RegExp(escapedQ, 'g')

    const ok = await dialog.confirm({
      title: '确认全局替换？',
      message: `将在设定库和章节中替换 ${findReplaceMatches.length} 处「${q}」为「${replacement}」。此操作不可撤销，请确保已备份。`,
      confirmText: '确认替换',
      cancelText: '取消',
      tone: 'danger',
    })
    if (!ok) return

    let replacedCount = 0
    setIsReplacing(true)

    try {
      for (const match of findReplaceMatches) {
        if (match.type === 'codex') {
          const entry = codexEntries.find(e => e.id === match.id)
          if (!entry) continue

          const updateData: Record<string, string> = {}
          if (match.field === '名称') {
            updateData.name = entry.name.replace(replaceRegex, replacement)
          } else if (match.field === '摘要') {
            updateData.summary = entry.summary.replace(replaceRegex, replacement)
          } else if (match.field === '描述') {
            updateData.description = entry.description.replace(replaceRegex, replacement)
          } else if (match.field) {
            const fields = parseEntryFields(entry.fields)
            fields[match.field] = (fields[match.field] || '').replace(replaceRegex, replacement)
            updateData.fields = JSON.stringify(fields)
          }

          if (Object.keys(updateData).length > 0) {
            await updateEntry(entry.id!, updateData)
            replacedCount++
          }
        } else if (match.type === 'character') {
          const char = characters.find(c => c.id === match.id)
          if (!char) continue

          const updateData: Record<string, string> = {}
          if (match.field === '名称') {
            updateData.name = char.name.replace(replaceRegex, replacement)
          } else if (match.field === '身份') {
            updateData.identity = (char.identity || '').replace(replaceRegex, replacement)
          } else if (match.field === '简介') {
            updateData.shortDescription = (char.shortDescription || '').replace(replaceRegex, replacement)
          } else if (match.field === '性格') {
            updateData.personality = (char.personality || '').replace(replaceRegex, replacement)
          } else if (match.field === '背景') {
            updateData.background = (char.background || '').replace(replaceRegex, replacement)
          } else if (match.field === '能力') {
            updateData.abilities = (char.abilities || '').replace(replaceRegex, replacement)
          }

          if (Object.keys(updateData).length > 0) {
            await updateCharacter(char.id!, updateData)
            replacedCount++
          }
        } else if (match.type === 'chapter') {
          const chapter = chapters.find(c => c.id === match.id)
          if (!chapter) continue

          const updateData: Record<string, string> = {}
          if (match.field === '标题') {
            updateData.title = chapter.title.replace(replaceRegex, replacement)
          } else if (match.field === '摘要' && chapter.summary) {
            updateData.summary = chapter.summary.replace(replaceRegex, replacement)
          } else if (match.field === '正文') {
            updateData.content = chapter.content.replace(replaceRegex, replacement)
          }

          if (Object.keys(updateData).length > 0) {
            await updateChapter(chapter.id!, updateData)
            replacedCount++
          }
        } else if (match.type === 'storyArc') {
          const arc = arcs.find(a => a.id === match.id)
          if (!arc) continue

          if (match.field === '名称') {
            await updateArc(arc.id!, { name: arc.name.replace(replaceRegex, replacement) })
            replacedCount++
          } else if (match.field === '描述' && arc.description) {
            await updateArc(arc.id!, { description: arc.description.replace(replaceRegex, replacement) })
            replacedCount++
          } else {
            // 处理阶段相关的替换
            const stages = parseStages(arc.stages)
            let stagesUpdated = false
            
            for (let i = 0; i < stages.length; i++) {
              const stage = stages[i]
              const stageUpdate: Partial<typeof stage> = {}
              
              if (match.field === '阶段标题') {
                const newTitle = stage.title.replace(replaceRegex, replacement)
                if (newTitle !== stage.title) {
                  stageUpdate.title = newTitle
                  stagesUpdated = true
                }
              } else if (match.field === '阶段描述' && stage.description) {
                const newDesc = stage.description.replace(replaceRegex, replacement)
                if (newDesc !== stage.description) {
                  stageUpdate.description = newDesc
                  stagesUpdated = true
                }
              } else if (match.field === '转折点' && stage.turningPoint) {
                const newTP = stage.turningPoint.replace(replaceRegex, replacement)
                if (newTP !== stage.turningPoint) {
                  stageUpdate.turningPoint = newTP
                  stagesUpdated = true
                }
              } else if (match.field?.startsWith('关键事件')) {
                const eventIndex = parseInt(match.field.split(' ')[1]) - 1
                if (eventIndex >= 0 && eventIndex < stage.keyEvents.length) {
                  const newEvent = stage.keyEvents[eventIndex].replace(replaceRegex, replacement)
                  if (newEvent !== stage.keyEvents[eventIndex]) {
                    const newEvents = [...stage.keyEvents]
                    newEvents[eventIndex] = newEvent
                    stageUpdate.keyEvents = newEvents
                    stagesUpdated = true
                  }
                }
              }
              
              if (Object.keys(stageUpdate).length > 0) {
                stages[i] = { ...stage, ...stageUpdate }
              }
            }
            
            if (stagesUpdated) {
              await updateStages(arc.id!, stages)
              replacedCount++
            }
          }
        } else if (match.type === 'worldview') {
          if (!worldview) continue

          const fieldToKey: Record<string, keyof typeof worldview> = {
            '地理环境': 'geography',
            '历史年表': 'history',
            '社会结构': 'society',
            '文化宗教': 'culture',
            '经济体系': 'economy',
            '世界规则': 'rules',
            '精华摘要': 'summary',
            '世界来源': 'worldOrigin',
            '力量体系': 'powerHierarchy',
            '世界结构': 'worldStructure',
            '世界尺寸': 'worldDimensions',
            '大陆分布': 'continentLayout',
            '区域面积': 'regionDimensions',
            '山川河流': 'mountainsRivers',
            '分区域气候': 'climateByRegion',
            '自然资源概述': 'naturalResourceOverview',
            '世界历史线': 'historyLine',
            '世界大事记': 'worldEvents',
            '种族设定': 'races',
            '势力分布': 'factionLayout',
            '政治经济文化': 'politicsEconomyCulture',
            '矛盾冲突': 'internalConflicts',
            '道具设计': 'itemDesign',
          }

          const key = fieldToKey[match.field || '']
          if (key && typeof worldview[key] === 'string') {
            const newValue = (worldview[key] as string).replace(replaceRegex, replacement)
            if (newValue !== worldview[key]) {
              await saveWorldview({ [key]: newValue })
              replacedCount++
            }
          } else if (match.field?.startsWith('神明') && worldview.divineDesign) {
            const divFields: Record<string, keyof typeof worldview.divineDesign> = {
              '神明层级': 'divineRank',
              '神明列表': 'divineNames',
              '神明规则': 'divineRules',
            }
            const divKey = divFields[match.field]
            if (divKey) {
              const newValue = (worldview.divineDesign[divKey] || '').replace(replaceRegex, replacement)
              if (newValue !== worldview.divineDesign[divKey]) {
                await saveWorldview({
                  divineDesign: { ...worldview.divineDesign, [divKey]: newValue }
                })
                replacedCount++
              }
            }
          } else if (match.field?.includes('珍禽异兽') && worldview.naturalResources) {
            const newValue = (worldview.naturalResources.rareCreatures || '').replace(replaceRegex, replacement)
            if (newValue !== worldview.naturalResources.rareCreatures) {
              await saveWorldview({
                naturalResources: { ...worldview.naturalResources, rareCreatures: newValue }
              })
              replacedCount++
            }
          } else if (match.field?.includes('灵药') && worldview.naturalResources) {
            const newValue = (worldview.naturalResources.herbs || '').replace(replaceRegex, replacement)
            if (newValue !== worldview.naturalResources.herbs) {
              await saveWorldview({
                naturalResources: { ...worldview.naturalResources, herbs: newValue }
              })
              replacedCount++
            }
          } else if (match.field?.includes('矿石') && worldview.naturalResources) {
            const newValue = (worldview.naturalResources.minerals || '').replace(replaceRegex, replacement)
            if (newValue !== worldview.naturalResources.minerals) {
              await saveWorldview({
                naturalResources: { ...worldview.naturalResources, minerals: newValue }
              })
              replacedCount++
            }
          } else if (match.field?.includes('其他特产') && worldview.naturalResources) {
            const newValue = (worldview.naturalResources.others || '').replace(replaceRegex, replacement)
            if (newValue !== worldview.naturalResources.others) {
              await saveWorldview({
                naturalResources: { ...worldview.naturalResources, others: newValue }
              })
              replacedCount++
            }
          }
        } else if (match.type === 'storyCore') {
          if (!storyCore) continue

          const fieldToKey: Record<string, keyof typeof storyCore> = {
            '主题': 'theme',
            '核心冲突': 'centralConflict',
            '情节模式': 'plotPattern',
            '故事线': 'storyLines',
            '一句话故事': 'logline',
            '故事概念': 'concept',
            '故事主线': 'mainPlot',
            '故事副线': 'subPlots',
          }

          const key = fieldToKey[match.field || '']
          if (key && typeof storyCore[key] === 'string') {
            const newValue = (storyCore[key] as string).replace(replaceRegex, replacement)
            if (newValue !== storyCore[key]) {
              await saveStoryCore({ [key]: newValue })
              replacedCount++
            }
          }
        } else if (match.type === 'powerSystem') {
          if (!powerSystem) continue

          const fieldToKey: Record<string, keyof typeof powerSystem> = {
            '体系名称': 'name',
            '体系描述': 'description',
            '等级列表': 'levels',
            '体系规则': 'rules',
          }

          const key = fieldToKey[match.field || '']
          if (key && typeof powerSystem[key] === 'string') {
            const newValue = (powerSystem[key] as string).replace(replaceRegex, replacement)
            if (newValue !== powerSystem[key]) {
              await savePowerSystem({ [key]: newValue })
              replacedCount++
            }
          }
        }
      }

      toast.success(`已替换 ${replacedCount} 处`)
      setQuery('')
      setReplacement('')
    } catch (error) {
      toast.error(`替换失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsReplacing(false)
    }
  }, [query, replacement, findReplaceMatches, codexEntries, characters, chapters, arcs, worldview, storyCore, powerSystem, updateEntry, updateCharacter, updateChapter, updateArc, updateStages, saveWorldview, saveStoryCore, savePowerSystem, dialog, toast])

  const scopeTabs = [
    { key: 'all', label: '全部', icon: Hash },
    { key: 'worldview', label: '世界观', icon: Globe },
    { key: 'storyCore', label: '故事核心', icon: Star },
    { key: 'powerSystem', label: '力量体系', icon: Zap },
    { key: 'codex', label: '设定词条', icon: BookOpen },
    { key: 'character', label: '角色', icon: Users },
    { key: 'worldRule', label: '世界规则', icon: Scroll },
    { key: 'storyArc', label: '故事线', icon: GitBranch },
    { key: 'chapter', label: '章节正文', icon: Search },
  ]

  const typeColors: Record<ReplaceMatch['type'], string> = {
    worldview: 'bg-indigo-500/10 text-indigo-400',
    storyCore: 'bg-yellow-500/10 text-yellow-400',
    powerSystem: 'bg-rose-500/10 text-rose-400',
    codex: 'bg-blue-500/10 text-blue-400',
    character: 'bg-purple-500/10 text-purple-400',
    worldRule: 'bg-green-500/10 text-green-400',
    storyArc: 'bg-cyan-500/10 text-cyan-400',
    chapter: 'bg-orange-500/10 text-orange-400',
  }

  const typeLabels: Record<ReplaceMatch['type'], string> = {
    worldview: '世界观',
    storyCore: '故事核心',
    powerSystem: '力量体系',
    codex: '词条',
    character: '角色',
    worldRule: '规则',
    storyArc: '故事线',
    chapter: '章节',
  }

  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-border">
        <h1 className="text-lg font-semibold text-text-primary mb-1">全局替换</h1>
        <p className="text-xs text-text-muted">在世界观、故事核心、力量体系、设定库和章节中查找并替换内容。</p>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div className="col-span-2 space-y-1">
            <label className="text-xs text-text-muted">查找</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="输入要查找的内容"
                className="w-full pl-10 pr-4 py-3 bg-bg-base border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs text-text-muted">替换为</label>
            <div className="relative">
              <Replace className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={replacement}
                onChange={e => setReplacement(e.target.value)}
                placeholder="替换内容"
                className="w-full pl-10 pr-4 py-3 bg-bg-base border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-6">
          {scopeTabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setScope(tab.key as SearchScope)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg transition-colors ${
                scope === tab.key
                  ? 'bg-accent text-white'
                  : 'bg-bg-base text-text-muted hover:text-text-secondary'
              }`}
            >
              <tab.icon className="w-3 h-3" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between mb-4">
          <span className="text-xs text-text-muted">
            共找到 <span className="font-medium text-accent">{findReplaceMatches.length}</span> 处命中
          </span>
          {findReplaceMatches.length > 0 && (
            <button
              onClick={executeReplace}
              disabled={isReplacing || !query.trim() || !replacement}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs bg-accent text-white rounded-lg hover:bg-accent/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isReplacing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              {isReplacing ? '替换中...' : '执行替换'}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-base rounded-xl border border-border">
          {findReplaceMatches.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-text-muted">
              <Search className="w-12 h-12 mb-3 opacity-20" />
              <p className="text-sm">输入查找内容开始搜索</p>
              <p className="text-xs mt-1">支持在世界观、故事核心、力量体系、词条、角色、规则和章节中搜索</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              {findReplaceMatches.map((match, idx) => (
                <div
                  key={idx}
                  className="p-4 bg-bg-elevated rounded-lg border border-border hover:border-accent/30 transition-colors"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-0.5 rounded ${typeColors[match.type]}`}>
                      {typeLabels[match.type]}
                    </span>
                    <span className="text-sm font-medium text-text-primary">{match.name}</span>
                    {match.field && (
                      <span className="text-xs text-text-muted">· {match.field}</span>
                    )}
                    {match.category && (
                      <span className="text-xs text-text-muted/60">· {match.category}</span>
                    )}
                  </div>
                  <p className="text-xs text-text-secondary" dangerouslySetInnerHTML={{
                    __html: match.snippet.replace(new RegExp(query, 'gi'), (matchText: string) => (
                      `<span class="bg-accent/20 text-accent font-medium px-0.5 rounded">${matchText}</span>`
                    ))
                  }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}