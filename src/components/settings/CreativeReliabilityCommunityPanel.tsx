import { useState } from 'react'
import { Download, ExternalLink, MessageSquareText, ShieldCheck, Trash2 } from 'lucide-react'
import { downloadTextFile } from '../../lib/export/text-export'
import {
  CREATIVE_RELIABILITY_FEEDBACK_OUTCOMES_V1,
  CREATIVE_RELIABILITY_FEEDBACK_STAGES_V1,
  CREATIVE_RELIABILITY_FEEDBACK_TAGS_V1,
  clearCreativeReliabilityFeedbackV1,
  loadCreativeReliabilityFeedbackV1,
  saveCreativeReliabilityFeedbackV1,
  serializeCreativeReliabilityFeedbackV1,
  type CreativeReliabilityFeedbackOutcomeV1,
  type CreativeReliabilityFeedbackRatingV1,
  type CreativeReliabilityFeedbackStageV1,
  type CreativeReliabilityFeedbackTagV1,
} from '../../lib/feedback/creative-reliability'
import { useDialog } from '../shared/Dialog'

const STAGE_LABELS: Record<CreativeReliabilityFeedbackStageV1, string> = {
  'story-arc': '故事线',
  outline: '卷纲 / 章纲',
  'detailed-outline': '场景细纲',
  prose: '正文候选',
  'long-form': '长篇连续创作',
}

const OUTCOME_LABELS: Record<CreativeReliabilityFeedbackOutcomeV1, string> = {
  kept: '基本保留',
  edited: '修改后使用',
  discarded: '放弃使用',
}

const TAG_LABELS: Record<CreativeReliabilityFeedbackTagV1, string> = {
  irrelevant: '偏离设定',
  stalled: '剧情不推进',
  infodump: '设定堆砌',
  structure: '结构问题',
  continuity: '前后不一致',
  cost: '费用偏高',
  latency: '等待过久',
  other: '其他',
}

