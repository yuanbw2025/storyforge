import type { ComponentType } from 'react'
import { BookMarked, Library, Palette } from 'lucide-react'
import type { ReferenceType } from '../../lib/types'

export const REFERENCE_TYPE_CONFIG: Record<ReferenceType, {
  label: string
  icon: ComponentType<{ className?: string }>
  color: string
}> = {
  story: { label: '故事参考', icon: BookMarked, color: 'text-accent bg-accent/10 border-accent/30' },
  style: { label: '风格参考', icon: Palette, color: 'text-purple-400 bg-purple-500/10 border-purple-400/30' },
  historical: { label: '历史资料', icon: Library, color: 'text-amber-500 bg-amber-500/10 border-amber-500/30' },
}

export const REFERENCE_GLYPH_COLORS = [
  'bg-[#C17D5E]/15 text-[#C17D5E]',
  'bg-[#7BA08A]/15 text-[#7BA08A]',
  'bg-[#8B7BB0]/15 text-[#8B7BB0]',
  'bg-[#B08B6B]/15 text-[#B08B6B]',
  'bg-[#6B8EB0]/15 text-[#6B8EB0]',
  'bg-[#B06B7B]/15 text-[#B06B7B]',
]
