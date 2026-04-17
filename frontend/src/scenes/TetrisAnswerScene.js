// TetrisAnswerScene
//
// Standalone Phaser 3 scene: Tetris-style answer game. Blocks fall from the
// top; the player steers them into one of 4 lettered bins (A/B/C/D). Landing
// in the bin that matches the current question's answer_index is correct;
// otherwise the block stays stacked in its column. Tower reaching the top
// ends the session.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd }
//     game   = { game_id, lesson_id, game_type: 'tetris_answer', levels: [
//                 { concept_id, base_speed?, questions: [question_id, ...] }
//               ] }
//     lesson = { concepts: [
//                 { id, name, questions: [{ id, q, options, answer_index }] }
//               ] }
//     sessionId: string
//     onSessionEnd({ score, hearts, time_seconds, hintsUsed })

const GAME_W = 960
const GAME_H = 540
const HUD_H = 60
const Q_STRIP_H = 40
const FIELD_LEFT = 180
const FIELD_RIGHT = 780
const FIELD_WIDTH = FIELD_RIGHT - FIELD_LEFT     // 600
const FIELD_TOP = 60
const FIELD_BOTTOM = 440
const COL_COUNT = 4
const COL_W = FIELD_WIDTH / COL_COUNT            // 150
const BLOCK_W = 120
const BLOCK_H = 60
const BASE_FALL = 40
const SOFT_MULT = 5
const DANGER_Y = 80                              // stack reaches above this ⇒ game over

const COLOR = {
  bg: 0x0c1220,
  hudBg: 0x0f172a,
  fieldBg: 0x0f172a,
  fieldStroke: 0x1e293b,
  danger: 0xef4444,
  dimmed: 0x475569,
  A: 0x0ea5e9,
  B: 0xa855f7,
  C: 0xfacc15,
  D: 0x10b981,
  textHex: '#e2e8f0',
  heartsHex: '#ef4444',
}

const LETTER_KEYS = ['A', 'B', 'C', 'D']
const LETTER_HEX = ['#0ea5e9', '#a855f7', '#facc15', '#10b981']

function colCenterX(col) {
  return FIELD_LEFT + COL_W * (col + 0.5)
}

export class TetrisAnswerScene extends Phaser.Scene {
  constructor() {
    super('TetrisAnswerScene')
  }

  init(data) {
    this.gameData = data.game
    this.lessonData = data.lesson
    this.sessionId = data.sessionId || 'harness'
    this.onSessionEnd = data.onSessionEnd || (() => {})

    this.levelIdx = 0
    this.score = 0
    this.hearts = 3
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false

    // Per-concept streaks drive the harness-local adaptation
    this.conceptStats = {}
    this.reducedForNextBlock = 0
    this.dimmedBins = new Set()
    this.currentHintUsed = false

    this.questionsByLevel = this.gameData.levels.map((lvl) =>
      (lvl.questions || []).map((qid) => this._findQuestion(qid)).filter(Boolean)
    )
  }

  _findQuestion(qid) {
    for (const c of this.lessonData.concepts) {
      const q = (c.questions || []).find((x) => x.id === qid)
      if (q) return { ...q, concept_id: c.id, concept_name: c.name }
    }
    return null
  }

  // ---------- Preload: generate textures ----------

