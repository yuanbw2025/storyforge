import { readFile } from 'node:fs/promises'
import JSZip from 'jszip'
import { expect, test, type Page } from '@playwright/test'
import { createLongform, createWorld } from './helpers/product-entry'

async function openWorkshop(page: Page, project: string, owner = 'work') {
  await page.goto(`./workshop/discover?project=${project}&owner=${owner}`)
  const preview = page.getByRole('button', { name: '开启工坊开发预览' })
  await expect(preview.or(page.getByTestId('plugin-workshop'))).toBeVisible()
  if (await preview.isVisible()) await preview.click()
  await expect(page.getByTestId('plugin-workshop')).toBeVisible()
}
async function install(page: Page, name: string) {
  const card = page.locator('.sf-workshop-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await card.getByRole('button', { name: '下载并安装' }).click()
  await expect(card.getByRole('button', { name: '已安装此版本' })).toBeVisible()
}
async function enable(page: Page, name: string) {
  await page.getByRole('link', { name: '已安装', exact: true }).click()
  const card = page.locator('.sf-workshop-card').filter({ has: page.getByRole('heading', { name, exact: true }) })
  await card.getByRole('button', { name: '启用', exact: true }).click()
  await page.getByRole('button', { name: '信任并启用', exact: true }).click()
  await expect(card.getByRole('button', { name: '停用', exact: true })).toBeVisible()
}
test('independent plugin package persists author notes through refresh, safe startup and uninstall/reinstall', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message))
  await createLongform(page, '插件隔离验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openWorkshop(page, project)
  await install(page, '创作便笺'); await enable(page, '创作便笺')
  await page.getByRole('link', { name: '插件工作台', exact: true }).click()
  await page.getByRole('button', { name: '创作便笺', exact: true }).click()
  await page.getByLabel('插件创作便笺').fill('第三章：让守钟人主动放下钥匙。')
  await page.getByRole('button', { name: '保存便笺', exact: true }).click()
  await expect(page.getByText('已保存到这部作品。')).toBeVisible()
  await page.reload(); await page.getByRole('button', { name: '创作便笺', exact: true }).click()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue('第三章：让守钟人主动放下钥匙。')
  await page.getByRole('button', { name: '安全模式', exact: true }).click()
  await expect(page.getByText('安全模式已开启', { exact: false })).toBeVisible()
  await page.getByRole('link', { name: '插件工作台', exact: true }).click()
  await expect(page.getByLabel('插件创作便笺')).toHaveCount(0)
  await page.getByRole('button', { name: '退出安全模式', exact: true }).click()
  const card = page.locator('.sf-workshop-card').filter({ has: page.getByRole('heading', { name: '创作便笺', exact: true }) })
  await card.getByRole('button', { name: '停用', exact: true }).click()
  await card.getByRole('button', { name: '卸载', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '卸载', exact: true }).click()
  await expect(page.getByText('缺少安装包：storyforge.writing-notes@1.0.0')).toBeVisible()
  await page.getByRole('link', { name: '发现插件', exact: true }).click()
  await install(page, '创作便笺'); await enable(page, '创作便笺')
  await page.getByRole('link', { name: '插件工作台', exact: true }).click()
  await page.getByRole('button', { name: '创作便笺', exact: true }).click()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue('第三章：让守钟人主动放下钥匙。')
  expect(errors).toEqual([])
  await page.screenshot({ path: '/tmp/storyforge-plugin-notes.png', fullPage: true })
})
test('world timeline replaces core panel, composes calendar service and preserves downstream events after disable', async ({ page }) => {
  await createWorld(page, '插件年表世界')
  const project = new URL(page.url()).searchParams.get('project')!
  await openWorkshop(page, project, 'world'); await install(page, '世界历史工作台'); await enable(page, '世界历史工作台')
  await page.goto(`./world/history?project=${project}`)
  await expect(page.getByRole('heading', { name: '世界的时间，正在展开' })).toBeVisible()
  await page.getByText('新增历史事件', { exact: true }).click()
  await page.getByLabel('事件名称').fill('灯塔建立')
  await page.getByLabel('年份或时间').fill('125')
  await page.getByLabel('事件内容').fill('岸边的人们共同修建了第一座灯塔。')
  await page.getByRole('button', { name: '保存历史事件' }).click()
  await expect(page.getByRole('heading', { name: '灯塔建立' })).toBeVisible()
  await expect(page.getByText('新纪 125 年', { exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/storyforge-plugin-timeline.png', fullPage: true })
  await page.goto(`./workshop/installed?project=${project}&owner=world`)
  await page.locator('.sf-workshop-card').filter({ has: page.getByRole('heading', { name: '世界历史工作台', exact: true }) }).getByRole('button', { name: '停用' }).click()
  await page.goto(`./world/history?project=${project}`)
  await expect(page.getByRole('heading', { name: '世界的时间，正在展开' })).toHaveCount(0)
  await expect(page.getByText('灯塔建立', { exact: true }).first()).toBeVisible()
})
test('workshop remains usable on narrow screens and packages need no runtime network dependency', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  await openWorkshop(page, '0')
  await expect(page.getByRole('heading', { name:'创作便笺', exact:true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(392)
  await page.screenshot({ path:'/tmp/storyforge-plugin-workshop-mobile.png',fullPage:true })
})

test('plugin workflow creates a durable editable graph without executing AI, external capability stays separately declared', async ({ page }) => {
  await createLongform(page, '流程与外部资料验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openWorkshop(page, project); await install(page, '冲突驱动的情节流程'); await enable(page, '冲突驱动的情节流程')
  await page.getByRole('link', { name:'插件工作台', exact:true }).click()
  await page.getByRole('button', { name:'情节生成流程', exact:true }).click()
  await page.getByRole('button', { name:'预览并创建流程', exact:true }).click()
  await page.getByRole('button', { name:'创建流程并打开节点工作台', exact:true }).click()
  await expect(page.getByRole('button', { name:'从冲突到主线', exact:true })).toBeVisible()
  await openWorkshop(page, project); await install(page, '资料检索台'); await enable(page, '资料检索台')
  await page.route('https://en.wikipedia.org/w/api.php?**', route => route.fulfill({json:['lighthouse',['Lighthouse'],[''],['https://en.wikipedia.org/wiki/Lighthouse']]}))
  await page.getByRole('link', { name:'插件工作台', exact:true }).click()
  await page.getByRole('button', { name:'资料检索台', exact:true }).click()
  await page.getByLabel('检索资料关键词').fill('lighthouse')
  await page.getByRole('button', {name:'查询公开资料',exact:true}).click()
  await expect(page.getByRole('heading', {name:'Lighthouse',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'保存资料链接',exact:true}).click()
  await expect(page.getByText('链接已保存到本作品的插件内容中。')).toBeVisible()
})


test('installation does not execute code and safe startup skips evaluation before activation', async ({ page }) => {
  await createLongform(page, '故障隔离验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openWorkshop(page, project)
  const zip = await JSZip.loadAsync(await readFile('public/workshop/packages/storyforge.writing-notes-1.0.0.sfplugin'))
  const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  manifest.id = 'test.failure'; manifest.name = '故障测试插件'
  zip.file('manifest.json',JSON.stringify(manifest))
  zip.file('main.js','globalThis.__sfFaultEvaluated = true; throw new Error("FAULT_TEST"); export default function(){}')
  await page.getByLabel('安装插件文件').setInputFiles({name:'failure.sfplugin',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})})
  await expect(page.getByText('故障测试插件 已安装，尚未执行', {exact:false})).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(globalThis,'__sfFaultEvaluated'))).toBeUndefined()
  await enable(page,'故障测试插件')
  expect(await page.evaluate(() => Reflect.get(globalThis,'__sfFaultEvaluated'))).toBeUndefined()
  await page.goto(`./workshop/workbench?project=${project}&owner=work&safe-plugins=1`)
  await expect(page.getByText('此作用域尚未启用工作台插件', {exact:false})).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(globalThis,'__sfFaultEvaluated'))).toBeUndefined()
  await page.goto(`./workshop/workbench?project=${project}&owner=work`)
  await expect(page.getByRole('alert').filter({hasText:'FAULT_TEST'})).toBeVisible()
  expect(await page.evaluate(() => Reflect.get(globalThis,'__sfFaultEvaluated'))).toBe(true)
  await page.getByRole('link',{name:'已安装',exact:true}).click()
  await page.locator('.sf-workshop-card').filter({has:page.getByRole('heading',{name:'故障测试插件'})}).getByRole('button',{name:'停用',exact:true}).click()
  await expect(page.getByRole('button',{name:'启用',exact:true})).toBeVisible()
})

test('production build loads shared React plugins under CSP without unsafe-eval', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW !== '1', 'CSP acceptance requires a production bundle')
  await page.route('**/storyforge/**', async route => {
    if (route.request().resourceType() !== 'document') return route.continue()
    const response = await route.fetch()
    await route.fulfill({response,headers:{...response.headers(),'Content-Security-Policy':"script-src 'self' blob:; object-src 'none'; base-uri 'self'"}})
  })
  await createLongform(page, '生产 CSP 验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openWorkshop(page,project); await install(page,'创作便笺'); await enable(page,'创作便笺')
  await page.getByRole('link',{name:'插件工作台',exact:true}).click()
  await page.getByRole('button',{name:'创作便笺',exact:true}).click()
  await page.getByLabel('插件创作便笺').fill('严格 CSP 下仍能保存')
  await page.getByRole('button',{name:'保存便笺',exact:true}).click()
  await expect(page.getByText('已保存到这部作品。')).toBeVisible()
})

test('installed plugins work offline through the production PWA after a cold navigation', async ({ browser, baseURL }) => {
  test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW !== '1', 'PWA acceptance requires generated service worker')
  // A secure .localhost origin exercises normal PWA registration; exact localhost deliberately cleans old service workers.
  const context = await browser.newContext({baseURL:baseURL!.replace('127.0.0.1','plugins.localhost')})
  const page = await context.newPage()
  try {
  await createLongform(page,'离线插件验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openWorkshop(page,project); await install(page,'创作便笺'); await enable(page,'创作便笺')
  await page.getByRole('link',{name:'插件工作台',exact:true}).click()
  await page.getByRole('button',{name:'创作便笺',exact:true}).click()
  await page.getByLabel('插件创作便笺').fill('断网后继续写作')
  await page.getByRole('button',{name:'保存便笺',exact:true}).click()
  await expect(page.getByText('已保存到这部作品。')).toBeVisible()
  await page.evaluate(async () => { await navigator.serviceWorker.ready })
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {timeout:45000}).toBe(true)
  await context.setOffline(true)
  await page.reload()
  await page.getByRole('button',{name:'创作便笺',exact:true}).click()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue('断网后继续写作')
  await page.getByLabel('插件创作便笺').fill('离线编辑也保存')
  await page.getByRole('button',{name:'保存便笺',exact:true}).click()
  await expect(page.getByText('已保存到这部作品。')).toBeVisible()
  await context.setOffline(false)
  } finally { await context.close() }
})


