import { FileText } from 'lucide-react'
import type { Chapter } from '../../lib/types'
import { useChapterStore } from '../../stores/chapter'
import { useAuthorRecordSavesV1 } from '../shared/AuthorRecordSaveScope'
import AcknowledgedTextField from '../shared/AcknowledgedTextField'

/** Chapter prose keeps its own editor; this field uses the original notes writer. */
export default function ChapterAuthorNotes({ chapter }: { chapter: Chapter }) {
  const localSave = useAuthorRecordSavesV1('chapters', chapter)
  const updateChapter = useChapterStore(state => state.updateChapter)
  return <div className="mt-3" aria-label="章节作者笔记">
    <label className="mb-1 block text-xs text-text-muted"><FileText className="mr-1 inline h-3 w-3" />作者笔记</label>
    <AcknowledgedTextField label="作者笔记" rows={2} value={chapter.notes} localSave={localSave('notes')}
      placeholder="写给自己的备忘..."
      className="w-full p-2 bg-bg-elevated border border-border rounded text-xs text-text-muted resize-y focus:outline-none focus:border-accent"
      onCommit={(value, _expected, intent) => {
        if (chapter.id == null) throw new Error('原章节已不存在，笔记输入已保留。')
        if (!intent) return updateChapter(chapter.id, { notes: value })
        const { projectId, worldId, workId } = intent.expected.identity
        return updateChapter(chapter.id, { notes: value }, { scope: { projectId, worldId, workId }, confirmation: intent })
      }} />
  </div>
}
