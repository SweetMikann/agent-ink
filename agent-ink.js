import fs from 'node:fs/promises'
import path from 'node:path'
import { createHmac, randomUUID } from 'node:crypto'
const marks = () => /[|｜][|｜]([\s\S]+?)[|｜][|｜]/g
export const hasInk = value => typeof value === 'string' && marks().test(value)
const fail = (status, message) => { throw Object.assign(new Error(message), { status }) }
export const rubInkTool = { name: 'rub_ink', description: '擦拭一块隐形墨水，每次显影约三分之一，三次擦完。新擦拭用新 stroke_id；网络重试复用原 stroke_id，不会多擦。只读取已给出的墨水编号，不猜未显影内容。', inputSchema: { type: 'object', properties: { ink_id: { type: 'string', pattern: '^ink_[a-f0-9-]{36}$' }, stroke_id: { type: 'string', minLength: 1, maxLength: 120, pattern: '^[a-zA-Z0-9_:.-]{1,120}$' } }, required: ['ink_id', 'stroke_id'], additionalProperties: false }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
export async function createInkVault({ filePath, secret, readers: readerList = ['agent'], hint: customHint }) {
 if (!secret) throw Error('Ink vault requires a stable secret')
 const readers = new Set(readerList)
 let state = { version: 1, records: {}, index: {} }, queue = Promise.resolve()
 try { state = JSON.parse(await fs.readFile(filePath, 'utf8')); if(state.version!==1 || !state.records || !state.index) throw Error('Invalid ink ledger') } catch(e) { if(e.code!=='ENOENT') throw e }
 const locked = work => {const task=queue.then(work);queue=task.catch(()=>{});return task}
 async function save(next) { await fs.mkdir(path.dirname(filePath),{recursive:true,mode:0o700});await fs.writeFile(filePath+'.tmp',JSON.stringify(next),{mode:0o600});await fs.rename(filePath+'.tmp',filePath);state=next }
 function hint(id,reader) {
  if(customHint)return customHint(id,reader)
  return `〔隐形墨水 ${id}；尚未擦开。调用 rub_ink（ink_id="${id}", stroke_id="wipe-1"）。后两次用 wipe-2、wipe-3 逐段显影，重试复用原 stroke_id〕`
 }
 async function mask(value,{scope,reader}={}) {
  if(!readers.has(reader)||typeof scope!=='string'||!scope||scope.length>500)fail(400,'无效的墨水范围')
  if(!hasInk(JSON.stringify(value)))return value
  return locked(async()=>{
   let next=state;let changed=false
   function walk(v) {
    if(typeof v==='string'){ let occurrence=0; return v.replace(marks(),(_match,text)=>{
     const key=createHmac('sha256',secret).update(JSON.stringify([scope,reader,occurrence++,text])).digest('hex')
     let id=next.index[key]
     if(!id){if(next===state)next=structuredClone(state);id='ink_'+randomUUID();next.index[key]=id;next.records[id]={reader,text,strokes:{},step:0,createdAt:new Date().toISOString()};changed=true}
     return hint(id,reader)
    }) }
    if(Array.isArray(v))return v.map(walk)
    if(v && typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,walk(x)]))
    return v
   }
   const masked=walk(value);if(changed)await save(next);return masked
  })
 }
 async function rub({ink_id,stroke_id},reader) {
  if(!readers.has(reader)||!/^ink_[a-f0-9-]{36}$/.test(ink_id||'')||!/^[\w:.-]{1,120}$/.test(stroke_id||''))fail(400,'需要墨水编号和新的 stroke_id')
  return locked(async()=>{
   const entry=state.records[ink_id];if(!entry || entry.reader!==reader)fail(404,'这不是投递给你的墨水编号')
   if(Object.hasOwn(entry.strokes,stroke_id))return {...entry.strokes[stroke_id],repeated:true}
   if(entry.step===3)return {...Object.values(entry.strokes).find(s=>s.complete),already_complete:true}
   const next=structuredClone(state),row=next.records[ink_id];row.step=Math.min(3,row.step+1)
   const graphemes=Array.from(new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(row.text),s=>s.segment)
   const count=row.step===3?graphemes.length:Math.floor(graphemes.length*row.step/3)
   const result={ink_id,step:row.step,total_steps:3,visible:graphemes.slice(0,count).join(''),complete:row.step===3,remaining_hidden:row.step<3,note:row.step===3?'墨水已擦开。':'只辨认出 visible 中的文字，其余仍藏着；继续擦拭请换一个 stroke_id。'}
   row.strokes={...row.strokes,[stroke_id]:result};await save(next);return result
  })
 }
 return {mask,rub}
}
export function registerInkRoutes(app,{isAuthorized,vault}) {
 app.post('/api/ink/seal',async(req,res)=>{
  if(!isAuthorized(req))return res.status(401).end()
  try {res.json({value:await vault.mask(req.body?.value,{scope:req.body?.scope,reader:req.body?.reader})})} catch(e){res.status(e.status||503).json({error:e.status?e.message:'墨水尚未保存，本条未投递原文'})}
 })
 app.post('/api/ink/rub',async(req,res)=>{
  if(!isAuthorized(req))return res.status(401).end()
  try {res.json(await vault.rub(req.body||{},req.body?.reader))} catch(e){res.status(e.status||503).json({error:e.status?e.message:'本次擦拭未确认，请复用原 stroke_id 重试'})}
 })
}
export function createInkClient({baseUrl,token,fetchImpl=fetch,reader='agent'}) {
 async function request(route,body) {
  const r=await fetchImpl(baseUrl.replace(/\/$/,'')+route,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...body,reader}),redirect:'error',signal:AbortSignal.timeout(15000)})
  const data=await r.json();if(!r.ok)throw Object.assign(Error(data.error||'Ink service unavailable'),{status:r.status});return data
 }
 return {mask:async(value,{scope})=>hasInk(JSON.stringify(value))?(await request('/api/ink/seal',{value,scope})).value:value,rub:args=>request('/api/ink/rub',args)}
}
// Agent-facing queue reads are projections. Original records and phone archives
// remain intact; pre-sealing happens before a claim can auto-complete a ticket.
export function inkQueue(store,vault,{reader='agent'}={}) {
 const agentJob=job=>job?vault.mask(job,{scope:'queue:'+job.createdAt,reader}):job
 const warm=async()=>{for(const job of await store.listJobs())if(['pending','claimed','injection_started','injected'].includes(job.status))await agentJob(job)}
 return new Proxy(store,{get(target,key){
  if(key==='enqueue')return async(input={})=>{const prepared={...input,createdAt:input.createdAt||new Date().toISOString()};await vault.mask(prepared.content,{scope:'queue:'+prepared.createdAt,reader});return target.enqueue(prepared)}
  if(key==='agentJob')return agentJob
  if(key==='claimNext')return async options=>{await warm();const result=await target.claimNext(options);return {...result,job:await agentJob(result.job)}}
  if(key==='claimForChannel')return async options=>{await warm();const result=await target.claimForChannel(options);return {...result,jobs:await Promise.all((result.jobs||[]).map(agentJob))}}
  if(key==='listNotificationPending')return async()=>Promise.all((await target.listNotificationPending()).map(agentJob))
  const value=target[key];return typeof value==='function'?value.bind(target):value
 }})
}
// Keep an entire generated reference if a context length limit lands inside it.
export function inkSafeSlice(text, limit) {
 const value=String(text||'');if(value.length<=limit)return value
 const start=value.lastIndexOf('〔隐形墨水 ',limit)
 if(start>=0 && value.indexOf('〕',start)>=limit){const end=value.indexOf('〕',start);if(end>=0)return value.slice(0,end+1)}
 return value.slice(0,limit)
}
