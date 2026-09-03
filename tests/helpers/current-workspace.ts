import { createWorkspace } from '../../src/lib/workspace/create-workspace'

/** Minimal native v94 workspace for tests that exercise current contracts. */
export async function seedCurrentWorkspace(
  name = 'Current test workspace',
  options: { enableMultiWorld?: boolean } = {},
) {
  return createWorkspace({
    name,
    genre: 'fantasy',
    genres: ['fantasy'],
    description: '',
    targetWordCount: 100_000,
    status: 'drafting',
    enableMultiWorld: options.enableMultiWorld ?? false,
  }, {
    purpose: 'independent-work',
    kind: 'novel',
    novelProfile: 'long',
  })
}
