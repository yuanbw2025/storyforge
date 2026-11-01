/** Run the actual manual CLI over source-only isolated metadata fixtures. */
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureFile = 'src/lib/manual-meta-fixture.ts'
const declaredInputs = [
  'src/lib/types/prompt.ts',
  'src/lib/ai/prompt-seeds-core.ts', 'src/lib/ai/prompt-seeds-tools.ts',
  'src/lib/ai/prompt-seeds-genre-packs.ts', 'src/lib/ai/prompt-seeds-genre-packs-extended.ts',
  'src/lib/ai/prompt-seeds-novel.ts', 'src/lib/registry/context-sources.ts',
  'src/lib/registry/project-tables.ts', 'src/lib/registry/field-registry.ts',
  'src/lib/registry/adoption-schema.ts', 'src/lib/agent/ai-entry-registry.json',
  'src/lib/open-world/responsibility-contract.ts',
]

async function scan(source: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'storyforge-ai-manual-meta-'))
  try {
    for (const relative of [...declaredInputs, 'scripts/generate-ai-manual.mjs', 'scripts/ai-call-meta.mjs']) {
      const output = path.join(directory, relative)
      await mkdir(path.dirname(output), { recursive: true })
      await writeFile(output, await readFile(path.join(repository, relative)))
    }
    await mkdir(path.join(directory, 'src/components'), { recursive: true })
    await mkdir(path.join(directory, 'src/hooks'), { recursive: true })
    await mkdir(path.join(directory, 'docs'), { recursive: true })
    await writeFile(path.join(directory, 'package.json'), '{"type":"module"}')
    await symlink(path.join(repository, 'node_modules'), path.join(directory, 'node_modules'), 'dir')
    await writeFile(path.join(directory, fixtureFile), source)
    const result = spawnSync(process.execPath, [path.join(directory, 'scripts/generate-ai-manual.mjs')], {
      cwd: directory, encoding: 'utf8', timeout: 4_000,
    })
    expect(result.error).toBeUndefined(); expect(result.status, result.stderr).toBe(0)
    return await readFile(path.join(directory, 'docs/AI-FUNCTIONS-MANUAL.generated.md'), 'utf8')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function section(manual: string, title: string): string {
  return manual.split(title)[1]?.split('\n##')[0] ?? ''
}

const header = 'declare function chat(...args: unknown[]): Promise<string>;\n'

describe('AI manual direct same-function const metadata', () => {
  it.each([
    'function owner(route: string) { const meta = { category: route }; return chat([], {}, meta) }',
    'function owner(route: string) { { const meta = { "category": route }; return chat([], {}, meta) } }',
  ])('classifies a proven local const category conservatively as dynamic', async source => {
    const manual = await scan(header + source)
    expect(section(manual, '### 动态 category 调用')).toContain(fixtureFile)
    expect(section(manual, '### 未分类调用（必须修复）')).not.toContain(fixtureFile)
  })

  it.each([
    'const meta = { category: "foreign" }; function owner(meta: unknown) { return chat([], {}, meta) }',
    'function owner(route: string) { const meta = { projectId: 1 }; return chat([], {}, meta) }',
    'function owner(route: string) { const original = { category: route }; const meta = original; return chat([], {}, meta) }',
    'function owner(route: string) { const meta = { category: route }; return function child() { return chat([], {}, meta) } }',
    'function owner(route: string) { const meta = { category: route }; { const meta = {}; return chat([], {}, meta) } }',
  ])('keeps shadow parameters, missing categories and unknown/cross-function aliases unclassified', async source => {
    const manual = await scan(header + source)
    expect(section(manual, '### 未分类调用（必须修复）')).toContain(fixtureFile)
    expect(section(manual, '### 动态 category 调用')).not.toContain(fixtureFile)
  })

  it('retains the original literal and inline dynamic call classifications', async () => {
    const manual = await scan(header + 'chat([], {}, { category: "fixture.literal" });\n'
      + 'function owner(route: string) { return chat([], {}, { category: route }) }')
    // The existing literal scanner intentionally recognizes the original
    // single-quoted category syntax, so use the same syntax for its baseline.
    const singleQuoted = await scan(header + "chat([], {}, { category: 'fixture.literal' });\n"
      + 'function owner(route: string) { return chat([], {}, { category: route }) }')
    expect(section(singleQuoted, '## 四、AI 调用点')).toContain('| `fixture.literal` |')
    expect(section(manual, '### 动态 category 调用')).toContain(fixtureFile)
    expect(section(singleQuoted, '### 动态 category 调用')).toContain(fixtureFile)
    expect(section(singleQuoted, '### 未分类调用（必须修复）')).not.toContain(fixtureFile)
  })
})
