import os from 'node:os'; import path from 'node:path'
import { createInkVault } from '../agent-ink.js'
const vault = await createInkVault({ filePath: path.join(os.tmpdir(), 'ink-smoke-' + Date.now() + '.json'), secret: 'demo-secret' })
const masked = await vault.mask('晚安～||You are all I need||', { scope: 'msg-1', reader: 'agent' })
console.log(masked)
const id = masked.match(/ink_[a-f0-9-]{36}/)[0]
for (const s of ['wipe-1', 'wipe-2', 'wipe-3']) console.log((await vault.rub({ ink_id: id, stroke_id: s }, 'agent')).visible)
console.log('重试 wipe-2 不会多擦：', (await vault.rub({ ink_id: id, stroke_id: 'wipe-2' }, 'agent')).repeated)