test('first-run examples create separate workspaces with real composed plugins', async ({ page }) => {
  await openWorkshop(page,'0')
  await page.getByRole('button',{name:'创建体验作品',exact:true}).click()
  await page.getByRole('button',{name:'创建并启用参考插件',exact:true}).click()
  await expect(page.getByText('体验内容已创建。', {exact:false})).toBeVisible()
  await page.getByRole('button',{name:'创作便笺',exact:true}).click()
  await expect(page.getByLabel('插件创作便笺')).toHaveValue(/欢迎体验独立插件/)
  await page.getByRole('link',{name:'发现插件',exact:true}).click()
  await page.getByRole('button',{name:'创建体验世界',exact:true}).click()
  await page.getByRole('button',{name:'创建并启用参考插件',exact:true}).click()
  await expect(page.getByRole('heading',{name:'世界的时间，正在展开'})).toBeVisible()
  await expect(page.getByRole('heading',{name:'雾海中的来信'})).toBeVisible()
})

test('independent AI plugin keeps editable candidates and terminal history after plugin removal', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge-ai-config',JSON.stringify({provider:'openai',baseUrl:'https://plugin-ai.invalid/v1',model:'gpt-4o',temperature:0.2,maxTokens:4000}))
    sessionStorage.setItem('storyforge-ai-api-key-session','isolated-test-key')
  })
  let calls = 0
  await page.route('https://plugin-ai.invalid/**',async route => {
    calls++
    expect(JSON.stringify(route.request().postDataJSON())).toContain('构思')
    await route.fulfill({json:{choices:[{message:{role:'assistant',content:JSON.stringify({title:'灯塔的选择',premise:'守灯人收到最后一封信。',turn:'她决定公开航线。'})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:100,total_tokens:200}}})
  })
  await createLongform(page,'插件 AI 隔离验收')
  const project = new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
  await openWorkshop(page,project); await install(page,'灵感卡片 AI'); await enable(page,'灵感卡片 AI')
  await page.getByRole('link',{name:'插件工作台',exact:true}).click()
  await page.getByRole('button',{name:'灵感卡片',exact:true}).click()
  await page.getByRole('button',{name:'构思一张新卡片',exact:true}).click()
  await page.getByLabel('插件 AI 创作要求').fill('构思一次主动选择')
  await page.getByRole('button',{name:'确认开始生成',exact:true}).click()
  await page.getByRole('button',{name:'查看 JSON',exact:true}).click()
  const candidate = page.getByLabel('插件 AI 候选内容')
  await expect(candidate).toHaveValue(/灯塔的选择/)
  const edited = JSON.stringify({title:'作者确认的灯塔',premise:'守灯人收到最后一封信。',turn:'她决定公开航线。'})
  await candidate.fill(edited)
  await page.getByRole('button',{name:'保存候选修改',exact:true}).click()
  await expect(page.getByText('候选修改已保存，刷新后可以继续。')).toBeVisible()
  await page.getByRole('link',{name:'AI 任务历史',exact:true}).click()
  await page.reload()
  await page.getByRole('button',{name:/插件 灵感卡片 AI.*等待确认/}).click()
  await page.getByRole('button',{name:'查看 JSON',exact:true}).click()
  await expect(candidate).toHaveValue(edited)
  await page.getByRole('button',{name:'确认写入插件内容',exact:true}).click()
  await expect(page.getByText('已确认写入插件记录，完整回执已保存。')).toBeVisible()
  await page.getByRole('link',{name:'插件工作台',exact:true}).click()
  await page.getByRole('button',{name:'灵感卡片',exact:true}).click()
  await expect(page.getByRole('heading',{name:'作者确认的灯塔',exact:true})).toBeVisible()
  await page.getByRole('link',{name:'已安装',exact:true}).click()
  const card=page.locator('.sf-workshop-card').filter({has:page.getByRole('heading',{name:'灵感卡片 AI',exact:true})})
  await card.getByRole('button',{name:'停用',exact:true}).click(); await card.getByRole('button',{name:'卸载',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'卸载',exact:true}).click()
  await page.getByRole('link',{name:'AI 任务历史',exact:true}).click()
  await page.getByRole('button',{name:/插件 灵感卡片 AI.*已确认/}).click()
  await page.getByRole('button',{name:'查看 JSON',exact:true}).click()
  await expect(candidate).toHaveValue(edited); expect(calls).toBe(1)
  await page.screenshot({path:'/tmp/storyforge-plugin-ai-history.png',fullPage:true})
  if (process.env.PLAYWRIGHT_PRODUCTION_PREVIEW !== '1') {
    const imported = await page.evaluate(async project => {
      const importer = new Function('path','return import(path)') as (path:string)=>Promise<any>
      const {deriveExportProjectJSON} = await importer('/storyforge/src/lib/export/registry-export.ts')
      const {deriveImportProjectJSON} = await importer('/storyforge/src/lib/export/registry-import.ts')
      return deriveImportProjectJSON(await deriveExportProjectJSON(Number(project)))
    }, project)
    await page.goto(`./workshop/ai?project=${imported}&owner=work`)
    await page.getByRole('button',{name:/插件 灵感卡片 AI/}).click()
    await expect(page.getByText('历史副本（只读）',{exact:false})).toBeVisible()
    await page.getByRole('button',{name:'查看 JSON',exact:true}).click()
    await expect(candidate).toHaveValue(edited); await expect(candidate).toBeDisabled()
    await expect(page.getByRole('button',{name:'确认写入插件内容',exact:true})).toHaveCount(0)
    expect(calls).toBe(1)
  }
})

