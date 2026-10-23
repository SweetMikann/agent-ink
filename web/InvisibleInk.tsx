import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import './InvisibleInk.css'

type Glyph = { x: number; y: number; width: number; height: number }

const onScreen = new WeakSet<Element>()
const hooks = new WeakMap<Element, { paint: (now: number) => void; measure: () => void; show: (on: boolean) => void }>()
const active = new Map<(now: number) => void, Element>()
let loop = 0

function pump() {
  if (loop || !active.size) return
  const tick = (now: number) => {
    if (!active.size) { loop = 0; return }
    loop = requestAnimationFrame(tick)
    for (const p of active.keys()) p(now)
  }
  loop = requestAnimationFrame(tick)
}

const visibility = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(
  entries => {
    for (const e of entries) {
      const h = hooks.get(e.target)
      if (e.isIntersecting) {
        onScreen.add(e.target)
        if (h) { h.measure(); active.set(h.paint, e.target); h.show(true) }
      } else {
        onScreen.delete(e.target)
        if (h) { active.delete(h.paint); h.show(false) }
      }
    }
    pump()
  },
  /* 上下各放一屏的余量，滚动过去的时候已经在淡入了，不会看见「突然冒出来」 */
  { rootMargin: '100% 0px' },
)

/** 隐形墨水气泡。children 里包在 <span class="ink-secret"> 的字会被盖成一团沙，手指划过散开，五秒后自动盖回。
 *  all=true 时整条都盖。dustColor 是沙粒颜色，跟着你的气泡底色调。 */
