// QuestionDispatcher
//
// Owns the play-order queue for a session. Flattens every concept's
// questions into one array, sorts them by difficulty (easy -> medium -> hard)
// with light in-bucket shuffling, and serves them one at a time.
//
// Never ends the session — when the queue runs out, reshuffleRemaining()
// refills it (with a guard against back-to-back repeats).
//
// The scene decides when the player dies. The dispatcher just keeps
// feeding questions.

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

function difficultyRank(d) {
  if (d === 'easy') return 0
  if (d === 'medium' || d == null) return 1
  if (d === 'hard') return 2
  return 1
}

function buildPlayOrder(flat) {
  const easy = flat.filter((q) => difficultyRank(q.difficulty) === 0)
  const medium = flat.filter((q) => difficultyRank(q.difficulty) === 1)
  const hard = flat.filter((q) => difficultyRank(q.difficulty) === 2)
  shuffleInPlace(easy)
  shuffleInPlace(medium)
  shuffleInPlace(hard)
  return [...easy, ...medium, ...hard]
}

export class QuestionDispatcher {
  constructor(lesson) {
    const flat = []
    for (const c of (lesson?.concepts || [])) {
      for (const q of (c?.questions || [])) {
        flat.push({
          ...q,
          concept_id: c.id,
          concept_name: c.name,
        })
      }
    }
    if (flat.length === 0) {
      throw new Error('QuestionDispatcher: lesson has zero questions')
    }
    this._all = flat
    this._order = buildPlayOrder(flat.slice())
    this._cursor = 0
    this._lastShownId = null

    this._answered = 0
    this._correct = 0
    this._streak = 0
    this._maxStreak = 0
  }

  current() {
    return this._order[this._cursor] || null
  }

  getDifficultyTier() {
    const q = this.current()
    if (!q) return 'medium'
    const d = q.difficulty
    if (d === 'easy' || d === 'medium' || d === 'hard') return d
    return 'medium'
  }

  submitAnswer(optionIndex) {
    const q = this.current()
    if (!q) return { correct: false, correct_index: -1, question: null }
    const correct = Number(optionIndex) === Number(q.answer_index)
    this._answered += 1
    if (correct) {
      this._correct += 1
      this._streak += 1
      if (this._streak > this._maxStreak) this._maxStreak = this._streak
    } else {
      this._streak = 0
    }
    return { correct, correct_index: q.answer_index, question: q }
  }

  advance() {
    const q = this.current()
    if (q) this._lastShownId = q.id
    this._cursor += 1
    if (this.isExhausted()) this.shuffleRemaining()
  }

  isExhausted() {
    return this._cursor >= this._order.length
  }

  shuffleRemaining() {
    // Full reset: reshuffle the whole pool, but if the last shown question
    // lands first in the new order, swap it with something else to avoid
    // back-to-back duplicates.
    const next = buildPlayOrder(this._all.slice())
    if (next.length > 1 && next[0].id === this._lastShownId) {
      const swapIdx = 1 + Math.floor(Math.random() * (next.length - 1))
      ;[next[0], next[swapIdx]] = [next[swapIdx], next[0]]
    }
    this._order = next
    this._cursor = 0
  }

  getProgress() {
    return {
      answered: this._answered,
      correct: this._correct,
      streak: this._streak,
      max_streak: this._maxStreak,
    }
  }

  size() {
    return this._all.length
  }

  // Serialize state so a reloaded scene can continue on the same question.
  // `orderIds` captures the current play queue; cursor is the pointer into
  // it. On restore we rebuild `_order` by looking each id up in `_all`.
  snapshot() {
    return {
      orderIds: this._order.map((q) => q.id),
      cursor: this._cursor,
      lastShownId: this._lastShownId,
      answered: this._answered,
      correct: this._correct,
      streak: this._streak,
      maxStreak: this._maxStreak,
    }
  }

  restore(snap) {
    if (!snap) return false
    const byId = new Map(this._all.map((q) => [q.id, q]))
    const restored = []
    for (const id of snap.orderIds || []) {
      const q = byId.get(id)
      if (q) restored.push(q)
    }
    if (restored.length === 0) return false
    this._order = restored
    this._cursor = Math.min(Math.max(0, snap.cursor | 0), restored.length)
    this._lastShownId = snap.lastShownId || null
    this._answered = snap.answered | 0
    this._correct = snap.correct | 0
    this._streak = snap.streak | 0
    this._maxStreak = snap.maxStreak | 0
    return true
  }
}
