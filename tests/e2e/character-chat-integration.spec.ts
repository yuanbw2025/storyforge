import { test, expect } from '@playwright/test';
import { CHAT_PAGES } from '../../src/components/character-interaction/navigation';
import { DEFAULT_CHAT_SETTINGS } from '../../src/lib/character-interaction/authoring-contract';
test('character chat pages stay open; draft and confirmed main Agent candidate survive refresh', async ({ page }, info) => {
    test.setTimeout(120000);
    await page.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'e2e'); localStorage.setItem('storyforge-ai-config', JSON.stringify({ provider: 'openai', baseUrl: 'https://chat-test.invalid/v1', model: 'test', temperature: .2, maxTokens: 8000 })); sessionStorage.setItem('storyforge-ai-api-key-session', 'isolated-test-key'); });
    await page.route('https://chat-test.invalid/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify({ answer: '建议让玩家成为档案员，请确认。', settings: { ...DEFAULT_CHAT_SETTINGS, playerRole: '档案员' } }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) }));
    for (const [id] of CHAT_PAGES) {
        await page.goto(`./chat/${id}`);
        await expect(page.getByTestId('character-chat-page')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.goto('./chat/vision');
    await page.getByLabel('作品名称', { exact: true }).fill('聊天接入验收');
    await page.getByLabel('玩家身份', { exact: true }).fill('守灯人');
    await page.getByRole('button', { name: '保存方案', exact: true }).click();
    await expect(page).toHaveURL(/chat\/vision\?project=\d+&work=\d+/);
    await page.reload();
    await expect(page.getByLabel('玩家身份', { exact: true })).toHaveValue('守灯人', { timeout: 15000 });
    const nav = page.getByRole('navigation', { name: '角色聊天页内目录' });
    await nav.getByRole('button', { name: '制作流程', exact: true }).click();
    await expect(page.getByRole('heading', { name: '开始制作，需要一个世界引擎', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: '方案会谈', exact: true }).click();
    await page.getByLabel('角色聊天 会谈输入').fill('玩家改为档案员');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '确认并回填制作方案' })).toBeEnabled({ timeout: 20000 });
    await page.reload();
    await page.getByRole('button', { name: '确认并回填制作方案' }).click();
    await expect(page.getByRole('status')).toContainText('已采用');
    await nav.getByRole('button', { name: '互动目标', exact: true }).click();
    await expect(page.getByLabel('玩家身份', { exact: true })).toHaveValue('档案员');
    await page.screenshot({ path: info.outputPath('chat-s2.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('chat-mobile.png') });
});
test('private reply stays hidden, messages persist, checkpoints and branches remain independent', async ({ page }, info) => {
    await page.goto('./chat/library');
    const fixture = await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/character-chat-fixture.ts')).seedChatRuntimeFixture(); });
    const query = `project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`;
    await page.goto(`./chat/play?${query}`);
    await page.getByPlaceholder('对当前场景中的角色说话…').fill('浏览器玩家消息');
    await page.getByRole('button', { name: '仅保存消息', exact: true }).click();
    await expect(page.getByText('浏览器玩家消息', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole('button', { name: '仅保存消息', exact: true })).toBeDisabled();
    await page.reload();
    await expect(page.getByText('浏览器玩家消息', { exact: true })).toBeVisible({ timeout: 15000 });
    await page.evaluate(async (f) => { const load = new Function('p', 'return import(p)'); const h = await load('/storyforge/src/lib/character-interaction/harness.ts'); const s = (await load('/storyforge/src/stores/character-interaction-player.ts')).useCharacterInteractionPlayerStore; const g = await h.generateInteractionRuntimeCandidateV1({ scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'aria', skillId: 'character.interaction-reply', objective: '仅角色可见', replyToSequence: f.playerSequence, replyBudgetCost: 1, runAI: async () => JSON.stringify({ kind: 'character-reply', text: '角色秘密不应显示', replyToSequence: f.playerSequence, audienceKeys: ['aria'], budgetCost: 1, disclosures: [] }) }); await h.adoptInteractionRuntimeCandidateV1({ scope: f.scope, runId: g.snapshot.run.id }); await s.getState().select(f.sessionId); }, fixture);
    await expect(page.getByText('角色秘密不应显示', { exact: true })).toHaveCount(0);
    await page.getByRole('navigation', { name: '角色聊天页内目录' }).getByRole('button', { name: '会话与分支', exact: true }).click();
    await page.getByPlaceholder('检查点名称').fill('验证检查点');
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await page.getByRole('button', { name: /验证检查点.*分支/ }).click();
    await expect(page).not.toHaveURL(new RegExp(`session=${fixture.sessionId}$`));
    await page.screenshot({ path: info.outputPath('chat-history.png') });
    await page.getByRole('navigation',{name:'角色聊天页内目录'}).getByRole('button',{name:'开始对话',exact:true}).click();
    await page.getByRole('button',{name:'结束场景',exact:true}).click();
    await expect(page.getByText('当前场景已结束',{exact:false})).toBeVisible();
    await expect(page.getByText('浏览器玩家消息',{exact:true})).toBeVisible();
});
test('S2 role settings reach the frozen production brief through the real confirmation UI', async ({ page }, info) => {
    test.setTimeout(120000);
    await page.goto('./chat/library');
    await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); await (await load('/storyforge/tests/helpers/current-product-world.ts')).seedCurrentProductWorld('聊天来源验收'); });
    await page.goto('./chat/vision');
    await page.getByLabel('作品名称', { exact: true }).fill('角色方案到制作');
    await page.getByLabel('玩家身份', { exact: true }).fill('守灯人');
    await page.getByLabel('开场与场景目标', { exact: true }).fill('在灯塔与林舟核对失踪船队的来信');
    await page.getByRole('button', { name: '保存方案', exact: true }).click();
    await expect(page).toHaveURL(/work=\d+/);
    await page.getByRole('navigation', { name: '角色聊天主导航' }).getByRole('button', { name: '世界引擎', exact: true }).click();
    await page.getByRole('button', { name: '选择此版本', exact: true }).first().click();
    await expect(page.getByRole('status')).toContainText('已引用冻结世界版本');
    await page.getByRole('navigation', { name: '角色聊天主导航' }).getByRole('button', { name: '制作台', exact: true }).click();
    const nav = page.getByRole('navigation', { name: '角色聊天页内目录' });
    await nav.getByRole('button', { name: '角色与场景', exact: true }).click();
    const role = page.locator('section').filter({ has: page.getByRole('heading', { name: '林舟', exact: true }) }).last();
    await role.getByLabel('参与本次聊天').check();
    await role.getByLabel('说话与性格约束').fill('谨慎而简短，不知道的事直接说明');
    await role.getByLabel('初始信任（-100～100）').fill('24');
    await role.getByLabel('仅此角色知道的秘密').fill('信封内的暗号只有林舟知道');
    await page.getByRole('button', { name: '保存方案', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('方案已保存');
    await nav.getByRole('button', { name: '确认制作方案', exact: true }).click();
    await page.getByRole('button', { name: '启用自动制作', exact: true }).click();
    await page.getByRole('button', { name: '分析可玩起点', exact: true }).click();
    await expect(page.getByRole('button', { name: '生成严格 Brief', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '生成严格 Brief', exact: true }).click();
    await expect(page.getByTestId('product-production-command-activity')).toContainText('succeeded');
    await page.getByRole('button', { name: '保存 Brief revision', exact: true }).click();
    await expect(page).toHaveURL(/production=\d+/);
    await expect(page.getByText('r1 · 草稿', { exact: true })).toBeVisible();
    const brief = await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); const db = (await load('/storyforge/src/lib/db/schema.ts')).db; const id = Number(new URLSearchParams(location.search).get('production')); const row = await db.productProductionBriefs.where('[productionId+revision]').equals([id, 1]).first(); if (!row) throw new Error('已保存的 Brief revision 未进入持久化投影'); return JSON.parse(row.briefJson); });
    expect(brief.characterChat.characters[0]).toMatchObject({ initialTrust: 24, privateKnowledge: '信封内的暗号只有林舟知道' });
    expect(brief.intent.playerRole).toBe('守灯人');
    await page.screenshot({ path: info.outputPath('chat-confirmed-production.png') });
});

