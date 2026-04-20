// Thin error logger. Today it's just structured console.error so devs can
// see *what* broke and *where* without spelunking. Wire to Sentry / Firebase
// Crashlytics later by hooking logError() — the rest of the app already
// calls through here.
//
// TODO: replace the console sink with Sentry.captureException once we
// pick a vendor.

export function logError(err, context = {}) {
  const payload = {
    name: err?.name || 'Error',
    message: err?.message || String(err),
    status: err?.status,
    apiBody: err?.apiBody,
    stack: err?.stack,
    ...context,
    at: new Date().toISOString(),
  }
  // eslint-disable-next-line no-console
  console.error('[gemmaplay]', payload)
}

/**
 * Serialize an error so the user can copy-paste it back to support.
 * Includes status, URL, raw body when available.
 */
export function describeErrorForClipboard(err, extra = {}) {
  const parts = [
    `name: ${err?.name || 'Error'}`,
    `message: ${err?.message || String(err)}`,
  ]
  if (err?.status != null) parts.push(`status: ${err.status}`)
  if (err?.url) parts.push(`url: ${err.url}`)
  if (err?.apiBody) {
    const body = typeof err.apiBody === 'string'
      ? err.apiBody
      : JSON.stringify(err.apiBody, null, 2)
    parts.push(`body:\n${body}`)
  }
  if (extra && Object.keys(extra).length) {
    parts.push(`context: ${JSON.stringify(extra, null, 2)}`)
  }
  parts.push(`at: ${new Date().toISOString()}`)
  return parts.join('\n')
}
