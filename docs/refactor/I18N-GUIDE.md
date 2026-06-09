# i18n 迁移指南（Phase 3.7 预留 → 全量多语言）

> 当前状态:**框架已预留,未全量迁移**。项目 UI 文案大量硬编码中文(~108 组件)。
> 本指南说明如何从"框架预留"渐进到"全量多语言"。

---

## 现状

- `src/i18n/` 零依赖 i18n 基础设施已就位:
  - `index.ts` — `t()` / `useTranslation()` / `setLang()` / `getLang()`
  - `locales/zh-CN.ts` — 中文资源(默认,目前只收录通用高频文案)
  - `locales/en.ts` — 英文资源(结构与 zh-CN 对齐,CI 测试守护)
- 语言自动检测:非中文浏览器默认英文,可手动切换并持久化(localStorage `sf_lang`)。
- 测试 `tests/registry/i18n.test.ts` 守护:翻译可用 + 缺失回退 + **zh/en key 结构必须一一对齐**(防漏译)。

## 为什么零依赖,不用 react-i18next

- 项目当前无真实多语言需求(纯中文用户)。
- 刚做完性能优化(Phase 3.5),装重库会增包体积。
- 零依赖版已满足"预留"语义:有 t()、有切换、有类型安全、有迁移路径。

## 用法

```tsx
import { useTranslation } from '../i18n'

function Toolbar() {
  const { t, lang, setLang } = useTranslation()
  return (
    <>
      <button>{t('common.save')}</button>
      <button onClick={() => setLang(lang === 'zh-CN' ? 'en' : 'zh-CN')}>
        {lang === 'zh-CN' ? 'EN' : '中'}
      </button>
    </>
  )
}
```

非组件环境(store/util):`import { t } from '../i18n'; t('common.save')`。

## 全量迁移步骤(渐进,可分多个 PR)

1. **逐面板抽文案**:把组件里的硬编码中文搬到 `locales/zh-CN.ts`,按 `<域>.<语义>` 命名(如 `chapter.generate`),组件改用 `t('chapter.generate')`。
2. **同步补英文**:每加一个 zh key,必须在 `locales/en.ts` 加对应 key,否则 `i18n.test.ts` 的"key 对齐"测试会红。
3. **大资源拆分**:文案变多后,把 `zh-CN.ts` 按域拆成 `locales/zh-CN/common.ts`、`chapter.ts` 等,index 合并。
4. **(可选)升级 react-i18next**:当需要复数、插值、按需加载语言包等高级特性时,把 `index.ts` 的 `t/useTranslation` 实现换成 react-i18next 适配器,**调用方 `t('key')` 写法不变**(这是零依赖版预留的迁移价值)。

## 优先迁移顺序建议

1. `common.*` 通用按钮/状态(已起步)
2. 侧栏导航 `nav.*`(已起步)
3. 设置页 / 导出页(国际用户最先接触)
4. 各创作面板(量大,可慢慢来)

## 守护

- `tests/registry/i18n.test.ts` 强制 zh/en key 对齐 —— 加了中文不补英文会 CI 红。
- 不必一次迁完;每个 PR 迁一部分,缺失的 key 运行时回退中文,不影响功能。
