import { defineConfig } from 'vitepress'

const githubUrl = 'https://github.com/yuanbw2025/storyforge'

const zhNav = [
  { text: '知识库首页', link: '/' },
  { text: 'Prompt 与创作方法', link: '/prompts/' },
  { text: '更新日志', link: '/updates/changelog' },
  { text: 'Bug、功能与文档纠错反馈', link: '/feedback/' },
  { text: 'GitHub', link: githubUrl },
]

const zhSidebar = [
  {
    text: '开始使用',
    collapsed: false,
    items: [
      { text: '概览', link: '/getting-started/' },
      { text: 'StoryForge 是什么', link: '/getting-started/what-is-storyforge' },
      { text: '安装与启动', link: '/getting-started/install' },
      { text: '模型与 API 配置', link: '/getting-started/model-config' },
      { text: '文档站说明', link: '/getting-started/basics/site-overview' },
    ],
  },
  {
    text: '功能指南',
    collapsed: false,
    items: [
      { text: '功能指南概览', link: '/features/' },
      { text: '当前产品能力', link: '/features/current-capabilities' },
      { text: '本地记忆工作区', link: '/features/memory-workspace' },
    ],
  },
  {
    text: '使用指南',
    collapsed: false,
    items: [
      { text: '使用指南概览', link: '/guides/' },
      { text: 'Token 消耗与省钱指南', link: '/guides/token-cost' },
      { text: '常见问题', link: '/guides/faq' },
    ],
  },
  {
    text: 'Prompt 与创作方法',
    collapsed: true,
    items: [
      { text: 'Prompt 资料库说明', link: '/prompts/' },
      {
        text: 'A · 总蓝图与规范',
        collapsed: true,
        items: [
          { text: '小说 Prompt 体系总目录', link: '/prompts/a/a-index' },
          { text: 'A-1 总蓝图', link: '/prompts/a/a-1' },
          { text: 'A-2 资产结构与质量闸门', link: '/prompts/a/a-2' },
        ],
      },
      {
        text: 'B · Prompt 方法论与元提示词',
        collapsed: true,
        items: [
          { text: '小说创作 Prompt 方法论基础', link: '/prompts/b/b-foundation' },
          { text: 'B-1 创作型 Prompt 构造规则', link: '/prompts/b/b-1' },
          { text: 'B-2 创作型 Prompt 构建器', link: '/prompts/b/b-2' },
          { text: 'B-3 素材与 Prompt 适配器', link: '/prompts/b/b-3' },
          { text: 'B-4 Prompt 审查诊断与优化', link: '/prompts/b/b-4' },
          { text: 'B-5 Prompt 仿写与语义保真', link: '/prompts/b/b-5' },
          { text: 'B-6 优质 Prompt 逆向拆解', link: '/prompts/b/b-6' },
          { text: 'B-7 Prompt 流水线规划', link: '/prompts/b/b-7' },
          { text: 'B-8 SFT 优改差异归因', link: '/prompts/b/b-8' },
          { text: 'B-9 脚本反向 Prompt 构建', link: '/prompts/b/b-9' },
          { text: 'B-10 漫剧方法迁移到小说', link: '/prompts/b/b-10' },
        ],
      },
      {
        text: 'C · 小说创作流水线',
        collapsed: true,
        items: [
          { text: '调用指南', link: '/prompts/c/c-guide' },
          { text: 'P00 创作任务简报与缺口诊断', link: '/prompts/c/c-01' },
          { text: 'P01 素材净化与原创灵感卡', link: '/prompts/c/c-02' },
          { text: 'P02 题材读者承诺与差异化', link: '/prompts/c/c-03' },
          { text: 'P03 概念筛选与前提压力测试', link: '/prompts/c/c-04' },
          { text: 'P04 事实边界与创作考证', link: '/prompts/c/c-05' },
          { text: 'P05 因果型世界构建与一致性', link: '/prompts/c/c-06' },
          { text: 'P06 人物动力关系与弧线', link: '/prompts/c/c-07' },
          { text: 'P07 冲突升级信息释放与复线', link: '/prompts/c/c-08' },
          { text: 'P08 结构模型选择与全书转折', link: '/prompts/c/c-09' },
          { text: 'P09L 长篇卷级承诺复线与中段', link: '/prompts/c/c-10' },
          { text: 'P09S 短篇单一效果压缩与结尾', link: '/prompts/c/c-11' },
          { text: 'P09R 连载阅读回报断点与生产', link: '/prompts/c/c-12' },
          { text: 'P10 章节功能场景转折与情绪', link: '/prompts/c/c-13' },
          { text: 'P11 首章续写对白动作与叙述', link: '/prompts/c/c-14' },
          { text: 'P12 章节记忆事实状态时间线与伏笔', link: '/prompts/c/c-15' },
          { text: 'P13 发展性编辑因果人物与结局', link: '/prompts/c/c-16' },
          { text: 'P14 场景对白视角节奏与定向改写', link: '/prompts/c/c-17' },
          { text: 'P15 首章盲读期待兑现与贝塔模拟', link: '/prompts/c/c-18' },
          { text: 'P16 书名简介梗概标签与投稿', link: '/prompts/c/c-19' },
          { text: 'P17 运行复盘版本评测与 Prompt 生成', link: '/prompts/c/c-20' },
        ],
      },
      {
        text: 'C · 类型专项',
        collapsed: true,
        items: [
          { text: '推理：谜底线索误导与揭示', link: '/prompts/c/c-21' },
          { text: '爱情：吸引阻力亲密与结局', link: '/prompts/c/c-22' },
          { text: '成长升级：能力资源挑战与代价', link: '/prompts/c/c-23' },
          { text: '历史小说：史实锚点与时代质感', link: '/prompts/c/c-24' },
          { text: '科幻：新设定技术约束与后果', link: '/prompts/c/c-25' },
          { text: '奇幻：魔法规则神话文化与奇观', link: '/prompts/c/c-26' },
          { text: '群像：多视角角色权重与信息拼图', link: '/prompts/c/c-27' },
          { text: '现实文学：日常压力与开放意义', link: '/prompts/c/c-28' },
          { text: '恐怖：威胁未知升级与余悸', link: '/prompts/c/c-29' },
          { text: '喜剧：反差误会升级与人物尊严', link: '/prompts/c/c-30' },
        ],
      },
      {
        text: 'D · 漫剧 Prompt 工程',
        collapsed: true,
        items: [
          { text: '漫剧 Prompt 工程与质量规则', link: '/prompts/d/d-rules' },
          { text: 'D-01 逐章节摘要提取', link: '/prompts/d/d-01' },
          { text: 'D-02 起承转合阶段划分', link: '/prompts/d/d-02' },
          { text: 'D-03 情节点分组与集数分配', link: '/prompts/d/d-03' },
          { text: 'D-04 本集动态人物状态', link: '/prompts/d/d-04' },
          { text: 'D-05 伏笔呼应与视觉物理连贯', link: '/prompts/d/d-05' },
          { text: 'D-06 基于诊断结果的定向修正', link: '/prompts/d/d-06' },
          { text: 'D-07 小说素材到标准漫剧剧本', link: '/prompts/d/d-07' },
          { text: 'D-08 标准剧本到 AIGC 分镜', link: '/prompts/d/d-08' },
          { text: 'D-09 治愈系竖屏漫剧剧本', link: '/prompts/d/d-09' },
          { text: 'D-10 漫剧时长逻辑角色与制作质检', link: '/prompts/d/d-10' },
        ],
      },
    ],
  },
  {
    text: '项目动态',
    collapsed: false,
    items: [
      { text: '项目动态概览', link: '/updates/' },
      { text: '更新日志', link: '/updates/changelog' },
      { text: '历史功能更新全文', link: '/updates/historical-feature-updates' },
    ],
  },
  {
    text: 'Bug、功能与文档纠错反馈',
    collapsed: false,
    items: [
      { text: '反馈中心', link: '/feedback/' },
      { text: 'Bug 报告', link: '/feedback/bug' },
      { text: '功能建议', link: '/feedback/feature' },
      { text: '文档纠错', link: '/feedback/documentation' },
    ],
  },
  {
    text: '历史归档',
    collapsed: true,
    items: [
      { text: '2026-05-28 功能全景指南', link: '/archive/panorama-2026-05-28' },
      { text: '旧 Bug 收集', link: '/archive/legacy-bugs' },
      { text: '旧功能建议收集', link: '/archive/legacy-feature-ideas' },
    ],
  },
]

