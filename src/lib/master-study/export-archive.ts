/**
 * 作品学习档案打包导出（Phase 19-b）
 *
 * 用户点「下载分析档案」时：
 *   · 收集该作品的全部分析数据（chunk analyses + chapter beats + style metrics）
 *   · 打成一个 ZIP（无压缩 store 模式）：
 *       ├─ {title}.analysis.json  ← 机器可读（原始结构）
 *       └─ {title}.report.md      ← 人读（完整五维报告 + 节奏 + 风格）
 *
 * 为避免引入 JSZip 依赖，手写最小 ZIP（stored = 不压缩）：
 *   · local file header + raw data + central directory + end-of-central-dir
 *   · CRC32 用标准多项式实现
 *
 * 文本全部 UTF-8，文件名也按 UTF-8 写（ZIP 规范 v6.3 允许 bit 11 表示 UTF-8）。
 */
import type {
  MasterWork,
  MasterChunkAnalysis,
  MasterChapterBeat,
  MasterStyleMetrics,
} from '../types'

export interface AnalysisArchivePayload {
  work: MasterWork
  chunkAnalyses: MasterChunkAnalysis[]
  chapterBeats?: MasterChapterBeat[]
  styleMetrics?: MasterStyleMetrics | null
  /** 可选：跨作品洞察里引用本作的那几条 */
  relatedInsightIds?: number[]
}

/**
 * 构造并触发浏览器下载 ZIP 档案。
 * 返回 ZIP 的 Blob（便于测试 / 其他分发用）。
 */
export function downloadAnalysisArchive(payload: AnalysisArchivePayload): Blob {
  const { work } = payload
  const safeTitle = sanitizeFilename(work.title) || `work-${work.id}`

  const json = JSON.stringify(payload, null, 2)
  const md = buildMarkdownReport(payload)
  const readme = buildReadme(payload)

  const files: ZipFile[] = [
    { name: `${safeTitle}/README.txt`,          data: new TextEncoder().encode(readme) },
    { name: `${safeTitle}/${safeTitle}.analysis.json`, data: new TextEncoder().encode(json) },
    { name: `${safeTitle}/${safeTitle}.report.md`,     data: new TextEncoder().encode(md) },
  ]

  const blob = buildZip(files)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${safeTitle}.analysis.zip`
  document.body.appendChild(a)
  a.click()
  a.remove()
  // 延迟 revoke 避免 Safari 秒拦截
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return blob
}

// ── Markdown 报告生成 ─────────────────────────────────────

function buildMarkdownReport(p: AnalysisArchivePayload): string {
  const { work, chunkAnalyses, styleMetrics, chapterBeats } = p
  const lines: string[] = []
  const depthLabel = { quick: '快速', standard: '标准', deep: '深度' }[work.analysisDepth]

  lines.push(`# 《${work.title}》 · 作品学习分析报告`)
  lines.push('')
  lines.push('> ⚠️ **法律声明**：本报告由用户在本地浏览器通过 StoryForge「作品学习」功能生成，')
  lines.push('> 仅供个人学习研究参考。原文引用片段遵循**合理使用**原则，请勿二次分发。')
  lines.push('')
  lines.push('## 作品基本信息')
  lines.push('')
  lines.push(`| 字段 | 值 |`)
  lines.push(`| ---- | --- |`)
  lines.push(`| 标题 | ${work.title} |`)
  lines.push(`| 作者 | ${work.author || '（未知）'} |`)
  lines.push(`| 流派 | ${work.genre || '（未标注）'} |`)
  lines.push(`| 总字数 | ${work.totalChars.toLocaleString()} 字 |`)
  lines.push(`| 分析深度 | ${depthLabel} |`)
  lines.push(`| 分析时间 | ${formatDate(work.updatedAt)} |`)
  lines.push(`| 分析块数 | ${chunkAnalyses.length} |`)
  lines.push('')

  // 合并五维总览
  const merged = mergeDimensions(chunkAnalyses)
  lines.push('## 五维方法论总览')
  lines.push('')
  lines.push('> 以下内容由 AI 基于全作分块分析后归纳合并。')
  lines.push('')
  for (const [label, content] of Object.entries(merged)) {
    lines.push(`### ${label}`)
    lines.push('')
    lines.push(content.trim() || '（本作暂无该维度的显著结论）')
    lines.push('')
  }

  // 章节节奏（如有）
  if (chapterBeats && chapterBeats.length > 0) {
    lines.push('## 章节节奏时间线（Layer 2）')
    lines.push('')
    lines.push('| 章节 | 位置 | 类型 | 引文 | AI 点评 |')
    lines.push('| --- | --- | --- | --- | --- |')
    for (const b of chapterBeats.slice(0, 500)) {
      lines.push(
        `| ${b.chapterLabel || `第 ${b.chapterIndex + 1} 章`} | ${b.position.toFixed(0)}% ` +
        `| ${b.type} | ${escapeTable(b.excerpt)} | ${escapeTable(b.note || '')} |`,
      )
    }
    lines.push('')
  }

  // 风格画像（如有）
  if (styleMetrics) {
    lines.push('## 风格量化画像（Layer 2）')
    lines.push('')
    lines.push(`- 平均句长：${styleMetrics.avgSentenceLength.toFixed(1)} 字`)
    lines.push(`- 段落密度：${styleMetrics.paragraphDensity.toFixed(1)} 段/千字`)
    lines.push(`- 对话占比：${(styleMetrics.dialogRatio * 100).toFixed(0)}%`)
    if (styleMetrics.descriptionRatio != null) {
      lines.push(`- 描写占比：${(styleMetrics.descriptionRatio * 100).toFixed(0)}%`)
    }
    lines.push('')
    lines.push('### 句长直方图')
    for (const [bucket, count] of Object.entries(styleMetrics.sentenceLengthHistogram)) {
      lines.push(`- \`${bucket}\`: ${count}`)
    }
    lines.push('')
    lines.push('### 高频词 Top 50')
    lines.push('')
    lines.push(styleMetrics.topWords.slice(0, 50).map(w => `\`${w.word}\`×${w.count}`).join('  '))
    lines.push('')
  }

  // 分块细节
  lines.push('## 分块细节（Layer 1）')
  lines.push('')
  for (const a of [...chunkAnalyses].sort((x, y) => x.chunkIndex - y.chunkIndex)) {
    lines.push(`### 块 ${a.chunkIndex + 1}${a.label ? ` · ${a.label}` : ''}`)
    lines.push('')
    if (a.rawExcerpt) {
      lines.push(`> ${a.rawExcerpt.replace(/\n/g, '\n> ')}`)
      lines.push('')
    }
    if (a.worldviewPattern) lines.push(`- **世界观范式**：${a.worldviewPattern}`)
    if (a.characterDesign)  lines.push(`- **角色设计手法**：${a.characterDesign}`)
    if (a.plotRhythm)       lines.push(`- **情节节奏规律**：${a.plotRhythm}`)
    if (a.foreshadowing)    lines.push(`- **伏笔与悬念**：${a.foreshadowing}`)
    if (a.proseStyle)       lines.push(`- **文笔与语言**：${a.proseStyle}`)
    lines.push('')
  }

  lines.push('---')
  lines.push('')
  lines.push(`_本报告由 StoryForge · 作品学习 生成于 ${formatDate(Date.now())}_`)
  return lines.join('\n')
}

