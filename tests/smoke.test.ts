/**
 * Smoke test - 验证 vitest + happy-dom + fake-indexeddb 基础设施可用
 *
 * 如果这个测试失败 = 测试基础设施有问题,先修这个再做其他事
 */
import { describe, it, expect } from 'vitest'

describe('Smoke: 测试基础设施', () => {
  it('vitest 能跑', () => {
    expect(1 + 1).toBe(2)
  })

  it('happy-dom DOM API 可用', () => {
    const div = document.createElement('div')
    div.textContent = 'hello'
    expect(div.textContent).toBe('hello')
  })

  it('fake-indexeddb 已注入', () => {
    expect(typeof indexedDB).toBe('object')
    expect(indexedDB).not.toBeNull()
  })

  it('localStorage 可用(用户备份模块依赖)', () => {
    localStorage.setItem('test', 'ok')
    expect(localStorage.getItem('test')).toBe('ok')
    localStorage.removeItem('test')
  })
})