test('browser history keeps unsaved settings with their own Work',async({page})=>{
 await page.goto('./chat/library')
 const [a,b]=await page.evaluate(async()=>{const load=new Function('p','return import(p)');const {createChatDraftV1}=await load('/storyforge/src/lib/character-interaction/draft-service.ts');const {DEFAULT_CHAT_SETTINGS}=await load('/storyforge/src/lib/character-interaction/authoring-contract.ts');return Promise.all(['甲','乙'].map(async playerRole=>{const c=await createChatDraftV1(playerRole,{...DEFAULT_CHAT_SETTINGS,playerRole});return `./chat/vision?project=${c.scope.projectId}&work=${c.scope.workId}`}))})
 await page.goto(a)
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('甲')
 await page.getByLabel('玩家身份',{exact:true}).fill('甲的未保存身份')
 await page.evaluate(href=>{history.pushState(null,'',href.replace('./','/storyforge/'));dispatchEvent(new PopStateEvent('popstate'))},b)
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('乙')
 await page.goBack()
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('甲的未保存身份')
 await page.getByRole('button',{name:'保存方案',exact:true}).click()
 await page.goto(b)
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('乙')
 await page.getByLabel('玩家身份',{exact:true}).fill('乙的本地修改')
 await page.evaluate(async()=>{const load=new Function('p','return import(p)');const db=(await load('/storyforge/src/lib/db/schema.ts')).db;const svc=await load('/storyforge/src/lib/character-interaction/draft-service.ts');const work=await db.works.get(Number(new URLSearchParams(location.search).get('work')));const scope={projectId:work.projectId,worldId:work.worldId,workId:work.id};const d=await svc.readChatDraftV1(scope);await svc.saveChatDraftV1(scope,d.revision,{...JSON.parse(d.settingsJson),playerRole:'乙的另一个标签页修改'})})
 await page.getByRole('button',{name:'保存方案',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('其他页面修改')
 const stored=await page.evaluate(async()=>{const load=new Function('p','return import(p)');const db=(await load('/storyforge/src/lib/db/schema.ts')).db;const d=await db.chatAuthoringDrafts.where('workId').equals(Number(new URLSearchParams(location.search).get('work'))).first();return JSON.parse(d.settingsJson).playerRole})
 expect(stored).toBe('乙的另一个标签页修改')
})
