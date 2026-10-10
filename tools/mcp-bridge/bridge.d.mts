import type { Transport } from '@modelcontextprotocol/client'
export interface BridgeServer { command: string; args: string[]; tools: string[]; env?: Record<string,string> }
export function startBridge(input: { origin: string; token: string; servers: Record<string,BridgeServer>; port?: number; transportFactory?: (spec: Omit<BridgeServer,'tools'>) => Transport }): Promise<{port:number;close():Promise<void>}>
