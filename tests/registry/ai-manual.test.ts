/**
 * Phase 3.1 · AI 说明书自动生成校验
 *
 * 防止"说明书与代码脱节"(手写版曾有 21 处 prompt key 错)。
 *   ① generated.md 必须与当前代码一致(否则提示重新生成)
 *   ② semantic.md(手工语义注解)里引用的 moduleKey 必须真实存在
 */
import { describe, it, expect } from 'vitest'
import { execFileSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { SYSTEM_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds'
import { NOVEL_CONTENT_PROMPT_SEEDS } from '../../src/lib/ai/prompt-seeds-novel'
import { CONTEXT_SOURCES } from '../../src/lib/registry/context-sources'
import { PROMPT_MODULE_KEYS, RETIRED_PROMPT_MODULE_KEYS } from '../../src/lib/types/prompt'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

type ManualContextRow = { key: string; label: string; scope: string; layer: string; budgetTokens: number | null; fullCaptureVersion: 'registered-host-full-v2' | null; explicitSelectionOnly: boolean }
const fullCaptureBudgetNote = '（旧装配参考；V2完整捕获不以此截原文）'
const explicitSelectionNote = '（仅显式任务选用）'

// This test reads the rendered table and the actual runtime registry. It does
// not import the generator/parser: the same omission in both cannot pass.
function assertContextManualMatchesRuntime(manual: string): void {
  const section = manual.split('## 二、上下文源清单')[1]?.split('\n## 三、')[0] ?? ''
  const tableLines = section.split('\n').filter(line => line.startsWith('|'))
  const header = '| key | 标签 | 作用域 | 层级 | 预算(token) |'
  expect(tableLines.filter(line => line === header), '来源表必须有唯一完整表头').toHaveLength(1)
  const rows: ManualContextRow[] = tableLines.filter(line => line !== header && !/^\|(?:[-: ]+\|)+$/.test(line)).map(line => {
    const match = line.match(/^\| `([^`]+)` \| ([^|]*) \| ([^|]*) \| ([^|]*) \| (\d+|完整任务基线|按请求容量选读|按任务请求预算全文交付)(（旧装配参考；V2完整捕获不以此截原文）)?(（仅显式任务选用）)? \|$/)
    if (!match) throw new Error(`上下文来源行包含未知格式、预算或注记：${line}`)
    return { key: match[1] ?? '', label: match[2] ?? '', scope: match[3] ?? '', layer: match[4] ?? '',
      budgetTokens: ['完整任务基线', '按请求容量选读', '按任务请求预算全文交付'].includes(match[5] ?? '') ? null : Number(match[5]),
      fullCaptureVersion: match[6] ? 'registered-host-full-v2' : null, explicitSelectionOnly: Boolean(match[7]) }
  })
  const keys = rows.map(row => row.key)
  expect(new Set(keys).size, '上下文表不能含重复 key').toBe(keys.length)
  expect([...keys].sort(), '完整来源表必须独立匹配实际运行时注册表').toEqual(CONTEXT_SOURCES.map(source => source.key).sort())
  const byKey = new Map(rows.map(row => [row.key, row]))
  for (const source of CONTEXT_SOURCES) {
    if (source.fullCapture) {
      expect(source.fullCapture.version, `来源 ${source.key} 的捕获版本`).toBe('registered-host-full-v2')
      expect(source.fullCapture.sourceVersion.trim(), `来源 ${source.key} 的实际源版本`).not.toBe('')
    }
    expect(byKey.get(source.key), `来源 ${source.key} 的元数据、旧装配预算与完整捕获声明`).toEqual({ key: source.key,
      label: source.label, scope: source.scope, layer: source.layer, budgetTokens: source.budgetTokens,
      fullCaptureVersion: source.fullCapture?.version ?? null, explicitSelectionOnly: source.explicitSelectionOnly === true })
  }
}

describe('Phase 3.1 · AI 说明书自动生成', () => {
  it('generated.md 与代码一致(check 模式退出码 0)', () => {
    // 若不一致,generate-ai-manual.mjs --check 会以退出码 1 抛出
    expect(() => {
      execSync('node scripts/generate-ai-manual.mjs --check', { cwd: root, stdio: 'pipe' })
    }).not.toThrow()
  })

  it('generated.md 含全部现行 moduleKey，退役兼容标识不冒充可用模板', () => {
    const keys = PROMPT_MODULE_KEYS.filter(key => !RETIRED_PROMPT_MODULE_KEYS.some(retired => retired === key))
    expect(keys.length).toBeGreaterThan(0)
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    for (const k of keys) {
      expect(manual, `说明书应含 moduleKey ${k}`).toContain(`\`${k}\``)
    }
    for (const key of RETIRED_PROMPT_MODULE_KEYS) {
      expect(PROMPT_MODULE_KEYS).toContain(key)
      expect(SYSTEM_PROMPT_SEEDS.some(seed => seed.moduleKey === key)).toBe(false)
      expect(manual).not.toContain(`| \`${key}\` |`)
    }
  })

  it('moduleKey 唯一，说明书独立匹配运行时模板元数据与数字预算', () => {
    const keys = PROMPT_MODULE_KEYS.filter(key => !RETIRED_PROMPT_MODULE_KEYS.some(retired => retired === key))
    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)

    const allSeeds = [...SYSTEM_PROMPT_SEEDS, ...NOVEL_CONTENT_PROMPT_SEEDS]
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    expect(manual).toContain(`共 ${keys.length} 个唯一 moduleKey，${allSeeds.length} 条内置模板定义。`)
    expect(manual).toContain('内置-世界观维度生成')
    expect(manual).toContain('`projectName` `genres` `dimension`')

    const manualText = CONTEXT_SOURCES.find(source => source.key === 'manualText')
    // B21a/B20b：全文来源改按任务请求预算交付，不再携带固定 100k 应用额度。
    expect(manualText?.budgetTokens).toBeNull()
    expect(manualText?.fullCapture).toEqual({ version: 'registered-host-full-v2', sourceVersion: 'manualText-full-v2' })
    expect(manual).toContain(`| \`manualText\` | 用户指定内容 | manual | L0 | 按任务请求预算全文交付${fullCaptureBudgetNote} |`)
    expect(manual).toContain('| `fact-ledger` | `temporalFacts` | `FACT_PREDICATE_REGISTRY + PROJECT_TABLES.worldSemantic.projector + FIELD_REGISTRY + source hash CAS` |')
  })

  it('静态预算语法与失败合同经 Node 入口进入现有 CI', () => {
    expect(() => execFileSync(process.execPath, ['--test', 'scripts/ai-manual-context-sources.test.mjs'], {
      cwd: root, stdio: 'pipe',
    })).not.toThrow()
  })

  it('来源表独立等于全部实际运行时 keys、元数据和常量预算', () => {
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    expect(CONTEXT_SOURCES.length).toBeGreaterThan(0)
    expect(CONTEXT_SOURCES.find(source => source.key === 'chatSituationRuntime')?.budgetTokens).toBe(12_000)
    expect(CONTEXT_SOURCES.find(source => source.key === 'interactionRuntime')?.budgetTokens).toBe(8000)
    assertContextManualMatchesRuntime(manual)
  })

  it('独立来源检查拒绝删除任一真实 key 或增加未知 key，即使生成器同样遗漏', () => {
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    assertContextManualMatchesRuntime(manual)
    for (const source of CONTEXT_SOURCES) {
      const missing = manual.split('\n').filter(line => !line.startsWith(`| \`${source.key}\` |`)).join('\n')
      expect(() => assertContextManualMatchesRuntime(missing), `删除 ${source.key} 应失败`).toThrow()
    }
    const unknown = manual.replace('\n## 三、', '\n| `SFQA141-unknown` | 未登记 | runtime | L0 | 8000 |\n\n## 三、')
    expect(() => assertContextManualMatchesRuntime(unknown), '增加未知 key 应失败').toThrow()
  })

  it('完整捕获注记逐来源核验且拒绝遗漏、伪造、未知注记和重复行', () => {
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    const captureSources = CONTEXT_SOURCES.filter(source => source.fullCapture !== undefined)
    expect(captureSources.length).toBeGreaterThan(0)
    const sourceLine = (key: string) => manual.split('\n').find(line => line.startsWith(`| \`${key}\` |`))!
    const addLine = (line: string) => manual.replace('\n## 三、', `\n${line}\n\n## 三、`)
    for (const source of captureSources) {
      const line = sourceLine(source.key)
      expect(line).toContain(fullCaptureBudgetNote)
      expect(() => assertContextManualMatchesRuntime(manual.replace(line, line.replace(fullCaptureBudgetNote, ''))), `遗漏 ${source.key} 捕获声明`).toThrow()
      expect(() => assertContextManualMatchesRuntime(manual.replace(line, line.replace(fullCaptureBudgetNote, '（未知捕获规则）'))), `未知 ${source.key} 注记`).toThrow()
    }
    const ordinary = CONTEXT_SOURCES.find(source => source.fullCapture === undefined && typeof source.budgetTokens === 'number')!
    const plain = sourceLine(ordinary.key)
    const forged = plain.replace(/ \|$/, `${fullCaptureBudgetNote} |`)
    expect(() => assertContextManualMatchesRuntime(manual.replace(plain, forged)), '非完整捕获来源不能伪装成 V2 full capture').toThrow()
    expect(() => assertContextManualMatchesRuntime(addLine(sourceLine('manualText'))), '重复真实来源不能被 Map 合并掩盖').toThrow()
    expect(() => assertContextManualMatchesRuntime(addLine('| `SFQA141-unknown-note` | 未登记 | runtime | L0 | 8000（未知规则） |')), '未知格式行不能静默跳过').toThrow()
  })

  it('显式产品完整来源注记与实际选择元数据独立匹配，既有shared来源不得伪装', () => {
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    const explicit = CONTEXT_SOURCES.filter(source => source.explicitSelectionOnly)
    expect(explicit.map(source => source.key).sort()).toEqual(['worldviewFieldBaselineV2', 'worldviewFieldContextV2'].sort())
    assertContextManualMatchesRuntime(manual)
    for (const source of explicit) {
      const line = manual.split('\n').find(row => row.startsWith(`| \`${source.key}\` |`))!
      expect(line).toContain(explicitSelectionNote)
      expect(() => assertContextManualMatchesRuntime(manual.replace(line, line.replace(explicitSelectionNote, '')))).toThrow()
      expect(() => assertContextManualMatchesRuntime(manual.replace(line, line.replace(explicitSelectionNote, '（未登记选源规则）')))).toThrow()
    }
    const shared = manual.split('\n').find(row => row.startsWith('| `manualText` |'))!
    expect(shared).not.toContain(explicitSelectionNote)
    expect(() => assertContextManualMatchesRuntime(manual.replace(shared, shared.replace(/ \|$/, `${explicitSelectionNote} |`)))).toThrow()
  })

  it('semantic.md 引用的 moduleKey 必须真实存在(防 key 漂移)', () => {
    const semanticPath = path.join(root, 'docs/AI-FUNCTIONS-MANUAL.semantic.md')
    if (!fs.existsSync(semanticPath)) return // 语义注解可选

    const validKeys = new Set<string>(PROMPT_MODULE_KEYS)
    expect(validKeys.size).toBeGreaterThan(0)

    const semantic = fs.readFileSync(semanticPath, 'utf8')
    // 语义注解里用 `moduleKey: xxx.yyy` 标注引用
    const referenced = [...semantic.matchAll(/moduleKey:\s*`?([a-z][a-zA-Z0-9._-]*\.[a-zA-Z0-9._-]+)`?/g)].map(m => m[1])
    for (const ref of referenced) {
      expect(validKeys.has(ref), `semantic.md 引用了不存在的 moduleKey: ${ref}`).toBe(true)
    }
  })
})
