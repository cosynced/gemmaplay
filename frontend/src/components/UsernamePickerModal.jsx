import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'
import {
  PIN_RE,
  USERNAME_RE,
  setSession,
} from '../utils/identity.js'
import { ErrorBanner } from './ErrorBanner.jsx'

/**
 * Two-tab modal:
 *   - Create account: picks a username, registers, returns {username, pin,
 *     session_token, expires_at} so the caller can open CredentialsModal.
 *   - Sign in: posts {username, pin}, stores session on success.
 *
 * Props:
 *   lessonId            - if the user is mid-claim, pass the lesson id and
 *                         we'll attach it to the new account server-side.
 *   initialTab          - 'create' | 'signin' (default 'create')
 *   onRegistered(data)  - called with {username, pin, session_token, expires_at}
 *   onSignedIn(data)    - called with {username, session_token, expires_at}
 *   onCancel            - optional; renders a "Skip for now" button.
 */
export function UsernamePickerModal({
  lessonId,
  initialTab = 'create',
  onRegistered,
  onSignedIn,
  onCancel,
}) {
  const [tab, setTab] = useState(initialTab)

  useEffect(() => {
    setTab(initialTab)
  }, [initialTab])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto"
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="w-full max-w-md my-auto rounded-2xl bg-slate-900/95 border border-slate-800 p-5 sm:p-8"
      >
        <div className="text-xs uppercase tracking-widest text-brand-500 font-semibold">
          Claim or return
        </div>
        <h2 className="mt-1 text-2xl sm:text-3xl font-bold">
          {tab === 'create' ? 'Create your account.' : 'Welcome back.'}
        </h2>

        <div className="mt-5 inline-flex w-full p-1 rounded-xl bg-slate-950/60 border border-slate-800">
          <TabPill active={tab === 'create'} onClick={() => setTab('create')}>
            Create account
          </TabPill>
          <TabPill active={tab === 'signin'} onClick={() => setTab('signin')}>
            Sign in
          </TabPill>
        </div>

        <AnimatePresence mode="wait">
          {tab === 'create' ? (
            <motion.div
              key="create"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <CreateForm
                lessonId={lessonId}
                onRegistered={onRegistered}
                onSwitchToSignIn={() => setTab('signin')}
                onCancel={onCancel}
              />
            </motion.div>
          ) : (
            <motion.div
              key="signin"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              <SignInForm
                onSignedIn={onSignedIn}
                onSwitchToCreate={() => setTab('create')}
                onCancel={onCancel}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Create-account form
// ---------------------------------------------------------------------------

function CreateForm({ lessonId, onRegistered, onSwitchToSignIn, onCancel }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [takenHint, setTakenHint] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  async function submit(e) {
    e?.preventDefault?.()
    setError(null)
    setTakenHint(false)
    const trimmed = name.trim()
    if (!USERNAME_RE.test(trimmed)) {
      setError(new Error('Use 2 to 24 letters, numbers, or underscore.'))
      return
    }
    setBusy(true)
    try {
      const result = await api.register(trimmed, lessonId || null)
      setSession({
        token: result.session_token,
        expiresAt: result.expires_at,
        username: result.username,
      })
      onRegistered(result)
    } catch (err) {
      logError(err, { where: 'register', username: trimmed })
      if (err?.status === 409) {
        setTakenHint(true)
        setError(new Error('That username is taken. Try sign in, or pick another.'))
      } else {
        setError(err)
      }
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <p className="text-sm text-slate-400">
        Pick a username. We'll give you a 6-digit PIN.
      </p>
      <label className="block mt-5 text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">
        Username
      </label>
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="your_handle"
        disabled={busy}
        className="w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 disabled:opacity-60"
      />
      <div className="mt-1 text-xs text-slate-500">
        2 to 24 chars · letters, numbers, underscore
      </div>

      {error && (
        <div className="mt-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
          {takenHint && (
            <button
              type="button"
              onClick={onSwitchToSignIn}
              className="mt-2 text-xs font-semibold text-brand-500 hover:text-brand-400"
            >
              Already yours? Sign in instead.
            </button>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        {onCancel && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            disabled={busy}
            className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm disabled:opacity-60"
          >
            Skip for now
          </motion.button>
        )}
        <motion.button
          type="submit"
          whileHover={!busy ? { scale: 1.03 } : undefined}
          whileTap={!busy ? { scale: 0.97 } : undefined}
          disabled={busy}
          className="flex-1 px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? 'Creating…' : 'Create account'}
        </motion.button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Sign-in form
// ---------------------------------------------------------------------------

function SignInForm({ onSignedIn, onSwitchToCreate, onCancel }) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [showForgot, setShowForgot] = useState(false)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const canSubmit = useMemo(
    () => USERNAME_RE.test(name.trim()) && PIN_RE.test(pin),
    [name, pin],
  )

  function handlePinChange(e) {
    const digits = (e.target.value || '').replace(/\D/g, '').slice(0, 6)
    setPin(digits)
  }

  async function submit(e) {
    e?.preventDefault?.()
    setError(null)
    if (!canSubmit) {
      setError(new Error('Enter a valid username and 6-digit PIN.'))
      return
    }
    setBusy(true)
    try {
      const result = await api.signIn(name.trim(), pin)
      setSession({
        token: result.session_token,
        expiresAt: result.expires_at,
        username: result.username,
      })
      onSignedIn(result)
    } catch (err) {
      logError(err, { where: 'signIn', username: name.trim() })
      if (err?.status === 401) {
        setError(new Error('Invalid username or PIN.'))
      } else {
        setError(err)
      }
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-5">
      <p className="text-sm text-slate-400">
        Enter the username and PIN you saved when you created your account.
      </p>

      <label className="block mt-5 text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">
        Username
      </label>
      <input
        ref={inputRef}
        type="text"
        autoComplete="username"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="your_handle"
        disabled={busy}
        className="w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 disabled:opacity-60"
      />

      <label className="block mt-4 text-xs uppercase tracking-wider text-slate-500 font-medium mb-2">
        Login PIN
      </label>
      <input
        type="text"
        inputMode="numeric"
        pattern="\d{6}"
        maxLength={6}
        autoComplete="one-time-code"
        value={pin}
        onChange={handlePinChange}
        placeholder="6 digits"
        disabled={busy}
        className="w-full px-4 py-3 rounded-xl bg-slate-950/60 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-brand-500 disabled:opacity-60 font-mono text-lg tracking-[0.35em] text-center"
      />

      {error && (
        <div className="mt-4">
          <ErrorBanner error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowForgot((s) => !s)}
          className="text-xs font-semibold text-slate-400 hover:text-slate-200"
        >
          Forgot credentials?
        </button>
        <AnimatePresence>
          {showForgot && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="mt-2 p-3 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 space-y-2"
            >
              <div>
                We don't store any recovery info. Create a new account to
                continue.
              </div>
              <button
                type="button"
                onClick={onSwitchToCreate}
                className="inline-flex px-3 py-1.5 rounded-lg bg-brand-500 hover:bg-brand-600 text-white text-xs font-semibold"
              >
                Create account
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        {onCancel && (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            disabled={busy}
            className="px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-sm disabled:opacity-60"
          >
            Cancel
          </motion.button>
        )}
        <motion.button
          type="submit"
          whileHover={!busy ? { scale: 1.03 } : undefined}
          whileTap={!busy ? { scale: 0.97 } : undefined}
          disabled={busy}
          className="flex-1 px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold text-sm shadow-lg shadow-brand-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </motion.button>
      </div>
    </form>
  )
}

function TabPill({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors ${
        active
          ? 'bg-brand-500 text-white shadow shadow-brand-500/30'
          : 'text-slate-400 hover:text-slate-100'
      }`}
    >
      {children}
    </button>
  )
}
