// GameScene: lane-runner quiz game.
//
// 4 lanes scroll right-to-left; runner stays at x=RUNNER_X and changes lanes
// on the Y axis. Between answer gates, the player dodges obstacles and grabs
// coins. Every ~12-15s an answer gate appears: 4 doors, one per lane, each
// labeled A/B/C/D with its option text. Whichever lane the runner is in when
// the gate reaches RUNNER_X is the selected answer.
//
// Adaptation contract preserved:
//  - POST /api/sessions/event after each gate resolution
//  - show_hint       → dim wrong-answer doors for the NEXT gate
//  - raise_difficulty → bump scrollSpeed + obstacle density
//  - 0 hearts        → onSessionEnd(stats)
//
import Phaser from 'phaser'
import { api } from '../api/client.js'
import { logError } from '../utils/errorLogger.js'

const GAME_W = 960
const GAME_H = 540
const LANE_COUNT = 4
const LANE_H = GAME_H / LANE_COUNT                // 135
const LANE_YS = Array.from({ length: LANE_COUNT }, (_, i) => LANE_H * (i + 0.5))
const RUNNER_X = 180
const JUMP_DURATION = 600                          // ms
const JUMP_HEIGHT = 70                             // px peak above lane center
const SLIDE_DURATION = 500                         // ms
const GATE_SPAWN_X = GAME_W + 180                  // offscreen right
const HUD_HEIGHT = 64
const HUD_DEPTH = 100

export class GameScene extends Phaser.Scene {
  constructor() {
    super('GameScene')
  }

  init(data) {
    // data = { game, lesson, sessionId, onSessionEnd }
    this.gameData = data.game
    this.lessonData = data.lesson
    this.sessionId = data.sessionId
    this.onSessionEnd = data.onSessionEnd || (() => {})

    this.levelIdx = 0
    this.score = 0
    this.hearts = 3
    this.hintsUsed = 0
    this.startTs = Date.now()
    this.ended = false

    this.questionsByLevel = this.gameData.levels.map((lvl) =>
      lvl.questions.map((qid) => this._findQuestion(qid)).filter(Boolean)
    )
  }

  _findQuestion(qid) {
    for (const c of this.lessonData.concepts) {
      const q = c.questions.find((x) => x.id === qid)
      if (q) return { ...q, concept_id: c.id, concept_name: c.name }
    }
    return null
  }

  create() {
    this.cameras.main.setBackgroundColor('#0c1220')

    // Scrolling lane separators (3 lines between 4 lanes)
    this.laneLines = []
    for (let i = 1; i < LANE_COUNT; i++) {
      const y = LANE_H * i
      const line = this.add.tileSprite(GAME_W / 2, y, GAME_W, 2, 'lane-line').setAlpha(0.4)
      this.laneLines.push(line)
    }

    // Ground strip along the bottom
    this.ground = this.add.tileSprite(GAME_W / 2, GAME_H - 4, GAME_W, 8, 'ground')

    // Runner (fixed x, lane-driven y). Start in lane 1 (second from top).
    this.currentLane = 1
    this.runnerTargetY = LANE_YS[this.currentLane]
    this.runnerBaseY = this.runnerTargetY
    this.runner = this.add.sprite(RUNNER_X, this.runnerBaseY, 'runner')
    this.runner.setDepth(50)
    this.isJumping = false
    this.jumpStart = 0
    this.isSliding = false
    this.slideStart = 0

    // World-object lists
    this.obstacles = []
    this.coins = []
    this.activeGate = null
    this.reducedOptionsForNextGate = 0

    this._buildHUD()
    this._setupInput()
    this._startLevel()
  }

  // ---------- HUD ----------

