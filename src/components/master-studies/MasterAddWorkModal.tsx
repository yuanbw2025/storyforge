import { useMemo, useRef, useState } from 'react'
import {
  X, Upload, FileText, AlertTriangle, Sparkles, Loader2,
  Wand2, Info,
} from 'lucide-react'
import {
  extractTextFromFile, ACCEPT_ATTR, FILE_LIMIT_HINTS,
} from '../../lib/doc-parser'
import {
  planMasterChunks,
  registerMasterChunks,
  runMasterAnalysis,
} from '../../lib/master-study/pipeline'
import { useMasterStudyStore } from '../../stores/master-study'
import type { MasterAnalysisDepth } from '../../lib/types/master-study'

interface Props {
  /** 可选：当前项目 id（null = 全局学习库） */
  projectId?: number | null
  onClose: () => void
  /** 创建成功（分析已启动）时回调，带回新作品 id */
  onStarted: (workId: number) => void
}

const DEPTH_OPTIONS: Array<{
  value: MasterAnalysisDepth
  label: string
  desc: string
  badge: string
}> = [
  {
    value: 'quick',
    label: '快速',
    desc: '大块切分（≈4 万字/块），调用次数少，适合先看个大概',
    badge: '省 token',
  },
  {
    value: 'standard',
    label: '标准',
    desc: '推荐档位（≈2.5 万字/块），方法论提炼与成本平衡',
    badge: '推荐',
  },
  {
    value: 'deep',
    label: '深度',
    desc: '细粒度切分（≈1.5 万字/块），每块更长的 maxTokens，提炼更细',
    badge: '细致',
  },
]

/**
 * 作品学习 · 添加作品 Modal（Phase 19-b）
 *
 * 流程：
 *   1. 选文件 → doc-parser 抽文本
 *   2. 填标题 / 作者 / 流派 + 选分析深度
 *   3. 实时预览：按深度会切成多少块 → 预估 AI 调用次数
 *   4. 确认 → createWork + registerMasterChunks + 启动 runMasterAnalysis
 *      （不 await，让列表 UI 立刻跑 progress 条）
 */