test('world semantics are editable in an independent plugin and explicitly confirmed into canonical world content',async({page})=>{
 await createWorld(page,'节庆插件浏览器验收')
 const project=new URL(page.url()).searchParams.get('project')!
 await openWorkshop(page,project,'world');await install(page,'世界节庆簿');await enable(page,'世界节庆簿')
 await page.getByRole('link',{name:'插件工作台',exact:true}).click();await page.getByRole('button',{name:'世界节庆簿',exact:true}).click()
 await page.getByText('编辑节庆',{exact:true}).click();await page.getByLabel('节庆摘要',{exact:true}).fill('作者修改：共同纪念返航的船队。')
 await page.getByRole('button',{name:'保存节庆',exact:true}).click()
 await page.getByRole('button',{name:'预览并确认到世界',exact:true}).click()
 await expect(page.getByRole('heading',{name:'确认世界语义',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'确认导入这些内容',exact:true}).click()
 await expect(page.getByText('世界语义已确认，可在世界出口封存。',{exact:false})).toBeVisible()
 await page.screenshot({path:'/tmp/storyforge-plugin-world-semantics.png',fullPage:true})
})

test('MCP tool panel executes once, keeps host credentials out of parameters and retains history after refresh',async({page})=>{
 let calls=0
 await page.route('http://127.0.0.1:43127/**',async route=>{
  if(route.request().method()==='OPTIONS'){await route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'POST,GET,OPTIONS'}});return}
  if(route.request().method()==='GET'){await route.fulfill({status:405});return}
  const q=route.request().postDataJSON();expect(JSON.stringify(q)).not.toContain('isolated-browser-token')
  expect(route.request().headers()['authorization']).toBe('Bearer isolated-browser-token')
  let result:unknown
  if(q.method==='server/discover')result={supportedVersions:['2026-07-28'],capabilities:{tools:{}},serverInfo:{name:'browser-fixture',version:'1.0.0'}}
  else if(q.method==='tools/list')result={resultType:'complete',ttlMs:0,cacheScope:'private',tools:[{name:'lookup',inputSchema:{type:'object',properties:{query:{type:'string'}},required:['query']}}]}
  else if(q.method==='tools/call'){calls++;result={resultType:'complete',content:[{type:'text',text:'本机工具找到了灯塔资料。'}]}}
  else throw new Error(q.method)
  await route.fulfill({json:{jsonrpc:'2.0',id:q.id,result},headers:{'access-control-allow-origin':'*'}})
 })
 await createLongform(page,'MCP 浏览器验收');const project=new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
 await openWorkshop(page,project);await install(page,'MCP 工具台');await enable(page,'MCP 工具台')
 await page.getByRole('link',{name:'插件工作台',exact:true}).click();await page.getByRole('button',{name:'MCP 工具台',exact:true}).click()
 await page.getByRole('button',{name:'检查工具请求',exact:true}).click();expect(calls).toBe(0)
 await page.getByLabel('工具访问令牌',{exact:true}).fill('isolated-browser-token')
 await page.getByRole('button',{name:'确认执行一次工具',exact:true}).click()
 await expect(page.getByLabel('工具执行结果')).toContainText('本机工具找到了灯塔资料。')
 await page.getByRole('link',{name:'外部工具记录',exact:true}).click();await page.reload()
 await page.getByRole('button',{name:'外部工具 storyforge.tool-desk：lookup',exact:true}).click()
 await expect(page.getByLabel('工具执行结果')).toContainText('本机工具找到了灯塔资料。')
 await expect(page.getByLabel('工具访问令牌',{exact:true})).toHaveValue('');expect(calls).toBe(1)
 await page.screenshot({path:'/tmp/storyforge-plugin-mcp-history.png',fullPage:true})
})

