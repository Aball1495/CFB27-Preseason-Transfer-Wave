// ===== Team Health sub-tabs =====
const subtabButtons = document.querySelectorAll('.subtab-btn');
const subtabPanels = document.querySelectorAll('.subtab-panel');
subtabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    subtabButtons.forEach((b) => b.classList.remove('active'));
    subtabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`subtab-${btn.dataset.subtab}`).classList.add('active');
    if (btn.dataset.subtab === 'season-history') renderSeasonHealthHistory();
  });
});

async function renderSeasonHealthHistory() {
  const history = await window.api.getHealthHistory();
  const chart = document.getElementById('season-health-chart');
  const tbody = document.getElementById('season-health-table-body');
  const emptyMsg = document.getElementById('season-health-empty');
  chart.innerHTML = '';
  tbody.innerHTML = '';

  if (history.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  const maxTotal = Math.max(...history.map((h) => h.green + h.yellow + h.red), 1);
  for (const entry of history) {
    const total = entry.green + entry.yellow + entry.red;
    const stack = document.createElement('div');
    stack.className = 'season-bar-stack';
    stack.style.height = `${Math.max(4, (total / maxTotal) * 100)}%`;
    for (const [key, count] of [['green', entry.green], ['yellow', entry.yellow], ['red', entry.red]]) {
      if (count <= 0) continue;
      const seg = document.createElement('div');
      seg.className = `season-bar-segment seg-${key}`;
      seg.style.height = `${(count / total) * 100}%`;
      const breakdown = (entry.byPosition && entry.byPosition[key]) || {};
      const breakdownStr = Object.entries(breakdown)
        .sort((a, b) => b[1] - a[1])
        .map(([pos, c]) => `${c}-${displayPositionName(pos)}`)
        .join(', ');
      seg.title = `${new Date(entry.date).toLocaleDateString()} -- ${key.toUpperCase()} (${count}): ${breakdownStr || 'none'}`;
      stack.appendChild(seg);
    }
    chart.appendChild(stack);
  }

  for (const entry of history.slice().reverse()) {
    const row = document.createElement('tr');
    const saveFilename = entry.savePath ? entry.savePath.split(/[\\/]/).pop() : '(unknown)';
    row.innerHTML = `
      <td>${new Date(entry.date).toLocaleString()}</td>
      <td>${saveFilename}</td>
      <td style="color:#4ade80;">${entry.green}</td>
      <td style="color:#fbbf24;">${entry.yellow}</td>
      <td style="color:#f87171;">${entry.red}</td>
      <td></td>
    `;
    const deleteCell = row.lastElementChild;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-entry-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this snapshot? This cannot be undone.')) return;
      await window.api.deleteHealthHistoryEntry(entry.id);
      renderSeasonHealthHistory();
    });
    deleteCell.appendChild(deleteBtn);
    tbody.appendChild(row);
  }
}

document.getElementById('clear-health-history-btn').addEventListener('click', async () => {
  if (!confirm('Clear ALL season health history? This cannot be undone.')) return;
  await window.api.clearHealthHistory();
  renderSeasonHealthHistory();
});

// ===== Team visuals (logos/colors) =====
let teamVisuals = { colors: {}, logos: {} };

async function loadTeamVisuals() {
  teamVisuals = await window.api.getTeamVisuals();
}

function logoSrcFor(teamName) {
  const filename = teamVisuals.logos[teamName];
  return filename ? `logos/${encodeURIComponent(filename)}` : null;
}

function primaryColorFor(teamName) {
  const colors = teamVisuals.colors[teamName];
  return colors && colors.length ? colors[0] : '#7dd3fc';
}

function makeTeamChip(teamName) {
  const chip = document.createElement('div');
  chip.className = 'team-chip';
  const src = logoSrcFor(teamName);
  if (src) {
    const img = document.createElement('img');
    img.src = src;
    img.alt = teamName;
    img.onerror = () => { img.style.display = 'none'; };
    chip.appendChild(img);
  }
  const label = document.createElement('span');
  label.textContent = teamName;
  chip.appendChild(label);
  return chip;
}

