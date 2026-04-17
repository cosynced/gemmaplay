// ShooterAnswerScene
//
// Standalone Phaser 3 scene: Space-Invaders-style answer shooter. Four
// labeled letter boxes (A/B/C/D) descend from above with their option text.
// A ship at the bottom fires bullets upward. Shooting the letter whose
// letterIdx matches the current question's answer_index clears the wave
// and advances. Shooting a wrong letter costs a heart; the wrong letter
// respawns from the top. Letters reaching the bottom also cost a heart and
// respawn from the top.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd }
//     game.game_type = 'shooter_answer'
//     see Session 1/2 for the shared lesson + game shape.

const GAME_W = 960
const GAME_H = 540
const QUESTION_STRIP_H = 80
const HUD_STRIP_H = 30
const PLAY_TOP = 130
const PLAY_BOTTOM = 480
const COL_XS = [120, 360, 600, 840]
const LETTER_BOX = 60
const SHIP_Y = 470
const SHIP_SIZE = 40
const SHIP_SPEED = 400
const BULLET_SPEED = 500
const LETTER_FALL = 20
const FIRE_INTERVAL = 220

const COLOR = {
  bg: 0x0c1220,
  hud: 0x0f172a,
  stroke: 0x1e293b,
  ship: 0x0ea5e9,
  bullet: 0xfacc15,
  dimmed: 0x475569,
  A: 0x0ea5e9,
  B: 0xa855f7,
  C: 0xfacc15,
  D: 0x10b981,
  heartsHex: '#ef4444',
  textHex: '#e2e8f0',
}

const LETTER_KEYS = ['A', 'B', 'C', 'D']
const LETTER_HEX = ['#0ea5e9', '#a855f7', '#facc15', '#10b981']

