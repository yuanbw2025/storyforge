import {expect,test} from '@playwright/test'
import {buildDiagnosticOptOutFixture} from '../../scripts/desktop/diagnostic-fixture.mjs'
test('default bounded context captures safe codes, preserves absent preference and honors legacy opt-out without uploading',async({page})=>{
 const uploads:string[]=[]
 await page.route('https://storyforge-lab.com/v1/client-support/**',route=>{uploads.push(route.request().url());return route.fulfill({status:503,body:'isolated'})})
 await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','diagnostic-context-isolated'))
 await page.goto('home/settings')
 await expect(page.getByRole('region',{name:'问题与故障反馈'})).toBeVisible({timeout:30000})
 await expect(page.getByLabel('附带最近操作轨迹（可选，默认关闭）')).toHaveCount(0)
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-diagnostic-context-v1'))).toBeNull()
 await page.evaluate(()=>{
  const privateInput=document.createElement('input');privateInput.value='PRIVATE_MANUSCRIPT_KEY';document.body.append(privateInput);privateInput.dispatchEvent(new Event('input',{bubbles:true}));privateInput.remove()
  const button=document.createElement('button');button.textContent='PRIVATE_CHAPTER_NAME';button.dataset.diagnosticAction='save';document.body.append(button);button.click();button.remove()
  const error=new TypeError('Cannot read properties of undefined PRIVATE_MANUSCRIPT_KEY');error.stack='TypeError: PRIVATE\n at x (http://localhost/storyforge/assets/fixture.js:2:34)';window.dispatchEvent(new ErrorEvent('error',{error}))
 })
 const raw=await page.evaluate(()=>localStorage.getItem('storyforge-runtime-diagnostics-v1'))
 expect(raw).toContain('property-access');expect(raw).toContain('save');expect(raw).not.toMatch(/PRIVATE|MANUSCRIPT|KEY/)
 await page.reload();await expect(page.getByRole('region',{name:'问题与故障反馈'})).toBeVisible()
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-diagnostic-context-v1'))).toBeNull()
 await page.getByRole('button',{name:'查看故障摘要并反馈'}).click()
 await expect(page.getByLabel('故障摘要预览')).toContainText('property-access')
 // Use the actual preference API to create the legacy opt-out and cleanup,
 // then verify normal bootstrap preserves it. No retired UI or hand-made cleanup.
 const optOutSource=await buildDiagnosticOptOutFixture()
 expect(await page.evaluate(source=>{(0,eval)(source);return (window as unknown as {__storyforgeDiagnosticFixture:{disable():boolean}}).__storyforgeDiagnosticFixture.disable()},optOutSource)).toBe(true)
 await page.reload();await expect(page.getByRole('region',{name:'问题与故障反馈'})).toBeVisible()
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-diagnostic-context-v1'))).toBe('false')
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-operation-trail-v1'))).toBeNull()
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-runtime-diagnostics-v1'))).not.toContain('details')
 expect(uploads).toEqual([])
})
