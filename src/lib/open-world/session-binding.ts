import { canonicalProductProductionJsonV2 } from '../product-production/hash'
import {
  verifyFormalRuntimeSourceV1,
  type VerifiedFormalRuntimeSourceV1,
} from '../product/runtime-core'
import type {
  ProductRuntimeSession,
  TextOpenWorldRuntimePackageV1,
  TextOpenWorldSessionProjectionV1,
} from '../types'
import { parseTextOpenWorldSessionProjectionV1 } from './session-projection'

function fail(message: string): never { throw new Error(`[text-open-world-binding] ${message}`) }
function packageMatches(
  projection: TextOpenWorldSessionProjectionV1,
  runtimePackage: TextOpenWorldRuntimePackageV1,
) {
  if (canonicalProductProductionJsonV2(projection.runtimePackage)
    !== canonicalProductProductionJsonV2(runtimePackage)) {
    fail('Session投影的vNext RuntimePackage与ProductRelease/Build不一致')
  }
}

export interface VerifiedTextOpenWorldVNextSessionBindingV1 {
  formal: VerifiedFormalRuntimeSourceV1
  runtimePackage: TextOpenWorldRuntimePackageV1
}

/**
 * Verifies the one formal ProductRelease/Build source before a command opens
 * its commit transaction. The WorldRelease is provenance, never a runtime read.
 */
export async function verifyTextOpenWorldVNextSessionBindingV1(
  session: ProductRuntimeSession,
): Promise<VerifiedTextOpenWorldVNextSessionBindingV1> {
  const formal = await verifyFormalRuntimeSourceV1(session, ['text-open-world'])
  const runtimePackage = formal.runtimePackage.textOpenWorldVNext
    ?? fail('ProductRuntimePackage未包含vNext文字开放世界运行包')
  if (session.rulesetVersion !== runtimePackage.metadata.rulesetVersion
    || formal.runtimePackage.definition.rulesetVersion !== runtimePackage.metadata.rulesetVersion) {
    fail('Session rulesetVersion与ProductRelease/Build不一致')
  }
  let initialRaw: unknown
  try { initialRaw = JSON.parse(session.initialStateJson) } catch { fail('Session InitialState不是合法JSON') }
  const initialProjection = parseTextOpenWorldSessionProjectionV1((initialRaw as { textOpenWorld?: unknown }).textOpenWorld)
  packageMatches(initialProjection, runtimePackage)
  return { formal, runtimePackage }
}

/** Synchronous projection check used after the source rows are locked in a transaction. */
export function assertTextOpenWorldVNextProjectionBindingV1(
  currentProjection: TextOpenWorldSessionProjectionV1 | null | undefined,
  binding: VerifiedTextOpenWorldVNextSessionBindingV1,
): void {
  if (!currentProjection) fail('Session缺少vNext文字开放世界权威投影')
  packageMatches(parseTextOpenWorldSessionProjectionV1(currentProjection), binding.runtimePackage)
}
