import { afterEach, beforeEach, vi } from 'vitest'
import { cleanup } from '@solidjs/testing-library'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element) {
      this.callback([{ target, contentRect: { width: 960, height: 640 } } as ResizeObserverEntry], this as unknown as ResizeObserver)
    }
    disconnect() {}
    unobserve() {}
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})