export class ShooterAnswerScene extends Phaser.Scene {
  constructor() {
    super('ShooterAnswerScene')
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

    this.conceptStats = {}
    this.hintPendingForNextWave = false
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

    // Ship — cyan triangle pointing up
    g.fillStyle(COLOR.ship)
    g.fillTriangle(SHIP_SIZE / 2, 0, 0, SHIP_SIZE, SHIP_SIZE, SHIP_SIZE)
    g.fillStyle(0xffffff, 0.6)
    g.fillRect(SHIP_SIZE / 2 - 2, SHIP_SIZE / 2 + 2, 4, 8)
    g.generateTexture('sa-ship', SHIP_SIZE, SHIP_SIZE)
    g.clear()

    // Bullet — 4×12 yellow rect
    g.fillStyle(COLOR.bullet)
    g.fillRect(0, 0, 4, 12)
    g.generateTexture('sa-bullet', 4, 12)
    g.clear()

    const makeLetterBox = (color, key) => {
      g.fillStyle(color)
      g.fillRoundedRect(0, 0, LETTER_BOX, LETTER_BOX, 8)
      g.lineStyle(2, 0xffffff, 0.6)
      g.strokeRoundedRect(1, 1, LETTER_BOX - 2, LETTER_BOX - 2, 8)
      g.generateTexture(key, LETTER_BOX, LETTER_BOX)
      g.clear()
    }
    makeLetterBox(COLOR.A, 'sa-letter-A')
    makeLetterBox(COLOR.B, 'sa-letter-B')
    makeLetterBox(COLOR.C, 'sa-letter-C')
    makeLetterBox(COLOR.D, 'sa-letter-D')

    g.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    // Faint star field in the play area
    for (let i = 0; i < 70; i++) {
      const x = Phaser.Math.Between(0, GAME_W)
      const y = Phaser.Math.Between(PLAY_TOP - 10, PLAY_BOTTOM + 40)
      const r = Phaser.Math.Between(1, 2)
      this.add.circle(x, y, r, 0xffffff, Phaser.Math.FloatBetween(0.2, 0.5))
    }

    this._buildHUD()

    // Ship
    this.ship = this.add.image(GAME_W / 2, SHIP_Y, 'sa-ship').setDepth(50)
    this.lastFireTs = 0

    this.bullets = []
    this.letters = []

    // Input (poll in update for continuous movement + firing)
    this.keys = this.input.keyboard.addKeys({
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    })

    // Pointer (mouse + touch): drag to steer, tap a letter to target-fire, tap
    // elsewhere or swipe up to fire straight.
    this._pointerStart = null
    this._pointerDown = false
    this.input.on('pointerdown', (p) => {
      this._pointerStart = { x: p.x, y: p.y, t: Date.now() }
      this._pointerDown = true
      this._dragShipTo(p.x)
    })
    this.input.on('pointermove', (p) => {
      if (this._pointerDown) this._dragShipTo(p.x)
    })
    this.input.on('pointerup', (p) => {
      this._pointerDown = false
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

    this._startLevel()
  }

  _dragShipTo(x) {
    if (this.ended || !this.ship) return
    this.ship.x = Phaser.Math.Clamp(x, 30, GAME_W - 30)
  }

  _handleSwipe(dir) {
    if (dir === 'up') this._fireStraight()
  }

  _handleTap(x, y) {
    // If the tap hits a falling letter, fire a targeted bullet at it.
    for (const L of this.letters) {
      if (Math.abs(L.sprite.x - x) < LETTER_BOX / 2 &&
          Math.abs(L.y - y) < LETTER_BOX / 2) {
        this._fireAt(L.sprite.x, L.y)
        return
      }
    }
    // Otherwise: treat as fire-straight-up.
    this._fireStraight()
  }

  _buildHUD() {
    // Question strip (top)
    this.qBar = this.add.rectangle(GAME_W / 2, QUESTION_STRIP_H / 2, GAME_W, QUESTION_STRIP_H, COLOR.hud, 0.95)
      .setStrokeStyle(1, COLOR.stroke).setDepth(200)
    this.questionText = this.add.text(GAME_W / 2, QUESTION_STRIP_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color: COLOR.textHex,
      wordWrap: { width: GAME_W - 40 }, align: 'center',
    }).setOrigin(0.5).setDepth(201)

    // HUD strip (below question strip)
    this.hudBar = this.add.rectangle(
      GAME_W / 2, QUESTION_STRIP_H + HUD_STRIP_H / 2, GAME_W, HUD_STRIP_H, COLOR.hud, 0.85,
    ).setStrokeStyle(1, COLOR.stroke).setDepth(200)

    this.scoreText = this.add.text(16, QUESTION_STRIP_H + HUD_STRIP_H / 2, 'Score: 0', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: COLOR.textHex,
    }).setOrigin(0, 0.5).setDepth(201)

    this.heartsText = this.add.text(GAME_W - 16, QUESTION_STRIP_H + HUD_STRIP_H / 2, '\u2665 \u2665 \u2665', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px', color: COLOR.heartsHex,
    }).setOrigin(1, 0.5).setDepth(201)

