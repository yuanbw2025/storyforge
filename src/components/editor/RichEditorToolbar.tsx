import type { MouseEventHandler } from 'react'
import {
  Bold as BoldIcon,
  Heading2,
  Heading3,
  Italic as ItalicIcon,
  List as ListIcon,
  ListOrdered,
  Minus,
  PaintBucket,
  Palette,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from 'lucide-react'
import type { EditorTypography } from '../../lib/editor-typography'

const FONT_FAMILY_OPTIONS = [
  { label: '默认正文', value: '', preview: 'var(--font-serif)' },
  { label: '宋体', value: '"SimSun", "Songti SC", "Noto Serif CJK SC", serif', preview: '"SimSun", "Songti SC", serif' },
  { label: '黑体', value: '"SimHei", "Microsoft YaHei", "PingFang SC", "Heiti SC", sans-serif', preview: '"SimHei", "Microsoft YaHei", sans-serif' },
  { label: '仿宋', value: '"FangSong", "FangSong_GB2312", "STFangsong", serif', preview: '"FangSong", "STFangsong", serif' },
  { label: '楷体', value: '"KaiTi", "Kaiti SC", "STKaiti", serif', preview: '"KaiTi", "Kaiti SC", serif' },
  { label: '微软雅黑', value: '"Microsoft YaHei", "PingFang SC", sans-serif', preview: '"Microsoft YaHei", "PingFang SC", sans-serif' },
] as const

const FONT_SIZE_OPTIONS = ['12px', '14px', '16px', '18px', '20px', '22px', '24px', '28px', '32px'] as const
const LINE_HEIGHT_OPTIONS = [
  { label: '默认行距', value: '' },
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '2.0', value: '2' },
  { label: '2.5', value: '2.5' },
  { label: '3.0', value: '3' },
] as const
const PARAGRAPH_SPACING_OPTIONS = [
  { label: '默认段距', value: '' },
  { label: '无段距', value: '0' },
  { label: '0.5行', value: '0.5em' },
  { label: '1行', value: '1em' },
  { label: '1.5行', value: '1.5em' },
  { label: '2行', value: '2em' },
] as const

const TEXT_COLOR_PRESETS = [
  { label: '正文', value: 'var(--editor-ink-primary)' },
  { label: '强黑/强白', value: 'var(--editor-ink-strong)' },
  { label: '暖褐', value: 'var(--editor-ink-cream)' },
  { label: '大黄', value: 'var(--editor-ink-gold)' },
  { label: '橙红', value: 'var(--editor-ink-orange)' },
  { label: '蓝', value: 'var(--editor-ink-blue)' },
  { label: '绿', value: 'var(--editor-ink-green)' },
  { label: '大红', value: 'var(--editor-ink-red)' },
  { label: '紫', value: 'var(--editor-ink-purple)' },
] as const
const BACKGROUND_COLOR_PRESETS = [
  { label: '清除文字背景色', value: '#00000000' },
  { label: '黄底', value: 'var(--editor-mark-yellow)' },
  { label: '红底', value: 'var(--editor-mark-red)' },
  { label: '蓝底', value: 'var(--editor-mark-blue)' },
  { label: '绿底', value: 'var(--editor-mark-green)' },
  { label: '紫底', value: 'var(--editor-mark-purple)' },
  { label: '褐底', value: 'var(--editor-mark-brown)' },
  { label: '墨底', value: 'var(--editor-mark-ink)' },
] as const

interface Props {
  typography: EditorTypography
  colorInputValue: string
  backgroundColorInputValue: string
  wordCount: number
  active: {
    bold: boolean
    italic: boolean
    strike: boolean
    heading2: boolean
    heading3: boolean
    bulletList: boolean
    orderedList: boolean
    blockquote: boolean
  }
  canUndo: boolean
  canRedo: boolean
  onMouseDownCapture: MouseEventHandler<HTMLDivElement>
  onTypographyChange: (patch: Partial<EditorTypography>) => void
  onTextColorChange: (color: string) => void
  onClearTextColor: () => void
  onBackgroundColorChange: (color: string) => void
  onBold: () => void
  onItalic: () => void
  onStrike: () => void
  onHeading2: () => void
  onHeading3: () => void
  onBulletList: () => void
  onOrderedList: () => void
  onBlockquote: () => void
  onHorizontalRule: () => void
  onUndo: () => void
  onRedo: () => void
}

