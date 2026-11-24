import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../src/lib/db/schema'
import { currentWorkFixtureRecordV1, seedCurrentWorkspace } from '../helpers/current-workspace'
import { stampNewRecord } from '../../src/lib/workspace/scope'
import { resetPendingEditCoordinatorForTestsV1 } from '../../src/lib/authoring/pending-edit-coordinator'
import { isLongformMarkdownAdmissionV1, resolveNodeAuthoringChapterHandoffV1 } from '../../src/lib/authoring/longform-markdown-admission'
import type { AuthoringCandidate, AuthoringNodeInstance, AuthoringNodeBinding } from '../../src/lib/node-authoring/contracts'

function adoptedProseCandidate(outlineNodeId: number, status: AuthoringCandidate['status'] = 'adopted'): AuthoringCandidate {
  return {
    nodeId: 'node-1',
    status,
    output: '第一章正文',
    semantic: 'chapter.prose',
    domain: {
      kind: 'prose',
      operation: 'generate',
      outlineNodeId,
      snapshot: {
        outlineNodeId,
        outlineUpdatedAt: 1,
        chapterId: null,
        chapterUpdatedAt: null,
        chapterContentHash: '',
        chapterHadContent: false,
        chapterOrder: 0,
        perspectiveCharacterId: null,
        informationBoundaryHash: '',
        perspectiveFromChapter: false,
      },
    },
    createdAt: 1,
  }
}

function chapterNode(binding?: AuthoringNodeBinding): AuthoringNodeInstance {
  return {
    id: 'node-1',
    templateId: 'chapter.prose',
    templateVersion: 1,
    title: '第一章',
    x: 0,
    y: 0,
    config: {},
    inputs: [],
    outputs: [],
    ...(binding ? { binding } : {}),
  }
}

async function fixture(kind: 'long' | 'short' = 'long') {
  const made = kind === 'short'
    ? await seedCurrentWorkspace('短篇准入验证', { novelProfile: 'short', targetWordCount: 10_000 })
    : await seedCurrentWorkspace('长篇准入验证')
  const outlineNodeId = await db.outlineNodes.add(stampNewRecord(made.scope, 'outlineNodes', {
    projectId: made.scope.projectId, parentId: null, type: 'chapter', title: '第一章', summary: '', order: 0, createdAt: 1, updatedAt: 1,
  }, { owner: 'work' })) as number
  return { ...made, outlineNodeId }
}

describe('EDITOR8 · 长篇正文准入与节点章节最小交接', () => {
  beforeEach(async () => { resetPendingEditCoordinatorForTestsV1(); await db.delete(); await db.open() })
  afterEach(() => { resetPendingEditCoordinatorForTestsV1(); db.close() })

  it('准入仅开放独立长篇；短篇/世界内叙事/非小说/资格未知均不开放', () => {
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: 'independent-work', workKind: 'novel', novelProfile: 'long' })).toBe(true)
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: 'independent-work', workKind: 'novel', novelProfile: 'short' })).toBe(false)
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: 'world-engine', workKind: 'novel', novelProfile: 'long' })).toBe(false)
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: 'independent-work', workKind: 'screenplay', novelProfile: null })).toBe(false)
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: null, workKind: 'novel', novelProfile: 'long' })).toBe(false)
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: 'independent-work', workKind: 'novel', novelProfile: null })).toBe(false)
    expect(isLongformMarkdownAdmissionV1({ workspacePurpose: undefined, workKind: undefined, novelProfile: undefined })).toBe(false)
  })

  it('已采用正式章候选复用现成导航跳正确章纲，不读运行/不新增模型或副本', async () => {
    const f = await fixture()
    const beforeRuns = await db.nodeRuns.count()
    const target = await resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work, node: chapterNode(), candidate: adoptedProseCandidate(f.outlineNodeId),
    })
    expect(target).toBe(`/workspace/${f.scope.projectId}?module=chapters-list&chapter=${f.outlineNodeId}&work=${f.scope.workId}`)
    expect(await db.nodeRuns.count()).toBe(beforeRuns)
    expect(await db.chapters.count()).toBe(0)
  })

  it('短篇与世界内叙事不开放，保持原富文本合同', async () => {
    const f = await fixture('short')
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work, node: chapterNode(), candidate: adoptedProseCandidate(f.outlineNodeId),
    })).rejects.toThrow('当前用途或作品不开放正文 Markdown 编辑')
    const g = await fixture()
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: g.scope, project: { workspacePurpose: 'world-engine' }, work: g.work, node: chapterNode(), candidate: adoptedProseCandidate(g.outlineNodeId),
    })).rejects.toThrow('当前用途或作品不开放正文 Markdown 编辑')
  })

  it('未采纳候选、悬空章纲、跨 Work 一律拒绝且不跳转', async () => {
    const f = await fixture()
    // 未采纳：仍为 draft 候选
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work, node: chapterNode(), candidate: adoptedProseCandidate(f.outlineNodeId, 'draft'),
    })).rejects.toThrow('尚未采用为正式正文')
    // 无候选、无 live 绑定
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work, node: chapterNode(), candidate: null,
    })).rejects.toThrow('尚未采用为正式正文')
    // 悬空章纲：已采用但章纲节点不存在
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work, node: chapterNode(), candidate: adoptedProseCandidate(999_999),
    })).rejects.toThrow('章纲节点已删除或不属于当前作品')
    // 跨 Work：切换活动作品后旧 scope 失效
    const otherWorkId = await db.works.add(currentWorkFixtureRecordV1({ projectId: f.scope.projectId, worldId: f.scope.worldId, title: '切换后作品' })) as number
    await db.projects.update(f.scope.projectId, { activeWorkId: otherWorkId })
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work, node: chapterNode(), candidate: adoptedProseCandidate(f.outlineNodeId),
    })).rejects.toThrow('作品已切换')
  })

  it('已验证 live 章节绑定跳正确章纲；失效/非唯一绑定拒绝', async () => {
    const f = await fixture()
    const chapterId = await db.chapters.add(stampNewRecord(f.scope, 'chapters', {
      projectId: f.scope.projectId, outlineNodeId: f.outlineNodeId, title: '第一章', content: '正文', wordCount: 2, status: 'draft', order: 0, notes: '', createdAt: 1, updatedAt: 1,
    }, { owner: 'work' }) as never) as number
    const chapter = await db.chapters.get(chapterId)
    const ragDocumentId = chapter?.ragDocumentId
    expect(ragDocumentId).toBeTruthy()
    const target = await resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work,
      node: chapterNode({ mode: 'live', ref: { documentId: ragDocumentId } }), candidate: null,
    })
    expect(target).toBe(`/workspace/${f.scope.projectId}?module=chapters-list&chapter=${f.outlineNodeId}&work=${f.scope.workId}`)
    // 失效：绑定不存在的 documentId
    await expect(resolveNodeAuthoringChapterHandoffV1({
      scope: f.scope, project: f.project, work: f.work,
      node: chapterNode({ mode: 'live', ref: { documentId: 'res:v1:chapter:missing-0000-0000-0000-000000000000' } }), candidate: null,
    })).rejects.toThrow('节点章节绑定已失效或不是当前作品的唯一章节')
  })
})