export default function MasterAddWorkModal({ projectId, onClose, onStarted }: Props) {
  const { createWork } = useMasterStudyStore()

  const [filename, setFilename] = useState('')
  const [rawText, setRawText] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [extractInfo, setExtractInfo] = useState<string | null>(null)

  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [genre, setGenre] = useState('')
  const [depth, setDepth] = useState<MasterAnalysisDepth>('standard')

  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement>(null)

  // 分块预览
  const preview = useMemo(() => {
    if (!rawText.trim()) return null
    try {
      return planMasterChunks(rawText, depth)
    } catch {
      return null
    }
  }, [rawText, depth])

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setFileError(null)
    setExtractInfo(null)
    setFilename(f.name)
    setRawText('')
    setLoadingFile(true)
    try {
      const result = await extractTextFromFile(f)
      setRawText(result.text)
      const sizeMB = (f.size / 1024 / 1024).toFixed(2)
      const parts = [
        `文件 ${sizeMB} MB`,
        `抽取 ${result.rawChars.toLocaleString()} 字符`,
      ]
      if (result.pageCount) parts.push(`${result.pageCount} 页`)
      setExtractInfo(parts.join(' · '))
      // 自动用文件名作为默认标题（去扩展名）
      if (!title.trim()) {
        const base = f.name.replace(/\.[^.]+$/, '')
        setTitle(base)
      }
    } catch (err) {
      setFilename('')
      setFileError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingFile(false)
    }
  }

  const canSubmit =
    !submitting &&
    !loadingFile &&
    rawText.trim().length > 200 &&
    title.trim().length > 0 &&
    preview !== null &&
    preview.chunks.length > 0

  const handleSubmit = async () => {
    if (!canSubmit || !preview) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const workId = await createWork({
        projectId: projectId ?? null,
        title: title.trim(),
        author: author.trim() || undefined,
        genre: genre.trim() || undefined,
        totalChars: preview.totalChars,
        analysisDepth: depth,
        status: 'pending',
        fileHash: preview.fileHash,
        progress: 0,
      })
      // 把分块原文注册进内存（pipeline 会用）
      registerMasterChunks(workId, preview.chunks)
      // 立即启动分析（不 await，让父级 UI 先拿到 workId 跳转）
      runMasterAnalysis({ workId }).catch(err => {
        console.error('[master] runMasterAnalysis 崩了：', err)
      })
      onStarted(workId)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">添加作品 · 五维分析</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Step 1：上传文件 */}
          <section>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-text-secondary">① 上传作品文件</label>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={loadingFile}
                className={`flex items-center gap-1 px-2 py-1 text-xs rounded ${
                  loadingFile
                    ? 'text-text-muted bg-bg-hover'
                    : 'text-accent hover:bg-accent/10'
                }`}
              >
                {loadingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
                {loadingFile ? '正在提取…' : '选择文件'}
              </button>
              <input
                ref={inputRef}
                type="file"
                accept={ACCEPT_ATTR}
                disabled={loadingFile}
                className="hidden"
                onChange={handleFile}
              />
            </div>

            {!filename && !fileError && (
              <div className="rounded-lg border border-dashed border-border bg-bg-elevated/30 px-3 py-3 text-xs text-text-muted">
                <div className="flex items-center gap-1.5 mb-1.5 text-text-primary">
                  <Info className="w-3.5 h-3.5 text-accent" />
                  <span className="font-medium">支持格式</span>
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {FILE_LIMIT_HINTS.map(h => (
                    <div key={h.ext} className="text-center px-1.5 py-1 bg-bg-base rounded">
                      <div className="text-xs font-mono text-accent">.{h.ext}</div>
                      <div className="text-[10px]">{h.label} ≤ {h.mb}M</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {fileError && (
              <div className="px-2 py-1.5 bg-error/10 border border-error/30 rounded text-xs text-error flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {fileError}
              </div>
            )}

            {filename && !fileError && (
              <div className="px-2.5 py-2 bg-bg-elevated rounded border border-border/60">
                <p className="text-xs text-text-primary flex items-center gap-1">
                  <FileText className="w-3 h-3 text-accent" /> {filename}
                </p>
                {extractInfo && (
                  <p className="text-[11px] text-text-muted mt-0.5">{extractInfo}</p>
                )}
              </div>
            )}
          </section>

          {/* Step 2：元信息 */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-text-secondary">② 作品信息</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="标题（必填，如「庆余年」）"
              className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={author}
                onChange={e => setAuthor(e.target.value)}
                placeholder="作者（可选）"
                className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              />
              <input
                type="text"
                value={genre}
                onChange={e => setGenre(e.target.value)}
                placeholder="流派（可选，如「仙侠」）"
                className="w-full px-3 py-2 bg-bg-base border border-border rounded text-sm text-text-primary focus:outline-none focus:border-accent"
              />
            </div>
          </section>

          {/* Step 3：分析深度 */}
          <section>
            <label className="text-xs font-medium text-text-secondary block mb-1.5">
              ③ 分析深度
            </label>
            <div className="grid grid-cols-3 gap-2">
              {DEPTH_OPTIONS.map(opt => {
                const active = depth === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDepth(opt.value)}
                    className={`text-left px-3 py-2.5 rounded-lg border transition ${
                      active
                        ? 'border-accent bg-accent/10'
                        : 'border-border bg-bg-base hover:border-accent/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-sm font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                        {opt.label}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-elevated text-text-muted">
                        {opt.badge}
                      </span>
                    </div>
                    <p className="text-[11px] text-text-muted leading-snug">{opt.desc}</p>
                  </button>
                )
              })}
            </div>
          </section>

          {/* Step 4：预览 */}
          {preview && (
            <section className="rounded-lg border border-accent/30 bg-accent/5 px-3 py-2.5 text-xs text-text-secondary">
              <div className="flex items-center gap-1.5 mb-1 text-text-primary">
                <Wand2 className="w-3.5 h-3.5 text-accent" />
                <span className="font-medium">分析计划</span>
              </div>
              <ul className="space-y-0.5 pl-4 list-disc">
                <li>
                  共 <strong className="text-accent">{preview.totalChars.toLocaleString()}</strong> 字 ·
                  将切为 <strong className="text-accent">{preview.chunks.length}</strong> 块
                </li>
                <li>
                  预计调用 AI <strong>{preview.chunks.length}</strong> 次（每块一次，最多重试 3 次）
                </li>
                <li>文件指纹：<span className="font-mono text-text-muted">{preview.fileHash}</span></li>
              </ul>
            </section>
          )}

          {submitError && (
            <div className="px-2 py-1.5 bg-error/10 border border-error/30 rounded text-xs text-error flex items-start gap-1.5">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" /> {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-bg-elevated/30">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:bg-bg-hover"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> 创建中…
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" /> 开始分析
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
