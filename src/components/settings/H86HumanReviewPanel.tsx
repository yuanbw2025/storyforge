import { useEffect, useMemo, useState } from 'react'
import { Download, Save, ShieldCheck, Trash2 } from 'lucide-react'
import {
  clearH86HumanReviewV1,
  createH86HumanReviewV1,
  exportH86HumanReviewV1,
  h86CheckpointHasCompletePairedOutputsV1,
  loadH86HumanReviewV1,
  persistH86HumanReviewV1,
  updateH86HumanReviewItemV1,
  type H86HumanCandidateReviewV1,
  type H86HumanReviewItemV1,
  type H86HumanReviewRecordV1,
} from '../../lib/evals/agent-harness/story-arc-human-review'
import type { H86CheckpointV1 } from '../../lib/evals/agent-harness/story-arc-main-path'
import { H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1 } from '../../lib/evals/agent-harness/story-arc-main-path-fixtures'
import { useDialog } from '../shared/Dialog'

type ScoreField = 'constraintFaithfulness' | 'causalCoherence' | 'specificity' | 'authorUsability'

const SCORE_FIELDS: Array<{ key: ScoreField; label: string }> = [
  { key: 'constraintFaithfulness', label: '约束遵守' },
  { key: 'causalCoherence', label: '因果连贯' },
  { key: 'specificity', label: '具体程度' },
  { key: 'authorUsability', label: '作者可用性' },
]

