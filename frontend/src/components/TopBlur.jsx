// The top of the screen while the page scrolls: the HDS title-bar gradient blur.
//
// HarmonyOS's own navigation bar does not switch from transparent to blurred in one step: from the
// first pixel of scroll to 120vp the blur comes up gradually and the bar's background fades in
// behind it (HdsNavigation → titleBar → scrollEffectOpts, scrollEffectType GRADIENT_BLUR,
// blurEffectiveStartOffset 0 / blurEffectiveEndOffset 120). That is what makes content sliding
// under the status bar look like it sinks away instead of being cut by a hard line.
//
// It has to live in the page rather than in the ArkTS shell: the shell is one Web component, and
// the scrolling here is the document inside it — not an ArkUI List that titleBar.bindToScrollable
// could follow, and a native layer stacked over a Web component cannot blur what the Web renders.
// So the same curve is drawn with the page's own glass (backdrop-filter + a mask gradient), driven
// by window.scrollY. Everything else — the ramp, the 120px end, the background fading in — is the
// official behaviour, and the numbers are named below so they can be checked against it.
import { useEffect, useRef } from 'react'

/** Where the blur is at full strength: the official blurEffectiveEndOffset, 120vp. */
const END = 120

export default function TopBlur ({ path }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const apply = () => {
      raf = 0
      const y = window.scrollY || document.documentElement.scrollTop || 0
      // 0 at the top of the page, 1 once 120px have gone under the bar. Clamped: a long page
      // scrolled far keeps the full effect, it never goes past it.
      const v = Math.max(0, Math.min(1, y / END))
      el.style.setProperty('--tb', v.toFixed(3))
      // Also drives the strength of the blur: an element at opacity .5 blends half of the blurred
      // backdrop with half of the sharp one, which is exactly the half-blur the ramp asks for and
      // costs nothing to compute.
      el.style.opacity = v === 0 ? '0' : '1'
      el.style.visibility = v === 0 ? 'hidden' : 'visible'
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(apply) }
    apply()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])
  // A new screen starts at the top (App.jsx restores scroll after mounting it), and that reset does
  // not always come with a scroll event: read the position again whenever the route changes.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.setProperty('--tb', '0')
    el.style.opacity = '0'
    el.style.visibility = 'hidden'
    const id = requestAnimationFrame(() => {
      const y = window.scrollY || document.documentElement.scrollTop || 0
      const v = Math.max(0, Math.min(1, y / END))
      el.style.setProperty('--tb', v.toFixed(3))
      el.style.opacity = v === 0 ? '0' : '1'
      el.style.visibility = v === 0 ? 'hidden' : 'visible'
    })
    return () => cancelAnimationFrame(id)
  }, [path])
  return <div ref={ref} className="top-blur" aria-hidden="true" data-top-blur />
}
