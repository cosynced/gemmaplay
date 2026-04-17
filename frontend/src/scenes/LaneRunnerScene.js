// LaneRunnerScene
//
// Standalone Phaser 3 scene for the lane-runner quiz game. Designed to be
// bootable from either the real React harness or the plain-HTML preview at
// /public/lane-runner-preview.html.
//
// Contract:
//   init(data): { game, lesson, sessionId, onSessionEnd }
//     game   = { game_id, lesson_id, game_type, levels: [
//                 { concept_id, base_speed?, questions: [question_id, ...] }
//               ] }
//     lesson = { concepts: [
//                 { id, name, questions: [{ id, q, options, answer_index }] }
//               ] }
//     sessionId: string
//     onSessionEnd({ score, hearts, time_seconds, hintsUsed })
//
// The scene generates ALL textures at runtime — no external asset downloads.

const GAME_W = 960
const GAME_H = 540
const LANE_COUNT = 4
const LANE_H = GAME_H / LANE_COUNT              // 135
const LANE_YS = Array.from({ length: LANE_COUNT }, (_, i) => LANE_H * (i + 0.5))
const RUNNER_X = 180
const RUNNER_SIZE = 48
const BASE_SPEED = 300
const JUMP_MS = 600
const JUMP_HEIGHT = 70
const SLIDE_MS = 500
const HUD_H = 60
const QUESTION_STRIP_H = 40
const GATE_SPAWN_X = GAME_W + 200

const COLOR = {
  bg: 0x0c1220,
  ground: 0x1e293b,
  runner: 0x0ea5e9,
  obstacle: 0xef4444,
  coin: 0xfacc15,
  correct: 0x10b981,
  dimmed: 0x475569,
  text: '#e2e8f0',
}

export class LaneRunnerScene extends Phaser.Scene {
  constructor() {
    super('LaneRunnerScene')
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

    // Per-concept streak tracking for the harness-local adaptation
    this.conceptStats = {}            // { conceptId: { correctStreak, wrongStreak } }
    this.reducedOptionsForNextGate = 0

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

  // ---------- Preload: generate all textures ----------

  preload() {
    const g = this.add.graphics()

    // Runner — cyan rounded square with a face dot
    g.fillStyle(COLOR.runner)
    g.fillRoundedRect(0, 0, RUNNER_SIZE, RUNNER_SIZE, 8)
    g.fillStyle(0xffffff)
    g.fillCircle(RUNNER_SIZE - 14, 18, 4)
    g.generateTexture('lr-runner', RUNNER_SIZE, RUNNER_SIZE)
    g.clear()

    // Spike — 40×40 triangle (low to ground)
    g.fillStyle(COLOR.obstacle)
    g.fillTriangle(0, 40, 20, 0, 40, 40)
    g.generateTexture('lr-spike', 40, 40)
    g.clear()

    // Barrier — 60×110 tall rect with stripe accents
    g.fillStyle(COLOR.obstacle)
    g.fillRoundedRect(0, 0, 60, 110, 6)
    g.fillStyle(0xffffff, 0.25)
    g.fillRect(6, 22, 48, 4)
    g.fillRect(6, 64, 48, 4)
    g.generateTexture('lr-barrier', 60, 110)
    g.clear()

    // Overhang — 60×70 rect with an underline band
    g.fillStyle(COLOR.obstacle)
    g.fillRoundedRect(0, 0, 60, 70, 6)
    g.fillStyle(0x991b1b)
    g.fillRect(0, 62, 60, 8)
    g.generateTexture('lr-overhang', 60, 70)
    g.clear()

    // Coin — gold circle w/ highlight
    g.fillStyle(COLOR.coin)
    g.fillCircle(11, 11, 10)
    g.fillStyle(0xfde68a)
    g.fillCircle(8, 8, 3)
    g.generateTexture('lr-coin', 22, 22)
    g.clear()

    // Ground strip tile
    g.fillStyle(COLOR.ground)
    g.fillRect(0, 0, 64, 8)
    g.generateTexture('lr-ground', 64, 8)
    g.clear()

    // Lane separator line tile (dashed)
    g.fillStyle(COLOR.ground)
    g.fillRect(0, 0, 28, 2)
    g.generateTexture('lr-lane', 40, 2)
    g.clear()

    g.destroy()
  }

  // ---------- Create ----------

  create() {
    this.cameras.main.setBackgroundColor(COLOR.bg)

    // Lane separators (3 between 4 lanes)
    this.laneLines = []
    for (let i = 1; i < LANE_COUNT; i++) {
      const y = LANE_H * i
      const tile = this.add.tileSprite(GAME_W / 2, y, GAME_W, 2, 'lr-lane').setAlpha(0.5)
      this.laneLines.push(tile)
    }

    // Ground strip at the bottom
    this.ground = this.add.tileSprite(GAME_W / 2, GAME_H - 4, GAME_W, 8, 'lr-ground')

    // Runner — fixed x, lane-driven y. Start in lane 1.
    this.currentLane = 1
    this.runnerBaseY = LANE_YS[this.currentLane]
    this.runner = this.add.sprite(RUNNER_X, this.runnerBaseY, 'lr-runner').setDepth(50)
    this.isJumping = false
    this.jumpStart = 0
    this.isSliding = false
    this.slideStart = 0
    this.runnerLaneTween = null

    // World-object lists
    this.obstacles = []
    this.coins = []
    this.activeGate = null

    this._buildHUD()
    this._setupInput()
    this._startLevel()
  }

  // ---------- HUD ----------

  _buildHUD() {
    this.hudBar = this.add.rectangle(GAME_W / 2, HUD_H / 2, GAME_W, HUD_H, 0x0f172a, 0.94)
      .setDepth(200)
    this.hudBar.setStrokeStyle(1, COLOR.ground)

    this.scoreText = this.add.text(16, HUD_H / 2, 'Score: 0', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '20px', color: COLOR.text,
    }).setOrigin(0, 0.5).setDepth(201)

    this.heartsText = this.add.text(GAME_W - 16, HUD_H / 2, '\u2665 \u2665 \u2665', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '24px', color: '#ef4444',
    }).setOrigin(1, 0.5).setDepth(201)

