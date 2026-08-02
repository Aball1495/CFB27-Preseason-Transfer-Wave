/**
 * Core redistribution logic, refactored from run_redistribution.cjs into
 * a reusable module. Reports progress via a `log(line)` callback instead
 * of console.log, so both the CLI script and the Electron GUI can drive
 * it. In dryRun mode, it computes and returns every move it WOULD make,
 * but never touches Roster/DepthChart reconciliation or the save file --
 * exactly like dry_run_full_league.cjs. In apply mode, it does the full
 * pipeline: matching -> left/right rebalance -> Roster/DepthChart
 * reconciliation -> back up the original save to a "Preseason Transfer
 * Backup" folder next to it, then atomic overwrite of the input save
 * itself in place.
 */

const fs = require('fs');
const path = require('path');

const TEAM_UNIQUE_ID = 3359508968;
const COACH_UNIQUE_ID = 1860529246;
const PLAYER_UNIQUE_ID = 1612938518;

// These 5 rows are real entries in the Team table, but they're FCS
// scheduling buckets, not real programs with real rosters -- never
// treat them as a redistributable CPU team.
const FCS_BUCKET_NAMES = new Set(['FCS East', 'FCS Midwest', 'FCS Northwest', 'FCS Southeast', 'FCS West']);

function isRealTeam(team) {
  let name;
  try { name = team.DisplayName; } catch { return false; }
  return !!name && !FCS_BUCKET_NAMES.has(name);
}

// Whether a team is the human-controlled team. Checking Coach.TeamIndex
// directly is NOT reliable -- that field can go stale after a coach
// changes jobs (confirmed on a real save: a coach's own TeamIndex still
// pointed at their PREVIOUS team). The correct, non-stale check goes the
// other direction: does THIS team's own UserCharacter reference resolve
// to a coach flagged IsUserControlled?
function isUserControlledTeam(franchise, team, coachTable) {
  if (!team.fields || !('UserCharacter' in team.fields)) return false;
  const field = team.fields.UserCharacter;
  if (!field.isReference) return false;
  const ref = field.referenceData;
  if (!ref || ref.tableId === 0) return false;
  const coachRecord = coachTable.records[ref.rowNumber];
  if (!coachRecord) return false;
  try { return coachRecord.IsUserControlled === true; } catch { return false; }
}

// Player.TeamIndex is NOT reliable as the source of truth for "who is
// currently on this team" -- confirmed across multiple real test
// dynasties, a set of teams (varying by save, but always a handful of
// specific real programs) can carry TeamIndex=0 for their entire roster
// while a completely normal roster sits in their Roster array, and the
// human-controlled team specifically can accumulate stale phantom
// TeamIndex references from players who aren't really on that roster at
// all. The Roster reference field itself (same field
// reconcileRosterStore() below already trusts for WRITES) is what the
// game actually renders rosters from, so it's the authoritative read
// source. This builds playerRowIndex -> teamIndex for every player
// resolvable through a real team's Roster array.
async function buildRosterTeamByPlayerIndex(franchise, teamTable, playerTable, log = () => {}) {
  const map = new Map();
  const playerTableId = playerTable.header.tableId;
  let collisions = 0;
  for (const team of teamTable.records) {
    if (!isRealTeam(team)) continue;
    if (!team.fields || !('Roster' in team.fields) || !team.fields.Roster.isReference) continue;
    const ref = team.fields.Roster.referenceData;
    const rosterTable = resolveTable(franchise, ref.tableId);
    if (!rosterTable) continue;
    if (!rosterTable.recordsRead) await rosterTable.readRecords();
    const rosterRecord = rosterTable.records[ref.rowNumber];
    if (!rosterRecord) continue;
    for (const slotName of Object.keys(rosterRecord.fields)) {
      const field = rosterRecord.fields[slotName];
      if (!field || !field.isReference) continue;
      const slotRef = field.referenceData;
      if (!slotRef || slotRef.tableId !== playerTableId) continue;
      const record = playerTable.records[slotRef.rowNumber];
      if (!record || record.isEmpty) continue;
      if (map.has(slotRef.rowNumber) && map.get(slotRef.rowNumber) !== team.index) collisions++;
      map.set(slotRef.rowNumber, team.index);
    }
  }
  if (collisions > 0) log(`  NOTE: ${collisions} player row(s) appeared in more than one team's Roster array -- last one read won.`);
  return map;
}

// Builds the full playerRowIndex -> teamIndex map used for every "who is
// on this team" decision in this module: authoritative Roster-array
// membership where resolvable, falling back to the player's own
// TeamIndex field only for players not found in any real team's Roster
// array (true free agents/unsigned recruits -- confirmed harmless: every
// such player observed across real test saves carries the TeamIndex=255
// unassigned sentinel, not a real team reference).
async function buildAuthoritativeTeamMap(franchise, teamTable, playerTable, log = () => {}) {
  const rosterTeamByPlayerIndex = await buildRosterTeamByPlayerIndex(franchise, teamTable, playerTable, log);

  // Players not found in ANY real team's Roster array do NOT fall back
  // to their raw TeamIndex field -- that's exactly the field this whole
  // fix exists to route around. Confirmed on real saves: a player's own
  // TeamIndex can be stale/wrong even when they don't appear in any real
  // team's Roster array either (not just "correctly claims their FCS
  // bucket" -- some claim a real team they're not actually on). Rather
  // than guess via an already-proven-unreliable signal, such players are
  // simply excluded from every real team's count. This does mean a
  // genuinely active player who somehow isn't in their team's Roster
  // array (if that's even possible) would be undercounted rather than
  // misattributed -- a safer failure mode than the reverse.
  const map = new Map();
  let unresolvedCount = 0;
  for (const p of playerTable.records) {
    let ovr;
    try { ovr = p.OverallRating; } catch { continue; }
    if (!(ovr > 0)) continue;
    if (rosterTeamByPlayerIndex.has(p.index)) {
      map.set(p.index, rosterTeamByPlayerIndex.get(p.index));
    } else {
      unresolvedCount++;
    }
  }
  log(`Resolved authoritative team for ${map.size} rated player(s) via Roster array. ${unresolvedCount} player(s) not found in any real team's Roster array were excluded from all counts (not guessed via TeamIndex).`);
  return map;
}

