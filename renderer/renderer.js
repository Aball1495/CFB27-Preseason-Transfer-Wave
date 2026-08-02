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
    if (btn.dataset.subtab === 'roster') initRosterTabOnce();
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

const preseasonWarning = document.getElementById('preseason-warning');
const preseasonModalOverlay = document.getElementById('preseason-modal-overlay');
const preseasonYesBtn = document.getElementById('preseason-yes-btn');
const preseasonNoBtn = document.getElementById('preseason-no-btn');
const driftStatusEl = document.getElementById('drift-check-status');
const driftResultsEl = document.getElementById('drift-check-results');
let pendingSavePath = null;

const DRIFT_DISPLAY_CAP = 20;

function buildDriftResultsEl(teamCount, deficientTeams, nonFbShortageCount, driftWarningThreshold, recommendRunning) {
  const wrapper = document.createElement('div');

  if (recommendRunning) {
    const rec = document.createElement('p');
    rec.className = 'drift-recommend';
    rec.textContent =
      `${nonFbShortageCount} positions (not counting FB) are showing a real shortage across CPU teams -- ` +
      `enough that running Transfer Wave this preseason is worth doing.`;
    wrapper.appendChild(rec);
  } else if (!deficientTeams.length) {
    const clean = document.createElement('p');
    clean.className = 'drift-clean';
    clean.textContent = `No major roster drift detected across ${teamCount} CPU teams -- you probably don't need to run Transfer Wave yet.`;
    wrapper.appendChild(clean);
    return wrapper;
  } else {
    const mild = document.createElement('p');
    mild.className = 'drift-mild';
    mild.textContent =
      `Some drift showed up, but not enough to actively recommend running the tool ` +
      `(${nonFbShortageCount} non-FB shortage${nonFbShortageCount === 1 ? '' : 's'}, threshold is ${driftWarningThreshold}). ` +
      `Details below if you want to look anyway.`;
    wrapper.appendChild(mild);
  }

  const summary = document.createElement('p');
  summary.className = 'drift-summary';
  summary.textContent = `${deficientTeams.length} team${deficientTeams.length === 1 ? '' : 's'} showing a real shortage, worst first:`;
  wrapper.appendChild(summary);

  const list = document.createElement('ul');
  list.className = 'drift-list';
  for (const entry of deficientTeams.slice(0, DRIFT_DISPLAY_CAP)) {
    const li = document.createElement('li');
    li.className = 'drift-team-entry';
    const teamLine = document.createElement('div');
    const dot = document.createElement('span');
    dot.className = 'drift-dot shortage';
    teamLine.appendChild(dot);
    const strong = document.createElement('strong');
    strong.textContent = entry.team;
    teamLine.appendChild(strong);
    li.appendChild(teamLine);

    const reasons = document.createElement('ul');
    reasons.className = 'drift-team-reasons';
    for (const s of entry.shortages) {
      const reasonLi = document.createElement('li');
      reasonLi.textContent = `${s.count} ${displayPositionName(s.position)} (normal min ${s.min})`;
      reasons.appendChild(reasonLi);
    }
    li.appendChild(reasons);
    list.appendChild(li);
  }
  if (deficientTeams.length > DRIFT_DISPLAY_CAP) {
    const more = document.createElement('li');
    more.className = 'drift-more';
    more.textContent = `+${deficientTeams.length - DRIFT_DISPLAY_CAP} more team(s) not shown`;
    list.appendChild(more);
  }
  wrapper.appendChild(list);
  return wrapper;
}

