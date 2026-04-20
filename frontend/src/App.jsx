import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Route, Switch, useLocation, Redirect } from 'wouter'
import { api } from './api/client.js'
import { UploadView } from './components/UploadView.jsx'
import { GamePicker } from './components/GamePicker.jsx'
import { GamePreview } from './components/GamePreview.jsx'
import { GameView } from './components/GameView.jsx'
import { TeacherDashboard } from './components/TeacherDashboard.jsx'
import { LandingPage } from './components/LandingPage.jsx'
import { UsernamePickerModal } from './components/UsernamePickerModal.jsx'
import { CredentialsModal } from './components/CredentialsModal.jsx'
import { StudentJoinView } from './components/StudentJoinView.jsx'
import { StudentGamePicker } from './components/StudentGamePicker.jsx'
import { ShareLink } from './components/ShareLink.jsx'
import { ResultView } from './components/ResultView.jsx'
import { ErrorBanner } from './components/ErrorBanner.jsx'
import { NavigationConfirmModal } from './components/NavigationConfirmModal.jsx'
import { logError } from './utils/errorLogger.js'
import {
  clearSession,
  getSessionToken,
  getStudentName,
  getTeacherUsername,
  isSessionValid,
} from './utils/identity.js'

// ---------- Navigation guard context ----------
//
// Any screen that has unsaved in-memory state (currently: GameView) can
// install a guard. Callers that want to honor it use `useGuardedNav` to
// wrap wouter's setLocation. If a guard is installed, the guard decides
// whether to allow the nav (by calling proceed()) or block it.

const NavGuardCtx = createContext({
  setGuard: () => {},
  clearGuard: () => {},
})

export function useNavGuardApi() {
  return useContext(NavGuardCtx)
}

export function useGuardedNav() {
  const [, setLocation] = useLocation()
  const { getGuard } = useContext(NavGuardCtx)
  return useCallback((to) => {
    const guard = getGuard?.()
    if (guard) guard(to, () => setLocation(to))
    else setLocation(to)
  }, [getGuard, setLocation])
}

// ---------- Tiny shared helpers ----------

function useAuth() {
  // Cheap synchronous snapshot of the session. Re-computed on every render
  // that calls this hook; callers can bump `authVersion` to force a refresh
  // after register/signin via the context below.
  const [version, setVersion] = useState(0)
  const teacher = isSessionValid() ? getTeacherUsername() : null
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  // `version` is read so React re-renders when it changes.
  useMemo(() => version, [version])
  return { teacher, refresh }
}

function Loading({ children }) {
  return (
    <div className="w-full px-4 sm:px-6 md:px-10 py-16 sm:py-20 text-center text-slate-400 text-sm">
      {children || 'Loading…'}
    </div>
  )
}

function LoadError({ error, onDismiss }) {
  return (
    <div className="w-full px-4 sm:px-6 md:px-10 py-10 sm:py-16">
      <div className="max-w-xl mx-auto">
        <ErrorBanner error={error} onDismiss={onDismiss} />
      </div>
    </div>
  )
}

// Scroll to top on every route change. Wouter doesn't do this natively.
function ScrollToTop() {
  const [location] = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' })
  }, [location])
  return null
}

// ---------- Root ----------

