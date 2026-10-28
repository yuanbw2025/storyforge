import { vi } from 'vitest'
import * as verifier from '../../src/lib/product-production/media-runtime-verifier'

const actualVerifier = verifier.verifyProductMediaRuntimeUrlsV1

/** Happy DOM has no AudioContext. Control only that unavailable OGG decoder;
 * the real shared verifier, original bytes/hash, HTTP/source/Run and adoption
 * checks still run. These observations are not native decode or hearing. */
export function mockAvgSoundOggDecoderV1() {
  return vi.spyOn(verifier, 'verifyProductMediaRuntimeUrlsV1').mockImplementation(input => actualVerifier({ ...input, decoder: {
    image: async () => { throw new Error('unexpected-history-image') },
    audio: async url => {
      const asset = input.assets.find(row => input.urls[row.assetKey] === url)
      if (asset?.mimeType !== 'audio/ogg') throw new Error('unexpected-completed-history-music')
      return { durationMs: 500, channelCount: 1, sampleRateHz: 48000,
        integratedLufs: -18, truePeakDbtp: -12, loopSeamDbfs: -40 }
    },
  } }))
}
