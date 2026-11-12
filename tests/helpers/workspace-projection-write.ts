/** Text-backed test directories must retain the leading BOM of archived bytes. */
export function workspaceWriteText(value: string | ArrayBuffer): string {
  return typeof value === 'string' ? value : new TextDecoder('utf-8', { ignoreBOM: true }).decode(value)
}