  preload() {
    const g = this.add.graphics()
    const makeBlock = (color, key) => {
      g.fillStyle(color)
      g.fillRoundedRect(0, 0, BLOCK_W, BLOCK_H, 10)
      g.lineStyle(2, 0xffffff, 0.6)
      g.strokeRoundedRect(1, 1, BLOCK_W - 2, BLOCK_H - 2, 10)
      g.generateTexture(key, BLOCK_W, BLOCK_H)
      g.clear()
    }
    makeBlock(COLOR.A, 'tab-block-A')
    makeBlock(COLOR.B, 'tab-block-B')
    makeBlock(COLOR.C, 'tab-block-C')
    makeBlock(COLOR.D, 'tab-block-D')
    g.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    // Play field background
    this.add.rectangle(
      (FIELD_LEFT + FIELD_RIGHT) / 2,
      (FIELD_TOP + FIELD_BOTTOM) / 2,
      FIELD_WIDTH,
      FIELD_BOTTOM - FIELD_TOP,
      COLOR.fieldBg,
      0.4,
    ).setStrokeStyle(2, COLOR.fieldStroke)

    // Column dividers
    for (let i = 1; i < COL_COUNT; i++) {
      const x = FIELD_LEFT + COL_W * i
      const divider = this.add.rectangle(x, (FIELD_TOP + FIELD_BOTTOM) / 2, 2, FIELD_BOTTOM - FIELD_TOP, COLOR.fieldStroke, 0.8)
      divider.setOrigin(0.5)
    }

    // Danger line
    this.add.rectangle((FIELD_LEFT + FIELD_RIGHT) / 2, DANGER_Y, FIELD_WIDTH, 2, COLOR.danger, 0.5)

    // Floor line
    this.add.rectangle((FIELD_LEFT + FIELD_RIGHT) / 2, FIELD_BOTTOM + 1, FIELD_WIDTH, 3, COLOR.fieldStroke)

    // Bins (floor labels + highlight)
    this.binRects = []
    this.binLabels = []
    for (let i = 0; i < COL_COUNT; i++) {
      const x = colCenterX(i)
      const rect = this.add.rectangle(x, FIELD_BOTTOM + 22, COL_W - 16, 32, this._binColor(i), 0.25)
        .setStrokeStyle(2, this._binColor(i), 0.7)
      const label = this.add.text(x, FIELD_BOTTOM + 22, LETTER_KEYS[i], {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '22px',
        color: LETTER_HEX[i], fontStyle: 'bold',
      }).setOrigin(0.5)
      this.binRects.push(rect)
      this.binLabels.push(label)
    }

    // Stack storage — one list of landed blocks per column.
    this.stacks = [[], [], [], []]

    this._buildHUD()
    this._setupInput()
    this._startLevel()
  }

  _binColor(i) {
    return [COLOR.A, COLOR.B, COLOR.C, COLOR.D][i]
  }

  // ---------- HUD ----------

  _buildHUD() {
    this.hudBar = this.add.rectangle(GAME_W / 2, HUD_H / 2, GAME_W, HUD_H, COLOR.hudBg, 0.95)
      .setStrokeStyle(1, COLOR.fieldStroke).setDepth(200)

    this.scoreText = this.add.text(16, HUD_H / 2, 'Score: 0', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '20px', color: COLOR.textHex,
    }).setOrigin(0, 0.5).setDepth(201)

