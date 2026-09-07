/** Defense in depth after capability-scoped reads. This does not claim semantic non-disclosure. */
export function assertTtrpgNoRestrictedTextV1(text: string, restricted: readonly string[], authorized: readonly string[] = []): void {
  const compact = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, '')
  const output = compact(text)
  const publicTexts = authorized.map(compact)
  const isRestricted = (phrase: string) => output.includes(phrase) && !publicTexts.some(value => value.includes(phrase))
  for (const value of restricted) {
    const phrase = compact(value)
    if (phrase.length < 2) continue
    if (isRestricted(phrase)) throw new Error('[ttrpg-information] 输出包含未获准披露的私密信息')
    if (phrase.length >= 12) {
      for (let index = 0; index <= phrase.length - 10; index += 1) {
        if (isRestricted(phrase.slice(index, index + 10))) {
          throw new Error('[ttrpg-information] 输出包含未获准披露的私密信息片段')
        }
      }
    }
  }
}
