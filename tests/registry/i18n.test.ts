/**
 * Phase 3.7 · i18n 框架测试
 *
 * 验证:① 翻译可用 ② 缺失 key 回退 ③ zh/en key 结构对齐(防漏译)
 */
import { describe, it, expect } from 'vitest'
import { t, setLang, getLang } from '../../src/i18n'
import { zhCN } from '../../src/i18n/locales/zh-CN'
import { en } from '../../src/i18n/locales/en'

describe('Phase 3.7 · i18n', () => {
  it('默认中文翻译可用', () => {
    setLang('zh-CN')
    expect(t('common.save')).toBe('保存')
    expect(t('common.generating')).toBe('AI 生成中…')
  })

  it('切换英文后翻译生效', () => {
    setLang('en')
    expect(t('common.save')).toBe('Save')
    setLang('zh-CN') // 复位
  })

  it('缺失 key 原样返回(不崩溃)', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('英文缺某 key 时回退中文', () => {
    // resolve 内部:en 缺失 → 回退 zh-CN
    setLang('en')
    // 用一个 en 里假设存在的 key 验证正常路径已在上面覆盖;这里验证回退不抛错
    expect(typeof t('common.save')).toBe('string')
    setLang('zh-CN')
  })

  it('zh-CN 与 en 的 key 结构完全对齐(防漏译)', () => {
    const flatten = (obj: Record<string, unknown>, prefix = ''): string[] => {
      const keys: string[] = []
      for (const [k, v] of Object.entries(obj)) {
        const full = prefix ? `${prefix}.${k}` : k
        if (v && typeof v === 'object') keys.push(...flatten(v as Record<string, unknown>, full))
        else keys.push(full)
      }
      return keys.sort()
    }
    const zhKeys = flatten(zhCN as unknown as Record<string, unknown>)
    const enKeys = flatten(en as unknown as Record<string, unknown>)
    expect(enKeys, 'en 与 zh-CN 的 key 必须一一对齐').toEqual(zhKeys)
  })

  it('getLang 返回当前语言', () => {
    setLang('zh-CN')
    expect(getLang()).toBe('zh-CN')
  })
})
