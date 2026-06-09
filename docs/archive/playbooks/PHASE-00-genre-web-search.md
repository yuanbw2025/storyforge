# PHASE-00: 联网抓取流派标签 + 清空开发数据库

## § 1. 元信息

```yaml
phase: 00
title: 联网抓取起点/纵横/晋江流派标签，清空开发数据库
prerequisites: []
estimated_hours: 4
recommended_model: Sonnet 4.6（带 WebFetch 工具）；Flash 不建议
status: not-started
```

---

## § 2. 本 Phase 的目标（What）

完成本 Phase 后：

1. 项目里多一个文件 `src/lib/data/genre-presets.ts`，导出至少 50 个真实存在于起点/纵横/晋江三大平台的流派标签（按"分组+男频/女频"标注）
2. 当前用户的浏览器 IndexedDB（数据库名 `storyforge`）已被清空，准备让 Phase 3 的 v6 schema 启动
3. v3 战略文档（`docs/09-REDESIGN-INTEGRATION-PLAN.md`）已 commit 并 push 到 git

**不在本 Phase 范围**：
- ❌ 不修改任何 React 组件
- ❌ 不修改任何 store
- ❌ 不修改 Dexie schema（schema 修改在 Phase 3 做）
- ❌ 不删除任何源代码文件（除非 § 3 明确列出）

---

## § 3. 改动清单

#### 新增

- `src/lib/data/genre-presets.ts` — 流派标签数据
- `docs/playbooks/PHASE-00-genre-web-search.md` — 本 Playbook 自身（已创建）

#### 修改

- 无

#### 删除

- 无

#### 浏览器侧（用户手动执行）

- `IndexedDB` 数据库 `storyforge` 删除

---

## § 4. 任务步骤（How）

### 4.1 用 WebFetch 抓起点中文网分类页

**操作**：调用 WebFetch 工具，URL 和 prompt 严格按下面：

```
URL: https://www.qidian.com/all/
Prompt: 请列出页面中"全部分类"或"分类筛选"区域的所有男频小说类型分类标签。要求按以下 JSON 格式输出，不要其他任何文字：

{
  "site": "qidian",
  "gender": "male",
  "categories": [
    { "group": "玄幻", "items": ["东方玄幻", "异世大陆", "王朝争霸", "高武世界"] },
    ...
  ]
}
```

**预期产出**：JSON 对象，至少包含 8 个 group。

**如果 WebFetch 返回 403 或页面无法访问**：
- 备选 URL: `https://www.qidian.com/all_pub/chanId21000/`（玄幻分类）
- 再备选：尝试 `https://m.qidian.com/category`
- 仍失败：在 § 8 故障排查指引下使用降级数据

### 4.2 用 WebFetch 抓纵横中文网分类

```
URL: https://www.zongheng.com/category.html
Prompt: 请列出页面中所有男频小说类型分类（一级和二级）。要求严格按以下 JSON 格式输出：

{
  "site": "zongheng",
  "gender": "male",
  "categories": [
    { "group": "...", "items": [...] },
    ...
  ]
}
```

### 4.3 用 WebFetch 抓晋江文学城分类

```
URL: https://www.jjwxc.net/topten.php?orderstr=7
Prompt: 请列出晋江文学城的所有女频小说类型分类。包括但不限于：现代言情、古代言情、玄幻奇幻、武侠仙侠、悬疑探险、纯爱、百合等大类下的所有子类。要求严格按以下 JSON 格式输出：

{
  "site": "jjwxc",
  "gender": "female",
  "categories": [
    { "group": "...", "items": [...] },
    ...
  ]
}
```

### 4.4 数据合并与去重

**输入**：4.1、4.2、4.3 三个 JSON 输出。

**操作**：
1. 把三个站的 `categories` 合并到一个总数组
2. 同名 group 合并 items（去重）
3. 同名 item 在不同 group 中保留两次（如"穿越"既在玄幻也在言情）
4. 总条数必须 ≥ 50；不足则重做 4.1-4.3

**输出**：合并后的中间 JSON（暂存，不写文件）。

### 4.5 整理为 TypeScript 数据文件

**操作**：写入 `src/lib/data/genre-presets.ts`，**完整内容**如下骨架（用 4.4 的实际数据替换示例数据）：

