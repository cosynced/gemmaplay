import { useState } from 'react'
import { motion } from 'framer-motion'
import { describeErrorForClipboard } from '../utils/errorLogger.js'

function AlertTriangle(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

function XIcon(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function rawDetailFor(err) {
  if (!err) return ''
  const body = err.apiBody
  if (body == null) return ''
  if (typeof body === 'string') return body.slice(0, 400)
  try {
    return JSON.stringify(body).slice(0, 400)
  } catch { return '' }
}

/**
 * Red-accented error banner that shows a user-friendly message, the raw
 * backend detail beneath it, and a "Copy details" button so the user can
 * paste the full context (status, URL, body) back to us for debugging.
 */
export function ErrorBanner({ error, onDismiss, className = '' }) {
  const [copied, setCopied] = useState(false)
  if (!error) return null

  const primary = error.message || 'Something went wrong.'
  const secondary = rawDetailFor(error)
  const status = error.status

  async function copyDetails() {
    try {
      await navigator.clipboard.writeText(describeErrorForClipboard(error))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — silently fail */
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      role="alert"
      className={`flex items-start gap-3 p-3 sm:p-4 rounded-xl bg-red-500/10 border border-red-500/40 text-red-200 ${className}`}
    >
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-red-300" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-red-100 break-words">
          {primary}
        </div>
        {(secondary || status != null) && (
          <div className="mt-1 text-xs text-red-300/80 font-mono break-all">
            {status != null ? `HTTP ${status}` : null}
            {status != null && secondary ? ' · ' : ''}
            {secondary}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={copyDetails}
            className="px-2.5 py-1 rounded-md text-xs font-semibold bg-red-500/20 hover:bg-red-500/30 text-red-100"
          >
            {copied ? 'Copied!' : 'Copy details'}
          </button>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="px-2.5 py-1 rounded-md text-xs font-semibold text-red-200 hover:bg-red-500/10"
            >
              Dismiss
            </button>
          )}
        </div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="p-1 rounded-md text-red-300 hover:text-red-100 hover:bg-red-500/10 shrink-0"
        >
          <XIcon className="w-4 h-4" />
        </button>
      )}
    </motion.div>
  )
}
