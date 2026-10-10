#!/usr/bin/env node
import fs from 'node:fs/promises'
import process from 'node:process'
import { randomBytes } from 'node:crypto'
import { startBridge } from './bridge.mjs'
const file = process.argv[2]
if (!file) throw new Error('Usage: node tools/mcp-bridge/cli.mjs /absolute/path/bridge-config.json')
const config = JSON.parse(await fs.readFile(file, 'utf8'))
const token = randomBytes(32).toString('base64url')
const bridge = await startBridge({ ...config, token })
process.stdout.write(`StoryForge MCP bridge: http://127.0.0.1:${bridge.port}\nAllowed authoring origin: ${config.origin}\nPaste this temporary token into the host tool panel (not a plugin file):\n${token}\n`)
for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { void bridge.close().then(() => process.exit(0)) })