  _buildHUD() {
    this.hudBar = this.add.rectangle(GAME_W / 2, HUD_HEIGHT / 2, GAME_W, HUD_HEIGHT, 0x0f172a, 0.88)
      .setDepth(HUD_DEPTH)
    this.hudBar.setStrokeStyle(1, 0x1e293b)

    this.scoreText = this.add.text(16, 10, 'Score: 0', {
      fontFamily: 'Inter, sans-serif', fontSize: '18px', color: '#e2e8f0',
    }).setDepth(HUD_DEPTH + 1)

    this.heartsText = this.add.text(GAME_W - 16, 10, '\u2665 \u2665 \u2665', {
      fontFamily: 'Inter, sans-serif', fontSize: '22px', color: '#ef4444',
    }).setOrigin(1, 0).setDepth(HUD_DEPTH + 1)

    this.levelText = this.add.text(GAME_W / 2, 8, '', {
      fontFamily: 'Inter, sans-serif', fontSize: '13px', color: '#94a3b8',
    }).setOrigin(0.5, 0).setDepth(HUD_DEPTH + 1)

    this.questionText = this.add.text(GAME_W / 2, 28, '', {
      fontFamily: 'Inter, sans-serif', fontSize: '14px', color: '#f1f5f9',
      wordWrap: { width: GAME_W - 260 }, align: 'center',
    }).setOrigin(0.5, 0).setDepth(HUD_DEPTH + 1)
  }

  _renderHearts() {
    const n = Math.max(this.hearts, 0)
    this.heartsText.setText(n > 0 ? Array(n).fill('\u2665').join(' ') : '—')
  }

  // ---------- Input ----------

  _setupInput() {
    this.input.keyboard.on('keydown', (ev) => {
      if (this.ended) return
      const key = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key
      switch (key) {
        case 'ArrowUp':
        case 'W':
          this._jump(); break
        case 'ArrowDown':
        case 'S':
          this._slide(); break
        case 'ArrowLeft':
          this._changeLane(this.currentLane - 1); break
        case 'ArrowRight':
          this._changeLane(this.currentLane + 1); break
        case '1': case 'A': this._snapToLane(0); break
        case '2': case 'B': this._snapToLane(1); break
        case '3': case 'C': this._snapToLane(2); break
        case '4': case 'D': this._snapToLane(3); break
        default: break
      }
    })

    // Touch swipes
    let startX = 0, startY = 0, startT = 0
    this.input.on('pointerdown', (p) => {
      startX = p.x; startY = p.y; startT = Date.now()
    })
    this.input.on('pointerup', (p) => {
      if (this.ended) return
      const dx = p.x - startX
      const dy = p.y - startY
      const dt = Date.now() - startT
      if (dt > 600) return
      const absX = Math.abs(dx), absY = Math.abs(dy)
      if (Math.max(absX, absY) < 28) return
      if (absX > absY) {
        if (dx > 0) this._changeLane(this.currentLane + 1)
        else this._changeLane(this.currentLane - 1)
      } else {
        if (dy < 0) this._jump()
        else this._slide()
      }
    })
  }

  _changeLane(toLane) {
    const clamped = Phaser.Math.Clamp(toLane, 0, LANE_COUNT - 1)
    if (clamped === this.currentLane) return
    this.currentLane = clamped
    this.runnerTargetY = LANE_YS[clamped]
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
      `Level ${this.levelIdx + 1}/${this.gameData.levels.length} — ${concept.name}`
    )

    this.scrollSpeed = level.base_speed || 300
    this.obstacleInterval = 1700   // ms
    this.coinInterval = 3200       // ms

