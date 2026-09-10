export interface FakeOpfsHarnessV1 {
  files: Map<string, ArrayBuffer>
  readCount: number
  beforeRead: ((path: string, readCount: number) => void) | null
  restore(): void
}

/** Minimal content-addressed OPFS surface for physical-byte race regressions. */
export function installFakeOpfsV1(): FakeOpfsHarnessV1 {
  const files = new Map<string, ArrayBuffer>()
  const harness: FakeOpfsHarnessV1 = {
    files,
    readCount: 0,
    beforeRead: null,
    restore() {},
  }
  const directory = (prefix: string): any => ({
    async getDirectoryHandle(name: string) { return directory(`${prefix}/${name}`) },
    async getFileHandle(name: string) {
      const path = `${prefix}/${name}`
      return {
        async createWritable() {
          return {
            async write(data: ArrayBuffer) { files.set(path, data.slice(0)) },
            async close() {},
            async abort() {},
          }
        },
        async getFile() {
          harness.readCount += 1
          harness.beforeRead?.(path, harness.readCount)
          const data = files.get(path)
          if (!data) throw new Error('missing fake OPFS file')
          return new Blob([data])
        },
      }
    },
    async removeEntry(name: string) { files.delete(`${prefix}/${name}`) },
  })
  const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {
      getDirectory: async () => directory(''),
      estimate: async () => ({ quota: 1_000_000, usage: 0 }),
    },
  })
  harness.restore = () => {
    if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
    else delete (navigator as { storage?: unknown }).storage
  }
  return harness
}
