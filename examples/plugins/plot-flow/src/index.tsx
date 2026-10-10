import type { ExtensionContext } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) {
  function Flow() { return <section><small>STORY WORKFLOW</small><h3>让主线从冲突中生长</h3><p>先生成故事冲突候选，再把候选交给主线节点。作者可以检查、改接和替换每一步；正式执行与采纳仍在节点工作台完成。</p><ol><li>故事冲突</li><li>主线发展</li><li>作者确认候选</li></ol><button onClick={() => ctx.flows.open('conflict-to-plot')}>预览并创建流程</button></section> }
  ctx.ui.registerView('flow', Flow)
} }
