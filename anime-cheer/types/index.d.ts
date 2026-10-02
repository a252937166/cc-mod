export type StageBubble = {
  key: string
  name: string
  color: string
  text: string
  x: number
  head: number
}

export type StageView = { caption: string; bubbles: StageBubble[] }

declare module 'claude-code' {
  interface PluginState {
    // `anchorMark`: one per transcript row, the time it became the stage's
    // anchor, or 0 once it no longer is.
    'anime-cheer': { stage: StageView; anchorMark: StateFamily<number>; frame: number }
  }
}
