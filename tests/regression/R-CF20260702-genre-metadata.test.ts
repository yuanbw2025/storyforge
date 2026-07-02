import { describe, expect, it } from 'vitest'
import {
  buildGenreConstraintContext,
  getGenreMetadata,
  normalizeGenreMetadataId,
} from '../../src/lib/ai/genre-metadata'

describe('CF-20260702-4 · 流派 ID 与题材元数据兼容', () => {
  it('UI 流派 ID 通过别名命中元数据，不再静默失效', () => {
    expect(normalizeGenreMetadataId('kehuan')).toBe('scifi')
    expect(normalizeGenreMetadataId('qihuan')).toBe('xifan')
    expect(normalizeGenreMetadataId('xifang')).toBe('xifan')
    expect(normalizeGenreMetadataId('shishi')).toBe('shishi')
    expect(normalizeGenreMetadataId('heian')).toBe('heian')

    expect(getGenreMetadata('kehuan')?.label).toBe('科幻')
    expect(getGenreMetadata('qihuan')?.label).toBe('西幻/奇幻')
    expect(getGenreMetadata('shishi')?.label).toBe('史诗奇幻')
    expect(getGenreMetadata('heian')?.label).toBe('黑暗奇幻')
  })

  it('多选流派会合并注入多个题材约束，并对别名去重', () => {
    const context = buildGenreConstraintContext(['kehuan', 'moshi', 'qihuan', 'xifang', 'shishi', 'heian'])

    expect(context).toContain('【题材约束：科幻】')
    expect(context).toContain('【题材约束：末世】')
    expect(context).toContain('【题材约束：西幻/奇幻】')
    expect(context).toContain('【题材约束：史诗奇幻】')
    expect(context).toContain('【题材约束：黑暗奇幻】')
    expect(context.match(/【题材约束：西幻\/奇幻】/g)).toHaveLength(1)
  })

  it('旧项目单值 genre 仍兼容', () => {
    const context = buildGenreConstraintContext('xuanhuan')

    expect(context).toContain('【题材约束：玄幻】')
    expect(context).toContain('反模式')
  })
})
