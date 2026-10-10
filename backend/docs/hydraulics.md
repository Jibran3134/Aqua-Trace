# Hydraulic model, calibration and signatures

The simulation uses Python 3.13 and WNTR 1.5.0 with the tag-pinned Net3 input.
It solves one snapshot at **t=0**, using WNTRSimulator and pressure-dependent
demand. Required pressure is an **assumed 20 m**, minimum pressure an **assumed
0 m**, exponent 0.5, and leak discharge coefficient an **assumed 0.75**. Pressure
is metres of gauge head; leak flow is converted from m3/s to L/s. Input GPM and
feet become SI through WNTR. Schematic coordinates are not surveyed GPS points.

The unmodified benchmark has 92 junctions, 2 reservoirs, 3 tanks, 117 pipes and
2 pumps. Its baseline junction `10` has a **simulated -0.45007331 m** at t=0,
with the Lake pump initially closed. This original operating state is retained.
Only this baseline-inherited negative-head exception is tolerated; pressure
values are never silently clipped. A leak at a nonpositive-head junction is
unusable and skipped, and any newly negative junction causes a retry/failure.
Junction `10` consequently appears in the signature skip list. Zero-demand
junctions with positive pressure remain valid candidates.

Every run deep-copies an untouched template. A bounded semaphore limits
concurrent native calculations. The solver uses `convergence_error=True` so
partial failed results cannot become observations. An invalid leak run retries
once with half its requested area; private truth stores the effective area,
flow and retry count. After failure, callers receive a 503 `simulation_failed`
message without the hidden junction or raw exception text. Returned physical
numbers are rounded to eight decimal places to remove roughly 1e-14 m native
solver variation, far below the smallest assumed sensor noise (0.05 m).

## Physical calibration

Run `python -m app.hydraulics.calibrate` from `backend` to regenerate
`data/calibration.json`. Seed **2026** selects five positive-head junctions,
outside validation/test seed partitions. The artifact contains all ten nearest
junction pressure drops, shortest pipe-graph distances, local drops, flows,
effective areas, retries, input hash and measured baseline timing. Calibration
changes physical magnitudes using simulated pressure visibility, never the
detector's test rankings.

The original small/medium/large areas 0.0002/0.0005/0.001 m2 gave small local
drops of only 0.011–0.122 m in these samples. Revised **assumed benchmark areas**
are 0.006/0.012/0.02 m2. Their names are relative synthetic magnitudes; they are
not utility definitions of small/medium/large holes. These correspond to large
leak flows. Smaller real leaks may be undetectable with sparse noisy sensors.
Even larger leaks near fixed-head boundaries can remain difficult to localize.

| Junction | Size | Area m2 (assumed) | Local drop m (simulated) | Flow L/s (simulated) |
|---|---|---:|---:|---:|
| 209 | small | 0.006 | 4.526 | 123.730 |
| 209 | medium | 0.012 | 11.453 | 224.116 |
| 209 | large | 0.020 | 20.231 | 317.444 |
| 169 | small | 0.006 | 1.006 | 134.260 |
| 169 | medium | 0.012 | 2.470 | 264.154 |
| 169 | large | 0.020 | 4.508 | 429.915 |
| 129 | small | 0.006 | 0.304 | 113.688 |
| 129 | medium | 0.012 | 0.591 | 226.369 |
| 129 | large | 0.020 | 1.380 | 372.640 |
| 255 | small | 0.006 | 3.317 | 110.807 |
| 255 | medium | 0.012 | 8.492 | 202.207 |
| 255 | large | 0.020 | 15.298 | 289.020 |
| 105 | small | 0.006 | 4.950 | 111.188 |
| 105 | medium | 0.012 | 11.704 | 196.768 |
| 105 | large | 0.020 | 19.179 | 273.043 |

All 15 revised calibration runs converged with zero retries. Minimum sampled
small local drop was **simulated 0.303805 m**. Baseline duration was **measured
0.226485 s** on the development machine; this is not a guarantee on every device.

## Signature cache and sensor geometry

`SignatureLibrary` subtracts the baseline from each medium-size leak result and
stores a **97 x 91** float32 matrix, baseline, reference flows and metadata in
`cache/signatures.npz`. Arrays publish only when complete and are read-only.
Metadata records skipped candidates and effective reference areas. A thread
lock plus interprocess file lock coordinates one build. Writing uses an fsynced
temporary file and atomic replacement; NumPy loads with `allow_pickle=False`.
Missing/corrupt/stale cache raises `signatures_not_ready`, and `build()` recovers
by regenerating it. Health progress is available while the builder runs.

Fingerprint inputs include the canonical network SHA-256, WNTR/NumPy/SciPy versions, snapshot,
PDD/leak assumptions, numerical precision and cache format. Restart/rebuild
after changing network or hydraulic constants; configuration updates do not
silently mutate already-created service instances.
The `sha256-lf-v1` network hash policy normalizes CRLF to LF before hashing, so
the same input has identical identity in Windows and Linux Git checkouts.
Network parsing and physical inputs are unchanged. A regression test verifies
that LF and CRLF copies share both network hash and signature fingerprint.

Default sensors use deterministic farthest-point sampling by structural graph hops,
starting from the lexicographically first eligible junction (`101`). Default
selection excludes baseline nonpositive-head junctions. Explicit sensors may
include junction `10`; this valid input has little useful leak information.
The graph preserves physical connectivity, including closed links; pumps and
valves have zero connector length. Parallel connections use the shortest link
for weighted distance. Routes and distances are **simulated network paths**, not
driving directions or evidence that crews can walk along a pipe. Sensor sampling
switched from pipe-length distance to graph hops after complete validation-seed
comparison documented in `detection.md`; route lengths still use metres.

## Validation and source references

Run `python -m pytest tests/test_hydraulics.py -q`. The final calibrated module
passed **15 tests in measured 29.14 s**, including real baseline/local leak,
repeatability, untouched template, concurrent runs, private error messages,
retry effective area, known nonpositive-head rejection, full signatures,
cache recovery, thread coordination and network hash invalidation. Baseline
acceptance enforces less than two seconds and cache loading less than one second.
`data/signature_validation.json` records the final cache build/load timings.
The latest portable cache build took **measured 12.391325 s** and reload took
**measured 0.007631 s** on the development machine, with 91 usable candidates and
one skip. Two portability/hash-invalidation regressions passed in **measured
1.98 s** after introducing the canonical LF hash policy.

SciPy reports an `OptimizeWarning` when WNTR fits a three-point pump curve;
tested results still converge and remain finite. This warning is not evidence
of solver failure. The model supports a single synthetic junction leak at one
snapshot; it does not validate real utility performance or multiple leaks.

- [WNTR installation](https://usepa.github.io/WNTR/installation.html)
- [Junction leak API](https://usepa.github.io/WNTR/apidoc/wntr.network.elements.Junction.html)
- [WNTR simulator API](https://usepa.github.io/WNTR/apidoc/wntr.sim.core.WNTRSimulator.html)
- [Units](https://usepa.github.io/WNTR/units.html)
- [Pinned Net3 source](https://raw.githubusercontent.com/USEPA/WNTR/1.5.0/examples/networks/Net3.inp)

Network SHA-256:
`54987a3d342706ecebf2d951d36f125b4263ea8bb291e5d4201cb901999ecc9e`
under the canonical `sha256-lf-v1` policy.
