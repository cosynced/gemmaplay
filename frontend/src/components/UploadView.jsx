import { useState } from 'react'
import { api } from '../api/client.js'

export function UploadView({ onUploaded }) {
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function handleUpload() {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.uploadLesson(file)
      onUploaded(result)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-xl mx-auto mt-12 p-8 bg-white rounded-xl shadow">
      <h2 className="text-2xl font-semibold mb-2">Upload a lesson</h2>
      <p className="text-slate-500 mb-6">
        PDF, .txt, or .md. We extract concepts and build a game in seconds.
      </p>

      <label className="block border-2 border-dashed border-slate-300 rounded-lg p-8 text-center cursor-pointer hover:border-brand-500 transition">
        <input
          type="file"
          accept=".pdf,.txt,.md"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <div className="text-slate-600">
          {file ? file.name : 'Click to choose a file'}
        </div>
      </label>

      <button
        disabled={!file || busy}
        onClick={handleUpload}
        className="mt-6 w-full bg-brand-600 hover:bg-brand-700 disabled:bg-slate-300 text-white font-medium py-3 rounded-lg transition"
      >
        {busy ? 'Generating game...' : 'Generate game'}
      </button>

      {error && (
        <div className="mt-4 p-3 bg-red-50 text-red-700 rounded text-sm">
          {error}
        </div>
      )}
    </div>
  )
}