const DIM_MAP: Array<{ key: keyof MasterChunkAnalysis; label: string }> = [
  { key: 'worldviewPattern', label: '世界观范式' },
  { key: 'characterDesign',  label: '角色设计手法' },
  { key: 'plotRhythm',       label: '情节节奏规律' },
  { key: 'foreshadowing',    label: '伏笔与悬念' },
  { key: 'proseStyle',       label: '文笔与语言' },
]

function mergeDimensions(rows: MasterChunkAnalysis[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (const d of DIM_MAP) {
    const texts = rows
      .map(r => (r[d.key] as string | undefined) || '')
      .filter(t => t && !t.includes('（本块无明显'))
    // 保留前 10 条不同条目；ai 给的就是浓缩过的，拼起来就是全书综述
    const unique: string[] = []
    for (const t of texts) {
      if (!unique.some(u => u === t || similar(u, t))) unique.push(t)
      if (unique.length >= 10) break
    }
    result[d.label] = unique.length === 0
      ? ''
      : unique.map((t, i) => `${i + 1}. ${t}`).join('\n\n')
  }
  return result
}

function similar(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 50) return false
  // 粗略重叠度：前 40 字相同就视为同一条
  return a.slice(0, 40) === b.slice(0, 40)
}

function buildReadme(p: AnalysisArchivePayload): string {
  return [
    `StoryForge · 作品学习 分析档案`,
    `================================`,
    ``,
    `作品：${p.work.title}${p.work.author ? ' — ' + p.work.author : ''}`,
    `生成时间：${formatDate(Date.now())}`,
    ``,
    `文件清单：`,
    `  · README.txt            本说明`,
    `  · *.analysis.json       完整分析数据（机器可读）`,
    `  · *.report.md           人读的五维报告（Markdown）`,
    ``,
    `法律声明：`,
    `  本档案由您在本地浏览器运行的 StoryForge 对文件进行分析得到，`,
    `  仅限个人学习研究使用。分析过程中可能引用了原文片段，`,
    `  若您计划二次分发本档案，请自行确保符合著作权法下的合理使用边界。`,
    ``,
  ].join('\n')
}