test('two browser tabs reject stale plugin edits, keep the winning data, and dispose listeners when leaving a surface',async({page,context})=>{
 await createLongform(page,'插件多窗口验收');const project=new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
 await openWorkshop(page,project);await install(page,'创作便笺');await enable(page,'创作便笺')
 await page.getByRole('link',{name:'插件工作台',exact:true}).click();await page.getByRole('button',{name:'创作便笺',exact:true}).click()
 await expect(page.getByLabel('插件创作便笺')).toBeEnabled()
 const second=await context.newPage();await second.goto(page.url());await second.getByRole('button',{name:'创作便笺',exact:true}).click();await expect(second.getByLabel('插件创作便笺')).toBeEnabled()
 await page.getByLabel('插件创作便笺').fill('窗口一确认的内容');await page.getByRole('button',{name:'保存便笺',exact:true}).click();await expect(page.getByText('已保存到这部作品。')).toBeVisible()
 await second.getByLabel('插件创作便笺').fill('窗口二过期内容');await second.getByRole('button',{name:'保存便笺',exact:true}).click();await expect(second.getByRole('status')).toContainText(/修改|冲突|更新|过期/)
 await second.reload();await second.getByRole('button',{name:'创作便笺',exact:true}).click();await expect(second.getByLabel('插件创作便笺')).toHaveValue('窗口一确认的内容');await second.close()
 const zip=await JSZip.loadAsync(await readFile('public/workshop/packages/storyforge.writing-notes-1.0.0.sfplugin')),manifest=JSON.parse(await zip.file('manifest.json')!.async('string'))
 manifest.id='test.lifecycle';manifest.name='生命周期验收';manifest.views=[];manifest.permissions=[];manifest.schemas={}
 zip.file('manifest.json',JSON.stringify(manifest));zip.file('main.js',`export default()=>({activate(ctx){globalThis.__sfLiveCount=(globalThis.__sfLiveCount??0)+1;const f=()=>{globalThis.__sfEventCount=(globalThis.__sfEventCount??0)+1};addEventListener('sf-test',f);ctx.lifecycle.onDispose(()=>{globalThis.__sfLiveCount--;removeEventListener('sf-test',f)})}})`)
 await page.getByLabel('安装插件文件').setInputFiles({name:'lifecycle.sfplugin',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})});await enable(page,'生命周期验收')
 for(let i=0;i<3;i++){
  await page.getByRole('link',{name:'插件工作台',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>Reflect.get(globalThis,'__sfLiveCount'))).toBe(1)
  await page.getByRole('link',{name:'已安装',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>Reflect.get(globalThis,'__sfLiveCount'))).toBe(0)
 }
 await page.evaluate(()=>dispatchEvent(new Event('sf-test')));expect(await page.evaluate(()=>Reflect.get(globalThis,'__sfEventCount'))).toBeUndefined()
})

