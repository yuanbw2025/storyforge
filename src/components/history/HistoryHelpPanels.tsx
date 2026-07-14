import { HelpCircle, ShieldCheck, Sparkles } from 'lucide-react'

export function TimelineHistoryHelp() {
  return (
    <div className="space-y-4">
      <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-accent" />
          历史考证与细节助手
        </h3>
        <p className="text-xs text-text-secondary leading-relaxed">
          在历史题材创作中，细节决定了小说的质感。本系统提供双重 AI 辅助模式：
        </p>
        <div className="space-y-2.5 pt-1">
          <div className="flex gap-2">
            <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-xs shrink-0 font-bold">1</span>
            <div>
              <h4 className="text-xs font-medium text-text-primary">史实考证模式</h4>
              <p className="text-[11px] text-text-muted mt-0.5">
                输入真实历史事件（如“玄武门之变”），AI 会帮您考证具体时间、史料出处，并提供当时社会的衣食住行细节，避免常识性硬伤。
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="w-5 h-5 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center text-xs shrink-0 font-bold">2</span>
            <div>
              <h4 className="text-xs font-medium text-text-primary">虚构细节头脑风暴</h4>
              <p className="text-[11px] text-text-muted mt-0.5">
                输入虚构概念（如“主角在长安开设织布机坊”），AI 会结合唐代背景，为您头脑风暴当时的纺织工艺、行会制度、机户生活等细节，让虚构故事充满真实质感。
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-text-muted" />
          使用小贴士
        </h3>
        <ul className="text-[11px] text-text-muted space-y-1.5 list-disc pl-4">
          <li>数字化年份支持负数，如输入 <code className="bg-bg-base px-1 py-0.5 rounded font-mono">-221</code> 代表公元前 221 年（秦统一六国）。</li>
          <li>时间轴会自动按照数字化年份从小到大排序，无需手动调整。</li>
          <li>关联章节后，您可以在写作时随时调阅该章节关联的历史背景。</li>
        </ul>
      </div>
    </div>
  )
}

export function KeywordHistoryHelp() {
  return (
    <div className="space-y-4">
      <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-3">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <Sparkles className="w-4 h-4 text-accent" />
          细节风暴助手
        </h3>
        <p className="text-xs text-text-secondary leading-relaxed">
          没有相关历史知识？不用担心！细节风暴助手能帮您瞬间补充极具时代质感的细节：
        </p>
        <div className="space-y-2.5 pt-1 text-xs text-text-secondary">
          <p>• <strong>器物与科技</strong>：输入“织布机”，AI 会为您补充丝织工艺、提花楼、经纬线等专业名词和运作细节。</p>
          <p>• <strong>制度与官职</strong>：输入“科举”，AI 会为您补充锁院、糊名、誊录、考棚一日三餐等考试流程。</p>
          <p>• <strong>文化与风俗</strong>：输入“避讳”，AI 会为您补充如何避皇帝名讳、长辈名讳，以及违反的后果。</p>
          <p>• <strong>社会与经济</strong>：输入“飞钱”，AI 会为您补充唐代信用货币的运作、兑换手续和商业影响。</p>
          <p>• <strong>地理与建筑</strong>：输入“园林”，AI 会为您补充造园美学、名贵花木、文人雅集等场景细节。</p>
        </div>
      </div>

      <div className="bg-bg-surface border border-border rounded-2xl p-5 space-y-2">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-1.5">
          <HelpCircle className="w-4 h-4 text-text-muted" />
          使用小贴士
        </h3>
        <ul className="text-[11px] text-text-muted space-y-1.5 list-disc pl-4">
          <li>您可以随时通过顶部的分类和历史时期筛选框，快速找到需要的关键词。</li>
          <li>头脑风暴生成的结果会永久保存在本地，写作时可随时作为参考。</li>
          <li>关联章节后，这些细节会在您写作对应章节时提供强大的背景支持。</li>
        </ul>
      </div>
    </div>
  )
}
