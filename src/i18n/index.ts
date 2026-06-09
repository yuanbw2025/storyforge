/**
 * 极简零依赖 i18n(Phase 3.7 · 框架预留)
 *
 * 为什么不用 react-i18next:项目当前无真实多语言需求,装重库会增包体积(刚做完性能优化)。
 * 这套零依赖方案提供 t() + useTranslation + 语言切换 + 类型安全的 key,
 * 当真正需要全量多语言时,可按 docs/refactor/I18N-GUIDE.md 平滑升级到 react-i18next。
 *
 * 用法:
 *   const { t } = useTranslation()
 *   <button>{t('common.save')}</button>
 */
import { useSyncExternalStore } from 'react'
import { zhCN } from './locales/zh-CN'
import { en } from './locales/en'

export type LangCode = 'zh-CN' | 'en'

const LOCALES = { 'zh-CN': zhCN, en } as const
const STORAGE_KEY = 'sf_lang'

function detectInitialLang(): LangCode {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'zh-CN' || saved === 'en') return saved
    // 浏览器语言:非中文环境默认英文,否则中文
    if (typeof navigator !== 'undefined' && !navigator.language.toLowerCase().startsWith('zh')) {
      return 'en'
    }
  } catch { /* ignore */ }
  return 'zh-CN'
}

let currentLang: LangCode = detectInitialLang()
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

/** 切换语言(持久化 + 通知所有订阅组件重渲染) */
export function setLang(lang: LangCode) {
  if (lang === currentLang) return
  currentLang = lang
  try { localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
  notify()
}

export function getLang(): LangCode {
  return currentLang
}

/** 按点路径取嵌套 key,如 'common.save'。缺失时回退中文,再缺失则原样返回 key。 */
function resolve(lang: LangCode, key: string): string {
  const get = (obj: unknown): string | undefined => {
    let cur: unknown = obj
    for (const part of key.split('.')) {
      if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[part]
      } else return undefined
    }
    return typeof cur === 'string' ? cur : undefined
  }
  return get(LOCALES[lang]) ?? get(LOCALES['zh-CN']) ?? key
}

/** 非组件环境直接翻译(如 store/util) */
export function t(key: string): string {
  return resolve(currentLang, key)
}

/** React hook:语言变化时自动重渲染 */
export function useTranslation() {
  const lang = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb) },
    () => currentLang,
    () => currentLang,
  )
  return {
    lang,
    setLang,
    t: (key: string) => resolve(lang, key),
  }
}