    this.levelText = this.add.text(GAME_W / 2, HUD_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px', color: '#94a3b8',
    }).setOrigin(0.5).setDepth(201)

    // Question strip under the HUD
    this.questionStripBg = this.add.rectangle(
      GAME_W / 2, HUD_H + QUESTION_STRIP_H / 2, GAME_W, QUESTION_STRIP_H, 0x0f172a, 0.75,
    ).setDepth(200)
    this.questionText = this.add.text(GAME_W / 2, HUD_H + QUESTION_STRIP_H / 2, '', {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px', color: COLOR.text,
      wordWrap: { width: GAME_W - 40 }, align: 'center',
    }).setOrigin(0.5).setDepth(201)
  }

  _renderHearts() {
    const n = Math.max(this.hearts, 0)
    this.heartsText.setText(n > 0 ? Array(n).fill('\u2665').join(' ') : '—')
  }

  // ---------- Input ----------

  _setupInput() {
    this.input.keyboard.on('keydown', (ev) => {
      if (this.ended) return
      const key = ev.key
      if (key === 'ArrowUp' || key === 'w' || key === 'W') {
        this._moveLaneUp()
      } else if (key === 'ArrowDown' || key === 's' || key === 'S') {
        this._moveLaneDown()
      } else if (key === ' ' || key === 'Spacebar' || key === 'ArrowRight') {
        this._jump()
      } else if (key === 'Shift' || key === 'ArrowLeft') {
        this._slide()
      } else if (['1', '2', '3', '4'].includes(key)) {
        this._snapToLane(parseInt(key, 10) - 1)
      }
    })

    // Pointer (mouse + touch): swipe for directional actions, tap for jump/slide.
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
    if (dir === 'up') this._moveLaneUp()
    else if (dir === 'down') this._moveLaneDown()
    else if (dir === 'right') this._jump()
    else if (dir === 'left') this._slide()
  }

  _handleTap(_x, y) {
    if (y < GAME_H / 2) this._jump()
    else this._slide()
  }

  _moveLaneUp() {
    this._changeLane(this.currentLane - 1)
  }

  _moveLaneDown() {
    this._changeLane(this.currentLane + 1)
  }

  _changeLane(toLane) {
    const clamped = Phaser.Math.Clamp(toLane, 0, LANE_COUNT - 1)
    if (clamped === this.currentLane) return
    this.currentLane = clamped
    this.runnerBaseY = LANE_YS[clamped]
    if (this.runnerLaneTween) this.runnerLaneTween.stop()
    this.runnerLaneTween = this.tweens.add({
      targets: this.runner,
      y: this.runnerBaseY,
      duration: 150,
      ease: 'Sine.easeOut',
    })
  }

  _snapToLane(lane) {
    this._changeLane(lane)
  }

  _jump() {
    if (this.isJumping || this.isSliding) return
    this.isJumping = true
    this.jumpStart = Date.now()
  }

  _slide() {
    if (this.isSliding || this.isJumping) return
    this.isSliding = true
    this.slideStart = Date.now()
    this.runner.setScale(1, 0.5)
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

    this.scrollSpeed = level.base_speed || BASE_SPEED

    this._loadNextQuestion()
    this._scheduleGate(2000)       // short first delay so the first gate arrives quickly
    this._scheduleObstacle()
    this._scheduleCoin()
  }

  _loadNextQuestion() {
    if (this.levelQuestions.length === 0) {
      this.pendingQuestion = null
      this.questionText.setText('')
      return
    }
    this.pendingQuestion = this.levelQuestions[0]
    this.questionText.setText(this.pendingQuestion.q)
  }

  _nextLevel() {
    this.levelIdx += 1
    if (this.levelIdx >= this.gameData.levels.length) {
      return this._endSession()
    }
    this._clearTimers()
    this._clearWorld()
    this._banner(`Level ${this.levelIdx + 1}`, '#0ea5e9')
    this.time.delayedCall(900, () => this._startLevel())
  }

  _clearTimers() {
    if (this._gateTimer) { this._gateTimer.remove(); this._gateTimer = null }
    if (this._obstacleTimer) { this._obstacleTimer.remove(); this._obstacleTimer = null }
    if (this._coinTimer) { this._coinTimer.remove(); this._coinTimer = null }
  }

  _clearWorld() {
    for (const ob of this.obstacles) ob.sprite.destroy()
    this.obstacles = []
    for (const c of this.coins) c.sprite.destroy()
    this.coins = []
    if (this.activeGate) {
      for (const d of this.activeGate.doors) { d.bg.destroy(); d.label.destroy() }
      this.activeGate = null
    }
  }

  // ---------- Spawning ----------

  _scheduleGate(delay) {
    if (this._gateTimer) this._gateTimer.remove()
    // Default cadence: every ~12s. First gate uses the passed-in short delay.
    const ms = typeof delay === 'number' ? delay : 12000 - 3000 // minus gate transit
    this._gateTimer = this.time.delayedCall(ms, () => this._spawnGate())
  }

  _scheduleObstacle() {
    if (this._obstacleTimer) this._obstacleTimer.remove()
    const delay = Phaser.Math.Between(2000, 4000)
    this._obstacleTimer = this.time.delayedCall(delay, () => {
      this._spawnObstacle()
      this._scheduleObstacle()
    })
  }

  _scheduleCoin() {
    if (this._coinTimer) this._coinTimer.remove()
    const delay = Phaser.Math.Between(5000, 8000)
    this._coinTimer = this.time.delayedCall(delay, () => {
      this._spawnCoinCluster()
      this._scheduleCoin()
    })
  }

  _spawnObstacle() {
    if (this.activeGate) return
    const type = Phaser.Utils.Array.GetRandom(['spike', 'barrier', 'overhang'])
    const lane = Phaser.Math.Between(0, LANE_COUNT - 1)
    const y = LANE_YS[lane]
    let sprite
    if (type === 'spike') {
      // Sits on ground of the lane — origin bottom
      sprite = this.add.sprite(GAME_W + 60, y + LANE_H / 2 - 4, 'lr-spike').setOrigin(0.5, 1)
    } else if (type === 'barrier') {
      sprite = this.add.sprite(GAME_W + 60, y, 'lr-barrier')
    } else {
      // Hangs from top of the lane
      sprite = this.add.sprite(GAME_W + 60, y - LANE_H / 2 + 35, 'lr-overhang')
    }
    sprite.setDepth(10)
    this.obstacles.push({ sprite, lane, type, hit: false })
  }

  _spawnCoinCluster() {
    if (this.activeGate) return
    const lane = Phaser.Math.Between(0, LANE_COUNT - 1)
    const y = LANE_YS[lane]
    const count = Phaser.Math.Between(3, 5)
    for (let i = 0; i < count; i++) {
      const sprite = this.add.sprite(GAME_W + 60 + i * 32, y, 'lr-coin').setDepth(10)
      this.coins.push({ sprite, lane, collected: false })
    }
  }

  _spawnGate() {
    if (!this.pendingQuestion) return
    const q = this.levelQuestions.shift()

    this.activeGate = {
      question: q,
      x: GATE_SPAWN_X,
      doors: [],
      resolved: false,
      dimmed: new Set(),
      hintUsed: this.reducedOptionsForNextGate > 0,
      spawnTs: Date.now(),
    }

    if (this.reducedOptionsForNextGate > 0) {
      this._dimWrongDoors(q, this.reducedOptionsForNextGate)
      this.reducedOptionsForNextGate = 0
    }

    for (let i = 0; i < LANE_COUNT; i++) {
      const y = LANE_YS[i]
      const letter = String.fromCharCode(65 + i)
      const opt = q.options[i] ?? ''
      const isDimmed = this.activeGate.dimmed.has(i)
      const bgColor = isDimmed ? COLOR.dimmed : COLOR.correct
      const alpha = isDimmed ? 0.4 : 0.92
      const bg = this.add.rectangle(GATE_SPAWN_X, y, 150, LANE_H - 24, bgColor, alpha)
        .setStrokeStyle(3, 0xffffff, isDimmed ? 0.25 : 0.85)
        .setDepth(20)
      const label = this.add.text(GATE_SPAWN_X, y, `${letter}\n${opt}`, {
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px',
        color: isDimmed ? '#94a3b8' : '#ffffff',
        wordWrap: { width: 138 }, align: 'center',
      }).setOrigin(0.5).setDepth(21)
      this.activeGate.doors.push({ bg, label, lane: i })
    }

    this._banner('Question!', '#0ea5e9', 900)
  }

  _dimWrongDoors(q, keepCount) {
    const correct = q.answer_index
    const wrongs = [0, 1, 2, 3].filter((i) => i !== correct)
    Phaser.Utils.Array.Shuffle(wrongs)
    const keepWrongs = wrongs.slice(0, Math.max(keepCount - 1, 0))
    const keepers = new Set([correct, ...keepWrongs])
    for (let i = 0; i < LANE_COUNT; i++) {
      if (!keepers.has(i)) this.activeGate.dimmed.add(i)
    }
  }

  // ---------- Game loop ----------

  update(_, delta) {
    if (this.ended) return
    const dt = delta / 1000
    if (this.ground) this.ground.tilePositionX += this.scrollSpeed * dt
    for (const line of this.laneLines) line.tilePositionX += this.scrollSpeed * dt

    this._updateRunner()
    this._updateObstacles(dt)
    this._updateCoins(dt)
    this._updateGate(dt)
  }

  _updateRunner() {
    if (this.isJumping) {
      const t = (Date.now() - this.jumpStart) / JUMP_MS
      if (t >= 1) {
        this.isJumping = false
        this.runner.y = this.runnerBaseY
      } else {
        const up = JUMP_HEIGHT * 4 * t * (1 - t)
        this.runner.y = this.runnerBaseY - up
      }
    }
    if (this.isSliding) {
      if (Date.now() - this.slideStart >= SLIDE_MS) {
        this.isSliding = false
        this.runner.setScale(1, 1)
      }
    }
  }

  _updateObstacles(dt) {
    const survivors = []
    for (const ob of this.obstacles) {
      ob.sprite.x -= this.scrollSpeed * dt
      if (ob.sprite.x < -80) { ob.sprite.destroy(); continue }
      if (!ob.hit && ob.lane === this.currentLane &&
          Math.abs(ob.sprite.x - RUNNER_X) < 32) {
        const dodged = (
          (ob.type === 'spike' && (this.isJumping || this.isSliding)) ||
          (ob.type === 'barrier' && this.isJumping) ||
          (ob.type === 'overhang' && this.isSliding)
        )
        if (!dodged) {
          ob.hit = true
          this._onObstacleHit()
        }
      }
      survivors.push(ob)
    }
    this.obstacles = survivors
  }

  _updateCoins(dt) {
    const survivors = []
    for (const c of this.coins) {
      c.sprite.x -= this.scrollSpeed * dt
      if (c.sprite.x < -60) { c.sprite.destroy(); continue }
      if (!c.collected && c.lane === this.currentLane &&
          Math.abs(c.sprite.x - RUNNER_X) < 26) {
        c.collected = true
        this.score += 1
        this.scoreText.setText(`Score: ${this.score}`)
        this.tweens.add({
          targets: c.sprite, alpha: 0, scale: 1.8, duration: 220,
          onComplete: () => c.sprite.destroy(),
        })
        continue
      }
      survivors.push(c)
    }
    this.coins = survivors
  }

  _updateGate(dt) {
    if (!this.activeGate || this.activeGate.resolved) return
    this.activeGate.x -= this.scrollSpeed * dt
    for (const d of this.activeGate.doors) {
      d.bg.x = this.activeGate.x
      d.label.x = this.activeGate.x
    }
    if (this.activeGate.x <= RUNNER_X) this._resolveGate()
  }

  // ---------- Resolution ----------

  _resolveGate() {
    const gate = this.activeGate
    gate.resolved = true
    const q = gate.question
    const chosenIdx = this.currentLane
    const correct = chosenIdx === q.answer_index

    for (const d of gate.doors) { d.bg.destroy(); d.label.destroy() }
    this.activeGate = null

    const stats = this.conceptStats[q.concept_id] ||= { correctStreak: 0, wrongStreak: 0 }

    if (correct) {
      this.score += 10
      this.scoreText.setText(`Score: ${this.score}`)
      this._flash(COLOR.correct)
      stats.correctStreak += 1
      stats.wrongStreak = 0
      if (stats.correctStreak >= 2) {
        this.scrollSpeed = Math.floor(this.scrollSpeed * 1.1)
        stats.correctStreak = 0
        this._banner('Speeding up! +10%', '#10b981')
      }
    } else {
      this.hearts -= 1
      this._renderHearts()
      this._flash(COLOR.obstacle)
      stats.wrongStreak += 1
      stats.correctStreak = 0
      if (stats.wrongStreak >= 2) {
        this.reducedOptionsForNextGate = 2
        this.hintsUsed += 1
        stats.wrongStreak = 0
        this._banner('Hint: narrowing to 2 options', '#f59e0b')
      }
      if (this.hearts <= 0) return this._endSession()
    }

    if (this.levelQuestions.length === 0) return this._nextLevel()
    this._loadNextQuestion()
    this._scheduleGate()
  }

  _onObstacleHit() {
    this.hearts -= 1
    this._renderHearts()
    this._flash(COLOR.obstacle)
    if (this.hearts <= 0) return this._endSession()
  }

  // ---------- Visual helpers ----------

  _flash(color) {
    this.cameras.main.flash(180, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1500) {
    const t = this.add.text(GAME_W / 2, HUD_H + QUESTION_STRIP_H + 16, text, {
      fontFamily: 'Inter, system-ui, sans-serif', fontSize: '18px', color,
      backgroundColor: '#0f172a', padding: { x: 14, y: 6 },
    }).setOrigin(0.5, 0).setDepth(202)
    this.tweens.add({
      targets: t, alpha: 0, y: HUD_H + QUESTION_STRIP_H - 4, duration, delay: 200,
      onComplete: () => t.destroy(),
    })
  }

  _endSession() {
    if (this.ended) return
    this.ended = true
    this._clearTimers()
    this.onSessionEnd({
      score: this.score,
      hearts: Math.max(this.hearts, 0),
      time_seconds: Math.floor((Date.now() - this.startTs) / 1000),
      hintsUsed: this.hintsUsed,
    })
  }
}
