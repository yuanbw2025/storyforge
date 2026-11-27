import { describe, expect, it } from 'vitest'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { DIFF_BUDGET_V2, assertWorldviewDiffExactV2, diffWorldviewTextExactV2 } from '../../src/lib/agent/worldview-text-diff-v2'
const segmentation = { kind: 'intl-grapheme', version: 1, locale: 'zh' } as const
function cases(size: number) {
  const fit = (s: string) => s.repeat(Math.ceil(size / s.length)).slice(0, size)
  const paragraph = fit('潮门关闭之后船只依次停泊。'), repeat = fit('重复\n重复\n'), table = fit('|名称|关系|\n|甲|乙|\n')
  const insertion = '【因果约束】', middleBase = paragraph.slice(0, size - insertion.length), repeatedBase = repeat.slice(0, size - '尾声\n'.length)
  const insertAt = Math.floor(middleBase.length / 2)
  return [
    { name: 'middle-insertion', left: middleBase, right: middleBase.slice(0, insertAt) + insertion + middleBase.slice(insertAt) },
    { name: 'all-changed-long-line', left: '甲'.repeat(size), right: '乙'.repeat(size) },
    { name: 'repeat-reorder', left: repeatedBase + '尾声\n', right: '尾声\n' + repeatedBase },
    { name: 'table', left: table, right: table.replace(/乙/g, '丙') },
  ]
}
describe('054-A bounded work smoke', () => {
  it.each(cases(600))('$name reconstructs completely within fixed counters', ({ left, right }) => {
    const r = diffWorldviewTextExactV2({ left, right, segmentation })
    assertWorldviewDiffExactV2(left, right, r)
    expect(r.ops.length).toBeLessThanOrEqual(DIFF_BUDGET_V2.maxOps)
    expect(r.rows.length).toBeLessThanOrEqual(DIFF_BUDGET_V2.maxRows)
    expect(r.work.diff).toBeLessThanOrEqual(DIFF_BUDGET_V2.maxDiffSteps)
    expect(r.work.trace).toBeLessThanOrEqual(DIFF_BUDGET_V2.maxTraceCells)
  })
})
/** Opt-in calibration only: run in the coordinator's heavy-work window with
 * STORYFORGE_DIFF_PERF=1. Timing is recorded, never a pure algorithm decision,
 * a field-limit change, or a universal/browser-frame guarantee. */
describe.skipIf(process.env.STORYFORGE_DIFF_PERF !== '1')('054-A 10k/50k calibration', () => {
  for (const size of [10_000, 50_000]) for (const fixture of cases(size)) {
    it(`${size} ${fixture.name} p50/p95 (7 samples)`, () => {
      const times: number[] = [], cold: number[] = []
      // Each cold sample is the first diff invocation in a fresh Node process;
      // import/startup cost is excluded. Warm samples share this Vitest process.
      const child = `
        import { performance } from 'node:perf_hooks';
        import { readFileSync } from 'node:fs';
        const { diffWorldviewTextExactV2, assertWorldviewDiffExactV2 } = await import(${JSON.stringify(pathToFileURL(resolve('src/lib/agent/worldview-text-diff-v2.ts')).href)});
        const f = JSON.parse(readFileSync(0, 'utf8'));
        const start = performance.now();
        const result = diffWorldviewTextExactV2({...f, segmentation: {kind:'intl-grapheme',version:1,locale:'zh'}});
        const duration = performance.now() - start;
        assertWorldviewDiffExactV2(f.left, f.right, result);
        process.stdout.write(JSON.stringify({duration}));
      `
      for (let i = 0; i < 7; i++) {
        const sample = spawnSync(process.execPath, ['--experimental-transform-types', '--input-type=module', '-e', child],
          { input: JSON.stringify(fixture), encoding: 'utf8', timeout: 20_000, maxBuffer: 64_000 })
        if (sample.status !== 0 || sample.error) throw new Error(`Cold diff child failed: ${sample.error?.message ?? sample.stderr}`)
        cold.push((JSON.parse(sample.stdout) as { duration: number }).duration)
      }
      let last = diffWorldviewTextExactV2({ ...fixture, segmentation })
      for (let i = 0; i < 7; i++) {
        const start = performance.now()
        last = diffWorldviewTextExactV2({ ...fixture, segmentation })
        times.push(performance.now() - start)
        assertWorldviewDiffExactV2(fixture.left, fixture.right, last)
      }
      times.sort((a, b) => a - b); cold.sort((a, b) => a - b)
      process.stdout.write(JSON.stringify({ size, case: fixture.name, samples: { cold: 7, warm: 7 }, cold: { p50ms: cold[3], p95ms: cold[6] }, warm: { p50ms: times[3], p95ms: times[6] }, work: last.work,
        ops: last.ops.length, rows: last.rows.length, coarseReasons: last.coarseReasons, node: process.version, icu: process.versions.icu }) + '\n')
      expect([...times, ...cold].every(Number.isFinite)).toBe(true)
    }, 30_000)
  }
  it('above 50k is explicitly coarse with complete source coverage', () => {
    const left = '甲'.repeat(50_001), right = '乙'.repeat(50_002)
    const r = diffWorldviewTextExactV2({ left, right, segmentation })
    expect(r.coarseReasons).toContain('input-size-limit')
    expect(r.rows[0].precision).toBe('whole')
    assertWorldviewDiffExactV2(left, right, r)
    expect(r.ops.map(op => left.slice(...op.left)).join('')).toBe(left)
    expect(r.ops.map(op => right.slice(...op.right)).join('')).toBe(right)
  })
})
