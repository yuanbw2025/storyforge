import { MemoryProjectStorage } from '../../src/lib/storage/adapters/memory/memory-project-storage'
import { runStorageContract } from './storage-contract'

runStorageContract('memory', () => new MemoryProjectStorage({
  backend: 'dexie',
  projectId: 1,
}))
