import { hashCanonicalValue } from '../agent/run/hash'

interface CommunityRequestIntentV1 {
  readonly requestId: string
  readonly createdAt: number
}

/** Pending commands belong to one panel, service and credential. */
export function createCommunityRequestIntentsV1() {
  const clients = new WeakMap<object, Map<string, CommunityRequestIntentV1>>()
  return {
    async send<Result>(
      client: object,
      accessToken: string,
      operation: string,
      body: unknown,
      submit: (intent: CommunityRequestIntentV1) => Promise<Result>,
    ): Promise<Result> {
      // Remember only a digest of private text and credentials during a retry.
      const fingerprint = await hashCanonicalValue([accessToken, operation, body])
      let pending = clients.get(client)
      if (!pending) {
        pending = new Map()
        clients.set(client, pending)
      }
      let intent = pending.get(fingerprint)
      if (!intent) {
        intent = { requestId: crypto.randomUUID(), createdAt: Date.now() }
        pending.set(fingerprint, intent)
      }
      const result = await submit(intent)
      if (pending.get(fingerprint) === intent) pending.delete(fingerprint)
      return result
    },
  }
}
