#!/usr/bin/env node
// 用法：INK_BASE_URL=https://你的桥 INK_TOKEN=xxx INK_READER=agent node rub-ink.mjs <ink_id> <stroke_id>
import { createInkClient } from '../agent-ink.js'
const [ink_id, stroke_id] = process.argv.slice(2)
const client = createInkClient({ baseUrl: process.env.INK_BASE_URL, token: process.env.INK_TOKEN, reader: process.env.INK_READER || 'agent' })
try { console.log(JSON.stringify(await client.rub({ ink_id, stroke_id }), null, 2)) }
catch (e) { console.error(e.status ? e.message : '显影服务暂不可用，请保留原 stroke_id 重试'); process.exitCode = 1 }
