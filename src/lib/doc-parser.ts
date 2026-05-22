/**
 * 多格式文档文本抽取器
 *
 * 2026-05-11 增加 — 支持 txt / md / csv / pdf / docx 五种格式。
 * .doc（Word 97-2003 二进制格式）mammoth 不支持，会抛明确错误提示用户转成 .docx。
 *
 * 所有大小限制是「本地文件大小上限」，与 AI 一次处理能力无关——
 * AI 解析阶段仍会被 import-adapter 的 MAX_CHARS 再截断一次。
 */
import * as pdfjs from 'pdfjs-dist'
// Vite URL import — pdfjs 的 worker 必须走 URL 引入
// @ts-ignore - Vite 的 ?url 后缀 import TS 无法识别
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'
import mammoth from 'mammoth'

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

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
      return { text, rawChars: text.length }
    }
    case 'pdf':  return extractPdf(file)
    case 'docx': return extractDocx(file)
  }
}

async function extractPdf(file: File): Promise<ExtractResult> {
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
  return { text, rawChars: text.length, pageCount: pdf.numPages }
}

async function extractDocx(file: File): Promise<ExtractResult> {
  const buf = await file.arrayBuffer()
  // mammoth.extractRawText 返回纯文本（不带样式）
  const { value } = await mammoth.extractRawText({ arrayBuffer: buf })
  return { text: value, rawChars: value.length }
}
