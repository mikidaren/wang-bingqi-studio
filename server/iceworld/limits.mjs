const MINUTE = 60_000

/** Counters are process-local on Node and isolate-local on Pages. */
export function createLimiter(config) {
  const clients = new Map()
  let windowStart = Date.now()
  let total = 0
  let active = 0
  return {
    enter(address) {
      const now = Date.now()
      if (now - windowStart >= MINUTE) { clients.clear(); total = 0; windowStart = now }
      const count = clients.get(address) || 0
      if (active >= config.concurrency || count >= config.perClientLimit || total >= config.globalLimit) return false
      clients.set(address, count + 1)
      total++
      active++
      return true
    },
    leave() { active-- },
  }
}
