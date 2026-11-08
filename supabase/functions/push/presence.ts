/* Apple Web Push always receives a visible notification. Unknown/missing lease = deliver. */
export function suppressForViewing(viewing: unknown, endpoint?: string): boolean {
  if (viewing !== true) return false;
  if (endpoint !== undefined) {
    try {
      const host = new URL(endpoint).hostname.toLowerCase();
      if (host === 'push.apple.com' || host.endsWith('.push.apple.com')) return false;
    } catch { return false; }
  }
  return true;
}