export default function App() {
  const [location] = useLocation()
  const { teacher, refresh: refreshAuth } = useAuth()
  const [credentials, setCredentials] = useState(null)
  const [authTab, setAuthTab] = useState(null) // 'create' | 'signin' | null

  // Navigation guard — only one installed at a time (GameView).
  const guardRef = useRef(null)
  const navGuardApi = useMemo(() => ({
    setGuard: (fn) => { guardRef.current = fn },
    clearGuard: () => { guardRef.current = null },
    getGuard: () => guardRef.current,
  }), [])

  // Session-expired housekeeping on mount.
  useEffect(() => {
    if (getSessionToken() && !isSessionValid()) {
      clearSession()
      refreshAuth()
    }
  }, [refreshAuth])

  const isLanding = location === '/'

  return (
    <NavGuardCtx.Provider value={navGuardApi}>
      <ScrollToTop />
      {isLanding ? (
        <LandingRoute
          teacher={teacher}
          onSignInClick={() => setAuthTab('signin')}
          refreshAuth={refreshAuth}
        />
      ) : (
        <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
          <AppHeader
            teacher={teacher}
            onSignIn={() => setAuthTab('signin')}
            refreshAuth={refreshAuth}
          />
          <main className="relative">
            <Switch>
              <Route path="/upload" component={UploadRoute} />
              <Route path="/claim/:lessonId">
                {(params) => (
                  <ClaimRoute
                    lessonId={params.lessonId}
                    onRegistered={(result) => setCredentials({
                      username: result.username,
                      pin: result.pin,
                    })}
                    onSignedIn={refreshAuth}
                  />
                )}
              </Route>
              <Route path="/picker/:lessonId">
                {(params) => <PickerRoute lessonId={params.lessonId} />}
              </Route>
              <Route path="/preview/:lessonId/:gameId">
                {(params) => (
                  <PreviewRoute lessonId={params.lessonId} gameId={params.gameId} />
                )}
              </Route>
              <Route path="/play/:lessonId/:gameId">
                {(params) => (
                  <PlayRoute lessonId={params.lessonId} gameId={params.gameId} />
                )}
              </Route>
              <Route path="/play/:lessonId">
                {(params) => <StudentFlowRoute lessonId={params.lessonId} />}
              </Route>
              <Route path="/result/:lessonId/:gameId">
                {(params) => (
                  <ResultRoute lessonId={params.lessonId} gameId={params.gameId} />
                )}
              </Route>
              <Route path="/dashboard">
                <DashboardRoute
                  teacher={teacher}
                  onRequestSignIn={() => setAuthTab('signin')}
                  refreshAuth={refreshAuth}
                />
              </Route>
              <Route><Redirect to="/" /></Route>
            </Switch>
          </main>
          <footer className="mt-16 py-8 text-center text-xs text-slate-500 border-t border-slate-800">
            Built on Gemma&nbsp;4 · Any lesson, any classroom, playable in 60&nbsp;seconds
          </footer>
        </div>
      )}

      <AnimatePresence>
        {authTab && (
          <UsernamePickerModal
            initialTab={authTab}
            onRegistered={(result) => {
              setAuthTab(null)
              setCredentials({ username: result.username, pin: result.pin })
              refreshAuth()
            }}
            onSignedIn={() => {
              setAuthTab(null)
              refreshAuth()
            }}
            onCancel={() => setAuthTab(null)}
          />
        )}
        {credentials && (
          <CredentialsModal
            username={credentials.username}
            pin={credentials.pin}
            onContinue={() => {
              setCredentials(null)
              refreshAuth()
            }}
          />
        )}
      </AnimatePresence>
    </NavGuardCtx.Provider>
  )
}

// ---------- Header (used on every non-landing route) ----------

