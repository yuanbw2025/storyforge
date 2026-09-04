import { describe, expect, it } from 'vitest'
import {
  buildGenreConstraintContext,
  getGenreMetadata,
  resolveGenreMetadataId,
} from '../../src/lib/ai/genre-metadata'

describe('CF-20260702-4 · 当前作品题材与题材元数据映射', () => {
  it('Work 流派 ID 通过显式映射命中共享元数据', () => {
    expect(resolveGenreMetadataId('kehuan')).toBe('scifi')
    expect(resolveGenreMetadataId('qihuan')).toBe('xifan')
    expect(resolveGenreMetadataId('xifang')).toBe('xifan')
    expect(resolveGenreMetadataId('shishi')).toBe('shishi')
    expect(resolveGenreMetadataId('heian')).toBe('heian')

    expect(getGenreMetadata('kehuan')?.label).toBe('科幻')
    expect(getGenreMetadata('qihuan')?.label).toBe('西幻/奇幻')
    expect(getGenreMetadata('shishi')?.label).toBe('史诗奇幻')
    expect(getGenreMetadata('heian')?.label).toBe('黑暗奇幻')
  })

  it('多选流派会合并注入多个题材约束，并对共享元数据去重', () => {
    const context = buildGenreConstraintContext(['kehuan', 'moshi', 'qihuan', 'xifang', 'shishi', 'heian'])

    expect(context).toContain('【题材约束：科幻】')
    expect(context).toContain('【题材约束：末世】')
    expect(context).toContain('【题材约束：西幻/奇幻】')
    expect(context).toContain('【题材约束：史诗奇幻】')
    expect(context).toContain('【题材约束：黑暗奇幻】')
    expect(context.match(/【题材约束：西幻\/奇幻】/g)).toHaveLength(1)
  })

  it('当前 Work.genres 数组可生成单项题材约束', () => {
    const context = buildGenreConstraintContext(['xuanhuan'])

    expect(context).toContain('【题材约束：玄幻】')
    expect(context).toContain('反模式')
  })
})
