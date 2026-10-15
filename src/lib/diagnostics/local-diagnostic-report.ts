import type { Table } from 'dexie'
import { db } from '../db/schema'
import { PROJECT_TABLES } from '../registry/project-tables'
import { APP_BUILD_ID } from '../version'

import { readRuntimeDiagnosticErrors } from './runtime-errors'
import type { RuntimeDiagnosticError } from './runtime-errors'
export { recordRuntimeDiagnosticError, installRuntimeDiagnostics, resetRuntimeDiagnostics } from './runtime-errors'
export type { RuntimeDiagnosticError } from './runtime-errors'

export interface LocalDiagnosticReport {
  format: 'storyforge-local-diagnostics'
  formatVersion: 1
  generatedAt: string
  application: {
    version: string
    routePattern: string
  }
  environment: {
    userAgent: string
    language: string
    platform: string
    online: boolean
    viewport: { width: number; height: number }
  }
  storage: {
    persisted: boolean | null
    usageBytes: number | null
    quotaBytes: number | null
  }
  database: {
    schemaVersion: number
    tableCounts: Record<string, number | null>
  }
  recentErrors: RuntimeDiagnosticError[]
  privacy: {
    includesRecordContents: false
    includesApiKeys: false
    includesLocalStorage: false
    automaticallyUploaded: false
  }
}

async function readTableCounts(
  tables: ReadonlyArray<{ name: string; table: Table }>,
): Promise<Record<string, number | null>> {
  const counts = await Promise.all(tables.map(async ({ name, table }) => {
    try {
      return [name, await table.count()] as const
    } catch {
      return [name, null] as const
    }
  }))
  return Object.fromEntries(counts)
}

async function readStorageMetadata(): Promise<LocalDiagnosticReport['storage']> {
  let persisted: boolean | null = null
  let usageBytes: number | null = null
  let quotaBytes: number | null = null

  try {
    persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : null
    usageBytes = estimate?.usage ?? null
    quotaBytes = estimate?.quota ?? null
  } catch {
    // Some privacy modes deny storage metadata. The report remains usable without it.
  }

  return { persisted, usageBytes, quotaBytes }
}

function routePattern(): string {
  if (typeof location === 'undefined') return ''
  return location.pathname.replace(/\d+/g, ':id')
}

export async function buildLocalDiagnosticReport(): Promise<LocalDiagnosticReport> {
  return {
    format: 'storyforge-local-diagnostics',
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    application: {
      version: APP_BUILD_ID,
      routePattern: routePattern(),
    },
    environment: {
      userAgent: navigator.userAgent,
      language: navigator.language,
      platform: navigator.platform,
      online: navigator.onLine,
      viewport: { width: window.innerWidth, height: window.innerHeight },
    },
    storage: await readStorageMetadata(),
    database: {
      schemaVersion: db.verno,
      tableCounts: await readTableCounts(PROJECT_TABLES),
    },
    recentErrors: readRuntimeDiagnosticErrors(),
    privacy: {
      includesRecordContents: false,
      includesApiKeys: false,
      includesLocalStorage: false,
      automaticallyUploaded: false,
    },
  }
}
