/** Resource imports are idempotent. An in-app retry still uses the author save
 * barrier; only the pre-application bootstrap may reserve one automatic reload. */
export function isModuleLoadFailureV1(error: unknown): boolean {
  try {
    const message = error && typeof error === 'object' && 'message' in error ? error.message : ''
    return typeof message === 'string'
      && /^(Failed to fetch dynamically imported module:|error loading dynamically imported module:|Importing a module script failed|Unable to preload CSS for )/.test(message)
  } catch { return false }
}

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export const BOOTSTRAP_MODULE_RELOAD_KEY_V1 = 'storyforge-bootstrap-module-reload-v1'

export function reserveBootstrapModuleReloadV1(error: unknown, storage: () => RecoveryStorage): boolean {
  if (!isModuleLoadFailureV1(error)) return false
  try {
    const current = storage()
    if (current.getItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1) !== null) return false
    current.setItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1, 'pending')
    return current.getItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1) === 'pending'
  } catch { return false }
}

/** Only a successful import acknowledges the recovery, never a timer or error. */
export function acknowledgeBootstrapModuleLoadV1(storage: () => RecoveryStorage): void {
  try { storage().removeItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1) } catch { /* Storage can be unavailable. */ }
}
