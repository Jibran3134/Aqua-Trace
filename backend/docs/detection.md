# Generation, detector inputs and validation choices

`ScenarioGenerator.make` returns an internal observation and separate private
truth record. A seeded RNG chooses only usable signature candidates, a nominal
small/medium/large cohort if none is requested, a **uniform assumed demand
multiplier from 0.9 to 1.1**, and **uniform assumed area jitter from 0.85 to 1.15**.
The true size is a nominal synthetic cohort, not the exact physical hole area.
Effective area, actual flow, retries, seed and noiseless full pressures remain
private; the public scenario endpoint returns sensors and noisy readings only.

Readings use assumed zero-mean Gaussian sensor noise: low=0.05, mid=0.2,
high=0.5 metres standard deviation. Deterministic dropout uses the configured
rate; offline readings are null. Draws follow a canonical order for all
junctions, so the same seed gives identical noise at common sensors even when
the selected list is reordered or reduced. Explicit sensors may include the
known nonpositive-head junction10; default sensors exclude it.

`Detector.analyze` reads selected readings, sensor IDs and noise assumptions.
It never reads observation.seed, private truth or pressures_all. Regression
tests replace those private fields and assert the output is unchanged. Only
offline generation/evaluation may use complete pressure snapshots.

## Residual transform and scores

The raw residual is observed pressure minus the fixed no-leak baseline. A
plain common-mode mean subtraction was insufficient because demand mismatch
changes pressures spatially. The frozen default uses a **simulated nuisance
demand direction** derived from no-leak runs at demand multipliers 0.9 and 1.1:
`d = P(1.1) - P(0.9)`. Both residuals and signature rows are projected as
`v' = v - d * (d.T @ v)/(d.T @ d)`. The detector does not know the actual scenario
demand; this direction comes from assumed-model simulations. The approximation
is first order and may not cancel nonlinear demand effects.

Frozen settings: `DEMAND_PROJECTION=true`, `CENTER_RESIDUALS=false`,
`SENSOR_DISTANCE_METRIC=hops`, `DETECTOR_TAU=0.05`,
`NOISE_FLOOR_PERCENTILE=95`. Projection takes precedence over centering if both
are enabled. Set projection off to compare raw or mean-centered residuals.
Default six sensors are `101,253,15,203,219,166`, selected by deterministic
farthest structural graph hops. Pipe-length weights remain active for routes.

Each candidate fits a nonnegative amplitude:
`alpha = max(0, s.T @ r / (s.T @ s + 1e-12))`.
Its error is the squared norm of `r - alpha*s`; relative scores use
`softmax(-error/tau)`. Tau controls sharpness and agent margin, never ranking.
Flow estimates multiply alpha by the candidate's simulated reference flow.
They are approximations under single-reference linear scaling, not recovered
actual flows. Strong nonlinear PDD/leak interactions can reduce localization.

All 91 candidate weights remain available internally and positive, even when
only a bounded top ranking is returned. Supplied current inspection weights
are normalized and used directly; the initial fit is not multiplied in again.
Candidate ordering uses quantized scores and deterministic node-ID tie breaks.
Adjacent scores within 1% share a tie group. JSON scores/fit outputs are rounded
to suppress irrelevant floating-point variation. Public numbers are explicitly
labeled simulated or assumed; scores are relative fit weights.

`Detector.fit_inputs(observation)` returns `(live_sensor_ids, residual, S)` in
the same projected/centered space. Investigation hypothesis tools must use it
with the candidate alpha. Label their per-sensor values **simulated projected
residuals**, rather than presenting them as raw pressure measurements.

## Noise floor and graceful abstention

For each live geometry and sigma, thirty demand-perturbed no-leak runs use the
fixed calibration range **20000–20029**. Their transformed residual norms give
the empirical 95th percentile. A conservative lower bound is also applied:
`sigma * sqrt(chi2.ppf(.95, degrees_of_freedom))`, where degrees of freedom is
live sensor count minus the dimension removed by projection/centering. The floor
is the maximum of the empirical and Gaussian values. This avoids treating a
small thirty-sample underestimate as sufficient evidence. It relies on the
assumed independent Gaussian noise model, not utility telemetry.

Floor identity includes canonical live IDs, sigma, transform/fingerprint,
network/library versions, calibration partition and the computed demand-vector
hash. A bounded in-process memo and lock avoid duplicate calculations in one
worker. Redis optionally stores only the public aggregate floor; cache failure
degrades to recomputation. No current scenario seed, truth or full pressures
enter Redis. Calibration always assumes the observed live sensors remain live,
so configured dropout cannot corrupt a fixed-geometry threshold.

Residual below the floor or fewer than two live sensors returns
`insufficient_evidence`. Complete dropout returns an empty candidate list and a
readable next action. This is honest absence of evidence, not proof of no leak.

## Measured development gates and limitations

Parameter/sensor comparisons used the complete **validation seeds 0–49**.
The final test partition **1000–1099** was not used to select these choices.
The table records simulated top-three hits before the conservative noise guard;
the guard changes abstention, not ordering. Diagnostic source:
`data/detector_diagnostics.json` and `python -m scripts.diagnose_detection`.

| Six/ten sensor choice | Raw hits /50 | Mean-centered hits /50 | Demand-projected hits /50 |
|---|---:|---:|---:|
| Pipe-length farthest, six | 16 | 18 | 20 |
| Pipe-length farthest, ten | 23 | 23 | 32 |
| Graph-hop farthest, six | 25 | 22 | **33** |
| Screened pipe-length farthest, six | 19 | 22 | 29 |

The initial mean-centered six-sensor approach produced **4/10** top-three hits
on seeds0–9. The frozen graph-hop/demand-projection choice produced **7/10**;
it was selected for the best complete fifty-case result, rather than that
ten-case subset. The empirical-only projected threshold initially abstained
on only **25/30** heldout no-leak cases, motivating the analytical Gaussian guard.
These failed initial gates are retained rather than hidden.

The final module and updated sensor graph passed **19 tests in measured
34.83 seconds**, including both accuracy/abstention gates, private-field
independence, deterministic JSON, reorder/subset noise, dropout, complete
posterior preservation and floor geometry/sigma identity. Reproduce with
`python -m pytest tests/test_detection.py -q`; aggregate frozen validation is
`python -m app.detection.validate`, which writes `data/detection_validation.json`.
These development outcomes are synthetic benchmark results, not field accuracy.

[SciPy chi-square inverse CDF](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.chi2.html)
defines the analytical Gaussian norm quantile used by the floor guard.