// Every "which players are on team X (optionally at position Y)" query
// in this module goes through here now, instead of reading p.TeamIndex
// directly -- keeps every read consistent with buildAuthoritativeTeamMap.
function playersOnTeam(playerTable, teamMembership, teamIndex, positionPredicate = () => true) {
  const results = [];
  for (const p of playerTable.records) {
    let ovr, pos;
    try { ovr = p.OverallRating; pos = p.Position; } catch { continue; }
    if (!(ovr > 0)) continue;
    if (!positionPredicate(pos)) continue;
    if (teamMembership.get(p.index) !== teamIndex) continue;
    results.push(p);
  }
  return results;
}

const CHECKS = {
  QB:     { min: 2, max: 3, members: ['QB'] },
  HB:     { min: 4, max: 6, members: ['HB'] },
  FB:     { min: 1, max: 2, members: ['FB'] },
  WR:     { min: 7, max: 8, members: ['WR'] },
  TE:     { min: 3, max: 5, members: ['TE'] },
  OT:     { min: 5, max: 6, members: ['LT', 'RT'] },
  Guards: { min: 5, max: 6, members: ['LG', 'RG'] },
  C:      { min: 1, max: 2, members: ['C'] },
  DE:     { min: 5, max: 6, members: ['LE', 'RE'] },
  DT:     { min: 3, max: 4, members: ['DT'] },
  LOLB:   { min: 3, max: 3, members: ['LOLB'] },
  MLB:    { min: 3, max: 4, members: ['MLB'] },
  ROLB:   { min: 3, max: 3, members: ['ROLB'] },
  CB:     { min: 5, max: 6, members: ['CB'] },
  FS:     { min: 2, max: 3, members: ['FS'] },
  SS:     { min: 2, max: 3, members: ['SS'] },
  K:      { min: 1, max: 2, members: ['K'] },
  P:      { min: 1, max: 2, members: ['P'] },
};

// Merges any user-configured min/max overrides onto the baseline table.
// Only min/max are overridable -- members/groupings stay fixed, since
// those reflect real structural facts about the game (which exact
// positions belong to a group), not tunable preference.
function buildEffectiveChecks(overrides = {}) {
  const merged = {};
  for (const [key, base] of Object.entries(CHECKS)) {
    const o = overrides[key] || {};
    merged[key] = {
      min: o.min ?? base.min,
      max: o.max ?? base.max,
      members: base.members,
    };
  }
  return merged;
}

// Default "severe donor" threshold per position/group -- how far over max
// a team has to be before Tier 2 treats it as a forced-release situation.
// FB/K/P default to 0 (rather than the general default of 2) because
// their natural ranges are so small (1-2 total) that a threshold of 2
// would almost never trigger for them -- a team would need 4+ punters
// before Tier 2 even noticed. Every position is independently overridable
// in Settings; this table is just the starting point.
const DEFAULT_SEVERE_THRESHOLDS = {
  QB: 2, HB: 2, FB: 0, WR: 2, TE: 2, OT: 2, Guards: 2, C: 2, DE: 2, DT: 2,
  LOLB: 2, MLB: 2, ROLB: 2, CB: 2, FS: 2, SS: 2, K: 0, P: 0,
};

// Merges any user-configured severe-threshold overrides onto the default
// table. Same override pattern as buildEffectiveChecks.
function buildEffectiveSevereThresholds(overrides = {}) {
  const merged = {};
  for (const [key, base] of Object.entries(DEFAULT_SEVERE_THRESHOLDS)) {
    merged[key] = overrides[key] ?? base;
  }
  return merged;
}

const CLASS_YEAR_EXPENDABILITY_RANK = { Senior: 0, Junior: 1, Sophomore: 2, Freshman: 3 };
const PASS_HEAVY_SPREAD_SCHEMES = new Set(['OFF_AIR_RAID', 'OFF_RUN_AND_SHOOT', 'OFF_VEER_AND_SHOOT', 'OFF_SPREAD']);
const RUN_HEAVY_SCHEMES = new Set(['OFF_POWER_SPREAD', 'OFF_SPREAD_OPTION', 'OFF_PISTOL', 'OFF_OPTION']);
const THREE_DOWN_SCHEMES = new Set(['DEF_BASE3_4', 'DEF_3_4_MULTIPLE', 'DEF_3_3_5', 'DEF_3_3_5_TITE', 'DEF_3_2_6']);
const EXTRA_DB_SCHEMES = new Set(['DEF_3_3_5', 'DEF_3_3_5_TITE', 'DEF_3_2_6']);

function getEffectiveThresholds(checkKey, baseConfig, team) {
  let { min, max } = baseConfig;
  let offScheme, defScheme;
  try { offScheme = team.CurrentOffensiveScheme; } catch { offScheme = null; }
  try { defScheme = team.CurrentDefensiveScheme; } catch { defScheme = null; }
  if (checkKey === 'FB') {
    if (PASS_HEAVY_SPREAD_SCHEMES.has(offScheme)) { min = 0; max = Math.max(0, max - 1); }
    else if (RUN_HEAVY_SCHEMES.has(offScheme)) { min = Math.max(min, 1); max += 1; }
  }
  if (checkKey === 'WR') {
    if (PASS_HEAVY_SPREAD_SCHEMES.has(offScheme)) max += 1;
    else if (RUN_HEAVY_SCHEMES.has(offScheme)) max -= 1;
    // Hard cap -- no scheme exception is allowed to push WR above the
    // baseline max of 10, even for pass-heavy spread offenses.
    max = Math.min(max, baseConfig.max);
  }
  if (checkKey === 'TE' && PASS_HEAVY_SPREAD_SCHEMES.has(offScheme)) max -= 1;
  if (checkKey === 'HB' && RUN_HEAVY_SCHEMES.has(offScheme)) max += 1;
  if (['DT', 'LOLB', 'MLB', 'ROLB'].includes(checkKey) && THREE_DOWN_SCHEMES.has(defScheme)) {
    max += checkKey === 'DT' ? -1 : 1;
  }
  if (['CB', 'FS', 'SS'].includes(checkKey) && EXTRA_DB_SCHEMES.has(defScheme)) {
    max += 1;
  }
  return { min, max };
}

