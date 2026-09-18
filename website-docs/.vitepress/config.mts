import { defineConfig } from 'vitepress'

const githubUrl = 'https://github.com/yuanbw2025/storyforge'

const zhNav = [
  { text: '首页', link: '/' },
  { text: '文档', link: '/getting-started/' },
  { text: '更新日志', link: '/updates/changelog' },
  { text: 'GitHub', link: githubUrl },
]

const zhSidebar = [
  {
    text: '开始使用',
    collapsed: false,
    items: [
      { text: '概览', link: '/getting-started/' },
      {
        text: '基础说明',
        collapsed: false,
        items: [
          { text: '文档站说明', link: '/getting-started/basics/site-overview' },
        ],
      },
    ],
  },
  {
    text: '功能指南',
    collapsed: false,
    items: [{ text: '功能指南概览', link: '/features/' }],
  },
  {
    text: '使用指南',
    collapsed: false,
    items: [{ text: '使用指南概览', link: '/guides/' }],
  },
  {
    text: '项目动态',
    collapsed: false,
    items: [
      { text: '项目动态概览', link: '/updates/' },
      { text: '更新日志', link: '/updates/changelog' },
    ],
  },
  {
    text: '反馈',
    collapsed: false,
    items: [{ text: '反馈入口', link: '/feedback/' }],
  },
]

export default defineConfig({
  cleanUrls: true,
  lastUpdated: true,
  appearance: 'dark',
  sitemap: {
    hostname: 'https://docs.storyforge-lab.com',
  },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/brand/storyforge-mark.svg' }],
    ['meta', { name: 'theme-color', content: '#0b1d1a' }],
  ],
  themeConfig: {
    search: {
      provider: 'local',
      options: {
        translations: {
          button: {
            buttonText: '搜索文档',
            buttonAriaLabel: '搜索文档',
          },
          modal: {
            displayDetails: '显示详细列表',
            resetButtonTitle: '清除查询',
            backButtonTitle: '关闭搜索',
            noResultsText: '没有找到相关结果',
            footer: {
              selectText: '选择',
              selectKeyAriaLabel: '回车',
              navigateText: '切换',
              navigateUpKeyAriaLabel: '向上',
              navigateDownKeyAriaLabel: '向下',
              closeText: '关闭',
              closeKeyAriaLabel: 'Esc',
            },
          },
        },
        locales: {
          en: {
            translations: {
              button: {
                buttonText: 'Search',
                buttonAriaLabel: 'Search documentation',
              },
              modal: {
                displayDetails: 'Display detailed results',
                resetButtonTitle: 'Reset search',
                backButtonTitle: 'Close search',
                noResultsText: 'No results found',
              },
            },
          },
        },
      },
    },
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      link: '/',
      title: 'StoryForge 官方文档',
      description: 'StoryForge 故事熔炉官方用户文档中心',
      themeConfig: {
        logo: '/brand/storyforge-mark.svg',
        siteTitle: 'StoryForge 文档',
        nav: zhNav,
        sidebar: zhSidebar,
        outline: { level: [2, 4], label: '本页目录' },
        docFooter: {
          prev: '上一页',
          next: '下一页',
        },
        lastUpdated: {
          text: '最后更新',
          formatOptions: {
            dateStyle: 'medium',
            timeStyle: 'short',
          },
        },
        darkModeSwitchLabel: '外观',
        lightModeSwitchTitle: '切换为浅色模式',
        darkModeSwitchTitle: '切换为深色模式',
        sidebarMenuLabel: '目录',
        returnToTopLabel: '返回顶部',
        langMenuLabel: '切换语言',
        skipToContentLabel: '跳到正文',
        socialLinks: [{ icon: 'github', link: githubUrl }],
        footer: {
          message: 'StoryForge · 故事熔炉官方用户文档',
          copyright: '文档内容以当前发布版本为准',
        },
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'StoryForge Documentation',
      description: 'Official StoryForge user documentation',
      themeConfig: {
        logo: '/brand/storyforge-mark.svg',
        siteTitle: 'StoryForge Docs',
        nav: [
          { text: 'Home', link: '/en/' },
          { text: 'Documentation', link: '/getting-started/' },
          { text: 'Changelog', link: '/updates/changelog' },
          { text: 'GitHub', link: githubUrl },
        ],
        socialLinks: [{ icon: 'github', link: githubUrl }],
      },
    },
  },
})