test('the same independent workbench plugin runs within all authoring products with separate Work data',async({page})=>{
 test.skip(process.env.PLAYWRIGHT_PRODUCTION_PREVIEW==='1','isolation fixture uses development module imports')
 test.setTimeout(120000)
 await page.goto('./')
 const entries=await page.evaluate(async()=>{
  const importer=new Function('path','return import(path)') as (path:string)=>Promise<any>
  const {createWorkspace}=await importer('/storyforge/src/lib/workspace/create-workspace.ts')
  const {createWorldWork}=await importer('/storyforge/src/lib/workspace/works.ts')
  const {installPackage,enablePackage,extensionScope}=await importer('/storyforge/src/lib/extensions/store.ts')
  localStorage.setItem('storyforge.plugins.preview','1')
  const pkg=await installPackage(await(await fetch('/storyforge/workshop/packages/storyforge.writing-notes-1.0.0.sfplugin')).arrayBuffer())
  const rows:{route:string;project:number;work:number}[]=[]
  for(const [route,kind] of [['short','novel'],['script','screenplay'],['comic','comic'],['motion','motion-drama'],['town','ai-town'],['ttrpg','ttrpg'],['chat','character-interaction'],['avg','avg'],['adventure','novel'],['openworld','novel']]){
   const created=await createWorkspace({name:`${route}插件隔离`,description:'',genres:[],status:'drafting',targetWordCount:10000},{purpose:route==='short'?'independent-work':'world-engine',kind:'novel',novelProfile:route==='short'?'short':'long'})
   const work=kind==='novel'?created.work:await createWorldWork(created.project.id,{title:`${route}插件作品`,kind})
   const scope=await extensionScope(created.project.id,'work',work.id);await enablePackage(pkg,scope)
   rows.push({route,project:created.project.id,work:work.id})
  }
  return rows
 })
 for(const entry of entries){
  await page.goto(`./${entry.route}?project=${entry.project}&work=${entry.work}`)
  await page.getByRole('button',{name:'作品插件工作台',exact:true}).click()
  const dock=page.getByRole('complementary',{name:'当前作品插件'})
  await dock.getByRole('button',{name:'创作便笺',exact:true}).click()
  await dock.getByLabel('插件创作便笺').fill(`${entry.route} 独立记录`)
  await dock.getByRole('button',{name:'保存便笺',exact:true}).click();await expect(dock.getByText('已保存到这部作品。')).toBeVisible()
  await dock.getByRole('button',{name:'关闭插件工作台',exact:true}).click()
 }
 await page.goto(`./ttrpg/play?project=${entries[5].project}&work=${entries[5].work}`)
 await expect(page.getByRole('button',{name:'作品插件工作台',exact:true})).toHaveCount(0)
})

