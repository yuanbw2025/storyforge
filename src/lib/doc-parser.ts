/**
 * 多格式文档文本抽取器
 *
 * 2026-05-11 增加 — 支持 txt / md / csv / pdf / docx 五种格式。
 * .doc（Word 97-2003 二进制格式）mammoth 不支持，会抛明确错误提示用户转成 .docx。
 *
 * 所有大小限制是「本地文件大小上限」，与 AI 一次处理能力无关——
 * AI 解析阶段仍会被 import-adapter 的 MAX_CHARS 再截断一次。
 */
// Vite URL import — pdfjs 的 worker 必须走 URL 引入（仅 URL 字符串，不进主包）
import { parseCsvGridV1, type CsvGridV1 } from './import/csv-grid'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

// pdfjs / mammoth 体积大（~870KB）且仅在用户导入文件时才需要，改为动态导入按需加载，
// 不进首屏主包。下面在解析函数内 await import。

/** 各文件类型的本地大小限制（单位字节） */
export const FILE_SIZE_LIMITS = {
  txt:  5 * 1024 * 1024,  // 5 MB —— 纯文本，理论可更大，但粘进 textarea 浏览器会卡
  md:   5 * 1024 * 1024,  // 5 MB
  csv:  2 * 1024 * 1024,  // 2 MB
  pdf: 20 * 1024 * 1024,  // 20 MB —— pdfjs 能吃更大，但 20M 以上浏览器内抽文本很慢
  docx: 10 * 1024 * 1024, // 10 MB
} as const

export type SupportedExt = keyof typeof FILE_SIZE_LIMITS

/** 列表里面明确告诉用户 `.doc` 不行 */
export const UNSUPPORTED_EXTS = ['doc'] as const

/** 浏览器 <input accept> 字符串 */
export const ACCEPT_ATTR = '.txt,.md,.csv,.pdf,.docx'

/** 人类可读的大小说明（给 UI 用） */
export const FILE_LIMIT_HINTS: Array<{ ext: string; label: string; mb: number }> = [
  { ext: 'txt',  label: '纯文本',   mb: FILE_SIZE_LIMITS.txt  / 1024 / 1024 },
  { ext: 'md',   label: 'Markdown', mb: FILE_SIZE_LIMITS.md   / 1024 / 1024 },
  { ext: 'csv',  label: 'CSV',      mb: FILE_SIZE_LIMITS.csv  / 1024 / 1024 },
  { ext: 'pdf',  label: 'PDF',      mb: FILE_SIZE_LIMITS.pdf  / 1024 / 1024 },
  { ext: 'docx', label: 'Word',     mb: FILE_SIZE_LIMITS.docx / 1024 / 1024 },
]

export interface ExtractResult {
  text: string
  /** 源文件字符数（未截断） */
  rawChars: number
  /** 对于 PDF 会返回页数；docx 返回 undefined */
  pageCount?: number
  /** 032-L1-a：显式的文本层状态。`empty` 表示源文件给不出可复制正文
   * （扫描件 PDF／空 docx），必须由调用方拦截，不得当作解析成功继续送模型。 */
  status: ExtractStatusV1
  warnings: ExtractWarningV1[]
  /** 判定依据，供报告展示"为什么判为不可解析"，阈值与实测值同源。 */
  diagnostics: ExtractDiagnosticsV1
  /** 032-L1-c：仅 csv 扩展名且 status===ok 时填入；纯只读对照侧车，不参与 AI/adopt/persistence。 */
  csvGrid?: CsvGridV1
}

/** 032-L1-a 阈值：PDF 全篇非空白字符下限。低于此值视为"没有可复制文本层"
 * （典型：仅页脚/水印的扫描件），而不是"内容很短"。 */
export const TEXT_LAYER_MIN_TOTAL_UNITS_V1 = 32
/** 032-L1-a 阈值：单页非空白字符下限。低于此值的页记为 sparse 页，
 * 不作为空白判定的唯一依据，但会进报告，避免"有文字层却几乎读不到"。 */
export const TEXT_LAYER_SPARSE_PAGE_UNITS_V1 = 8
/** 032-L1-a 固定文案：作者侧必须看到的同一句话，不在组件里各写一份。 */
export const NO_TEXT_LAYER_NOTICE_V1 = '未识别到可复制文本，已保留原件；请另附可复制文本或人工录入'

export type ExtractStatusV1 = 'ok' | 'empty'
export type ExtractWarningV1 =
  | 'pdf-text-layer-empty' | 'pdf-text-layer-sparse'
  | 'docx-text-empty' | 'docx-text-sparse'
  | 'plain-text-empty'

export interface ExtractDiagnosticsV1 {
  /** 非空白字符数（不含空格/换行/制表）。 */
  nonWhitespaceUnits: number
  thresholdUnits: number
  /** 0-based 稀疏页序号（仅 PDF）。 */
  sparsePages: number[]
}

export function countNonWhitespaceUnitsV1(text: string): number {
  return text.replace(/\s+/g, '').length
}

/** 纯判定：把"抽出来的文本"分成 ok / empty，并给出可展示的警告。
 * 只做状态判定，不改文本、不截断、不重排。 */
