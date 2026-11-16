import {expect,test} from '@playwright/test'
test('opt-in captures safe action codes, snapshots errors, survives refresh and clears on opt-out without uploading',async({page})=>{
 const uploads:string[]=[]
 await page.route('https://storyforge-lab.com/v1/client-support/**',route=>{uploads.push(route.request().url());return route.fulfill({status:503,body:'isolated'})})
 await page.addInitScript(()=>localStorage.setItem('storyforge_guide_completed','diagnostic-context-isolated'))
 await page.goto('home/settings')
 const choice=page.getByLabel('附带最近操作轨迹（可选，默认关闭）')
 await expect(choice).toBeVisible({timeout:30000});await expect(choice).not.toBeChecked();await choice.check()
 await page.evaluate(()=>{
  const privateInput=document.createElement('input');privateInput.value='PRIVATE_MANUSCRIPT_KEY';document.body.append(privateInput);privateInput.dispatchEvent(new Event('input',{bubbles:true}));privateInput.remove()
  const button=document.createElement('button');button.textContent='PRIVATE_CHAPTER_NAME';button.dataset.diagnosticAction='save';document.body.append(button);button.click();button.remove()
  const error=new TypeError('Cannot read properties of undefined PRIVATE_MANUSCRIPT_KEY');error.stack='TypeError: PRIVATE\n at x (http://localhost/storyforge/assets/fixture.js:2:34)';window.dispatchEvent(new ErrorEvent('error',{error}))
 })
 const raw=await page.evaluate(()=>localStorage.getItem('storyforge-runtime-diagnostics-v1'))
 expect(raw).toContain('property-access');expect(raw).toContain('save');expect(raw).not.toMatch(/PRIVATE|MANUSCRIPT|KEY/)
 await page.reload();await expect(choice).toBeChecked()
 await page.getByRole('button',{name:'查看故障摘要并反馈'}).click()
 await expect(page.getByLabel('故障摘要预览')).toContainText('property-access')
 await choice.uncheck()
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-operation-trail-v1'))).toBeNull()
 expect(await page.evaluate(()=>localStorage.getItem('storyforge-runtime-diagnostics-v1'))).not.toContain('details')
 expect(uploads).toEqual([])
})