function resolveTable(franchise, tableId) {
  for (const methodName of ['getTableById', 'getTableByTableId', 'getTable']) {
    try {
      if (typeof franchise[methodName] === 'function') {
        const t = franchise[methodName](tableId);
        if (t) return t;
      }
    } catch { /* try next */ }
  }
  return null;
}

// Resolve a core table (Team/Coach/Player) by its hardcoded uniqueId
// first -- proven reliable across this whole project. Only falls back
// to name-based matching if the uniqueId lookup finds nothing (e.g. a
// future patch changed the ID), and logs clearly when that fallback
// path is used, since name matching can be less precise if multiple
// tables happen to share the same header.name.
function findCoreTable(franchise, expectedName, fallbackUniqueId, log) {
  const byUniqueId = franchise.tables.find((t) => t.header && t.header.uniqueId === fallbackUniqueId);
  if (byUniqueId) return byUniqueId;
  const byName = franchise.tables.find((t) => t.header && t.header.name === expectedName);
  if (byName) {
    log(`  NOTE: could not find "${expectedName}" table by uniqueId ${fallbackUniqueId} -- fell back to name match. If this game version changed, verify this is the correct table.`);
    return byName;
  }
  return null;
}

async function getDepthChartOrder(franchise, teamRecord, position, playerTable) {
  const order = new Map();
  if (!teamRecord.fields || !('DepthChart' in teamRecord.fields)) return order;
  const dcField = teamRecord.fields.DepthChart;
  if (!dcField.isReference) return order;
  const dcTable = resolveTable(franchise, dcField.referenceData.tableId);
  if (!dcTable) return order;
  if (!dcTable.recordsRead) await dcTable.readRecords();
  const dcRecord = dcTable.records[dcField.referenceData.rowNumber];
  if (!dcRecord || !dcRecord.fields[position]) return order;
  const posField = dcRecord.fields[position];
  if (!posField.isReference) return order;
  const arrTable = resolveTable(franchise, posField.referenceData.tableId);
  if (!arrTable) return order;
  if (!arrTable.recordsRead) await arrTable.readRecords();
  const arrRecord = arrTable.records[posField.referenceData.rowNumber];
  if (!arrRecord) return order;
  let i = 0;
  while (true) {
    let slotField;
    try { slotField = arrRecord.getFieldByKey(`Player${i}`); } catch { break; }
    if (!slotField) break;
    const ref = slotField.referenceData;
    if (ref && !(ref.tableId === 0 && ref.rowNumber === 0)) {
      const rec = playerTable.records[ref.rowNumber];
      if (rec && !rec.isEmpty) order.set(ref.rowNumber, i);
    }
    i++;
    if (i > 20) break;
  }
  return order;
}

async function rankTeamPosition(franchise, team, exactPosition, playerTable, teamMembership) {
  const depthOrder = await getDepthChartOrder(franchise, team, exactPosition, playerTable);
  const byDepthIndex = new Map();
  for (const [rowIndex, depthIndex] of depthOrder) byDepthIndex.set(depthIndex, rowIndex);
  const candidates = playersOnTeam(playerTable, teamMembership, team.index, (pos) => pos === exactPosition);
  const results = candidates.map((p) => {
    const depthIndex = depthOrder.has(p.index) ? depthOrder.get(p.index) : null;
    let protectedReason = null;
    if (depthIndex === 0) {
      protectedReason = 'starter';
    } else if (depthIndex !== null && depthIndex > 0) {
      const aheadRowIndex = byDepthIndex.get(depthIndex - 1);
      if (aheadRowIndex !== undefined) {
        const aheadPlayer = playerTable.records[aheadRowIndex];
        let aheadSchoolYear;
        try { aheadSchoolYear = aheadPlayer.SchoolYear; } catch { aheadSchoolYear = null; }
        if (aheadSchoolYear === 'Senior') protectedReason = 'next in line behind a graduating Senior';
      }
    }
    let schoolYear;
    try { schoolYear = p.SchoolYear; } catch { schoolYear = 'Unknown'; }
    return { player: p, exactPosition, ovr: p.OverallRating, schoolYear, depthIndex, inChart: depthIndex !== null, protectedReason, team };
  });
  const eligible = results.filter((r) => !r.protectedReason);
  eligible.sort(compareExpendability);
  return { eligible };
}

function compareExpendability(a, b) {
  if (a.inChart !== b.inChart) return a.inChart ? 1 : -1;
  if (a.inChart && b.inChart && a.depthIndex !== b.depthIndex) return b.depthIndex - a.depthIndex;
  const aClassRank = CLASS_YEAR_EXPENDABILITY_RANK[a.schoolYear] ?? 1.5;
  const bClassRank = CLASS_YEAR_EXPENDABILITY_RANK[b.schoolYear] ?? 1.5;
  if (aClassRank !== bClassRank) return aClassRank - bClassRank;
  return a.ovr - b.ovr;
}

function isEmptyPlayerSlot(slotField, playerTable, playerTableId) {
  const ref = slotField.referenceData;
  if (!ref || ref.tableId !== playerTableId) return true;
  const record = playerTable.records[ref.rowNumber];
  return !record || record.isEmpty;
}

