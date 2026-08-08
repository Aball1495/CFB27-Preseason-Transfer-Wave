# Preseason Transfer Wave

A tool that fixes CPU team rosters in EA Sports College Football 27 dynasties.

The CPU doesn't manage its own rosters well. Some teams end up with way too many players at one position (14 running backs) while other teams end up with almost none (0 punters). This tool looks at every CPU team's roster, finds those problems, and moves players around to fix them -- before each new season starts.

It never touches your own team. It never changes your original save file -- every run makes a brand new file, so your original is always safe.

## Screenshots

**Run tab, mid-run -- live log with Waterfall/Tier 1/Tier 2 moves, summary cards once done.**
!\[Run tab](screenshots/run-tab-live-log.png)

**Settings tab -- every position's min/max, editable, with the defaults shown alongside for comparison.**
!\[Settings tab](screenshots/settings-tab.png)

**Team Health, Current Snapshot -- one team's position counts against their effective min/max.**
!\[Team Health snapshot](screenshots/team-health-snapshot.png)

**Team Health, Season History -- league-wide green/yellow/red totals over time.**
!\[Team Health season history](screenshots/team-health-season-history.png)

**History tab -- every past Apply run, with totals and a delete option per entry.**
!\[Run history](screenshots/run-history.png)

\---

## Table of Contents

