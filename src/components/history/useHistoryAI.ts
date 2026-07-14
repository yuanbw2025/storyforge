import { useCallback, useEffect, useRef, useState } from 'react'
import type { UseAIStreamReturn } from '../../hooks/useAIStream'
import { assembleContext } from '../../lib/registry/assemble-context'
import { adopt } from '../../lib/registry/adopt'
import {
  buildHistoryAIMessages,
  buildHistoryManualContext,
  decodeHistoryAIOperation,
  encodeHistoryAIOperation,
  type HistoryAIMode,
  type HistoryAITarget,
} from '../../lib/history/ai-plan'
import { usePromptStore } from '../../stores/prompt'
import type { AIProvider } from '../../lib/types'

type HistoryAIStream = Pick<
  UseAIStreamReturn,
  'operation' | 'reset' | 'setOperation' | 'start'
>

interface Options {
  projectId: number
  worldGroupId: number | null
  provider: AIProvider
  model: string
  overview: string
  eraSystem: string
  consultAI: HistoryAIStream
  stormAI: HistoryAIStream
  reloadEvents: () => Promise<void>
  reloadKeywords: () => Promise<void>
  onError: (message: string) => void
}

export function useHistoryAI({
  projectId,
  worldGroupId,
  provider,
  model,
  overview,
  eraSystem,
  consultAI,
  stormAI,
  reloadEvents,
  reloadKeywords,
  onError,
}: Options) {
  const [consultEventId, setConsultEventId] = useState<number | null>(null)
  const [stormEventId, setStormEventId] = useState<number | null>(null)
  const [consultKeywordId, setConsultKeywordId] = useState<number | null>(null)
  const [stormKeywordId, setStormKeywordId] = useState<number | null>(null)
  const [consultPreparing, setConsultPreparing] = useState(false)
  const [stormPreparing, setStormPreparing] = useState(false)
  const requestRef = useRef<Record<HistoryAIMode, number>>({ consult: 0, storm: 0 })

  useEffect(() => {
    requestRef.current.consult += 1
    requestRef.current.storm += 1
    setConsultPreparing(false)
    setStormPreparing(false)
    setConsultEventId(null)
    setStormEventId(null)
    setConsultKeywordId(null)
    setStormKeywordId(null)
  }, [projectId, worldGroupId])

  useEffect(() => {
    const restore = (
      operation: string | null,
      setEventId: (id: number | null) => void,
      setKeywordId: (id: number | null) => void,
    ) => {
      const parsed = decodeHistoryAIOperation(operation)
      if (!parsed) {
        setEventId(null)
        setKeywordId(null)
        return
      }
      setEventId(parsed.kind === 'event' ? parsed.id : null)
      setKeywordId(parsed.kind === 'keyword' ? parsed.id : null)
    }
    restore(consultAI.operation, setConsultEventId, setConsultKeywordId)
    restore(stormAI.operation, setStormEventId, setStormKeywordId)
  }, [consultAI.operation, stormAI.operation])

  const run = useCallback(async (mode: HistoryAIMode, target: HistoryAITarget) => {
    const operation = encodeHistoryAIOperation(target)
    if (!operation) return
    const ai = mode === 'consult' ? consultAI : stormAI
    const requestId = requestRef.current[mode] + 1
    requestRef.current[mode] = requestId
    if (mode === 'consult') setConsultPreparing(true)
    else setStormPreparing(true)
    if (mode === 'consult') {
      setConsultEventId(target.kind === 'event' ? target.item.id! : null)
      setConsultKeywordId(target.kind === 'keyword' ? target.item.id! : null)
    } else {
      setStormEventId(target.kind === 'event' ? target.item.id! : null)
      setStormKeywordId(target.kind === 'keyword' ? target.item.id! : null)
    }
    ai.setOperation(operation)

    try {
      const assembled = await assembleContext({
        projectId,
        worldGroupId,
        provider,
        model,
        sourceKeys: ['worldview', 'manualText'],
        manualSourceText: buildHistoryManualContext(overview, eraSystem),
      })
      if (requestRef.current[mode] !== requestId) return
      const template = usePromptStore.getState().getActive(
        mode === 'consult' ? 'history.consult' : 'history.storm',
      )
      const messages = buildHistoryAIMessages({ mode, target, worldContext: assembled.text, template })
      if (mode === 'consult') {
        await ai.start(messages, undefined, { category: 'history.consult', projectId })
      } else {
        await ai.start(messages, undefined, { category: 'history.storm', projectId })
      }
    } catch (error) {
      if (requestRef.current[mode] !== requestId) return
      console.error('[HistoryAI] 生成失败:', error)
      ai.reset()
      onError(`历史 AI 准备失败：${error instanceof Error ? error.message : '未知错误'}。`)
    } finally {
      if (requestRef.current[mode] === requestId) {
        if (mode === 'consult') setConsultPreparing(false)
        else setStormPreparing(false)
      }
    }
  }, [consultAI, eraSystem, model, onError, overview, projectId, provider, stormAI, worldGroupId])

  const accept = useCallback(async (mode: HistoryAIMode, text: string) => {
    const eventId = mode === 'consult' ? consultEventId : stormEventId
    const keywordId = mode === 'consult' ? consultKeywordId : stormKeywordId
    const target = eventId != null ? 'historicalTimelineEvents' : 'historicalKeywords'
    const recordId = eventId ?? keywordId
    if (recordId == null) return
    const field = mode === 'consult' ? 'aiConsult' : 'aiBrainstorm'
    try {
      const result = await adopt({
        projectId,
        worldGroupId,
        target,
        recordId,
        mode: 'replace',
        data: { [field]: text },
      })
      if (result.written.length === 0) {
        onError(`历史 AI 结果未能保存：${result.skipped[0]?.reason ?? '写回校验未通过'}。`)
        return
      }
      if (eventId != null) await reloadEvents()
      else await reloadKeywords()
      if (mode === 'consult') {
        setConsultEventId(null)
        setConsultKeywordId(null)
        consultAI.reset()
      } else {
        setStormEventId(null)
        setStormKeywordId(null)
        stormAI.reset()
      }
    } catch (error) {
      console.error('[HistoryAI] 保存失败:', error)
      onError(`历史 AI 结果保存失败：${error instanceof Error ? error.message : '未知错误'}。`)
    }
  }, [consultAI, consultEventId, consultKeywordId, onError, projectId, reloadEvents, reloadKeywords, stormAI, stormEventId, stormKeywordId, worldGroupId])

  return {
    consultEventId,
    stormEventId,
    consultKeywordId,
    stormKeywordId,
    consultPreparing,
    stormPreparing,
    run,
    accept,
  }
}
