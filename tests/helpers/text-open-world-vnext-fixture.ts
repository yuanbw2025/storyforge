/**
 * Compatibility facade for historical regression suites.
 *
 * The authored Salt Ridge package is product content now; tests consume the
 * same production-owned definition instead of keeping a second test-only copy.
 */
export {
  createTextOpenWorldVNextFixture,
  createTextOpenWorldVNextP9Fixture,
  createTextOpenWorldVNextP9UnboundRestFixture,
  downgradeTextOpenWorldFixtureCombatActionsV1,
  downgradeTextOpenWorldFixtureCombatResolutionV1,
  downgradeTextOpenWorldFixtureCombatV1,
  downgradeTextOpenWorldFixtureCraftingV1,
  downgradeTextOpenWorldFixtureDirectorV1,
  downgradeTextOpenWorldFixtureEconomyV1,
  downgradeTextOpenWorldFixtureWithoutCrimeV1,
} from '../../src/content/salt-ridge/showcase-package'
