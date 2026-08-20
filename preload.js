// Narrow contextBridge surface. Nothing here gives the renderer filesystem,
// network, or token access — the OAuth token and the claude.ai cookie never
// leave the main process.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('claudeOMeter', {
  // Widget: single-account usage stream (OAuth / claude.ai cookie session)
  onUsageData: (cb) => ipcRenderer.on('usage-data', (_e, data) => cb(data)),
  // Widget: cswap all-account stream
  onClaudeSwap: (cb) => ipcRenderer.on('claude-swap', (_e, data) => cb(data)),
  claudeSwapSwitch: (number) => ipcRenderer.invoke('claude:swap-switch', number),
  claudeSwapRefresh: () => ipcRenderer.invoke('claude:swap-refresh'),
  // Widget: window controls
  minimize:        () => ipcRenderer.send('widget:minimize'),
  close:           () => ipcRenderer.send('widget:close'),
  showContextMenu: () => ipcRenderer.send('widget:context-menu'),
  moveWindow:      (dx, dy) => ipcRenderer.send('widget:move', { dx, dy }),
  dragStart:       () => ipcRenderer.send('widget:drag-start'),
  dragEnd:         () => ipcRenderer.send('widget:drag-end'),
  // App settings (widget + settings window)
  getSettings:      () => ipcRenderer.invoke('settings:get'),
  setSettings:      (s) => ipcRenderer.send('settings:set', s),
  onSettingsChange: (cb) => ipcRenderer.on('settings-change', (_e, s) => cb(s)),
  closeSettings:    () => ipcRenderer.send('settings:close'),
  // claude.ai account login (settings window)
  claudeLogin:  () => ipcRenderer.invoke('claude:login'),
  claudeLogout: () => ipcRenderer.invoke('claude:logout'),
  claudeStatus: () => ipcRenderer.invoke('claude:status'),
  onClaudeStatusChange: (cb) => ipcRenderer.on('claude:status-change', (_e, s) => cb(s)),
})
