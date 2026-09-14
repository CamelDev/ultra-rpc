const activeRequests = new Map<string, AbortController>()

/**
 * Register a new active request ID and return its AbortController.
 * If a request with the same ID is already registered, it is aborted first.
 */
export function registerActiveRequest(requestId: string): AbortController {
  const existing = activeRequests.get(requestId)
  if (existing) {
    try {
      existing.abort()
    } catch {
      // ignore abort errors on previous controller
    }
  }
  const controller = new AbortController()
  activeRequests.set(requestId, controller)
  return controller
}

/**
 * Unregister an active request ID if the controller matches.
 */
export function unregisterActiveRequest(requestId: string, controller?: AbortController) {
  const current = activeRequests.get(requestId)
  if (!controller || current === controller) {
    activeRequests.delete(requestId)
  }
}

/**
 * Cancel an active request by ID.
 * Returns true if an active request was found and aborted, false otherwise.
 */
export function cancelActiveRequest(requestId: string): boolean {
  const controller = activeRequests.get(requestId)
  if (controller) {
    try {
      controller.abort()
    } catch {
      // ignore abort errors
    }
    activeRequests.delete(requestId)
    return true
  }
  return false
}

/**
 * Check if a request ID is currently active.
 */
export function isRequestActive(requestId: string): boolean {
  return activeRequests.has(requestId)
}
