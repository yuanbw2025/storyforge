import { test, expect } from "@playwright/test";
import { DEFAULT_AVG_SETTINGS } from "../../src/lib/avg/authoring-contract";
test("AVG pages are open without a world; settings and confirmed conversation survive refresh", async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    localStorage.setItem("storyforge_guide_completed", "e2e");
    localStorage.setItem(
      "storyforge-ai-config",
      JSON.stringify({
        provider: "openai",
        baseUrl: "https://avg-test.invalid/v1",
        model: "gpt-4o",
        temperature: 0.2,
        maxTokens: 8000,
      }),
    );
    sessionStorage.setItem(
      "storyforge-ai-api-key-session",
      "isolated-test-key",
    );
  });
  let calls = 0;
  await page.route("https://avg-test.invalid/**", async (route) => {
    calls++;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: JSON.stringify({
                answer: "已调整为灯塔档案员，请确认。",
                settings: {
                  ...DEFAULT_AVG_SETTINGS,
                  playerRole: "灯塔档案员",
                  openingSituation: "寻找遗失的信",
                },
              }),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 200,
          total_tokens: 400,
        },
      }),
    });
  });
  await page.goto("./avg/narrative");
  await expect(
    page.getByRole("heading", { name: "叙事图与对白", exact: true }).first(),
  ).toBeVisible({ timeout: 30_000 });
  const nav = page.getByRole("navigation", { name: "AVG 页面导航" });
  const content = page.getByRole("navigation", { name: "AVG 内容导航" });
  await content.getByRole("button", { name: "故事与体验", exact: true }).click();
  await page.getByLabel("AVG 作品名称").fill("AVG 接入验收");
  await page.getByLabel("玩家身份／主角", { exact: true }).fill("巡夜人");
  await page.getByLabel("开场与核心目标").fill("寻找遗失的信");
  await page.getByRole("button", { name: "保存制作方案", exact: true }).click();
  await expect(page).toHaveURL(/avg\/vision\?project=\d+&work=\d+/);
  await page.reload();
  await expect(page.getByLabel("玩家身份／主角", { exact: true })).toHaveValue(
    "巡夜人",
  );
  await content.getByRole("button", { name: "制作流程", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "开始制作，需要一个世界引擎",
      exact: true,
    }),
  ).toBeVisible();
  await content.getByRole("button", { name: "方案会谈", exact: true }).click();
  await page.getByLabel("AVG 会谈输入").fill("把主角改成灯塔档案员");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "确认并回填制作方案" }),
  ).toBeEnabled({ timeout: 20000 });
  await page.reload();
  await page.getByRole("button", { name: "确认并回填制作方案" }).click();
  await expect(page.getByLabel("玩家身份／主角", { exact: true })).toHaveValue(
    "灯塔档案员",
  );
  expect(calls).toBe(1);
  await page.screenshot({ path: info.outputPath("avg-s2.png") });
  await page.evaluate(async () => {
    const load = new Function("p", "return import(p)");
    const world = await load(
      "/storyforge/src/lib/world-engine/mist-harbor-preset.ts",
    );
    await world.createMistHarborWorld();
  });
  await nav.getByRole("button", { name: "世界引擎", exact: true }).click();
  await page
    .getByRole("button", { name: "选择此版本", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "世界版本已引用" }),
  ).toBeVisible();
  await nav.getByRole("button", { name: "制作台", exact: true }).click();
  await content.getByRole("button", { name: "确认制作方案", exact: true }).click();
  await expect(page.getByLabel("玩家身份 / 主角", { exact: true })).toHaveValue(
    "灯塔档案员",
  );
  await page.reload();
  await expect(page.getByLabel("玩家身份 / 主角", { exact: true })).toHaveValue(
    "灯塔档案员",
  );
  await page.screenshot({ path: info.outputPath("avg-confirm.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("./avg/vision");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "AVG 目录", exact: true }).click();
  await nav.getByRole("button", { name: "作品库", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "AVG 接入验收", exact: true }),
  ).toBeVisible();
});
test("author edits persist and run as a new version without an AI request", async ({
  page,
}, info) => {
  await page.goto("./avg");
  const owned = await page.evaluate(async () => {
    const load = new Function("p", "return import(p)");
    return (
      await load("/storyforge/tests/helpers/avg-editor-fixture.ts")
    ).seedAvgEditorFixtureV1();
  });
  const query = `project=${owned.scope.projectId}&work=${owned.scope.workId}&production=${owned.productionId}`;
  await page.goto(`./avg/narrative?${query}`);
  await page
    .getByLabel("内容", { exact: true })
    .first()
    .fill("作者重新写下了这段开场。");
  await expect(page.getByRole("status")).toHaveText("编辑草稿已保存");
  await page.reload();
  await expect(page.getByLabel("内容", { exact: true }).first()).toHaveValue(
    "作者重新写下了这段开场。",
  );
  await page.screenshot({ path: info.outputPath("avg-narrative.png") });
  await page.getByRole("button", { name: "提交为新版本方案" }).click();
  await expect(page).toHaveURL(/avg\/production/);
  await page.getByRole("button", { name: "启用并继续确认" }).click();
  await page
    .getByRole("button", { name: "作者授权并开始自动制作", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "复验并原子发布", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await page
    .getByRole("button", { name: "试玩未发布 Build", exact: true })
    .click();
  await expect(page.locator(".avg-dialogue")).toContainText(
    "作者重新写下了这段开场。",
  );
  await page.screenshot({ path: info.outputPath("avg-revised-play.png") });
});

test('AVG operations contain workbench and player navigation without gating browsing',async({page},info)=>{
 await page.goto('./avg/library');
 const primary=page.getByRole('navigation',{name:'AVG 页面导航'});
 const content=page.getByRole('navigation',{name:'AVG 内容导航'});
 await expect(primary.getByRole('button')).toHaveText(['作品库','世界引擎','制作台','发布与版本','游玩','通用设置']);
 await expect(content).toHaveCount(0);
 await primary.getByRole('button',{name:'制作台',exact:true}).click();
 await expect(primary.locator('[aria-current="page"]')).toHaveText('制作台');
 await expect(content).toContainText('S2 · 产品定向');
 await expect(content).toContainText('S3 · 产品执行');
 await content.getByRole('button',{name:'音频与演出',exact:true}).click();
 await page.reload();
 await expect(content.locator('[aria-current="page"]')).toHaveText('音频与演出');
 await expect(primary.locator('[aria-current="page"]')).toHaveText('制作台');
 await page.screenshot({path:info.outputPath('avg-workbench-navigation.png')});
 await primary.getByRole('button',{name:'发布与版本',exact:true}).click();
 await expect(content).toHaveCount(0);
 await primary.getByRole('button',{name:'游玩',exact:true}).click();
 await content.getByRole('button',{name:'存档与路线',exact:true}).click();
 await page.reload();
 await expect(primary.locator('[aria-current="page"]')).toHaveText('游玩');
 await expect(content.locator('[aria-current="page"]')).toHaveText('存档与路线');
 await page.screenshot({path:info.outputPath('avg-player-navigation.png')});
 await page.setViewportSize({width:390,height:844});
 await page.getByRole('button',{name:'AVG 目录',exact:true}).click();
 await primary.getByRole('button',{name:'制作台',exact:true}).click();
 await page.getByRole('button',{name:'制作目录',exact:true}).click();
 await content.getByRole('button',{name:'路线与结局目标',exact:true}).click();
 await page.reload();
 await page.getByRole('button',{name:'制作目录',exact:true}).click();
 await expect(content.locator('[aria-current="page"]')).toHaveText('路线与结局目标');
 await page.screenshot({path:info.outputPath('avg-content-mobile.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 const counts=await page.evaluate(async()=>{const load=new Function('p','return import(p)');const {db}=await load('/storyforge/src/lib/db/schema.ts');return [await db.works.count(),await db.productProductions.count(),await db.productRuntimeSessions.count()]});
 expect(counts).toEqual([0,0,0]);
});
