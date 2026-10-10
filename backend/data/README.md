# Net3 benchmark network

`Net3.inp` is vendored from USEPA/WNTR tag 1.5.0:
https://raw.githubusercontent.com/USEPA/WNTR/1.5.0/examples/networks/Net3.inp

Source project: https://github.com/USEPA/WNTR (Revised BSD license).
This is a benchmark stand-in, not a Pakistani utility's surveyed network.
Coordinates are schematic; input units are converted to SI by WNTR.
Signatures include this file's canonical SHA-256 so physical edits invalidate
cached calculations. Policy `sha256-lf-v1` normalizes CRLF to LF before hashing,
giving the same identity in Windows and Linux Git checkouts.

Net3 contains 92 junctions, 2 reservoirs, 3 tanks, 117 pipes and 2 pumps.
The original t=0 state has negative pressure at junction10; it is documented
in `../docs/hydraulics.md` and retained rather than changing pump controls.

`calibration.json` contains simulated physical calibration and measured timing.
`signature_validation.json` records measured final signature build/load timing.
Reproduce calibration with `python -m app.hydraulics.calibrate` from backend.
Upstream copyright and BSD terms are retained in `WNTR-LICENSE.md`.

`detector_diagnostics.json` records every validation-only sensor/transform
comparison, including the original failed development approach.
`detection_validation.json` records aggregate frozen acceptance results without
individual scenario truth. Reproduce with `python -m app.detection.validate`.
