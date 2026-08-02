const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  selectSaveFile: () => ipcRenderer.invoke('select-save-file'),
  startRun: (opts) => ipcRenderer.send('start-run', opts),
  onLog: (callback) => ipcRenderer.on('log-line', (_event, line) => callback(line)),
  onComplete: (callback) => ipcRenderer.on('run-complete', (_event, summary) => callback(summary)),
  onError: (callback) => ipcRenderer.on('run-error', (_event, message) => callback(message)),

  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getDefaultChecks: () => ipcRenderer.invoke('get-default-checks'),
  getDefaultSevereThresholds: () => ipcRenderer.invoke('get-default-severe-thresholds'),
  getPositionKeys: () => ipcRenderer.invoke('get-position-keys'),
  checkDrift: (savePath) => ipcRenderer.invoke('check-drift', savePath),
  listRealTeams: (savePath) => ipcRenderer.invoke('list-real-teams', savePath),
  getTeamRoster: (savePath, teamIndex) => ipcRenderer.invoke('get-team-roster', { savePath, teamIndex }),
  getLastRunMoves: () => ipcRenderer.invoke('get-last-run-moves'),
  getTeamVisuals: () => ipcRenderer.invoke('get-team-visuals'),
  getHistory: () => ipcRenderer.invoke('get-history'),
  clearHistory: () => ipcRenderer.invoke('clear-history'),
  deleteHistoryEntry: (id) => ipcRenderer.invoke('delete-history-entry', id),
  scanTeams: (savePath) => ipcRenderer.invoke('scan-teams', savePath),
  getHealthHistory: () => ipcRenderer.invoke('get-health-history'),
  clearHealthHistory: () => ipcRenderer.invoke('clear-health-history'),
  deleteHealthHistoryEntry: (id) => ipcRenderer.invoke('delete-health-history-entry', id),
});