```typescript
/**
 * 流派标签预设数据
 *
 * 来源：起点中文网（qidian.com）、纵横中文网（zongheng.com）、晋江文学城（jjwxc.net）
 * 抓取时间：[YYYY-MM-DD]（替换为今天日期）
 *
 * 数据结构稳定，新增标签需追加而不是改 value。
 * value 必须是英文/拼音，永久稳定，作为数据库存储 key。
 * label 是中文显示，可改。
 */

export type GenreGender = 'male' | 'female' | 'general'

export interface GenrePreset {
  /** 永久稳定的 key（拼音），用于存储 */
  value: string
  /** 中文显示名 */
  label: string
  /** 一级分类组 */
  group: string
  /** 适用频道 */
  gender: GenreGender
}

export const GENRE_PRESETS: readonly GenrePreset[] = [
  // === 男频玄幻 ===
  { value: 'xuanhuan',     label: '玄幻',     group: '玄幻', gender: 'male' },
  { value: 'dongfang',     label: '东方玄幻', group: '玄幻', gender: 'male' },
  { value: 'yishi',        label: '异世大陆', group: '玄幻', gender: 'male' },
  // ... 此处替换为 4.4 实际抓取的所有男频玄幻条目

  // === 男频仙侠 ===
  // ...

  // === 男频武侠 ===
  // ...

  // === 男频科幻 ===
  // ...

  // === 男频奇幻 ===
  // ...

  // === 男频都市 ===
  // ...

  // === 男频历史 ===
  // ...

  // === 男频游戏 ===
  // ...

  // === 男频体育 ===
  // ...

  // === 男频军事 ===
  // ...

  // === 男频灵异 ===
  // ...

  // === 男频轻小说 ===
  // ...

  // === 女频现代言情 ===
  // ...

  // === 女频古代言情 ===
  // ...

  // === 女频玄幻言情 ===
  // ...

  // === 女频武侠仙侠 ===
  // ...

  // === 女频悬疑灵异 ===
  // ...

  // === 女频纯爱 ===
  // ...

  // === 通用 ===
  { value: 'other',        label: '其他',     group: '其他', gender: 'general' },
] as const

/** 按 group 分组的索引（运行时计算） */
export const GENRE_GROUPS = (() => {
  const map = new Map<string, GenrePreset[]>()
  for (const g of GENRE_PRESETS) {
    if (!map.has(g.group)) map.set(g.group, [])
    map.get(g.group)!.push(g)
  }
  return Array.from(map.entries())
})()

/** 按 gender 筛选 */
export function filterByGender(gender: GenreGender | 'all'): GenrePreset[] {
  if (gender === 'all') return [...GENRE_PRESETS]
  return GENRE_PRESETS.filter(g => g.gender === gender || g.gender === 'general')
}
```

**验证**：

```bash
cd E:/MYgithub/storyforge
npm run build
```

**必须满足**：
- 输出含 `built in`
- 输出 0 个 `error`
- `dist/assets/` 下生成新的 js 包

### 4.6 验证条目数量

打开 `src/lib/data/genre-presets.ts`，肉眼数 `GENRE_PRESETS` 数组的元素个数（或写一行临时代码 `console.log(GENRE_PRESETS.length)` 然后 `npm run dev` 后从浏览器读出再删掉）。

**通过条件**：长度 ≥ 50（不含'other'兜底）。

### 4.7 提供给用户的清空 IndexedDB 命令

**Claude 输出给用户的内容**（一字不差）：

> 请按以下步骤清空开发数据库（所有项目数据会丢失，因为还在开发期）：
>
> 1. 在浏览器中打开 StoryForge 应用
> 2. 按 F12 打开 DevTools
> 3. 切换到 Console 标签
> 4. 粘贴执行：
>
>    ```javascript
>    indexedDB.deleteDatabase('storyforge')
>    ```
>
> 5. 关闭并重新打开浏览器标签页
> 6. 此时数据库已清空，准备好让 Phase 3 创建 v6 schema

### 4.8 提交 git

**操作**：

```bash
cd E:/MYgithub/storyforge

git add docs/09-REDESIGN-INTEGRATION-PLAN.md \
        docs/playbooks/TEMPLATE.md \
        docs/playbooks/PHASE-00-genre-web-search.md \
        src/lib/data/genre-presets.ts

git commit -m "feat(phase-00): 流派标签数据集 + Playbook 体系建立

- 抓取起点/纵横/晋江三站分类，整理为 50+ 条 GENRE_PRESETS
- 新增 docs/playbooks/ 目录与 TEMPLATE 模板
- v3 战略文档与 Phase 0 Playbook 同步入库"

git push origin main
```

