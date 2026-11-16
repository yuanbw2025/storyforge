import { useCallback, useState } from 'react'

export function useLocationTreeSize() {
  const [svgSize, setSvgSize] = useState({ width: 700, height: 400 })
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width
      if (width) setSvgSize({ width: Math.floor(width), height: Math.max(350, Math.floor(width * 0.55)) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return { containerRef, svgSize }
}
