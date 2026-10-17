import type { ProductBuildQualityReportV1 } from '../types'
import { isSha256Hash } from './hash'

// Keep the public adoption parser's historical shape and error text. Both
// publication and readiness projections share this single deterministic codec.
function fail(message:string):never { throw new Error(`[product-production-adoption] ${message}`) }
function object(value:unknown,label:string):Record<string,unknown> {
  if(!value||typeof value!=='object'||Array.isArray(value))fail(`${label} 必须是对象`)
  return value as Record<string,unknown>
}
function exactKeys(value:Record<string,unknown>,keys:readonly string[],label:string):void {
  const actual=Object.keys(value).sort(),expected=[...keys].sort()
  if(actual.length!==expected.length||actual.some((key,index)=>key!==expected[index]))fail(`${label} 字段不符合合同:${actual.join(',')}`)
}

export function parseProductBuildQualityReportV1(value: string): ProductBuildQualityReportV1 {
  let raw: unknown
  try { raw = JSON.parse(value) } catch { fail('Quality report 不是合法 JSON') }
  const row = object(raw, 'Quality report')
  exactKeys(row, [
    'schema', 'version', 'buildNumber', 'packageHash', 'hardGateResults', 'softGateResults',
    'mediaCoverage', 'playable', 'releaseReady', 'warnings',
  ], 'Quality report')
  if (row.schema !== 'storyforge.product-build-quality-report' || row.version !== 1
    || !Number.isInteger(row.buildNumber) || !isSha256Hash(row.packageHash)
    || !Array.isArray(row.hardGateResults) || !Array.isArray(row.softGateResults)
    || !Array.isArray(row.warnings) || typeof row.playable !== 'boolean'
    || typeof row.releaseReady !== 'boolean' || typeof row.mediaCoverage !== 'number'
    || row.mediaCoverage < 0 || row.mediaCoverage > 1) fail('Quality report 基础字段无效')
  const gates = (values: unknown[], label: string) => values.map((value, index) => {
    const gate = object(value, `${label}[${index}]`)
    exactKeys(gate, ['gateId', 'passed', 'evidence'], `${label}[${index}]`)
    if (typeof gate.gateId !== 'string' || !gate.gateId.trim() || typeof gate.passed !== 'boolean'
      || !Array.isArray(gate.evidence) || gate.evidence.some(item => typeof item !== 'string' || !item.trim())) {
      fail(`${label}[${index}] 无效`)
    }
    return { gateId: gate.gateId.trim(), passed: gate.passed, evidence: [...gate.evidence] as string[] }
  })
  return {
    schema: 'storyforge.product-build-quality-report', version: 1,
    buildNumber: Number(row.buildNumber), packageHash: row.packageHash,
    hardGateResults: gates(row.hardGateResults, 'hardGateResults'),
    softGateResults: gates(row.softGateResults, 'softGateResults'),
    mediaCoverage: row.mediaCoverage, playable: row.playable, releaseReady: row.releaseReady,
    warnings: row.warnings.map(value => String(value)),
  }
}
