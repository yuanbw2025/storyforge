/**
 * 中文语言资源(Phase 3.7 · i18n 框架预留)
 *
 * 这是默认语言。项目当前 UI 文案大量硬编码在组件里,本文件先收录【通用高频文案】作为
 * i18n 迁移的起点。后续按 docs/refactor/I18N-GUIDE.md 逐面板把硬编码文案搬到这里。
 *
 * key 命名约定:`<域>.<语义>`,如 common.save / chapter.generate。
 */
export const zhCN = {
  common: {
    save: '保存',
    cancel: '取消',
    delete: '删除',
    confirm: '确定',
    edit: '编辑',
    add: '新增',
    close: '关闭',
    loading: '加载中…',
    generating: 'AI 生成中…',
    generate: 'AI 生成',
    export: '导出',
    import: '导入',
    search: '搜索',
    retry: '重试',
    copy: '复制',
    copied: '已复制',
    deleteConfirm: '此操作不可恢复,确定删除吗?',
    panelLoading: '面板加载中…',
  },
  nav: {
    info: '著作信息',
    worldview: '世界观',
    characters: '角色',
    outline: '大纲',
    chapters: '章节',
    settings: '设置',
  },
}

/** 把所有叶子节点类型放宽为 string(否则 as const 会把中文锁成字面量,en 无法实现) */
type DeepString<T> = { [K in keyof T]: T[K] extends object ? DeepString<T[K]> : string }

/** 资源类型(en.ts 必须实现同样结构,保证 key 对齐) */
export type Locale = DeepString<typeof zhCN>
