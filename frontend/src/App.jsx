import { useState } from 'react'
import { UploadView } from './components/UploadView.jsx'
import { GamePicker } from './components/GamePicker.jsx'
import { GameView } from './components/GameView.jsx'
import { TeacherDashboard } from './components/TeacherDashboard.jsx'

export default function App() {
  // view: 'home' | 'picker' | 'game' | 'result' | 'dashboard'
  const [view, setView] = useState('home')
  const [lesson, setLesson] = useState(null)
  const [gameId, setGameId] = useState(null)
  const [report, setReport] = useState(null)

  function handleUploaded(lessonInfo) {
    setLesson(lessonInfo)
    setView('picker')
  }
  function handlePicked({ game_id }) {
    setGameId(game_id)
    setView('game')
  }
  function handleFinished(r) {
    setReport(r)
    setView('result')
  }
  function goHome() {
    setLesson(null)
    setGameId(null)
    setReport(null)
    setView('home')
  }

  return (
    <div className="min-h-full">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button onClick={goHome} className="text-xl font-bold text-brand-600">
            GemmaPlay
          </button>
          <nav className="flex gap-2 text-sm">
            <Tab active={view === 'home' || view === 'picker'} onClick={goHome}>Upload</Tab>
            <Tab active={view === 'dashboard'} onClick={() => setView('dashboard')}>
              Dashboard
            </Tab>
          </nav>
        </div>
      </header>

      <main>
        {view === 'home' && <UploadView onUploaded={handleUploaded} />}
        {view === 'picker' && lesson && (
          <GamePicker lesson={lesson} onPicked={handlePicked} />
        )}
        {view === 'game' && gameId && (
          <GameView gameId={gameId} onFinished={handleFinished} />
        )}
        {view === 'result' && report && (
          <ResultView report={report} onDone={() => setView('dashboard')} />
        )}
        {view === 'dashboard' && <TeacherDashboard />}
      </main>

      <footer className="py-6 text-center text-xs text-slate-400">
        Built on Gemma 4 • Any lesson, any classroom, playable in 60 seconds
      </footer>
    </div>
  )
}

function Tab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      {children}
    </button>
  )
}

function ResultView({ report, onDone }) {
  return (
    <div className="max-w-lg mx-auto mt-12 p-8 bg-white rounded-xl shadow">
      <h2 className="text-2xl font-semibold">Nice work</h2>
      <p className="text-slate-500 mb-6">Your teacher will see this report.</p>
      <div className="grid grid-cols-3 gap-3 text-center mb-4">
        <Stat label="Score" value={`${report.score}/100`} />
        <Stat label="Time" value={`${report.time_seconds}s`} />
        <Stat label="Hints" value={report.hints_used} />
      </div>
      <div className="p-3 bg-slate-50 rounded text-sm italic text-slate-700 mb-4">
        "{report.narrative}"
      </div>
      <button
        onClick={onDone}
        className="w-full bg-brand-600 hover:bg-brand-700 text-white font-medium py-3 rounded-lg"
      >
        View teacher dashboard
      </button>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="p-3 bg-slate-50 rounded">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-800">{value}</div>
    </div>
  )
}