    this.levelText = this.add.text(GAME_W / 2, QUESTION_STRIP_H + HUD_STRIP_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '13px', color: '#94a3b8',
    }).setOrigin(0.5).setDepth(201)
  }

  _renderHearts() {
    const n = Math.max(this.hearts, 0)
    this.heartsText.setText(n > 0 ? Array(n).fill('\u2665').join(' ') : '—')
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
    this.descentSpeed = level.base_speed || LETTER_FALL

    this._loadNextQuestion()
    if (!this.activeQuestion) return this._nextLevel()
    this._spawnWave()
  }

  _loadNextQuestion() {
    if (this.levelQuestions.length === 0) {
      this.activeQuestion = null
      this.questionText.setText('')
      return
    }
    this.activeQuestion = this.levelQuestions.shift()
    this.questionText.setText(this.activeQuestion.q)
  }

  _nextLevel() {
    this.levelIdx += 1
    if (this.levelIdx >= this.gameData.levels.length) return this._endSession()
    this._clearLetters()
    this._banner(`Level ${this.levelIdx + 1}`, '#0ea5e9')
    this.time.delayedCall(900, () => this._startLevel())
  }

  _clearLetters() {
    for (const L of this.letters) this._destroyLetter(L)
    this.letters = []
  }

  // ---------- Wave / letter spawning ----------

  _spawnWave() {
    if (!this.activeQuestion) return
    const q = this.activeQuestion

    // Determine which letters to hide this wave (hint)
    let hidden = new Set()
    if (this.hintPendingForNextWave) {
      const wrongs = [0, 1, 2, 3].filter((i) => i !== q.answer_index)
      Phaser.Utils.Array.Shuffle(wrongs)
      hidden = new Set(wrongs.slice(0, 2))
      this.hintPendingForNextWave = false
      this.currentHintUsed = true
    } else {
      this.currentHintUsed = false
    }

    const visibleLetters = [0, 1, 2, 3].filter((i) => !hidden.has(i))
    const columns = [0, 1, 2, 3]
    Phaser.Utils.Array.Shuffle(columns)

    for (let i = 0; i < visibleLetters.length; i++) {
      this._spawnLetter(visibleLetters[i], columns[i], PLAY_TOP)
    }
  }

  _spawnLetter(letterIdx, col, y) {
    const x = COL_XS[col]
    const letter = LETTER_KEYS[letterIdx]
    const sprite = this.add.image(x, y, `sa-letter-${letter}`).setDepth(10)
    const letterLabel = this.add.text(x, y, letter, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '30px',
      color: '#0c1220', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(11)
    const opt = (this.activeQuestion && this.activeQuestion.options[letterIdx]) || ''
    const optLabel = this.add.text(x, y + LETTER_BOX / 2 + 10, opt, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px',
      color: LETTER_HEX[letterIdx],
      wordWrap: { width: 150 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(11)
    this.letters.push({ sprite, letterLabel, optLabel, letterIdx, col, y })
  }

  _destroyLetter(L) {
    L.sprite.destroy()
    L.letterLabel.destroy()
    L.optLabel.destroy()
  }

  // ---------- Game loop ----------

  update(_, delta) {
    if (this.ended) return
    const dt = delta / 1000

    // Ship movement
    const leftDown = this.keys.left.isDown || this.keys.a.isDown
    const rightDown = this.keys.right.isDown || this.keys.d.isDown
    if (leftDown && !rightDown) this.ship.x -= SHIP_SPEED * dt
    else if (rightDown && !leftDown) this.ship.x += SHIP_SPEED * dt
    this.ship.x = Phaser.Math.Clamp(this.ship.x, 20, GAME_W - 20)

    // Firing
    const fireDown = this.keys.space.isDown || this.keys.up.isDown || this.keys.w.isDown
    if (fireDown) this._fireStraight()

    // Bullets
    const bSurvivors = []
    for (const b of this.bullets) {
      b.sprite.x += b.vx * dt
      b.sprite.y += b.vy * dt
      if (b.sprite.y < PLAY_TOP - 20 ||
          b.sprite.x < -20 || b.sprite.x > GAME_W + 20) {
        b.sprite.destroy()
        continue
      }
      bSurvivors.push(b)
    }
    this.bullets = bSurvivors

    // Letters (fall + bottom respawn)
    const lSurvivors = []
    for (const L of this.letters) {
      L.y += this.descentSpeed * dt
      if (L.y >= PLAY_BOTTOM) {
        this.hearts -= 1
        this._renderHearts()
        this._flash(0xef4444)
        if (this.hearts <= 0) {
          this._destroyLetter(L)
          this._endSession()
          return
        }
        L.y = PLAY_TOP
      }
      L.sprite.y = L.y
      L.letterLabel.y = L.y
      L.optLabel.y = L.y + LETTER_BOX / 2 + 10
      lSurvivors.push(L)
    }
    this.letters = lSurvivors

    // Collision: bullet vs letter
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const b = this.bullets[bi]
      for (let li = this.letters.length - 1; li >= 0; li--) {
        const L = this.letters[li]
        if (Math.abs(b.sprite.x - L.sprite.x) < LETTER_BOX / 2 &&
            Math.abs(b.sprite.y - L.y) < LETTER_BOX / 2) {
          b.sprite.destroy()
          this.bullets.splice(bi, 1)
          this._handleHit(L, li)
          break
        }
      }
    }
  }

  _fireStraight() {
    if (!this._canFire()) return
    const sprite = this.add.image(this.ship.x, SHIP_Y - SHIP_SIZE / 2 - 4, 'sa-bullet').setDepth(20)
    this.bullets.push({ sprite, vx: 0, vy: -BULLET_SPEED })
    this.lastFireTs = Date.now()
  }

  _fireAt(targetX, targetY) {
    if (!this._canFire()) return
    const srcX = this.ship.x
    const srcY = SHIP_Y - SHIP_SIZE / 2 - 4
    const dx = targetX - srcX
    const dy = targetY - srcY
    const len = Math.max(Math.hypot(dx, dy), 1)
    const vx = (dx / len) * BULLET_SPEED
    const vy = (dy / len) * BULLET_SPEED
    const sprite = this.add.image(srcX, srcY, 'sa-bullet').setDepth(20)
    sprite.setRotation(Math.atan2(vy, vx) + Math.PI / 2)
    this.bullets.push({ sprite, vx, vy })
    this.lastFireTs = Date.now()
  }

  _canFire() {
    return Date.now() - this.lastFireTs >= FIRE_INTERVAL
  }

  // ---------- Resolution ----------

  _handleHit(L, li) {
    const q = this.activeQuestion
    const stats = this.conceptStats[q.concept_id] ||= { correctStreak: 0, wrongStreak: 0 }

    if (L.letterIdx === q.answer_index) {
      // Correct
      this.letters.splice(li, 1)
      this._explodeLetter(L)
      for (const other of this.letters) {
        this.tweens.add({
          targets: [other.sprite, other.letterLabel, other.optLabel],
          alpha: 0, duration: 250,
          onComplete: () => this._destroyLetter(other),
        })
      }
      this.letters = []
      this.score += 10
      this.scoreText.setText(`Score: ${this.score}`)
      this._flash(0x10b981)
      stats.correctStreak += 1
      stats.wrongStreak = 0
      if (stats.correctStreak >= 2) {
        this.descentSpeed = this.descentSpeed * 1.2
        stats.correctStreak = 0
        this._banner('Descending faster! +20%', '#10b981')
      }
      this.time.delayedCall(320, () => {
        if (this.ended) return
        this._loadNextQuestion()
        if (!this.activeQuestion) this._nextLevel()
        else this._spawnWave()
      })
    } else {
      // Wrong
      const letterIdx = L.letterIdx
      const col = L.col
      this.letters.splice(li, 1)
      this._explodeLetter(L)
      this.hearts -= 1
      this._renderHearts()
      this._flash(0xef4444)
      stats.wrongStreak += 1
      stats.correctStreak = 0
      if (stats.wrongStreak >= 2) {
        this.hintPendingForNextWave = true
        this.hintsUsed += 1
        stats.wrongStreak = 0
        this._banner('Hint queued: 2 wrong letters will hide next wave', '#f59e0b')
      }
      if (this.hearts <= 0) return this._endSession()
      this.time.delayedCall(500, () => {
        if (this.ended) return
        this._spawnLetter(letterIdx, col, PLAY_TOP)
      })
    }
  }

  // ---------- Visual helpers ----------

  _explodeLetter(L) {
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2
      const c = this.add.circle(L.sprite.x, L.y, 3, 0xffffff, 0.95).setDepth(30)
      this.tweens.add({
        targets: c,
        x: L.sprite.x + Math.cos(ang) * 42,
        y: L.y + Math.sin(ang) * 42,
        alpha: 0,
        scale: 0.2,
        duration: 420,
        onComplete: () => c.destroy(),
      })
    }
    this._destroyLetter(L)
  }

  _flash(color) {
    this.cameras.main.flash(160, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(
      GAME_W / 2, QUESTION_STRIP_H + HUD_STRIP_H + 8, text, {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '15px', color,
        backgroundColor: '#0f172a', padding: { x: 12, y: 4 },
      },
    ).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: QUESTION_STRIP_H + HUD_STRIP_H - 4, duration, delay: 200,
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
