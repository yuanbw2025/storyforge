import { vi } from 'vitest'
import { avgLocalMusicRouteV1, type AvgCompiledSoundRequirementV1 } from '../../src/lib/avg/sound-provider-contract'
import { avgSoundCapabilityFixtureV1, avgSoundPcmFixtureV1, avgSoundLibraryFixtureV1, avgSoundMusicResultFixtureV1 } from './avg-sound-wire-data'
export { avgSoundCapabilityFixtureV1, avgSoundPcmFixtureV1, avgSoundLibraryFixtureV1 } from './avg-sound-wire-data'

export async function avgSoundWireFixtureV1(requirement: AvgCompiledSoundRequirementV1, options: { networkFailure?: boolean; wrongHash?: boolean; onPost?: () => Promise<void> } = {}) {
  const capability = avgSoundCapabilityFixtureV1(), route = await avgLocalMusicRouteV1(capability)
  const library = avgSoundLibraryFixtureV1(), body = requirement.dispatch.operation === 'generate-music' ? avgSoundPcmFixtureV1(requirement.dispatch.body.durationSeconds) : library.data
  const fetcher = vi.fn(async (target: RequestInfo | URL, init?: RequestInit) => {
    const url = String(target)
    if (url === 'http://127.0.0.1:5298/v1/capabilities') return new Response(JSON.stringify(capability), { headers: { 'content-type': 'application/json' } })
    if (url === 'http://127.0.0.1:5298/v1/audio/music' && requirement.dispatch.operation === 'generate-music') {
      await options.onPost?.()
      if (options.networkFailure) throw new Error('engineering lost response after dispatch')
      const result = await avgSoundMusicResultFixtureV1({ capability, data: body,
        body: JSON.parse(String(init?.body)), idempotencyKey: new Headers(init?.headers).get('x-storyforge-idempotency-key')!, wrongHash: options.wrongHash })
      return new Response(body.slice(0), { headers: { 'content-type': 'audio/wav', 'x-request-id': result.jobId, 'x-storyforge-music-result': JSON.stringify(result) } })
    }
    if (url === `http://127.0.0.1:5298/v1/library/audio/${library.archive.archiveHash}/${library.member.memberHash}`) return new Response(library.data.slice(0),
      { headers: { 'content-type': 'audio/ogg', 'x-storyforge-library-result': JSON.stringify(library.result) } })
    throw new Error('Undeclared sound network forbidden')
  })
  return { capability, route, fetcher, body, library }
}