function resortPositionSlotGroup(arrayRecord, playerTable, playerTableId, shouldRemove, recordIndexesToAdd = []) {
  const slotNames = Object.keys(arrayRecord.fields).filter((name) => {
    const field = arrayRecord.fields[name];
    return field && field.isReference;
  });
  if (!slotNames.length) return { changedCount: 0, kept: [], dropped: [] };
  const emptyTemplate = '0'.repeat(arrayRecord.fields[slotNames[0]].value.length);
  const present = [];
  const seen = new Set();
  for (const slotName of slotNames) {
    const slotField = arrayRecord.fields[slotName];
    if (isEmptyPlayerSlot(slotField, playerTable, playerTableId)) continue;
    const ref = slotField.referenceData;
    if (shouldRemove(ref.rowNumber)) continue;
    if (seen.has(ref.rowNumber)) continue;
    seen.add(ref.rowNumber);
    present.push(ref.rowNumber);
  }
  for (const recordIndex of recordIndexesToAdd) {
    if (seen.has(recordIndex)) continue;
    const record = playerTable.records[recordIndex];
    if (!record || record.isEmpty) continue;
    seen.add(recordIndex);
    present.push(recordIndex);
  }
  present.sort((a, b) => {
    const ovrA = playerTable.records[a]?.OverallRating || 0;
    const ovrB = playerTable.records[b]?.OverallRating || 0;
    return ovrB - ovrA;
  });
  const kept = present.slice(0, slotNames.length);
  const dropped = present.slice(slotNames.length);
  let changedCount = 0;
  for (let i = 0; i < slotNames.length; i++) {
    const slotName = slotNames[i];
    const slotField = arrayRecord.fields[slotName];
    const newValue = i < kept.length ? playerTable.getBinaryReferenceToRecord(kept[i]) : emptyTemplate;
    if (slotField.value !== newValue) {
      arrayRecord[slotName] = newValue;
      changedCount++;
    }
  }
  return { changedCount, kept, dropped };
}

async function reconcileRosterStore(franchise, team, playerTable, expectedIndices) {
  const name = team.DisplayName;
  if (!team.fields || !('Roster' in team.fields)) return { warning: `${name} has no Roster field.` };
  const rosterField = team.fields.Roster;
  if (!rosterField.isReference) return { warning: `${name}.Roster is not a reference.` };
  const ref = rosterField.referenceData;
  const rosterTable = resolveTable(franchise, ref.tableId);
  if (!rosterTable) return { warning: `Could not resolve Roster table for ${name}.` };
  if (!rosterTable.recordsRead) await rosterTable.readRecords();
  const rosterRecord = rosterTable.records[ref.rowNumber];
  if (!rosterRecord) return { warning: `Could not resolve Roster row for ${name}.` };
  const playerTableId = playerTable.header.tableId;
  const result = resortPositionSlotGroup(
    rosterRecord, playerTable, playerTableId,
    (idx) => !expectedIndices.has(idx),
    [...expectedIndices]
  );
  if (result.dropped.length) {
    return { ...result, warning: `${name}'s Roster store has no room for ${result.dropped.length} player(s).` };
  }
  return result;
}

const PRIMARY_DEPTH_CHART_POSITIONS = new Set([
  'QB', 'HB', 'FB', 'WR', 'TE', 'LT', 'LG', 'C', 'RG', 'RT',
  'LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB', 'CB', 'FS', 'SS', 'K', 'P',
]);

