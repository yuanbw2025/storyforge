import type JSZip from 'jszip'

/** Read-only XLSX v1 projection. Coordinates replace a dense grid, so even XFD1048576
 * does not allocate a million rows. No formula, external relationship or HTML executes. */
export const XLSX_MAX_FILE_BYTES_V1 = 10 * 1024 * 1024
const MAX_EXPANDED = 32 * 1024 * 1024
const MAX_PART = 16 * 1024 * 1024
const MAX_CELLS = 200_000
const MAIN = ['http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'http://purl.oclc.org/ooxml/spreadsheetml/main']
const REL = ['http://schemas.openxmlformats.org/officeDocument/2006/relationships/', 'http://purl.oclc.org/ooxml/officeDocument/relationships/']
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships'
const NOTICE = 'XLSX：保留工作表、单元格坐标和合并区域；公式仅保留原式与缓存值，不重新计算。数值与日期保留底层原值和样式编号；图片、图表、批注及排版未提取，请对照原件。'
type Entry = { size: number; crc: number }

function invalid(detail: string): never { throw new Error(`XLSX 无法完整解析：${detail}；原文件未改动，请在 Excel / WPS 修复或另存后重试。`) }
function safePath(path: string) {
  return path.length > 0 && !/[\\\u0000]/.test(path) && !path.startsWith('/')
    && path.split('/').every(part => part !== '..' && part !== '.')
}

/** Inspect the directory before inflating anything; also enforce the real streamed size. */
function inspectArchive(bytes: ArrayBuffer): Map<string, Entry> {
  const view = new DataView(bytes)
  let end = -1
  for (let at = view.byteLength - 22; at >= Math.max(0, view.byteLength - 65557); at--) {
    if (view.getUint32(at, true) === 0x06054b50 && at + 22 + view.getUint16(at + 20, true) === view.byteLength) { end = at; break }
  }
  if (end < 0 || view.getUint16(end + 4, true) || view.getUint16(end + 6, true)) invalid('不是无加密的单卷 XLSX')
  const count = view.getUint16(end + 10, true)
  if (!count || count > 4096 || count !== view.getUint16(end + 8, true)) invalid('文件目录数量不受支持')
  let at = view.getUint32(end + 16, true), total = 0
  const directoryEnd = at + view.getUint32(end + 12, true)
  if (directoryEnd !== end) invalid('不支持 ZIP64 或损坏的文件目录')
  const entries = new Map<string, Entry>()
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || view.getUint32(at, true) !== 0x02014b50) invalid('文件目录损坏')
    const method = view.getUint16(at + 10, true), flags = view.getUint16(at + 8, true)
    if ((flags & 0x41) || ![0, 8].includes(method) || view.getUint16(at + 34, true)) invalid('加密、分卷或压缩方式不受支持')
    const size = view.getUint32(at + 24, true), compressed = view.getUint32(at + 20, true)
    const nameSize = view.getUint16(at + 28, true)
    const next = at + 46 + nameSize + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
    if (next > end || !nameSize) invalid('文件名目录越界')
    const name = new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes, at + 46, nameSize))
    if (!safePath(name) || entries.has(name)) invalid('文件路径无效或重名')
    const local = view.getUint32(at + 42, true)
    if (local + 30 > view.getUint32(end + 16, true) || view.getUint32(local, true) !== 0x04034b50
      || local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true) + compressed > view.getUint32(end + 16, true)) invalid('文件内容越界')
    total += size
    if (size > MAX_PART || total > MAX_EXPANDED) invalid('展开内容超过本地上限（单文件 16 MB / 总计 32 MB），未截取部分内容')
    entries.set(name, { size, crc: view.getUint32(at + 16, true) })
    at = next
  }
  if (at !== directoryEnd) invalid('文件目录长度不一致')
  return entries
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  let crc = n
  for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  return crc >>> 0
})
async function readPart(zip: JSZip, entries: Map<string, Entry>, path: string, signal?: AbortSignal): Promise<Document> {
  signal?.throwIfAborted()
  const entry = entries.get(path), file = zip.file(path)
  if (!entry || !file) invalid(`缺少文件 ${path}`)
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    // Documented JSZip API; JSZip's bundled ZipObject declaration omits this method.
    const stream = (file as typeof file & { internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array> }).internalStream('uint8array')
    const chunks: Uint8Array[] = []
    let size = 0, crc = 0xffffffff, settled = false
    const fail = (error: unknown) => { if (settled) return; settled = true; stream.pause(); signal?.removeEventListener('abort', abort); reject(error) }
    const abort = () => fail(signal?.reason ?? new DOMException('已取消文件读取', 'AbortError'))
    signal?.addEventListener('abort', abort, { once: true })
    stream.on('data', chunk => {
      if (settled) return
      size += chunk.length
      if (size > entry.size || size > MAX_PART) { fail(new Error('XLSX 实际展开内容超过声明上限，未返回部分内容。')); return }
      for (const byte of chunk) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
      chunks.push(chunk)
    }).on('error', fail).on('end', () => {
      if (settled) return
      if (size !== entry.size || ((crc ^ 0xffffffff) >>> 0) !== entry.crc) { fail(new Error('XLSX 文件内容校验失败。')); return }
      settled = true; signal?.removeEventListener('abort', abort)
      const data = new Uint8Array(size)
      let offset = 0
      for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length }
      resolve(data)
    }).resume()
    if (signal?.aborted) abort()
  })
  signal?.throwIfAborted()
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le' : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8'
  const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) invalid('不支持包含外部实体的 XML')
  const document = new DOMParser().parseFromString(text, 'application/xml')
  if (document.getElementsByTagNameNS('*', 'parsererror').length) invalid(`XML 损坏：${path}`)
  return document
}
function children(parent: Element, name: string): Element[] {
  return Array.from(parent.children).filter(node => node.localName === name && node.namespaceURI === parent.namespaceURI)
}
function one(parent: Element, name: string): Element | undefined {
  const nodes = children(parent, name)
  if (nodes.length > 1) invalid(`重复的 ${name}`)
  return nodes[0]
}
function root(document: Document, name: string, namespaces = MAIN): Element {
  const element = document.documentElement
  if (element.localName !== name || !namespaces.includes(element.namespaceURI ?? '')) invalid(`不支持的 ${name} 结构`)
  return element
}
function resolvePart(owner: string, target: string): string {
  if (!target || /[\\:#?\u0000]/.test(target) || /%/.test(target)) invalid('不支持的文件关系路径')
  const parts = target.startsWith('/') ? [] : owner.split('/').slice(0, -1)
  for (const part of target.split('/')) {
    if (part === '..') { if (!parts.length) invalid('关系路径超出原文件'); parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  const path = parts.join('/')
  if (!safePath(path)) invalid('关系路径无效')
  return path
}
function relationships(document: Document, owner: string) {
  const records = new Map<string, { path: string; type: string; external: boolean }>()
  for (const row of children(root(document, 'Relationships', [PACKAGE_REL]), 'Relationship')) {
    const id = row.getAttribute('Id') ?? '', type = row.getAttribute('Type') ?? ''
    if (!id || records.has(id)) invalid('文件关系缺少身份或重复')
    const external = row.getAttribute('TargetMode') === 'External'
    records.set(id, { path: external ? '' : resolvePart(owner, row.getAttribute('Target') ?? ''), type, external })
  }
  return records
}
function relationType(type: string, kind: string) { return REL.some(prefix => type === prefix + kind) }
function stringValue(element: Element): string {
  // rPh is pronunciation metadata, not a second copy of the author's text.
  return Array.from(element.children).flatMap(node => node.localName === 't' ? [node.textContent ?? '']
    : node.localName === 'r' ? children(node, 't').map(text => text.textContent ?? '') : [])
    .join('').replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
}
function coordinate(value: string) {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/.exec(value)
  if (!match) invalid('单元格坐标无效')
  let col = 0
  for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64
  if (col > 16384 || Number(match[2]) > 1048576) invalid('单元格坐标超出 XLSX 范围')
  return { col, row: Number(match[2]) }
}
function addressFor(column: number, row: number) {
  let letters = ''
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) letters = String.fromCharCode(65 + (value - 1) % 26) + letters
  return letters + row
}

export async function extractXlsxTextV1(file: File, signal?: AbortSignal): Promise<{ text: string; hasContent: boolean; sheetCount: number; notice: string }> {
  signal?.throwIfAborted()
  if (file.size > XLSX_MAX_FILE_BYTES_V1) invalid('文件超过 10 MB 本地上限')
  const bytes = await file.arrayBuffer()
  signal?.throwIfAborted()
  const entries = inspectArchive(bytes)
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(bytes)
  const read = (path: string) => readPart(zip, entries, path, signal)
  const packageRels = relationships(await read('_rels/.rels'), '')
  const offices = [...packageRels.values()].filter(row => relationType(row.type, 'officeDocument'))
  if (offices.length !== 1 || offices[0].external) invalid('工作簿关系缺失或不唯一')
  const workbookPath = offices[0].path
  const workbook = root(await read(workbookPath), 'workbook')
  const types = root(await read('[Content_Types].xml'), 'Types', ['http://schemas.openxmlformats.org/package/2006/content-types'])
  if (!children(types, 'Override').some(row => row.getAttribute('PartName') === '/' + workbookPath
    && row.getAttribute('ContentType') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml')) invalid('不是受支持的无宏 XLSX 工作簿')
  const slash = workbookPath.lastIndexOf('/')
  const relPath = workbookPath.slice(0, slash + 1) + '_rels/' + workbookPath.slice(slash + 1) + '.rels'
  const relations = relationships(await read(relPath), workbookPath)
  const shared = [...relations.values()].filter(row => relationType(row.type, 'sharedStrings'))
  if (shared.length > 1 || shared.some(row => row.external)) invalid('共享字符串关系不正确')
  const strings = shared.length ? children(root(await read(shared[0].path), 'sst'), 'si').map(stringValue) : []
  const sheets = one(workbook, 'sheets')
  const definitions = sheets ? children(sheets, 'sheet') : []
  if (!definitions.length || definitions.length > 1024) invalid('工作表数量不受支持')
  const lines = ['[XLSX 资料投影 v1]', NOTICE]
  let cellCount = 0, units = 0, hasContent = false
  const append = (value: unknown) => {
    const line = JSON.stringify(value)
    units += line.length + 1
    if (units > MAX_PART) invalid('单元格文本展开超过 16 MB，未截取部分内容')
    lines.push(line)
  }
  append({ workbook: { date1904: one(workbook, 'workbookPr')?.getAttribute('date1904') ?? '0' } })
  const styles = [...relations.values()].filter(row => relationType(row.type, 'styles'))
  if (styles.length > 1 || styles.some(row => row.external)) invalid('样式关系不正确')
  if (styles.length) {
    const style = root(await read(styles[0].path), 'styleSheet')
    const formats = one(style, 'numFmts'), xfs = one(style, 'cellXfs')
    append({ numberFormats: formats ? children(formats, 'numFmt').map(row => ({ id: row.getAttribute('numFmtId'), code: row.getAttribute('formatCode') })) : [],
      cellNumberFormats: xfs ? children(xfs, 'xf').map(row => row.getAttribute('numFmtId') ?? '0') : [] })
  }
  const names = new Set<string>(), identities = new Set<string>()
  for (const definition of definitions) {
    signal?.throwIfAborted()
    const name = definition.getAttribute('name') ?? ''
    const id = REL.map(prefix => definition.getAttributeNS(prefix.slice(0, -1), 'id')).find(Boolean)
    const relation = id ? relations.get(id) : undefined
    if (!name || names.has(name) || !id || identities.has(id) || !relation || relation.external || !relationType(relation.type, 'worksheet')) invalid('工作表关系无效或存在不支持的图表工作表')
    names.add(name); identities.add(id)
    const sheet = root(await read(relation.path), 'worksheet')
    append({ sheet: name, state: definition.getAttribute('state') || 'visible', part: relation.path })
    const data = one(sheet, 'sheetData')
    if (!data) invalid('工作表缺少单元格区域')
    let previousRow = 0
    const seen = new Set<string>()
    for (const row of children(data, 'row')) {
      const rowIndex = row.hasAttribute('r') ? Number(row.getAttribute('r')) : previousRow + 1
      if (!Number.isSafeInteger(rowIndex) || rowIndex <= previousRow || rowIndex > 1048576) invalid('行号无效或重复')
      previousRow = rowIndex
      let previousCol = 0
      for (const cell of children(row, 'c')) {
        if (++cellCount > MAX_CELLS) invalid('单元格数量超过本地上限 200000，未截取部分内容')
        const address = cell.getAttribute('r') ?? addressFor(previousCol + 1, rowIndex)
        const point = coordinate(address)
        if (point.row !== rowIndex || point.col <= previousCol || seen.has(address)) invalid('单元格坐标与所在行不一致或重复')
        previousCol = point.col; seen.add(address)
        const type = cell.getAttribute('t') || 'n', raw = one(cell, 'v'), formula = one(cell, 'f')
        if (!['s', 'inlineStr', 'str', 'n', 'b', 'd', 'e'].includes(type)) invalid(`不支持的单元格类型 ${type}`)
        let value = raw?.textContent ?? ''
        if (type === 's') {
          if (!/^\d+$/.test(value) || Number(value) >= strings.length) invalid('共享字符串索引丢失')
          value = strings[Number(value)]
        } else if (type === 'inlineStr') {
          const inline = one(cell, 'is')
          if (!inline) invalid('单元格字符串丢失')
          value = stringValue(inline)
        } else if (type === 'str') value = value.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
        if (formula && !raw) invalid(`公式 ${name}!${address} 没有缓存结果，请先在 Excel / WPS 重新计算并保存`)
        hasContent ||= Boolean(value.trim() || formula)
        append({ cell: address, type, value, ...(row.getAttribute('hidden') === '1' ? { hiddenRow: true } : {}),
          ...(cell.hasAttribute('s') ? { style: cell.getAttribute('s') } : {}),
          ...(formula ? { formula: formula.textContent ?? '', formulaAttributes: Object.fromEntries(Array.from(formula.attributes).map(attr => [attr.name, attr.value])) } : {}) })
      }
    }
    const merges = one(sheet, 'mergeCells')
    for (const merge of merges ? children(merges, 'mergeCell') : []) {
      const ref = merge.getAttribute('ref') ?? '', parts = ref.split(':')
      if (parts.length !== 2) invalid('合并区域坐标无效')
      const start = coordinate(parts[0]), end = coordinate(parts[1])
      if (start.row > end.row || start.col > end.col) invalid('合并区域范围无效')
      append({ merged: ref })
    }
  }
  signal?.throwIfAborted()
  return { text: lines.join('\n'), hasContent, sheetCount: definitions.length, notice: NOTICE }
}
