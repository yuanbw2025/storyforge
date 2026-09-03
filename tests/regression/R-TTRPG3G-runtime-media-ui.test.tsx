import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TtrpgRuntimeMediaPanel from "../../src/components/ttrpg/TtrpgRuntimeMediaPanel";
import type { TtrpgViewerProjectionV1 } from "../../src/lib/ttrpg/viewer-projection";
import type { ProductRuntimePackageV1 } from "../../src/lib/types";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mediaMocks = vi.hoisted(() => ({
  readVisible: vi.fn(),
  request: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  readBlob: vi.fn(),
}));

vi.mock("../../src/lib/ttrpg/runtime-media", () => ({
  readVisibleTtrpgRuntimeMediaRequestsV1: mediaMocks.readVisible,
  requestConfiguredTtrpgRuntimeAssetV1: mediaMocks.request,
  retryConfiguredTtrpgRuntimeAssetRequestV1: mediaMocks.retry,
  cancelTtrpgRuntimeAssetRequestV1: mediaMocks.cancel,
  readTtrpgRuntimeMediaBlobV1: mediaMocks.readBlob,
}));

vi.mock("../../src/lib/product-production/media-resolver", () => ({
  createReleaseProductMediaResolver: vi.fn(async () => ({
    read: vi.fn(),
    preload: vi.fn(async () => ({ urls: {}, failures: [], usedBytes: 0 })),
    dispose: vi.fn(),
  })),
}));

type Media = NonNullable<TtrpgViewerProjectionV1["media"]>;

function projection(
  status: Media["slots"][number]["status"],
  requestKey: string | null,
): Media {
  return {
    generatedCount: 0,
    maximumGeneratedAssets: 3,
    slots: [
      {
        slotKey: "scene.opening.runtime",
        kind: "scene",
        targetRef: "scene.opening",
        fallbackText: "即使图片不可用，雾港场景仍可通过文字继续。",
        altText: "雾港场景图",
        status,
        requestKey,
        assetKey: null,
        mediaAssetId: null,
        mediaContentHash: null,
        lastErrorCode:
          status === "failed" ? "provider-generation-failed" : null,
      },
    ],
  };
}

const runtimePackage = {
  schema: "storyforge.product-runtime-package",
  version: 1,
  productType: "ttrpg",
  presentation: { version: 1, cues: [], assets: [] },
} as unknown as ProductRuntimePackageV1;

describe("R-TTRPG-3G · runtime media UI", () => {
  let host: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    mediaMocks.readVisible.mockReset().mockResolvedValue([]);
    mediaMocks.request
      .mockReset()
      .mockResolvedValue({ id: 1, status: "queued" });
    mediaMocks.retry.mockReset().mockResolvedValue({ id: 1, status: "queued" });
    mediaMocks.cancel
      .mockReset()
      .mockResolvedValue({ id: 1, status: "cancelled" });
    mediaMocks.readBlob.mockReset();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it("明确展示非阻塞 fallback，并从稳定槽位发起后台生成", async () => {
    const onChanged = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        createElement(TtrpgRuntimeMediaPanel, {
          sessionId: 7,
          scope: { projectId: 1, worldId: 2, workId: 3 },
          runtimePackage,
          source: { kind: "release", productReleaseId: 1 },
          media: projection("placeholder", null),
          viewerKey: "viewer.player.1",
          disabled: false,
          onChanged,
        }),
      );
    });
    expect(host.textContent).toContain("动态美术与视觉素材");
    expect(host.textContent).toContain(
      "即使图片不可用，雾港场景仍可通过文字继续",
    );
    expect(host.textContent).toContain("不会阻塞行动与规则裁决");
    const prompt = host.querySelector<HTMLInputElement>("input")!;
    await act(async () => {
      prompt.value = "强化潮门关闭前的紧迫感";
      prompt.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("后台生成"))!
        .click(),
    );
    expect(mediaMocks.request).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 7,
        viewerKey: "viewer.player.1",
        slotKey: "scene.opening.runtime",
      }),
    );
    expect(onChanged).toHaveBeenCalled();
  });

  it("失败只显示安全错误码，并提供受权限控制的重试与取消", async () => {
    mediaMocks.readVisible.mockResolvedValue([
      {
        id: 11,
        requestKey: "runtime.failed.1",
        status: "failed",
        attemptCount: 1,
        maximumAttempts: 3,
      },
    ]);
    const onChanged = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        createElement(TtrpgRuntimeMediaPanel, {
          sessionId: 7,
          scope: { projectId: 1, worldId: 2, workId: 3 },
          runtimePackage,
          source: { kind: "release", productReleaseId: 1 },
          media: projection("failed", "runtime.failed.1"),
          viewerKey: "viewer.gm",
          disabled: false,
          onChanged,
        }),
      );
    });
    expect(host.textContent).toContain("错误代码：provider-generation-failed");
    expect(host.textContent).not.toMatch(/prompt|processorLease|失败详情/);
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("重试"))!
        .click(),
    );
    expect(mediaMocks.retry).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 11, viewerKey: "viewer.gm" }),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((button) => button.textContent?.includes("取消"))!
        .click(),
    );
    expect(mediaMocks.cancel).toHaveBeenCalledWith({
      requestId: 11,
      viewerKey: "viewer.gm",
    });
  });
});
