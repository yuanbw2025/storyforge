/** Pure citation-bound prose schema shared by replay and candidate validation. */
import * as p from './open-contract-parse'
export interface TtrpgOpenKpNarrationV1 { paragraphs: Array<{ text: string; sourceKeys: string[] }> }
export const TTRPG_OPEN_KP_MAX_PARAGRAPHS_V1 = 8
export const TTRPG_OPEN_KP_MAX_BODY_CHARACTERS_V1 = 16000
export function parseTtrpgOpenKpNarrationV1(value: unknown, allowedSourceKeys: readonly string[]): TtrpgOpenKpNarrationV1 {
  const root = p.record(value, ['paragraphs'], 'KP narration'), paragraphs = p.list(root.paragraphs, 'KP paragraphs', value => {
    const row = p.record(value, ['text', 'sourceKeys'], 'KP paragraph'), sourceKeys = p.keys(row.sourceKeys, 'actual KP citations', 100, 1)
    if (sourceKeys.some(key => !allowedSourceKeys.includes(key))) p.fail('KP 引用了未交付的事实/结果，不可杜撰来源')
    return { text: p.text(row.text, 'KP paragraph text', 8000), sourceKeys }
  }, TTRPG_OPEN_KP_MAX_PARAGRAPHS_V1, 1)
  if (paragraphs.reduce((sum, row) => sum + row.text.length, 0) > TTRPG_OPEN_KP_MAX_BODY_CHARACTERS_V1) p.fail('KP 叙述正文过长')
  return { paragraphs }
}
