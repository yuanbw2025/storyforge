import { useEffect, useState, type RefObject } from 'react'

export function useLocationTreeSize(containerRef: RefObject<HTMLDivElement | null>) {
  const [svgSize, setSvgSize] = useState({ width: 700, height: 400 })

  useEffect(() => {
    if (!containerRef.current) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width
      if (w) setSvgSize({ width: Math.floor(w), height: Math.max(350, Math.floor(w * 0.55)) })
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [containerRef])
  return svgSize
}
