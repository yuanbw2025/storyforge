import { registerBrowserFixtureAIConfigV1, gotoWithBrowserFixtureAIConfigV1, reloadWithBrowserFixtureAIConfigV1 } from './helpers/browser-ai-config'
import {chatActionResponseFixture, fulfillChatActionChoiceFixture} from './helpers/character-chat-choice'
import {openChatNarrativeTools} from './helpers/character-chat-ui'
import { test, expect } from '@playwright/test';
import { CHAT_PAGES } from '../../src/components/character-interaction/navigation';
for (const rejectClosure of [false, true]) test(`related goal closure is atomic and a finished role does not keep generating (reject=${rejectClosure})`, async ({page}) => {
    test.setTimeout(120000);
    const reply = '铜印已经找到。寻找就此结束。我也已澄清此前只是猜测，现在撤回。';
    const followup = '可以，我们聊会儿别的。眼下驿站里安全。';
    let calls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-closure.invalid/v1', model: 'test', maxTokens: 4000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-closure.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n');
        const output = prompt.includes('本次持久化行动候选')
            ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: !(rejectClosure && check === 'consequences'), reason: '工程审查夹具，不是模型质量验收'}))}
            : calls > 2 ? {kind: 'speak', text: followup, goalKey: null, evidenceFactKeys: ['road'], audienceKeys: ['guard', 'player'], waitingForPlayer: false, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null}
            : {kind: 'complete', text: reply, goalKey: 'clarify', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player', 'artisan'], waitingForPlayer: false,
                newFacts: [{factKey: 'found', kind: 'observation', text: '铜印已经找到。', evidenceFactKeys: ['lost'], evidenceExcerpt: '铜印已经找到。'}], disclosures: [],
                threadUpdates: [{threadKey: 'investigate', status: 'resolved', evidenceExcerpt: '寻找就此结束。'}], goalStatus: 'fulfilled',
                goalUpdates: [{goalKey: 'find-seal', status: 'fulfilled', evidenceFactKeys: ['found'], evidenceExcerpt: '寻找就此结束。'}],
                nextPossibilities: [], beliefUpdates: [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['found']}]};
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({additionalGuardGoal: true});});
    const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction;}, f);
    const before = await read();
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await page.getByRole('button', {name: '让角色开场', exact: true}).click();
    if (rejectClosure) {await expect(page.getByText(/行动语义审查未通过/)).toBeVisible(); await expect(page.getByText(reply, {exact: true})).toHaveCount(0);}
    else await expect(page.getByText(reply, {exact: true})).toBeVisible();
    await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    const after = await read();
    if (rejectClosure) expect(after.chatNarrative.situation).toEqual(before.chatNarrative.situation);
    else {
        expect(after.chatNarrative.situation.goals.filter((g: {actorKey: string}) => g.actorKey === 'guard').map((g: {status: string}) => g.status)).toEqual(['fulfilled', 'fulfilled']);
        expect(after.chatNarrative.situation.goals[1]).toEqual(before.chatNarrative.situation.goals[1]);
        expect(after.chatNarrative.situation.beliefs).toEqual([]);
        expect(after.chatNarrative.situation.possibilities).toEqual([]);
        await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
        await page.getByRole('button', {name: '让角色继续', exact: true}).click();
        await expect(page.getByText(/选定角色不在场、听不到此消息或当前目标已结束/)).toBeVisible();
        expect(await read()).toEqual(after);
        expect(calls).toBe(2);
        await page.getByPlaceholder('对当前场景中的角色说话…').fill('那就先聊会儿别的吧。');
        await page.getByRole('button', {name: '发送并生成', exact: true}).click();
        await expect(page.getByText(followup, {exact: true})).toBeVisible();
        const responded = await read();
        expect(responded.chatNarrative.situation).toEqual(after.chatNarrative.situation);
        expect(responded.chatNarrative.triggers.at(-1)).toMatchObject({kind: 'player-response', status: 'complete', actionSequences: [expect.any(Number)]});
        await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByText(followup, {exact: true})).toBeVisible();
        expect(await read()).toEqual(responded);
    }
    expect(calls).toBe(rejectClosure ? 2 : 4);
});
for (const rejectReflection of [false, true]) test(`role revises its plans and hypotheses after refusal without inventing completed facts (reject=${rejectReflection})`, async ({page}) => {
    test.setTimeout(120000);
    const plan = '独自核对已有线索；玩家愿意重新参与前不再邀其查后门。';
    const reply = '你先休息，我不再邀请你查后门。我会先核对已有线索，也先不认定有人借走铜印。';
    let calls = 0, actions = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-reflection.invalid/v1', model: 'test', maxTokens: 4000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-reflection.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n');
        let output: unknown;
        if (prompt.includes('本次持久化行动候选')) {
            output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: !(rejectReflection && check === 'continuity'), reason: '工程审查夹具，不是模型质量验收'}))};
        } else {
            actions++;
            expect(prompt).not.toContain('柜台下');
            if (actions === 2) {
                expect(prompt).toContain(plan); expect(prompt).toContain('"beliefs":[]');
                expect(prompt).not.toContain('可以建议查看后门，也可以先一起处理山路。');
                expect(prompt).not.toContain('猜测铜印可能被某人借用，还未求证。');
            }
            output = {kind: 'pause', text: actions === 1 ? reply : '我会按刚才的办法慢慢核对，不再催你参与。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
                newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
                nextPossibilities: actions === 1 ? [{text: plan, evidenceFactKeys: ['lost']}] : null,
                beliefUpdates: actions === 1 ? [{beliefKey: 'borrowed', text: null, evidenceFactKeys: ['lost']}] : []};
        }
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture();});
    const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction;}, f);
    const before = await read();
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await page.getByPlaceholder('对当前场景中的角色说话…').fill('我不想查后门，先休息。');
    await page.getByRole('button', {name: '发送并生成', exact: true}).click();
    if (rejectReflection) {await expect(page.getByText(/行动语义审查未通过/)).toBeVisible(); await expect(page.getByText(reply, {exact: true})).toHaveCount(0);}
    else await expect(page.getByText(reply, {exact: true})).toBeVisible();
    expect(calls).toBe(2);
    await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    const after = await read();
    expect(after.chatNarrative.situation.facts).toEqual(before.chatNarrative.situation.facts);
    expect(after.chatNarrative.situation.possibilities).toEqual(rejectReflection ? before.chatNarrative.situation.possibilities : [{actorKey: 'guard', text: plan, evidenceFactKeys: ['lost']}]);
    expect(after.chatNarrative.situation.beliefs).toHaveLength(rejectReflection ? 1 : 0);
    expect(calls).toBe(2);
    await expect(page.getByText(plan, {exact: true})).toHaveCount(0);
    if (!rejectReflection) {
        await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
        await page.getByRole('button', {name: '从上次局面继续', exact: true}).click();
        await expect(page.getByText('我会按刚才的办法慢慢核对，不再催你参与。', {exact: true})).toBeVisible();
        expect(calls).toBe(4);
        expect((await read()).chatNarrative.situation.possibilities).toEqual(after.chatNarrative.situation.possibilities);
    }
});