export default function CreativeReliabilityCommunityPanel() {
  const dialog = useDialog()
  const [stage, setStage] = useState<CreativeReliabilityFeedbackStageV1>('story-arc')
  const [outcome, setOutcome] = useState<CreativeReliabilityFeedbackOutcomeV1>('edited')
  const [rating, setRating] = useState<CreativeReliabilityFeedbackRatingV1>(3)
  const [editMinutes, setEditMinutes] = useState(15)
  const [tags, setTags] = useState<CreativeReliabilityFeedbackTagV1[]>([])
  const [recordCount, setRecordCount] = useState(() => loadCreativeReliabilityFeedbackV1().length)
  const [message, setMessage] = useState('')

  const toggleTag = (tag: CreativeReliabilityFeedbackTagV1, checked: boolean) => {
    setTags(current => checked
      ? [...current.filter(item => item !== tag), tag]
      : current.filter(item => item !== tag))
  }

  const handleSave = () => {
    try {
      const bundle = saveCreativeReliabilityFeedbackV1({
        stage,
        outcome,
        rating,
        editMinutes: Math.max(0, Math.min(10_080, Math.round(editMinutes) || 0)),
        tags,
      })
      setRecordCount(bundle.records.length)
      setMessage('已记在本机；没有调用 AI，也没有上传。')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '反馈保存失败')
    }
  }

  const handleExport = () => {
    downloadTextFile(
      serializeCreativeReliabilityFeedbackV1(),
      `storyforge-creative-feedback-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    )
    setMessage('反馈 JSON 已生成；只有你主动提交给社区后，维护者才会收到。')
  }

  const handleClear = async () => {
    const confirmed = await dialog.confirm({
      title: '清空本机创作反馈？',
      message: `将删除当前浏览器保存的 ${recordCount} 条结构化反馈。作品、候选和 AI 配置不会改变。`,
      confirmText: '清空反馈',
      cancelText: '保留',
      tone: 'danger',
    })
    if (!confirmed) return
    clearCreativeReliabilityFeedbackV1()
    setRecordCount(0)
    setMessage('本机反馈记录已清空。')
  }

  return (
    <section
      className="mt-6 max-w-2xl rounded-xl border border-border bg-bg-surface p-4"
      data-testid="creative-reliability-community"
    >
      <div className="flex items-start gap-2">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div>
          <h3 className="text-sm font-semibold text-text-primary">创作可靠性体验反馈</h3>
          <p className="mt-1 text-xs leading-5 text-text-muted">
            当前是实验性社区体验，不代表已经证明“替作者完成 80%”。真实开发集、封存集和作者盲评
            全部达到门槛前，结果只按实验性能力发布。
          </p>
        </div>
      </div>

      <div className="mt-3 rounded-lg border border-border bg-bg-base p-3 text-[11px] leading-5 text-text-muted">
        <p className="font-medium text-text-secondary">使用边界与费用</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>节省模式最多 1 次生成；均衡和精修最多“1 次生成 + 1 次定向修复”，不会隐藏第 3 次调用或自动换服务商。</li>
          <li>费用由你的服务商和模型决定；只有登记了价格才显示预计金额，否则只展示服务商返回的 token 与耗时。</li>
          <li>本地规则和机器验证只能发现结构问题，不能代替作者判断故事是否值得继续编辑。</li>
          <li>如需立即回退，可在上方任务模型路由中关闭“启用创作可靠性工程”；已有候选和已采纳内容不受影响。</li>
        </ul>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-text-secondary">
          体验环节
          <select
            value={stage}
            onChange={event => setStage(event.target.value as CreativeReliabilityFeedbackStageV1)}
            aria-label="创作反馈体验环节"
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          >
            {CREATIVE_RELIABILITY_FEEDBACK_STAGES_V1.map(value => (
              <option key={value} value={value}>{STAGE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-text-secondary">
          最终怎么处理
          <select
            value={outcome}
            onChange={event => setOutcome(event.target.value as CreativeReliabilityFeedbackOutcomeV1)}
            aria-label="创作反馈处理结果"
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          >
            {CREATIVE_RELIABILITY_FEEDBACK_OUTCOMES_V1.map(value => (
              <option key={value} value={value}>{OUTCOME_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-text-secondary">
          可用程度（1～5）
          <select
            value={rating}
            onChange={event => setRating(Number(event.target.value) as CreativeReliabilityFeedbackRatingV1)}
            aria-label="创作反馈可用程度"
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          >
            {[1, 2, 3, 4, 5].map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="text-xs text-text-secondary">
          预计还要修改多少分钟
          <input
            type="number"
            min={0}
            max={10_080}
            value={editMinutes}
            onChange={event => setEditMinutes(Number(event.target.value))}
            aria-label="创作反馈预计修改分钟"
            className="mt-1 w-full rounded border border-border bg-bg-base px-2 py-1.5 text-xs text-text-primary"
          />
        </label>
      </div>

      <fieldset className="mt-3">
        <legend className="text-xs text-text-secondary">主要问题（可多选）</legend>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1.5">
          {CREATIVE_RELIABILITY_FEEDBACK_TAGS_V1.map(tag => (
            <label key={tag} className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <input
                type="checkbox"
                checked={tags.includes(tag)}
                onChange={event => toggleTag(tag, event.target.checked)}
                aria-label={`创作反馈问题 ${TAG_LABELS[tag]}`}
              />
              {TAG_LABELS[tag]}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleSave}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          记下这次体验
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={recordCount === 0}
          className="flex items-center gap-1.5 rounded-lg bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary disabled:opacity-40"
        >
          <Download className="h-3.5 w-3.5" /> 导出反馈 JSON（{recordCount}）
        </button>
        <button
          type="button"
          onClick={() => { void handleClear() }}
          disabled={recordCount === 0}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-text-muted hover:text-red-400 disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" /> 清空本机记录
        </button>
      </div>

      <div className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
        <p className="text-[11px] leading-5 text-text-muted">
          这里不收集书名、项目 ID、正文、提示词、模型输出或 API Key，也不会自动上传。
          导出后可在
          {' '}<a
            href="https://github.com/yuanbw2025/storyforge/issues/new"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-0.5 text-accent hover:underline"
          >
            GitHub Issues <ExternalLink className="h-3 w-3" />
          </a>{' '}
          主动提交；如遇技术错误，可同时附上“数据管理 → 下载诊断信息”生成的隐私诊断包。
        </p>
      </div>
      {message && <p role="status" className="mt-2 text-[11px] text-emerald-400">{message}</p>}
    </section>
  )
}
