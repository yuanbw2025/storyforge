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
import { PROMPT_MODULE_KEYS } from '../../src/lib/types/prompt'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

type ManualContextRow = { key: string; label: string; scope: string; layer: string; budgetTokens: number }

// This test reads the rendered table and the actual runtime registry. It does
// not import the generator/parser: the same omission in both cannot pass.
function assertContextManualMatchesRuntime(manual: string): void {
  const section = manual.split('## 二、上下文源清单')[1]?.split('\n## 三、')[0] ?? ''
  const rows: ManualContextRow[] = section.split('\n').flatMap(line => {
    const match = line.match(/^\| `([^`]+)` \| ([^|]*) \| ([^|]*) \| ([^|]*) \| (\d+) \|$/)
    return match ? [{ key: match[1] ?? '', label: match[2] ?? '', scope: match[3] ?? '',
      layer: match[4] ?? '', budgetTokens: Number(match[5]) }] : []
  })
  const keys = rows.map(row => row.key)
  expect(new Set(keys).size, '上下文表不能含重复 key').toBe(keys.length)
  expect([...keys].sort(), '完整来源表必须独立匹配实际运行时注册表').toEqual(CONTEXT_SOURCES.map(source => source.key).sort())
  const byKey = new Map(rows.map(row => [row.key, row]))
  for (const source of CONTEXT_SOURCES) {
    expect(byKey.get(source.key), `来源 ${source.key} 的元数据与预算`).toEqual({ key: source.key,
      label: source.label, scope: source.scope, layer: source.layer, budgetTokens: source.budgetTokens })
  }
}

describe('Phase 3.1 · AI 说明书自动生成', () => {
  it('generated.md 与代码一致(check 模式退出码 0)', () => {
    // 若不一致,generate-ai-manual.mjs --check 会以退出码 1 抛出
    expect(() => {
      execSync('node scripts/generate-ai-manual.mjs --check', { cwd: root, stdio: 'pipe' })
    }).not.toThrow()
  })

  it('generated.md 含全部运行时 moduleKey', () => {
    const keys = PROMPT_MODULE_KEYS
    expect(keys.length).toBeGreaterThan(0)
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    for (const k of keys) {
      expect(manual, `说明书应含 moduleKey ${k}`).toContain(`\`${k}\``)
    }
  })

  it('moduleKey 唯一，说明书独立匹配运行时模板元数据与数字预算', () => {
    const keys = PROMPT_MODULE_KEYS
    expect(keys.length).toBeGreaterThan(0)
    expect(new Set(keys).size).toBe(keys.length)

    const allSeeds = [...SYSTEM_PROMPT_SEEDS, ...NOVEL_CONTENT_PROMPT_SEEDS]
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    expect(manual).toContain(`共 ${keys.length} 个唯一 moduleKey，${allSeeds.length} 条内置模板定义。`)
    expect(manual).toContain('内置-世界观维度生成')
    expect(manual).toContain('`projectName` `genres` `dimension`')

    const manualText = CONTEXT_SOURCES.find(source => source.key === 'manualText')
    expect(manualText?.budgetTokens).toBe(100_000)
    expect(manual).toContain('| `manualText` | 用户指定内容 | manual | L0 | 100000 |')
    expect(manual).toContain('| `fact-ledger` | `temporalFacts` | `FACT_PREDICATE_REGISTRY + PROJECT_TABLES.worldSemantic.projector + FIELD_REGISTRY + source hash CAS` |')
  })

  it('静态预算语法与失败合同经 Node 入口进入现有 CI', () => {
    expect(() => execFileSync(process.execPath, ['--test', 'scripts/ai-manual-context-sources.test.mjs'], {
      cwd: root, stdio: 'pipe',
    })).not.toThrow()
  })

  it('来源表独立等于全部实际运行时 keys、元数据和常量预算', () => {
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    expect(CONTEXT_SOURCES).toHaveLength(175)
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
