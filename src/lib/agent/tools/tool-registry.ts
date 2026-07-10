import type { StoryForgeTool, ToolExecutionContext, ToolScope } from './tool-types'

function supportsPlatform(
  availability: StoryForgeTool['availability'],
  platform: ToolExecutionContext['platform'],
): boolean {
  return availability === 'both' || availability === platform
}

function hasScopes(
  required: readonly ToolScope[],
  granted: ReadonlySet<ToolScope>,
): boolean {
  return required.every(scope => granted.has(scope))
}

export class ToolRegistry {
  private readonly tools = new Map<string, StoryForgeTool<unknown, unknown>>()

  register<Input, Output>(tool: StoryForgeTool<Input, Output>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`[tool-registry] duplicate tool ${tool.name}`)
    }

    this.tools.set(tool.name, tool as unknown as StoryForgeTool<unknown, unknown>)
  }

  get(name: string): StoryForgeTool | undefined {
    return this.tools.get(name)
  }

  listAvailable(context: ToolExecutionContext): StoryForgeTool[] {
    return Array.from(this.tools.values()).filter(tool =>
      supportsPlatform(tool.availability, context.platform)
      && hasScopes(tool.requiredScopes, context.scopes),
    )
  }

  async execute<Input, Output>(
    name: string,
    context: ToolExecutionContext,
    input: Input,
  ): Promise<Output> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new Error(`[tool-registry] unknown tool ${name}`)
    }

    if (!supportsPlatform(tool.availability, context.platform)
      || !hasScopes(tool.requiredScopes, context.scopes)) {
      throw new Error(`[tool-registry] tool ${name} is not available`)
    }

    if (context.signal.aborted) {
      throw new DOMException('Agent run aborted', 'AbortError')
    }

    const typedTool = tool as unknown as StoryForgeTool<Input, Output>
    return typedTool.execute(context, input)
  }
}
