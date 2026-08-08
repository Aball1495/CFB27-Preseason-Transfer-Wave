const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { run, scanTeamHealth, listRealTeams, getTeamRoster, POSITION_KEYS, DEFAULT_CHECKS, DEFAULT_SEVERE_THRESHOLDS } = require('./lib/redistribution');
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

// In-memory only, for the current app session -- NOT persisted to disk.
// Backs the Roster tab's arrived/departed check-in against the most
// recent Apply run. Intentionally resets on app restart.
let lastRunMoves = null;
let lastRunSavePath = null;
let lastRunDate = null;

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
    severeThresholdOverrides: {},
    prestigeGapCap: 3,
    // How many Tier 2 (forced-dump) players any single team can absorb
    // at ONE position in a single Apply run. Without this, a rare
    // low-prestige team can end up as the only eligible recipient for a
    // large backlog of leftover-severe candidates and absorb dozens of
    // them at once (confirmed on a real save). Deliberately conservative
    // default -- a capped-out candidate is left unassigned for this run
    // rather than concentrated, spreading a big backlog across several
    // preseasons instead of dumping it all in one.
    tier2RecipientCapPerPosition: 1,
    zeroNil: true,
    // How many non-FB positions have to be flagged as a shortage
    // (league-wide, across CPU teams) before the drift check actively
    // recommends running the tool, rather than just listing what it
    // found. FB is excluded from this count entirely -- see the
    // check-drift handler for why. Surplus flags never count toward
    // this threshold at all; a surplus is a routine, self-correcting
    // situation, not a sign the league needs attention.
    driftWarningThreshold: 10,
    // Buried, genuinely good players (3rd-or-lower on their own team's
    // depth chart) can transfer to find real playing time -- up or down
    // in prestige, same cap magnitude both ways. Defaults OFF -- this is
    // a new mechanic, extensively validated via standalone test scripts
    // first, but never yet run through a real Apply in the live app.
    // bigFishChance defaults to 0 -- the rare "big fish, small pond"
    // override that lets a much bigger downward jump through anyway;
    // 0 means it can never fire until explicitly turned up.
    enableWaterfall: false,
    waterfallBigFishChance: 0,
    // Same concentration problem Tier 2's own cap solves -- without
    // this, a handful of rock-bottom-prestige teams can end up
    // net-absorbing far more than their share across many SEPARATE
    // waterfall chains in one run, even though each chain's own
    // accounting is individually correct. Same conservative default as
    // Tier 2's cap.
    waterfallRecipientCapPerPosition: 1,
    // A QB's own OVR clearing this threshold qualifies them as a rank-2
    // waterfall candidate regardless of the starter's class. Scalable,
    // per request -- start at 90, adjust from here if warranted.
    waterfallQbOvrThreshold: 90,
  };
}

