import { useEffect, useState } from 'react'
import { api } from '../api/client.js'

export function TeacherDashboard({ onPlayGame }) {
  const [lessons, setLessons] = useState([])
  const [reports, setReports] = useState([])
  const [selectedReport, setSelectedReport] = useState(null)

  useEffect(() => {
    refresh()
  }, [])

  async function refresh() {
    try {
      const [l, r] = await Promise.all([api.listLessons(), api.listReports()])
      setLessons(l)
      setReports(r)
    } catch (e) {
      console.error(e)
    }
  }

  async function openReport(id) {
    const r = await api.getReport(id)
    setSelectedReport(r)
  }

  async function playLesson(lessonId) {
    // Find the latest game for this lesson by fetching lesson + using any game
    // For MVP the lesson -> game mapping is 1:1 since upload creates both.
    // We expose the game id by refetching lessons with a join — for now we
    // just call the api directly to get game by lesson.
    // Simpler: lessons endpoint could return game_id too. TODO: enrich.
    alert('Use the Upload flow for a fresh game. Coming soon: replay from lesson.')
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      <section>
        <h2 className="text-xl font-semibold mb-4">Lessons</h2>
        {lessons.length === 0 ? (
          <p className="text-slate-500 text-sm">No lessons yet. Upload one to get started.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {lessons.map((l) => (
              <div key={l.lesson_id} className="p-4 bg-white rounded-lg shadow-sm border border-slate-200">
                <div className="font-medium">{l.title}</div>
                <div className="text-xs text-slate-500 mt-1">
                  {l.subject} — {l.grade_level}
                </div>
                <div className="text-xs text-slate-400 mt-2">
                  {new Date(l.created_at).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Student reports</h2>
        {reports.length === 0 ? (
          <p className="text-slate-500 text-sm">No reports yet. Have a student play.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {reports.map((r) => (
              <button
                key={r.report_id}
                onClick={() => openReport(r.report_id)}
                className="text-left p-4 bg-white rounded-lg shadow-sm border border-slate-200 hover:border-brand-500 transition"
              >
                <div className="font-medium">{r.student_id}</div>
                <div className="text-sm text-slate-500 mt-1">
                  Score: <span className="font-semibold text-slate-700">{r.score}/100</span>
                </div>
                <div className="text-xs text-slate-400 mt-2">
                  {new Date(r.created_at).toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {selectedReport && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSelectedReport(null)}
        >
          <div
            className="bg-white rounded-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-1">Student Report</h3>
            <p className="text-sm text-slate-500 mb-4">{selectedReport.student_id}</p>
            <div className="grid grid-cols-3 gap-3 text-center mb-4">
              <Stat label="Score" value={`${selectedReport.score}/100`} />
              <Stat label="Time" value={`${selectedReport.time_seconds}s`} />
              <Stat label="Hints" value={selectedReport.hints_used} />
            </div>
            <div className="text-sm space-y-2">
              <div>
                <span className="font-medium text-emerald-700">Mastered:</span>{' '}
                {selectedReport.concepts_mastered.length || 'none yet'}
              </div>
              <div>
                <span className="font-medium text-amber-700">Needs review:</span>{' '}
                {selectedReport.concepts_weak.length || 'none'}
              </div>
            </div>
            <div className="mt-4 p-3 bg-slate-50 rounded text-sm italic text-slate-700">
              "{selectedReport.narrative}"
            </div>
            <button
              onClick={() => setSelectedReport(null)}
              className="mt-6 w-full bg-slate-100 hover:bg-slate-200 py-2 rounded text-sm font-medium"
            >
              Close
            </button>
          </div>
        </div>
      )}
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