function escapeTable(s: string): string {
  return (s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 200)
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80)
}

// ──────────────────────────────────────────────────────────
// 最小 ZIP 写入器（STORE 方式，无压缩）
// ──────────────────────────────────────────────────────────

interface ZipFile {
  name: string
  data: Uint8Array
}

function buildZip(files: ZipFile[]): Blob {
  const encoder = new TextEncoder()
  const localParts: Uint8Array[] = []
  const centralParts: Uint8Array[] = []
  let offset = 0
  const now = dosDateTime(new Date())

  for (const f of files) {
    const nameBytes = encoder.encode(f.name)
    const crc = crc32(f.data)
    const size = f.data.length

    // Local file header: 30 bytes + filename
    const lfh = new Uint8Array(30 + nameBytes.length)
    const dv = new DataView(lfh.buffer)
    dv.setUint32(0, 0x04034b50, true)      // signature
    dv.setUint16(4, 20, true)              // version needed
    dv.setUint16(6, 0x0800, true)          // bit 11 = UTF-8 filename
    dv.setUint16(8, 0, true)               // method = store
    dv.setUint16(10, now.time, true)
    dv.setUint16(12, now.date, true)
    dv.setUint32(14, crc, true)
    dv.setUint32(18, size, true)           // compressed size
    dv.setUint32(22, size, true)           // uncompressed size
    dv.setUint16(26, nameBytes.length, true)
    dv.setUint16(28, 0, true)              // extra field length
    lfh.set(nameBytes, 30)
    localParts.push(lfh, f.data)

    // Central directory record
    const cdr = new Uint8Array(46 + nameBytes.length)
    const dv2 = new DataView(cdr.buffer)
    dv2.setUint32(0, 0x02014b50, true)
    dv2.setUint16(4, 20, true)             // version made by
    dv2.setUint16(6, 20, true)             // version needed
    dv2.setUint16(8, 0x0800, true)         // UTF-8 flag
    dv2.setUint16(10, 0, true)             // method
    dv2.setUint16(12, now.time, true)
    dv2.setUint16(14, now.date, true)
    dv2.setUint32(16, crc, true)
    dv2.setUint32(20, size, true)
    dv2.setUint32(24, size, true)
    dv2.setUint16(28, nameBytes.length, true)
    dv2.setUint16(30, 0, true)             // extra
    dv2.setUint16(32, 0, true)             // comment
    dv2.setUint16(34, 0, true)             // disk
    dv2.setUint16(36, 0, true)             // internal attr
    dv2.setUint32(38, 0, true)             // external attr
    dv2.setUint32(42, offset, true)        // local header offset
    cdr.set(nameBytes, 46)
    centralParts.push(cdr)

    offset += lfh.length + size
  }

  const cdSize = centralParts.reduce((s, p) => s + p.length, 0)
  const cdOffset = offset

  // End of central directory
  const eocd = new Uint8Array(22)
  const dv = new DataView(eocd.buffer)
  dv.setUint32(0, 0x06054b50, true)
  dv.setUint16(4, 0, true)                 // disk
  dv.setUint16(6, 0, true)                 // start disk
  dv.setUint16(8, files.length, true)
  dv.setUint16(10, files.length, true)
  dv.setUint32(12, cdSize, true)
  dv.setUint32(16, cdOffset, true)
  dv.setUint16(20, 0, true)                // comment length

  const all: BlobPart[] = [
    ...localParts.map(p => p as BlobPart),
    ...centralParts.map(p => p as BlobPart),
    eocd as BlobPart,
  ]
  return new Blob(all, { type: 'application/zip' })
}

function dosDateTime(d: Date) {
  const time =
    (d.getHours() << 11) |
    (d.getMinutes() << 5) |
    Math.floor(d.getSeconds() / 2)
  const date =
    ((d.getFullYear() - 1980) << 9) |
    ((d.getMonth() + 1) << 5) |
    d.getDate()
  return { time, date }
}

// ── CRC32 ─────────────────────────────────────────────────
let CRC_TABLE: Uint32Array | null = null
function getCrcTable(): Uint32Array {
  if (CRC_TABLE) return CRC_TABLE
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    }
    t[i] = c >>> 0
  }
  CRC_TABLE = t
  return t
}

function crc32(bytes: Uint8Array): number {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}
