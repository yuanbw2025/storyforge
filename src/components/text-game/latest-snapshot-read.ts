/** Workbench panels share one expensive lineage reader at a time. Each queued
 * read still validates fresh authority; no result or authorization is cached. */
let workspaceReadTail: Promise<void> = Promise.resolve()

async function serializeWorkspaceRead(read: () => Promise<void>): Promise<void> {
  const previous = workspaceReadTail
  let release!: () => void
  workspaceReadTail = new Promise<void>(resolve => { release = resolve })
  await previous
  try { await read() } finally { release() }
}

/**
 * A workbench snapshot may include a large durable lineage. Keep one read in
 * flight and one pending request, replacing the pending request on refresh.
 * Callers handle errors and only publish while isCurrent() is true.
 */
export function createLatestSnapshotReadQueue() {
  type Read = (isCurrent: () => boolean) => Promise<void>
  let generation = 0
  let pending: { generation: number; read: Read } | null = null
  let running: Promise<void> | null = null

  return {
    enqueue(read: Read): Promise<void> {
      pending = { generation: ++generation, read }
      if (!running) {
        // Start in a microtask so running is assigned before any read settles.
        running = Promise.resolve().then(async () => {
          try {
            while (pending) {
              const request = pending
              pending = null
              await serializeWorkspaceRead(async () => {
                if (request.generation !== generation) return
                await request.read(() => request.generation === generation)
              })
            }
          } finally {
            running = null
          }
        })
      }
      return running
    },
    invalidate() {
      generation += 1
      pending = null
    },
  }
}
