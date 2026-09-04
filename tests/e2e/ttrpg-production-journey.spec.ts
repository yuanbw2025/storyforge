import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  openCurrentTtrpgPlayer,
  seedCurrentTtrpgProduct,
  type CurrentTtrpgSeedInput,
  type CurrentTtrpgSeedSeat,
} from "./helpers/current-products";

async function configureMockedTextProvider(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "storyforge_guide_completed",
      "ttrpg-production-browser-rehearsal",
    );
    localStorage.setItem("storyforge-ai-api-key-remember", "true");
    localStorage.setItem(
      "storyforge-ai-config",
      JSON.stringify({
        provider: "agnes",
        apiKey: "browser-rehearsal-key",
        model: "agnes-2.0-flash",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        temperature: 0,
        maxTokens: 0,
      }),
    );
  });
  await page.route("**/chat/completions", async (route) => {
    const body = route.request().postDataJSON() as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const system =
      body.messages?.find((message) => message.role === "system")?.content ??
      "";
    const output = system.includes("StoryForge 可信 AI KP 的 NPC 行动提议器")
      ? {
          actionKey: "investigate",
          targetKey: null,
          approach:
            "依据当前角色掌握的现场事实谨慎核对痕迹，并对玩家的调查形成合理回应。",
          spokenIntent: "先让我确认这里发生了什么。",
        }
      : system.includes("StoryForge 可信 AI GM 的候选叙事生成器")
        ? (() => {
            const marker = "【冻结主持上下文】\n";
            const contextMessage = body.messages?.find(
              (message) => message.role === "user" && message.content?.includes(marker),
            )?.content;
            if (!contextMessage) throw new Error("AI GM 测试请求缺少冻结主持上下文");
            const view = JSON.parse(contextMessage.slice(contextMessage.indexOf(marker) + marker.length)) as {
              latestAction?: {
                receipt?: {
                  actionSequence: number;
                  mechanicalSummary: string;
                  actorConsequence: string;
                  sceneConsequence: string;
                  worldConsequence: string;
                  context: {
                    actorKey: string;
                    observers: Array<{
                      actorKey: string;
                      relevance: "primary" | "relevant" | "ambient";
                      responsePolicy: "actor-owned" | "prompt-human" | "ai-eligible" | "gm-eligible" | "observe-only";
                    }>;
                  };
                };
              };
            };
            const receipt = view.latestAction?.receipt;
            if (!receipt) throw new Error("AI GM 测试上下文缺少行动回执");
            return {
              narration:
                "规则结果已经呈现；现场人物依据各自所知作出反应，后续选择仍交给玩家决定。",
              synthesisFrame: {
                schema: "storyforge.ttrpg-gm-synthesis-frame",
                version: 2,
                actionSequence: receipt.actionSequence,
                mechanicalOutcome: receipt.mechanicalSummary,
                actorFeedback: receipt.actorConsequence,
                reactions: receipt.context.observers
                  .filter(observer => observer.actorKey !== receipt.context.actorKey && observer.relevance !== "ambient")
                  .map(observer => ({
                    actorKey: observer.actorKey,
                    responsePolicy: observer.responsePolicy,
                    text: observer.responsePolicy === "ai-eligible" || observer.responsePolicy === "gm-eligible"
                      ? "该角色依据当前已知信息回应规则结果。"
                      : null,
                  })),
                sceneUpdate: receipt.sceneConsequence,
                worldUpdate: receipt.worldConsequence,
                nextPrompts: [],
              },
              offeredClueKeys: [],
              recommendedNextSceneKeys: [],
            };
          })()
        : system.includes("StoryForge 的隔离 AI 玩家行动提议器")
          ? {
              actionKey: "investigate",
              targetKey: null,
              approach:
                "依据眼前可见的痕迹逐项检查，并把可公开的观察告诉同伴。",
              spokenIntent: "我先核对这些痕迹。",
            }
          : null;
    if (output === null)
      throw new Error(`未识别的现行 TTRPG 运行请求：${system.slice(0, 160)}`);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: `ttrpg-browser-rehearsal-${Date.now()}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "agnes-2.0-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: { role: "assistant", content: JSON.stringify(output) },
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
  await page.route("**/images/generations", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-request-id": `ttrpg-image-${Date.now()}` },
      body: JSON.stringify({
        created: Math.floor(Date.now() / 1000),
        data: [
          {
            b64_json:
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2vAAAAABJRU5ErkJggg==",
            revised_prompt: "受控浏览器排练生成的透明占位图。",
          },
        ],
        usage: { total_tokens: 1 },
      }),
    });
  });
}

function ttrpgSeat(
  index: number,
  controller: CurrentTtrpgSeedSeat["controller"],
  characterMode: CurrentTtrpgSeedSeat["characterMode"],
  privateGoal = "",
): CurrentTtrpgSeedSeat {
  return {
    seatKey: `player.${index}`,
    label: `玩家 ${index}`,
    controller,
    role: "player",
    characterMode,
    sourceCharacterResourceKey: null,
    characterName: `调查者 ${index}`,
    rankTier: characterMode === "quick-card" ? "C" : null,
    privateGoal,
  };
}

function currentGoldenSeed(
  fixtureKey:
    | "rank-lite-mist-harbor"
    | "d20-fantasy-floodgate"
    | "d100-investigation-archive",
): CurrentTtrpgSeedInput {
  if (fixtureKey === "rank-lite-mist-harbor") {
    return {
      title: "Rank Lite 三真人潮门团",
      gmMode: "human",
      playerController: "human",
      ruleOrigin: "builtin-rank-lite",
      seats: [
        ttrpgSeat(1, "human", "quick-card"),
        ttrpgSeat(2, "human", "quick-card"),
        ttrpgSeat(3, "human", "quick-card"),
      ],
    };
  }
  if (fixtureKey === "d20-fantasy-floodgate") {
    return {
      title: "d20 混合席位潮门团",
      gmMode: "ai",
      playerController: "human",
      ruleOrigin: "builtin-d20-fantasy",
      seats: [
        ttrpgSeat(1, "human", "ai-generated"),
        ttrpgSeat(2, "human", "ai-generated"),
        ttrpgSeat(3, "ai", "ai-generated"),
      ],
    };
  }
  return {
    title: "d100 暗骰调查团",
    gmMode: "ai",
    playerController: "human",
    ruleOrigin: "builtin-d100-investigation",
    seats: [
      ttrpgSeat(1, "human", "ai-generated", "查明导师失踪真相，只向 KP 说明。"),
      ttrpgSeat(
        2,
        "ai",
        "ai-generated",
        "隐瞒账册经手人的身份，只向本角色与 KP 公开。",
      ),
      ttrpgSeat(
        3,
        "ai",
        "ai-generated",
        "保护低语外廊的证人，只向本角色与 KP 公开。",
      ),
    ],
  };
}

async function buildProductOwnedTtrpgFixture(
  page: Page,
  fixtureKey:
    | "rank-lite-mist-harbor"
    | "d20-fantasy-floodgate"
    | "d100-investigation-archive",
) {
  const seeded = await seedCurrentTtrpgProduct(
    page,
    currentGoldenSeed(fixtureKey),
  );
  const guide = await openCurrentTtrpgPlayer(page);
  await expect(guide).toContainText(seeded.ruleTitle);
  return { guide, seeded };
}

test("跑团专属受控 Golden C slice：统一 Build、三真人开桌、规则回执、存档与刷新恢复", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  const { guide, seeded } = await buildProductOwnedTtrpgFixture(
    page,
    "rank-lite-mist-harbor",
  );
  expect(seeded.releaseHash).toMatch(/^[a-f0-9]{64}$/);
  expect(seeded.packageHash).toMatch(/^[a-f0-9]{64}$/);
  const binding = await page.evaluate(async (sessionId) => {
    const importer = new Function("path", "return import(path)") as (
      path: string,
    ) => Promise<any>;
    const { db } = await importer("/storyforge/src/lib/db/schema.ts");
    const session = await db.productRuntimeSessions.get(sessionId);
    const build =
      session?.productBuildId == null
        ? null
        : await db.productBuilds.get(session.productBuildId);
    return {
      sessionBuildId: session?.productBuildId ?? null,
      sessionReleaseId: session?.productReleaseId ?? null,
      runtimeSourceHash: session?.runtimeSourceHash ?? null,
      buildProductionId: build?.productionId ?? null,
    };
  }, seeded.sessionId);
  expect(binding).toEqual({
    sessionBuildId: seeded.buildId,
    sessionReleaseId: null,
    runtimeSourceHash: seeded.packageHash,
    buildProductionId: seeded.productionId,
  });
  await completeSessionZero(page, false);
  await guide
    .getByRole("button", { name: "宣布本场开始", exact: true })
    .click();
  await expect(guide).toContainText("正在进行：第 1 场");
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  const activeActor = guide.getByTestId("ttrpg-active-actor");
  for (let guard = 0; guard < 8; guard += 1) {
    const previousActor = (await activeActor.textContent()) ?? "";
    if (previousActor.includes("真人")) break;
    await expect(activeActor).toContainText("KP 控制");
    await guide
      .getByLabel("角色行动声明")
      .fill(
        `我以当前 NPC 的立场追问来意，并观察三名调查者是否隐瞒证据（KP 回合 ${guard + 1}）。`,
      );
    await guide
      .locator("button:enabled")
      .filter({ hasText: /提交意图.*结算|检定并结算/ })
      .first()
      .click();
    await expect(guide.getByTestId("ttrpg-action-receipt")).toContainText(
      "行动终态回执",
    );
    await expect.poll(() => activeActor.textContent()).not.toBe(previousActor);
  }
  await expect(activeActor).toContainText("真人");
  await guide
    .getByLabel("角色行动声明")
    .fill("我检查潮痕与封条的差异，并把观察结果告诉同伴。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算|检定并结算/ })
    .first()
    .click();
  const receipt = guide.getByTestId("ttrpg-action-receipt");
  await expect(receipt).toBeVisible();
  await expect(receipt).toContainText("行动终态回执");
  await expect(receipt).toContainText("行动者后果");
  await expect(receipt).toContainText("场景反馈");
  await expect(receipt).toContainText(/d20|D20/);

  const save = guide.getByTestId("ttrpg-save-and-branch");
  await save.getByLabel("正式战役检查点名称").fill("首次规则行动后");
  await save.getByRole("button", { name: "保存", exact: true }).click();
  await expect(save).toContainText("首次规则行动后");

  await page.reload();
  const restored = await openCurrentTtrpgPlayer(page);
  await expect(restored.getByTestId("ttrpg-action-receipt")).toBeVisible({
    timeout: 20_000,
  });
  await expect(restored).toContainText("Session Zero 已完成");
  await expect(restored.getByTestId("ttrpg-save-and-branch")).toContainText(
    "首次规则行动后",
  );
});

test("跑团专属受控 Golden A slice：d20 混合席位、AI 回合、规则回执与 AI KP 叙事采用", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  const { guide } = await buildProductOwnedTtrpgFixture(
    page,
    "d20-fantasy-floodgate",
  );
  await expect(guide).toContainText("StoryForge 5E 兼容奇幻核心");
  await completeSessionZero(page, true);
  await guide
    .getByRole("button", { name: "宣布本场开始", exact: true })
    .click();
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await advanceAutomatedTtrpgTurnsUntilHuman(guide);
  await guide
    .getByLabel("角色行动声明")
    .fill("我借助训练检查封条，并准备在书记员阻拦时保护同伴。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算|检定并结算/ })
    .first()
    .click();
  const receipt = guide.getByTestId("ttrpg-action-receipt");
  await expect(receipt).toContainText("行动终态回执");
  await expect(receipt).toContainText(/d20|D20/);

  await ensureAiGmExperimentEnabled(guide);
  await guide
    .getByRole("button", { name: "生成受治理候选", exact: true })
    .click();
  await expect(
    guide.getByRole("button", { name: "确认并写入叙事", exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await guide
    .getByRole("button", { name: "确认并写入叙事", exact: true })
    .click();
  await expect(guide.getByTestId("formal-ttrpg-gm-narration")).toContainText(
    "AI GM",
  );
});

test("跑团专属受控 Golden B slice：d100 暗骰、AI 玩家推进与角色私密信息隔离", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await configureMockedTextProvider(page);
  const { guide } = await buildProductOwnedTtrpgFixture(
    page,
    "d100-investigation-archive",
  );
  await expect(guide).toContainText("StoryForge d100 调查规则");
  await completeSessionZero(page, true);
  await guide
    .getByRole("button", { name: "宣布本场开始", exact: true })
    .click();
  await guide.getByRole("button", { name: "打开场景", exact: true }).click();
  await advanceAutomatedTtrpgTurnsUntilHuman(guide);
  await guide.getByLabel("检定可见性").first().selectOption("gm-only");
  await guide
    .getByLabel("角色行动声明")
    .fill("我逐项比对账册时间与封条纤维，并把可公开的部分告诉队伍。");
  await guide
    .locator("button:enabled")
    .filter({ hasText: /提交意图.*结算|检定并结算/ })
    .first()
    .click();
  await expect(guide.getByTestId("ttrpg-action-receipt")).toContainText(
    "行动终态回执",
  );
  await expect(guide.getByTestId("ttrpg-dice-proof-summary")).toContainText(
    /d100|D100/,
  );

  await guide.getByRole("button", { name: "玩家视图", exact: true }).click();
  await guide
    .getByRole("button", { name: /查看角色：/ })
    .first()
    .click();
  await expect(guide).toContainText("暗骰已提交");
  await expect(guide.getByTestId("ttrpg-dice-proof-summary")).toHaveCount(0);
  await expect(guide).not.toContainText(
    "隐瞒账册经手人的身份，只向本角色与 KP 公开。",
  );
  await expect(guide).not.toContainText(
    "保护低语外廊的证人，只向本角色与 KP 公开。",
  );
});

async function advanceAutomatedTtrpgTurnsUntilHuman(guide: Locator) {
  const activeActor = guide.getByTestId("ttrpg-active-actor");
  const determineControl = async () => {
    const label = (await activeActor.textContent()) ?? "";
    if (label.includes("真人")) return "human" as const;
    if (
      await guide
        .getByRole("button", {
          name: "将当前项目加入 AI GM 实验",
          exact: true,
        })
        .first()
        .isVisible()
        .catch(() => false)
    )
      return "enroll-ai-gm" as const;
    if (
      await guide
        .getByRole("button", {
          name: "推进 AI KP 的 NPC 回合",
          exact: true,
        })
        .isVisible()
        .catch(() => false)
    )
      return "ai-gm" as const;
    if (
      await guide
        .getByRole("button", {
          name: "推进 AI 玩家回合",
          exact: true,
        })
        .isVisible()
        .catch(() => false)
    )
      return "ai-player" as const;
    return "waiting" as const;
  };

  for (let guard = 0; guard < 12; guard += 1) {
    await expect
      .poll(determineControl, {
        message: "当前行动者必须由真人、AI 玩家或已授权的 AI KP 接管",
        timeout: 15_000,
      })
      .not.toBe("waiting");
    const control = await determineControl();
    if (control === "human") return;
    if (control === "enroll-ai-gm") {
      await guide
        .getByRole("button", {
          name: "将当前项目加入 AI GM 实验",
          exact: true,
        })
        .first()
        .click();
      await expect.poll(determineControl).not.toBe("enroll-ai-gm");
      continue;
    }

    const previousActor = await activeActor.textContent();
    if (control === "ai-gm") {
      await guide
        .getByRole("button", {
          name: "推进 AI KP 的 NPC 回合",
          exact: true,
        })
        .click();
      await expect(
        guide.getByTestId("ttrpg-ai-gm-actor-summary"),
      ).toContainText("RulePack 结算", { timeout: 30_000 });
    } else {
      await guide
        .getByRole("button", { name: "推进 AI 玩家回合", exact: true })
        .click();
      await expect(
        guide.getByTestId("ttrpg-ai-player-cycle-summary"),
      ).toContainText(/已停在真人回合|已停在 KP \/ NPC 回合/, {
        timeout: 30_000,
      });
    }
    await expect
      .poll(() => activeActor.textContent(), {
        message: "自动行动结算后必须推进到下一行动者",
        timeout: 15_000,
      })
      .not.toBe(previousActor);
  }
  throw new Error("自动行动推进超过 12 个边界，未抵达真人回合");
}

async function ensureAiGmExperimentEnabled(guide: Locator) {
  const generate = guide.getByRole("button", {
    name: "生成受治理候选",
    exact: true,
  });
  const enrollment = guide
    .getByRole("button", {
      name: "将当前项目加入 AI GM 实验",
      exact: true,
    })
    .first();
  const state = async () =>
    (await generate.isEnabled().catch(() => false))
      ? "ready"
      : (await enrollment.isVisible().catch(() => false))
        ? "needs-enrollment"
        : "waiting";
  await expect
    .poll(state, {
      message: "AI GM 应完成刷新或给出显式实验授权入口",
      timeout: 15_000,
    })
    .not.toBe("waiting");
  if ((await state()) === "needs-enrollment") await enrollment.click();
  await expect(generate).toBeEnabled({ timeout: 15_000 });
}

async function completeSessionZero(page: Page, aiDisclosure: boolean) {
  const guide = page.getByTestId("formal-ttrpg-campaign-guide");
  const sessionZero = guide.getByTestId("ttrpg-session-zero");
  if (aiDisclosure) {
    const disclosures = sessionZero.getByLabel("已知晓本团 AI 身份");
    for (let index = 0; index < (await disclosures.count()); index += 1) {
      if (!(await disclosures.nth(index).isChecked())) {
        await disclosures.nth(index).click();
        await expect(disclosures.nth(index)).toBeChecked();
      }
    }
  }
  await sessionZero.getByLabel("主题与强度").check();
  await sessionZero.getByLabel("角色间冲突").check();
  await sessionZero.getByLabel("录制与回放").check();
  await sessionZero.getByLabel("AI 参与").check();
  await sessionZero
    .getByRole("button", { name: "确认共识并开始战役", exact: true })
    .click();
  await expect(guide).toContainText("Session Zero 已完成");
  return guide;
}
