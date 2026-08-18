#!/usr/bin/env python3
"""
GitHub 流量归档（解决 traffic API 只保留 14 天的问题）。

每天由 .github/workflows/traffic-archive.yml 定时调用：拉取最近 14 天的
clones / views 数据，按「日期」upsert 进 data/traffic/*.csv（同一天覆盖为
最新值，不重复计数），从而持续累计出建档以来的总量。

环境变量：
  REPO      —— owner/repo（GitHub Actions 自动注入 github.repository）
  GH_TOKEN  —— 有该仓库 push 权限的 PAT（classic·repo scope）。
              注意：Actions 默认的 GITHUB_TOKEN 调 traffic 会 403，必须用 PAT。
"""
import csv
import json
import os
import urllib.request
from pathlib import Path

REPO = os.environ["REPO"]
TOKEN = os.environ["GH_TOKEN"]
OUT = Path("data/traffic")
OUT.mkdir(parents=True, exist_ok=True)


def fetch(kind: str) -> dict:
    url = f"https://api.github.com/repos/{REPO}/traffic/{kind}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as r:
        return json.load(r)


def archive(kind: str, list_key: str) -> None:
    """upsert 最近 14 天数据进 CSV，按 date 去重，输出累计总量。"""
    data = fetch(kind)
    path = OUT / f"{kind}.csv"

    rows: dict[str, dict] = {}
    if path.exists():
        with path.open(newline="") as f:
            for row in csv.DictReader(f):
                rows[row["date"]] = row

    for item in data.get(list_key, []):
        date = item["timestamp"][:10]
        rows[date] = {"date": date, "count": str(item["count"]), "uniques": str(item["uniques"])}

    with path.open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date", "count", "uniques"])
        w.writeheader()
        for date in sorted(rows):
            w.writerow(rows[date])

    total = sum(int(r["count"]) for r in rows.values())
    total_uniques = sum(int(r["uniques"]) for r in rows.values())
    print(f"[traffic] {kind}: 已归档 {len(rows)} 天 · 累计 count={total} uniques={total_uniques}")


if __name__ == "__main__":
    archive("clones", "clones")
    archive("views", "views")

# Fix for issue #56: safe input handling