export function InvisibleInk({ children, all = false, dustColor = '#d9e8e7' }: { children: ReactNode; all?: boolean; dustColor?: string }) {
  let cleanupExtra: (() => void) | null = null
  const text = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const glyphs = useRef<Glyph[]>([])
  const revealed = useRef(new Map<number, number>())
  /* 哪些字是「正被镜子照着」——这些不走五秒自动盖回的计时，镜子挪开才灭 */
  const keyboardIndex = useRef(0)
  const dustRef = useRef(dustColor)
  dustRef.current = dustColor

  useEffect(() => {
    const el = text.current!, surface = canvas.current!, ctx = surface.getContext('2d')!
    let last = 0, width = 0, height = 0
    /* 竖线外、不该盖的字：按行合并成几块常亮矩形 */
    let open: Glyph[] = []
    let dots: { x: number; y: number; r: number; phase: number; glyph: number }[] = []
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const measure = () => {
      const box = el.getBoundingClientRect(), dpr = Math.min(devicePixelRatio || 1, 2)
      width = box.width; height = box.height
      surface.width = Math.ceil(width * dpr); surface.height = Math.ceil(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      dots = []; glyphs.current = []
      let seed = 317
      const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
      open = []; idleSince = 0
      const hasSecrets = !all && !!el.querySelector('.ink-secret')
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node: Node | null
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      /* 先按整条消息的面积估一下会撒出多少点，超过 BUDGET 就整体按比例稀释 */
      const BUDGET = 420
      const thinner = Math.min(1, BUDGET / Math.max(1, width * height * .14 * .55))
      while ((node = walker.nextNode())) {
        for (const { segment, index } of segmenter.segment(node.textContent || '')) {
          if (!segment.trim()) continue
          const range = document.createRange()
          range.setStart(node, index); range.setEnd(node, index + segment.length)
          const r = range.getBoundingClientRect()
          if (!r.width || !r.height) continue
          if (hasSecrets && !node.parentElement?.closest('.ink-secret')) {
            const x = r.left - box.left, y = r.top - box.top, prev = open[open.length - 1]
            if (prev && Math.abs(prev.y - y) < 2 && x - (prev.x + prev.width) < 8) { prev.width = x + r.width - prev.x; prev.height = Math.max(prev.height, r.height) }
            else open.push({ x, y, width: r.width, height: r.height })
            continue
          }
          const glyph = glyphs.current.length
          glyphs.current.push({ x: r.left - box.left, y: r.top - box.top, width: r.width, height: r.height })
                    for (let i = 0; i < Math.ceil(r.width * r.height * .14 * thinner); i++) {
            dots.push({ x: r.left - box.left + rand() * r.width, y: r.top - box.top + 3 + rand() * Math.max(1, r.height - 6), r: .25 + Math.pow(rand(), 2) * .85, phase: rand() * Math.PI * 2, glyph })
          }
        }
      }
    }
        let measured = false
    const measureIfNeeded = () => { if (!measured) { measured = true; measure() } }
    const observer = new ResizeObserver(() => { if (measured) measure() })
    observer.observe(el)
    let idleSince = 0, fade = 0
    const draw = (now: number) => {
      if (now - last < 32) return
      /* 屏幕外的消息一笔都不画。没有 IntersectionObserver 的环境（老 WebView）退回原样全画。 */
      if (visibility && !onScreen.has(el)) {
        /* 滑出去就把画布擦干净、透明度归零，下次进来重新淡入。
           遮罩保持「全遮」——字本来就看不见，不画尘埃也不会漏出来。 */
        if (fade !== 0) { fade = 0; ctx.clearRect(0, 0, width, height) }
        last = now; return
      }
      measureIfNeeded()
      /* 进屏不是啪一下全有，是 400ms 淡进来 */
      if (fade < 1) fade = Math.min(1, fade + (now - last) / 400)
      last = now
      for (const [index, started] of revealed.current) {
        if (now - started >= 6000) revealed.current.delete(index)
      }
      const ease = (value: number) => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t) }
      const amounts = glyphs.current.map((_, index) => {
        const started = revealed.current.get(index)
        if (started === undefined) return 0
        const elapsed = now - started
        return ease(elapsed / 280) * (1 - ease((elapsed - 5000) / 1000))
      })
      let active = glyphs.current.map((g, index) => ({ ...g, alpha: amounts[index], i: index })).filter(g => g.alpha > 0)
            const CAP = 48
      if (active.length > CAP) active = active.slice(0, CAP)
                  const circle = null as { x: number; y: number; radius: number } | null
      if (!active.length && !circle) {
        if (idleSince !== 1) { idleSince = 1
          if (open.length) {
            const image = open.map(() => 'linear-gradient(#000,#000)').join(','), size = open.map(g => `${g.width}px ${g.height}px`).join(','), position = open.map(g => `${g.x}px ${g.y}px`).join(',')
            el.style.maskImage = image; el.style.webkitMaskImage = image
            el.style.maskSize = size; el.style.webkitMaskSize = size
            el.style.maskPosition = position; el.style.webkitMaskPosition = position
            el.style.maskRepeat = 'no-repeat'; el.style.webkitMaskRepeat = 'no-repeat'
          } else {
            el.style.maskImage = 'linear-gradient(transparent,transparent)'
            el.style.webkitMaskImage = 'linear-gradient(transparent,transparent)'
          }
        }
      } else { idleSince = 0 }
      if (active.length || circle) {
      // Independent rectangular masks prevent adjacent letters or lines from leaking.
      const images = [...open.map(() => 'linear-gradient(#000,#000)'), ...active.map(g => `linear-gradient(rgba(0,0,0,${g.alpha}),rgba(0,0,0,${g.alpha}))`)]
      const sizes = [...open, ...active].map(g => `${g.width}px ${g.height}px`)
      const positions = [...open, ...active].map(g => `${g.x}px ${g.y}px`)
      if (circle) {
        images.push(`radial-gradient(circle at ${circle.x}px ${circle.y}px,#000 ${circle.radius - 1}px,transparent ${circle.radius}px)`)
        sizes.push('100% 100%'); positions.push('0 0')
      }
      const image = images.join(','), size = sizes.join(','), position = positions.join(',')
      el.style.maskImage = image; el.style.webkitMaskImage = image
      el.style.maskSize = size; el.style.webkitMaskSize = size
      el.style.maskPosition = position; el.style.webkitMaskPosition = position
      el.style.maskRepeat = 'no-repeat'; el.style.webkitMaskRepeat = 'no-repeat'
      }
      ctx.clearRect(0, 0, width, height)
      for (const d of dots) {
        const reveal = amounts[d.glyph]
        if (reveal >= 1) continue
        const g = glyphs.current[d.glyph]
        // Keep each moving grain inside its own character so revealed text stays clear.
        const speed = media.matches ? .45 : 1
        const time = now * .001 * speed
        const dx = Math.sin(time * 1.8 + d.phase) * 2.8 + Math.cos(time * 1.3 + d.phase * 2) * 1.2
        const dy = Math.cos(time * 1.6 + d.phase) * (2 + reveal * 2)
        const wrap = (value: number, span: number) => ((value % span) + span) % span
        const x = g.x + wrap(d.x - g.x + dx, g.width)
        const y = g.y + 2 + wrap(d.y - g.y - 2 + dy, Math.max(1, g.height - 4))
        const lensOpacity = circle ? Math.max(0, Math.min(1, Math.hypot(x - circle.x, y - circle.y) - circle.radius + 1)) : 1
        ctx.globalAlpha = lensOpacity * (.18 + .62 * (.5 + .5 * Math.sin(d.phase + time * 2.8))) * (1 - reveal) * fade
        ctx.fillStyle = dustRef.current; ctx.beginPath()
        ctx.arc(x, y, d.r, 0, Math.PI * 2); ctx.fill()
      }
      ctx.globalAlpha = 1
    }
        const showDust = (on: boolean) => { surface.hidden = !on }
    showDust(false)
    hooks.set(el, { paint: draw, measure: measureIfNeeded, show: showDust })
    if (visibility) visibility.observe(el)
    else { measureIfNeeded(); active.set(draw, el); showDust(true); pump() }
        const mo = new MutationObserver(() => { measured = false; if (!visibility || onScreen.has(el)) measureIfNeeded() })
    mo.observe(el, { childList: true, characterData: true, subtree: true })
    cleanupExtra = () => mo.disconnect()
    return () => {
      active.delete(draw); hooks.delete(el)
      observer.disconnect(); visibility?.unobserve(el); cleanupExtra?.()
      if (!active.size && loop) { cancelAnimationFrame(loop); loop = 0 }
    }
  }, [])

  const toggle = (index: number) => {
    if (index < 0 || index >= glyphs.current.length) return
    if (revealed.current.has(index)) revealed.current.delete(index)
    else revealed.current.set(index, performance.now())
  }
    const wipe = (clientX: number, clientY: number, sticky: boolean) => {
    const r = text.current?.getBoundingClientRect(); if (!r) return
    const x = clientX - r.left, y = clientY - r.top
    /* 指尖比一个字宽，给一点容差，划过去才跟得上手，不用精确戳中 */
    const pad = 4
    for (let i = 0; i < glyphs.current.length; i++) {
      const g = glyphs.current[i]
      if (x < g.x - pad || x > g.x + g.width + pad || y < g.y - pad || y > g.y + g.height + pad) continue
      if (sticky) { if (!revealed.current.has(i)) revealed.current.set(i, performance.now()) }
      else toggle(i)
    }
  }
  return <div className="invisible-ink" role="button" tabIndex={0}
    aria-label="隐形墨水消息，手指划过即散开，五秒后自动重新遮住；左右方向键选字，空格切换，Escape 全部隐藏"
    onPointerDown={e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.stopPropagation()
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
      wipe(e.clientX, e.clientY, true)
    }}
    onPointerMove={e => {
      /* buttons 为 0 就是手指没按着（鼠标悬停也不算），不散 */
      if (!e.buttons) return
      e.stopPropagation()
      wipe(e.clientX, e.clientY, true)
    }}
    onClickCapture={e => { e.preventDefault(); e.stopPropagation() }}
    onKeyDown={e => {
      if (!['ArrowLeft', 'ArrowRight', 'Enter', ' ', 'Escape'].includes(e.key)) return
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'Escape') revealed.current.clear()
      else if (e.key === 'ArrowLeft') keyboardIndex.current = Math.max(0, keyboardIndex.current - 1)
      else if (e.key === 'ArrowRight') keyboardIndex.current = Math.min(glyphs.current.length - 1, keyboardIndex.current + 1)
      else toggle(keyboardIndex.current)
    }}>
    <div ref={text} className="invisible-ink-text">{children}</div>
    <canvas ref={canvas} className="invisible-ink-dust" aria-hidden="true" />
  </div>
}
