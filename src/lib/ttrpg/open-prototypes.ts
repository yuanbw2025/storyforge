/**
 * Offline evaluation boundary for the pure kernels retained from the handoff.
 * These exports operate on caller-supplied JSON/fixtures, never commit runtime
 * events, call a provider or install a product route. Their passing unit tests
 * are not evidence that P2c–P10 are integrated into the running product.
 */
import * as contextBudgetPrototype from './context-budget'
import * as contextTriggerPrototype from './context-trigger'
import * as narrativeMemoryPrototype from './narrative-memory'
import * as audioPrototype from './open-audio-runtime'
import * as gatesPrototype from './open-gates'
import * as intentPrototype from './open-intent'
import * as oraclePrototype from './oracle'
import * as sessionFactsPrototype from './session-facts'
import * as situationGenerationPrototype from './situation-generation'

export {
  contextBudgetPrototype, contextTriggerPrototype, narrativeMemoryPrototype,
  audioPrototype, gatesPrototype, intentPrototype, oraclePrototype,
  sessionFactsPrototype, situationGenerationPrototype,
}
