import { ScrollText, X } from 'lucide-react'

interface Props {
  onAgree: () => void
  onDecline: () => void
}

/**
 * 作品学习功能法律声明 Modal —— Phase 19-a
 *
 * 用户必须显式同意才能进入作品学习库。
 * 同意结果写在 localStorage['sf-master-consent']，后续不再弹。
 *
 * 设计动机：上传白金作家作品做"方法论提炼"可能涉及著作权争议，
 * 必须让用户知情并自担风险。全程数据只在本地，不走服务器。
 */
export default function MasterLegalConsentModal({ onAgree, onDecline }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-bg-surface border border-border rounded-2xl max-w-xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <ScrollText className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-text-primary">📜 使用须知</h2>
          </div>
          <button
            onClick={onDecline}
            className="p-1.5 rounded hover:bg-bg-hover text-text-muted"
            title="不同意返回"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4 text-sm text-text-secondary leading-relaxed">
          <p>
            <strong className="text-text-primary">「作品学习」</strong>
            是一个 <em>仅供您个人学习和研究用途</em> 的功能。
            您可以上传网文、小说等作品样本，系统会调用 AI 分析其叙事结构、人物塑造、节奏、文笔等创作手法，
            并把提炼出的方法论存在您本地浏览器中，供您在自己的创作中参考。
          </p>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-text-primary font-medium mb-2">⚠️ 请在继续之前注意：</p>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                您上传的作品 <strong>仅保存在您本地浏览器 IndexedDB 中</strong>，
                不会上传到任何服务器，也不会与他人共享。
              </li>
              <li>
                AI 分析调用使用的是您自己配置的 API Key，
                文本内容会按 AI 供应商的隐私政策进行处理，请自行评估合规性。
              </li>
              <li>
                分析结果（含引用的原文片段、提炼的手法）<strong>仅限您个人学习使用</strong>，
                二次传播、复制、用于商业分发可能涉及著作权侵权，
                由您自行承担相应法律责任。
              </li>
              <li>
                建议您仅分析您合法持有副本的作品，或公共领域 / 授权允许的文本。
              </li>
            </ul>
          </div>

          <p className="text-xs text-text-muted">
            点击下方「我已阅读并同意」即视为您已知悉上述内容，并自愿承担相应责任。
            StoryForge 作为工具提供者，不对用户上传内容的合法性负责。
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border bg-bg-elevated/30">
          <button
            onClick={onDecline}
            className="px-4 py-2 rounded-lg border border-border text-sm text-text-secondary hover:bg-bg-hover"
          >
            不同意返回
          </button>
          <button
            onClick={onAgree}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm hover:opacity-90"
          >
            我已阅读并同意
          </button>
        </div>
      </div>
    </div>
  )
}
