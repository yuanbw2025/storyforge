import { describe, expect, it, vi } from 'vitest'
import { canonicalStringify, hashCanonicalValue } from '../../src/lib/agent/run/hash'
import { identifyPrivateReferenceRunsV1 } from '../../src/lib/import/document-parse-backup-privacy'
import type { ImportSession } from '../../src/lib/types'
import historical from '../helpers/fixtures/sfqa022044-historical-import-origins.json'

function example(target: 'project' | 'reference') {
  const sample = structuredClone(historical.records.find(record => record.session.importTarget === target)!)
  const session: ImportSession = {
    ...sample.session, importTarget: target, filename: 'synthetic.txt', totalChars: 20, totalChunks: 1, chunkSize: 20,
    status: 'done', rollingContext: '', merged: {}, createdAt: 1, updatedAt: 1,
    chunks: sample.session.chunks.map(chunk => ({ ...chunk, startChar: 0, endChar: 20, charCount: 20, status: 'done', attempts: 1 })),
  }
  const run: typeof sample.run & { portableDocumentImportOriginJson?: string } = sample.run
  return { run, session }
}

const classify = (run: ReturnType<typeof example>['run'], sessions: ImportSession[]) =>
  identifyPrivateReferenceRunsV1([run], 'contractJson', async () => sessions)

describe('authentic historical document import Run ownership (SFQA-022/044)', () => {
  it('removes only the proven reference Run and keeps a verifiable proof for ordinary restores', async () => {
    const reference = example('reference'), project = example('project')
    expect(await classify(reference.run, [reference.session])).toEqual(new Set([reference.run.id]))
    expect(reference.run.portableDocumentImportOriginJson).toBeUndefined()
    expect(await classify(project.run, [project.session])).toEqual(new Set())
    expect(JSON.parse(project.run.portableDocumentImportOriginJson!).binding.importTarget).toBe('project')
    expect(await classify(project.run, [])).toEqual(new Set())
  })

  it('rejects a duplicate origin and fails closed when the original import cannot be reconstructed', async () => {
    const ref = example('reference')
    await expect(classify(ref.run, [ref.session, structuredClone(ref.session)])).rejects.toThrow(/多个原会话/)
    await expect(classify(ref.run, [])).rejects.toThrow(/缺少可核实/)
    const contract = JSON.parse(ref.run.contractJson)
    contract.permissions = JSON.parse(example('project').run.contractJson).permissions
    ref.run.contractJson = JSON.stringify(contract)
    await expect(classify(ref.run, [])).rejects.toThrow(/冻结合同/)
    ref.run.contractHash = await hashCanonicalValue(contract)
    await expect(classify(ref.run, [])).rejects.toThrow(/缺少可核实/)
  })

  it.each(['work', 'session', 'kind', 'claim', 'chunk', 'bytes'] as const)('rejects an altered local %s binding', async change => {
    const { run, session } = example('reference')
    if (change === 'work') session.targetScope!.workId++
    if (change === 'session') session.id!++
    if (change === 'kind') session.importTarget = 'project'
    if (change === 'claim') session.chunks[0].durableParse!.claimKey += '-changed'
    if (change === 'chunk') session.chunks[0].index++
    if (change === 'bytes') session.chunks[0].sourceTextHash = 'a'.repeat(64)
    await expect(classify(run, [session])).rejects.toThrow(/不匹配|不符/)
    expect(run.portableDocumentImportOriginJson).toBeUndefined()
  })

  it('rejects copied or altered portable evidence even with the ordinary permissions', async () => {
    const project = example('project'), reference = example('reference')
    await classify(project.run, [project.session])
    reference.run.portableDocumentImportOriginJson = project.run.portableDocumentImportOriginJson
    await expect(classify(reference.run, [])).rejects.toThrow(/摘要不一致/)
    const proof = JSON.parse(project.run.portableDocumentImportOriginJson!)
    proof.binding.claimKey += '-changed'
    project.run.portableDocumentImportOriginJson = JSON.stringify(proof)
    await expect(classify(project.run, [])).rejects.toThrow(/摘要不一致/)
  })

  it('excludes the dedicated reference-import entry without reading any private sessions', async () => {
    const { run } = example('reference')
    const contract = JSON.parse(run.contractJson)
    contract.executionBindings[0].formalEntry.entryId = 'import.reference-chunk.parse.private'
    const lookup = vi.fn(async () => [])
    run.contractJson = JSON.stringify(contract)
    await expect(identifyPrivateReferenceRunsV1([run], 'contractJson', lookup)).rejects.toThrow(/冻结合同/)
    const entry = contract.executionBindings[0].formalEntry
    const frozen = { ...JSON.parse(entry.bindingJson), entryId: entry.entryId }
    entry.bindingJson = canonicalStringify(frozen)
    entry.bindingHash = await hashCanonicalValue(frozen)
    run.contractJson = canonicalStringify(contract)
    run.contractHash = await hashCanonicalValue(contract)
    expect(await identifyPrivateReferenceRunsV1([run], 'contractJson', lookup)).toEqual(new Set([run.id]))
    expect(lookup).not.toHaveBeenCalled()
  })
})