const POSITION_DISPLAY_NAMES = { LOLB: 'Sam', ROLB: 'Will' };
function displayPositionName(key) {
  return POSITION_DISPLAY_NAMES[key] || key;
}

function formatScheme(raw) {
  if (!raw) return 'Unknown';
  const body = raw.replace(/^OFF_|^DEF_/, '');
  // Split on underscores, then further split any letter/number runs
  // stuck together (e.g. "BASE3" -> "BASE", "3").
  const tokens = body.split('_').flatMap((t) => t.match(/[A-Za-z]+|[0-9]+/g) || [t]);

  const parts = [];
  let numBuffer = [];
  const flushNum = () => {
    if (numBuffer.length) {
      parts.push(numBuffer.join('-'));
      numBuffer = [];
    }
  };
  for (const tok of tokens) {
    if (/^[0-9]+$/.test(tok)) {
      numBuffer.push(tok);
    } else {
      flushNum();
      const lower = tok.toLowerCase();
      parts.push(lower === 'and' ? 'and' : tok.charAt(0).toUpperCase() + tok.slice(1).toLowerCase());
    }
  }
  flushNum();
  return parts.join(' ');
}

// ===== Tab switching =====
const tabButtons = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
tabButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabButtons.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    if (btn.dataset.tab === 'history') renderHistory();
  });
});

// ===== Run tab =====
const selectSaveBtn = document.getElementById('select-save-btn');
const savePathEl = document.getElementById('save-path');
const previewBtn = document.getElementById('preview-btn');
const applyBtn = document.getElementById('apply-btn');
const logPanel = document.getElementById('log-panel');
const clearLogBtn = document.getElementById('clear-log-btn');
const summaryEl = document.getElementById('summary');
const summaryTotal = document.getElementById('summary-total');
const summaryTier1 = document.getElementById('summary-tier1');
const summaryTier2 = document.getElementById('summary-tier2');
const summaryTeams = document.getElementById('summary-teams');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');

let selectedSavePath = null;
let healthSavePath = null;
let running = false;

function setStatus(state, text) {
  statusDot.className = 'dot' + (state ? ` ${state}` : '');
  statusText.textContent = text;
}

function appendLog(line) {
  const div = document.createElement('div');
  div.className = 'log-line';
  if (line.includes('[T1]')) div.className += ' tier1';
  else if (line.includes('[T2]')) div.className += ' tier2';
  else if (line.startsWith('  WARNING')) div.className += ' warning';
  else if (line.startsWith('===')) div.className += ' header';
  div.textContent = line;
  logPanel.appendChild(div);
  logPanel.scrollTop = logPanel.scrollHeight;
}

function setButtonsEnabled(enabled) {
  previewBtn.disabled = !enabled || !selectedSavePath;
  applyBtn.disabled = !enabled || !selectedSavePath;
  selectSaveBtn.disabled = !enabled;
}

selectSaveBtn.addEventListener('click', async () => {
  const filePath = await window.api.selectSaveFile();
  if (!filePath) return;
  selectedSavePath = filePath;
  savePathEl.textContent = filePath;
  savePathEl.classList.add('selected');
  setButtonsEnabled(true);
});

function startRun(dryRun) {
  if (!selectedSavePath || running) return;
  running = true;
  setButtonsEnabled(false);
  summaryEl.hidden = true;
  logPanel.innerHTML = '';
  setStatus('running', dryRun ? 'Running preview...' : 'Applying changes...');
  window.api.startRun({ savePath: selectedSavePath, dryRun });
}

previewBtn.addEventListener('click', () => startRun(true));

applyBtn.addEventListener('click', () => {
  const confirmed = confirm(
    'This will compute and write a NEW save file with "_REDISTRIBUTED" appended to the name.\n\n' +
    'Your original save is never modified. Continue?'
  );
  if (confirmed) startRun(false);
});

clearLogBtn.addEventListener('click', () => {
  logPanel.innerHTML = '';
});

window.api.onLog((line) => appendLog(line));

