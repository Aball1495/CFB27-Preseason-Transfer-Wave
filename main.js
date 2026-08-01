const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { run, scanTeamHealth, POSITION_KEYS, DEFAULT_CHECKS } = require('./lib/redistribution');
const { TEAM_COLORS } = require('./team_colors.cjs');

// Short-name aliases for the ~21 teams whose real in-game DisplayName
// (which the logo filenames also use) is abbreviated differently than
// the full name teamColors.mjs was sourced under. Discovered by directly
// comparing real Team.DisplayName against every row once Team's schema
// was confirmed fully readable again -- see conversation history.
const TEAM_NAME_ALIASES = {
  'App St.': 'Appalachian State',
  'C. Michigan': 'Central Michigan',
  'C. Carolina': 'Coastal Carolina',
  'E. Michigan': 'Eastern Michigan',
  'FIU': 'Florida International',
  'FLA Atlantic': 'Florida Atlantic',
  'Ga Southern': 'Georgia Southern',
  'Jax State': 'Jacksonville State',
  'Kennesaw St.': 'Kennesaw State',
  'Miami (OH)': 'Miami University',
  'Middle Tenn': 'Middle Tennessee',
  'Mississippi St': 'Mississippi State',
  'New Mexico St.': 'New Mexico State',
  'NDSU': 'North Dakota State',
  'NIU': 'Northern Illinois',
  'Sac State': 'Sacramento State',
  'San Diego St.': 'San Diego State',
  'Southern Miss': 'Southern Mississippi',
  'Washington St.': 'Washington State',
  'W. Kentucky': 'Western Kentucky',
  'W. Michigan': 'Western Michigan',
};

let mainWindow;

const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const HISTORY_PATH = path.join(app.getPath('userData'), 'history.json');
const HEALTH_HISTORY_PATH = path.join(app.getPath('userData'), 'health-history.json');

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function defaultSettings() {
  return {
    thresholdOverrides: {},
    enableTier2: true,
    severeThreshold: 2,
    smallPositionSevereThreshold: 0,
    prestigeGapCap: 3,
    zeroNil: true,
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    backgroundColor: '#12141a',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('select-save-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select a CFB 27 dynasty save file',
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle('get-settings', () => loadJson(SETTINGS_PATH, defaultSettings()));

ipcMain.handle('save-settings', (_event, settings) => {
  saveJson(SETTINGS_PATH, settings);
  return true;
});

ipcMain.handle('get-default-checks', () => DEFAULT_CHECKS);
ipcMain.handle('get-position-keys', () => POSITION_KEYS);

ipcMain.handle('get-team-visuals', () => {
  // Logo filenames already use the real in-game short names (e.g.
  // "Miami (OH).png") -- just strip the extension, no index mapping
  // needed. Reads the actual folder so it self-updates if logos change.
  const logosByName = {};
  const logosDir = path.join(__dirname, 'renderer', 'logos');
  try {
    for (const filename of fs.readdirSync(logosDir)) {
      if (!filename.toLowerCase().endsWith('.png')) continue;
      const name = filename.slice(0, -4);
      logosByName[name] = filename;
    }
  } catch { /* logos folder not present yet -- fine, falls back to initials */ }

  // Colors are sourced under full names; add short-name aliases so a
  // lookup by real DisplayName still succeeds for abbreviated teams.
  const colorsByName = { ...TEAM_COLORS };
  for (const [shortName, longName] of Object.entries(TEAM_NAME_ALIASES)) {
    if (TEAM_COLORS[longName]) colorsByName[shortName] = TEAM_COLORS[longName];
  }

  return { colors: colorsByName, logos: logosByName };
});

ipcMain.handle('get-history', () => loadJson(HISTORY_PATH, []));

ipcMain.handle('clear-history', () => {
  saveJson(HISTORY_PATH, []);
  return true;
});

ipcMain.handle('delete-history-entry', (_event, id) => {
  const history = loadJson(HISTORY_PATH, []);
  const filtered = history.filter((entry) => entry.id !== id);
  saveJson(HISTORY_PATH, filtered);
  return filtered;
});

ipcMain.handle('scan-teams', async (_event, savePath) => {
  const settings = loadJson(SETTINGS_PATH, defaultSettings());
  const results = await scanTeamHealth({ savePath, settings });

  // Aggregate green/yellow/red across every CPU team's positions --
  // deliberately excludes the user-controlled team from this league-wide
  // tally. The tool's whole purpose is tracking CPU team health, and a
  // real, isolated game-data quirk can make the user's own roster
  // mis-tagged (confirmed on a real save: real players carrying a
  // different team's TeamIndex entirely) -- since that's unrelated to
  // anything this tool actually does, it shouldn't pollute the trend.
  let green = 0, yellow = 0, red = 0;
  const byPosition = { green: {}, yellow: {}, red: {} };
  for (const team of results) {
    if (team.isUserControlled) continue;
    for (const [posKey, posData] of Object.entries(team.positions)) {
      let bucket;
      if (posData.status === 'ok') { green++; bucket = 'green'; }
      else if (posData.status === 'over') { yellow++; bucket = 'yellow'; }
      else if (posData.status === 'under') { red++; bucket = 'red'; }
      if (bucket) byPosition[bucket][posKey] = (byPosition[bucket][posKey] || 0) + 1;
    }
  }
  const healthHistory = loadJson(HEALTH_HISTORY_PATH, []);
  healthHistory.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    date: new Date().toISOString(),
    savePath,
    green, yellow, red,
    byPosition,
    teamCount: results.length,
  });
  saveJson(HEALTH_HISTORY_PATH, healthHistory);

  return results;
});

ipcMain.handle('get-health-history', () => loadJson(HEALTH_HISTORY_PATH, []));

ipcMain.handle('clear-health-history', () => {
  saveJson(HEALTH_HISTORY_PATH, []);
  return true;
});

ipcMain.handle('delete-health-history-entry', (_event, id) => {
  const healthHistory = loadJson(HEALTH_HISTORY_PATH, []);
  const filtered = healthHistory.filter((entry) => entry.id !== id);
  saveJson(HEALTH_HISTORY_PATH, filtered);
  return filtered;
});

ipcMain.on('start-run', async (event, { savePath, dryRun }) => {
  const sender = event.sender;
  const log = (line) => {
    if (!sender.isDestroyed()) sender.send('log-line', line);
  };
  try {
    const settings = loadJson(SETTINGS_PATH, defaultSettings());
    const summary = await run({ savePath, dryRun, log, settings });

    if (!dryRun) {
      const history = loadJson(HISTORY_PATH, []);
      history.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: new Date().toISOString(),
        savePath,
        totalMoves: summary.moves.length,
        tier1Count: summary.tier1Count,
        tier2Count: summary.tier2Count,
        topTwoExceptionCount: summary.topTwoExceptionCount,
        affectedTeamCount: summary.affectedTeamCount,
        byCheck: summary.byCheck,
        outputPath: summary.outputPath,
      });
      saveJson(HISTORY_PATH, history);
    }

    if (!sender.isDestroyed()) sender.send('run-complete', summary);
  } catch (err) {
    if (!sender.isDestroyed()) sender.send('run-error', err.message || String(err));
  }
});
