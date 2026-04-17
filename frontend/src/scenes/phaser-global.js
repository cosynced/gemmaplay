// LaneRunnerScene / TetrisAnswerScene / ShooterAnswerScene were written to
// run from plain-HTML previews where Phaser is loaded via <script> tag, so
// they reference `Phaser` as a global. When imported as ES modules in the
// Vite build, no such global exists — pulling this file in once (before the
// scene modules) pins Phaser onto globalThis so those scenes can resolve
// `Phaser.Scene`, `Phaser.Math`, etc.
import Phaser from 'phaser'

if (typeof globalThis !== 'undefined' && !globalThis.Phaser) {
  globalThis.Phaser = Phaser
}

export default Phaser
