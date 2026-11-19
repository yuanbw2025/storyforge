/** Reconstruct only the v21 inspiration declaration; every historical hash
 * stays literal. This is a test projection, never a runtime receipt rewrite. */
export function legacyAgentToolsV21(snapshot: unknown): Array<{ name: string; [key: string]: unknown }> {
  const tools = structuredClone(snapshot) as Array<{ name: string; parameters: { properties: Record<string, Record<string, unknown>> }; [key: string]: unknown }>
  const inspiration = tools.find(tool => tool.name === 'read_inspiration_workspace')
  if (!inspiration) throw new Error('Missing inspiration tool in v22 snapshot')
  delete inspiration.parameters.properties.directionIndex
  inspiration.parameters.properties.mode = {
    type: 'string', enum: ['single', 'multiworld'], description: '与当前项目一致的反推结果模式',
  }
  return tools
}
