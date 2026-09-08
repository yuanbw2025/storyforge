import { describe, expect, it, vi } from 'vitest'
import {
  loadCommunityPrototypeCatalogV1,
  loadCommunityPrototypeReleaseBundleV1,
  parseCommunityPrototypeCatalogV1,
} from '../../src/lib/product-platform/community-prototype-catalog'

function catalog(overrides: Record<string, unknown> = {}) {
  return {
    schema: 'storyforge.community-prototype-catalog', version: 1,
    prototypes: [{
      prototypeId: 'tidewake-town.v1', productType: 'ai-town',
      title: '《潮痕灯塔》后日谈：回潮镇', summary: '完整的后日谈小镇原型。',
      version: '1.0.0', language: 'zh-CN', maturity: 'community-prototype',
      releasePath: '/prototypes/tidewake-town/release.storyforge-product.json',
      heroPath: '/prototypes/tidewake-town/media/town-overview.png',
      galleryPaths: ['/prototypes/tidewake-town/media/tide-clinic.png'],
      featureHighlights: ['冻结世界来源', '真实媒资'], contentWarnings: ['战争后创伤'],
      ...overrides,
    }],
  }
}

describe('R-PROTOTYPE-1 · same-origin community prototype catalog', () => {
  it('严格解析可扩展原型目录并保留 AI 小镇产品身份', () => {
    expect(parseCommunityPrototypeCatalogV1(catalog(), 'http://127.0.0.1:1111')).toMatchObject({
      schema: 'storyforge.community-prototype-catalog', version: 1,
      prototypes: [{
        prototypeId: 'tidewake-town.v1', productType: 'ai-town', maturity: 'community-prototype',
        releasePath: '/prototypes/tidewake-town/release.storyforge-product.json',
      }],
    })
  })

  it('拒绝跨源、目录外路径、未知字段和重复身份', () => {
    expect(() => parseCommunityPrototypeCatalogV1(catalog({
      releasePath: 'https://evil.example/release.json',
    }), 'http://127.0.0.1:1111')).toThrow(/同源/)
    expect(() => parseCommunityPrototypeCatalogV1(catalog({
      heroPath: '/assets/hero.png',
    }), 'http://127.0.0.1:1111')).toThrow(/prototypes/)
    const unknown = catalog() as Record<string, unknown>
    unknown.secret = true
    expect(() => parseCommunityPrototypeCatalogV1(unknown, 'http://127.0.0.1:1111'))
      .toThrow(/严格合同/)
    const repeated = catalog()
    repeated.prototypes.push(structuredClone(repeated.prototypes[0]))
    expect(() => parseCommunityPrototypeCatalogV1(repeated, 'http://127.0.0.1:1111'))
      .toThrow(/prototypeId 重复/)
  })

  it('目录与发行包读取固定使用同源、无凭据和有界 JSON', async () => {
    const fetcher = vi.fn(async (target: RequestInfo | URL) => new Response(
      String(target).endsWith('/catalog.json') ? JSON.stringify(catalog()) : JSON.stringify({ bundle: true }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    const result = await loadCommunityPrototypeCatalogV1({
      fetcher, pageOrigin: 'http://127.0.0.1:1111', basePath: '/',
    })
    await expect(loadCommunityPrototypeReleaseBundleV1({
      entry: result.prototypes[0], fetcher, pageOrigin: 'http://127.0.0.1:1111', basePath: '/',
    })).resolves.toEqual({ bundle: true })
    expect(fetcher.mock.calls.map(call => String(call[0]))).toEqual([
      'http://127.0.0.1:1111/prototypes/catalog.json',
      'http://127.0.0.1:1111/prototypes/tidewake-town/release.storyforge-product.json',
    ])
    for (const call of fetcher.mock.calls) expect(call[1]).toMatchObject({
      credentials: 'omit', mode: 'same-origin', redirect: 'error', referrerPolicy: 'no-referrer',
    })
  })
})
