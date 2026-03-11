# Scoring Model Calibration Roadmap

Sequenced implementation plan based on the full scoring audit.
Changes are ordered by impact and dependency — earlier phases unlock later ones.

---

## Phase 1: Recalibrate the Sigmoid Core

**Why first:** Every score in the entire app flows through `getSigmoidScore()`.
Fixing the curve fixes the grade distribution globally before touching any
component-level logic. Everything downstream inherits the correction.

### 1A — Lower the baseline from 72 → 63

The single highest-impact change. A baseline of 63 puts "average" solidly in the
C+ range (where coaches expect it) instead of B-minus territory.

Target grade map after this change:

| z-units | Old Score | New Score | Grade |
|---------|-----------|-----------|-------|
| +3      | ~96       | ~95       | A+    |
| +2      | ~90       | ~88       | A     |
| +1      | ~82       | ~78       | B+    |
|  0      | 72        | 63        | C+    |
| −1      | ~49       | ~43       | D+    |
| −2      | ~33       | ~28       | F+    |
| −3      | ~14       | ~12       | F     |

Constants to change in `getSigmoidScore()`:
- Baseline: 72 → 63
- Ceiling headroom: 26 → 35 (so the upside range is 63 → 98 instead of 72 → 98)

### 1B — Reduce the downside asymmetry

Change the downside decay coefficient from 0.55 → 0.65.

Current problem: one z-unit below average drops 23 points (72 → 49). That's a
cliff — there's no C-minus range, you fall straight from C+ to D+.

With baseline 63 and coefficient 0.65:
- z = −1 → 63 × e^(−0.65) ≈ 33 ... still too steep.

Better approach: use a mirrored structure. Instead of exponential decay on the
downside, use the same saturating shape reflected:
- Upside: `63 + 35 × (1 − e^(−z × k_up))`
- Downside: `63 − 58 × (1 − e^(z × k_down))`  (floor at 5)

This gives a smooth S-curve centered at 63 with more room in the C/D range.
Tune k_up (~0.55) and k_down (~0.45) so that:
- z = +1 → ~78 (B+)
- z = +2 → ~89 (A)
- z = +3 → ~95 (A+)
- z = −1 → ~45 (D+)
- z = −2 → ~28 (D−/F)
- z = −3 → ~12 (F)

This produces ~33 points of upside spread and ~51 points of downside spread,
which is still asymmetric (bad games hurt more than good games help) but not
cliff-level.

### 1C — Update ring color thresholds

Current thresholds (line 1842):
- ≥85 green, ≥70 orange, <70 red

With the new baseline, these need to shift:
- ≥80 green (B+ and above — genuinely good)
- ≥63 orange (C+ to B — acceptable)
- <63 red (below average)

---

## Phase 2: Fix Goalie Scoring Components

**Why second:** With the sigmoid recalibrated, the goalie input signal needs
retuning so that realistic GSAx values land in the right z-unit ranges.

### 2A — Increase big save bonus from 0.3 → 0.6 per save

Current state: 4 big saves contribute 1.2 to goalieInput (0.4 z-units → ~5 point
impact). That's invisible.

At 0.6 per save: 4 big saves contribute 2.4 (0.8 z-units → ~12 point impact).
Now a goalie with 4 big saves vs 0 big saves shows a meaningful grade-level
difference. A goalie who stands on their head and makes several exceptional stops
should see that reflected.

### 2B — Increase rebound control multiplier from 0.15 → 0.25

Current state: even an excellent rebound game (score ~8-10) contributes ~1.2-1.5
to goalieInput. At 0.25, that becomes ~2.0-2.5 (nearly a full z-unit). Still
secondary to GSAx, but now it creates a meaningful B versus B+ distinction.

The rebound sub-weights (smothers 1.5, good rebounds 1.0, bad rebounds −2.0)
are fine as-is. The issue is only the final multiplier dampening the signal
to near-zero.

### 2C — Implement progressive soft goal weighting

Replace the flat 2.0× soft goal weight with a progressive scale:

- 1st soft goal in the game: 1.5× weight
- 2nd soft goal: 2.0×
- 3rd+ soft goal: 2.5×

Rationale: one soft goal happens — even good goalies have a bad moment. Two soft
goals is a pattern. Three is a systemic problem. The current flat 2.0× punishes
the first soft goal too harshly (turns a potential A game into a B-) while not
punishing the third one enough relative to the second.

Implementation: count soft goals as you iterate through `defenseEvents`. Track a
running soft goal counter and assign wGoal based on the counter value.

### 2D — Discount PP goals against for goalie scoring

When a goal against has `ev.strength === 'PP'` (opponent power play), treat it as
partially "hard" regardless of other context:
- If already classified as hard (screen, deflection, etc.): keep at 0.5×
- If classified as soft: override to 1.5× (still penalized, but less than 2.0×)
- If normal (neither hard nor soft): set to 0.7×

The goalie is facing a 5-on-4 disadvantage that is not their fault. Full blame
for PP goals is unfair. Note: the SH discount already exists for goals the team
allows while short-handed in the *team* score — this is the parallel adjustment
for the *goalie* score.