export function assessExtractionQualityV1(input: {
  format: 'plain' | 'pdf' | 'docx'
  text: string
  pages?: readonly string[]
}): { status: ExtractStatusV1; warnings: ExtractWarningV1[]; diagnostics: ExtractDiagnosticsV1 } {
  const warnings: ExtractWarningV1[] = []
  if (input.format === 'pdf') {
    const pages = input.pages ?? []
    const counts = pages.map(page => countNonWhitespaceUnitsV1(page))
    const total = counts.reduce((sum, count) => sum + count, 0)
    const sparsePages = counts.flatMap((count, index) => (count < TEXT_LAYER_SPARSE_PAGE_UNITS_V1 ? [index] : []))
    // 全篇低于下限：视为没有文本层（扫描件），不当作"短文档"。
    if (total < TEXT_LAYER_MIN_TOTAL_UNITS_V1) warnings.push('pdf-text-layer-empty')
    else if (sparsePages.length) warnings.push('pdf-text-layer-sparse')
    return {
      status: total < TEXT_LAYER_MIN_TOTAL_UNITS_V1 ? 'empty' : 'ok',
      warnings,
      diagnostics: { nonWhitespaceUnits: total, thresholdUnits: TEXT_LAYER_MIN_TOTAL_UNITS_V1, sparsePages },
    }
  }
  const units = countNonWhitespaceUnitsV1(input.text)
  if (input.format === 'docx') {
    if (units === 0) warnings.push('docx-text-empty')
    else if (units < TEXT_LAYER_MIN_TOTAL_UNITS_V1) warnings.push('docx-text-sparse')
    return { status: units === 0 ? 'empty' : 'ok', warnings, diagnostics: { nonWhitespaceUnits: units, thresholdUnits: TEXT_LAYER_MIN_TOTAL_UNITS_V1, sparsePages: [] } }
  }
  // 纯文本类（txt/md/csv）：只有真的空文件才算 empty；短文本保持既有可用行为。
  if (units === 0) warnings.push('plain-text-empty')
  return { status: units === 0 ? 'empty' : 'ok', warnings, diagnostics: { nonWhitespaceUnits: units, thresholdUnits: 0, sparsePages: [] } }
}

/** 报告行：固定文案 + 文件名/大小/页数/状态，四项都来自同一次抽取。 */
export function textLayerReportLineV1(input: {
  filename: string; sizeBytes: number; pageCount?: number; status: ExtractStatusV1
}): string {
  const mb = (input.sizeBytes / 1024 / 1024).toFixed(2)
  const pages = input.pageCount == null ? '' : ` · ${input.pageCount} 页`
  const status = input.status === 'empty' ? '无可复制文本' : '可解析'
  return `${NO_TEXT_LAYER_NOTICE_V1}（文件 ${input.filename || '未命名'} · ${mb} MB${pages} · 状态 ${status}）`
}

/** 统一入口：给一个 File，返回提取到的纯文本 */
export async function extractTextFromFile(file: File): Promise<ExtractResult> {
  const extRaw = file.name.split('.').pop()?.toLowerCase() || ''

  // 明确不支持的
  if ((UNSUPPORTED_EXTS as readonly string[]).includes(extRaw)) {
    throw new Error(
      `.${extRaw} 是 Word 97-2003 二进制格式，纯前端无法解析。` +
      `请用 Word / WPS 另存为 .docx 后再上传。`,
    )
  }

  // 不认识的
  if (!(extRaw in FILE_SIZE_LIMITS)) {
    throw new Error(
      `不支持的文件格式：.${extRaw}。当前支持：${ACCEPT_ATTR}`,
    )
  }

  const ext = extRaw as SupportedExt
  const limit = FILE_SIZE_LIMITS[ext]
  if (file.size > limit) {
    const limitMB = (limit / 1024 / 1024).toFixed(1)
    const actualMB = (file.size / 1024 / 1024).toFixed(2)
    throw new Error(
      `.${ext} 文件最大 ${limitMB} MB，当前 ${actualMB} MB。` +
      `请先压缩或只截取需要的部分。`,
    )
  }

  switch (ext) {
    case 'txt':
    case 'md':
    case 'csv': {
      const text = await file.text()
      const assessment = assessExtractionQualityV1({ format: 'plain', text })
      // 文本逐字保留；只追加显式状态，不改内容与长度口径。
      const base = { text, rawChars: text.length, ...assessment }
      // 032-L1-c：仅 CSV、且文本层非 empty 时追加只读侧车；不改变 plainText/adopt/AI 链。
      if (ext === 'csv' && assessment.status === 'ok') {
        return { ...base, csvGrid: parseCsvGridV1(text) }
      }
      return base
    }
    case 'pdf':  return extractPdf(file)
    case 'docx': return extractDocx(file)
  }
}

async function extractPdf(file: File): Promise<ExtractResult> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl
  const buf = await file.arrayBuffer()
  const pdf = await pdfjs.getDocument({ data: buf }).promise
  const pages: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const line = content.items
      .map((it) => ('str' in it ? (it as { str: string }).str : ''))
      .join(' ')
    pages.push(line)
  }
  const text = pages.join('\n\n')
  // 扫描件/图片型 PDF 的文本层为空：显式标记，交给调用方拦截，不在这里造内容。
  return { text, rawChars: text.length, pageCount: pdf.numPages, ...assessExtractionQualityV1({ format: 'pdf', text, pages }) }
}

async function extractDocx(file: File): Promise<ExtractResult> {
  const mammoth = (await import('mammoth')).default
  const buf = await file.arrayBuffer()
  // mammoth.extractRawText 返回纯文本（不带样式）
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
  return { text: value, rawChars: value.length, ...assessExtractionQualityV1({ format: 'docx', text: value }) }
}
