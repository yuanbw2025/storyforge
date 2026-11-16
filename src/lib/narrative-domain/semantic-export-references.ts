import type { TableSpec } from '../registry/types'

type ExportReferences = Pick<TableSpec, 'exportRemap' | 'exportRefRemap'>

/** Workspace backup admission and reviewed local locators do not change
 * narrative interpretation or the existing release wire. */
export function narrativeSemanticExportReferencesV1({ exportRemap, exportRefRemap }: ExportReferences): ExportReferences {
  const scalar = exportRemap?.filter(ref => !ref.reviewLocal).map(ref => {
    const { requiredOnImport: _required, sameWorkOnImport: _sameWork, ...semantic } = ref
    return semantic
  })
  const nested = exportRefRemap?.filter(ref => !('reviewLocal' in ref && ref.reviewLocal))
  return {
    exportRemap: scalar?.length ? scalar : undefined,
    exportRefRemap: nested?.length ? nested : undefined,
  }
}
