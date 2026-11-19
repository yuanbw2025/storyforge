/* eslint no-unused-vars: ["error", { "args": "none" }] -- Declaration signatures have no implementation bodies in which to use parameters; retain checks for unused type and variable declarations. */

export interface CoverageSource {
  commit: string
  tree: string
  vitest: string
}

export interface CompletedTestReport {
  success: boolean
  numTotalTests: number
  numFailedTests: number
  numFailedTestSuites: number
  testResults: Array<{ name: string }>
}

export interface CoverageValidationOptions {
  source: CoverageSource
  expectedFiles: readonly string[]
  count?: number
}

export const COVERAGE_SHARD_COUNT: 8
export function vitestExecutable(): string
export function fileDigest(file: string): string
export function coverageSource(): CoverageSource
export function coverageFiles(): string[]
export function relativeTestFile(file: string): string
export function completedTestFiles(report: CompletedTestReport): string[]
export function validateCoverageShards(directory: string, options: CoverageValidationOptions): string[]
export function prepareCoverageMerge(directory: string): { destination: string; expectedFiles: string[] }
