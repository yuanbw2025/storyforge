import type { Project, Work, WorkspaceScope } from '../types'
import type { AuthoringDocumentIdentityV1, AuthoringPasteDraftV1 } from './authoring-document-adapter'
import { AuthoringDocumentAdapterV1 } from './authoring-document-adapter'
import { AuthoringMarkdownViewV1 } from './authoring-markdown-view'
import { isLongformMarkdownAdmissionV1 } from '../authoring/longform-markdown-admission'

export type LongformMarkdownEditorModeV1 = 'richtext' | 'source' | 'preview'

export interface LongformMarkdownSessionInputV1 {
  identity: AuthoringDocumentIdentityV1
  html: string
  parent: HTMLElement
  onHtmlChange: (html: string, plainText: string) => void
  onError: (error: Error) => void
  onRichText: () => void
  placeholder?: string
}

/**
 * R8 生产挂载的会话边界：把已合入 main 的原型两模块（Adapter/View）接进
 * ChapterEditor。它本身不持有 DB/AI/持久化权限：保存仍走
 * chapter-editor-save 的草稿缓冲（由 onHtmlChange 回调喂入），准入判定
 * 只认解析后的 workspacePurpose/Work kind/novelProfile，本机偏好不参与。
 * 打开/滚动/光标/源码↔预览切换产生 0 章节更新（display 切换不过
 * onHtmlChange，HTML 未变时同样不触发）。
 */
export class LongformMarkdownSessionV1 {
  readonly adapter: AuthoringDocumentAdapterV1
  readonly view: AuthoringMarkdownViewV1

  constructor(input: LongformMarkdownSessionInputV1) {
    this.adapter = new AuthoringDocumentAdapterV1({ identity: input.identity, html: input.html, onHtmlChange: input.onHtmlChange })
    this.view = new AuthoringMarkdownViewV1(this.adapter, {
      parent: input.parent,
      onError: input.onError,
      onRichText: input.onRichText,
      placeholder: input.placeholder,
    })
  }

  /** 富文本↔CM 是明确编辑边界：调用方先 flush 草稿再重建会话。 */
  static canMount(input: { project: Pick<Project, 'workspacePurpose'>; work: { kind: Work['kind'] | null; novelProfile: Work['novelProfile'] | null } }): boolean {
    return isLongformMarkdownAdmissionV1({
      workspacePurpose: input.project.workspacePurpose,
      workKind: input.work.kind,
      novelProfile: input.work.novelProfile,
    })
  }

  /** 新空章默认实时预览；既有非空章保持原富文本语义。 */
  static defaultModeFor(html: string): LongformMarkdownEditorModeV1 {
    return html.trim() === '' ? 'preview' : 'richtext'
  }

  getHtml(): string { return this.adapter.getHtml() }
  getPlainText(): string { return this.adapter.getPlainText() }
  getWordCount(): number { return this.adapter.getWordCount() }
  getDisplayMode(): 'source' | 'preview' { return this.adapter.displayMode }
  getSourceRevision(): number { return this.adapter.sourceRevision }

  /** 源码↔实时预览共用同一 CM state/history：0 sourceChange、0 DB 更新。 */
  setDisplayMode(mode: 'source' | 'preview'): void { this.view.setDisplayMode(mode) }
  subscribeSelection(listener: () => void): () => void { return this.view.subscribeSelection(listener) }
  getSelectionSnapshot() { return this.view.getSelectionSnapshot() }
  getSelectionRect(): DOMRect | null { return this.view.getSelectionRect() }
  commitExternalHtml(input: Parameters<AuthoringDocumentAdapterV1['commitExternalHtml']>[0]) { this.view.commitExternalHtml(input) }
  preparePaste(text: string, signal: AbortSignal): Promise<AuthoringPasteDraftV1> { return this.view.preparePaste(text, signal) }
  commitPaste(draft: AuthoringPasteDraftV1): void { this.view.commitPaste(draft) }

  /** 撤卸时同步拆掉 CM 视图与挂到 adapter 上的视图扩展。 */
  destroy(): void { this.view.destroy() }
}

/** 从已解析的 scope 组装正式章节身份；身份不符由 adapter 构造器拒绝。 */
export function buildLongformMarkdownIdentityV1(scope: WorkspaceScope, chapterId: number, chapterUid: string): AuthoringDocumentIdentityV1 {
  if (!Number.isSafeInteger(chapterId) || chapterId < 1) throw new Error('章节身份不完整，不能建立 Markdown 会话。')
  return { projectId: scope.projectId, worldId: scope.worldId, workId: scope.workId, chapterId, chapterUid }
}

/**
 * 会话重建键：只含 scope + 章节身份，**故意不含显示模式**。
 * 源码↔实时预览是同一 CM EditorState/history 的两种显示，只能 setDisplayMode；
 * 只有换章、准入变化或富文本↔CM 边界才允许重建会话（那会开始新的撤销段）。
 */
export function longformMarkdownMountKeyV1(input: { scope: WorkspaceScope; chapterId: number }): string {
  return `${input.scope.projectId}:${input.scope.worldId}:${input.scope.workId}:${input.chapterId}`
}
