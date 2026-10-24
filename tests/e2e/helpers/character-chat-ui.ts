import type {Page} from '@playwright/test'

/** Open the player-facing director disclosure through its actual control. */
export async function openChatNarrativeTools(page: Page) {
  const panel = page.getByTestId('chat-narrative-tools')
  if (await panel.getAttribute('open') === null) await panel.getByText('剧情设置与新情境', {exact: true}).click()
}

export async function openChatMessageTools(page: Page, actionName: string) {
  const action = page.getByRole('button', {name: actionName, exact: true, includeHidden: true})
  const panel = action.locator('xpath=ancestor::details[1]')
  if (await panel.getAttribute('open') === null) await panel.locator('summary').click()
}