    this._loadNextQuestion()
    this._scheduleGate()
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
      for (const d of this.activeGate.doors) {
        d.bg.destroy(); d.label.destroy()
      }
      this.activeGate = null
    }
  }

  // ---------- Spawning ----------

  _scheduleGate() {
    if (this._gateTimer) this._gateTimer.remove()
    // 12-15s target cadence minus ~3s gate transit = 9-12s wait between spawns.
    const delay = Phaser.Math.Between(9000, 12000)
    this._gateTimer = this.time.delayedCall(delay, () => this._spawnGate())
  }

  _scheduleObstacle() {
    if (this._obstacleTimer) this._obstacleTimer.remove()
    const base = this.obstacleInterval
    const delay = Phaser.Math.Between(Math.floor(base * 0.7), Math.floor(base * 1.3))
    this._obstacleTimer = this.time.delayedCall(delay, () => {
      this._spawnObstacle()
      this._scheduleObstacle()
    })
  }

  _scheduleCoin() {
    if (this._coinTimer) this._coinTimer.remove()
    const base = this.coinInterval
    const delay = Phaser.Math.Between(Math.floor(base * 0.7), Math.floor(base * 1.3))
    this._coinTimer = this.time.delayedCall(delay, () => {
      this._spawnCoinCluster()
      this._scheduleCoin()
    })
  }

  _spawnObstacle() {
    if (this.activeGate) return // keep the gate area clean
    const types = ['spike', 'barrier', 'overhang']
    const type = Phaser.Utils.Array.GetRandom(types)
    const lane = Phaser.Math.Between(0, LANE_COUNT - 1)
    const y = LANE_YS[lane]
    let sprite
    if (type === 'spike') {
      sprite = this.add.sprite(GAME_W + 60, y + 30, 'obstacle').setOrigin(0.5, 1)
    } else if (type === 'barrier') {
      sprite = this.add.sprite(GAME_W + 60, y, 'barrier')
    } else {
      // overhang hangs from the top of the lane
      sprite = this.add.sprite(GAME_W + 60, y - LANE_H / 2 + 30, 'overhang')
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
      const sprite = this.add.sprite(GAME_W + 60 + i * 34, y, 'coin').setDepth(10)
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
      const dimmed = this.activeGate.dimmed.has(i)
      const bgColor = dimmed ? 0x475569 : 0x10b981
      const alpha = dimmed ? 0.35 : 0.9
      const doorBg = this.add.rectangle(GATE_SPAWN_X, y, 140, LANE_H - 24, bgColor, alpha)
        .setStrokeStyle(3, 0xffffff, dimmed ? 0.25 : 0.8)
        .setDepth(20)
      const doorText = this.add.text(GATE_SPAWN_X, y, `${letter}\n${opt}`, {
        fontFamily: 'Inter, sans-serif', fontSize: '14px',
        color: dimmed ? '#94a3b8' : '#ffffff',
        wordWrap: { width: 128 }, align: 'center',
      }).setOrigin(0.5).setDepth(21)
      this.activeGate.doors.push({ bg: doorBg, label: doorText, lane: i })
    }

    this._banner('Question approaching!', '#0ea5e9', 1000)
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

    // Parallax
    if (this.ground) this.ground.tilePositionX += this.scrollSpeed * dt
    for (const line of this.laneLines) line.tilePositionX += this.scrollSpeed * dt

    this._updateRunner(dt)
    this._updateObstacles(dt)
    this._updateCoins(dt)
    this._updateGate(dt)
  }

  _updateRunner(dt) {
    // Smooth lane Y interpolation (independent of jump arc)
    const k = Math.min(1, dt * 16)
    this.runnerBaseY += (this.runnerTargetY - this.runnerBaseY) * k
    let jumpOffset = 0
    if (this.isJumping) {
      const t = (Date.now() - this.jumpStart) / JUMP_DURATION
      if (t >= 1) {
        this.isJumping = false
      } else {
        jumpOffset = JUMP_HEIGHT * 4 * t * (1 - t)
      }
    }
    this.runner.y = this.runnerBaseY - jumpOffset
    if (this.isSliding) {
      if (Date.now() - this.slideStart >= SLIDE_DURATION) {
        this.isSliding = false
        this.runner.setScale(1, 1)
      }
    }
  }

  _updateObstacles(dt) {
    const survivors = []
    for (const ob of this.obstacles) {
      ob.sprite.x -= this.scrollSpeed * dt
      if (ob.sprite.x < -80) {
        ob.sprite.destroy()
        continue
      }
      if (!ob.hit && ob.lane === this.currentLane &&
          Math.abs(ob.sprite.x - RUNNER_X) < 30) {
        const dodged = (
          (ob.type === 'spike' && this.isJumping) ||
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
      if (c.sprite.x < -60) {
        c.sprite.destroy()
        continue
      }
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
    if (this.activeGate.x <= RUNNER_X) {
      this._resolveGate()
    }
  }

  // ---------- Resolution ----------

  _resolveGate() {
    const gate = this.activeGate
    gate.resolved = true
    const q = gate.question
    const chosenIdx = this.currentLane
    const correct = chosenIdx === q.answer_index
    const timeMs = Date.now() - gate.spawnTs

    for (const d of gate.doors) {
      d.bg.destroy()
      d.label.destroy()
    }
    this.activeGate = null

    if (correct) {
      this.score += 10
      this.scoreText.setText(`Score: ${this.score}`)
      this.scrollSpeed = Math.floor(this.scrollSpeed * 1.05)
      this._flash(0x10b981)
    } else {
      this.hearts -= 1
      this._renderHearts()
      this._flash(0xef4444)
      const recovered = this.scrollSpeed
      this.scrollSpeed = Math.floor(this.scrollSpeed * 0.7)
      this.time.delayedCall(1000, () => {
        if (!this.ended) this.scrollSpeed = recovered
      })
      if (this.hearts <= 0) {
        this._postEvent(q, correct, gate.hintUsed, timeMs)
        return this._endSession()
      }
    }

    this._postEvent(q, correct, gate.hintUsed, timeMs)

    if (this.levelQuestions.length === 0) {
      return this._nextLevel()
    }
    this._loadNextQuestion()
    this._scheduleGate()
  }

  _onObstacleHit() {
    this.hearts -= 1
    this._renderHearts()
    this._flash(0xef4444)
    if (this.hearts <= 0) return this._endSession()
  }

  async _postEvent(q, correct, hintUsed, timeMs) {
    try {
      const signal = await api.postEvent({
        session_id: this.sessionId,
        concept_id: q.concept_id,
        question_id: q.id,
        correct,
        hint_used: hintUsed,
        time_ms: timeMs,
      })
      this._applySignal(signal)
    } catch (e) {
      // Gameplay must not die on a flaky analytics POST. The final
      // /sessions/end call still captures the session outcome.
      logError(e, { where: 'GameScene.postEvent', sessionId: this.sessionId })
    }
  }

  _applySignal(signal) {
    if (!signal || signal.action === 'noop') return
    if (signal.action === 'raise_difficulty') {
      const mult = signal.payload?.speed_mult || 1.1
      this.scrollSpeed = Math.floor(this.scrollSpeed * mult)
      this.obstacleInterval = Math.max(700, Math.floor(this.obstacleInterval * 0.85))
      this._banner(`Speeding up! +${Math.round((mult - 1) * 100)}%`, '#10b981')
    }
    if (signal.action === 'show_hint') {
      this.hintsUsed += 1
      this.reducedOptionsForNextGate = signal.payload?.reduce_options_to || 2
      this._banner(`Hint: narrowing to ${this.reducedOptionsForNextGate} options`, '#f59e0b')
    }
  }

  // ---------- Visual helpers ----------

  _flash(color) {
    this.cameras.main.flash(160, (color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff)
  }

  _banner(text, color, duration = 1800) {
    const t = this.add.text(GAME_W / 2, 80, text, {
      fontFamily: 'Inter, sans-serif', fontSize: '18px', color,
      backgroundColor: '#0f172a', padding: { x: 14, y: 6 },
    }).setOrigin(0.5, 0).setDepth(HUD_DEPTH + 2)
    this.tweens.add({
      targets: t, alpha: 0, y: 60, duration, delay: 200,
      onComplete: () => t.destroy(),
    })
  }

  _endSession() {
    if (this.ended) return
    this.ended = true
    this._clearTimers()
    this.onSessionEnd({
      score: this.score,
      hearts: this.hearts,
      time_seconds: Math.floor((Date.now() - this.startTs) / 1000),
      hintsUsed: this.hintsUsed,
    })
  }
}
