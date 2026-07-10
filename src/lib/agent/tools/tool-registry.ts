import type {
  StoryForgeTool,
  ToolAvailability,
  ToolExecutionContext,
  ToolRisk,
  ToolScope,
} from './tool-types'

function supportsPlatform(
  availability: ToolAvailability,
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

interface RegisteredToolSnapshot {
  readonly tool: StoryForgeTool
  readonly name: string
  readonly risk: ToolRisk
  readonly availability: ToolAvailability
  readonly requiredScopes: readonly ToolScope[]
  readonly execute: StoryForgeTool['execute']
}

function createSnapshot(tool: StoryForgeTool): RegisteredToolSnapshot {
  return Object.freeze({
    tool,
    name: tool.name,
    risk: tool.risk,
    availability: tool.availability,
    requiredScopes: Object.freeze([...tool.requiredScopes]),
    execute: tool.execute.bind(tool),
  })
}

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredToolSnapshot>()

  register(tool: StoryForgeTool): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`[tool-registry] duplicate tool ${tool.name}`)
    }

    const snapshot = createSnapshot(tool)
    this.#tools.set(snapshot.name, snapshot)
  }

  get(name: string): StoryForgeTool | undefined {
    return this.#tools.get(name)?.tool
  }

  listAvailable(context: ToolExecutionContext): StoryForgeTool[] {
    return Array.from(this.#tools.values())
      .filter(snapshot =>
        supportsPlatform(snapshot.availability, context.platform)
        && hasScopes(snapshot.requiredScopes, context.scopes),
      )
      .map(snapshot => snapshot.tool)
  }

  async execute(
    name: string,
    context: ToolExecutionContext,
    input: unknown,
  ): Promise<unknown> {
    const snapshot = this.#tools.get(name)
    if (!snapshot) {
      throw new Error(`[tool-registry] unknown tool ${name}`)
    }

    if (!supportsPlatform(snapshot.availability, context.platform)
      || !hasScopes(snapshot.requiredScopes, context.scopes)) {
      throw new Error(`[tool-registry] tool ${name} is not available`)
    }

    if (context.signal.aborted) {
      throw new DOMException('Agent run aborted', 'AbortError')
    }

    return snapshot.execute(context, input)
  }
}
