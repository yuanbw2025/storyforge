/** Exclusive Web Locks capability fixture; domain/DB paths remain real. */
export function installEvalWebLocksFixtureV1(): () => void {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks')
  const held = new Set<string>()
  const waiting = new Map<string, Array<() => void>>()
  type Callback<Result> = (lock: Pick<Lock, 'name' | 'mode'> | null) => Result | Promise<Result>
  const manager = {
    async request<Result>(name: string, optionsOrCallback: LockOptions | Callback<Result>, callback?: Callback<Result>): Promise<Result> {
      const options = typeof optionsOrCallback === 'function' ? {} : optionsOrCallback
      const operation = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback
      if (!operation) throw new Error('Web Lock callback required')
      while (held.has(name)) {
        if (options.ifAvailable) return operation(null)
        await new Promise<void>(resolve => {
          const queue = waiting.get(name) ?? []; queue.push(resolve); waiting.set(name, queue)
        })
      }
      held.add(name)
      try { return await operation({ name, mode: 'exclusive' }) }
      finally {
        held.delete(name)
        waiting.get(name)?.shift()?.()
      }
    },
  }
  Object.defineProperty(navigator, 'locks', { configurable: true, value: manager })
  return () => {
    if (previous) Object.defineProperty(navigator, 'locks', previous)
    else Reflect.deleteProperty(navigator, 'locks')
  }
}
