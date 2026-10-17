/** A changed read head is not permission to resend a model request. */
export class TtrpgOpenReadConflictV1 extends Error {
  constructor(message: string) { super(message) }
}

/** A concurrent commit can invalidate a display read. Retry only that read, never its preceding action. */
export async function readTtrpgOpenSettledViewV1<T>(read: () => Promise<T>, stillCurrent: () => boolean): Promise<T | undefined> {
  for (let attempt = 0; attempt < 3 && stillCurrent(); attempt++) {
    try {
      const value = await read()
      return stillCurrent() ? value : undefined
    } catch (error) {
      if (!stillCurrent()) return undefined
      if (!(error instanceof TtrpgOpenReadConflictV1) || attempt === 2) throw error
    }
  }
  return undefined
}
