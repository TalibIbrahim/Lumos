export interface Throttle<T extends unknown[]> {
  /** Runs now if the interval has passed, otherwise once when it has, with the latest arguments. */
  call: (...args: T) => void
  /** Runs any waiting call now. */
  flush: () => void
  /** Drops any waiting call. */
  cancel: () => void
}

/**
 * Leading and trailing throttle: while values keep coming, fn runs at most once per
 * interval, and the last value is always delivered. Used for drags, so the bulb follows
 * the pointer instead of waiting for it to stop.
 */
export function createThrottle<T extends unknown[]>(intervalMs: number, fn: (...args: T) => void): Throttle<T> {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: T | null = null
  const run = (): void => {
    timer = null
    if (!pending) return
    const args = pending
    pending = null
    last = performance.now()
    fn(...args)
  }
  return {
    call: (...args: T) => {
      pending = args
      const wait = intervalMs - (performance.now() - last)
      if (wait <= 0) {
        if (timer) clearTimeout(timer)
        run()
      } else if (!timer) {
        timer = setTimeout(run, wait)
      }
    },
    flush: () => {
      if (timer) clearTimeout(timer)
      run()
    },
    cancel: () => {
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
    }
  }
}
