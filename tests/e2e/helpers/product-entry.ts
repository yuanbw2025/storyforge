import { gotoWithBrowserFixtureAIConfigV1 } from './browser-ai-config'
import { expect, type Page } from '@playwright/test'

export async function createLongform(page: Page, title: string) {
  await gotoWithBrowserFixtureAIConfigV1(page, './long?module=outline')
  await page.getByRole('button', {name:'新建长篇',exact:true}).click()
  await page.getByLabel('新长篇名称').fill(title)
  await page.getByRole('button',{name:'创建并进入工作台',exact:true}).click()
  await expect(page.locator('[data-workspace-ready=longform]')).toBeVisible()
}
export async function createWorld(page: Page, title: string, description = '') {
  await gotoWithBrowserFixtureAIConfigV1(page, './world/worlds?create=1')
  await page.getByLabel('新世界名称').fill(title)
  if(description) await page.getByLabel('新世界简介').fill(description)
  await page.getByRole('button',{name:'创建世界',exact:true}).click()
  await expect(page).toHaveURL(/world\/basics\?project=\d+/)
  const project = new URL(page.url()).searchParams.get('project')!
  await gotoWithBrowserFixtureAIConfigV1(page, `./world/worlds?project=${project}`)
}
/** For existing engine fixtures only: resolve the fixture's actual owner, never a UI-selected world. */
export async function openSeededRuntime(page: Page, kind: string, route: string) {
  const value = await page.evaluate(async kind => {
    const importer = new Function('path', 'return import(path)') as (path: string) => Promise<any>
    const {db} = await importer('/storyforge/src/lib/db/schema.ts')
    const sessions = await db.productRuntimeSessions.where('kind').equals(kind).toArray()
    const session = sessions.sort((a:any,b:any)=>b.updatedAt-a.updatedAt)[0]
    if(!session) throw new Error(`Missing seeded ${kind} session`)
    return {project:session.projectId,work:session.workId,session:session.id}
  },kind)
  await gotoWithBrowserFixtureAIConfigV1(page, `./${route}?project=${value.project}&work=${value.work}&session=${value.session}`)
}
