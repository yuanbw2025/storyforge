import config from './vitest.config.ts'

if (process.env.STORYFORGE_COVERAGE_SHARD_COMPONENT !== '1') {
  throw new Error('Run coverage shards through scripts/run-coverage-shard.mjs; aggregate acceptance is required.')
}

// Individual shards contain partial coverage. The ordinary Vitest config and
// every existing threshold are applied when npm run ci merges all eight blobs.
export default {
  ...config,
  test: {
    ...config.test,
    coverage: { ...config.test?.coverage, thresholds: undefined },
  },
}