**预期**：远端 `https://github.com/yuanbw2025/storyforge` 看到新 commit。

### 4.9 同步到 my-website/storyforge/

```bash
cp -r E:/MYgithub/storyforge/docs/. E:/MYgithub/my-website/storyforge/docs/
mkdir -p E:/MYgithub/my-website/storyforge/src/lib/data
cp E:/MYgithub/storyforge/src/lib/data/genre-presets.ts \
   E:/MYgithub/my-website/storyforge/src/lib/data/genre-presets.ts

cd E:/MYgithub/my-website
git add storyforge/
git commit -m "sync(storyforge): phase-00 流派标签 + Playbook 体系"
git push origin main
```

---

## § 5. 数据模型变更

无（本 Phase 不动 Dexie schema）。

---

## § 6. 验收标准

执行人完成所有任务步骤后逐条勾选：

- [ ] 文件 `E:/MYgithub/storyforge/src/lib/data/genre-presets.ts` 存在
- [ ] `GENRE_PRESETS` 数组长度 ≥ 50
- [ ] `GENRE_PRESETS` 至少覆盖 8 个 group
- [ ] 至少包含 5 个 gender='female' 的条目（晋江为主）
- [ ] 至少包含 30 个 gender='male' 的条目（起点+纵横为主）
- [ ] `cd storyforge && npm run build` 输出 0 errors
- [ ] git log 显示新 commit 已推送到 `origin/main`
- [ ] `my-website/storyforge/src/lib/data/genre-presets.ts` 同步存在
- [ ] `my-website` 的 main 分支也已 push
- [ ] 用户已确认在浏览器执行了清空 IndexedDB 命令

---

## § 7. AI 全功能巡检

**本 Phase 不修改 AI 链路或数据库 schema，巡检不适用。**

跳过本节，直接进入 § 9 提交。

---

## § 8. 故障排查

| 症状 | 可能原因 | 应对 |
|------|---------|------|
| WebFetch 起点首页返回 403 | 反爬虫 | 改用 m.qidian.com 移动版；或参考下面降级数据 |
| WebFetch 纵横首页返回空 | 页面是 JS 渲染 | 改用 zongheng.com/store/c0 等具体分类页 URL |
| WebFetch 晋江返回乱码 | charset 不是 UTF-8 | 在 prompt 中加 "如果你看到乱码，请尝试用 GBK 解码后再输出" |
| 抓到的条目不足 50 | 抓取页面不全 | 必须重做，访问每个站的二级分类页补足 |
| `npm run build` TS error 找不到 GenrePreset | 漏 export | 检查 `src/lib/data/genre-presets.ts` 是否 export 了 type |
| git push 报 non-fast-forward | 远端有新 commit | `git pull origin main --no-rebase` 后再 push |

### 降级数据（仅当三个站均 WebFetch 失败时使用）

如果三个站全部抓取失败，使用以下 53 条人工整理的兜底数据：