async function reconcileDepthCharts(franchise, team, playerTable, expectedIndices) {
  const warnings = [];
  if (!team.fields || !('DepthChart' in team.fields)) return { warnings };
  const dcField = team.fields.DepthChart;
  if (!dcField.isReference) return { warnings };
  const dcTable = resolveTable(franchise, dcField.referenceData.tableId);
  if (!dcTable) return { warnings };
  if (!dcTable.recordsRead) await dcTable.readRecords();
  const dcRecord = dcTable.records[dcField.referenceData.rowNumber];
  if (!dcRecord) return { warnings };
  const playerTableId = playerTable.header.tableId;
  const presentIndices = new Set();
  for (const fieldName of Object.keys(dcRecord.fields)) {
    if (!PRIMARY_DEPTH_CHART_POSITIONS.has(fieldName)) continue;
    const field = dcRecord.fields[fieldName];
    if (!field || !field.isReference) continue;
    const ref = field.referenceData;
    if (!ref || ref.tableId === 0) continue;
    const arrTable = resolveTable(franchise, ref.tableId);
    if (!arrTable) continue;
    if (!arrTable.recordsRead) await arrTable.readRecords();
    const arrRecord = arrTable.records[ref.rowNumber];
    if (!arrRecord) continue;
    const { kept } = resortPositionSlotGroup(arrRecord, playerTable, playerTableId, (idx) => {
      if (!expectedIndices.has(idx)) return true;
      const rec = playerTable.records[idx];
      let pos;
      try { pos = rec.Position; } catch { return true; }
      return pos !== fieldName;
    });
    for (const idx of kept) presentIndices.add(idx);
  }
  for (const idx of expectedIndices) {
    if (presentIndices.has(idx)) continue;
    const rec = playerTable.records[idx];
    if (!rec || rec.isEmpty) continue;
    let position;
    try { position = rec.Position; } catch { continue; }
    if (!position || !PRIMARY_DEPTH_CHART_POSITIONS.has(position) || !dcRecord.fields[position]) continue;
    const posField = dcRecord.fields[position];
    if (!posField.isReference) continue;
    const posRef = posField.referenceData;
    if (!posRef || posRef.tableId === 0) continue;
    const arrTable = resolveTable(franchise, posRef.tableId);
    if (!arrTable) continue;
    if (!arrTable.recordsRead) await arrTable.readRecords();
    const arrRecord = arrTable.records[posRef.rowNumber];
    if (!arrRecord) continue;
    const { kept } = resortPositionSlotGroup(arrRecord, playerTable, playerTableId, () => false, [idx]);
    for (const k of kept) presentIndices.add(k);
  }
  return { warnings };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Run the full redistribution pipeline.
 * @param {object} opts
 * @param {string} opts.savePath - path to the input save file
 * @param {boolean} opts.dryRun - if true, compute moves but never save or reconcile
 * @param {(line: string) => void} [opts.log] - progress callback
 * @returns {Promise<{moves: object[], byCheck: object, tier1Count: number, tier2Count: number, topTwoExceptionCount: number, affectedTeamCount: number, balanceLogCount: number, reconcileWarnings: string[], outputPath: string|null, backupPath: string|null}>}
 */
async function run({ savePath, dryRun, log = () => {}, settings = {} }) {
  const effectiveChecks = buildEffectiveChecks(settings.thresholdOverrides);
  const effectiveSevereThresholds = buildEffectiveSevereThresholds(settings.severeThresholdOverrides);
  const enableTier2 = settings.enableTier2 ?? true;
  const prestigeGapCap = settings.prestigeGapCap ?? 3;
  const tier2RecipientCapPerPosition = settings.tier2RecipientCapPerPosition ?? 1;
  const zeroNil = settings.zeroNil ?? true;

  const { default: Franchise } = await import('madden-franchise');
  log(`Opening save: ${savePath}`);
  const franchise = await Franchise.create(savePath);

  const teamTable = findCoreTable(franchise, 'Team', TEAM_UNIQUE_ID, log);
  const coachTable = findCoreTable(franchise, 'Coach', COACH_UNIQUE_ID, log);
  const playerTable = findCoreTable(franchise, 'Player', PLAYER_UNIQUE_ID, log);
  if (!teamTable || !coachTable || !playerTable) {
    throw new Error('Could not find the Team, Coach, or Player table in this save -- it may be from an unsupported game version.');
  }
  await teamTable.readRecords();
  await coachTable.readRecords();
  await playerTable.readRecords();

  const realTeams = teamTable.records.filter((r) => isRealTeam(r));
  log(`Team table: ${teamTable.records.length} total records, ${realTeams.length} real teams.`);

  const cpuTeams = [];
  for (const team of realTeams) {
    if (isUserControlledTeam(franchise, team, coachTable)) continue;
    cpuTeams.push(team);
  }
  log(`${cpuTeams.length} CPU teams in the league.`);

  log('Resolving authoritative team rosters (Roster array, not just TeamIndex)...');
  const teamMembership = await buildAuthoritativeTeamMap(franchise, teamTable, playerTable, log);

  const countsByTeam = new Map();
  for (const p of playerTable.records) {
    let pos, ovr;
    try { pos = p.Position; ovr = p.OverallRating; } catch { continue; }
    if (ovr <= 0) continue;
    const ti = teamMembership.get(p.index);
    if (ti === undefined) continue;
    if (!countsByTeam.has(ti)) countsByTeam.set(ti, {});
    countsByTeam.get(ti)[pos] = (countsByTeam.get(ti)[pos] || 0) + 1;
  }

  const allMoves = [];
  const affectedTeamIndexes = new Set();

  for (const [checkKey, config] of Object.entries(effectiveChecks)) {
    const teamSums = cpuTeams.map((team) => {
      const counts = countsByTeam.get(team.index) || {};
      const sum = config.members.reduce((acc, m) => acc + (counts[m] || 0), 0);
      const eff = getEffectiveThresholds(checkKey, config, team);
      return { team, sum, min: eff.min, max: eff.max };
    });

    const donors = teamSums.filter((t) => t.sum > t.max);
    const effectiveSevereThreshold = effectiveSevereThresholds[checkKey];
    const severeDonors = donors.filter((t) => t.sum > t.max + effectiveSevereThreshold);
    const normalDonors = donors.filter((t) => t.sum <= t.max + effectiveSevereThreshold);
    const needy = teamSums.filter((t) => t.sum < t.min)
      .map((t) => ({ ...t, gap: t.min - t.sum }))
      .sort((a, b) => b.gap - a.gap);

    if (donors.length === 0 && needy.length === 0) continue;
    log(`${checkKey}: ${donors.length} donor(s) (${severeDonors.length} severe), ${needy.length} needy team(s)...`);

    const surplusPool = [];
    async function buildDonorContribution(team, sum, max, isSevere) {
      const toGiveUp = sum - max;
      let contributed = 0;
      const perPositionEligible = [];
      for (const exactPos of config.members) {
        const { eligible } = await rankTeamPosition(franchise, team, exactPos, playerTable, teamMembership);
        perPositionEligible.push(...eligible);
      }
      perPositionEligible.sort(compareExpendability);
      for (const candidate of perPositionEligible) {
        if (contributed >= toGiveUp) break;
        surplusPool.push({ ...candidate, isSevere });
        contributed++;
      }
    }
    for (const { team, sum, max } of severeDonors) await buildDonorContribution(team, sum, max, true);
    for (const { team, sum, max } of normalDonors) await buildDonorContribution(team, sum, max, false);

    function executeMove(candidate, recipientTeam, tier, viaTopTwoException, extraLogSuffix = '') {
      const movingPlayer = candidate.player;
      const fromName = candidate.team.DisplayName;
      const toName = recipientTeam.DisplayName;
      const playerName = `${movingPlayer.FirstName} ${movingPlayer.LastName}`;
      movingPlayer.TeamIndex = recipientTeam.index;
      teamMembership.set(movingPlayer.index, recipientTeam.index);
      try { movingPlayer.PrevTeamIndex = candidate.team.index; } catch {}
      try { if (zeroNil) { movingPlayer.BaseNILValue = 0; movingPlayer.CurrentNILCompensation = 0; movingPlayer.IsNIL = false; } } catch {}
      affectedTeamIndexes.add(candidate.team.index);
      affectedTeamIndexes.add(recipientTeam.index);
      allMoves.push({
        checkKey, tier, viaTopTwoException,
        player: playerName,
        position: candidate.exactPosition,
        ovr: candidate.ovr,
        schoolYear: candidate.schoolYear,
        from: fromName,
        to: toName,
      });
      log(`  [T${tier}] ${playerName} (${candidate.exactPosition}, OVR ${candidate.ovr}) : ${fromName} -> ${toName}${extraLogSuffix}`);
    }

    const stillNeedy = needy.map((n) => ({ ...n, remainingGap: n.gap }));
    let surplusIndex = 0;
    while (surplusIndex < surplusPool.length && stillNeedy.some((n) => n.remainingGap > 0)) {
      let madeMoveThisRound = false;
      for (const n of stillNeedy) {
        if (n.remainingGap <= 0) continue;
        if (surplusIndex >= surplusPool.length) break;
        const candidate = surplusPool[surplusIndex];
        surplusIndex++;
        executeMove(candidate, n.team, 1, false);
        n.remainingGap--;
        madeMoveThisRound = true;
      }
      if (!madeMoveThisRound) break;
    }

    const leftoverSevere = enableTier2 ? surplusPool.slice(surplusIndex).filter((c) => c.isSevere) : [];
    if (leftoverSevere.length > 0) {
      const tier1RecipientNames = new Set(allMoves.filter((m) => m.checkKey === checkKey && m.tier === 1).map((m) => m.to));
      const notOverMax = teamSums.filter((t) => t.sum <= t.max);
      const preferredRecipients = notOverMax.filter((t) => !tier1RecipientNames.has(t.team.DisplayName));
      const fallbackRecipients = notOverMax.filter((t) => tier1RecipientNames.has(t.team.DisplayName));
      const queue = [...shuffle(preferredRecipients), ...shuffle(fallbackRecipients)];
      let queuePointer = 0;
      // Caps how many Tier 2 players any single team can absorb at this
      // position in one run -- without it, a genuinely rare low-prestige
      // team can end up as the ONLY eligible recipient for dozens of
      // leftover-severe candidates in a row (confirmed on a real save:
      // two small programs absorbed 40+ QBs in a single Apply). A
      // candidate that can't be placed under this cap is simply left
      // unassigned for this run rather than concentrated -- spreads a
      // large backlog across several preseasons instead of dumping it
      // all at once.
      const tier2RecipientCounts = new Map();

      for (const candidate of leftoverSevere) {
        // NOTE: TeamPrestige has historically been unreliable to read on
        // some saves -- guard against undefined/NaN so a bad read
        // degrades safely (prestige cap effectively disabled) instead
        // of silently breaking every Tier 2 comparison. Default to 0 on
        // both sides so the gap always computes to a
        // real number (0) instead of NaN, which would otherwise make
        // every prestige check silently fail. This means the prestige
        // cap is effectively disabled until Team's schema is fixed --
        // acceptable degraded behavior, not a crash.
        let donorPrestige = 0;
        try { donorPrestige = candidate.team.TeamPrestige ?? 0; } catch { donorPrestige = 0; }
        let assigned = false;
        for (let attempts = 0; attempts < queue.length; attempts++) {
          const idx = (queuePointer + attempts) % queue.length;
          const recipient = queue[idx];
          if ((tier2RecipientCounts.get(recipient.team.index) || 0) >= tier2RecipientCapPerPosition) continue;
          let recipientPrestige = 0;
          try { recipientPrestige = recipient.team.TeamPrestige ?? 0; } catch { recipientPrestige = 0; }
          const prestigeGap = recipientPrestige - donorPrestige;
          const recipientCurrentAtPosition = playersOnTeam(playerTable, teamMembership, recipient.team.index, (pos) => pos === candidate.exactPosition);
          const higherRatedCount = recipientCurrentAtPosition.filter((p) => p.OverallRating > candidate.ovr).length;
          const wouldRankTopTwo = higherRatedCount <= 1;
          if (prestigeGap <= prestigeGapCap || wouldRankTopTwo) {
            const viaTopTwo = prestigeGap > prestigeGapCap && wouldRankTopTwo;
            const reason = viaTopTwo
              ? ` [via top-2 exception -- prestige gap ${prestigeGap} (cap ${prestigeGapCap}), donor prestige ${donorPrestige}, recipient prestige ${recipientPrestige}]`
              : ` [prestige gap ${prestigeGap} (cap ${prestigeGapCap}), donor prestige ${donorPrestige}, recipient prestige ${recipientPrestige}]`;
            executeMove(candidate, recipient.team, 2, viaTopTwo, reason);
            tier2RecipientCounts.set(recipient.team.index, (tier2RecipientCounts.get(recipient.team.index) || 0) + 1);
            queuePointer = (idx + 1) % queue.length;
            assigned = true;
            break;
          }
        }
      }
    }
  }

  const byCheck = {};
  for (const m of allMoves) byCheck[m.checkKey] = (byCheck[m.checkKey] || 0) + 1;
  const tier1Count = allMoves.filter((m) => m.tier === 1).length;
  const tier2Count = allMoves.filter((m) => m.tier === 2).length;
  const topTwoExceptionCount = allMoves.filter((m) => m.viaTopTwoException).length;

  log(`=== ${allMoves.length} total move(s) computed (${tier1Count} Tier 1, ${tier2Count} Tier 2, ${topTwoExceptionCount} via top-2 exception) ===`);

  if (dryRun) {
    log('Dry run complete -- nothing was written.');
    return {
      moves: allMoves, byCheck, tier1Count, tier2Count, topTwoExceptionCount,
      affectedTeamCount: affectedTeamIndexes.size, balanceLogCount: 0,
      reconcileWarnings: [], outputPath: null, backupPath: null,
    };
  }

  // Left/right rebalance -- full re-derivation by OVR rank. For OT/Guards,
  // the premium side isn't fixed -- it depends on each team's own #1 QB's
  // handedness. A right-handed QB's blind side is his left (hence LT/LG
  // being the traditional premium spots); a left-handed QB's blind side
  // flips to the right (RT/RG). DE deliberately has no premium side at
  // all -- edge-rusher alignment is driven by scheme/matchup, not QB
  // handedness, so it stays a straight alternation either way.
  function getQbHandednessPremiumSides(team) {
    const qbs = playersOnTeam(playerTable, teamMembership, team.index, (pos) => pos === 'QB');
    if (qbs.length === 0) return { otPremium: 'LT', gPremium: 'LG' }; // default if no real QB found
    qbs.sort((a, b) => b.OverallRating - a.OverallRating);
    const qb1 = qbs[0];
    let handedness = 'Right';
    try { handedness = qb1.PLYR_HANDEDNESS ?? 'Right'; } catch { handedness = 'Right'; }
    return handedness === 'Left'
      ? { otPremium: 'RT', gPremium: 'RG' }
      : { otPremium: 'LT', gPremium: 'LG' };
  }

  const balanceLog = [];
  for (const team of cpuTeams) {
    const { otPremium, gPremium } = getQbHandednessPremiumSides(team);
    const GROUPED_REBALANCE = [
      { sideA: 'LT', sideB: 'RT', premium: otPremium },
      { sideA: 'LG', sideB: 'RG', premium: gPremium },
      { sideA: 'LE', sideB: 'RE', premium: null },
    ];
    for (const { sideA, sideB, premium } of GROUPED_REBALANCE) {
      const combined = playersOnTeam(playerTable, teamMembership, team.index, (pos) => pos === sideA || pos === sideB);
      if (combined.length === 0) continue;
      combined.sort((a, b) => b.OverallRating - a.OverallRating);
      const firstSide = premium || sideA;
      const secondSide = firstSide === sideA ? sideB : sideA;
      combined.forEach((p, i) => {
        const targetSide = i % 2 === 0 ? firstSide : secondSide;
        if (p.Position !== targetSide) {
          p.Position = targetSide;
          balanceLog.push(`${team.DisplayName}: relabeled ${p.FirstName} ${p.LastName}`);
          affectedTeamIndexes.add(team.index);
        }
      });
    }
  }
  log(`${balanceLog.length} left/right rebalance relabel(s) applied.`);

  log(`Reconciling Roster + DepthChart for ${affectedTeamIndexes.size} affected team(s)...`);
  const reconcileWarnings = [];
  for (const teamIndex of affectedTeamIndexes) {
    const team = teamTable.records[teamIndex];
    if (!team) continue;
    const expectedIndices = new Set(
      playerTable.records
        .filter((p) => {
          let ovr;
          try { ovr = p.OverallRating; } catch { return false; }
          return ovr > 0 && teamMembership.get(p.index) === teamIndex;
        })
        .map((p) => p.index)
    );
    const rosterResult = await reconcileRosterStore(franchise, team, playerTable, expectedIndices);
    if (rosterResult.warning) reconcileWarnings.push(rosterResult.warning);
    const dcResult = await reconcileDepthCharts(franchise, team, playerTable, expectedIndices);
    reconcileWarnings.push(...dcResult.warnings);
  }
  for (const w of reconcileWarnings) log(`  WARNING: ${w}`);

  // Back up the original save before touching anything, since this run now
  // overwrites savePath in place instead of writing a separate
  // _REDISTRIBUTED file. The backup goes in a dedicated folder next to the
  // save itself, timestamped so every past run's backup is kept rather than
  // overwritten by the next one.
  const saveDir = path.dirname(savePath);
  const backupDir = path.join(saveDir, 'Preseason Transfer Backup');
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `${path.basename(savePath)}_${timestamp}`);
  log(`Backing up original save to: ${backupPath}`);
  fs.copyFileSync(savePath, backupPath);

  const tempPath = path.join(saveDir, `.${path.basename(savePath)}.tmp-${Date.now()}`);
  log(`Saving to temp file: ${tempPath}`);
  await franchise.save(tempPath);
  fs.renameSync(tempPath, savePath);
  log(`Saved. Original was backed up to "Preseason Transfer Backup" and then overwritten in place. Output: ${savePath}`);

  return {
    moves: allMoves, byCheck, tier1Count, tier2Count, topTwoExceptionCount,
    affectedTeamCount: affectedTeamIndexes.size, balanceLogCount: balanceLog.length,
    reconcileWarnings, outputPath: savePath, backupPath,
  };
}