for (const rejectRelationship of [false, true]) test(`dialogue relationship consequences are reviewed, restored and used on continuation (reject=${rejectRelationship})`, async ({page}) => {
    test.setTimeout(120000);
    const playerText = '先核对证据再询问，不要因为旅人着急离开就认定他有罪。';
    const responseText = '你提醒得对，着急离开不代表有罪。我更愿意听取你的判断；我先核对已有记录。';
    let calls = 0, actionCalls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-relationship.invalid/v1', model: 'test', maxTokens: 4000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-relationship.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const prompt = route.request().postDataJSON().messages.map((m: {content: string}) => m.content).join('\n');
        let output: unknown;
        if (prompt.includes('本次持久化行动候选')) {
            output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: !(rejectRelationship && check === 'consequences'), reason: '浏览器工程夹具，不是模型质量判断'}))};
        } else {
            actionCalls++;
            expect(prompt).not.toContain('柜台下');
            const source = prompt.match(/"trigger":\{"kind":"player-response","requestedSequence":\d+,"sourceEventSequence":(\d+)/)?.[1];
            if (actionCalls === 1) expect(source).toBeTruthy();
            else {expect(prompt).toContain('"value":1'); expect(prompt).toContain('"reason":"我更愿意听取你的判断"'); expect(prompt).toContain('investigate');}
            output = {kind: actionCalls === 1 ? 'speak' : 'pause', text: actionCalls === 1 ? responseText : '我先按你提醒的核对记录，不急着指认任何人。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: false,
                newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null,
                relationshipUpdates: actionCalls === 1 ? [{dimensionKey: 'trust', delta: 1, sourceEventSequence: Number(source), playerExcerpt: playerText, evidenceExcerpt: '我更愿意听取你的判断'}] : []};
        }
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({relationships: true});});
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await page.getByPlaceholder('对当前场景中的角色说话…').fill(playerText);
    await page.getByRole('button', {name: '发送并生成', exact: true}).click();
    if (rejectRelationship) {
        await expect(page.getByText(/行动语义审查未通过/)).toBeVisible();
        await expect(page.getByText(responseText, {exact: true})).toHaveCount(0);
    } else await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText(responseText, {exact: true})).toBeVisible();
    expect(calls).toBe(2);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    const read = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction;}, f);
    const saved = await read();
    expect(saved.relationshipHistory).toHaveLength(rejectRelationship ? 0 : 1);
    expect(saved.relationships[0].value).toBe(rejectRelationship ? 0 : 1);
    expect(calls).toBe(2);
    if (!rejectRelationship) {
        await page.getByRole('button', {name: '关系与记忆', exact: true}).click();
        const relationship = page.getByTestId('chat-relationship-panel');
        await relationship.getByText('共同经历（1）', {exact: true}).click();
        const cause = relationship.getByTestId('chat-relationship-cause');
        await expect(cause).toHaveCount(1);
        await expect(cause.getByText('我更愿意听取你的判断', {exact: true})).toBeVisible();
        await expect(cause.getByText(/：0 → 1$/)).toBeVisible();
        await cause.getByText('查看双方原话', {exact: true}).click();
        await expect(cause.getByText(playerText, {exact: true})).toBeVisible();
        await expect(cause.getByText(responseText, {exact: true})).toBeVisible();
        expect(calls).toBe(2);
        await page.getByRole('button', {name: '开始对话', exact: true}).click();
        await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
        await page.getByRole('button', {name: '让角色继续', exact: true}).click();
        await expect(page.getByRole('region', {name: '对话记录', exact: true}).getByText('我先按你提醒的核对记录，不急着指认任何人。', {exact: true})).toBeVisible();
        expect(calls).toBe(4);
        expect((await read()).relationshipHistory).toHaveLength(1);
    }
});