export default function RichEditorToolbar({
  typography,
  colorInputValue,
  backgroundColorInputValue,
  wordCount,
  active,
  canUndo,
  canRedo,
  onMouseDownCapture,
  onTypographyChange,
  onTextColorChange,
  onClearTextColor,
  onBackgroundColorChange,
  onBold,
  onItalic,
  onStrike,
  onHeading2,
  onHeading3,
  onBulletList,
  onOrderedList,
  onBlockquote,
  onHorizontalRule,
  onUndo,
  onRedo,
}: Props) {
  const selectCls = 'h-8 rounded-md border border-border bg-bg-surface px-2 text-xs text-text-secondary outline-none transition-colors hover:text-text-primary focus:border-accent'
  const buttonClass = (isActive: boolean) =>
    `p-1.5 rounded text-xs transition-colors ${isActive
      ? 'bg-accent/20 text-accent'
      : 'text-text-muted hover:text-text-primary hover:bg-bg-hover'}`

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-2 border-b border-border bg-bg-elevated flex-wrap"
      onMouseDownCapture={onMouseDownCapture}
    >
      <select aria-label="字体" value={typography.fontFamily}
        onChange={event => onTypographyChange({ fontFamily: event.target.value })}
        className={`${selectCls} w-32`} title="字体(全局·跨章保持)">
        {FONT_FAMILY_OPTIONS.map(option => (
          <option key={option.label} value={option.value} style={{ fontFamily: option.preview }}>{option.label}</option>
        ))}
      </select>
      <select aria-label="字号" value={typography.fontSize}
        onChange={event => onTypographyChange({ fontSize: event.target.value })}
        className={`${selectCls} w-20`} title="字号(全局·跨章保持)">
        <option value="">默认</option>
        {FONT_SIZE_OPTIONS.map(size => <option key={size} value={size}>{Number.parseInt(size, 10)}</option>)}
      </select>
      <select aria-label="行距" value={typography.lineHeight}
        onChange={event => onTypographyChange({ lineHeight: event.target.value })}
        className={`${selectCls} w-24`} title="行距(全局·跨章保持)">
        {LINE_HEIGHT_OPTIONS.map(option => <option key={option.label} value={option.value}>{option.label}</option>)}
      </select>
      <select aria-label="段距" value={typography.paragraphSpacing}
        onChange={event => onTypographyChange({ paragraphSpacing: event.target.value })}
        className={`${selectCls} w-24`} title="段距(全局·跨章保持)">
        {PARAGRAPH_SPACING_OPTIONS.map(option => <option key={option.label} value={option.value}>{option.label}</option>)}
      </select>
      <div className="flex items-center gap-1 rounded-md border border-border bg-bg-surface px-1.5 py-1" title="字色">
        <Palette className="h-3.5 w-3.5 text-text-muted" />
        <input aria-label="字色" type="color" value={colorInputValue}
          onChange={event => onTextColorChange(event.target.value)}
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
        <div className="hidden items-center gap-0.5 md:flex">
          {TEXT_COLOR_PRESETS.map(color => (
            <button key={color.label} type="button" aria-label={`字色 ${color.label}`}
              onClick={() => onTextColorChange(color.value)}
              className="h-4 w-4 rounded border border-border hover:border-accent"
              style={{ backgroundColor: color.value }} />
          ))}
        </div>
        <button type="button" onClick={onClearTextColor}
          className="px-1 text-[10px] text-text-muted hover:text-text-primary">清</button>
      </div>
      <div className="flex items-center gap-1 rounded-md border border-border bg-bg-surface px-1.5 py-1" title="文字背景色">
        <PaintBucket className="h-3.5 w-3.5 text-text-muted" />
        <input aria-label="文字背景色" type="color" value={backgroundColorInputValue}
          onChange={event => onBackgroundColorChange(event.target.value)}
          className="h-5 w-6 cursor-pointer border-0 bg-transparent p-0" />
        <div className="hidden items-center gap-0.5 md:flex">
          {BACKGROUND_COLOR_PRESETS.map(color => (
            <button key={color.label} type="button" aria-label={color.label}
              onClick={() => onBackgroundColorChange(color.value)}
              className="h-4 w-4 rounded border border-border hover:border-accent"
              style={{
                backgroundColor: color.value === '#00000000' ? 'transparent' : color.value,
                backgroundImage: color.value === '#00000000'
                  ? 'linear-gradient(135deg, transparent 45%, var(--error) 46%, var(--error) 54%, transparent 55%)'
                  : undefined,
              }} />
          ))}
        </div>
      </div>
      <div className="w-px h-5 bg-border mx-0.5" />
      <button type="button" onClick={onBold} className={buttonClass(active.bold)} title="加粗 (Cmd/Ctrl+B)"><BoldIcon className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onItalic} className={buttonClass(active.italic)} title="斜体 (Cmd/Ctrl+I)"><ItalicIcon className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onStrike} className={buttonClass(active.strike)} title="删除线"><Strikethrough className="w-3.5 h-3.5" /></button>
      <div className="w-px h-4 bg-border mx-1" />
      <button type="button" onClick={onHeading2} className={buttonClass(active.heading2)} title="二级标题"><Heading2 className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onHeading3} className={buttonClass(active.heading3)} title="三级标题"><Heading3 className="w-3.5 h-3.5" /></button>
      <div className="w-px h-4 bg-border mx-1" />
      <button type="button" onClick={onBulletList} className={buttonClass(active.bulletList)} title="无序列表"><ListIcon className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onOrderedList} className={buttonClass(active.orderedList)} title="有序列表"><ListOrdered className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onBlockquote} className={buttonClass(active.blockquote)} title="引用"><Quote className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onHorizontalRule} className={buttonClass(false)} title="分割线"><Minus className="w-3.5 h-3.5" /></button>
      <div className="flex-1" />
      <span className="text-[11px] text-text-muted font-mono px-1.5 tabular-nums select-none" title="本章正文字数（不含空白）">
        {wordCount.toLocaleString()} 字
      </span>
      <div className="w-px h-4 bg-border mx-1" />
      <button type="button" onClick={onUndo} className={buttonClass(false)} title="撤销 (Cmd/Ctrl+Z)" disabled={!canUndo}><Undo2 className="w-3.5 h-3.5" /></button>
      <button type="button" onClick={onRedo} className={buttonClass(false)} title="重做 (Cmd/Ctrl+Shift+Z)" disabled={!canRedo}><Redo2 className="w-3.5 h-3.5" /></button>
    </div>
  )
}
