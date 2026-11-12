import { CheckSquare, Square } from 'lucide-react'
import type { StateCard } from '../../lib/types'
import type { ProseGatewayAssemblyV1 } from '../../lib/prose/gateway-context'
import { STATE_CATEGORY_LABELS } from '../../lib/types/state-card'

export type ContextPreviewOperation = 'generate' | 'continue' | 'review'

const OPERATION_LABELS: Record<ContextPreviewOperation, string> = {
  generate: '生成正文', continue: '续写正文', review: '评审基础材料',
}

interface Props {
  operation: ContextPreviewOperation
  assembly?: ProseGatewayAssemblyV1
  error?: string
  onOperationChange: (operation: ContextPreviewOperation) => void
  onRefresh: () => void
  stateCards: StateCard[]
  matchedIds: number[]
  extraIds: number[]
  stateListExpanded: boolean
  onToggleStateList: () => void
  onToggleStateCard: (cardId: number) => void
}

export default function ChapterContextPreview({
  operation, assembly, error, onOperationChange, onRefresh,
  stateCards, matchedIds, extraIds, stateListExpanded, onToggleStateList, onToggleStateCard,
}: Props) {
  const execution = assembly?.contextGatewayExecution
  const packet = execution?.contextPacket
  const stateIds = [...new Set(packet?.sourceRefs.filter(ref => ref.table === 'stateCards').map(ref => ref.recordId) ?? [])]
  const mandatoryDossier = execution?.retrievalTrace.mandatory.some(ref => ref.resourceKey.endsWith(':consistency-dossier'))
  return (
    <section aria-label="章节上下文预览" className="mx-6 mb-3 max-h-80 overflow-y-auto rounded-xl border border-border bg-bg-elevated p-3 text-xs text-text-muted shadow-theme-sm">
      <div className="flex items-center justify-between gap-2 mb-1">
        <label className="font-medium text-text-secondary">上下文用途
          <select aria-label="上下文预览用途" value={operation} onChange={event => onOperationChange(event.target.value as ContextPreviewOperation)} className="ml-2 rounded border border-border bg-bg-base p-1">
            {Object.entries(OPERATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <button type="button" onClick={onRefresh} className="text-accent hover:text-accent-hover">刷新预览</button>
      </div>
      <p>已保存资料的读取快照；正式执行会完成保存检查并重新冻结上下文。</p>
      {operation === 'review' && <p>此处展示评审基础材料；评审面板的本轮补充要求、审校类型和专用资料在发起评审时确定。</p>}
      {error ? <p role="alert" className="mt-2 text-warning">上下文预览失败：{error}</p>
        : !packet ? <p role="status" className="mt-2">正在读取当前章节上下文…</p>
          : <div className="mt-2" data-testid="context-preview-packet">
            <p className="font-medium text-text-secondary">{OPERATION_LABELS[operation]} · 已读取状态卡 {stateIds.length} 张</p>
            {mandatoryDossier && <p>一致性档案为必读资料，按本章时间边界纳入有效状态；整理关注卡的勾选不控制此处读取。</p>}
            <details className="mt-1">
              <summary>查看本次材料与来源</summary>
              <p className="break-all">操作：{operation} · 包哈希：<code>{packet.packetHash}</code></p>
              <p>状态卡来源 ID：{stateIds.length ? stateIds.join('、') : '无'}</p>
              <pre className="mt-1 whitespace-pre-wrap font-sans">{packet.content}</pre>
            </details>
          </div>}

      {stateCards.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border">
          <div className="flex items-center justify-between mb-1">
            <p className="font-medium text-text-secondary">本章整理关注卡（{matchedIds.length}/{stateCards.length}）</p>
            <button
              type="button"
              onClick={onToggleStateList}
              className="text-accent hover:text-accent-hover text-xs"
            >
              {stateListExpanded ? '收起关注卡' : '展开整理关注卡'}
            </button>
          </div>
          <p>仅用于本章手动整理和采纳后的章后整理。自动匹配或无匹配时的全量回退沿用现有规则，可手动追加关注卡。</p>
          {stateListExpanded && (
            <div className="space-y-1 mt-1">
              {stateCards.map(card => {
                const cardId = card.id!
                const isMatched = matchedIds.includes(cardId)
                const isExtra = extraIds.includes(cardId)
                return (
                  <div key={cardId} className="flex items-center gap-1.5 rounded px-1 py-0.5">
                    <button
                      type="button"
                      aria-label={`整理关注卡：${card.entityName}`}
                      aria-pressed={isMatched || isExtra}
                      disabled={isMatched && !isExtra}
                      onClick={() => onToggleStateCard(cardId)}
                      className="flex-shrink-0"
                    >
                      {isMatched || isExtra
                        ? <CheckSquare className="w-3.5 h-3.5 text-accent" />
                        : <Square className="w-3.5 h-3.5 text-text-muted" />}
                    </button>
                    <span>{STATE_CATEGORY_LABELS[card.category]} · {card.entityName}</span>
                    {isMatched && !isExtra && <span className="text-accent/60">规则匹配</span>}
                    {isExtra && <span className="text-warning">手动追加</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
