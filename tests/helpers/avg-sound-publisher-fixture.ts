import { readFileSync } from 'node:fs'
import type { AvgSoundPublisherLibrarySourceV2 } from '../../src/lib/avg/sound-publisher-library'

/** Verbatim CC0 member and the actual first original-library-reader result.
 * Test HTTP using them is controlled; no author/producer or hearing is seeded. */
export function avgSoundPublisherFixtureV2() {
  const result = JSON.parse(readFileSync('tests/fixtures/avg-audio/rubberduck-rain.original.result-v2.json', 'utf8'))
  const source: AvgSoundPublisherLibrarySourceV2 = { version: 2, sourceKey: result.sourceKey,
    publisherPage: result.publisherPage, license: 'CC0-1.0', publisherPageHash: result.licenseEvidence.publisherPageHash,
    archiveHash: result.archiveHash, memberPath: result.memberPath, memberHash: result.memberHash }
  const data = Uint8Array.from(readFileSync('tests/fixtures/avg-audio/rubberduck-rain.original.ogg')).buffer
  return { source, data, result }
}
