// Stub bridge for the layout harness: captures the renderer's callbacks so the
// harness can push a payload, and no-ops every window control.
window.__cb = {}
window.claudeOMeter = {
  onUsageData: (f) => { window.__cb.usage = f },
  onClaudeSwap: (f) => { window.__cb.swap = f },
  onSettingsChange: (f) => { window.__cb.settings = f },
  getSettings: () => Promise.resolve({ theme: 'dark', claudeUsage: true }),
  minimize() {}, close() {}, showContextMenu() {},
  dragStart() {}, dragEnd() {}, moveWindow() {},
}
