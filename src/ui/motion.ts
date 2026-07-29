// One answer to "should this move?", for the JS that has to branch on it
// (the CSS side is in theme.css). Two sources, OR'd: the OS preference, and
// the app's own "reduce motion" display preference, which App writes onto the
// document root so components can read it without threading a prop through
// every layer.

export const REDUCE_MOTION_ATTR = 'data-reduce-motion'

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (document.documentElement.getAttribute(REDUCE_MOTION_ATTR) === 'on') return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
