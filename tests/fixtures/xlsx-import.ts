import JSZip from 'jszip'

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export async function xlsxImportFixtureV1(options: { sheet?: string; secondSheet?: string; shared?: string; relationTarget?: string; strict?: boolean } = {}) {
  const ns = options.strict ? 'http://purl.oclc.org/ooxml/spreadsheetml/main' : NS
  const rel = options.strict ? 'http://purl.oclc.org/ooxml/officeDocument/relationships' : REL
  const zip = new JSZip()
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>')
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${rel}"><workbookPr date1904="1"/><sheets><sheet name="人物 &amp; 地点" sheetId="1" r:id="one"/><sheet name="隐秘关系" sheetId="2" state="veryHidden" r:id="two"/></sheets></workbook>`)
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="one" Type="${rel}/worksheet" Target="${options.relationTarget ?? 'worksheets/first.xml'}"/><Relationship Id="two" Type="${rel}/worksheet" Target="worksheets/second.xml"/><Relationship Id="strings" Type="${rel}/sharedStrings" Target="sharedStrings.xml"/><Relationship Id="styles" Type="${rel}/styles" Target="styles.xml"/><Relationship Id="external" Type="${rel}/externalLink" TargetMode="External" Target="https://must-not-fetch.invalid/book.xlsx"/></Relationships>`)
  zip.file('xl/sharedStrings.xml', `<sst xmlns="${ns}">${options.shared ?? '<si><r><t xml:space="preserve"> 林</t></r><r><t>🌙_x000D_第二行</t></r><rPh sb="0" eb="1"><t>忽略注音</t></rPh></si><si><t>_x005F_x0041_</t></si>'}</sst>`)
  zip.file('xl/styles.xml', `<styleSheet xmlns="${ns}"><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`)
  zip.file('xl/worksheets/first.xml', `<worksheet xmlns="${ns}">${options.sheet ?? '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>姓名</t></is></c><c r="C1" t="s"><v>1</v></c></row><row r="3" hidden="1"><c r="A3" t="s"><v>0</v></c><c r="D3" s="1"><v>44000</v></c><c r="E3"><f>SUM(1,2)</f><v>3</v></c><c r="F3" t="b"><v>0</v></c><c r="G3" t="e"><v>#N/A</v></c></row></sheetData><mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>'}</worksheet>`)
  zip.file('xl/worksheets/second.xml', `<worksheet xmlns="${ns}">${options.secondSheet ?? '<sheetData><row r="1048576"><c r="XFD1048576" t="inlineStr"><is><t>&lt;script&gt;不执行&lt;/script&gt;</t></is></c></row></sheetData>'}</worksheet>`)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
