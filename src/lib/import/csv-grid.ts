/**
 * 032-L1-c：CSV 行列网格解析（RFC4180 有界子集，纯函数）。
 *
 * 只做"把 CSV 文本切成 rows×cols 的只读对照展示"，不做类型推断、
 * 不做语义解析、不写库、不进 AI 分块/候选/adopt。plainText 逐字不变，
 * `parseCsvGridV1` 的输入就是 `file.text()` 的原文。
 *
 * 实现范围（RFC4180 子集）：
 * - BOM 去除并记录 `bomRemoved`；
 * - 双引号包裹字段：内部 `""` 转义为单个 `"`，支持字段内逗号/CRLF/LF；
 * - 空单元格保留为 `''`；
 * - 末尾换行不产生额外空行；
 * - 引号未闭合或某行字段数与多数行不一致，记 `raggedRows`/`quoteErrors`，
 *   但不截断、不丢行、不改原始行文本。
 *
 * 无新依赖、无 IO、无副作用。
 */

export interface CsvGridV1 {
  /** 解析后的二维单元格文本，保留原单元格内容（去 BOM、去引号转义）。 */
  rows: string[][]
  /** 列数：取所有非空行的众数字段数；若各行不一致，仍记众数。 */
  columnCount: number
  /** 0-based 行号，字段数与 columnCount 不一致的行（不含末尾空行）。 */
  raggedRows: number[]
  /** 是否检测到未闭合的引号字段。 */
  quoteErrors: boolean
  /** 是否去除了 UTF-8 BOM。 */
  bomRemoved: boolean
  /** 第一行是否被判定为表头（仅有 ≥2 行且第一行字段数等于 columnCount 时才判定）。 */
  hasHeaderRow: boolean
  /** 解析输入原文，逐字保留，供调用方同源核对。 */
  rawText: string
}

/** RFC4180 有界子集解析器：状态机逐字符，不依赖 split/正则，字段内 CRLF/LF 安全。 */
export function parseCsvGridV1(text: string): CsvGridV1 {
  let bomRemoved = false
  let src = text
  if (src.length > 0 && src.charCodeAt(0) === 0xFEFF) { src = src.slice(1); bomRemoved = true }

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let quoteErrors = false
  let fieldStarted = false

  for (let i = 0; i < src.length; i++) {
    const ch = src[i] as string

    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; continue }
        inQuotes = false
        continue
      }
      field += ch
      continue
    }

    // 非引号状态
    if (ch === '"') {
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (ch === ',') {
      row.push(field)
      field = ''
      fieldStarted = false
      continue
    }
    if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldStarted = false
      continue
    }
    if (ch === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      fieldStarted = false
      continue
    }
    field += ch
    fieldStarted = true
  }

  // 末尾未闭合的引号：记录但不丢已读字段。
  if (inQuotes) {
    quoteErrors = true
    row.push(field)
    rows.push(row)
  } else if (fieldStarted || row.length > 0 || field.length > 0) {
    // 最后一个字段/行没有换行结尾时也要收尾。
    row.push(field)
    rows.push(row)
  }

  // 末尾空行（来自末尾换行）不保留为额外空行：若 rows 最后是 [''] 且原文以换行结尾，丢弃它。
  if (rows.length > 1 && rows[rows.length - 1]!.length === 1 && (rows[rows.length - 1]![0] === '') && /[\r\n]$/.test(src)) {
    rows.pop()
  }

  // 众数列数
  const counts = new Map<number, number>()
  for (const r of rows) { const n = r.length; counts.set(n, (counts.get(n) ?? 0) + 1) }
  let columnCount = 0, modeHits = 0
  for (const [n, h] of counts) if (h > modeHits || (h === modeHits && n > columnCount)) { columnCount = n; modeHits = h }

  const raggedRows: number[] = []
  for (let i = 0; i < rows.length; i++) if (rows[i]!.length !== columnCount) raggedRows.push(i)

  const hasHeaderRow = rows.length >= 2 && rows[0]!.length === columnCount

  return { rows, columnCount, raggedRows, quoteErrors, bomRemoved, hasHeaderRow, rawText: text }
}
