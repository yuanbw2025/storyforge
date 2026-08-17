import { useState } from 'react'
import { BookOpen } from 'lucide-react'
import AIConfigPanel from './AIConfigPanel'
import { resetWelcomeGuide } from '../guide/WelcomeGuide'
import HarnessEvalPanel from './HarnessEvalPanel'
import CreativeReliabilityCommunityPanel from './CreativeReliabilityCommunityPanel'
import ProjectStorageWorkspacePanel from './ProjectStorageWorkspacePanel'
import type { Project } from '../../lib/types'

interface Props {
  project?: Project
  onOpenDataManagement?: () => void
}

/**
 * 设置页（Phase 4 之后）：
 * 「提示词管理」已升级为侧边栏一级菜单；这里保留 AI 配置和项目级本地偏好。
 * 项目内设置同时承载存储工作区；全局设置会诚实显示“先进入项目”。
 */
export default function SettingsPage({ project, onOpenDataManagement }: Props) {
  const [guideReset, setGuideReset] = useState(false)

  return (
    <div className="h-full overflow-auto p-6">
      <AIConfigPanel />
      <div className="mt-6">
        <ProjectStorageWorkspacePanel project={project} onOpenDataManagement={onOpenDataManagement} />
      </div>
      <CreativeReliabilityCommunityPanel />
      {import.meta.env.DEV && <HarnessEvalPanel />}

      {/* 其他设置 */}
      <div className="max-w-2xl mt-6 p-4 bg-bg-surface border border-border rounded-xl">
        <h3 className="text-sm font-semibold text-text-primary mb-3">其他</h3>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-text-secondary">新手引导</p>
            <p className="text-xs text-text-muted">重新显示首次使用时的新手引导教程</p>
          </div>
          <button
            onClick={() => { resetWelcomeGuide(); setGuideReset(true) }}
            disabled={guideReset}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-bg-elevated text-text-secondary rounded-lg hover:bg-bg-hover disabled:opacity-50 transition-colors"
          >
            <BookOpen className="w-3.5 h-3.5" />
            {guideReset ? '已重置（刷新生效）' : '重新引导'}
          </button>
        </div>
      </div>
    </div>
  )
}
