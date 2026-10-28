/**
 * Developer tools (Debug tab, behavior check panel, technical details) are shown in the dev
 * server only. A production build hides them; opening it with ?debug, ?test or ?replay turns
 * them on for testing on a phone, and the replay harness relies on that.
 */
export function devToolsEnabled(): boolean {
  if (import.meta.env.DEV) return true
  const params = new URLSearchParams(window.location.search)
  return params.has('debug') || params.has('test') || params.has('replay') || params.has('ui')
}
