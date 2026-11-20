/** Test-only reconstruction of the last preparation tool contract. */
export function legacyAgentToolsV22(snapshot: unknown): Array<{ name: string; [key: string]: unknown }> {
  const tools = structuredClone(snapshot) as Array<{ name: string; parameters: { properties: Record<string, Record<string, unknown>> }; [key: string]: unknown }>
  const inspiration = tools.find(tool => tool.name === 'read_inspiration_workspace')
  if (!inspiration) throw new Error('Missing inspiration tool in current snapshot')
  inspiration.parameters.properties.mode = {
    type: 'string', enum: ['single', 'multiworld', 'organize', 'compare', 'deepen'],
    description: '完整反推模式或独立准备动作；准备动作不受多世界开关限制',
  }
  inspiration.parameters.properties.directionIndex = {
    type: 'integer', minimum: 1, maximum: 4, description: '深化时作者明确选择的已确认比较方向序号',
  }
  return tools
}
