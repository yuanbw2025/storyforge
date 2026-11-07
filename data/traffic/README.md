# GitHub 统计归档

每日工作流读取最近 14 天的流量和当日 Release Asset 下载量，按原有键累加归档。最新数据保存在独立的 [`traffic-assets` 分支](https://github.com/yuanbw2025/storyforge/tree/traffic-assets/data/traffic)：[clones.csv](https://github.com/yuanbw2025/storyforge/blob/traffic-assets/data/traffic/clones.csv)、[views.csv](https://github.com/yuanbw2025/storyforge/blob/traffic-assets/data/traffic/views.csv)、[release-assets.csv](https://github.com/yuanbw2025/storyforge/blob/traffic-assets/data/traffic/release-assets.csv)。首次成功归档会建立该分支；此前链接可能尚不可用。

`main` 中现有 CSV 和提交历史作为既有记录保留，不再由定时任务直接更新。首次资产分支从这些记录开始，后续读取资产分支自身的累计历史；缺失或损坏历史时停止，不用空数据覆盖。工作流仅普通快进推送统计产物，不绕过 `main` 的 PR 与检查要求，也不依赖机器人 PR 自动触发 CI。

数据采集成功但发布失败时，工作流保留三份 CSV 为对应运行的 `traffic-archive-unpublished-*` 附件，保存 14 天，供维护者核对后恢复；错误不会写回 `main`。

统计算法、已有 `TRAFFIC_TOKEN` 的数据读取用途及项目 README 的星图展示保持原有方式。星图仍由独立的 `readme-assets` 分支维护。实际定时执行与远端分支保护设置需分别验收。