export default defineConfig({
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',
  sitemap: { hostname: 'https://docs.storyforge-lab.com' },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/brand/storyforge-mark.svg' }],
    ['meta', { name: 'theme-color', content: '#0b1d1a' }],
  ],
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
          modal: {
            displayDetails: '显示详细列表', resetButtonTitle: '清除查询', backButtonTitle: '关闭搜索', noResultsText: '没有找到相关结果',
            footer: { selectText: '选择', selectKeyAriaLabel: '回车', navigateText: '切换', navigateUpKeyAriaLabel: '向上', navigateDownKeyAriaLabel: '向下', closeText: '关闭', closeKeyAriaLabel: 'Esc' },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: '简体中文', lang: 'zh-CN', link: '/', title: 'StoryForge 官方文档', description: 'StoryForge 故事熔炉官方用户文档中心',
      themeConfig: {
        logo: '/brand/storyforge-mark.svg', siteTitle: 'StoryForge 文档', nav: zhNav, sidebar: zhSidebar,
        outline: { level: [2, 4], label: '本页目录' },
        docFooter: { prev: '上一页', next: '下一页' },
        lastUpdated: { text: '最后更新', formatOptions: { dateStyle: 'medium', timeStyle: 'short' } },
        darkModeSwitchLabel: '外观', lightModeSwitchTitle: '切换为浅色模式', darkModeSwitchTitle: '切换为深色模式', sidebarMenuLabel: '目录', returnToTopLabel: '返回顶部', langMenuLabel: '切换语言', skipToContentLabel: '跳到正文',
        socialLinks: [{ icon: 'github', link: githubUrl }],
        footer: { message: 'StoryForge · 故事熔炉官方用户文档', copyright: '文档内容以当前发布版本与仓库现状为准' },
      },
    },
    en: {
      label: 'English', lang: 'en-US', link: '/en/', title: 'StoryForge Documentation', description: 'Official StoryForge user documentation',
      themeConfig: { logo: '/brand/storyforge-mark.svg', siteTitle: 'StoryForge Docs', nav: [ { text: 'Home', link: '/en/' }, { text: 'Chinese Docs', link: '/getting-started/' }, { text: 'GitHub', link: githubUrl } ], socialLinks: [{ icon: 'github', link: githubUrl }] },
    },
  },
})