// v1.0.0 stored severe-donor-threshold as two global scalars
// (severeThreshold + smallPositionSevereThreshold, applied via a
// hardcoded FB/K/P special case). Settings are now per-position, so a
// saved settings.json from before this change needs a one-time migration
// into severeThresholdOverrides -- otherwise a user's tuned values would
// silently reset to the defaults on next launch.
function migrateSettings(settings) {
  if (!settings || settings.severeThresholdOverrides) return settings;
  const hadOldFields = 'severeThreshold' in settings || 'smallPositionSevereThreshold' in settings;
  if (!hadOldFields) {
    settings.severeThresholdOverrides = {};
    return settings;
  }
  const generalValue = settings.severeThreshold ?? 2;
  const smallValue = settings.smallPositionSevereThreshold ?? 0;
  const overrides = {};
  for (const key of Object.keys(DEFAULT_SEVERE_THRESHOLDS)) {
    const wasSmallPosition = ['FB', 'K', 'P'].includes(key);
    const oldEffectiveValue = wasSmallPosition ? smallValue : generalValue;
    if (oldEffectiveValue !== DEFAULT_SEVERE_THRESHOLDS[key]) overrides[key] = oldEffectiveValue;
  }
  settings.severeThresholdOverrides = overrides;
  delete settings.severeThreshold;
  delete settings.smallPositionSevereThreshold;
  return settings;
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

ipcMain.handle('get-settings', () => migrateSettings(loadJson(SETTINGS_PATH, defaultSettings())));

ipcMain.handle('save-settings', (_event, settings) => {
  saveJson(SETTINGS_PATH, settings);
  return true;
});

ipcMain.handle('get-default-checks', () => DEFAULT_CHECKS);
ipcMain.handle('get-position-keys', () => POSITION_KEYS);
ipcMain.handle('get-default-severe-thresholds', () => DEFAULT_SEVERE_THRESHOLDS);

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
  const settings = migrateSettings(loadJson(SETTINGS_PATH, defaultSettings()));
  const results = await scanTeamHealth({ savePath, settings, log: (line) => console.log('[scan-teams]', line) });

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

ipcMain.handle('list-real-teams', async (_event, savePath) => {
  return listRealTeams({ savePath });
});

ipcMain.handle('get-team-roster', async (_event, { savePath, teamIndex }) => {
  return getTeamRoster({ savePath, teamIndex });
});

ipcMain.handle('get-last-run-moves', () => {
  if (!lastRunMoves) return null;
  return { savePath: lastRunSavePath, date: lastRunDate, moves: lastRunMoves };
});

// Deliberately separate from scan-teams: this runs automatically every time
// a save is chosen on the Run tab, which happens far more often than a
// deliberate Team Health scan. If it shared scan-teams' handler, every save
// pick would silently add a data point to Season History and wreck that
// trend chart's meaning. This does the same underlying scanTeamHealth read
// but never touches HEALTH_HISTORY_PATH.
ipcMain.handle('check-drift', async (_event, savePath) => {
  const settings = migrateSettings(loadJson(SETTINGS_PATH, defaultSettings()));
  const results = await scanTeamHealth({ savePath, settings });

  // Only shortages are ever flagged here -- surpluses are routine and
  // self-correct on a normal run, not a sign the league needs attention,
  // so they're not computed at all rather than just hidden from display.
  // Matches exactly what the engine itself already treats as "needs
  // help" (a recipient): any CPU team under its normal min at all.
  const shortages = [];
  for (const team of results) {
    if (team.isUserControlled) continue;
    for (const [posKey, posData] of Object.entries(team.positions)) {
      if (posData.status === 'under') {
        shortages.push({ team: team.name, position: posKey, count: posData.sum, min: posData.min });
      }
    }
  }

  // Grouped by team, not by position -- "which teams are actually
  // deficient, and why" is a more useful read than a flat list of
  // position rows scattered across dozens of unrelated teams. FB is
  // excluded here too, same reasoning as the recommendation count below.
  const nonFbShortages = shortages.filter((s) => s.position !== 'FB');
  const byTeam = new Map();
  for (const s of nonFbShortages) {
    if (!byTeam.has(s.team)) byTeam.set(s.team, []);
    byTeam.get(s.team).push(s);
  }
  const deficientTeams = [...byTeam.entries()]
    .map(([team, teamShortages]) => ({
      team,
      shortages: teamShortages.sort((a, b) => (b.min - b.count) - (a.min - a.count)),
    }))
    .sort((a, b) => {
      if (b.shortages.length !== a.shortages.length) return b.shortages.length - a.shortages.length;
      const worstA = Math.max(...a.shortages.map((s) => s.min - s.count));
      const worstB = Math.max(...b.shortages.map((s) => s.min - s.count));
      return worstB - worstA;
    });

  // FB is excluded from the recommendation count on purpose -- it's
  // already documented (README, Locked Threshold Table) as the one
  // position that can't fully be fixed, since real football doesn't
  // have enough true fullbacks for the game's own demand. FB will
  // routinely show as a shortage even in a perfectly healthy league, so
  // counting it here would make the warning fire constantly regardless
  // of whether anything actually needs fixing. Surplus flags never
  // count toward this either -- a surplus is routine and self-corrects
  // on a normal run, not a sign the league needs attention.
  const nonFbShortageCount = nonFbShortages.length;
  const driftWarningThreshold = settings.driftWarningThreshold ?? 10;
  const recommendRunning = nonFbShortageCount >= driftWarningThreshold;

  return { teamCount: results.length, deficientTeams, nonFbShortageCount, driftWarningThreshold, recommendRunning };
});

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
  const logLines = [];
  const log = (line) => {
    logLines.push(line);
    if (!sender.isDestroyed()) sender.send('log-line', line);
  };
  try {
    const settings = migrateSettings(loadJson(SETTINGS_PATH, defaultSettings()));
    const summary = await run({ savePath, dryRun, log, settings });

    if (!dryRun) {
      // Full run log, saved next to the save backup so what actually
      // happened this run is still checkable later -- cross-reference
      // against what shows up in-game, not just what scrolled past in
      // the Live Log panel during the run itself. Named to match its
      // backup file exactly, so the two are obviously paired.
      if (summary.backupPath) {
        const logPath = `${summary.backupPath}_log.txt`;
        log(`Full run log saved to: ${logPath}`);
        try {
          fs.writeFileSync(logPath, logLines.join('\n'), 'utf-8');
        } catch (err) {
          console.error('Could not save run log file:', err);
        }
      }

      const history = loadJson(HISTORY_PATH, []);
      const ovrBuckets = { under60: 0, r60to70: 0, r70to80: 0, r80plus: 0 };
      for (const move of summary.moves) {
        if (move.ovr < 60) ovrBuckets.under60++;
        else if (move.ovr < 70) ovrBuckets.r60to70++;
        else if (move.ovr < 80) ovrBuckets.r70to80++;
        else ovrBuckets.r80plus++;
      }
      history.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        date: new Date().toISOString(),
        savePath,
        totalMoves: summary.moves.length,
        tier1Count: summary.tier1Count,
        tier2Count: summary.tier2Count,
        waterfallCount: summary.waterfallCount,
        topTwoExceptionCount: summary.topTwoExceptionCount,
        affectedTeamCount: summary.affectedTeamCount,
        byCheck: summary.byCheck,
        ovrBuckets,
        outputPath: summary.outputPath,
        backupPath: summary.backupPath,
      });
      saveJson(HISTORY_PATH, history);

      // Kept in memory only, for this app session -- a live check-in
      // against the Roster tab, not a permanent record. Resets on
      // restart on purpose; this isn't meant to answer "what happened
      // three sessions ago," just "did this run just do what I expected."
      lastRunMoves = summary.moves.map((m) => ({
        player: m.player, position: m.position, ovr: m.ovr, schoolYear: m.schoolYear, from: m.from, to: m.to,
      }));
      lastRunSavePath = savePath;
      lastRunDate = new Date().toISOString();
    }

    if (!sender.isDestroyed()) sender.send('run-complete', summary);
  } catch (err) {
    if (!sender.isDestroyed()) sender.send('run-error', err.message || String(err));
  }
});