test('standard plugin composition keeps prose input responsive without repeated activation or model calls',async({page})=>{
 await openWorkshop(page,'0');await page.getByRole('button',{name:'创建体验作品',exact:true}).click();await page.getByRole('button',{name:'创建并启用参考插件',exact:true}).click();await expect(page.getByText('体验内容已创建。',{exact:false})).toBeVisible()
 const project=new URL(page.url()).searchParams.get('project')!
 await page.goto(`./workspace/${project}?module=outline`)
 await page.getByRole('navigation',{name:'长篇工作台二级导航'}).getByRole('button',{name:'大纲与章纲',exact:true}).click()
 await page.getByRole('button',{name:'添加卷',exact:true}).click();await page.getByRole('button',{name:'添加章节',exact:true}).click();await page.getByTitle('编辑章节',{exact:true}).click()
 const editor=page.locator('.tiptap-editor');await expect(editor).toBeVisible();await editor.fill('灯塔的光越过海雾。'.repeat(300))
 await page.evaluate(()=>{
  const records={frames:[] as number[],longTasks:[] as number[]};Reflect.set(window,'sfPluginInputMetrics',records)
  new PerformanceObserver(list=>{records.longTasks.push(...list.getEntries().map(entry=>entry.duration))}).observe({type:'longtask'})
  document.querySelector('.tiptap-editor')!.addEventListener('input',()=>{const start=performance.now();requestAnimationFrame(()=>records.frames.push(performance.now()-start))})
 })
 await editor.press('End');await editor.pressSequentially(' the lighthouse keeper opened the letter and made a choice.',{delay:15})
 const metrics=await page.evaluate(()=>Reflect.get(window,'sfPluginInputMetrics') as {frames:number[];longTasks:number[]})
 const sorted=metrics.frames.sort((a,b)=>a-b),p95=sorted[Math.floor(sorted.length*0.95)]
 expect(sorted.length).toBeGreaterThan(40);expect(p95).toBeLessThan(50)
 expect(metrics.longTasks.filter(duration=>duration>50).length).toBeLessThanOrEqual(1)
 await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.getByRole('button',{name:'已保存',exact:true})).toBeVisible()
 console.info('PLUGIN_INPUT_METRICS',JSON.stringify({...metrics,p95}))
})

