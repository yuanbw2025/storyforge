/** MEMORY-0: keep the incomplete workspace UI hidden until MEMORY-4 closes the safe path. */
export const MEMORY_ENGINEERING_RUNTIME_STORAGE_KEY_V1 =
  'storyforge:memory-engineering:runtime-v1'

export function isMemoryEngineeringRuntimeEnabledV1(): boolean {
  try {
    return globalThis.localStorage?.getItem(MEMORY_ENGINEERING_RUNTIME_STORAGE_KEY_V1) !== 'disabled'
  } catch {
    return true
  }
}

export function setMemoryEngineeringRuntimeEnabledV1(enabled: boolean): void {
  try {
    globalThis.localStorage?.setItem(
      MEMORY_ENGINEERING_RUNTIME_STORAGE_KEY_V1,
      enabled ? 'enabled' : 'disabled',
    )
  } catch {
    // The caller still requires an explicit folder selection and user gesture.
  }
}
