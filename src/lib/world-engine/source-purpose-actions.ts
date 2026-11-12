import Dexie from 'dexie'

/** Keep async module loading within an already-open caller transaction.
 * Outside a transaction these are ordinary one-shot admissions, never retries. */
function inCallerTransaction<T>(action: () => Promise<T>): Promise<T> {
  const operation = action()
  return Dexie.currentTransaction ? Dexie.waitFor(operation) : operation
}

export function freezeWorldSourcePurposeV1(...args: Parameters<typeof import('./source-purpose').freezeWorldSourcePurposeV1>): ReturnType<typeof import('./source-purpose').freezeWorldSourcePurposeV1> {
  const { worldReleaseId, expectedProjectId, expectedWorldId, purpose, sourceDeclarationHash } = args[0]
  const captured = { worldReleaseId, expectedProjectId, expectedWorldId, purpose, sourceDeclarationHash }
  return inCallerTransaction(async () => (await import('./source-purpose')).freezeWorldSourcePurposeV1(captured))
}

export function revalidateWorldSourcePurposeV1(...args: Parameters<typeof import('./source-purpose').revalidateWorldSourcePurposeV1>): ReturnType<typeof import('./source-purpose').revalidateWorldSourcePurposeV1> {
  const { worldReleaseId, expectedProjectId, expectedWorldId, purpose, proof } = args[0]
  const captured = { worldReleaseId, expectedProjectId, expectedWorldId, purpose, proof: proof && structuredClone(proof) }
  return inCallerTransaction(async () => (await import('./source-purpose')).revalidateWorldSourcePurposeV1(captured))
}