async function runDriftCheckAndShowModal(filePath) {
  preseasonModalOverlay.hidden = false;
  preseasonYesBtn.disabled = true;
  preseasonNoBtn.disabled = true;
  driftStatusEl.hidden = false;
  driftStatusEl.textContent = 'Scanning your league for roster drift…';
  driftResultsEl.hidden = true;
  driftResultsEl.innerHTML = '';

  try {
    const { teamCount, deficientTeams, nonFbShortageCount, driftWarningThreshold, recommendRunning } = await window.api.checkDrift(filePath);
    driftResultsEl.appendChild(buildDriftResultsEl(teamCount, deficientTeams, nonFbShortageCount, driftWarningThreshold, recommendRunning));
  } catch (err) {
    const errorEl = document.createElement('p');
    errorEl.className = 'drift-error';
    errorEl.textContent = `Couldn't scan this save for drift (${err.message || err}). You can still continue.`;
    driftResultsEl.appendChild(errorEl);
  }
  driftStatusEl.hidden = true;
  driftResultsEl.hidden = false;
  preseasonYesBtn.disabled = false;
  preseasonNoBtn.disabled = false;
}

selectSaveBtn.addEventListener('click', async () => {
  const filePath = await window.api.selectSaveFile();
  if (!filePath) return;
  pendingSavePath = filePath;
  runDriftCheckAndShowModal(filePath);
});

preseasonYesBtn.addEventListener('click', () => {
  selectedSavePath = pendingSavePath;
  pendingSavePath = null;
  savePathEl.textContent = selectedSavePath;
  savePathEl.classList.add('selected');
  preseasonWarning.hidden = true;
  preseasonModalOverlay.hidden = true;
  setButtonsEnabled(true);
});

