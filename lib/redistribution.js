/**
 * Core redistribution logic, refactored from run_redistribution.cjs into
 * a reusable module. Reports progress via a `log(line)` callback instead
 * of console.log, so both the CLI script and the Electron GUI can drive
 * it. In dryRun mode, it computes and returns every move it WOULD make,
 * but never touches Roster/DepthChart reconciliation or the save file --
 * exactly like dry_run_full_league.cjs. In apply mode, it does the full
 * pipeline: matching -> left/right rebalance -> Roster/DepthChart
 * reconciliation -> atomic save to a NEW file (never overwrites the
 * input save).
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
  if (checkKey === 'FB' && PASS_HEAVY_SPREAD_SCHEMES.has(offScheme)) min = 0;
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

async function rankTeamPosition(franchise, team, exactPosition, playerTable) {
  const depthOrder = await getDepthChartOrder(franchise, team, exactPosition, playerTable);
  const byDepthIndex = new Map();
  for (const [rowIndex, depthIndex] of depthOrder) byDepthIndex.set(depthIndex, rowIndex);
  const candidates = playerTable.records.filter((p) => {
    try { return p.TeamIndex === team.index && p.Position === exactPosition && p.OverallRating > 0; } catch { return false; }
  });
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
 * @returns {Promise<{moves: object[], byCheck: object, tier1Count: number, tier2Count: number, topTwoExceptionCount: number, affectedTeamCount: number, balanceLogCount: number, reconcileWarnings: string[], outputPath: string|null}>}
 */
async function run({ savePath, dryRun, log = () => {}, settings = {} }) {
  const effectiveChecks = buildEffectiveChecks(settings.thresholdOverrides);
  const severeThreshold = settings.severeThreshold ?? 2;
  const smallPositionSevereThreshold = settings.smallPositionSevereThreshold ?? 0;
  const SMALL_POSITIONS = new Set(['FB', 'K', 'P']);
  const enableTier2 = settings.enableTier2 ?? true;
  const prestigeGapCap = settings.prestigeGapCap ?? 3;
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

  const countsByTeam = new Map();
  for (const p of playerTable.records) {
    let ti, pos, ovr;
    try { ti = p.TeamIndex; pos = p.Position; ovr = p.OverallRating; } catch { continue; }
    if (ovr <= 0) continue;
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
    const effectiveSevereThreshold = SMALL_POSITIONS.has(checkKey) ? smallPositionSevereThreshold : severeThreshold;
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
        const { eligible } = await rankTeamPosition(franchise, team, exactPos, playerTable);
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

    function executeMove(candidate, recipientTeam, tier, viaTopTwoException) {
      const movingPlayer = candidate.player;
      const fromName = candidate.team.DisplayName;
      const toName = recipientTeam.DisplayName;
      const playerName = `${movingPlayer.FirstName} ${movingPlayer.LastName}`;
      movingPlayer.TeamIndex = recipientTeam.index;
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
      log(`  [T${tier}] ${playerName} (${candidate.exactPosition}, OVR ${candidate.ovr}) : ${fromName} -> ${toName}`);
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
          let recipientPrestige = 0;
          try { recipientPrestige = recipient.team.TeamPrestige ?? 0; } catch { recipientPrestige = 0; }
          const prestigeGap = recipientPrestige - donorPrestige;
          const recipientCurrentAtPosition = playerTable.records.filter((p) => {
            try { return p.TeamIndex === recipient.team.index && p.Position === candidate.exactPosition && p.OverallRating > 0; } catch { return false; }
          });
          const higherRatedCount = recipientCurrentAtPosition.filter((p) => p.OverallRating > candidate.ovr).length;
          const wouldRankTopTwo = higherRatedCount <= 1;
          if (prestigeGap <= prestigeGapCap || wouldRankTopTwo) {
            executeMove(candidate, recipient.team, 2, prestigeGap > prestigeGapCap && wouldRankTopTwo);
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
      reconcileWarnings: [], outputPath: null,
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
    const qbs = playerTable.records.filter((p) => {
      try { return p.TeamIndex === team.index && p.Position === 'QB' && p.OverallRating > 0; } catch { return false; }
    });
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
      const combined = playerTable.records.filter((p) => {
        try { return p.TeamIndex === team.index && (p.Position === sideA || p.Position === sideB) && p.OverallRating > 0; } catch { return false; }
      });
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
          try { return p.TeamIndex === teamIndex && p.OverallRating > 0; } catch { return false; }
        })
        .map((p) => p.index)
    );
    const rosterResult = await reconcileRosterStore(franchise, team, playerTable, expectedIndices);
    if (rosterResult.warning) reconcileWarnings.push(rosterResult.warning);
    const dcResult = await reconcileDepthCharts(franchise, team, playerTable, expectedIndices);
    reconcileWarnings.push(...dcResult.warnings);
  }
  for (const w of reconcileWarnings) log(`  WARNING: ${w}`);

  const outputPath = savePath + '_REDISTRIBUTED';
  const tempPath = path.join(path.dirname(outputPath), `.${path.basename(outputPath)}.tmp-${Date.now()}`);
  log(`Saving to temp file: ${tempPath}`);
  await franchise.save(tempPath);
  fs.renameSync(tempPath, outputPath);
  log(`Saved. Original save was NOT modified. Output: ${outputPath}`);

  return {
    moves: allMoves, byCheck, tier1Count, tier2Count, topTwoExceptionCount,
    affectedTeamCount: affectedTeamIndexes.size, balanceLogCount: balanceLog.length,
    reconcileWarnings, outputPath,
  };
}

/**
 * Read-only team-by-team position report -- no moves, no writes. Powers
 * the Team Health tab: pick a team, see every position's current count
 * against its effective min/max (with scheme deltas + any user setting
 * overrides already applied), color-coded green/yellow/red by the UI.
 */
async function scanTeamHealth({ savePath, settings = {} }) {
  const effectiveChecks = buildEffectiveChecks(settings.thresholdOverrides);
  const { default: Franchise } = await import('madden-franchise');
  const franchise = await Franchise.create(savePath);

  const teamTable = findCoreTable(franchise, 'Team', TEAM_UNIQUE_ID, () => {});
  const coachTable = findCoreTable(franchise, 'Coach', COACH_UNIQUE_ID, () => {});
  const playerTable = findCoreTable(franchise, 'Player', PLAYER_UNIQUE_ID, () => {});
  if (!teamTable || !coachTable || !playerTable) {
    throw new Error('Could not find the Team, Coach, or Player table in this save.');
  }
  await teamTable.readRecords();
  await coachTable.readRecords();
  await playerTable.readRecords();

  const realTeams = teamTable.records.filter((r) => isRealTeam(r));

  const countsByTeam = new Map();
  for (const p of playerTable.records) {
    let ti, pos, ovr;
    try { ti = p.TeamIndex; pos = p.Position; ovr = p.OverallRating; } catch { continue; }
    if (ovr <= 0) continue;
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
    results.push({ teamIndex: team.index, name: team.DisplayName, isUserControlled, offScheme, defScheme, positions });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

module.exports = { run, scanTeamHealth, POSITION_KEYS: Object.keys(CHECKS), DEFAULT_CHECKS: CHECKS };