/**
 * Read-only team-by-team position report -- no moves, no writes. Powers
 * the Team Health tab: pick a team, see every position's current count
 * against its effective min/max (with scheme deltas + any user setting
 * overrides already applied), color-coded green/yellow/red by the UI.
 */
async function scanTeamHealth({ savePath, settings = {}, log = () => {} }) {
  const effectiveChecks = buildEffectiveChecks(settings.thresholdOverrides);
  const { default: Franchise } = await import('madden-franchise');
  log(`Opening save: ${savePath}`);
  const franchise = await Franchise.create(savePath);

  const teamTable = findCoreTable(franchise, 'Team', TEAM_UNIQUE_ID, log);
  const coachTable = findCoreTable(franchise, 'Coach', COACH_UNIQUE_ID, log);
  const playerTable = findCoreTable(franchise, 'Player', PLAYER_UNIQUE_ID, log);
  if (!teamTable || !coachTable || !playerTable) {
    throw new Error('Could not find the Team, Coach, or Player table in this save.');
  }
  await teamTable.readRecords();
  await coachTable.readRecords();
  await playerTable.readRecords();

  const realTeams = teamTable.records.filter((r) => isRealTeam(r));

  const teamMembership = await buildAuthoritativeTeamMap(franchise, teamTable, playerTable, log);

  const countsByTeam = new Map();
  for (const p of playerTable.records) {
    let pos, ovr;
    try { pos = p.Position; ovr = p.OverallRating; } catch { continue; }
    if (ovr <= 0) continue;
    const ti = teamMembership.get(p.index);
    if (ti === undefined) continue;
    if (!countsByTeam.has(ti)) countsByTeam.set(ti, {});
    countsByTeam.get(ti)[pos] = (countsByTeam.get(ti)[pos] || 0) + 1;
  }

  const results = [];
  for (const team of realTeams) {
    const isUserControlled = isUserControlledTeam(franchise, team, coachTable);
    const counts = countsByTeam.get(team.index) || {};
    const positions = {};
    for (const [checkKey, config] of Object.entries(effectiveChecks)) {
      const sum = config.members.reduce((acc, m) => acc + (counts[m] || 0), 0);
      const eff = getEffectiveThresholds(checkKey, config, team);
      let status = 'ok';
      if (sum < eff.min) status = 'under';
      else if (sum > eff.max) status = 'over';
      positions[checkKey] = { sum, min: eff.min, max: eff.max, status };
    }
    let offScheme, defScheme;
    try { offScheme = team.CurrentOffensiveScheme; } catch { offScheme = null; }
    try { defScheme = team.CurrentDefensiveScheme; } catch { defScheme = null; }
    if (isUserControlled) {
      log(`User team "${team.DisplayName}" (index ${team.index}): raw counts by exact position = ${JSON.stringify(counts)}`);
      log(`  Grouped: OT=${positions.OT?.sum}, Guards=${positions.Guards?.sum}, DE=${positions.DE?.sum}`);
    }
    results.push({ teamIndex: team.index, name: team.DisplayName, isUserControlled, offScheme, defScheme, positions });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * Lightweight team list -- just the Team table, no Player/Coach reads.
 * Powers the Roster tab's save-picker -> team-dropdown flow without
 * paying the cost of a full health scan just to populate a dropdown.
 */
async function listRealTeams({ savePath }) {
  const { default: Franchise } = await import('madden-franchise');
  const franchise = await Franchise.create(savePath);
  const teamTable = findCoreTable(franchise, 'Team', TEAM_UNIQUE_ID, () => {});
  const coachTable = findCoreTable(franchise, 'Coach', COACH_UNIQUE_ID, () => {});
  if (!teamTable || !coachTable) throw new Error('Could not find the Team or Coach table in this save.');
  await teamTable.readRecords();
  await coachTable.readRecords();

  const results = teamTable.records
    .filter((t) => isRealTeam(t))
    .map((t) => ({
      teamIndex: t.index,
      name: t.DisplayName,
      isUserControlled: isUserControlledTeam(franchise, t, coachTable),
    }));
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * Full current roster for one team, via the same authoritative
 * Roster-array resolution buildAuthoritativeTeamMap() uses -- not
 * Player.TeamIndex. Powers the Roster tab.
 */
// Same order the game itself lists positions in on its depth chart --
// used only for the Roster tab, where players are shown individually.
// Elsewhere in this module positions are grouped (OT/Guards/DE/etc. for
// counting purposes), so this ordering doesn't apply there.
const GAME_POSITION_ORDER = [
  'QB', 'HB', 'FB', 'WR', 'TE',
  'LT', 'LG', 'C', 'RG', 'RT',
  'LE', 'RE', 'DT', 'LOLB', 'MLB', 'ROLB',
  'CB', 'FS', 'SS', 'K', 'P',
];
const GAME_POSITION_ORDER_INDEX = new Map(GAME_POSITION_ORDER.map((pos, i) => [pos, i]));

function gamePositionRank(pos) {
  return GAME_POSITION_ORDER_INDEX.has(pos) ? GAME_POSITION_ORDER_INDEX.get(pos) : GAME_POSITION_ORDER.length;
}

async function getTeamRoster({ savePath, teamIndex }) {
  const { default: Franchise } = await import('madden-franchise');
  const franchise = await Franchise.create(savePath);

  const teamTable = findCoreTable(franchise, 'Team', TEAM_UNIQUE_ID, () => {});
  const playerTable = findCoreTable(franchise, 'Player', PLAYER_UNIQUE_ID, () => {});
  if (!teamTable || !playerTable) throw new Error('Could not find the Team or Player table in this save.');
  await teamTable.readRecords();
  await playerTable.readRecords();

  const team = teamTable.records[teamIndex];
  if (!team) throw new Error(`No team at index ${teamIndex}.`);

  const rosterTeamByPlayerIndex = await buildRosterTeamByPlayerIndex(franchise, teamTable, playerTable);
  const players = [];
  for (const [playerIndex, ti] of rosterTeamByPlayerIndex) {
    if (ti !== teamIndex) continue;
    const p = playerTable.records[playerIndex];
    let fn, ln, pos, ovr, schoolYear;
    try {
      fn = p.FirstName; ln = p.LastName; pos = p.Position; ovr = p.OverallRating; schoolYear = p.SchoolYear;
    } catch { continue; }
    players.push({ playerIndex, name: `${fn} ${ln}`, position: pos, ovr, schoolYear: schoolYear || 'Unknown' });
  }
  players.sort((a, b) => {
    const rankDiff = gamePositionRank(a.position) - gamePositionRank(b.position);
    return rankDiff !== 0 ? rankDiff : b.ovr - a.ovr;
  });

  let offScheme, defScheme;
  try { offScheme = team.CurrentOffensiveScheme; } catch { offScheme = null; }
  try { defScheme = team.CurrentDefensiveScheme; } catch { defScheme = null; }

  return { teamIndex, teamName: team.DisplayName, offScheme, defScheme, players };
}

module.exports = {
  run,
  scanTeamHealth,
  listRealTeams,
  getTeamRoster,
  POSITION_KEYS: Object.keys(CHECKS),
  DEFAULT_CHECKS: CHECKS,
  DEFAULT_SEVERE_THRESHOLDS,
  buildEffectiveSevereThresholds,
};
