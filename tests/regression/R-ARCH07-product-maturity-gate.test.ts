import { describe, expect, it } from 'vitest'
import {
  PRODUCT_CATALOG_V1,
  evaluateProductEntryV1,
} from '../../src/lib/product/product-catalog'

describe('ARCH-07 · 世界能力边界与产品成熟度入口', () => {
  it('产品身份唯一，世界引擎只拥有语义内容，上层产品自有运行态与媒资', () => {
    expect(new Set(PRODUCT_CATALOG_V1.map(item => item.id)).size).toBe(PRODUCT_CATALOG_V1.length)

    const world = PRODUCT_CATALOG_V1.find(item => item.id === 'world-engine')!
    expect(world).toMatchObject({
      family: 'world-engine',
      requiresWorldReference: false,
      ownsRuntime: false,
      ownsMedia: false,
    })

    const upperProducts = PRODUCT_CATALOG_V1.filter(item => item.family === 'upper-product')
    expect(upperProducts.length).toBeGreaterThan(0)
    expect(upperProducts.every(item => item.requiresWorldReference)).toBe(true)
    expect(upperProducts.every(item => item.ownsRuntime && item.ownsMedia)).toBe(true)

    const independentProducts = PRODUCT_CATALOG_V1.filter(item => item.family === 'independent-creation')
    expect(independentProducts.every(item => !item.requiresWorldReference)).toBe(true)
  })

  it('生产环境只开放 released，预览和内部入口只在本地/测试可见', () => {
    for (const product of PRODUCT_CATALOG_V1) {
      const decision = evaluateProductEntryV1({
        productId: product.id,
        channel: 'production',
        experimentalOptIn: true,
      })
      expect(decision.visible, product.id).toBe(product.status === 'released')
      expect(decision.enterable, product.id).toBe(decision.visible)
    }

    for (const product of PRODUCT_CATALOG_V1.filter(item => item.status === 'preview' || item.status === 'internal')) {
      const decision = evaluateProductEntryV1({ productId: product.id, channel: 'local-development' })
      expect(decision.visible, product.id).toBe(true)
      expect(decision.badge, product.id).not.toBeNull()
    }
  })

  it('实验入口即使在本地也必须显式启用，不能因代码存在而自动升级为产品承诺', () => {
    for (const product of PRODUCT_CATALOG_V1.filter(item => item.status === 'experimental')) {
      const hidden = evaluateProductEntryV1({
        productId: product.id,
        channel: 'local-development',
        experimentalOptIn: false,
      })
      expect(hidden.visible, product.id).toBe(false)
      expect(hidden.blockers.length, product.id).toBeGreaterThan(0)

      const enabled = evaluateProductEntryV1({
        productId: product.id,
        channel: 'local-development',
        experimentalOptIn: true,
      })
      expect(enabled).toMatchObject({ visible: true, enterable: true, badge: '实验' })
    }
  })
})
