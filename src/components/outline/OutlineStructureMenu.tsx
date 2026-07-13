import { useState } from 'react'
import { LayoutList } from 'lucide-react'
import { STORY_STRUCTURES, type StoryStructure } from '../../lib/types/outline'

export default function OutlineStructureMenu({ onSelect }: { onSelect: (structure: StoryStructure) => void }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-accent border border-border rounded-md transition-colors">
        <LayoutList className="w-3 h-3" /> 添加故事结构
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-bg-elevated border border-border rounded-lg shadow-lg py-1 min-w-[160px]">
            {(Object.entries(STORY_STRUCTURES) as [StoryStructure, { label: string; blocks: string[] }][]).map(([key, definition]) => (
              <button key={key} onClick={() => { onSelect(key); setOpen(false) }}
                className="w-full px-3 py-1.5 text-left text-xs text-text-primary hover:bg-bg-hover transition-colors">
                <span className="font-medium">{definition.label}</span>
                {definition.blocks.length > 0 && (
                  <span className="text-text-muted ml-1">（{definition.blocks.length} 块）</span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