function AppHeader({ teacher, onSignIn, refreshAuth }) {
  const [location] = useLocation()
  const guardedNav = useGuardedNav()
  const studentName = getStudentName()
  // Non-teacher with a cached student name on any gameplay-ish route: show
  // the student badge instead of the teacher nav.
  const isGameRoute = /^\/(play|preview|result)\//.test(location)
  const useStudentChrome = !teacher && !!studentName && isGameRoute

  async function doSignOut() {
    try { await api.signOut() } catch { /* stateless */ }
    clearSession()
    refreshAuth()
    guardedNav('/')
  }

  return (
    <header className="sticky top-0 z-40 bg-slate-950/80 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between gap-3">
        <button
          onClick={() => guardedNav('/')}
          className="text-lg sm:text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-sky-400 via-sky-300 to-violet-400 shrink-0"
        >
          GemmaPlay
        </button>
        <nav className="flex items-center gap-1.5 sm:gap-2 text-sm min-w-0 flex-wrap justify-end">
          {useStudentChrome ? (
            <span className="px-3 py-1.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-300 text-xs sm:text-sm truncate max-w-[150px]">
              @{studentName}
            </span>
          ) : (
            <>
              <Tab
                active={location === '/upload' || location.startsWith('/claim') || location.startsWith('/picker') || location.startsWith('/preview')}
                onClick={() => guardedNav('/upload')}
              >
                Upload
              </Tab>
              <Tab active={location === '/dashboard'} onClick={() => guardedNav('/dashboard')}>
                Dashboard
              </Tab>
              {teacher ? (
                <UserMenu username={teacher} onSignOut={doSignOut} />
              ) : (
                <Tab active={false} onClick={onSignIn}>Sign in</Tab>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

// ---------- Route wrappers ----------

function LandingRoute({ teacher, onSignInClick, refreshAuth }) {
  const [, setLocation] = useLocation()
  async function doSignOut() {
    try { await api.signOut() } catch { /* stateless */ }
    clearSession()
    refreshAuth()
  }
  return (
    <LandingPage
      onStart={() => setLocation('/upload')}
      teacher={teacher}
      onSignInClick={onSignInClick}
      onDashboardClick={() => setLocation('/dashboard')}
      onSignOut={doSignOut}
    />
  )
}

function UploadRoute() {
  const [, setLocation] = useLocation()
  function handleUploaded(lessonInfo) {
    if (isSessionValid()) {
      // Already signed in: upload already tagged the lesson via session token.
      setLocation(`/picker/${lessonInfo.lesson_id}`)
    } else {
      setLocation(`/claim/${lessonInfo.lesson_id}`)
    }
  }
  return <UploadView onUploaded={handleUploaded} />
}

function ClaimRoute({ lessonId, onRegistered, onSignedIn }) {
  const [, setLocation] = useLocation()
  // If already signed in, skip claim and jump straight to the picker.
  if (isSessionValid()) {
    return <Redirect to={`/picker/${lessonId}`} />
  }
  return (
    <>
      <div className="w-full px-6 md:px-10 py-20 text-center text-slate-500 text-sm">
        Saving your lesson…
      </div>
      <UsernamePickerModal
        lessonId={lessonId}
        initialTab="create"
        onRegistered={(result) => {
          onRegistered(result)
          setLocation(`/picker/${lessonId}`)
        }}
        onSignedIn={() => {
          onSignedIn()
          setLocation(`/picker/${lessonId}`)
        }}
        onCancel={() => setLocation(`/picker/${lessonId}`)}
      />
    </>
  )
}

function PickerRoute({ lessonId }) {
  const [, setLocation] = useLocation()
  const [lesson, setLesson] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const l = await api.getLesson(lessonId)
        if (!cancelled) setLesson(l)
      } catch (e) {
        if (!cancelled) { logError(e, { where: 'getLesson', lessonId }); setError(e) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [lessonId])

  if (error) return <LoadError error={error} onDismiss={() => setError(null)} />
  if (!lesson) return <Loading>Loading lesson…</Loading>

  return (
    <div>
      <GamePicker
        lesson={lesson}
        onPicked={({ game_id }) => setLocation(`/preview/${lessonId}/${game_id}`)}
      />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
        <div className="text-xs uppercase tracking-widest text-slate-500 mb-2">
          Share with your class
        </div>
        <ShareLink lessonId={lesson.lesson_id} />
      </div>
    </div>
  )
}

function PreviewRoute({ lessonId, gameId }) {
  const [, setLocation] = useLocation()
  const [lesson, setLesson] = useState(null)
  const [game, setGame] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const full = await api.getGameFull(gameId)
        if (cancelled) return
        setGame(full.game)
        setLesson(full.lesson)
      } catch (e) {
        if (!cancelled) { logError(e, { where: 'getGameFull', gameId }); setError(e) }
      }
    }
    load()
    return () => { cancelled = true }
  }, [gameId])

  if (error) return <LoadError error={error} onDismiss={() => setError(null)} />
  if (!lesson || !game) return <Loading>Getting the game ready…</Loading>

  return (
    <GamePreview
      gameType={game.game_type || 'lane_runner'}
      lesson={lesson}
      onStart={() => setLocation(`/play/${lessonId}/${gameId}`)}
      onBack={() => setLocation(`/picker/${lessonId}`)}
    />
  )
}

function PlayRoute({ lessonId, gameId }) {
  const [, setLocation] = useLocation()
  const studentName = getStudentName()
  function handleFinished(report, stats) {
    const qs = new URLSearchParams()
    if (stats) {
      if (stats.score != null) qs.set('score', String(stats.score))
      if (stats.time_seconds != null) qs.set('time', String(stats.time_seconds))
      if (stats.questions_correct != null) qs.set('correct', String(stats.questions_correct))
      if (stats.questions_answered != null) qs.set('attempted', String(stats.questions_answered))
      if (stats.max_streak != null) qs.set('streak', String(stats.max_streak))
      if (stats.hintsUsed != null) qs.set('hints', String(stats.hintsUsed))
    }
    if (report?.report_id) qs.set('report', report.report_id)
    setLocation(`/result/${lessonId}/${gameId}?${qs.toString()}`)
  }
  return (
    <GameView
      gameId={gameId}
      studentName={studentName}
      onFinished={handleFinished}
    />
  )
}

function StudentFlowRoute({ lessonId }) {
  const [, setLocation] = useLocation()
  const [stage, setStage] = useState(() => getStudentName() ? 'picker' : 'join')
  const [lesson, setLesson] = useState(null)
  const [studentName, setLocalStudentName] = useState(() => getStudentName())

  // If the student has a cached name, fetch the lesson directly so they
  // can skip the join form on reload.
  useEffect(() => {
    if (stage !== 'picker') return
    let cancelled = false
    async function load() {
      try {
        const l = await api.getPublicLesson(lessonId)
        if (!cancelled) setLesson(l)
      } catch (e) {
        if (!cancelled) logError(e, { where: 'getPublicLesson (student picker)' })
      }
    }
    load()
    return () => { cancelled = true }
  }, [lessonId, stage])

  if (stage === 'join') {
    return (
      <StudentJoinView
        lessonId={lessonId}
        onJoined={({ lesson: l, student_name }) => {
          setLesson(l)
          setLocalStudentName(student_name)
          setStage('picker')
        }}
      />
    )
  }
  if (!lesson || !studentName) return <Loading>Loading your games…</Loading>
  return (
    <StudentGamePicker
      lesson={lesson}
      studentName={studentName}
      onPicked={({ game_id }) =>
        setLocation(`/play/${lessonId}/${game_id}`)
      }
    />
  )
}

function ResultRoute({ lessonId, gameId }) {
  const [, setLocation] = useLocation()
  const [report, setReport] = useState(null)
  const [fetchedReport, setFetchedReport] = useState(false)

  // Parse URL search params once per mount. Wouter doesn't surface location.search.
  const params = useMemo(() => {
    if (typeof window === 'undefined') return {}
    return Object.fromEntries(new URLSearchParams(window.location.search))
  }, [])

  const runStats = useMemo(() => ({
    score: params.score != null ? Number(params.score) : null,
    time_seconds: params.time != null ? Number(params.time) : null,
    questions_correct: params.correct != null ? Number(params.correct) : 0,
    questions_answered: params.attempted != null ? Number(params.attempted) : 0,
    max_streak: params.streak != null ? Number(params.streak) : 0,
    hintsUsed: params.hints != null ? Number(params.hints) : 0,
  }), [params])

  // Narrative text comes from the backend report. If we have a report_id
  // in the URL, fetch the full report so reloads still show the narrative.
  useEffect(() => {
    if (fetchedReport || !params.report) return
    let cancelled = false
    async function load() {
      try {
        const r = await api.getReport(params.report)
        if (!cancelled) setReport(r)
      } catch (e) {
        if (!cancelled) logError(e, { where: 'getReport', reportId: params.report })
      } finally {
        if (!cancelled) setFetchedReport(true)
      }
    }
    load()
    return () => { cancelled = true }
  }, [params.report, fetchedReport])

  // Synthesize a minimal report shape when we don't have the real one, so
  // the ResultView still renders on a cold /result/... URL.
  const effectiveReport = report || {
    score: runStats.score ?? 0,
    time_seconds: runStats.time_seconds ?? 0,
    hints_used: runStats.hintsUsed ?? 0,
    narrative: '',
  }

  const teacherSignedIn = isSessionValid()
  const studentName = getStudentName()
  const isStudentFlow = !teacherSignedIn && !!studentName

  return (
    <ResultView
      report={effectiveReport}
      runStats={runStats}
      lessonId={lessonId}
      onPlayAgain={() => setLocation(`/preview/${lessonId}/${gameId}`)}
      onBackToPicker={() =>
        setLocation(isStudentFlow ? `/play/${lessonId}` : `/picker/${lessonId}`)
      }
      onDashboard={teacherSignedIn ? () => setLocation('/dashboard') : null}
      onReplay={teacherSignedIn ? () => setLocation('/upload') : null}
    />
  )
}

function DashboardRoute({ teacher, onRequestSignIn, refreshAuth }) {
  async function doSignOut() {
    try { await api.signOut() } catch { /* stateless */ }
    clearSession()
    refreshAuth()
  }
  return (
    <TeacherDashboard
      signedIn={!!teacher}
      onRequestSignIn={onRequestSignIn}
      onSignOut={doSignOut}
    />
  )
}

// ---------- Nav UI bits ----------

function Tab({ active, onClick, children }) {
  return (
    <motion.button
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={`px-3 sm:px-4 py-2 rounded-xl font-semibold text-xs sm:text-sm transition-colors ${
        active
          ? 'bg-brand-500 text-white shadow-lg shadow-brand-500/25'
          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/70'
      }`}
    >
      {children}
    </motion.button>
  )
}

function UserMenu({ username, onSignOut }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const onDoc = () => setOpen(false)
    document.addEventListener('click', onDoc)
    return () => document.removeEventListener('click', onDoc)
  }, [open])
  return (
    <div className="relative" onClick={(e) => e.stopPropagation()}>
      <motion.button
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
        onClick={() => setOpen((o) => !o)}
        className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-slate-900/70 border border-slate-800 text-slate-300 text-xs sm:text-sm hover:bg-slate-800 truncate max-w-[140px]"
      >
        @{username}
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 mt-2 w-40 rounded-xl bg-slate-900 border border-slate-800 shadow-xl overflow-hidden z-50"
          >
            <button
              onClick={() => { setOpen(false); onSignOut() }}
              className="w-full text-left px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
