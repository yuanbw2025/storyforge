import type { ExtensionContext } from '@storyforge/plugin-sdk'
export default { activate(ctx: ExtensionContext) { ctx.services.provide('storyforge.calendar.format', { format: input => typeof input === 'string' && /^-?\d+$/.test(input) ? (Number(input) < 0 ? `纪元前 ${Math.abs(Number(input))} 年` : `新纪 ${input} 年`) : String(input) }) } }
