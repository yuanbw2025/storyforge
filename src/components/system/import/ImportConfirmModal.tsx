import { useMemo } from 'react'
import { X, Wand2, AlertTriangle, Info, Gauge, Timer, Coins } from 'lucide-react'
import type { ChunkPlan } from '../../../lib/import/chunker'

interface Props {
  filename: string
  totalChars: number
  chunks: ChunkPlan[]
  chunkSize: number
  /** 单块估算用时（秒），给总时预估用 */
  estSecondsPerChunk?: number
  onChunkSizeChange: (size: number) => void
  onConfirm: (target: 'project' | 'reference') => void
  onCancel: () => void
}

/**
 * 解析前确认弹窗 —— Phase 18「事前请示」。
 *
 * 把 AI 要处理多少块、预计花多久、大概吃多少 tokens、会不会有风险
 * 一股脑摆给用户看，避免"点下按钮后啥都看不见"的黑盒感。
 */
export default function ImportConfirmModal({
  filename, totalChars, chunks, chunkSize,
  estSecondsPerChunk = 35,
  onChunkSizeChange, onConfirm, onCancel,
}: Props) {
  const stats = useMemo(() => {
    const totalChunks = chunks.length
    const totalSeconds = totalChunks * estSecondsPerChunk
    // 中文 token 粗估：1 字 ≈ 1 token；输入 ≈ chunkSize，输出 ≈ 3k tokens/块
    const estInputTokens = totalChars + totalChunks * 800 // + rolling context
    const estOutputTokens = totalChunks * 3000
    // 简单成本估算（以 Gemini 2.5 Flash ¥0.001/1K in, ¥0.002/1K out 的量级参考）
    const estRmbLow = (estInputTokens * 0.001 + estOutputTokens * 0.002) / 1000
    const estRmbHigh = estRmbLow * 4 // 给高价模型留 4x 余量
    return {
      totalChunks,
      totalSeconds,
      estInputTokens,
      estOutputTokens,
      estRmbLow,
      estRmbHigh,
    }
  }, [chunks, chunkSize, totalChars, estSecondsPerChunk])

  const fmtDuration = (sec: number) => {
    if (sec < 60) return `约 ${sec} 秒`
    if (sec < 3600) return `约 ${Math.round(sec / 60)} 分钟`
    const h = Math.floor(sec / 3600)
    const m = Math.round((sec % 3600) / 60)
    return `约 ${h} 小时 ${m} 分钟`
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-accent" />
            <h3 className="text-base font-semibold text-text-primary">
              即将开始大文档分块解析
            </h3>
          </div>
          <button onClick={onCancel} className="p-1 hover:bg-bg-hover rounded">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* 文件概览 */}
          <div className="bg-bg-base border border-border rounded-lg p-3">
            <div className="text-xs text-text-muted mb-1">文件</div>
            <div className="text-sm text-text-primary font-medium break-all">{filename}</div>
            <div className="text-xs text-text-muted mt-1">
              {totalChars.toLocaleString()} 字符 · 预计拆成 {stats.totalChunks} 块
            </div>
          </div>

          {/* chunkSize 调节 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-text-secondary flex items-center gap-1">
                <Gauge className="w-3 h-3" /> 每块字符数
              </label>
              <span className="text-xs text-accent font-mono">{chunkSize.toLocaleString()} 字 / 块</span>
            </div>
            <input
              type="range"
              min={20000}
              max={80000}
              step={5000}
              value={chunkSize}
              onChange={e => onChunkSizeChange(Number(e.target.value))}
              className="w-full accent-[var(--color-accent)]"
            />
            <div className="flex justify-between text-[10px] text-text-muted mt-1">
              <span>2 万（更稳、更慢）</span>
              <span>5 万（推荐）</span>
              <span>8 万（更快、易被截断）</span>
            </div>
          </div>

          {/* 预估卡片 */}
          <div className="grid grid-cols-3 gap-2">
            <EstCard
              icon={Timer} label="预计耗时"
              value={fmtDuration(stats.totalSeconds)}
              hint={`~${estSecondsPerChunk}s / 块 · 串行`}
            />
            <EstCard
              icon={Gauge} label="预计 Tokens"
              value={`${Math.round((stats.estInputTokens + stats.estOutputTokens) / 1000)}K`}
              hint={`输入 ${Math.round(stats.estInputTokens / 1000)}K · 输出 ${Math.round(stats.estOutputTokens / 1000)}K`}
            />
            <EstCard
              icon={Coins} label="预计费用"
              value={`¥${stats.estRmbLow.toFixed(2)} ~ ${stats.estRmbHigh.toFixed(2)}`}
              hint="因模型定价而异"
            />
          </div>

          {/* 行为说明 */}
          <div className="bg-accent/5 border border-accent/30 rounded-lg p-3 space-y-1.5 text-xs text-text-secondary leading-relaxed">
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">串行处理</strong>：每块独立调用 AI，前块解析结果作为"已识别上下文"塞给后块，保证角色不乱飞。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">即时入库</strong>：每块成功后立即写入 worldview / characters / outline 表。切到其它 Tab、刷新页面都看得到已解析部分。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">自动重试</strong>：单块失败最多自动重 3 次。仍失败的块可在结束后单独再试。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">跨块合并</strong>：每 10 块 + 终末调用一次 AI "找同名/别名"，自动合并同一角色的多条记录。</span>
            </div>
          </div>

          {/* 风险提示 */}
          <div className="bg-warn/10 border border-warn/30 rounded-lg p-3 text-xs text-warn leading-relaxed flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong>注意</strong>：页面在解析期间可切走做别的事，但<strong>不要关闭浏览器</strong>（关闭后内存中的原文会丢，下次续跑需要重新上传同文件）。
            </span>
          </div>
        </div>

        {/* 导入目标说明 */}
        <div className="px-5 py-3 border-t border-border bg-bg-elevated/50">
          <div className="text-xs text-text-muted mb-2">解析完成后，数据将写入：</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-bg-base border border-accent/30 rounded-lg p-2.5">
              <div className="font-medium text-accent mb-0.5">📥 导入当前项目</div>
              <div className="text-text-muted leading-relaxed">直接填入当前项目的世界观、角色、大纲等模块</div>
            </div>
            <div className="bg-bg-base border border-purple-400/30 rounded-lg p-2.5">
              <div className="font-medium text-purple-400 mb-0.5">📚 导入项目参考</div>
              <div className="text-text-muted leading-relaxed">存入「项目参考」页面，作为创作参照，不影响当前项目</div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-bg-base">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover rounded"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm('reference')}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-500/80 text-white text-sm rounded hover:bg-purple-500 transition-colors"
          >
            📚 导入项目参考
          </button>
          <button
            onClick={() => onConfirm('project')}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
          >
            <Wand2 className="w-4 h-4" /> 导入当前项目（{stats.totalChunks} 块）
          </button>
        </div>
      </div>
    </div>
  )
}

function EstCard({
  icon: Icon, label, value, hint,
}: {
  icon: typeof Info; label: string; value: string; hint?: string
}) {
  return (
    <div className="bg-bg-base border border-border rounded-lg p-3">
      <div className="flex items-center gap-1 text-[10px] text-text-muted mb-1">
        <Icon className="w-3 h-3" /> {label}
      </div>
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      {hint && <div className="text-[10px] text-text-muted mt-0.5">{hint}</div>}
    </div>
  )
}