for (const rejectReview of [false, true]) test(`player situation request is reviewed before role action (reject=${rejectReview})`, async ({page}, info) => {
    test.setTimeout(120000);
    let calls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-runtime-situation.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-runtime-situation.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const prompt = JSON.stringify(route.request().postDataJSON().messages);
        let output: unknown;
        if (calls === 1) {
            expect(prompt).toContain('柜台下');
            output = {kind: 'chat-situation', title: '门外的声响', location: '驿站', timeLabel: '傍晚', newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}], newGoals: [{goalKey: 'understand-knock', actorKey: 'guard', desire: '了解来意', concern: '贸然开门', boundary: '不替玩家开门', evidenceFactKeys: ['knocking']}], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以隔门询问，也可以等待。', evidenceFactKeys: ['knocking']}]};
        } else if (calls === 2) {
            expect(prompt).toContain('本次持久化情境候选');
            output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'meaningful-direction'].map(check => ({check, passed: !(rejectReview && check === 'visibility'), reason: '浏览器工程夹具，不是语义质量验收'}))};
        } else if (prompt.includes('本次持久化行动候选')) {
            output = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程审查夹具'}))};
        } else {
            expect(prompt).toContain('门外传来敲门声');
            expect(prompt).not.toContain('柜台下');
            expect(prompt).not.toContain('幕后要求不要预设来者身份');
            output = {kind: 'attempt', text: '门外有人。我想先隔门问问，你愿意一起听吗？不想去也没关系。', goalKey: 'understand-knock', evidenceFactKeys: ['knocking'], audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null};
        }
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const fixture = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3});});
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await openChatNarrativeTools(page)
    await page.getByText('提出新的情境或矛盾', {exact: true}).click();
    await page.getByLabel('新的情境或矛盾', {exact: true}).fill('门外传来敲门声。幕后要求不要预设来者身份。');
    await page.getByRole('button', {name: '构建情境并演绎', exact: true}).click();
    if (rejectReview) await expect(page.getByText(/情境语义审查未通过，原有局面保留/)).toBeVisible();
    else await expect(page.getByRole('paragraph').filter({hasText: /^门外有人。我想先隔门问问/})).toBeVisible();
    await expect(page.getByRole('button', {name: '构建情境并演绎', exact: true})).toBeEnabled();
    expect(calls).toBe(rejectReview ? 2 : 4);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    const state = await page.evaluate(async f => {const load = new Function('p', 'return import(p)'); return (await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId)).interaction;}, fixture);
    expect(state.messages.map((m: {role: string}) => m.role)).toEqual(rejectReview ? [] : ['character']);
    expect(state.chatNarrative.situation.facts.some((f: {factKey: string}) => f.factKey === 'knocking')).toBe(!rejectReview);
    expect(state.chatNarrative.situation.facts.some((f: {factKey: string}) => f.factKey === 'secret')).toBe(true);
    expect(calls).toBe(rejectReview ? 2 : 4);
    if (!rejectReview) {
        await page.setViewportSize({width: 390, height: 844});
        await openChatNarrativeTools(page)
        await page.getByText('提出新的情境或矛盾', {exact: true}).click();
        await page.getByTestId('chat-narrative-controls').scrollIntoViewIfNeeded();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({path: info.outputPath('runtime-situation-mobile.png')});
    }
});

test('refresh resumes an unreviewed situation with one explicit review and no repeated construction', async ({page}) => {
    test.setTimeout(120000);
    let calls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-situation-resume.invalid/v1', model: 'test', maxTokens: 6000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-situation-resume.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const output = calls === 1 ? {kind: 'chat-situation', title: '敲门声', location: '驿站', timeLabel: '傍晚', newFacts: [{factKey: 'knocking', kind: 'observation', text: '门外传来敲门声。', audienceKeys: ['player', 'guard', 'artisan'], evidenceFactKeys: ['road'], seedExcerpt: '门外传来敲门声'}], newGoals: [], newThreads: [], possibilities: [{actorKey: 'guard', text: '可以隔门询问，也可以等待。', evidenceFactKeys: ['knocking']}]} : {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具'}))};
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, output)}, finish_reason: 'stop'}]})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const fixture = await page.evaluate(async () => {
        const load = new Function('p', 'return import(p)');
        const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture();
        const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts');
        const v = await api.readProductRuntimeStateVersion(f.sessionId);
        await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'seed', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'player-seed', sourceEventSequence: v.sequence, seed: '门外传来敲门声。'});
        try {
            await (await load('/storyforge/src/lib/character-interaction/harness.ts')).generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'player', skillId: 'character.chat-situation-construction', objective: '内化情境请求', aiConfig: {provider: 'openai', baseUrl: 'https://chat-situation-resume.invalid/v1', model: 'test', apiKey: 'isolated-test-key', maxTokens: 6000}, onSituationDraftSaved: () => {throw new Error('host-crashed');}});
        } catch (error) {if (!String(error).includes('host-crashed')) throw error;}
        return f;
    });
    expect(calls).toBe(1);
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`);
    await expect(page.getByRole('heading', {name: '候选等待审查', exact: true})).toBeVisible();
    await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeDisabled();
    await reloadWithBrowserFixtureAIConfigV1(page);
    await page.getByRole('button', {name: /继续审查并应用 #/}).click();
    await expect(page.getByRole('heading', {name: '候选等待审查', exact: true})).toHaveCount(0);
    expect(calls).toBe(2);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await page.getByText('当前已知的局面', {exact: true}).click();
    await expect(page.getByRole('listitem').filter({hasText: /^门外传来敲门声。$/})).toBeVisible();
    expect(calls).toBe(2);
});

test('a malformed action review never exposes the unapproved reply or coordinator secret', async ({page}) => {
    test.setTimeout(120000);
    let calls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-review-private.invalid/v1', model: 'test', maxTokens: 9000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-review-private.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const request = route.request().postDataJSON();
        const reviewing = JSON.stringify(request.messages).includes('本次持久化行动候选');
        expect(request.max_tokens).toBe(reviewing ? 8000 : 4000);
        const output = reviewing ? '幕后：铜印就在柜台底下。这不是合法 JSON。' : chatActionResponseFixture(route, {kind: 'attempt', text: '沈禾已经答应陪同搜查。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null});
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: output}, finish_reason: 'stop'}]})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const f = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture();});
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${f.scope.projectId}&work=${f.scope.workId}&session=${f.sessionId}`);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await page.getByRole('button', {name: '让角色开场', exact: true}).click();
    await expect(page.getByText(/审查响应格式无效/)).toBeVisible();
    await expect(page.getByText('沈禾已经答应陪同搜查。', {exact: true})).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('柜台底下');
    expect(calls).toBe(2);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    expect(calls).toBe(2);
});

