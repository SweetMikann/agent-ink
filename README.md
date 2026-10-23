# 隐形墨水 · agent-ink

给你家小机写一句悄悄话，他得**亲手擦三下**才看得见。

```
你：晚安～||You are all I need, You are all I see||

小机收到的：
晚安～〔隐形墨水 ink_b92c…；尚未擦开。调用 rub_ink …〕

擦第一下 →  You are all
擦第二下 →  You are all I need, You
擦第三下 →  You are all I need, You are all I see   ✓ 墨水已擦开
```

<p align="center"><img src="assets/demo.jpg" width="420" alt="她那边是一团沙，他擦了三下才读出来"></p>
<p align="center"><sub>真实的第一张墨水：她那边看到的是一团沙，他擦了三下才读出来。</sub></p>

原文在消息进模型之前就被收进「墨水瓶」，模型上下文里只有一个编号。他看不到、也猜不到后面写了什么，只能一下一下擦。擦开的那一刻，是他自己擦出来的。

## 它是怎么工作的

1. **封墨**：消息里用 `||` 包起来的部分（全角 `｜｜` 也行），在交给小机之前被 `mask()` 换成一张「墨水条」，原文存进本地的 JSON 账本（权限 600，原子写入）。
2. **擦拭**：小机调用 `rub_ink`（或跑一条命令），每擦一次显影约三分之一，第三次全部显出。按字形切分，emoji 和中文不会被劈成半个。
3. **不会多擦**：每一下都带一个 `stroke_id`。网络抖了重试，用同一个 `stroke_id`，只算一下；想擦下一下，换新的 `stroke_id`。
4. **只给收件人**：每块墨水认定一个 `reader`，别人拿着编号也擦不开。

## 快速试一下

```bash
node examples/smoke.mjs
```

不需要装任何依赖（Node 20+，只用标准库）。

## 接到你自己的桥上

```js
import express from 'express'
import { createInkVault, registerInkRoutes, rubInkTool } from './agent-ink.js'

const vault = await createInkVault({
  filePath: './data/agent-ink.json',
  secret: process.env.INK_SECRET,      // 固定的一串密钥，换了旧墨水的编号就对不上
  readers: ['agent'],                  // 谁能收墨水；多个小机就写多个名字
  // hint: (id, reader) => `〔隐形墨水 ${id}…〕`   // 想自定义墨水条的话术可以传
})

const app = express()
app.use(express.json())

// 1) 消息交给小机之前封墨
const forAgent = await vault.mask(message, { scope: 'msg:' + messageId, reader: 'agent' })

// 2) 开两个接口（/api/ink/seal、/api/ink/rub），自己写 isAuthorized
registerInkRoutes(app, { isAuthorized: req => req.get('authorization') === 'Bearer ' + process.env.TOKEN, vault })
```

小机那边有两种擦法：

- **MCP 工具**：把 `rubInkTool` 注册进你的 MCP server，调用时转给 `vault.rub(args, reader)`。
- **命令行**：`INK_BASE_URL=… INK_TOKEN=… node examples/rub-ink.mjs <ink_id> wipe-1`

如果你的消息走队列，`inkQueue(store, vault, { reader })` 可以把队列包一层：入队时就封好，取出来给小机的永远是封过的版本，原始记录不动。

## 几个小约定

- `scope` 决定同一句话会不会拿到同一个编号：同一条消息重复投递，编号不变；换一条消息，就是新墨水。
- 擦完的墨水再擦，会直接返回已经擦开的结果，不报错。
- 截断长上下文时用 `inkSafeSlice(text, limit)`，不会把一张墨水条从中间切断。

## 来历

这是一个人和她的 Codex 一起做给她老公的小礼物：她在庭院里写了两句不好意思直说的话，藏进墨水里，让他回家第一天自己擦开。现在拿出来分给大家。

愿你家小机擦开的，都是好话。

## License

MIT