### 2E — Add volume-based confidence dampening

For goalie games with low shot volume, blend the calculated score toward baseline:

```
confidence = min(1.0, (shots − 5) / 15)
finalScore = baseline + confidence × (rawScore − baseline)
```

This means:
- 5 shots: confidence = 0.0 → score = baseline (63)
- 10 shots: confidence = 0.33 → score is 1/3 of the way from baseline to raw
- 15 shots: confidence = 0.67 → score is 2/3 of the way
- 20+ shots: confidence = 1.0 → full raw score

Eliminates the hard cutoff at 5 shots. A goalie who faces 8 shots and allows 0
gets a score slightly above baseline instead of a misleadingly high 82. A goalie
who faces 8 shots and allows 3 gets a score slightly below baseline instead of a
devastatingly low 30.

Remove the current hard `if (shots < 5) return 50` check and replace it with this
graduated system. The minimum threshold can drop to 1 or 2 shots (below which
return baseline directly).

### 2F — Adjust goalie spread parameter

After changes 2A-2E, the goalie input values will be slightly larger (higher big
save bonus, higher rebound contribution). The spread may need to widen from 3.0
to 3.5 to prevent score inflation from the increased component contributions.

This should be tuned empirically: run the 12 simulation scenarios from the audit
through the new formula and verify the outputs land in the correct grade bands.
Adjust spread until they do.

---

## Phase 3: Fix Team Scoring Weights and Components

**Why third:** The sigmoid is fixed (Phase 1) and the goalie model is fixed
(Phase 2). Now adjust the team-side component weights and inputs.

### 3A — Rebalance component weights

Current → Proposed:

| Component      | Current | Proposed | Rationale |
|---------------|---------|----------|-----------|
| Possession     | 20%     | 20%      | Fine as-is |
| Danger Control | 20%     | 20%      | Fine as-is |
| Shot Quality   | 15%     | 20%      | Reward chance quality, reduce result dependency |
| Result         | 35%     | 25%      | Still significant but no longer dominant |
| Discipline     | 10%     | 15%      | Penalties matter more in junior hockey |

The key change: result drops from 35% → 25%. Combined with the xG quality bump
(15% → 20%), this shifts the model from "outcome-heavy" to "process-heavy."

A team that dominates every process metric but loses a close game will now score
in the B range (correct) instead of C+ (too harsh). A team that gets outplayed
but wins on luck will score C/C- (correct) instead of the current C+/B-.

### 3B — Weight danger control events by severity

Replace the flat sum with weighted events:

**Offensive danger (for):**
- Breakaways for: 1.5×
- Odd man rush for: 1.3×
- Forced turnovers: 0.8×

**Defensive danger (against):**
- Breakaways against: 1.5×
- Odd man rush against: 1.3×
- DZ turnovers: 1.0×

A breakaway is a far more dangerous event than a forced turnover at center ice.
The current model treats them as equal, which inflates danger scores for teams
that generate lots of turnovers but few high-quality chances.

### 3C — Change shot quality from xG differential to xG efficiency ratio

Current: `scoreShotQuality = sigmoid(xGDiff, 0, 0.8)` — this is volume-dependent
and correlates heavily with possession (more shots → higher xGF → better xGDiff).

Proposed: Use xG per shot ratio instead:
```
xGPerShotFor = xGF / SF
xGPerShotAg  = xGA / SA
qualityRatio  = xGPerShotFor − xGPerShotAg
scoreShotQuality = sigmoid(qualityRatio, 0, 0.04)
```

This measures whether the team is generating *higher quality* chances than the
opponent, independent of volume. A team that takes 12 shots but 8 are HD scores
better on quality than a team that takes 30 shots with 2 HD. Volume is already
captured by the possession component — shot quality should measure quality per
opportunity, not total volume.

The spread of 0.04 needs tuning: normal xG/shot ≈ 0.07-0.09, HD-heavy ≈ 0.12+.
The differential between teams is typically ±0.03-0.06, so spread=0.04 puts one
SD at about ±0.04 xG/shot difference.

### 3D — Adjust result component spread

With result weight dropping from 35% → 25%, the spread parameter for goal
differential can tighten slightly from 2.5 → 2.0. This gives the result
component better internal discrimination (a 3-goal win scores noticeably higher
than a 1-goal win) while its reduced weight prevents it from dominating.

### 3E — Add PP goal discount for team goals-for

Currently `teamWeightedGF = GF` (all goals count equally). Power play goals
should be slightly discounted since they reflect opponent penalty-taking as much
as team quality:
- PP goals for: 0.85× (still credit, but acknowledged as advantage situation)
- EV goals for: 1.0×
- SH goals for: 1.5× (scoring while short-handed is exceptional)

This parallels the existing SH discount on goals against (0.6×).

---

## Phase 4: Validate and Tune

**Why last:** All structural changes are in place. Now verify the system produces
sensible outputs across realistic scenarios.

### 4A — Build a simulation test harness

