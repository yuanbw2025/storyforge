import { useMemo, useState } from 'react'
import { Check, Loader2, MessageSquareText, Save, Sparkles, Wrench } from 'lucide-react'
import { buildStyleCalibrationPrompt } from '../../lib/ai/adapters/style-adapter'
import { resolveRequestConfig } from '../../lib/ai/client'
import { executeRegisteredAIEntryV1 } from '../../lib/agent/formal-ai-entry'
import { getAIConfigRequiredMessage, isAIConfigReady } from '../../lib/ai/config-readiness'
import {
  formatStyleCalibrationFeedback,
  formatStyleFewShotPairs,
  parseStyleCalibrationFeedback,
  parseStyleRevisionPairs,
} from '../../lib/style/style-learning'
import type { StyleCalibrationVerdict, UserStyleProfile } from '../../lib/types/user-style'
import { useAIConfigStore } from '../../stores/ai-config'
import { useUserStyleStore } from '../../stores/user-style'
import { useToast } from '../shared/Toast'

const MAX_CALIBRATION_SOURCE_CHARS = 1600

interface Props {
  projectId: number
  profile: UserStyleProfile
}

export default function StyleCalibrationPanel({ projectId, profile }: Props) {
  const aiConfig = useAIConfigStore(state => state.config)
  const captureRevisionPair = useUserStyleStore(state => state.captureRevisionPair)
  const addCalibrationFeedback = useUserStyleStore(state => state.addCalibrationFeedback)
  const toast = useToast()
  const [sourceText, setSourceText] = useState('')
  const [resultText, setResultText] = useState('')
  const [feedbackNote, setFeedbackNote] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const revisionPairs = useMemo(
    () => formatStyleFewShotPairs(parseStyleRevisionPairs(profile.revisionPairs)),
    [profile.revisionPairs],
  )
  const calibrationFeedback = useMemo(
    () => formatStyleCalibrationFeedback(parseStyleCalibrationFeedback(profile.calibrationFeedback)),
    [profile.calibrationFeedback],
  )
  const hasChangedResult = !!sourceText.trim()
    && !!resultText.trim()
    && sourceText.trim() !== resultText.trim()

  const generate = async () => {
    if (!sourceText.trim() || running) return
    const effectiveConfig = resolveRequestConfig(aiConfig, { category: 'style.calibrate' }).config
    if (!isAIConfigReady(effectiveConfig)) {
      setError(getAIConfigRequiredMessage(effectiveConfig))
      return
    }
    setRunning(true)
    setError(null)
    try {
      const messages = buildStyleCalibrationPrompt({
        profile: profile.profile,
        revisionPairs,
        calibrationFeedback,
        sourceText: sourceText.trim(),
      })
      const output = await executeRegisteredAIEntryV1('style.calibration.preview', messages, aiConfig, {
        category: 'style.calibrate',
        projectId,
      })
      if (!output.trim()) {
        setError('AI 未返回校准稿，请重试。')
        return
      }
      setResultText(output.trim())
    } catch (generateError) {
      console.error('[StyleCalibration] 生成失败:', generateError)
      setError(generateError instanceof Error ? generateError.message : '生成失败，请重试。')
    } finally {
      setRunning(false)
    }
  }

  const recordFeedback = async (verdict: StyleCalibrationVerdict) => {
    if (!resultText.trim()) return
    setError(null)
    try {
      await addCalibrationFeedback(projectId, {
        verdict,
        note: feedbackNote,
        sourceText,
        resultText,
      })
      toast.success(verdict === 'closer' ? '已记录：更接近你的风格' : '已记录：仍需调整')
    } catch (feedbackError) {
      setError(`反馈保存失败：${feedbackError instanceof Error ? feedbackError.message : String(feedbackError)}`)
    }
  }

  const savePair = async () => {
    if (!hasChangedResult) return
    setError(null)
    try {
      const pair = await captureRevisionPair(projectId, {
        chapterTitle: '互动校准样本',
        beforeText: sourceText,
        afterText: resultText,
        authorNote: feedbackNote,
      })
      if (!pair) return
      toast.success('已保存改前/改后样本；下次重新学习画像时会优先参考')
    } catch (pairError) {
      setError(`样本保存失败：${pairError instanceof Error ? pairError.message : String(pairError)}`)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-bg-surface p-4">
      <div>
        <h3 className="flex items-center gap-1.5 text-sm font-medium text-text-primary">
          <Wrench className="h-4 w-4 text-accent" /> 互动校准
        </h3>
        <p className="mt-1 text-[11px] leading-5 text-text-muted">
          用一段短文测试当前画像。AI 只改写这段文字；你确认、编辑后再保存，未确认的输出不会污染文风样本。
        </p>
      </div>

      {!profile.profile.trim() && <p className="text-xs text-text-muted">尚无已确认文风画像，本轮仅为表达试写，不代表已学到个人文风。</p>}
      <textarea
        value={sourceText}
        onChange={event => setSourceText(event.target.value.slice(0, MAX_CALIBRATION_SOURCE_CHARS))}
        rows={6}
        placeholder="粘贴一段待校准短文（最多 1600 字符）"
        className="w-full resize-y rounded border border-border bg-bg-base px-3 py-2 text-sm leading-relaxed text-text-secondary focus:border-accent focus:outline-none"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] text-text-muted">
          {sourceText.length.toLocaleString()} / {MAX_CALIBRATION_SOURCE_CHARS.toLocaleString()} 字符
        </span>
        <button
          type="button"
          onClick={() => { void generate() }}
          disabled={running || !sourceText.trim()}
          className="inline-flex items-center gap-1.5 rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> 生成中…</>
            : <><Sparkles className="h-3.5 w-3.5" /> 生成校准稿</>}
        </button>
      </div>

      {error && <p className="rounded bg-error/10 p-2 text-xs text-error">{error}</p>}

      {resultText && (
        <div className="space-y-2 border-t border-border pt-3">
          <label className="text-xs font-medium text-text-secondary" htmlFor="style-calibration-result">
            校准稿（可继续手改）
          </label>
          <textarea
            id="style-calibration-result"
            value={resultText}
            onChange={event => setResultText(event.target.value)}
            rows={7}
            className="w-full resize-y rounded border border-accent/30 bg-accent/5 px-3 py-2 text-sm leading-relaxed text-text-secondary focus:border-accent focus:outline-none"
          />
          <div className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
            <MessageSquareText className="h-3.5 w-3.5" /> 你的判断
          </div>
          <input
            value={feedbackNote}
            onChange={event => setFeedbackNote(event.target.value.slice(0, 240))}
            placeholder="可选：具体哪里像 / 哪里还不对"
            className="w-full rounded border border-border bg-bg-base px-2.5 py-1.5 text-xs text-text-secondary focus:border-accent focus:outline-none"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { void recordFeedback('closer') }}
              className="inline-flex items-center gap-1 rounded bg-success/15 px-2.5 py-1.5 text-xs font-medium text-success hover:bg-success/25"
            >
              <Check className="h-3.5 w-3.5" /> 接近我的风格
            </button>
            <button
              type="button"
              onClick={() => { void recordFeedback('needs-adjustment') }}
              className="inline-flex items-center gap-1 rounded bg-warning/15 px-2.5 py-1.5 text-xs font-medium text-warning hover:bg-warning/25"
            >
              <Wrench className="h-3.5 w-3.5" /> 仍需调整
            </button>
            <button
              type="button"
              onClick={() => { void savePair() }}
              disabled={!hasChangedResult}
              className="inline-flex items-center gap-1 rounded border border-border px-2.5 py-1.5 text-xs font-medium text-text-secondary hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" /> 保存为改稿样本
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
