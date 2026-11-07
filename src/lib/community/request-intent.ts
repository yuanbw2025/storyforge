interface CommunityRequestIntentV1 {
  readonly requestId: string
  readonly createdAt: number
}

/** Component-local pending commands; form fingerprints never become wire IDs. */
export function createCommunityRequestIntentsV1() {
  const pending = new Map<string, CommunityRequestIntentV1>()
  return {
    async send<Result>(
      operation: string,
      body: unknown,
      submit: (intent: CommunityRequestIntentV1) => Promise<Result>,
    ): Promise<Result> {
      const fingerprint = JSON.stringify([operation, body])
      let intent = pending.get(fingerprint)
      if (!intent) {
        intent = Object.freeze({ requestId: crypto.randomUUID(), createdAt: Date.now() })
        pending.set(fingerprint, intent)
      }
      // A rejected or unknown response keeps its exact intent for an explicit
      // retry. Only an observed command success retires that same intent.
      const result = await submit(intent)
      if (pending.get(fingerprint) === intent) pending.delete(fingerprint)
      return result
    },
  }
}
