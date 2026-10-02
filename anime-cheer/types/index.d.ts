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
    'anime-cheer': { stage: StageView; anchor: string; frame: number }
  }
}
