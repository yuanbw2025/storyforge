import { describe, expect, it } from 'vitest'
import { assertCodexProductionPolicyV1, CODEX_PRODUCTION_POLICY_V1, codexSourceUnitEndsV1,
  consolidateCodexDraftsV1, readSentCodexProgressNamesV1, splitCodexSourceUnitsV1 } from '../../src/lib/agent/run/codex-extraction-v2-source-units'
import { parseCodexEntriesStrictV2, type ExtractedCodexEntry } from '../../src/lib/ai/adapters/structured-extract-adapter'
import { hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { sha256Text } from '../../src/lib/ai/chapter-memory/text-normalization'

const fragment = (description: string, fields = {}): ExtractedCodexEntry => ({ name: '北辰联邦', icon: '🏳', summary: description,
  description, fields, tags: [], importance: 2, evidenceQuotes: [description], provenance: 'verbatim-extraction' })

describe('B01 frozen source units and verified sameRoot draft projection', () => {
  it('never cuts the midpoint entity, CRLF, emoji or raw whitespace, and exposes an indivisible unit', () => {
    const sourceText = '前'.repeat(1000) + '北辰联邦' + '后'.repeat(1000) + '\r\n\r\n😀该国禁用灵力。\n '
    const policy = { version: CODEX_PRODUCTION_POLICY_V1, sourceUnitEnds: codexSourceUnitEndsV1(sourceText) }
    const ranges = splitCodexSourceUnitsV1({ sourceText, startChar: 0, endChar: sourceText.length, policy })
    expect(ranges.map(row => row.text).join('')).toBe(sourceText)
    expect(ranges.some(row => row.text.includes('北辰联邦'))).toBe(true)
    expect(ranges.every(row => !row.text.endsWith('\r') && !/[\uD800-\uDBFF]$/.test(row.text))).toBe(true)
    expect(() => splitCodexSourceUnitsV1({ sourceText, ...ranges[0], policy })).toThrow('单个完整原文单元')
    expect(() => assertCodexProductionPolicyV1({ ...policy, sourceUnitEnds: [1002, sourceText.length] }, sourceText)).toThrow()
  })

  it.each(['北辰联邦：\n该国首都玄京，朔日禁用灵力。', '北辰联邦：\n\n该国首都玄京，朔日禁用灵力。',
    '【北辰联邦】\n\n该国首都玄京，朔日禁用灵力。'])('keeps an entity heading and its facts in one indivisible unit: %j', sourceText => {
    const policy = { version: CODEX_PRODUCTION_POLICY_V1, sourceUnitEnds: codexSourceUnitEndsV1(sourceText) }
    expect(policy.sourceUnitEnds).toEqual([sourceText.length])
    expect(() => splitCodexSourceUnitsV1({ sourceText, startChar: 0, endChar: sourceText.length, policy })).toThrow('单个完整原文单元')
  })

  it('preserves dispersed facts, exact quotes, tags and input fragments, and refuses Canon or conflicting fields', () => {
    const a = fragment('北辰联邦位于北境。', { location: '北境' }), b = fragment('该国每逢朔日禁用灵力。', { taboo: '朔日禁灵' })
    a.tags = ['地理']; b.tags = ['禁忌']; b.importance = 4
    const original = structuredClone([a, b])
    const definitions = [{ key: 'location', label: '位置', type: 'text' as const }, { key: 'taboo', label: '禁忌', type: 'text' as const },
      { key: 'effect', label: '功效', type: 'longtext' as const }, { key: 'rank', label: '品级', type: 'number' as const },
      { key: 'state', label: '状态', type: 'select' as const, options: ['甲', '乙'] }]
    const entries = consolidateCodexDraftsV1([a, b], [], definitions)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ description: a.description + '\n\n' + b.description,
      fields: { location: '北境', taboo: '朔日禁灵' }, tags: ['地理', '禁忌'], importance: 4,
      evidenceQuotes: [a.description, b.description] })
    expect([a, b]).toEqual(original)
    expect(() => consolidateCodexDraftsV1([a, b], ['北辰联邦'], definitions)).toThrow('Canon')
    expect(consolidateCodexDraftsV1([fragment('第一段', { effect: '可以储存声音' }), fragment('后段', { effect: '朔日禁止回放' })], [], definitions)[0].fields.effect).toBe('可以储存声音\n\n朔日禁止回放')
    expect(() => consolidateCodexDraftsV1([fragment('第一段', { rank: '1' }), fragment('另一段', { rank: '2' })], [], definitions)).toThrow('不同值')
    expect(() => consolidateCodexDraftsV1([fragment('第一段', { state: '甲' }), fragment('另一段', { state: '乙' })], [], definitions)).toThrow('不同值')
    expect(() => consolidateCodexDraftsV1([fragment('未登记', { invented: '任意' })], [], definitions)).toThrow('未登记')
  })

  it('allows a pronoun continuation name only from progress actually sent with verified sameRoot source lineage', async () => {
    const scope = { projectId: 1, worldId: 2, workId: 3 }, rootHash = 'a'.repeat(64), resultHash = 'b'.repeat(64)
    const first = fragment('北辰联邦与南辰共和国位于北境。'), second = { ...first, name: '南辰共和国' },
      current = '前者每逢朔日禁用灵力，后者不受此限。', sourceText = first.description + '\n\n' + current
    const progress = { runId: 4, rootHash, scope, authority: 'draft-not-canon', results: [{ contentHash: resultHash }], names: [first.name, second.name] }
    const rawText = JSON.stringify(progress)
    const capture = { sourceKey: 'codexExtractionProgressV2', scope, rawText, rawBodyHash: await sha256Text(rawText) }
    const captureHash = await hashCanonicalValue(capture), material = { authorityHash: rootHash, capturedSourceHashes: ['source', 'baseline', captureHash] }
    const materialHash = await hashCanonicalValue(material)
    const wire = { messages: [{ role: 'system', content: '【本次实际发送的同Root已验证草稿，非Canon】\n' + rawText }] }
    const wireHash = await hashCanonicalValue(wire)
    const artifacts = new Map<string, Record<string, unknown>>([[materialHash, material], [captureHash, capture], [wireHash, wire]])
    const input = { runId: 4, rootHash, scope, sourceText,
      frame: { materialAllocationHash: materialHash, wireFrameHash: wireHash, request: { messagesHash: await hashCanonicalValue(wire.messages) } },
      previous: new Map([[resultHash, [first, second]]]), read: async (_kind: string, hash: string) => {
        const body = artifacts.get(hash); if (!body) throw new Error('missing member'); return body
      } }
    const verifiedProgressNames = await readSentCodexProgressNamesV1(input)
    const next = fragment(current)
    expect(parseCodexEntriesStrictV2(JSON.stringify([next]), [], { operation: 'extract', sourceText: current, verifiedProgressNames })).toEqual([next])
    expect(() => parseCodexEntriesStrictV2(JSON.stringify([next]), [], { operation: 'extract', sourceText: current })).toThrow('名称')
    expect(verifiedProgressNames).toEqual(['北辰联邦', '南辰共和国'])
    const other = { ...next, name: '南辰共和国' }
    expect(parseCodexEntriesStrictV2(JSON.stringify([next, other]), [], { operation: 'extract', sourceText: current, verifiedProgressNames })).toEqual([next, other])
    expect(() => parseCodexEntriesStrictV2(JSON.stringify([{ ...next, name: '凭空新增国' }]), [], { operation: 'extract', sourceText: current, verifiedProgressNames })).toThrow('名称')
    expect(() => parseCodexEntriesStrictV2(JSON.stringify([{ ...next, evidenceQuotes: [first.description] }]), [], { operation: 'extract', sourceText: current, verifiedProgressNames })).toThrow('引文')
    await expect(readSentCodexProgressNamesV1({ ...input, runId: 5 })).rejects.toThrow('跨Run')
    await expect(readSentCodexProgressNamesV1({ ...input, previous: new Map() })).rejects.toThrow('前序结果')
    await expect(readSentCodexProgressNamesV1({ ...input, sourceText: current })).rejects.toThrow('原文')
    const unsent = { messages: [{ role: 'system', content: '没有发送该progress' }] }, unsentHash = await hashCanonicalValue(unsent)
    artifacts.set(unsentHash, unsent)
    await expect(readSentCodexProgressNamesV1({ ...input, frame: { ...input.frame, wireFrameHash: unsentHash,
      request: { messagesHash: await hashCanonicalValue(unsent.messages) } } })).rejects.toThrow('实际发送')
  })
})