window.api.onComplete((summary) => {
  running = false;
  setButtonsEnabled(true);
  setStatus('success', summary.outputPath ? 'Applied' : 'Preview complete');

  summaryEl.hidden = false;
  summaryTotal.textContent = summary.moves.length;
  summaryTier1.textContent = summary.tier1Count;
  summaryTier2.textContent = summary.tier2Count;
  summaryTeams.textContent = summary.affectedTeamCount;

  if (summary.outputPath) {
    appendLog(`=== Output saved to: ${summary.outputPath} ===`);
  }
});

window.api.onError((message) => {
  running = false;
  setButtonsEnabled(true);
  setStatus('error', 'Error');
  appendLog(`  WARNING: ${message}`);
});

// ===== Settings tab =====
let currentSettings = null;
let defaultChecks = null;

async function loadSettingsUI() {
  currentSettings = await window.api.getSettings();
  defaultChecks = await window.api.getDefaultChecks();
  const positionKeys = await window.api.getPositionKeys();

  const tbody = document.getElementById('threshold-table-body');
  tbody.innerHTML = '';
  for (const key of positionKeys) {
    const base = defaultChecks[key];
    const override = currentSettings.thresholdOverrides[key] || {};
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${displayPositionName(key)}</td>
      <td><input type="number" data-pos="${key}" data-field="min" value="${override.min ?? base.min}" /></td>
      <td><input type="number" data-pos="${key}" data-field="max" value="${override.max ?? base.max}" /></td>
      <td class="default-val">${base.min} / ${base.max}</td>
    `;
    tbody.appendChild(row);
  }

  document.getElementById('enable-tier2-checkbox').checked = currentSettings.enableTier2;
  document.getElementById('tier2-subsettings').classList.toggle('disabled', !currentSettings.enableTier2);
  document.getElementById('severe-threshold-input').value = currentSettings.severeThreshold;
  document.getElementById('small-position-severe-threshold-input').value = currentSettings.smallPositionSevereThreshold;
  document.getElementById('prestige-cap-input').value = currentSettings.prestigeGapCap;
  document.getElementById('zero-nil-checkbox').checked = currentSettings.zeroNil;
}

document.getElementById('enable-tier2-checkbox').addEventListener('change', (e) => {
  document.getElementById('tier2-subsettings').classList.toggle('disabled', !e.target.checked);
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const thresholdOverrides = {};
  document.querySelectorAll('#threshold-table-body input').forEach((input) => {
    const pos = input.dataset.pos;
    const field = input.dataset.field;
    const value = Number(input.value);
    const base = defaultChecks[pos];
    if (!thresholdOverrides[pos]) thresholdOverrides[pos] = {};
    // Only store it as an override if it actually differs from default,
    // keeps the settings file clean and makes "changed from default"
    // easy to eyeball later.
    if (value !== base[field]) thresholdOverrides[pos][field] = value;
  });
  // Drop empty override entries
  for (const key of Object.keys(thresholdOverrides)) {
    if (Object.keys(thresholdOverrides[key]).length === 0) delete thresholdOverrides[key];
  }

  currentSettings = {
    thresholdOverrides,
    enableTier2: document.getElementById('enable-tier2-checkbox').checked,
    severeThreshold: Number(document.getElementById('severe-threshold-input').value),
    smallPositionSevereThreshold: Number(document.getElementById('small-position-severe-threshold-input').value),
    prestigeGapCap: Number(document.getElementById('prestige-cap-input').value),
    zeroNil: document.getElementById('zero-nil-checkbox').checked,
  };
  await window.api.saveSettings(currentSettings);

  const msg = document.getElementById('settings-saved-msg');
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 2000);
});

document.getElementById('reset-settings-btn').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  currentSettings = { thresholdOverrides: {}, enableTier2: true, severeThreshold: 2, smallPositionSevereThreshold: 0, prestigeGapCap: 3, zeroNil: true };
  await window.api.saveSettings(currentSettings);
  await loadSettingsUI();
});

// ===== History tab =====
async function renderHistory() {
  const history = await window.api.getHistory();
  const chart = document.getElementById('history-chart');
  const tbody = document.getElementById('history-table-body');
  const emptyMsg = document.getElementById('history-empty');
  chart.innerHTML = '';
  tbody.innerHTML = '';

  if (history.length === 0) {
    emptyMsg.hidden = false;
    return;
  }
  emptyMsg.hidden = true;

  const maxTotal = Math.max(...history.map((h) => h.totalMoves), 1);
  for (const entry of history) {
    const bar = document.createElement('div');
    bar.className = 'history-bar';
    bar.style.height = `${Math.max(4, (entry.totalMoves / maxTotal) * 100)}%`;
    bar.title = `${new Date(entry.date).toLocaleDateString()}: ${entry.totalMoves} moves`;
    chart.appendChild(bar);
  }

  for (const entry of history.slice().reverse()) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${new Date(entry.date).toLocaleString()}</td>
      <td>${entry.totalMoves}</td>
      <td>${entry.tier1Count}</td>
      <td>${entry.tier2Count}</td>
      <td>${entry.affectedTeamCount}</td>
      <td></td>
    `;
    const deleteCell = row.lastElementChild;
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-entry-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', async () => {
      if (!confirm('Delete this history entry? This cannot be undone.')) return;
      await window.api.deleteHistoryEntry(entry.id);
      renderHistory();
    });
    deleteCell.appendChild(deleteBtn);
    tbody.appendChild(row);
  }
}

