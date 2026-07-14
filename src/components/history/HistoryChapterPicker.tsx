import type { Chapter } from '../../lib/types'

interface Props {
  chapters: Chapter[]
  relatedChapterIds?: number[]
  spacious?: boolean
  onChange: (chapterIds: number[]) => void
}

export default function HistoryChapterPicker({
  chapters,
  relatedChapterIds = [],
  spacious = false,
  onChange,
}: Props) {
  return (
    <div className={`flex flex-wrap gap-1 p-1.5 bg-bg-base border border-border rounded-lg ${spacious ? 'min-h-[40px] max-h-24' : 'min-h-[32px] max-h-20'} overflow-y-auto`}>
      {chapters.length === 0 ? (
        <span className="text-[10px] text-text-muted">暂无章节可关联</span>
      ) : (
        chapters.map(chapter => {
          const chapterId = chapter.id!
          const isRelated = relatedChapterIds.includes(chapterId)
          return (
            <button
              key={chapterId}
              type="button"
              onClick={() => onChange(
                isRelated
                  ? relatedChapterIds.filter(id => id !== chapterId)
                  : [...relatedChapterIds, chapterId],
              )}
              className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                isRelated
                  ? 'bg-accent/10 text-accent border border-accent/20'
                  : 'bg-bg-elevated text-text-muted hover:text-text-primary border border-transparent'
              }`}
            >
              {chapter.title}
            </button>
          )
        })
      )}
    </div>
  )
}