    this.heartsText = this.add.text(GAME_W - 16, HUD_H / 2, '\u2665 \u2665 \u2665', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '24px', color: COLOR.heartsHex,
    }).setOrigin(1, 0.5).setDepth(201)

    this.levelText = this.add.text(GAME_W / 2, HUD_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color: '#94a3b8',
    }).setOrigin(0.5).setDepth(201)

    // Question strip at the bottom (above bins)
    this.qBar = this.add.rectangle(GAME_W / 2, GAME_H - Q_STRIP_H / 2, GAME_W, Q_STRIP_H, COLOR.hudBg, 0.95)
      .setStrokeStyle(1, COLOR.fieldStroke).setDepth(200)
    this.questionText = this.add.text(GAME_W / 2, GAME_H - Q_STRIP_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: COLOR.textHex,
      wordWrap: { width: GAME_W - 40 }, align: 'center',
    }).setOrigin(0.5).setDepth(201)
  }

  _renderHearts() {
    const n = Math.max(this.hearts, 0)
    this.heartsText.setText(n > 0 ? Array(n).fill('\u2665').join(' ') : '—')
  }

  // ---------- Input ----------

  _setupInput() {
    this.softDropDown = false
    this._softDropTimer = null
    this.input.keyboard.on('keydown', (ev) => {
      if (this.ended) return
      const k = ev.key
      if (k === 'ArrowLeft' || k === 'a' || k === 'A') this._moveBlockLeft()
      else if (k === 'ArrowRight' || k === 'd' || k === 'D') this._moveBlockRight()
      else if (k === 'ArrowDown' || k === 's' || k === 'S') this.softDropDown = true
    })
    this.input.keyboard.on('keyup', (ev) => {
      const k = ev.key
      if (k === 'ArrowDown' || k === 's' || k === 'S') this.softDropDown = false
    })

    // Pointer (mouse + touch): swipe for lateral moves / soft drop; tap to snap.
    this._pointerStart = null
    this.input.on('pointerdown', (p) => {
      this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
    })
    this.input.on('pointerup', (p) => {
      if (this.ended || !this._pointerStart) { this._pointerStart = null; return }
      const dx = p.x - this._pointerStart.x
      const dy = p.y - this._pointerStart.y
      const dt = Date.now() - this._pointerStart.t
      const SWIPE_THRESHOLD = 30
      const TAP_MAX_MOVE = 10
      const TAP_MAX_TIME = 250

      if (Math.abs(dx) < TAP_MAX_MOVE && Math.abs(dy) < TAP_MAX_MOVE && dt < TAP_MAX_TIME) {
        this._handleTap(p.x, p.y)
      } else if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        this._handleSwipe(dx > 0 ? 'right' : 'left')
      } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
        this._handleSwipe(dy > 0 ? 'down' : 'up')
      }
      this._pointerStart = null
    })
  }

  _handleSwipe(dir) {
    if (dir === 'left') this._moveBlockLeft()
    else if (dir === 'right') this._moveBlockRight()
    else if (dir === 'down') this._softDrop()
  }

  _handleTap(x, _y) {
    // Snap the active block to whichever of the 4 bin columns the tap is over.
    const rel = (x - FIELD_LEFT) / COL_W
    const col = Phaser.Math.Clamp(Math.floor(rel), 0, COL_COUNT - 1)
    this._snapBlockToCol(col)
  }

  _moveBlockLeft() {
    this._moveBlock(-1)
  }

  _moveBlockRight() {
    this._moveBlock(1)
  }

  _softDrop() {
    // Swipe-down soft drop: enable for 500ms then release.
    if (this._softDropTimer) { this._softDropTimer.remove(); this._softDropTimer = null }
    this.softDropDown = true
    this._softDropTimer = this.time.delayedCall(500, () => {
      this.softDropDown = false
      this._softDropTimer = null
    })
  }

  _moveBlock(dx) {
    if (!this.activeBlock) return
    const newCol = Phaser.Math.Clamp(this.activeBlock.col + dx, 0, COL_COUNT - 1)
    this._snapBlockToCol(newCol)
  }

  _snapBlockToCol(col) {
    if (!this.activeBlock) return
    const clamped = Phaser.Math.Clamp(col, 0, COL_COUNT - 1)
    if (clamped === this.activeBlock.col) return
    this.activeBlock.col = clamped
    const x = colCenterX(clamped)
    this.tweens.add({
      targets: [this.activeBlock.sprite, this.activeBlock.label],
      x,
      duration: 120,
      ease: 'Sine.easeOut',
    })
  }

  // ---------- Level lifecycle ----------

  _startLevel() {
    const level = this.gameData.levels[this.levelIdx]
    const concept = this.lessonData.concepts.find((c) => c.id === level.concept_id)
    this.currentLevel = level
    this.currentConcept = concept
    this.levelQuestions = this.questionsByLevel[this.levelIdx].slice()
    this.levelText.setText(
      `Level ${this.levelIdx + 1}/${this.gameData.levels.length} — ${concept ? concept.name : ''}`
    )
    this.fallSpeed = level.base_speed || BASE_FALL

    this._loadNextQuestion()
    if (this.activeQuestion) this._spawnBlock()
    else this._nextLevel()
  }

  _loadNextQuestion() {
    if (this.levelQuestions.length === 0) {
      this.activeQuestion = null
      this.questionText.setText('')
      this._restoreBins()
      return
    }
    this.activeQuestion = this.levelQuestions.shift()
    this.questionText.setText(this.activeQuestion.q)

    if (this.reducedForNextBlock > 0) {
      this._dimWrongBins(this.activeQuestion, this.reducedForNextBlock)
      this.reducedForNextBlock = 0
      this.currentHintUsed = true
    } else {
      this._restoreBins()
      this.currentHintUsed = false
    }
  }

  _dimWrongBins(q, keep) {
    const correct = q.answer_index
    const wrongs = [0, 1, 2, 3].filter((i) => i !== correct)
    Phaser.Utils.Array.Shuffle(wrongs)
    const keepWrongs = wrongs.slice(0, Math.max(keep - 1, 0))
    const keepers = new Set([correct, ...keepWrongs])
    this.dimmedBins = new Set()
    for (let i = 0; i < COL_COUNT; i++) {
      if (!keepers.has(i)) {
        this.dimmedBins.add(i)
        this.binRects[i].fillColor = COLOR.dimmed
        this.binRects[i].fillAlpha = 0.45
        this.binRects[i].setStrokeStyle(2, COLOR.dimmed, 0.5)
        this.binLabels[i].setColor('#94a3b8')
      }
    }
  }

  _restoreBins() {
    this.dimmedBins = new Set()
    for (let i = 0; i < COL_COUNT; i++) {
      this.binRects[i].fillColor = this._binColor(i)
      this.binRects[i].fillAlpha = 0.25
      this.binRects[i].setStrokeStyle(2, this._binColor(i), 0.7)
      this.binLabels[i].setColor(LETTER_HEX[i])
    }
  }

  _spawnBlock() {
    if (!this.activeQuestion) return
    const letterIdx = Phaser.Math.Between(0, 3)
    const letter = LETTER_KEYS[letterIdx]
    const col = Phaser.Math.Between(0, COL_COUNT - 1)
    const x = colCenterX(col)
    const y = FIELD_TOP + BLOCK_H / 2
    const sprite = this.add.image(x, y, `tab-block-${letter}`).setDepth(10)
    const label = this.add.text(x, y, letter, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '30px',
      color: '#0c1220', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11)
    this.activeBlock = { sprite, label, col, letter, y }
  }

  _nextLevel() {
    this.levelIdx += 1
    if (this.levelIdx >= this.gameData.levels.length) {
      return this._endSession()
    }
    this._clearStacks()
    this._banner(`Level ${this.levelIdx + 1}`, '#0ea5e9')
    this.time.delayedCall(900, () => this._startLevel())
  }

  _clearStacks() {
    for (const stack of this.stacks) {
      for (const b of stack) {
        b.sprite.destroy()
        b.label.destroy()
      }
      stack.length = 0
    }
  }

  // ---------- Game loop ----------

  update(_, delta) {
    if (this.ended || !this.activeBlock) return
    const dt = delta / 1000
    const speed = this.fallSpeed * (this.softDropDown ? SOFT_MULT : 1)
    this.activeBlock.y += speed * dt

    const stackHeight = this.stacks[this.activeBlock.col].length
    const landY = FIELD_BOTTOM - stackHeight * BLOCK_H - BLOCK_H / 2

    if (this.activeBlock.y >= landY) {
      this.activeBlock.y = landY
      this.activeBlock.sprite.y = landY
      this.activeBlock.label.y = landY
      this._landBlock()
      return
    }
    this.activeBlock.sprite.y = this.activeBlock.y
    this.activeBlock.label.y = this.activeBlock.y
  }

  // ---------- Resolution ----------

  _landBlock() {
    const block = this.activeBlock
    this.activeBlock = null
    const q = this.activeQuestion
    const correct = block.col === q.answer_index
    const stats = this.conceptStats[q.concept_id] ||= { correctStreak: 0, wrongStreak: 0 }

    if (correct) {
      this.score += 10
      this.scoreText.setText(`Score: ${this.score}`)
      this._flash(0x10b981)
      stats.correctStreak += 1
      stats.wrongStreak = 0
      // Clear the block and the whole field
      block.sprite.destroy()
      block.label.destroy()
      this._clearStacks()
      if (stats.correctStreak >= 2) {
        this.fallSpeed = this.fallSpeed * 1.1
        stats.correctStreak = 0
        this._banner('Speeding up! +10%', '#10b981')
      }
    } else {
      this.hearts -= 1
      this._renderHearts()
      this._flash(0xef4444)
      stats.wrongStreak += 1
      stats.correctStreak = 0
      // Keep block in its column stack
      this.stacks[block.col].push({ sprite: block.sprite, label: block.label })
      if (stats.wrongStreak >= 2) {
        this.reducedForNextBlock = 2
        this.hintsUsed += 1
        stats.wrongStreak = 0
        this._banner('Hint: narrowing options', '#f59e0b')
      }
      if (this.hearts <= 0) return this._endSession()
      if (this._stackReachesTop()) {
        this._banner('Tower reached the top!', '#ef4444')
        return this._endSession()
      }
    }

    this._loadNextQuestion()
    if (!this.activeQuestion) return this._nextLevel()
    this._spawnBlock()
  }

  _stackReachesTop() {
    for (const stack of this.stacks) {
      if (stack.length === 0) continue
      const topY = FIELD_BOTTOM - stack.length * BLOCK_H
      if (topY < DANGER_Y) return true
    }
    return false
  }

  // ---------- Visual helpers ----------

  _flash(color) {
    this.cameras.main.flash(180, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(GAME_W / 2, HUD_H + 8, text, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px', color,
      backgroundColor: '#0f172a', padding: { x: 14, y: 6 },
    }).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: HUD_H - 4, duration, delay: 200,
      onComplete: () => t.destroy(),
    })
  }

  _endSession() {
    if (this.ended) return
    this.ended = true
    this.onSessionEnd({
      score: this.score,
      hearts: Math.max(this.hearts, 0),
      time_seconds: Math.floor((Date.now() - this.startTs) / 1000),
      hintsUsed: this.hintsUsed,
    })
  }
}
