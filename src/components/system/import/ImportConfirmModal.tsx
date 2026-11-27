import { useMemo, useState } from 'react'
import { X, Wand2, AlertTriangle, Info, Gauge, Timer, Coins, BookOpen, ChevronDown, ChevronRight, Microscope } from 'lucide-react'
import type { ChunkPlan } from '../../../lib/import/chunker'
import type { VolumeDetectResult } from '../../../lib/import/volume-detector'
import type { WorldGroup, ReferenceAnalysisDepth } from '../../../lib/types'
import type { SameNameConflictItemV1, ReferenceDuplicateItemV1 } from '../../../lib/import/dedup'
import { REFERENCE_DUPLICATE_RULE_V1 } from '../../../lib/import/dedup'

interface Props {
  filename: string
  totalChars: number
  chunks: ChunkPlan[]
  chunkSize: number
  automaticChunking?: boolean
  onAutomaticChunkingChange?: (automatic: boolean) => void
  /** 本地检测到的分卷结构 */
  volumeDetect?: VolumeDetectResult | null
  /** 单块估算用时（秒），给总时预估用 */
  estSecondsPerChunk?: number
  worldGroups?: WorldGroup[]
  targetWorldGroupId?: number | null
  onTargetWorldGroupChange?: (id: number | null) => void
  onChunkSizeChange: (size: number) => void
  onConfirm: (target: 'project' | 'reference', targetWorldGroupId?: number | null, depth?: ReferenceAnalysisDepth) => void
  onCancel: () => void
  /** 032-L1-d：待导入条目与目标世界已有条目的同名清单（纯展示；空数组/缺省时不渲染区块） */
  sameNameConflicts?: SameNameConflictItemV1[]
  /** 032-L1-d-REFERENCE-DUP：参考路径重复/同名清单；仅在"导入项目参考"区块内展示。 */
  referenceDuplicates?: ReferenceDuplicateItemV1[]
}

/**
 * 解析前确认弹窗 —— Phase 18「事前请示」。
 *
 * 把 AI 要处理多少块、预计花多久、大概吃多少 tokens、会不会有风险
 * 一股脑摆给用户看，避免"点下按钮后啥都看不见"的黑盒感。
 */
