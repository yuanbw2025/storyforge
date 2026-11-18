import { chromium, expect } from '@playwright/test'
const browser = await chromium.launch({ headless: true })
try {
 const page = await browser.newPage()
 /** @type {string[]} */
 const writes = []
 await page.route('**/api/feedback**', async route => {
  const request=route.request(),url=new URL(request.url())
  if(request.method()==='POST') {writes.push(request.postData() ?? '');return route.fulfill({json:{ok:true,issueNumber:42,action:'comment',url:'https://github.com/yuanbw2025/storyforge/issues/42#issuecomment-9'}})}
  const issue={number:42,title:'Existing <img src=x onerror=alert(1)>',body:'Public evidence',state:'closed',locked:false,url:'https://github.com/yuanbw2025/storyforge/issues/42'}
  return route.fulfill({json:url.pathname.endsWith('/42')?{ok:true,issue,comments:[{body:'Prior comment',url:issue.url}]}:{ok:true,issues:[issue],total:1,page:1}})
 })
 for(const locale of ['', '/en']) {
  await page.goto((process.env.DOCS_PREVIEW_URL||'http://127.0.0.1:4173')+locale+'/feedback/bug')
  await page.locator('.feedback-followup input').first().fill('existing')
  await page.locator('.feedback-followup button').filter({hasText:locale?'Search issues':'查找问题'}).click()
  await page.locator('.feedback-followup li button').click()
  await expect(page.locator('.feedback-followup h3')).toContainText('#42')
  await expect(page.locator('.feedback-followup img')).toHaveCount(0)
  await page.locator('#bug-description').fill('Additional reproduction')
  await page.locator('.feedback-submit-button').click()
  await expect(page.locator('.feedback-notice--success')).toContainText('#42')
  const body=writes.at(-1) ?? ''; for(const token of ['name="action"','comment','name="issueNumber"','42','name="requestId"']) if(!body.includes(token))throw Error('Missing follow-up field '+token)
  await expect(page.locator('.feedback-notice--success a')).toHaveAttribute('href','https://github.com/yuanbw2025/storyforge/issues/42')
  await page.locator('.feedback-followup button').filter({hasText:locale?'Create a new issue instead':'改为新建问题'}).click()
  await expect(page.locator('#bug-title')).toHaveAttribute('required','')
 }
 console.log('Bilingual search/read/explicit comment, closed issue, untrusted text, receipt and return-to-create passed; all API calls mocked.')
} finally {await browser.close()}
