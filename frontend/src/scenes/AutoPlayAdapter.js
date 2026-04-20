// AutoPlayAdapter
//
// Autonomous drivers for the 4 gameplay scenes, used by the landing-page
// backdrop. Each function takes a scene instance (already initialised in
// its `autoPlay: true` mode) and installs recurring timers that nudge the
// game forward without any human input. Each returns `{ stop() }` for
// teardown by the scene (not currently needed — scene.restart destroys
// all timers — but handy for future use).
//
// Style note: the AI is intentionally loose. We want it to look like a
// learner playing, not a bot grinding — some lane changes miss, some
// blocks land wrong, etc.

export function laneRunnerAutoPlay(scene) {
  const timer = scene.time.addEvent({
    delay: Phaser.Math.Between(2200, 2800),
    loop: true,
    callback: () => {
      if (scene.ended) return
      scene._changeLane(Phaser.Math.Between(0, 3))
    },
  })
  return { stop: () => timer.remove() }
}

export function tetrisAutoPlay(scene) {
  const timer = scene.time.addEvent({
    delay: 1500,
    loop: true,
    callback: () => {
      if (scene.ended) return
      const r = Math.random()
      if (r < 0.4) scene._moveBlockLeft()
      else if (r < 0.8) scene._moveBlockRight()
      // 20%: let it fall straight down
    },
  })
  return { stop: () => timer.remove() }
}

export function shooterAutoPlay(scene) {
  let patrolDir = 1
  const patrolTimer = scene.time.addEvent({
    delay: 80,
    loop: true,
    callback: () => {
      if (scene.ended || !scene.ship) return
      scene.ship.x += patrolDir * 1.5
      if (scene.ship.x > 900) patrolDir = -1
      else if (scene.ship.x < 60) patrolDir = 1
    },
  })
  const fireTimer = scene.time.addEvent({
    delay: 1200,
    loop: true,
    callback: () => {
      if (scene.ended || !scene.ship) return
      if (!scene.letters || scene.letters.length === 0) {
        if (scene._fireStraight) scene._fireStraight()
        return
      }
      let closest = null, bd = Infinity
      for (const L of scene.letters) {
        const d = Math.abs(L.sprite.x - scene.ship.x)
        if (d < bd) { bd = d; closest = L }
      }
      if (closest) scene._fireAt(closest.sprite.x, closest.y)
      else scene._fireStraight()
    },
  })
  return { stop: () => { patrolTimer.remove(); fireTimer.remove() } }
}

export function snakeAutoPlay(scene) {
  const COLS = 32, ROWS = 14
  const oppo = { up: 'down', down: 'up', left: 'right', right: 'left' }
  const delta = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
  const timer = scene.time.addEvent({
    delay: 500,
    loop: true,
    callback: () => {
      if (scene.ended || !scene.snake || !scene.snake.length) return
      const head = scene.snake[0]

      // Pick closest food as target
      let target = null, bd = Infinity
      for (const f of scene.foods || []) {
        const d = Math.abs(f.col - head.col) + Math.abs(f.row - head.row)
        if (d < bd) { bd = d; target = f }
      }

      // Rank direction candidates toward the target
      const candidates = []
      if (target) {
        const dx = target.col - head.col
        const dy = target.row - head.row
        if (Math.abs(dx) >= Math.abs(dy)) {
          if (dx > 0) candidates.push('right')
          else if (dx < 0) candidates.push('left')
          if (dy > 0) candidates.push('down')
          else if (dy < 0) candidates.push('up')
        } else {
          if (dy > 0) candidates.push('down')
          else if (dy < 0) candidates.push('up')
          if (dx > 0) candidates.push('right')
          else if (dx < 0) candidates.push('left')
        }
      }
      // Fallbacks: continue in current heading, then other lateral dirs
      for (const d of ['up', 'down', 'left', 'right']) {
        if (!candidates.includes(d)) candidates.push(d)
      }

      // First candidate that doesn't reverse and isn't a wall
      for (const d of candidates) {
        if (d === oppo[scene.dir]) continue
        const [dc, dr] = delta[d]
        const nc = head.col + dc, nr = head.row + dr
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue
        if (d !== scene.dir) scene._tryTurn(d)
        return
      }
    },
  })
  return { stop: () => timer.remove() }
}
