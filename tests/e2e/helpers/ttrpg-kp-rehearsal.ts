import { expect, type Page } from '@playwright/test'

export async function installKpRehearsal(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('storyforge_guide_completed', 'ai-kp-rehearsal')
    localStorage.setItem('storyforge-ai-api-key-remember', 'true')
    localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'agnes', apiKey: 'isolated-rehearsal',
      model: 'agnes-2.5-flash', baseUrl: 'https://apihub.agnes-ai.com/v1', temperature: 0, maxTokens: 0 }))
  })
  let failNext = false, calls = 0
  await page.route('**/chat/completions', async route => {
    calls++
    if (failNext) { failNext = false; await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { message: 'rehearsal unauthorized' } }) }); return }
    const messages = route.request().postDataJSON().messages as Array<{ role: string; content: string }>
    const all = messages.map(message => message.content).join('\n')
    const user = messages.find(message => message.role === 'user')!.content
    let output: unknown
    if (all.includes('storyforge.ttrpg-director-view')) {
      const view = JSON.parse(user.slice(user.indexOf('{"schema":"storyforge.ttrpg-director-view"')))
      output = { revealClueKeys: view.options.eligibleReveals.slice(0, 1).map((clue: { clueKey: string }) => clue.clueKey),
        recommendedSceneKeys: [], recommendedEndingKeys: [], pacing: 'investigate' }
    } else if (all.includes('storyforge.ttrpg-public-narration-view')) {
      const view = JSON.parse(user.slice(user.indexOf('{"schema":"storyforge.ttrpg-public-narration-view"')))
      output = { narration: '潮声从石阶下传来。灯罩边缘留下了一道可以继续追查的痕迹，你想如何回应？',
        synthesisFrame: view.synthesisTemplate, offeredClueKeys: [], recommendedNextSceneKeys: [] }
    } else if (all.includes('storyforge.ttrpg-private-guidance-view')) {
      const view = JSON.parse(user.slice(user.indexOf('{"schema":"storyforge.ttrpg-private-guidance-view"')))
      output = { actorKey: view.actorKey, advice: '先保护自己的线索，再决定向同伴公开哪一部分。你也可以继续观察守灯人的反应。', suggestedActionKey: all.includes('玩家在执行前询问') ? 'investigate' : null }
    } else {
      output = { actionKey: 'investigate', targetKey: null, approach: '俯身观察石阶上留下的细小痕迹。', spokenIntent: null }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'kp-rehearsal', object: 'chat.completion',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(output) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) })
  })
  return { failOnce: () => { failNext = true }, calls: () => calls }
}

export async function reachHumanTurn(page: Page) {
  const table = page.getByTestId('ttrpg-play-table')
  for (let turn = 0; turn < 8; turn++) {
    await expect.poll(async () => {
      if (await table.locator('.sf-ttrpg-progress').count()) return false
      return await table.getByRole('button', { name: '暂时观察，让故事继续', exact: true }).isVisible()
        || await table.getByLabel(/现在是你的回合/).isVisible()
        || await table.getByRole('button', { name: '继续主持', exact: true }).isVisible()
    }).toBe(true)
    if (await table.getByRole('button', { name: '暂时观察，让故事继续', exact: true }).isVisible()) {
      await table.getByRole('button', { name: '暂时观察，让故事继续', exact: true }).click(); continue
    }
    if (await table.getByLabel(/现在是你的回合/).isVisible()) return
    await table.getByRole('button', { name: '继续主持', exact: true }).click()
  }
  throw new Error('AI 回合未交还真人')
}

