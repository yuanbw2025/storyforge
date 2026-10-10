import { useState } from 'react'
import type { ExtensionContext } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) {
  function Tools() { const [query,setQuery]=useState('灯塔'); return <section><h3>让本机工具参与创作</h3><p>先启动配置好的 MCP 本机桥，再提交查询；无需把令牌交给插件。</p><label>资料问题<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button onClick={()=>ctx.tools.open('local','lookup',{query})}>检查工具请求</button></section> }
  ctx.ui.registerView('tools',Tools)
} }