Create a standalone function (or temporary test page) that feeds known input
combinations through `computeGoalieScore()` and `computeTeamScore()` and outputs
the results in a table. This is not a permanent feature — it's a calibration
tool.

Include at minimum the 12 scenarios from the audit plus:
- Shutout on 30+ shots (should be A+)
- Shutout on 8 shots (should be C+/B− at most)
- 5 goals on 15 shots (should be F)
- 1 soft goal, otherwise perfect on 25 shots (should be B+)
- 3 soft goals on 20 shots (should be D/F)
- Team blowout win 6-0 with full dominance (should be A+)
- Team close loss 2-3 with dominant process (should be B−/C+)
- Team lucky win 3-2 with terrible process (should be C−/D+)
- Team close win 2-1, even process (should be C+/B−)
- Team shutout loss 0-1, good process (should be C)

### 4B — Tune spread parameters

Run all scenarios. For each, verify the output lands in the target grade band.
If not, adjust the relevant spread parameter:

- **Goalie spread** (currently 3.0): controls overall goalie score sensitivity
- **Possession spread** (currently 0.15): controls shot share sensitivity
- **Danger spread** (currently 3.0): controls danger differential sensitivity
- **Shot quality spread** (new ~0.04): controls xG efficiency sensitivity
- **Result spread** (proposed 2.0): controls goal differential sensitivity
- **Discipline spread** (currently 2.0): controls penalty differential sensitivity

Tuning rule: if a component routinely produces scores that are too extreme
(always >90 or always <40), widen the spread. If it produces scores that are too
flat (always 60-75), tighten the spread.

### 4C — Verify edge cases

Specifically test:
- Goalie at exactly 5 shots (confidence dampening boundary)
- Goalie at 20 shots (full confidence boundary)
- Team with 0 penalties on both sides (discipline = baseline)
- Team with 0 danger events on both sides (danger = baseline)
- Games where all goals are PP goals
- Games where all goals are SH goals
- Games with 0 goals for both teams (0-0 tie / shootout)

### 4D — Adjust color thresholds

After all tuning, set the ring color breakpoints to match the actual output
distribution:
- Green: scores that land in B+ or above (likely ≥78-80)
- Orange: scores that land in C to B (likely 55-79)
- Red: scores that land in D or below (likely <55)

The exact numbers depend on final tuning, but the principle is: green = good game,
orange = acceptable, red = problem.

---

## Summary of All Constants Changed

| Constant | Current | Proposed | Location |
|----------|---------|----------|----------|
| Sigmoid baseline | 72 | 63 | `getSigmoidScore()` |
| Sigmoid upside headroom | 26 | 35 | `getSigmoidScore()` |
| Sigmoid downside coeff | 0.55 | ~0.45 (via new formula) | `getSigmoidScore()` |
| Sigmoid upside coeff | 0.8 | ~0.55 (via new formula) | `getSigmoidScore()` |
| Big save bonus | 0.3 | 0.6 | `computeGoalieScore()` |
| Rebound multiplier | 0.15 | 0.25 | `computeGoalieScore()` |
| Soft goal weight | flat 2.0 | progressive 1.5/2.0/2.5 | `computeGoalieScore()` |
| PP goal-against goalie weight | 1.0 (default) | 0.7 (new rule) | `computeGoalieScore()` |
| Goalie volume confidence | hard cutoff <5 | graduated ramp 5-20 | `computeGoalieScore()` |
| Goalie spread | 3.0 | 3.0-3.5 (tune) | `computeGoalieScore()` |
| Team result weight | 0.35 | 0.25 | `computeTeamScore()` |
| Team shot quality weight | 0.15 | 0.20 | `computeTeamScore()` |
| Team discipline weight | 0.10 | 0.15 | `computeTeamScore()` |
| Danger event weights | all 1.0 | 0.8-1.5 by type | `computeTeamScore()` |
| Shot quality metric | xGDiff | xG/shot ratio | `computeTeamScore()` |
| Shot quality spread | 0.8 | ~0.04 (new metric) | `computeTeamScore()` |
| Result spread | 2.5 | 2.0 | `computeTeamScore()` |
| PP goals for weight | 1.0 | 0.85 | `computeTeamScore()` |
| SH goals for weight | 1.0 | 1.5 (new) | `computeTeamScore()` |
| Ring color green threshold | ≥85 | ≥80 | summary ring |
| Ring color orange threshold | ≥70 | ≥63 | summary ring |

---

## Implementation Order

Phase 1 (sigmoid) should be done as a single commit — all three changes together.
Changing the baseline without adjusting the curve shape or thresholds would
temporarily make things worse.

Phase 2 (goalie) changes can be committed individually (2A through 2F) since each
is independent, but 2F (spread tuning) should come last as it depends on all
prior changes.

Phase 3 (team) changes can mostly be committed individually, but 3A (weights) and
3D (result spread) should go together since the spread adjustment compensates for
the weight reduction.

Phase 4 (validation) should run after each phase to catch problems early, but the
full systematic validation is the final step.