test('two browser pages cannot duplicate a narrative model call and player interruption is saved before a late response', async ({page, context}) => {
    test.setTimeout(120000);
    let calls = 0;
    let release!: () => void;
    const responseReady = new Promise<void>(resolve => {release = resolve;});
    let requestStarted!: () => void;
    const requested = new Promise<void>(resolve => {requestStarted = resolve;});
    await context.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(context, { provider: 'openai', baseUrl: 'https://chat-concurrency.invalid/v1', model: 'test', maxTokens: 4000, apiKey: 'isolated-test-key' })
    await context.route('https://chat-concurrency.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++; requestStarted(); await responseReady;
        const action = {kind: 'attempt', text: '尚未提交的后门邀请', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: true, newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null};
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, action)}, finish_reason: 'stop'}]})}).catch(() => undefined);
    });
    try {
        await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
        const fixture = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture();});
        const url = `./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`;
        await gotoWithBrowserFixtureAIConfigV1(page, url);
        await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
        await page.getByRole('button', {name: '让角色开场', exact: true}).click();
        await requested;
        const other = await context.newPage();
        await gotoWithBrowserFixtureAIConfigV1(other, url);
        await expect(other.getByRole('heading', {name: '上次聊天处理尚未结束', exact: true})).toBeVisible();
        await expect(other.getByRole('button', {name: '让角色继续', exact: true})).toBeDisabled();
        const concurrent = await other.evaluate(async f => {
            const load = new Function('p', 'return import(p)');
            try { await (await load('/storyforge/src/lib/character-interaction/harness.ts')).generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: 'duplicate attempt', aiConfig: {provider: 'openai', baseUrl: 'https://chat-concurrency.invalid/v1', model: 'test', apiKey: 'isolated-test-key'}}); return 'unexpected'; }
            catch (error) {return String(error);}
        }, fixture);
        expect(concurrent).toContain('另一页面正在生成');
        expect(calls).toBe(1);
        await page.getByPlaceholder('对当前场景中的角色说话…').fill('先停一下，我要换个办法。');
        await page.getByRole('button', {name: '打断并发送', exact: true}).click();
        await expect(page.getByRole('paragraph').filter({hasText: /^先停一下，我要换个办法。$/})).toBeVisible();
        expect(calls).toBe(1);
        release();
        await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled();
        await reloadWithBrowserFixtureAIConfigV1(page);
        await expect(page.getByRole('paragraph').filter({hasText: /^先停一下，我要换个办法。$/})).toBeVisible();
        await expect(page.getByText('尚未提交的后门邀请', {exact: true})).toHaveCount(0);
        expect(calls).toBe(1);
        await other.close();
    } finally {release();}
});

