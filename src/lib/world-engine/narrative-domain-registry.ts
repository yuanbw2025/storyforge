import { PROJECT_TABLES } from '../registry/project-tables'
import { FACT_PREDICATE_REGISTRY } from '../registry/fact-predicate-registry'
import { CANON_ASSERTION_SOURCE_REGISTRY } from '../registry/canon-assertion-source-registry'
import type { NarrativeDomainRegistryV1, NarrativeDomainTableContractV1 } from '../types/narrative-domain-registry'
import { narrativeSemanticExportReferencesV1 } from '../narrative-domain/semantic-export-references'

/** Capture only interpretation metadata, never database handles or user rows. */
export function currentNarrativeDomainRegistryV1(): NarrativeDomainRegistryV1 {
  return {
    version: 1,
    tables: PROJECT_TABLES.filter(spec => spec.worldSemantic).map(spec => {
      const { name, worldSemantic, resourceIdentity, domainOwner, worldScoped, worldGroupField, homeWorldScoped,
        exportIdField, tree, selfIdPaths } = spec
      return JSON.parse(JSON.stringify({ name, worldSemantic, resourceIdentity, domainOwner, worldScoped,
        worldGroupField, homeWorldScoped, ...narrativeSemanticExportReferencesV1(spec),
        exportIdField, tree, selfIdPaths })) as NarrativeDomainTableContractV1
    }),
    evidenceFields: Object.fromEntries(CANON_ASSERTION_SOURCE_REGISTRY.map(spec => [spec.table, spec.fields.map(field => field.field)])),
    predicates: JSON.parse(JSON.stringify(FACT_PREDICATE_REGISTRY)),
  }
}

export function narrativeDomainTableV1(registry: NarrativeDomainRegistryV1, table: string): NarrativeDomainTableContractV1 {
  const spec = registry.tables.find(item => item.name === table)
  if (!spec) throw new Error(`[narrative-contract:table] ${table} 不属于该版本的语义合同`)
  return spec
}