test('a second same-class community package needs no host edit and keeps its namespace separate',async({page})=>{
 await createLongform(page,'第二个独立便笺');const project=new URL(page.url()).pathname.match(/workspace\/(\d+)/)![1]
 await openWorkshop(page,project);await install(page,'创作便笺');await enable(page,'创作便笺')
 const zip=await JSZip.loadAsync(await readFile('public/workshop/packages/storyforge.writing-notes-1.0.0.sfplugin')),manifest=JSON.parse(await zip.file('manifest.json')!.async('string'))
 manifest.id='community.second-notes';manifest.name='第二种便笺';manifest.author='隔离社区作者';manifest.views[0].title='第二种便笺'
 zip.file('manifest.json',JSON.stringify(manifest))
 await page.getByLabel('安装插件文件').setInputFiles({name:'second-notes.sfplugin',mimeType:'application/zip',buffer:await zip.generateAsync({type:'nodebuffer'})})
 await enable(page,'第二种便笺');await page.getByRole('link',{name:'插件工作台',exact:true}).click()
 for(const [name,text] of [['创作便笺','官方包记录'],['第二种便笺','社区包记录']]){await page.getByRole('button',{name,exact:true}).click();await page.getByLabel('插件创作便笺').fill(text);await page.getByRole('button',{name:'保存便笺',exact:true}).click();await expect(page.getByText('已保存到这部作品。')).toBeVisible()}
 await page.getByRole('button',{name:'创作便笺',exact:true}).click();await expect(page.getByLabel('插件创作便笺')).toHaveValue('官方包记录')
 await page.getByRole('button',{name:'第二种便笺',exact:true}).click();await expect(page.getByLabel('插件创作便笺')).toHaveValue('社区包记录')
})