```typescript
// 男频玄幻
{ value: 'xuanhuan', label: '玄幻', group: '玄幻', gender: 'male' },
{ value: 'dongfang', label: '东方玄幻', group: '玄幻', gender: 'male' },
{ value: 'yishi', label: '异世大陆', group: '玄幻', gender: 'male' },
{ value: 'wangchao', label: '王朝争霸', group: '玄幻', gender: 'male' },
{ value: 'gaowu', label: '高武世界', group: '玄幻', gender: 'male' },

// 男频仙侠
{ value: 'xianxia', label: '仙侠', group: '仙侠', gender: 'male' },
{ value: 'xiuzhen', label: '修真文明', group: '仙侠', gender: 'male' },
{ value: 'huanxiu', label: '幻想修仙', group: '仙侠', gender: 'male' },
{ value: 'gudian', label: '古典仙侠', group: '仙侠', gender: 'male' },

// 男频武侠
{ value: 'wuxia', label: '武侠', group: '武侠', gender: 'male' },
{ value: 'chuantong', label: '传统武侠', group: '武侠', gender: 'male' },
{ value: 'xiandai', label: '现代武侠', group: '武侠', gender: 'male' },
{ value: 'wuxiabuxi', label: '武侠同人', group: '武侠', gender: 'male' },

// 男频科幻
{ value: 'kehuan', label: '科幻', group: '科幻', gender: 'male' },
{ value: 'xingji', label: '星际战争', group: '科幻', gender: 'male' },
{ value: 'weilai', label: '未来世界', group: '科幻', gender: 'male' },
{ value: 'shikong', label: '时空穿梭', group: '科幻', gender: 'male' },
{ value: 'chaoji', label: '超级科技', group: '科幻', gender: 'male' },
{ value: 'moshi', label: '末世危机', group: '科幻', gender: 'male' },

// 男频奇幻
{ value: 'qihuan', label: '奇幻', group: '奇幻', gender: 'male' },
{ value: 'xifang', label: '西方魔幻', group: '奇幻', gender: 'male' },
{ value: 'shishi', label: '史诗奇幻', group: '奇幻', gender: 'male' },
{ value: 'heian', label: '黑暗奇幻', group: '奇幻', gender: 'male' },

// 男频都市
{ value: 'dushi', label: '都市', group: '都市', gender: 'male' },
{ value: 'dushenghuo', label: '都市生活', group: '都市', gender: 'male' },
{ value: 'duyineng', label: '都市异能', group: '都市', gender: 'male' },
{ value: 'yule', label: '娱乐明星', group: '都市', gender: 'male' },
{ value: 'shangzhan', label: '商战职场', group: '都市', gender: 'male' },

// 男频历史
{ value: 'lishi', label: '历史', group: '历史', gender: 'male' },
{ value: 'jiakong', label: '架空历史', group: '历史', gender: 'male' },
{ value: 'qinhan', label: '秦汉三国', group: '历史', gender: 'male' },
{ value: 'songmingqing', label: '两宋元明', group: '历史', gender: 'male' },

// 男频游戏/竞技
{ value: 'youxi', label: '游戏', group: '游戏', gender: 'male' },
{ value: 'dianjing', label: '电子竞技', group: '游戏', gender: 'male' },
{ value: 'xuni', label: '虚拟网游', group: '游戏', gender: 'male' },
{ value: 'tiyu', label: '体育竞技', group: '游戏', gender: 'male' },

// 男频军事
{ value: 'junshi', label: '军事', group: '军事', gender: 'male' },
{ value: 'tiezuo', label: '铁血战争', group: '军事', gender: 'male' },

// 男频灵异/悬疑
{ value: 'lingyi', label: '灵异', group: '悬疑', gender: 'general' },
{ value: 'xuanyi', label: '悬疑', group: '悬疑', gender: 'general' },
{ value: 'tanan', label: '探案', group: '悬疑', gender: 'general' },
{ value: 'kongbu', label: '恐怖惊悚', group: '悬疑', gender: 'general' },

// 女频现代言情
{ value: 'xianyan', label: '现代言情', group: '言情', gender: 'female' },
{ value: 'duqing', label: '都市情感', group: '言情', gender: 'female' },
{ value: 'haomen', label: '豪门世家', group: '言情', gender: 'female' },
{ value: 'tianchong', label: '甜宠文', group: '言情', gender: 'female' },
{ value: 'xueyuan', label: '校园青春', group: '言情', gender: 'female' },

// 女频古代言情
{ value: 'guyan', label: '古代言情', group: '古言', gender: 'female' },
{ value: 'gongdou', label: '宫斗宅斗', group: '古言', gender: 'female' },
{ value: 'chuanyue', label: '穿越时空', group: '古言', gender: 'female' },

// 女频玄幻言情
{ value: 'xuanyan', label: '玄幻言情', group: '玄幻言情', gender: 'female' },
{ value: 'xianyan2', label: '仙侠言情', group: '玄幻言情', gender: 'female' },

// 通用兜底
{ value: 'other', label: '其他', group: '其他', gender: 'general' },
```

合计 53 条，满足 ≥50 验收要求。

---

## § 9. 提交（Commit）规范

完成 § 4.8 / § 4.9 的 git 操作即完成本 Phase。

**Commit message 必须包含**：
- `phase-00` 标识
- "verified: ≥50 genres, build pass"

**示例**：

```
feat(phase-00): 流派标签数据集 + Playbook 体系建立

verified: 53 genres across 18 groups, build pass, both repos pushed

- 抓取起点/纵横/晋江三站分类（或使用降级数据）
- 整理为 GENRE_PRESETS 常量数组
- 新增 docs/playbooks/ 目录与 TEMPLATE 模板
- v3 战略文档与 Phase 0 Playbook 同步入库
```

---

## 完成本 Phase 后

进入 `PHASE-01-prompt-infrastructure.md`（届时再生成）。
