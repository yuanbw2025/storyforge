import Dexie from 'dexie'
import { db } from './schema'

/** Native hashing and verification need a live IndexedDB transaction until their pure work settles. */
export function keepIntegrityReadAlive<T>(pending: Promise<T>): Promise<T> {
  return Dexie.currentTransaction?.db === db ? Dexie.waitFor(pending) : pending
}