* [What it does](#what-it-does)
* [Installation](#installation)
* [Quick start](#quick-start)
* [The Run tab](#the-run-tab)
* [The Settings tab](#the-settings-tab)
* [The History tab](#the-history-tab)
* [The Team Health tab](#the-team-health-tab)
* [How it decides who moves](#how-it-decides-who-moves)
* [The Transfer Waterfall](#the-transfer-waterfall)
* [Locked threshold table](#locked-threshold-table)
* [Scheme awareness](#scheme-awareness)
* [Safety design](#safety-design)
* [Known limitations](#known-limitations)
* [Changelog](#changelog)
* [Credits](#credits)

\---

## What it does

Every position has a normal range of how many players a team should have. QBs, for example, should be somewhere between 2 and 3. If a team has way more than that, some of those extra players get moved to a team that doesn't have enough.

Step by step, each time you run it:

1. It reads every real CPU team's roster (skips your own team, skips fake scheduling-only entries like "FCS East").
2. It compares each team's count at each position against the normal range for that position.
3. Teams over the range are donors. Teams under the range are recipients.
4. It picks which specific players move -- bench players who aren't starters and aren't next in line to start, worst players first.
5. It matches donors to recipients so the extra players get spread across many different teams instead of all going to one team.
6. If a team is way over the range (not just a little), some of that extra gets moved out even if no other team currently needs it. This is capped so a bad team doesn't just get handed players from a great team -- with one exception: a real talent upgrade is still allowed through.
7. It saves everything correctly -- not just "who's on what team," but also depth charts, left/right O-line balance, and NIL values.

You're meant to run this once before every season, for as long as your dynasty lasts.

## Installation

Download the release, unzip it wherever you like, and double-click `Preseason Transfer Wave.exe`. That's it -- no Node.js, no npm, nothing else to install.

## Quick start

1. Go to the **Run** tab, click **Choose Save File**, and pick your dynasty save.
2. Click **Preview (Dry Run)** first. This shows you everything it *would* do, without actually changing anything.
3. If it looks right, click **Apply Changes**. This overwrites your save while creating a backup of the original in a folder labeled "Preseason Transfer Backup" -- if you ever need to restore it, just rename it and place it back in the regular saves folder.
4. Load that file in-game like you'd load any other save.

## The Run tab

* **Choose Save File** -- pick your save.
* **Preview (Dry Run)** -- shows what would happen. Changes nothing.
* **Apply Changes** -- actually makes the moves and saves a new file. Asks you to confirm first.
* **Live Log** -- shows each move as it happens. `\[T1]` means a normal move (filling real need). `\[T2]` means a forced move (a team had way too many players at that spot). `\[WF]` means a player moved for better playing time via the Transfer Waterfall.
* **Summary cards** -- totals once it's done: how many moves, how many were WF vs T1 vs T2, how many teams were touched.

## The Settings tab

* **Position Thresholds** -- the normal min/max range for every position. You can change any of them. The defaults were set by looking at real numbers across a whole league, not guessed.
* **Tier 2 Behavior** -- a switch to turn the "forced move" behavior on or off, plus:

  * **Severe donor threshold** -- how far over the max a team has to be before it counts as a "forced move" situation.
  * **Severe donor threshold for FB/K/P** -- these positions have such small normal ranges that the setting above barely ever applies to them. This is a separate, smaller number just for those three, so a team stuck with zero punters can actually get one.
  * **Prestige gap cap** -- applies to both Tier 2 and Waterfall moves, in both directions. A player can't land somewhere dramatically different in prestige from where they came from -- a bench player from a small program shouldn't teleport onto a national title contender, and a player from a powerhouse program shouldn't be dumped at the bottom of the rankings either. The big fish, small pond exception can still push past this cap downward at low odds when a player clearly deserves a better opportunity. A player who'd immediately rank in the top 2 at their position on the new team skips this cap on the upward side entirely -- a real, portal-worthy talent upgrade is allowed to jump further than an ordinary depth move.
* **Other Options** -- a checkbox to zero out a moved player's NIL value. We don't actually know if this changes anything about how the CPU treats the player -- it's just a reasonable guess, so it's optional instead of forced on.
* **Transfer Waterfall** -- off by default. See [The Transfer Waterfall](#the-transfer-waterfall) for what it does. Settings when enabled:

  * **Big fish, small pond chance** -- a rare chance for a much bigger downward jump than the normal cap allows -- a genuine blue-blood backup occasionally landing somewhere far smaller, just to finally start. Defaults to 0 (can never fire) until turned up.
  * **Max waterfall arrivals per team, per position, per run** -- the recipient cap (default 1).
  * **QB rank-2 OVR threshold** -- the overall rating (default 90) a #2 QB needs to qualify on his own talent alone, regardless of who's ahead of him or his own class. Adjustable if 90 doesn't feel like the right line.
* **Playbook Awareness** -- explains how a team's real offense/defense playbook shifts some of the numbers automatically. You don't set this yourself; it just happens based on real data.

Settings are saved and used every time you run the tool.

## The History tab

Every time you click Apply, it saves a record here -- date, total moves, how many were T1 vs T2, how many teams were touched. Shown as a chart and a table. You can delete any single entry or clear everything.

## The Team Health tab

Two tabs inside this tab:

* **Current Snapshot** -- pick a save (separate from whatever's picked on the Run tab) and scan it. Shows every team's count at every position, colored green (fine), yellow (over the max), or red (under the min). Shows the team's logo, colors, and real playbook too.
* **Season History** -- every time you scan, it saves the league-wide green/yellow/red totals as one entry in a chart, so you can watch the whole league's health over your whole dynasty. Hover over the red part of any bar to see exactly which positions are causing it (like "12-FB, 6-Sam, 4-P"). Your own team is left out of these totals on purpose, since this tool is about CPU teams, not you.
* **Roster** -- see a current breakdown of each team's roster, including which players were added to a team.

## How it decides who moves

**Picking who's expendable on a donor team:**

1. Starters never move.
2. A backup who's about to inherit a starting job (because the guy ahead of them is a graduating senior) never moves -- unless their overall rating is high enough that it doesn't make sense to ride the bench (see [The Transfer Waterfall](#the-transfer-waterfall)).
3. Everyone else: players buried deepest on the bench go first, then by class year (older players before younger, to protect younger players' development time), then lowest overall rating as the final tiebreaker.

**Matching donors to recipients:** the most in-need team gets the most expendable player first, then the next most in-need team gets the next player, and so on -- spreading things out instead of dumping everything on one team.

**Forced moves (Tier 2):** only for teams that are way, way over the max -- more than a normal correction. Their extra players get spread to teams that aren't already over the max, picked randomly each time so it's not always the same teams receiving them, and capped by the prestige rule mentioned above.

**Left/right line balance:** after moves are made, tackles and guards get sorted so the better players go on the correct side based on the team's starting QB -- right-handed QB means the left side gets the better players, left-handed QB flips it. Defensive ends don't have a "better side," so they just alternate evenly.

## The Transfer Waterfall

Tier 1 and Tier 2 fix roster counts -- too many at one position, too few at another. The Transfer Waterfall is a separate mechanic layered on top that fixes something counts can't see: a genuinely good player stuck with no real path to play, even on a team with a perfectly normal roster count at that position.

**Who qualifies:**

* Any position: a player buried 3rd-string-or-lower at their exact spot on their own team's depth chart.
* QB specifically, additionally: a player at #2 on their own team's depth chart, if *either* of the following is true --

  * The starter ahead of them is the same class or younger (meaning graduation will never open the job for them, no matter how long they wait), or
  * Their own overall rating clears a threshold (default 90, adjustable in Settings) -- regardless of who is ahead of them, a player with an overall higher than the set threshold would likely be looking to play elsewhere even if the starter graduates in the next year anyway.

QB is the only position with this rank-2 extension, deliberately. QB is structurally different from every other spot on the roster: there's one football and one starter, so a backup gets essentially zero meaningful snaps no matter his own class. That's not true anywhere else -- a #2 WR, corner, or safety still plays real snaps in normal personnel packages; even O-line and individual linebacker spots see rotation a backup QB never gets.

**What happens once someone qualifies:** the tool looks across the whole league for a team where that player would legitimately rank in the top 2 at their position -- not just "any open roster spot," an actual, better opportunity. It also respects a prestige-gap rule: a player can move down in prestige, or sideways, but not jump to a dramatically more prestigious program than what their current situation justifies -- with a rare "big fish, small pond" exception at low odds for a case that clearly deserves it anyway.

**Chains cascade, and re-check whenever a team's own situation changes:** if the player who moves displaces someone else at the new team, that displaced player is evaluated the same way -- did they just become a fresh candidate? If so, they can move too, and so on. This can also happen within one team: if a team's #2 QB leaves and finds a home, the tool checks that same team's new #2 immediately. A hard cap (8 hops per chain, 10 re-checks per team) exists purely as a safety net -- real chains essentially never get close to it.

A recipient cap keeps this from concentrating too hard: the same "spread it around, don't dump everything on one team" principle from Tier 1/2 applies here -- a team can only absorb so many waterfall arrivals at one position per run.

Waterfall is off by default. Turn it on in Settings if you want it.

## Locked threshold table

|Position|Min|Max|
|-|-|-|
|QB|2|3|
|HB|4|6|
|FB|1|2|
|WR|7|8|
|TE|3|5|
|OT (LT+RT)|5|6|
|Guards (LG+RG)|5|6|
|C|1|2|
|DE (LE+RE)|5|6|
|DT|3|4|
|Sam (LOLB)|3|3|
|MLB|3|4|
|Will (ROLB)|3|3|
|CB|5|6|
|FS|2|3|
|SS|2|3|
|K|1|2|
|P|1|2|

These numbers came from checking real save files, not guesses. **FB is the one position that can't fully be fixed** -- real football just doesn't have enough true fullbacks for the game's own demand, and moving players around can't create more of something that doesn't exist. Every other position was checked to make sure there's actually enough supply league-wide to fix every team.

## Scheme awareness

A team's real offense/defense shifts some max numbers automatically:

* **Air Raid / Run and Shoot / Veer and Shoot / Spread** (pass-heavy): more WRs allowed, fewer TEs, and FB can go all the way to 0.
* **Power Spread / Spread Option / Pistol / Option** (run-heavy): more HBs allowed, fewer WRs.
* **Base 3-4 / 3-4 Multiple / 3-3-5 / 3-3-5 Tite / 3-2-6** (3-down fronts): fewer DTs, more Sam/MLB/Will.
* **3-3-5 / 3-3-5 Tite / 3-2-6** specifically: more CB/FS/SS.
* **Base 4-3 / 4-2-5 / 4-3 Multiple** and **Pro Style / West Coast Zone Run / Multiple Offense**: no change -- this is the normal baseline everything else is measured against.

## Safety design

* **Your original save is never changed.** Every Apply run creates a backup automatically before touching anything.
* **Saves are written safely** (write to a temp file, then rename it) so a crash or interruption mid-save can't corrupt anything, including if your save is in a cloud-synced folder like OneDrive.
* **Your own team is found using a specific save field (`Team.UserCharacter`)**, not the coach's own team field, because that one can get stuck pointing at an old team after you switch jobs. Tested on real saves, including after actually switching coaching jobs, and it correctly handles multiple human-controlled teams in the same online dynasty too.
* **Every move updates the actual roster/depth chart data**, not just "who's on what team" -- a tool that only changes the second thing will look right in a spreadsheet but wrong in the game.

## Known limitations

* **FB can't be fully fixed** -- see the table note above.
* **Your own team's numbers can occasionally be wrong** because of something in the game's own data, unrelated to this tool (confirmed once on a real save: some of a user's real players were tagged as belonging to a completely different team internally). Because of this, your team is left out of the Season History totals, and a warning shows up if you scan your own team on the Current Snapshot tab.
* **Needs a specific version of the `madden-franchise` library** (loaded a slightly unusual way) because the version needed for CFB 27's current patch wasn't available the normal way at the time this was built.

## Changelog

**v2.0.0**

* Transfer Waterfall mechanic: buried players (3rd-string-or-lower) can transfer to find real playing time, with cascading chains and a prestige-gap rule. Off by default; enable in Settings.
* QB rank-2 extension: a #2 QB can now qualify if the starter ahead of him is same-class-or-younger, or if his own OVR clears an adjustable threshold (default 90) regardless of who's ahead of him.
* Fixed a bug where a displaced player could re-enter the chain and land straight back on the team they just left.
* Preview (dry run) now runs the full pipeline, including the post-transfer rebalance pass -- what you see in Preview now fully matches what Apply will actually do.
* Rebalancing now covers Tackles, Guards+Centers, Ends, Linebackers, and Safeties. Tackles balance by QB handedness (protecting the blindside). Guards and Centers are pooled together: #1 overall goes blindside guard, #2 center, #3 other guard, and repeat. Linebackers are pooled: #1 Mike, #2 Sam, #3 Will, and repeat. Ends and Safeties alternate evenly.
* The tool now follows a sandwich model: pre-tool rebalance → transfers → post-tool rebalance (only if moves were made).

## 

