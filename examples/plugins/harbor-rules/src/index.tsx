import type {ExtensionContext} from '@storyforge/plugin-sdk'
export default {activate(ctx:ExtensionContext){function Rules(){return <section><h3>为你的团局选择规则</h3><p>此包提供基于 StoryForge 原创轻量规则的独立版本。请先在工坊选中跑团作品，确认导入后再到跑团制作中选择它。</p><button onClick={()=>ctx.rules.install('harbor')}>检查并导入雾港规则</button></section>}ctx.ui.registerView('rules',Rules)}}
