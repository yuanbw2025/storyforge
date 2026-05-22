/**
 * 新手引导组件 — 首次使用时展示分步引导
 * 步骤：1.欢迎 → 2.配置AI → 3.创建项目 → 4.功能导览
 * 使用 localStorage 记录是否已完成引导
 */
import { useState, useEffect } from 'react'
import { Flame, Settings, BookOpen, Sparkles, ChevronRight, ChevronLeft, X, Check } from 'lucide-react'

const GUIDE_KEY = 'storyforge_guide_completed'

interface Props {
  onGoSettings?: () => void
  onDismiss?: () => void
}

const STEPS = [
  {
    icon: Flame,
    title: '欢迎来到 StoryForge',
    color: 'text-accent',
    content: [
      '故事熔炉是一款 AI 辅助长篇小说写作工具，帮助你从构思到成稿，全流程管理创作。',
      '所有数据存储在浏览器本地（IndexedDB），无需注册账号，零数据泄露风险。',
      '接下来的几步将帮助你快速上手。',
    ],
  },
  {
    icon: Settings,
    title: '第一步：配置 AI',
    color: 'text-yellow-400',
    content: [
      '在使用 AI 功能前，需要先配置 API 密钥。',
      '支持的 AI 服务商：OpenAI、DeepSeek、通义千问、Moonshot、智谱 GLM、自定义 OpenAI 兼容接口。',
      '进入「设置」页面，选择 AI 服务商，填入 API Key 和模型名称，点击测试连接。',
      '推荐：DeepSeek 性价比高（约 ¥1/百万 token），适合长篇写作。',
    ],
    tip: '如果遇到 CORS 错误，可在设置中开启代理模式（开发环境），或使用中转 API 地址。',
  },
  {
    icon: BookOpen,
    title: '第二步：创建项目',
    color: 'text-green-400',
    content: [
      '回到首页，点击「新建项目」，输入书名、选择流派、设定目标字数。',
      '创建后进入工作区，左侧栏展示所有模块。',
      '建议的使用顺序：',
    ],
    steps: [
      '设定库 → 填写世界观、角色设定',
      '故事设计 → 确定核心冲突和主题',
      '大纲 → 搭建故事骨架',
      '细纲 → 细化每章场景',
      '正文 → AI 辅助生成和润色',
    ],
  },
  {
    icon: Sparkles,
    title: '核心功能速览',
    color: 'text-pink-400',
    content: [
      'AI 写作：生成正文、续写、扩写、润色、去AI味，支持自定义指令。',
      '状态表：自动追踪角色/地点/物品的状态变化，写作时按需注入上下文。',
      '情感节拍：写章前规划情感弧线，让AI生成更有层次感的内容。',
      '伏笔管理：跟踪伏笔的埋设和回收，避免遗漏。',
      '上下文快照：生成项目状态摘要，跨章节保持连贯性。',
      '数据管理：支持备份/恢复/导出，数据安全无忧。',
    ],
    tip: '每个功能都有详细的错误日志，遇到问题可打开浏览器控制台（F12）查看。',
  },
]

export default function WelcomeGuide({ onGoSettings, onDismiss }: Props) {
  const [visible, setVisible] = useState(false)
  const [step, setStep] = useState(0)

  useEffect(() => {
    try {
      const completed = localStorage.getItem(GUIDE_KEY)
      if (!completed) {
        setVisible(true)
        console.log('[WelcomeGuide] 首次访问，展示引导')
      }
    } catch (err) {
      console.error('[WelcomeGuide] 读取引导状态失败:', err)
    }
  }, [])

  const handleComplete = () => {
    try {
      localStorage.setItem(GUIDE_KEY, String(Date.now()))
      console.log('[WelcomeGuide] 引导完成')
    } catch (err) {
      console.error('[WelcomeGuide] 写入引导状态失败:', err)
    }
    setVisible(false)
    onDismiss?.()
  }

  const handleSkip = () => {
    handleComplete()
  }

  if (!visible) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[100] p-4 animate-in fade-in duration-200"
      onClick={e => e.target === e.currentTarget && handleSkip()}>
      <div className="bg-bg-surface border border-border rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        {/* 进度条 */}
        <div className="h-1 bg-bg-elevated">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        {/* 头部 */}
        <div className="px-6 pt-6 pb-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-bg-elevated ${current.color}`}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">{current.title}</h2>
              <span className="text-[10px] text-text-muted">
                {step + 1} / {STEPS.length}
              </span>
            </div>
          </div>
          <button onClick={handleSkip}
            className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
            title="跳过引导">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="px-6 py-4 space-y-3 min-h-[200px]">
          {current.content.map((text, idx) => (
            <p key={idx} className="text-sm text-text-secondary leading-relaxed">{text}</p>
          ))}

          {current.steps && (
            <ol className="space-y-1.5 pl-1">
              {current.steps.map((s, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent/15 text-accent text-[10px] flex items-center justify-center mt-0.5 font-bold">
                    {idx + 1}
                  </span>
                  {s}
                </li>
              ))}
            </ol>
          )}

          {current.tip && (
            <div className="mt-3 p-3 bg-warning/5 border border-warning/20 rounded-lg text-xs text-warning">
              💡 {current.tip}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button
            onClick={handleSkip}
            className="text-xs text-text-muted hover:text-text-primary transition-colors"
          >
            跳过引导
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep(step - 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-secondary hover:text-text-primary rounded-lg hover:bg-bg-hover transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> 上一步
              </button>
            )}
            {step === 1 && onGoSettings && (
              <button
                onClick={() => { handleComplete(); onGoSettings() }}
                className="flex items-center gap-1 px-3 py-1.5 text-sm bg-yellow-500/10 text-yellow-400 rounded-lg hover:bg-yellow-500/20 transition-colors"
              >
                <Settings className="w-3.5 h-3.5" /> 前往设置
              </button>
            )}
            <button
              onClick={() => isLast ? handleComplete() : setStep(step + 1)}
              className="flex items-center gap-1 px-4 py-1.5 text-sm bg-accent text-white rounded-lg hover:bg-accent-hover transition-colors font-medium"
            >
              {isLast ? (
                <><Check className="w-3.5 h-3.5" /> 开始创作</>
              ) : (
                <>下一步 <ChevronRight className="w-3.5 h-3.5" /></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 重置引导状态（供设置页面使用） */
export function resetWelcomeGuide() {
  try {
    localStorage.removeItem(GUIDE_KEY)
    console.log('[WelcomeGuide] 引导状态已重置')
  } catch (err) {
    console.error('[WelcomeGuide] 重置失败:', err)
  }
}

/** 检查是否已完成引导 */
export function isGuideCompleted(): boolean {
  try {
    return !!localStorage.getItem(GUIDE_KEY)
  } catch {
    return false
  }
}
