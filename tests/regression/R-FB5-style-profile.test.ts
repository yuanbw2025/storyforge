/**
 * R-FB5 · 自适应文风学习(社区反馈 FB-5)
 *
 * 验证文风画像走三注册表:
 *  ① 持久化:store saveProfile / updateProfileText / setEnabled 落库;
 *  ② 读取源:CONTEXT_SOURCE `userStyleProfile` 在 enabled 时进上下文、disabled 时不进;
 *  ③ 生命周期:导出含 userStyleProfiles、导入重映射 projectId、删项目级联清除。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { useUserStyleStore } from '../../src/stores/user-style'
import { assembleContext } from '../../src/lib/registry/assemble-context'
import { exportProjectJSON, importProjectJSON } from '../../src/lib/export/json-export'
import { cascadeDeleteProject } from '../../src/lib/registry/lifecycle'

async function createProject(): Promise<number> {
  const now = Date.now()
  return await db.projects.add({
    name: 'FB5 Test', genre: '', description: '', targetWordCount: 0,
    enableMultiWorld: false, createdAt: now, updatedAt: now,
  } as any) as number
}

const PROFILE_TEXT = '## 用词习惯\n- 偏爱短句与白描\n## 句式与节奏\n- 节奏偏快,多对话'

describe('R-FB5 · 文风画像持久化 + 注入 + 生命周期', () => {
  beforeEach(async () => { await db.delete(); await db.open() })
  afterEach(async () => { db.close() })

  it('① store 保存 / 手改 / 开关 都落库', async () => {
    const pid = await createProject()
    const store = useUserStyleStore.getState()
    await store.saveProfile(pid, { profile: PROFILE_TEXT, sourceChapterIds: [1, 2], sampleCount: 2, sampleWords: 3000 })

    let row = await db.userStyleProfiles.where('projectId').equals(pid).first()
    expect(row?.profile).toBe(PROFILE_TEXT)
    expect(row?.enabled).toBe(true)            // 学习后默认开启
    expect(row?.sampleCount).toBe(2)
    expect(JSON.parse(row!.sourceChapterIds)).toEqual([1, 2])

    // 手改保存
    await useUserStyleStore.getState().updateProfileText('## 用词习惯\n- 改成长句铺陈')
    row = await db.userStyleProfiles.where('projectId').equals(pid).first()
    expect(row?.profile).toContain('长句铺陈')

    // 关闭注入
    await useUserStyleStore.getState().setEnabled(false)
    row = await db.userStyleProfiles.where('projectId').equals(pid).first()
    expect(row?.enabled).toBe(false)
  })

  it('② CONTEXT_SOURCE:enabled 时进上下文,disabled 时不进', async () => {
    const pid = await createProject()
    await useUserStyleStore.getState().saveProfile(pid, { profile: PROFILE_TEXT, sourceChapterIds: [], sampleCount: 1, sampleWords: 100 })

    // 开启:进上下文
    const onCtx = await assembleContext({ projectId: pid, sourceKeys: ['userStyleProfile'] } as any)
    expect(onCtx.included).toContain('userStyleProfile')
    expect(onCtx.text).toContain('作者文风偏好')
    expect(onCtx.text).toContain('白描')

    // 关闭:不进上下文(read 返回空串 → 不计入 included)
    await useUserStyleStore.getState().setEnabled(false)
    const offCtx = await assembleContext({ projectId: pid, sourceKeys: ['userStyleProfile'] } as any)
    expect(offCtx.included).not.toContain('userStyleProfile')
  })

  it('③ 导出含画像 / 导入重映射 projectId / 删项目级联清除', async () => {
    const pid = await createProject()
    await useUserStyleStore.getState().saveProfile(pid, { profile: PROFILE_TEXT, sourceChapterIds: [], sampleCount: 1, sampleWords: 100 })

    // 导出包含 userStyleProfiles
    const exported = await exportProjectJSON(pid)
    expect(exported.userStyleProfiles?.length).toBe(1)
    expect(exported.userStyleProfiles?.[0].profile).toBe(PROFILE_TEXT)

    // 导入到新项目,projectId 重映射
    const newPid = await importProjectJSON(exported as any)
    expect(newPid).not.toBe(pid)
    const imported = await db.userStyleProfiles.where('projectId').equals(newPid).first()
    expect(imported?.profile).toBe(PROFILE_TEXT)
    expect(imported?.projectId).toBe(newPid)

    // 删原项目级联清除其画像,新项目的画像不受影响
    await cascadeDeleteProject(pid)
    expect(await db.userStyleProfiles.where('projectId').equals(pid).count()).toBe(0)
    expect(await db.userStyleProfiles.where('projectId').equals(newPid).count()).toBe(1)
  })
})
