/** Device-only numeric layout. These aliases identify UI fields, never works,
 * records, candidate ids, labels or author text. Admission belongs to the
 * already resolved product boundary; a key does not grant admission. */
export const INPUT_AREA_FIELDS_V1 = [
  'story.logline', 'story.concept', 'story.theme', 'story.centralConflict', 'story.plotPattern', 'story.mainPlot', 'story.subPlots',
  'world.origin', 'world.power', 'world.divine', 'world.structure', 'world.dimensions', 'world.continents', 'world.water', 'world.climate',
  'world.resources', 'world.creatures', 'world.herbs', 'world.minerals', 'world.otherResources',
  'world.races', 'world.factions', 'world.cities', 'world.politics', 'world.economy', 'world.culture', 'world.conflicts', 'world.items',
  'power.description', 'power.levels', 'power.rules', 'power.stageFeatures', 'power.breakthrough',
  'rules.historical', 'rules.fictional', 'rules.note',
] as const
export const INPUT_AREA_ROLES_V1 = ['current', 'original', 'candidate', 'raw', 'json'] as const
export type InputAreaLayoutKeyV1 = `${typeof INPUT_AREA_FIELDS_V1[number]}/${typeof INPUT_AREA_ROLES_V1[number]}`
export interface InputAreaLayoutOptionsV1 {
  /** Explicit opt-in only, passed from the resolved independent long-novel UI. */
  enabled: true
  /** Omit only for an admitted, explicitly opted-in session-only field. */
  preferenceKey?: InputAreaLayoutKeyV1
}
export interface InputAreaDesiredBoxV1 { width: number; height: number }
export interface InputAreaBoundsV1 { width: number; height: number; minWidth: number; minHeight: number }
type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const INPUT_AREA_STORAGE_KEY_V1 = 'storyforge-input-area-layout-v1'
const allowedKeys = new Set<string>(INPUT_AREA_FIELDS_V1.flatMap(field => INPUT_AREA_ROLES_V1.map(role => `${field}/${role}`)))
const MIN_WIDTH = 160, MIN_HEIGHT = 64, MAX_WIDTH = 4096, MAX_HEIGHT = 2048

export function isInputAreaLayoutKeyV1(value: unknown): value is InputAreaLayoutKeyV1 {
  return typeof value === 'string' && allowedKeys.has(value)
}
export function normalizeInputAreaDesiredBoxV1(box: InputAreaDesiredBoxV1): InputAreaDesiredBoxV1 {
  const bounded = (value: number, min: number, max: number) => Math.round(Math.min(max, Math.max(min, Number.isFinite(value) ? value : min)))
  return { width: bounded(box.width, MIN_WIDTH, MAX_WIDTH), height: bounded(box.height, MIN_HEIGHT, MAX_HEIGHT) }
}
export function clampInputAreaBoxV1(box: InputAreaDesiredBoxV1, bounds: InputAreaBoundsV1): InputAreaDesiredBoxV1 {
  const positive = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
  const width = positive(bounds.width), height = positive(bounds.height)
  return {
    width: Math.min(width, Math.max(Math.min(width, positive(bounds.minWidth)), positive(box.width))),
    height: Math.min(height, Math.max(Math.min(height, positive(bounds.minHeight)), positive(box.height))),
  }
}
function browserStorage(): LayoutStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
function validBox(value: unknown): value is InputAreaDesiredBoxV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const box = value as Record<string, unknown>
  return typeof box.width === 'number' && Number.isFinite(box.width) && box.width >= MIN_WIDTH && box.width <= MAX_WIDTH
    && typeof box.height === 'number' && Number.isFinite(box.height) && box.height >= MIN_HEIGHT && box.height <= MAX_HEIGHT
}
function readBoxes(storage: LayoutStorage | null): Partial<Record<InputAreaLayoutKeyV1, InputAreaDesiredBoxV1>> {
  try {
    const raw = storage?.getItem(INPUT_AREA_STORAGE_KEY_V1)
    if (!raw || raw.length > 32768) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const data = parsed as Record<string, unknown>
    if (data.version !== 1 || !data.boxes || typeof data.boxes !== 'object' || Array.isArray(data.boxes)) return {}
    const result: Partial<Record<InputAreaLayoutKeyV1, InputAreaDesiredBoxV1>> = {}
    for (const [key, value] of Object.entries(data.boxes)) if (isInputAreaLayoutKeyV1(key) && validBox(value)) result[key] = { width: value.width, height: value.height }
    return result
  } catch { return {} }
}
export function loadInputAreaBoxV1(key?: InputAreaLayoutKeyV1, storage?: LayoutStorage | null): InputAreaDesiredBoxV1 | null {
  if (!isInputAreaLayoutKeyV1(key)) return null
  return readBoxes(storage === undefined ? browserStorage() : storage)[key] ?? null
}
/** Only explicit completed layout actions call this; observers never persist. */
export function saveInputAreaBoxV1(key: InputAreaLayoutKeyV1 | undefined, box: InputAreaDesiredBoxV1 | null, storage?: LayoutStorage | null): void {
  if (!isInputAreaLayoutKeyV1(key) || box !== null && !validBox(box)) return
  try {
    const target = storage === undefined ? browserStorage() : storage
    if (!target) return
    const boxes = readBoxes(target)
    if (box) boxes[key] = { width: box.width, height: box.height }
    else delete boxes[key]
    if (Object.keys(boxes).length) target.setItem(INPUT_AREA_STORAGE_KEY_V1, JSON.stringify({ version: 1, boxes }))
    else target.removeItem(INPUT_AREA_STORAGE_KEY_V1)
  } catch { /* Optional display preference: current session remains usable. */ }
}
