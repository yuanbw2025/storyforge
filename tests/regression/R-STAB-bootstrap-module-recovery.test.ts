import { describe, expect, it, vi } from 'vitest'
import { acknowledgeBootstrapModuleLoadV1, BOOTSTRAP_MODULE_RELOAD_KEY_V1, isModuleLoadFailureV1, reserveBootstrapModuleReloadV1 } from '../../src/lib/module-load-recovery'

const failure = new TypeError('Failed to fetch dynamically imported module: http://localhost/test-module.js')
function store() {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
}
describe('existing bootstrap module resource failure recovery', () => {
  it.each(['Failed to fetch dynamically imported module: /module.js', 'error loading dynamically imported module: /module.js', 'Importing a module script failed.', 'Unable to preload CSS for /style.css'])('recognizes the existing in-app resource boundary: %s', message => {
    expect(isModuleLoadFailureV1(new TypeError(message))).toBe(true)
  })
  it.each([new Error('Failed to fetch'), new Error('Cannot read properties of null'), new SyntaxError('invalid module'), null, 'Failed to fetch dynamically imported module: /module.js'])('does not replay other failures: %s', error => {
    const getter = vi.fn(() => store())
    expect(reserveBootstrapModuleReloadV1(error, getter)).toBe(false)
    expect(getter).not.toHaveBeenCalled()
  })
  it('reserves once across document reloads, and only success clears the reservation', () => {
    const saved = store()
    expect(reserveBootstrapModuleReloadV1(failure, () => saved)).toBe(true)
    expect(reserveBootstrapModuleReloadV1(failure, () => saved)).toBe(false)
    expect(saved.getItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1)).toBe('pending')
    acknowledgeBootstrapModuleLoadV1(() => saved)
    expect(saved.getItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1)).toBeNull()
    expect(reserveBootstrapModuleReloadV1(failure, () => saved)).toBe(true)
  })
  it('unavailable storage, failed writes and unacknowledged writes cannot cause reload loops', () => {
    expect(reserveBootstrapModuleReloadV1(failure, () => { throw new Error('blocked storage') })).toBe(false)
    expect(reserveBootstrapModuleReloadV1(failure, () => ({ ...store(), setItem: () => { throw new Error('full') } }))).toBe(false)
    expect(reserveBootstrapModuleReloadV1(failure, () => ({ ...store(), setItem: () => undefined }))).toBe(false)
    expect(() => acknowledgeBootstrapModuleLoadV1(() => { throw new Error('blocked storage') })).not.toThrow()
  })
  it('a damaged reservation fails closed without overwriting it', () => {
    const saved = store(); saved.setItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1, 'unknown')
    expect(reserveBootstrapModuleReloadV1(failure, () => saved)).toBe(false)
    expect(saved.getItem(BOOTSTRAP_MODULE_RELOAD_KEY_V1)).toBe('unknown')
  })
  it('a hostile error getter cannot break the fallback', () => {
    expect(isModuleLoadFailureV1({ get message() { throw new Error('getter') } })).toBe(false)
  })
})