document.getElementById('clear-history-btn').addEventListener('click', async () => {
  if (!confirm('Clear ALL run history? This cannot be undone.')) return;
  await window.api.clearHistory();
  renderHistory();
});

// ===== Team Health tab =====
let teamHealthData = [];

document.getElementById('health-select-save-btn').addEventListener('click', async () => {
  const filePath = await window.api.selectSaveFile();
  if (!filePath) return;
  healthSavePath = filePath;
  document.getElementById('health-save-path').textContent = filePath;
  document.getElementById('health-save-path').classList.add('selected');
  document.getElementById('scan-teams-btn').disabled = false;
});

document.getElementById('scan-teams-btn').addEventListener('click', async () => {
  if (!healthSavePath) {
    alert('Choose a save file first.');
    return;
  }
  const btn = document.getElementById('scan-teams-btn');
  btn.disabled = true;
  btn.textContent = 'Scanning...';
  try {
    teamHealthData = await window.api.scanTeams(healthSavePath);
    const select = document.getElementById('team-select');
    select.innerHTML = '';
    teamHealthData.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.teamIndex;
      opt.textContent = t.name + (t.isUserControlled ? ' (User)' : '');
      select.appendChild(opt);
    });
    select.disabled = false;
    renderTeamHealth(teamHealthData[0]);
  } catch (err) {
    alert('Scan failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Scan Teams';
  }
});

document.getElementById('team-select').addEventListener('change', (e) => {
  const team = teamHealthData.find((t) => String(t.teamIndex) === e.target.value);
  if (team) renderTeamHealth(team);
});

function renderTeamHealth(team) {
  const grid = document.getElementById('team-health-grid');
  const header = document.getElementById('team-health-header');
  const logoImg = document.getElementById('team-health-logo');
  const nameEl = document.getElementById('team-health-name');
  grid.innerHTML = '';
  if (!team) {
    header.hidden = true;
    return;
  }

  header.hidden = false;
  const src = logoSrcFor(team.name);
  if (src) {
    logoImg.src = src;
    logoImg.style.display = '';
    logoImg.onerror = () => { logoImg.style.display = 'none'; };
  } else {
    logoImg.style.display = 'none';
  }
  nameEl.textContent = team.name + (team.isUserControlled ? ' (User Controlled)' : '');
  document.getElementById('team-health-schemes').textContent =
    `${formatScheme(team.offScheme)} Offense / ${formatScheme(team.defScheme)} Defense`;
  header.style.borderLeftColor = primaryColorFor(team.name);

  const caveat = document.getElementById('team-health-user-caveat');
  caveat.hidden = !team.isUserControlled;

  for (const [pos, data] of Object.entries(team.positions)) {
    const card = document.createElement('div');
    card.className = `health-card status-${data.status}`;
    card.innerHTML = `
      <div class="health-position">${displayPositionName(pos)}</div>
      <div class="health-value">${data.sum}</div>
      <div class="health-range">${data.min} - ${data.max}</div>
    `;
    grid.appendChild(card);
  }
}

// ===== Init =====
loadSettingsUI();
loadTeamVisuals();