function downloadJson(raw: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function initialReview(output: string, review: H86HumanCandidateReviewV1 | null): H86HumanCandidateReviewV1 {
  return review ?? {
    constraintFaithfulness: 3,
    causalCoherence: 3,
    specificity: 3,
    authorUsability: 3,
    editedOutput: output,
    notes: '',
  }
}

function reviewed(item: H86HumanReviewItemV1): boolean {
  return item.reviewA != null && item.reviewB != null && item.preference != null
}

function CandidateEditor(props: {
  label: 'A' | 'B'
  output: string
  value: H86HumanCandidateReviewV1
  onChange: (value: H86HumanCandidateReviewV1) => void
}) {
  return (
    <div className="rounded-md border border-border bg-bg-base p-2">
      <h6 className="text-xs font-medium text-text-primary">候选 {props.label}</h6>
      <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-elevated p-2 text-[10px] text-text-secondary">
        {props.output}
      </pre>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {SCORE_FIELDS.map(field => (
          <label key={field.key} className="text-[10px] text-text-muted">
            {field.label}
            <select
              aria-label={`候选 ${props.label} ${field.label}`}
              value={props.value[field.key]}
              onChange={event => props.onChange({ ...props.value, [field.key]: Number(event.target.value) })}
              className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary"
            >
              {[1, 2, 3, 4, 5].map(score => <option key={score} value={score}>{score}</option>)}
            </select>
          </label>
        ))}
      </div>
      <label className="mt-2 block text-[10px] text-text-muted">
        达到可采纳状态所需修订稿
        <textarea
          aria-label={`候选 ${props.label} 修订稿`}
          value={props.value.editedOutput}
          onChange={event => props.onChange({ ...props.value, editedOutput: event.target.value })}
          className="mt-1 h-36 w-full resize-y rounded border border-border bg-bg-elevated p-2 font-mono text-[10px] text-text-secondary"
        />
      </label>
      <label className="mt-2 block text-[10px] text-text-muted">
        备注（可空）
        <textarea
          aria-label={`候选 ${props.label} 备注`}
          value={props.value.notes}
          maxLength={2_000}
          onChange={event => props.onChange({ ...props.value, notes: event.target.value })}
          className="mt-1 h-16 w-full resize-y rounded border border-border bg-bg-elevated p-2 text-[10px] text-text-secondary"
        />
      </label>
    </div>
  )
}

export default function H86HumanReviewPanel({ checkpoint }: { checkpoint: H86CheckpointV1 | null }) {
  const dialog = useDialog()
  const [record, setRecord] = useState<H86HumanReviewRecordV1 | null>(null)
  const [reviewer, setReviewer] = useState('')
  const [reviewA, setReviewA] = useState<H86HumanCandidateReviewV1>(() => initialReview('', null))
  const [reviewB, setReviewB] = useState<H86HumanCandidateReviewV1>(() => initialReview('', null))
  const [preference, setPreference] = useState<'A' | 'B' | 'tie'>('tie')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    if (checkpoint?.status !== 'completed') {
      setRecord(null)
      return () => { active = false }
    }
    void loadH86HumanReviewV1().then(value => {
      if (!active || !value) return
      if (value.checkpointHash !== checkpoint.checkpointHash) {
        setError('本机盲评记录属于另一份 H86 checkpoint；请先导出或清除旧盲评。')
        return
      }
      setRecord(value)
      setReviewer(value.reviewer)
    }).catch(cause => {
      if (active) setError(cause instanceof Error ? cause.message : String(cause))
    })
    return () => { active = false }
  }, [checkpoint?.checkpointHash, checkpoint?.status])

  const currentItem = useMemo(() => record?.items.find(item => !reviewed(item)) ?? null, [record])
  const fixture = currentItem
    ? H86_STORY_ARC_DEVELOPMENT_FIXTURES_V1.find(item => item.id === currentItem.fixtureId) ?? null
    : null
  const reviewedCount = record?.items.filter(reviewed).length ?? 0
  const canStartReview = checkpoint != null && h86CheckpointHasCompletePairedOutputsV1(checkpoint)

  useEffect(() => {
    if (!currentItem) return
    setReviewA(initialReview(currentItem.candidateA, currentItem.reviewA))
    setReviewB(initialReview(currentItem.candidateB, currentItem.reviewB))
    setPreference(currentItem.preference ?? 'tie')
  }, [currentItem])

  const start = async () => {
    if (!checkpoint || checkpoint.status !== 'completed') return
    setSaving(true)
    setError('')
    try {
      const next = await createH86HumanReviewV1({ checkpoint, reviewer })
      await persistH86HumanReviewV1(next)
      setRecord(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const saveCurrent = async () => {
    if (!record || !currentItem) return
    setSaving(true)
    setError('')
    try {
      const next = await updateH86HumanReviewItemV1({
        record,
        fixtureId: currentItem.fixtureId,
        reviewA,
        reviewB,
        preference,
      })
      await persistH86HumanReviewV1(next)
      setRecord(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  const clearReview = async () => {
    const confirmed = await dialog.confirm({
      title: '清除 H86 人工盲评？',
      message: '请先下载已完成的盲评证据。清除后不能恢复。',
      confirmText: '清除',
      cancelText: '保留',
      tone: 'danger',
    })
    if (!confirmed) return
    clearH86HumanReviewV1()
    setRecord(null)
    setReviewer('')
    setError('')
  }

  const exportReview = async () => {
    if (!record || record.status !== 'completed') return
    try {
      downloadJson(
        await exportH86HumanReviewV1(record),
        `storyforge-h86-human-review-${record.checkpointHash.slice(0, 12)}.json`,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  if (checkpoint?.status !== 'completed') return null

  return (
    <div data-testid="h86-human-review" className="mt-3 rounded-md border border-border bg-bg-base p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h5 className="flex items-center gap-1.5 text-xs font-medium text-text-primary">
            <ShieldCheck className="h-3.5 w-3.5 text-accent" />独立人工 A/B 盲评
          </h5>
          <p className="mt-1 text-[10px] text-text-muted">
            UI 仅显示候选 A/B；请由未参与实现的人类复核者评分和修订。完成前不揭示路径映射。
          </p>
        </div>
        {record && (
          <span data-testid="h86-human-progress" className="text-[10px] text-text-muted">
            {record.status === 'completed' ? '已完成' : `${reviewedCount}/6`}
          </span>
        )}
      </div>

      {!record && !canStartReview && (
        <p data-testid="h86-human-unavailable" className="mt-3 text-[11px] text-warning">
          本 checkpoint 没有 6 组成对成功输出，不能开始盲评；请先修复协议并完成新的配对运行。
        </p>
      )}

      {!record && canStartReview && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 text-[10px] text-text-muted">
            复核者标识
            <input
              data-testid="h86-reviewer"
              value={reviewer}
              maxLength={80}
              onChange={event => setReviewer(event.target.value)}
              placeholder="例如：OPC-reviewer-01"
              className="mt-1 w-full rounded border border-border bg-bg-elevated px-2 py-1.5 text-xs text-text-primary"
            />
          </label>
          <button
            type="button"
            data-testid="h86-start-human-review"
            disabled={saving || !reviewer.trim() || Boolean(error)}
            onClick={() => { void start() }}
            className="rounded bg-accent/10 px-2.5 py-1.5 text-xs text-accent disabled:opacity-40"
          >
            开始 6 例盲评
          </button>
          {error && (
            <button type="button" onClick={() => { void clearReview() }} className="inline-flex items-center gap-1 text-[10px] text-error">
              <Trash2 className="h-3 w-3" />清除旧盲评
            </button>
          )}
        </div>
      )}

      {record?.status === 'running' && currentItem && fixture && (
        <div className="mt-3" data-testid="h86-human-current-case">
          <div className="rounded-md bg-bg-elevated p-2 text-[10px] text-text-secondary">
            <p className="font-medium text-text-primary">{fixture.projectName} · {fixture.id}</p>
            <p className="mt-1">作者请求：{fixture.authorRequest}</p>
            <p className="mt-1">世界硬规则：{fixture.worldRules}</p>
            <p className="mt-1">必须满足：{fixture.requiredFacts.map(item => item.description).join('；')}</p>
            <p className="mt-1">禁止：{fixture.forbiddenFacts.join('；')}</p>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <CandidateEditor label="A" output={currentItem.candidateA} value={reviewA} onChange={setReviewA} />
            <CandidateEditor label="B" output={currentItem.candidateB} value={reviewB} onChange={setReviewB} />
          </div>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="text-[10px] text-text-muted">
              本例偏好
              <select
                aria-label="本例偏好"
                value={preference}
                onChange={event => setPreference(event.target.value as 'A' | 'B' | 'tie')}
                className="ml-2 rounded border border-border bg-bg-elevated px-2 py-1 text-xs text-text-primary"
              >
                <option value="A">候选 A</option>
                <option value="B">候选 B</option>
                <option value="tie">平局</option>
              </select>
            </label>
            <button
              type="button"
              data-testid="h86-save-human-case"
              disabled={saving || !reviewA.editedOutput.trim() || !reviewB.editedOutput.trim()}
              onClick={() => { void saveCurrent() }}
              className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-400 disabled:opacity-40"
            >
              <Save className="h-3.5 w-3.5" />保存并进入下一例
            </button>
          </div>
        </div>
      )}

      {record?.status === 'completed' && record.aggregate && record.gate && (
        <div className="mt-3" data-testid="h86-human-result">
          <p className={record.gate.passed ? 'text-[11px] text-success' : 'text-[11px] text-error'}>
            人工门：{record.gate.passed ? 'PASS' : `FAIL · ${record.gate.failures.join(', ')}`}
            {' '}· 该 development 证据仍不授权生产发布
          </p>
          <div className="mt-2 overflow-x-auto text-[10px] text-text-secondary">
            <table className="w-full text-left">
              <thead className="text-text-muted"><tr><th>揭盲路径</th><th>均分</th><th>修订率</th><th>偏好</th></tr></thead>
              <tbody>
                <tr className="border-t border-border/50">
                  <td>旧直连</td>
                  <td>{record.aggregate.legacyDirect.averageScore.toFixed(2)}</td>
                  <td>{(record.aggregate.legacyDirect.averageLineEditRatio * 100).toFixed(1)}%</td>
                  <td>{record.aggregate.legacyDirect.preferredCount}</td>
                </tr>
                <tr className="border-t border-border/50">
                  <td>Agent/Harness</td>
                  <td>{record.aggregate.agentHarness.averageScore.toFixed(2)}</td>
                  <td>{(record.aggregate.agentHarness.averageLineEditRatio * 100).toFixed(1)}%</td>
                  <td>{record.aggregate.agentHarness.preferredCount}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={() => { void exportReview() }} className="inline-flex items-center gap-1 text-[10px] text-accent">
              <Download className="h-3 w-3" />下载盲评证据
            </button>
            <button type="button" onClick={() => { void clearReview() }} className="inline-flex items-center gap-1 text-[10px] text-error">
              <Trash2 className="h-3 w-3" />清除盲评
            </button>
          </div>
        </div>
      )}

      {error && <p data-testid="h86-human-error" className="mt-2 text-[11px] text-error">{error}</p>}
    </div>
  )
}
