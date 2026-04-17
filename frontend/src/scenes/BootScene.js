// Preloads sprites. For MVP we draw everything with Phaser graphics so there
// are no asset downloads to fail during the demo. Swap in Kenney.nl sprites
// once the mechanics are locked.
import Phaser from 'phaser'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  preload() {
    // Generated textures via Graphics objects. No external assets needed.
    const g = this.add.graphics()

    // Runner (cyan rounded square with face dot)
    g.fillStyle(0x0ea5e9)
    g.fillRoundedRect(0, 0, 48, 48, 8)
    g.fillStyle(0xffffff)
    g.fillCircle(34, 18, 4)
    g.generateTexture('runner', 48, 48)
    g.clear()

    // Obstacle: low spike (red triangle)
    g.fillStyle(0xef4444)
    g.fillTriangle(0, 40, 20, 0, 40, 40)
    g.generateTexture('obstacle', 40, 40)
    g.clear()

    // Obstacle: barrier (tall red rect — jump required)
    g.fillStyle(0xef4444)
    g.fillRoundedRect(0, 0, 40, 100, 4)
    g.fillStyle(0xffffff, 0.25)
    g.fillRect(4, 20, 32, 4)
    g.fillRect(4, 60, 32, 4)
    g.generateTexture('barrier', 40, 100)
    g.clear()

    // Obstacle: overhang (red rect hanging from top of lane — slide required)
    g.fillStyle(0xef4444)
    g.fillRoundedRect(0, 0, 60, 60, 4)
    g.fillStyle(0x991b1b)
    g.fillRect(0, 54, 60, 6)
    g.generateTexture('overhang', 60, 60)
    g.clear()

    // Coin (gold circle with highlight)
    g.fillStyle(0xfacc15)
    g.fillCircle(11, 11, 10)
    g.fillStyle(0xfde68a)
    g.fillCircle(8, 8, 3)
    g.generateTexture('coin', 22, 22)
    g.clear()

    // Ground strip
    g.fillStyle(0x1e293b)
    g.fillRect(0, 0, 64, 8)
    g.generateTexture('ground', 64, 8)
    g.clear()

    // Lane line (dashed): 32px tile with a 20px white segment
    g.fillStyle(0x475569)
    g.fillRect(0, 0, 20, 2)
    g.generateTexture('lane-line', 32, 2)
    g.clear()

    g.destroy()
  }

  create() {
    // Route to the scene that matches the requested game_type. Each game type
    // has its own Phaser scene keyed by the strings below. quiz_runner is kept
    // for backwards compat with older saved games.
    const data = this.scene.settings.data || {}
    const gameType = data?.game?.game_type || 'lane_runner'
    const sceneKey = {
      lane_runner: 'LaneRunnerScene',
      tetris_answer: 'TetrisAnswerScene',
      shooter_answer: 'ShooterAnswerScene',
      quiz_runner: 'GameScene',
    }[gameType] || 'LaneRunnerScene'
    this.scene.start(sceneKey, data)
  }
}