test('normal narrative chat opens, accepts refusal, continues and reloads without another model call', async ({page}, info) => {
    test.setTimeout(120000);
    let calls = 0, actionCalls = 0;
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-action.invalid/v1', model: 'test', temperature: .2, maxTokens: 4000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-action.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        calls++;
        const prompt = JSON.stringify(route.request().postDataJSON().messages);
        if (prompt.includes('本次持久化行动候选')) {
            const review = {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程审查夹具'}))};
            await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, review)}, finish_reason: 'stop'}]})});
            return;
        }
        actionCalls++;
        expect(prompt).not.toContain('柜台下');
        expect(prompt).not.toContain('天黑后不宜');
        const action = {kind: actionCalls === 1 ? 'attempt' : actionCalls === 2 ? 'complete' : 'pause', text: actionCalls === 1 ? '我想先看看后门。你愿意同行吗？不想去也可以留在这里。' : actionCalls === 2 ? '好，你先休息。我把灯移到门边。门边亮了起来。' : '叶岑在桌边坐下，暂时不再催促搜查。',
            goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player'], waitingForPlayer: actionCalls === 1,
            newFacts: actionCalls === 2 ? [{factKey: 'lamp', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}] : [], disclosures: [], threadUpdates: [], goalStatus: null};
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, action)}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 100, total_tokens: 200}})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const fixture = await page.evaluate(async () => {const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture({maxActionsPerTrigger: 3});});
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`);
    await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    expect(calls).toBe(0);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await openChatNarrativeTools(page)
    await page.getByLabel('演绎节奏', {exact: true}).selectOption('3');
    await page.getByRole('button', {name: '让角色开场', exact: true}).click();
    await expect(page.getByText('角色正在等你的回应。', {exact: false})).toBeVisible();
    expect(calls).toBe(2);
    await page.getByPlaceholder('对当前场景中的角色说话…').fill('我不去后门，先在这里休息。');
    await page.getByRole('button', {name: '发送并生成', exact: true}).click();
    await expect(page.getByRole('paragraph').filter({hasText: /^好，你先休息。我把灯移到门边。门边亮了起来。$/})).toBeVisible();
    await expect(page.getByRole('paragraph').filter({hasText: /^叶岑在桌边坐下，暂时不再催促搜查。$/})).toBeVisible();
    expect(calls).toBe(6);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    expect(calls).toBe(6);
    await page.getByText('当前已知的局面', {exact: true}).click();
    await expect(page.getByRole('listitem').filter({hasText: /^门边亮了起来。$/})).toBeVisible();
    await expect(page.getByText('掌柜把铜印留在柜台下的木箱里。', {exact: true})).toHaveCount(0);
    await expect(page.getByRole('button', {name: '重试该回复', exact: true})).toHaveCount(0);
    const roles = await page.evaluate(async f => {const load = new Function('p', 'return import(p)'); const state = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId); return state.interaction.messages.map((m: {role: string}) => m.role);}, fixture);
    expect(roles).toEqual(['character', 'player', 'character', 'character']);
    await page.getByLabel('本轮行动角色', {exact: true}).selectOption('guard');
    await page.getByRole('button', {name: '从上次局面继续', exact: true}).click();
    await expect.poll(() => calls).toBe(8);
    await expect(page.getByRole('button', {name: '让角色继续', exact: true})).toBeEnabled();
    await page.setViewportSize({width: 390, height: 844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('chat-narrative-controls').scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('narrative-player-mobile.png')});
});

for (const transfer of [false, true]) {
test(`v3 production offers initial situations, retains them across refresh and freezes the author selection (transfer=${transfer})`, async ({page}, info) => {
    test.setTimeout(120000);
    const response: {candidateOutput: unknown; actor: string} = {candidateOutput: null, actor: ''};
    const calls: string[] = [];
    await page.addInitScript(() => {
        localStorage.setItem('storyforge_guide_completed', 'e2e');
    });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-situation.invalid/v1', model: 'test', temperature: .2, maxTokens: 16000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-situation.invalid/**', async route => {
            if (await fulfillChatActionChoiceFixture(route)) return
        const body = route.request().postDataJSON();
        const prompt = JSON.stringify(body.messages);
        const initial = prompt.includes('初始情境编辑');
        const reviewing = prompt.includes('本次持久化行动候选');
        const openingReview = prompt.includes('开场的语义审查者');
        const production = calls.length < 3;
        calls.push(initial ? 'situations' : openingReview ? 'opening-review' : production ? 'media' : reviewing ? 'review' : 'action');
        const reviewOutput = openingReview ? await page.evaluate(async () => {
            const load = new Function('p', 'return import(p)'), {db} = await load('/storyforge/src/lib/db/schema.ts');
            const source = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'design.game').last()).payloadJson);
            const candidates = JSON.parse((await db.productBuildArtifacts.filter((row: {artifactKey: string}) => row.artifactKey === 'content.chat-candidates').last()).payloadJson);
            const helper = await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts');
            return helper.chatOpeningPerspectiveReviewFixture(source, candidates, helper.chatOpeningDevelopmentReviewFixture(candidates, 'option-1'));
        }) : null;
        const content = initial ? response.candidateOutput : openingReview ? reviewOutput : production
            ? {schema: 'storyforge.product-media-requirements-artifact', version: 2, visual: [], audio: []}
            : reviewing ? {checks: ['continuity', 'permissions', 'player-agency', 'visibility', 'consequences', 'meaningful-direction'].map(check => ({check, passed: true, reason: '工程夹具，不是质量验收'}))}
            : {kind: 'pause', text: '我先自己核对旧账本，你可以安心休息。', goalKey: 'repair', evidenceFactKeys: ['clock'], audienceKeys: ['player', response.actor], waitingForPlayer: false,
                newFacts: [], disclosures: [], threadUpdates: [], goalStatus: null};
        await route.fulfill({contentType: 'application/json', body: JSON.stringify({choices: [{message: {role: 'assistant', content: chatActionResponseFixture(route, content)}, finish_reason: 'stop'}], usage: {prompt_tokens: 100, completion_tokens: 100, total_tokens: 200}})});
    });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    let fixture = await page.evaluate(async () => {
        const load = new Function('p', 'return import(p)');
        const f = await (await load('/storyforge/tests/helpers/chat-narrative-production-fixture.ts')).seedChatNarrativeProductionFixture();
        const execute = (await load('/storyforge/src/lib/product-production/commands.ts')).executeProductProductionCommand;
        const created = await execute({scope: f.scope, command: {type: 'create-intent', commandId: 'e2e.chat-create', productionKey: 'e2e.chat-situations', productType: 'character-interaction', worldReleaseId: f.confirmed.worldReleaseId, userText: '选择修钟铺的初始局面'}});
        if (!created.ok) throw new Error(JSON.stringify(created));
        const saved = await execute({scope: f.scope, productionId: created.productionId, command: {type: 'save-brief-revision', commandId: 'e2e.chat-brief', expectedStateRevision: 0, parentRevision: null, brief: f.brief}});
        if (!saved.ok) throw new Error(JSON.stringify(saved));
        return {scope: f.scope, productionId: created.productionId, candidates: f.candidates};
    });
    response.candidateOutput = fixture.candidates;
    response.actor = fixture.candidates.options[1].situation.goals[0].actorKey;
    let query = `project=${fixture.scope.projectId}&work=${fixture.scope.workId}&production=${fixture.productionId}`;
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/vision?${query}`);
    await expect(page.getByTestId('chat-narrative-setup')).toBeVisible();
    await page.getByLabel('玩家虚构角色的称呼', {exact: true}).fill('沈禾');
    await page.getByRole('button', {name: '保存方案', exact: true}).click();
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByLabel('玩家虚构角色的称呼', {exact: true})).toHaveValue('沈禾');
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?${query}`);
    await page.getByRole('button', {name: '启用自动制作', exact: true}).click();
    await page.getByRole('button', {name: '作者授权并开始自动制作', exact: true}).click();
    await expect(page.getByTestId('chat-situation-selection')).toBeVisible({timeout: 60000});
    expect(calls).toEqual(['situations', 'opening-review']);
    await expect(page.getByRole('button', {name: '选择「缺失零件」并继续', exact: true})).toBeDisabled();
    await expect(page.getByTestId('chat-opening-review')).toHaveCount(3);
    await expect(page.getByTestId('chat-opening-agency')).toHaveCount(2);
    await expect(page.getByTestId('chat-opening-agency').first()).toContainText('可能带来的变化');
    await expect(page.getByTestId('chat-opening-agency').first()).toContainText('仍需核实');
    await expect(page.getByTestId('chat-opening-development')).toHaveCount(2);
    await expect(page.getByTestId('chat-opening-development').first()).toContainText('这段局面如何发展');
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByRole('button', {name: '选择「旧账本」并继续', exact: true})).toBeEnabled();
    await expect(page.getByTestId('chat-opening-development')).toHaveCount(2);
    expect(calls).toEqual(['situations', 'opening-review']);
    if (transfer) {
        fixture = await page.evaluate(async f => {
            const load = new Function('p', 'return import(p)');
            const db = (await load('/storyforge/src/lib/db/schema.ts')).db;
            const backup = await load('/storyforge/src/lib/export/json-export.ts');
            const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId));
            const scope = (await (await load('/storyforge/src/lib/workspace/ownership.ts')).resolveWorkspaceOwnership(projectId)).scope;
            const production = await db.productProductions.where('projectId').equals(projectId).first();
            const brief = await db.productProductionBriefs.where('productionId').equals(production.id).first();
            if (brief.sourceWorldReleaseId === JSON.parse(brief.briefJson).source.worldReleaseId) throw Error('Transfer must change source locator');
            return {...f, scope, productionId: production.id};
        }, fixture);
        query = `project=${fixture.scope.projectId}&work=${fixture.scope.workId}&production=${fixture.productionId}`;
        await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?${query}`);
        await expect(page.getByRole('button', {name: '选择「旧账本」并继续', exact: true})).toBeEnabled();
        expect(calls).toEqual(['situations', 'opening-review']);
    }
    await page.setViewportSize({width: 390, height: 844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId('chat-situation-selection').screenshot({path: info.outputPath('chat-situation-selection-mobile.png')});
    await page.getByRole('button', {name: '选择「旧账本」并继续', exact: true}).click();
    await expect.poll(async () => page.evaluate(async f => {
        const load = new Function('p', 'return import(p)');
        const db = (await load('/storyforge/src/lib/db/schema.ts')).db;
        return (await db.productBuilds.where('productionId').equals(f.productionId).last())?.status;
    }, fixture), {timeout: 60000}).toBe('release-ready');
    expect(calls).toEqual(['situations', 'opening-review', 'media']);
    const frozen = await page.evaluate(async f => {
        const load = new Function('p', 'return import(p)');
        const service = await load('/storyforge/src/lib/product-production/service.ts');
        const details = await service.readProductProductionDetailsV1(f.scope, f.productionId);
        const artifacts = await service.listProductProductionReviewArtifactsV1({scope: f.scope, buildId: details.build.id});
        const runtime = artifacts.find((a: {artifactKey: string}) => a.artifactKey === 'runtime.package').payload;
        return {title: runtime.interaction.chatNarrative.initialSituation.title, persona: runtime.interaction.chatNarrative.persona.name, choices: runtime.narrative.choices};
    }, fixture);
    // A later S2 edit must not mutate the already-frozen Brief or selected Build.
    expect(frozen).toEqual({title: '旧账本', persona: '你', choices: []});
    if (transfer) {
        fixture = await page.evaluate(async f => {
            const load = new Function('p', 'return import(p)');
            const db = (await load('/storyforge/src/lib/db/schema.ts')).db;
            const backup = await load('/storyforge/src/lib/export/json-export.ts');
            const projectId = await backup.importProjectJSON(await backup.exportProjectJSON(f.scope.projectId));
            const scope = (await (await load('/storyforge/src/lib/workspace/ownership.ts')).resolveWorkspaceOwnership(projectId)).scope;
            const production = await db.productProductions.where('projectId').equals(projectId).first();
            return {...f, scope, productionId: production.id};
        }, fixture);
        query = `project=${fixture.scope.projectId}&work=${fixture.scope.workId}&production=${fixture.productionId}`;
        await gotoWithBrowserFixtureAIConfigV1(page, `./chat/production?${query}`);
        await page.getByTestId('product-production-recover-import-proof').click();
        await expect(page.getByRole('button', {name: '复验并原子发布', exact: true})).toBeEnabled();
        expect(calls).toEqual(['situations', 'opening-review', 'media']);
        await reloadWithBrowserFixtureAIConfigV1(page);
        await expect(page.getByTestId('product-production-recover-import-proof')).toHaveCount(0);
    }
    await page.getByRole('button', {name: '复验并原子发布', exact: true}).click();
    const readRelease = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); const db = (await load('/storyforge/src/lib/db/schema.ts')).db;
        return (await db.productProductions.get(f.productionId)).currentProductReleaseId;}, fixture);
    await expect.poll(readRelease, {timeout: 60000}).toBeGreaterThan(0);
    const releaseId = await readRelease();
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?${query}`);
    await page.getByRole('button', {name: '新建会话', exact: true}).click();
    await expect(page.getByText('我先自己核对旧账本，你可以安心休息。', {exact: true})).toBeVisible({timeout: 60000});
    const readPlayer = () => page.evaluate(async f => {const load = new Function('p', 'return import(p)'); const db = (await load('/storyforge/src/lib/db/schema.ts')).db;
        const session = (await db.productRuntimeSessions.where('projectId').equals(f.scope.projectId).toArray()).find((s: {workId: number}) => s.workId === f.scope.workId);
        const state = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(session.id);
        return {releaseId: session.productReleaseId, narrative: state.interaction.chatNarrative, messages: state.interaction.messages};}, fixture);
    const before = await readPlayer();
    expect(before.releaseId).toBe(releaseId); expect(before.narrative.situation.title).toBe('旧账本'); expect(before.narrative.persona.name).toBe('你');
    expect(calls).toEqual(['situations', 'opening-review', 'media', 'action', 'review']);
    await reloadWithBrowserFixtureAIConfigV1(page); await expect(page.getByTestId('chat-narrative-controls')).toBeVisible();
    expect(await readPlayer()).toEqual(before);
    expect(calls).toEqual(['situations', 'opening-review', 'media', 'action', 'review']);
});
}
test('a persisted narrative action resumes in the browser without another model call and keeps its consequence', async ({page}) => {
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const fixture = await page.evaluate(async () => {
        const load = new Function('p', 'return import(p)');
        const f = await (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture();
        const api = await load('/storyforge/src/lib/character-interaction/runtime-api.ts');
        const v = await api.readProductRuntimeStateVersion(f.sessionId);
        await api.requestChatNarrativeTrigger({sessionId: f.sessionId, commandId: 'e2e:start', baseSequence: v.sequence, baseStateHash: v.stateHash, kind: 'scene-start', sourceEventSequence: f.sceneSequence});
        const h = await load('/storyforge/src/lib/character-interaction/harness.ts');
        const result = await h.generateInteractionRuntimeCandidateV1({scope: f.scope, productRuntimeSessionId: f.sessionId, participantKey: 'guard', skillId: 'character.chat-narrative-action', objective: '工程验证开场自身行动',
            runReviewAI: async () => JSON.stringify((await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).chatActionReviewOutputFixture()),
            runAI: (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).withChatActionChoiceFixture(async () => JSON.stringify({kind: 'complete', text: '叶岑把油灯移到门边。门边亮了起来。', goalKey: 'find-seal', evidenceFactKeys: ['lost'], audienceKeys: ['guard', 'player', 'artisan'], waitingForPlayer: false,
                newFacts: [{factKey: 'lamp', kind: 'observation', text: '门边亮了起来。', evidenceFactKeys: ['lost'], evidenceExcerpt: '门边亮了起来。'}], disclosures: [], threadUpdates: [], goalStatus: null}))});
        return {...f, runId: result.snapshot.run.id};
    });
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await page.getByRole('button', {name: `恢复 Run #${fixture.runId}`, exact: true}).click();
    await expect(page.getByRole('paragraph').filter({hasText: /^叶岑把油灯移到门边。门边亮了起来。$/})).toBeVisible();
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByRole('paragraph').filter({hasText: /^叶岑把油灯移到门边。门边亮了起来。$/})).toBeVisible();
    expect(await page.evaluate(async f => {
        const load = new Function('p', 'return import(p)');
        const state = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(f.sessionId);
        return {fact: state.interaction.chatNarrative.situation.facts.at(-1).text, roles: state.interaction.messages.map((m: {role: string}) => m.role)};
    }, fixture)).toEqual({fact: '门边亮了起来。', roles: ['character']});
});
test('narrative situation survives browser reload and checkpoint branch with role secrets isolated', async ({page}) => {
    test.setTimeout(120000);
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const fixture = await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/chat-narrative-fixture.ts')).seedChatNarrativeRuntimeFixture(); });
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`);
    await expect(page.getByPlaceholder('对当前场景中的角色说话…')).toBeVisible();
    const read = async () => page.evaluate(async f => {
        const load = new Function('p', 'return import(p)');
        const sessionId = Number(new URLSearchParams(location.search).get('session'));
        const runtime = await (await load('/storyforge/src/lib/character-interaction/runtime-api.ts')).readProductRuntimeState(sessionId);
        const context = await (await load('/storyforge/src/lib/registry/assemble-context.ts')).assembleContext({projectId: f.scope.projectId, scope: f.scope, productRuntimeSessionId: sessionId, interactionParticipantKey: 'guard', sourceKeys: ['interactionRuntime']});
        return {narrative: runtime.interaction.chatNarrative, messages: runtime.interaction.messages, context: context.text};
    }, fixture);
    const initial = await read();
    expect(initial.messages).toEqual([]);
    expect(initial.context).toContain('担心再次错怪人');
    expect(initial.context).not.toContain('柜台下');
    expect(initial.context).not.toContain('天黑后不宜');
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByPlaceholder('对当前场景中的角色说话…')).toBeVisible();
    expect((await read()).narrative).toEqual(initial.narrative);
    await page.getByRole('navigation', {name: '角色聊天页内目录'}).getByRole('button', {name: '会话与分支', exact: true}).click();
    await page.getByPlaceholder('检查点名称').fill('情境检查点');
    await page.getByRole('button', {name: '保存', exact: true}).click();
    await page.getByRole('button', {name: /情境检查点.*分支/}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page).not.toHaveURL(new RegExp(`session=${fixture.sessionId}$`));
    const branch = await read();
    expect(branch.narrative).toEqual(initial.narrative);
    expect(branch.messages).toEqual([]);
    expect(branch.context).not.toContain('柜台下');
});
test('character chat pages stay open; draft and confirmed main Agent candidate survive refresh', async ({ page }, info) => {
    test.setTimeout(120000);
    await page.addInitScript(() => { localStorage.setItem('storyforge_guide_completed', 'e2e');   });
    registerBrowserFixtureAIConfigV1(page, { provider: 'openai', baseUrl: 'https://chat-test.invalid/v1', model: 'test', temperature: .2, maxTokens: 8000, apiKey: 'isolated-test-key' })
    await page.route('https://chat-test.invalid/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { role: 'assistant', content: chatActionResponseFixture(route, { answer: '建议让玩家成为档案员，请确认。', changes: [{field: 'playerRole', value: '档案员', reason: '按作者本次要求起草身份提议，不改动其他设置。', basis: 'proposal', evidence: []}] }) }, finish_reason: 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }) }));
    for (const [id] of CHAT_PAGES) {
        await gotoWithBrowserFixtureAIConfigV1(page, `./chat/${id}`);
        await expect(page.getByTestId('character-chat-page')).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/vision');
    await page.getByLabel('作品名称', { exact: true }).fill('聊天接入验收');
    await page.getByLabel('玩家身份', { exact: true }).fill('守灯人');
    await page.getByRole('button', { name: '保存方案', exact: true }).click();
    await expect(page).toHaveURL(/chat\/vision\?project=\d+&work=\d+/);
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByLabel('玩家身份', { exact: true })).toHaveValue('守灯人', { timeout: 15000 });
    const nav = page.getByRole('navigation', { name: '角色聊天页内目录' });
    await nav.getByRole('button', { name: '制作流程', exact: true }).click();
    await expect(page.getByRole('heading', { name: '开始制作，需要一个世界引擎', exact: true })).toBeVisible();
    await nav.getByRole('button', { name: '方案会谈', exact: true }).click();
    await page.getByLabel('角色聊天 会谈输入').fill('玩家改为档案员');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    await expect(page.getByRole('button', { name: '采用勾选的修改', exact: true })).toBeEnabled({ timeout: 20000 });
    await reloadWithBrowserFixtureAIConfigV1(page);
    await page.getByRole('button', { name: '采用勾选的修改', exact: true }).click();
    await expect(page.getByText('已采用所选修改；其他方案设置保持原样。', {exact: true})).toBeVisible();
    await nav.getByRole('button', { name: '互动目标', exact: true }).click();
    await expect(page.getByLabel('玩家身份', { exact: true })).toHaveValue('档案员');
    await page.screenshot({ path: info.outputPath('chat-s2.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('chat-mobile.png') });
});
test('private reply stays hidden, messages persist, checkpoints and branches remain independent', async ({ page }, info) => {
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    const fixture = await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); return (await load('/storyforge/tests/helpers/character-chat-fixture.ts')).seedChatRuntimeFixture(); });
    const query = `project=${fixture.scope.projectId}&work=${fixture.scope.workId}&session=${fixture.sessionId}`;
    await gotoWithBrowserFixtureAIConfigV1(page, `./chat/play?${query}`);
    await page.getByPlaceholder('对当前场景中的角色说话…').fill('浏览器玩家消息');
    await page.getByRole('button', { name: '仅保存消息', exact: true }).click();
    // Wait for the persisted message and cleared composer before reloading.
    await expect(page.getByRole('paragraph').filter({ hasText: /^浏览器玩家消息$/ })).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder('对当前场景中的角色说话…')).toHaveValue('');
    await expect(page.getByRole('button', { name: '仅保存消息', exact: true })).toBeDisabled();
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByRole('paragraph').filter({ hasText: /^浏览器玩家消息$/ })).toBeVisible({ timeout: 15000 });
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
    await expect(page.getByRole('paragraph').filter({ hasText: /^浏览器玩家消息$/ })).toBeVisible();
});
test('S2 role settings reach the frozen production brief through the real confirmation UI', async ({ page }, info) => {
    test.setTimeout(120000);
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/library');
    await page.evaluate(async () => { const load = new Function('p', 'return import(p)'); await (await load('/storyforge/tests/helpers/current-product-world.ts')).seedCurrentProductWorld('聊天来源验收'); });
    await gotoWithBrowserFixtureAIConfigV1(page, './chat/vision');
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
    await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click();
    await page.getByLabel('林舟 姓名 可见范围', {exact: true}).selectOption('public');
    await page.getByLabel('林舟 性格 用途', {exact: true}).selectOption('voice');
    await page.getByLabel('林舟 性格 可见范围', {exact: true}).selectOption('participants');
    await page.getByLabel('林舟 背景 可见范围', {exact: true}).selectOption('author-only');
    await page.getByRole('button', {name: '确认可见范围并用于新制作', exact: true}).click();
    await expect(page.getByText('已保存资料确认。更换角色或世界后需要重新检查。', {exact: true})).toBeVisible();
    await reloadWithBrowserFixtureAIConfigV1(page);
    await expect(page.getByText('已保存资料确认。更换角色或世界后需要重新检查。', {exact: true})).toBeVisible();
    await page.getByRole('button', {name: '读取并检查完整资料', exact: true}).click();
    await expect(page.getByLabel('林舟 背景 可见范围', {exact: true})).toHaveValue('author-only');
    await page.setViewportSize({width: 390, height: 844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByLabel('林舟 姓名 可见范围', {exact: true}).scrollIntoViewIfNeeded();
    await page.screenshot({path: info.outputPath('chat-source-review-mobile.png')});
    await page.setViewportSize({width: 1280, height: 900});
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
    expect(brief.characterChat.version).toBe(2);
    expect(brief.characterChat.sourceReview.classifications).toEqual(expect.arrayContaining([expect.objectContaining({visibility: 'author-only'})]));
    expect(brief.characterChat.characters[0]).toMatchObject({ initialTrust: 24, privateKnowledge: '信封内的暗号只有林舟知道' });
    expect(brief.intent.playerRole).toBe('守灯人');
    const sourcePlan = await page.evaluate(async () => {
        const load = new Function('p', 'return import(p)');
        const db = (await load('/storyforge/src/lib/db/schema.ts')).db;
        const id = Number(new URLSearchParams(location.search).get('production'));
        const row = await db.productProductionBriefs.where('[productionId+revision]').equals([id, 1]).first();
        return (await load('/storyforge/src/lib/product-production/source-contracts.ts')).parseProductProductionSourcePlanV1(row);
    });
    expect(sourcePlan.version).toBe(2);
    expect(sourcePlan.compiler.compilerId).toBe('storyforge.character-interaction.world-compiler');
    expect(sourcePlan.exact.authorResourceKeys).toEqual([...brief.source.selection.resourceKeys].sort());
    expect(sourcePlan.exact.resources.every((item: { minimumDepth: string }) => item.minimumDepth === 'original')).toBe(true);
    await page.screenshot({ path: info.outputPath('chat-confirmed-production.png') });
});

test('browser history keeps unsaved settings with their own Work',async({page})=>{
 await gotoWithBrowserFixtureAIConfigV1(page, './chat/library')
 const [a,b]=await page.evaluate(async()=>{const load=new Function('p','return import(p)');const {createChatDraftV1}=await load('/storyforge/src/lib/character-interaction/draft-service.ts');const {DEFAULT_CHAT_SETTINGS}=await load('/storyforge/src/lib/character-interaction/authoring-contract.ts');return Promise.all(['甲','乙'].map(async playerRole=>{const c=await createChatDraftV1(playerRole,{...DEFAULT_CHAT_SETTINGS,playerRole});return `./chat/vision?project=${c.scope.projectId}&work=${c.scope.workId}`}))})
 await gotoWithBrowserFixtureAIConfigV1(page, a)
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('甲')
 await page.getByLabel('玩家身份',{exact:true}).fill('甲的未保存身份')
 await page.evaluate(href=>{history.pushState(null,'',href.replace('./','/storyforge/'));dispatchEvent(new PopStateEvent('popstate'))},b)
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('乙')
 await page.goBack()
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('甲的未保存身份')
 await page.getByRole('button',{name:'保存方案',exact:true}).click()
 await gotoWithBrowserFixtureAIConfigV1(page, b)
 await expect(page.getByLabel('玩家身份',{exact:true})).toHaveValue('乙')
 await page.getByLabel('玩家身份',{exact:true}).fill('乙的本地修改')
 await page.evaluate(async()=>{const load=new Function('p','return import(p)');const db=(await load('/storyforge/src/lib/db/schema.ts')).db;const svc=await load('/storyforge/src/lib/character-interaction/draft-service.ts');const work=await db.works.get(Number(new URLSearchParams(location.search).get('work')));const scope={projectId:work.projectId,worldId:work.worldId,workId:work.id};const d=await svc.readChatDraftV1(scope);await svc.saveChatDraftV1(scope,d.revision,{...JSON.parse(d.settingsJson),playerRole:'乙的另一个标签页修改'})})
 await page.getByRole('button',{name:'保存方案',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('其他页面修改')
 const stored=await page.evaluate(async()=>{const load=new Function('p','return import(p)');const db=(await load('/storyforge/src/lib/db/schema.ts')).db;const d=await db.chatAuthoringDrafts.where('workId').equals(Number(new URLSearchParams(location.search).get('work'))).first();return JSON.parse(d.settingsJson).playerRole})
 expect(stored).toBe('乙的另一个标签页修改')
})
