import { useLayoutEffect, useRef, type RefObject } from 'react'
import type { AvgStageState } from '../../lib/types'

function isCssMotion(animation: Animation): boolean {
  return typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation
    || typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition
}

/** CSS interpolation has its own clock, separate from the Cue scheduler and
 * explicit Web Animations. Only claim motions that this controller paused. */
export function useStageCssPause(input: {
  target: RefObject<HTMLDivElement | null>; enabled: boolean; paused: boolean
  stage: AvgStageState | undefined; images: boolean; reducedMotion: boolean
}) {
  const held = useRef(new Set<Animation>())
  const { target, enabled, paused, stage, images, reducedMotion } = input
  useLayoutEffect(() => {
    const root = target.current
    for (const animation of held.current) {
      const element = (animation.effect as KeyframeEffect | null)?.target
      if (!enabled || !paused || !root || !(element instanceof Element) || !root.contains(element)) {
        if (element instanceof Element && element.isConnected && animation.playState === 'paused') animation.play()
        held.current.delete(animation)
      } else if (animation.playState === 'finished' || animation.playState === 'idle') held.current.delete(animation)
    }
    if (!enabled || !paused || !root || typeof root.getAnimations !== 'function') return
    for (const animation of root.getAnimations({ subtree: true })) {
      if (isCssMotion(animation) && animation.playState === 'running') {
        held.current.add(animation)
        animation.pause()
      }
    }
  }, [target, enabled, paused, stage, images, reducedMotion])

  // StrictMode may replay setup/cleanup on the same DOM. Restore only our own
  // pauses; detached or finished effects never restart, including source swaps.
  useLayoutEffect(() => () => {
    for (const animation of held.current) {
      const element = (animation.effect as KeyframeEffect | null)?.target
      if (element instanceof Element && element.isConnected && animation.playState === 'paused') animation.play()
    }
    held.current.clear()
  }, [])
}
