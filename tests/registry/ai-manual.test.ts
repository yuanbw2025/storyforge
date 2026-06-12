/**
 * Phase 3.1 · AI 说明书自动生成校验
 *
 * 防止"说明书与代码脱节"(手写版曾有 21 处 prompt key 错)。
 *   ① generated.md 必须与当前代码一致(否则提示重新生成)
 *   ② semantic.md(手工语义注解)里引用的 moduleKey 必须真实存在
 */
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('Phase 3.1 · AI 说明书自动生成', () => {
  it('generated.md 与代码一致(check 模式退出码 0)', () => {
    // 若不一致,generate-ai-manual.mjs --check 会以退出码 1 抛出
    expect(() => {
      execSync('node scripts/generate-ai-manual.mjs --check', { cwd: root, stdio: 'pipe' })
    }).not.toThrow()
  })

  it('generated.md 含全部 moduleKey(动态校验,FB-5 后 36 个)', () => {
    const promptSrc = fs.readFileSync(path.join(root, 'src/lib/types/prompt.ts'), 'utf8')
    const block = promptSrc.match(/export type PromptModuleKey =([\s\S]*?)(?:\n\nexport|\n\/\*\*|\nexport interface)/)
    const keys = [...(block?.[1] ?? '').matchAll(/\|\s*'([a-zA-Z0-9._-]+)'/g)].map(m => m[1])
    const manual = fs.readFileSync(path.join(root, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
    for (const k of keys) {
      expect(manual, `说明书应含 moduleKey ${k}`).toContain(`\`${k}\``)
    }
  })

  it('semantic.md 引用的 moduleKey 必须真实存在(防 key 漂移)', () => {
    const semanticPath = path.join(root, 'docs/AI-FUNCTIONS-MANUAL.semantic.md')
    if (!fs.existsSync(semanticPath)) return // 语义注解可选

    const promptSrc = fs.readFileSync(path.join(root, 'src/lib/types/prompt.ts'), 'utf8')
    const validKeys = new Set(
      [...promptSrc.matchAll(/\|\s*'([a-zA-Z0-9._-]+)'/g)].map(m => m[1]),
    )

    const semantic = fs.readFileSync(semanticPath, 'utf8')
    // 语义注解里用 `moduleKey: xxx.yyy` 标注引用
    const referenced = [...semantic.matchAll(/moduleKey:\s*`?([a-z][a-zA-Z0-9._-]*\.[a-zA-Z0-9._-]+)`?/g)].map(m => m[1])
    for (const ref of referenced) {
      expect(validKeys.has(ref), `semantic.md 引用了不存在的 moduleKey: ${ref}`).toBe(true)
    }
  })
})