preseasonNoBtn.addEventListener('click', () => {
  // Don't carry over any previously-confirmed save -- if they had one
  // selected and correctly confirmed before, re-picking a file and then
  // saying "No" here means THIS file isn't preseason-ready, so Preview/
  // Apply need to go back to disabled rather than staying enabled on the
  // old path.
  pendingSavePath = null;
  selectedSavePath = null;
  savePathEl.textContent = 'No save selected';
  savePathEl.classList.remove('selected');
  preseasonModalOverlay.hidden = true;
  preseasonWarning.hidden = false;
  previewBtn.disabled = true;
  applyBtn.disabled = true;
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
    'This will overwrite your save file in place.\n\n' +
    'A backup of the original is made first, saved to a "Preseason Transfer Backup" folder next to your save. Continue?'
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

// Position/group order in the engine's CHECKS table is already grouped
// this way (QB..C offense, DE..SS defense, K/P special teams) -- this
// just gives each bucket a label and a target tbody for the collapsible
// sections.
const POSITION_GROUPS = [
  { label: 'offense', keys: ['QB', 'HB', 'FB', 'WR', 'TE', 'OT', 'Guards', 'C'] },
  { label: 'defense', keys: ['DE', 'DT', 'LOLB', 'MLB', 'ROLB', 'CB', 'FS', 'SS'] },
  { label: 'special', keys: ['K', 'P'] },
];

let defaultSevereThresholds = null;

async function loadSettingsUI() {
  currentSettings = await window.api.getSettings();
  defaultChecks = await window.api.getDefaultChecks();
  defaultSevereThresholds = await window.api.getDefaultSevereThresholds();
  const positionKeys = await window.api.getPositionKeys();
  const positionKeySet = new Set(positionKeys);

  for (const group of POSITION_GROUPS) {
    const tbody = document.getElementById(`threshold-table-body-${group.label}`);
    tbody.innerHTML = '';
    for (const key of group.keys) {
      if (!positionKeySet.has(key)) continue; // guard against future engine changes to POSITION_KEYS
      const base = defaultChecks[key];
      const override = currentSettings.thresholdOverrides[key] || {};
      const baseSevere = defaultSevereThresholds[key];
      const severeOverride = currentSettings.severeThresholdOverrides?.[key];
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${displayPositionName(key)}</td>
        <td><input type="number" data-pos="${key}" data-field="min" value="${override.min ?? base.min}" /></td>
        <td><input type="number" data-pos="${key}" data-field="max" value="${override.max ?? base.max}" /></td>
        <td class="severe-threshold-cell"><input type="number" data-pos="${key}" data-field="severe" min="0" step="1" value="${severeOverride ?? baseSevere}" /></td>
        <td class="default-val">${base.min} / ${base.max} · sev ${baseSevere}</td>
      `;
      tbody.appendChild(row);
    }
  }

  document.getElementById('enable-tier2-checkbox').checked = currentSettings.enableTier2;
  setTier2Enabled(currentSettings.enableTier2);
  document.getElementById('prestige-cap-input').value = currentSettings.prestigeGapCap;
  document.getElementById('tier2-recipient-cap-input').value = currentSettings.tier2RecipientCapPerPosition ?? 1;
  document.getElementById('drift-threshold-input').value = currentSettings.driftWarningThreshold ?? 10;
  document.getElementById('zero-nil-checkbox').checked = currentSettings.zeroNil;
}

// Dims both the Tier 2 sub-settings panel and the per-position severe
// threshold column together -- they're only meaningful when Tier 2 is on.
function setTier2Enabled(enabled) {
  document.getElementById('tier2-subsettings').classList.toggle('disabled', !enabled);
  document.querySelectorAll('.severe-threshold-cell').forEach((cell) => {
    cell.classList.toggle('disabled', !enabled);
  });
}

document.getElementById('enable-tier2-checkbox').addEventListener('change', (e) => {
  setTier2Enabled(e.target.checked);
});

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const thresholdOverrides = {};
  const severeThresholdOverrides = {};
  document.querySelectorAll('#threshold-groups input').forEach((input) => {
    const pos = input.dataset.pos;
    const field = input.dataset.field;
    const value = Number(input.value);
    if (field === 'severe') {
      // Only store it as an override if it actually differs from default,
      // keeps the settings file clean and makes "changed from default"
      // easy to eyeball later.
      if (value !== defaultSevereThresholds[pos]) severeThresholdOverrides[pos] = value;
      return;
    }
    const base = defaultChecks[pos];
    if (!thresholdOverrides[pos]) thresholdOverrides[pos] = {};
    if (value !== base[field]) thresholdOverrides[pos][field] = value;
  });
  // Drop empty override entries
  for (const key of Object.keys(thresholdOverrides)) {
    if (Object.keys(thresholdOverrides[key]).length === 0) delete thresholdOverrides[key];
  }

  currentSettings = {
    thresholdOverrides,
    enableTier2: document.getElementById('enable-tier2-checkbox').checked,
    severeThresholdOverrides,
    prestigeGapCap: Number(document.getElementById('prestige-cap-input').value),
    tier2RecipientCapPerPosition: Number(document.getElementById('tier2-recipient-cap-input').value),
    driftWarningThreshold: Number(document.getElementById('drift-threshold-input').value),
    zeroNil: document.getElementById('zero-nil-checkbox').checked,
  };
  await window.api.saveSettings(currentSettings);

  const msg = document.getElementById('settings-saved-msg');
  msg.hidden = false;
  setTimeout(() => { msg.hidden = true; }, 2000);
});

document.getElementById('reset-settings-btn').addEventListener('click', async () => {
  if (!confirm('Reset all settings to defaults?')) return;
  currentSettings = { thresholdOverrides: {}, enableTier2: true, severeThresholdOverrides: {}, prestigeGapCap: 3, tier2RecipientCapPerPosition: 1, driftWarningThreshold: 10, zeroNil: true };
  await window.api.saveSettings(currentSettings);
  await loadSettingsUI();
});

// ===== History tab =====
const OVR_BUCKETS = [
  { key: 'under60', label: 'Below 60', cssClass: 'ovr-under60' },
  { key: 'r60to70', label: '60 – 70', cssClass: 'ovr-60to70' },
  { key: 'r70to80', label: '70 – 80', cssClass: 'ovr-70to80' },
  { key: 'r80plus', label: '80+', cssClass: 'ovr-80plus' },
];

function buildBreakdownBars(rows) {
  const max = Math.max(...rows.map((r) => r.count), 1);
  return rows.map((r) => `
    <div class="breakdown-bar-row">
      <span class="breakdown-label">${r.label}</span>
      <div class="breakdown-bar-track"><div class="breakdown-bar-fill ${r.cssClass || ''}" style="width:${Math.max(2, (r.count / max) * 100)}%"></div></div>
      <span class="breakdown-count">${r.count}</span>
    </div>
  `).join('');
}

function buildBreakdownPanel(entry) {
  const byCheckRows = Object.entries(entry.byCheck || {})
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ label: displayPositionName(key), count }));

  const positionCol = byCheckRows.length
    ? `<div class="breakdown-col"><h4>Moves by Position</h4>${buildBreakdownBars(byCheckRows)}</div>`
    : `<div class="breakdown-col"><h4>Moves by Position</h4><p class="section-hint">No moves recorded for this run.</p></div>`;

  let ratingCol;
  if (entry.ovrBuckets) {
    const rows = OVR_BUCKETS.map((b) => ({ label: b.label, count: entry.ovrBuckets[b.key] || 0, cssClass: b.cssClass }));
    ratingCol = `<div class="breakdown-col"><h4>Moves by Rating Range</h4>${buildBreakdownBars(rows)}</div>`;
  } else {
    ratingCol = `<div class="breakdown-col"><h4>Moves by Rating Range</h4><p class="section-hint">Not available for runs recorded before this update.</p></div>`;
  }

  return `<div class="history-breakdown-panel">${positionCol}${ratingCol}</div>`;
}

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
      <td></td>
    `;
    const [, , , , , detailsCell, deleteCell] = row.children;

    const detailsBtn = document.createElement('button');
    detailsBtn.className = 'details-toggle-btn';
    detailsBtn.textContent = 'Details';
    detailsCell.appendChild(detailsBtn);

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

    const detailRow = document.createElement('tr');
    detailRow.className = 'history-breakdown-row';
    detailRow.hidden = true;
    const detailCell = document.createElement('td');
    detailCell.colSpan = 7;
    detailCell.innerHTML = buildBreakdownPanel(entry);
    detailRow.appendChild(detailCell);
    tbody.appendChild(detailRow);

    detailsBtn.addEventListener('click', () => {
      detailRow.hidden = !detailRow.hidden;
      detailsBtn.textContent = detailRow.hidden ? 'Details' : 'Hide';
    });
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

// Same-game position labels for the Roster tab specifically -- distinct
// from displayPositionName's grouped labels used in Settings/History,
// since this tab shows individual players with their exact position,
// not a grouped count (RB not HB, LEDG/REDG not LE/RE, SAM/MIKE/WILL not
// LOLB/MLB/ROLB).
const GAME_POSITION_LABELS = {
  QB: 'QB', HB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  LT: 'LT', LG: 'LG', C: 'C', RG: 'RG', RT: 'RT',
  LE: 'LEDG', RE: 'REDG', DT: 'DT',
  LOLB: 'SAM', MLB: 'MIKE', ROLB: 'WILL',
  CB: 'CB', FS: 'FS', SS: 'SS', K: 'K', P: 'P',
};
function gamePositionLabel(pos) {
  return GAME_POSITION_LABELS[pos] || pos;
}

// ===== Roster tab =====
let rosterSavePath = null;
let rosterTeamList = [];
let rosterInitialized = false;

function initRosterTabOnce() {
  if (rosterInitialized) return;
  rosterInitialized = true;

  document.getElementById('roster-select-save-btn').addEventListener('click', async () => {
    const filePath = await window.api.selectSaveFile();
    if (!filePath) return;
    rosterSavePath = filePath;
    document.getElementById('roster-save-path').textContent = filePath;
    document.getElementById('roster-save-path').classList.add('selected');

    const select = document.getElementById('roster-team-select');
    select.disabled = true;
    select.innerHTML = '<option>Loading teams...</option>';
    try {
      rosterTeamList = await window.api.listRealTeams(filePath);
      select.innerHTML = '';
      rosterTeamList.forEach((t) => {
        const opt = document.createElement('option');
        opt.value = t.teamIndex;
        opt.textContent = t.name + (t.isUserControlled ? ' (User)' : '');
        select.appendChild(opt);
      });
      select.disabled = false;
      if (rosterTeamList.length > 0) loadAndRenderRoster(rosterTeamList[0].teamIndex);
    } catch (err) {
      select.innerHTML = '<option>Failed to load teams</option>';
      alert('Failed to list teams: ' + err.message);
    }
  });

  document.getElementById('roster-team-select').addEventListener('change', (e) => {
    loadAndRenderRoster(Number(e.target.value));
  });
}

async function loadAndRenderRoster(teamIndex) {
  const header = document.getElementById('roster-header');
  const tbody = document.getElementById('roster-table-body');
  const departedSection = document.getElementById('roster-departed-section');
  const departedBody = document.getElementById('roster-departed-table-body');
  const historyNote = document.getElementById('roster-history-note');
  tbody.innerHTML = '';
  departedBody.innerHTML = '';
  departedSection.hidden = true;
  header.hidden = true;
  historyNote.hidden = true;

  let roster;
  try {
    roster = await window.api.getTeamRoster(rosterSavePath, teamIndex);
  } catch (err) {
    alert('Failed to load roster: ' + err.message);
    return;
  }

  header.hidden = false;
  const logoImg = document.getElementById('roster-logo');
  const src = logoSrcFor(roster.teamName);
  if (src) {
    logoImg.src = src;
    logoImg.style.display = '';
    logoImg.onerror = () => { logoImg.style.display = 'none'; };
  } else {
    logoImg.style.display = 'none';
  }
  document.getElementById('roster-name').textContent = roster.teamName;
  document.getElementById('roster-schemes').textContent =
    `${formatScheme(roster.offScheme)} Offense / ${formatScheme(roster.defScheme)} Defense`;
  header.style.borderLeftColor = primaryColorFor(roster.teamName);

  // Live, in-session check only -- not pulled from persisted History.
  // Resets on app restart on purpose; this answers "did the run I just
  // made do what I expected," not "what happened days ago."
  const lastRun = await window.api.getLastRunMoves();

  const arrivedNames = new Set();
  const departed = [];
  if (lastRun && lastRun.savePath === rosterSavePath) {
    for (const m of lastRun.moves) {
      if (m.to === roster.teamName) arrivedNames.add(m.player);
      if (m.from === roster.teamName) departed.push(m);
    }
    historyNote.hidden = false;
    historyNote.textContent = `Comparing against the run you just made on this save (${new Date(lastRun.date).toLocaleString()}).`;
  } else {
    historyNote.hidden = false;
    historyNote.textContent = lastRun
      ? "Your last run in this session was against a different save -- showing current roster only."
      : 'No run made yet this session -- showing current roster only.';
  }

  for (const p of roster.players) {
    const row = document.createElement('tr');
    const isNew = arrivedNames.has(p.name);
    row.innerHTML = `
      <td>${p.name}</td>
      <td>${gamePositionLabel(p.position)}</td>
      <td>${p.ovr}</td>
      <td>${p.schoolYear}</td>
      <td>${isNew ? '<span class="roster-badge-new">NEW</span>' : ''}</td>
    `;
    tbody.appendChild(row);
  }

  if (departed.length > 0) {
    departedSection.hidden = false;
    for (const m of departed) {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${m.player}</td>
        <td>${gamePositionLabel(m.position)}</td>
        <td>${m.ovr}</td>
        <td>${m.to}</td>
      `;
      departedBody.appendChild(row);
    }
  }
}

// ===== Init =====
loadSettingsUI();
loadTeamVisuals();
