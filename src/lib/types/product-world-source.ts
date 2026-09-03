import type { ProductRuntimeCanonSnapshotV1, ProductRuntimeState } from './product-runtime'

export const PRODUCT_WORLD_SOURCE_COMPILER_VERSION = 1 as const

export const PRODUCT_WORLD_SOURCE_DIAGNOSTIC_SEVERITIES = ['error', 'warning', 'info'] as const
export type ProductWorldSourceDiagnosticSeverity = typeof PRODUCT_WORLD_SOURCE_DIAGNOSTIC_SEVERITIES[number]

export interface ProductWorldSourceDiagnosticV1 {
  code: string
  severity: ProductWorldSourceDiagnosticSeverity
  message: string
  sourceKeys: string[]
}
export interface ProductWorldSourceBundleV1 {
  schema: 'storyforge.product-world-source-bundle'
  version: 1
  compilerVersion: typeof PRODUCT_WORLD_SOURCE_COMPILER_VERSION
  source: {
    worldCode: string
    worldName: string
    worldContentHash: string
  }
  createdAt: number
  canonSnapshot: ProductRuntimeCanonSnapshotV1
  initialState: ProductRuntimeState
  diagnostics: ProductWorldSourceDiagnosticV1[]
  bundleHash: string
}