export default function ImportConfirmModal({
  filename, totalChars, chunks, chunkSize,
  automaticChunking = false, onAutomaticChunkingChange,
  volumeDetect,
  estSecondsPerChunk = 35,
  worldGroups = [],
  targetWorldGroupId = null,
  onTargetWorldGroupChange,
  onChunkSizeChange, onConfirm, onCancel,
  sameNameConflicts,
  referenceDuplicates,
}: Props) {
  const [showStructure, setShowStructure] = useState(false)
  const [refDepth, setRefDepth] = useState<ReferenceAnalysisDepth>('quick')
  const [showExample, setShowExample] = useState(false)
  const stats = useMemo(() => {
    const totalChunks = chunks.length
    const totalSeconds = totalChunks * estSecondsPerChunk
    // 中文 token 粗估：1 字 ≈ 1 token；输入 ≈ chunkSize，输出 ≈ 3k tokens/块
    const estInputTokens = totalChars + totalChunks * 800 // prompt overhead
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
  }, [chunks, totalChars, estSecondsPerChunk])

  // 深层分析额外成本估算（浅层随解析免费,深层逐块深析:15k/块,每维 ~400 字 → ~5k 输出/块）
  const deepCost = useMemo(() => {
    const nChunks = Math.max(1, Math.ceil(totalChars / 15000))
    const inTok = nChunks * (15000 + 800)
    const outTok = nChunks * 5000
    const low = (inTok * 0.001 + outTok * 0.002) / 1000
    return { nChunks, low, high: low * 4, seconds: nChunks * estSecondsPerChunk }
  }, [totalChars, estSecondsPerChunk])
  const fmtRmb = (low: number, high: number) => `¥${low.toFixed(2)} ~ ¥${high.toFixed(2)}`

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
              {totalChars.toLocaleString()} 字符 · {automaticChunking ? '开始前自动核对分块数量' : `预计拆成 ${stats.totalChunks} 块`}
            </div>
          </div>

          <p className="text-sm text-text-secondary">
            每块解析后会保留候选供你审查。确认后才保存，可在审查前退出并恢复。
          </p>

          {/* 分卷结构检测 */}
          {volumeDetect && (volumeDetect.hasVolumes || volumeDetect.totalChapters > 0) && (
            <div className="bg-bg-base border border-border rounded-lg p-3">
              <button
                onClick={() => setShowStructure(v => !v)}
                className="flex items-center gap-2 w-full text-left"
              >
                <BookOpen className="w-3.5 h-3.5 text-accent" />
                <span className="text-xs font-medium text-text-primary flex-1">
                  📖 检测到文档结构：
                  {volumeDetect.hasVolumes
                    ? `${volumeDetect.totalVolumes} 卷 · ${volumeDetect.totalChapters} 章`
                    : `${volumeDetect.totalChapters} 章（未检测到分卷）`}
                </span>
                {showStructure
                  ? <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                  : <ChevronRight className="w-3.5 h-3.5 text-text-muted" />}
              </button>
              {showStructure && (
                <div className="mt-2 max-h-[200px] overflow-y-auto text-xs space-y-1">
                  {volumeDetect.orphanChapters.length > 0 && (
                    <div className="space-y-0.5 mb-2">
                      {volumeDetect.orphanChapters.map((ch, i) => (
                        <div key={i} className="pl-4 text-text-muted truncate">📄 {ch.title}</div>
                      ))}
                    </div>
                  )}
                  {volumeDetect.volumes.map((vol, vi) => (
                    <div key={vi}>
                      <div className="font-medium text-accent truncate">📚 {vol.title}</div>
                      {vol.chapters.map((ch, ci) => (
                        <div key={ci} className="pl-6 text-text-muted truncate">📄 {ch.title}</div>
                      ))}
                    </div>
                  ))}
                  {volumeDetect.hasVolumes && (
                    <div className="pt-1 text-text-muted italic">
                      导入时将自动创建卷→章层级大纲结构
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {onAutomaticChunkingChange && <label className="flex items-start gap-2 text-xs text-text-secondary">
            <input type="checkbox" checked={automaticChunking} onChange={event => onAutomaticChunkingChange(event.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
            <span><strong className="text-text-primary">自动分块（推荐）</strong><br />按当前连接可用容量核对完整请求，保留全部原文，优先在章节或段落之间划分。</span>
          </label>}
          {!automaticChunking && <div>
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
          </div>}

          {/* 预估卡片 */}
          {!automaticChunking && <div className="grid grid-cols-3 gap-2">
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
          </div>}

          {/* 行为说明 */}
          <div className="bg-accent/5 border border-accent/30 rounded-lg p-3 space-y-1.5 text-xs text-text-secondary leading-relaxed">
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">串行处理</strong>：每块独立解析。确认本块后，可选择继续处理下一块。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">审查后保存</strong>：解析只生成候选，确认后才写入；刷新可重新打开候选。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">词条先审后写</strong>：Codex 实体只形成带原文证据的候选，任务结束后由你逐条选择、改名或改分类，确认前不会进入词条库。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">失败处理</strong>：可以查看已保留的原答和失败信息。已有尝试的分块不会自动重发。</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Info className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
              <span><strong className="text-text-primary">跨块合并</strong>：同名内容按目标世界处理；不同名字的角色不会自动合并或删除，请由作者核对。</span>
            </div>
          </div>

          {/* 032-L1-d：同名冲突只读提示（仅当检测到同名条目时出现） */}
          {sameNameConflicts && sameNameConflicts.length > 0 && (
            <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs leading-relaxed" role="status">
              <div className="flex items-start gap-1.5 mb-1.5 text-warning">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                <span className="font-medium">检测到 {sameNameConflicts.length} 处同名条目（目标世界内已存在）</span>
              </div>
              <ul className="space-y-1 mb-2 max-h-[160px] overflow-y-auto">
                {sameNameConflicts.map((conflict, index) => (
                  <li key={`${conflict.kind}-${conflict.incomingName}-${index}`} className="text-text-secondary">
                    <span className="text-text-primary font-medium">
                      即将写入{conflict.kind === 'character' ? '角色' : '大纲'}「{conflict.incomingName}」
                    </span>
                    <span className="text-text-muted"> → 已有同名{conflict.kind === 'character' ? '角色' : '大纲'}「{conflict.existingName}」
                      {conflict.similarity != null && conflict.similarity !== 1 && `（相似度 ${Math.round(conflict.similarity * 100)}%）`}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-text-muted">
                将按既有规则处理，不会静默覆盖或删除：世界观同名字段去重后追加；同名角色合并字段内容；同名大纲挂到已有节点；异名条目一律保留不动。确认后仍可选择导入当前项目或项目参考。
              </p>
            </div>
          )}

          {/* 风险提示 */}
          <div className="bg-warning/10 border border-warning/30 rounded-lg p-3 text-xs text-warning leading-relaxed flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong>注意</strong>：浏览器会尝试在本地保存原文件。存档不可用时，可重新上传同一份文件继续。
            </span>
          </div>
        </div>

        {/* 导入目标说明 */}
        <div className="px-5 py-3 border-t border-border bg-bg-elevated/50">
          <div className="text-xs text-text-muted mb-2">作者确认后，数据将写入：</div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-bg-base border border-accent/30 rounded-lg p-2.5">
              <div className="font-medium text-accent mb-0.5">📥 导入当前项目</div>
              <div className="text-text-muted leading-relaxed">直接填入当前项目的世界观、角色、大纲等模块</div>
              {worldGroups.length > 0 && (
                <label className="block mt-2">
                  <span className="block text-[10px] text-text-muted mb-1">目标世界</span>
                  <select
                    value={targetWorldGroupId ?? ''}
                    onChange={e => onTargetWorldGroupChange?.(e.target.value ? Number(e.target.value) : null)}
                    className="w-full rounded border border-border bg-bg-surface px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent"
                  >
                    {worldGroups.map(group => (
                      <option key={group.id} value={group.id}>
                        {group.icon ? `${group.icon} ` : ''}{group.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div className="bg-bg-base border border-purple-400/30 rounded-lg p-2.5" data-target="reference">
              <div className="font-medium text-purple-400 mb-0.5">📚 导入项目参考</div>
              {/* 032-L1-d-REFERENCE-DUP：仅参考路径的重复/同名提示（只读，不改变按钮语义） */}
              {referenceDuplicates && referenceDuplicates.length > 0 && (
                <div role="status" className="mb-2 rounded border border-warning/30 bg-warning/10 p-2 text-[11px] leading-relaxed">
                  <span className="text-warning font-medium">检测到 {referenceDuplicates.length} 处重复/同名参考</span>
                  <ul className="mt-1 space-y-0.5 text-text-secondary">
                    {referenceDuplicates.map((duplicate, index) => (
                      <li key={`${duplicate.reason}-${duplicate.incomingTitle}-${index}`}>
                        {duplicate.reason === 'same-file'
                          ? <>同一原件「{duplicate.incomingTitle}」已作为参考存在{duplicate.existingTitle !== duplicate.incomingTitle ? `（${duplicate.existingTitle}）` : ''}</>
                          : <>同名参考「{duplicate.incomingTitle}」已存在{duplicate.existingTitle !== duplicate.incomingTitle ? `（${duplicate.existingTitle}）` : ''}</>}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-text-muted">{REFERENCE_DUPLICATE_RULE_V1}</p>
                </div>
              )}
              <div className="text-text-muted leading-relaxed mb-2">存入「项目参考」页面，作为创作参照，不影响当前项目。<span className="text-text-secondary">导入即做 13 维作品分析</span>，选个深度：</div>
              {/* 浅 / 深 档位 */}
              <div className="space-y-1.5">
                {([
                  { key: 'quick' as const, name: '浅层 · 快速摸底', desc: '13 维每维 50-100 字提炼，通读一遍', cost: '随解析免费（¥0 额外）', time: '' },
                  { key: 'deep' as const, name: '深层 · 拆成模板', desc: '13 维每维 300-500 字 + 原文佐证，逐块精读', cost: fmtRmb(deepCost.low, deepCost.high), time: fmtDuration(deepCost.seconds) },
                ]).map(opt => (
                  <label key={opt.key} className={`block rounded border p-1.5 cursor-pointer transition-colors ${refDepth === opt.key ? 'border-purple-400 bg-purple-400/10' : 'border-border hover:border-purple-400/40'}`}>
                    <div className="flex items-center gap-1.5">
                      <input type="radio" name="refDepth" checked={refDepth === opt.key} onChange={() => setRefDepth(opt.key)} className="accent-purple-400" />
                      <span className="text-[11px] font-medium text-text-primary">{opt.name}</span>
                    </div>
                    <div className="pl-5 text-[10px] text-text-muted leading-snug">{opt.desc}</div>
                    <div className="pl-5 text-[10px]"><span className="text-amber-400">{opt.cost}</span>{opt.time && <span className="text-text-muted"> · {opt.time}</span>}</div>
                  </label>
                ))}
              </div>
              <button onClick={() => setShowExample(v => !v)} className="mt-1.5 flex items-center gap-0.5 text-[10px] text-purple-400 hover:underline">
                <Microscope className="w-3 h-3" /> {showExample ? '收起示例' : '看示例：浅 vs 深'}
              </button>
              {showExample && (
                <div className="mt-1 text-[10px] leading-relaxed bg-bg-surface rounded p-2 space-y-1.5 border border-border">
                  <div className="text-text-muted">以《斗破苍穹》「开篇技法」维度为例：</div>
                  <div><span className="text-green-400 font-medium">浅层</span>：用"天才陨落"制造反差钩子，黄金三章走完"被退婚→发现戒指有老爷爷→立誓打脸"的闭环，憋屈感拉满又立刻给希望。</div>
                  <div><span className="text-red-400 font-medium">深层</span>：① 钩子=高起点骤跌（"斗之力三段"钉耻辱柱）；② 情绪锚点=退婚戏+金句"莫欺少年穷"；③ 金手指先断后给、踩在最绝望处；④ 三章一个压抑→释放周期；⑤ 可复用套路：落差要狠、锚点要有金句、外挂别太早给。<span className="text-text-muted">（+原文引用佐证）</span></div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer：按钮左右对齐上方卡片（导入当前项目=左，取消居中，导入项目参考=右） */}
        <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border bg-bg-base">
          <button
            onClick={() => onConfirm('project', targetWorldGroupId)}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent text-white text-sm rounded hover:bg-accent-hover"
          >
            <Wand2 className="w-4 h-4" /> 导入当前项目（{automaticChunking ? '自动分块' : `${stats.totalChunks} 块`}）
          </button>
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-text-secondary hover:bg-bg-hover rounded"
          >
            取消
          </button>
          <button
            onClick={() => onConfirm('reference', null, refDepth)}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-500/80 text-white text-sm rounded hover:bg-purple-500 transition-colors"
          >
            📚 导入项目参考 · {refDepth === 'deep' ? '深层' : '浅层'}
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
