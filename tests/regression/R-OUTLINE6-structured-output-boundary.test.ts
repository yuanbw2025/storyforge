import { describe, expect, it, vi } from 'vitest'
import { parseChapterOutlineOutput, parseVolumeOutlineOutput } from '../../src/lib/ai/parse-outline-output'
import { createOutlineGenerationNode } from '../../src/lib/outline/generation-node'
import type { Project, Work } from '../../src/lib/types'

describe.each([
  { unit: '卷', parse: parseVolumeOutlineOutput },
  { unit: '章', parse: parseChapterOutlineOutput },
])('R-OUTLINE6 $unit structured output boundary', ({ unit, parse }) => {
  const item = { title: `第1${unit}：巡桥`, summary: '林渡发现桥索被割断，先疏散旅客再追查仓库。' }

  it.each(['bare', 'json-fence', 'unlabelled-fence'])('accepts one whole valid container: %s', kind => {
    const json = JSON.stringify([item])
    const output = kind === 'bare' ? json : `\`\`\`${kind === 'json-fence' ? 'json' : ''}\n${json}\n\`\`\``
    expect(parse(output)).toEqual([item])
  })

  it('does not turn malformed JSON and a closing fence into a title and summary', () => {
    // Minimal original failure from a real Agnes volume response: an unescaped
    // quote in summary caused Markdown fallback to accept summary === "```".
    expect(parse(`\`\`\`json\n[{"title":"第1${unit}：巡桥","summary":"旧缆桥"望津桥"的索链断了。"}]\n\`\`\``)).toEqual([])
  })

  it.each([
    ['wrong root', (value: typeof item) => JSON.stringify(value)],
    ['wrong title type', (value: typeof item) => JSON.stringify([{ ...value, title: { text: value.title } }])],
    ['wrong summary type', (value: typeof item) => JSON.stringify([{ ...value, summary: ['路线不明'] }])],
    ['mixed invalid row', (value: typeof item) => JSON.stringify([value, null])],
    ['truncated array', (value: typeof item) => JSON.stringify([value]).slice(0, -1)],
    ['extra explanation', (value: typeof item) => `以下是结果\n\`\`\`json\n${JSON.stringify([value])}\n\`\`\`\n希望这能帮到你。`],
    ['multiple containers', (value: typeof item) => `\`\`\`json\n${JSON.stringify([value])}\n\`\`\`\n\`\`\`json\n[]\n\`\`\``],
  ] as const)('rejects %s without partial salvage or scalar coercion', (_name, output) => {
    expect(parse(output(item))).toEqual([])
  })

  it('keeps genuine Markdown headings and narrative mentions distinct', () => {
    const summary = `林渡读到第2${unit}的笔记，仍先救下桥上的旅客。`
    expect(parse(`## 第1${unit}：巡桥\n${summary}\n## 第2${unit}：追索\n线索指向仓库。`)).toEqual([
      { title: `第1${unit}：巡桥`, summary },
      { title: `第2${unit}：追索`, summary: '线索指向仓库。' },
    ])
  })
})

it('R-OUTLINE6 ordinary numbered chapter headings form separate candidates', () => {
  expect(parseChapterOutlineOutput('1. 巡桥\n先救旅客。\n2. 追索\n找到仓库。')).toEqual([
    { title: '第1章：巡桥', summary: '先救旅客。' },
    { title: '第2章：追索', summary: '找到仓库。' },
  ])
})

it('R-OUTLINE6 numbered notes within a named chapter remain its summary', () => {
  expect(parseChapterOutlineOutput('第1章：巡桥\n1. 先查绳结。\n2. 再救旅客。')).toEqual([
    { title: '第1章：巡桥', summary: '1. 先查绳结。2. 再救旅客。' },
  ])
})

it.each(['single-volume', 'single-chapter'] as const)('R-OUTLINE6 %s gate blocks bad JSON without another model call', kind => {
  const start = vi.fn()
  const node = createOutlineGenerationNode({
    request: kind === 'single-volume' ? { kind, volumeId: 1 } : { kind, chapterId: 2 },
    project: { id: 1 } as Project,
    work: { id: 1 } as Work,
    nodes: [], volumes: [], hint: '', runOptions: {}, ai: { start },
  })
  expect(node.gate?.('```json\n[{"title":"第1卷 第1章","summary":"桥名"错误"。"}]\n```')).toMatchObject({
    status: 'blocked', issues: [{ code: 'outline_output_unparseable' }],
  })
  expect(start).not.toHaveBeenCalled()
})
