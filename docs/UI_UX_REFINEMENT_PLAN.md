# AquaTrace — UI/UX Refinement Plan (5/10 → 10/10)

> **Status:** proposal for review · **Owner:** Sohaib (frontend) · **Scope:** frontend only, no backend changes
> **Baseline:** `main` @ `912e601` · **Branch for this work:** `sohaib-frontend`
> This is the last refinement round, so every item has a concrete implementation, an asset source,
> and an acceptance check. Nothing here is "make it nicer".

---

## 0. TL;DR — the one refinement

The panel's 5/10 is not about bugs; the app works. It reads as a **competent engineering dashboard**:
dark panels, thin lines, forms, lists. A 10/10 needs **one unforgettable visual idea** plus a stage built
around it.

**The idea: _make uncertainty visible, then watch it collapse._**

Today the ranking is a list of numbers and three pins. In the refined UI, Detect paints a glowing
**search cloud** over the network: probability-like heat (still labeled *relative score*) diffused along the
real pipes. Every crew report visibly **shrinks the cloud** until it snaps onto the leak. That one
animation tells the whole product story without a word: *a city's worth of pipes → a neighbourhood → one
junction.*

Everything else in this plan serves that moment:

| # | Workstream | Why it moves the score |
|---|---|---|
| W1 | **Map engine 2.0** (deck.gl): terrain, real pipe widths, living water flow | The canvas stops looking like a diagram and starts looking like a city |
| W2 | **Search cloud**: the collapsing-uncertainty hero animation | The memorable "wow" the panel will retell |
| W3 | **Present mode**: cinematic, captioned, full-screen walkthrough | Judges follow the story, not the UI |
| W4 | **Evidence fingerprint**: why the model chose this node | Explainability, which panels reward |
| W5 | **Hierarchy & layout**: mission stepper replaces the form bar | Clarity in 3 seconds |
| W6 | **Motion system**: one choreography language | Polish that feels designed, not decorated |
| W7 | **Impact layer**: litres and rupees ticking while you search | Urgency and stakes |
| W8 | **Projector mode**: high-contrast light theme | Survives a washed-out hall projector |
| W9 | **Assets**: generated terrain, custom pictograms, one verified photo | Specific, licensed, offline |
| W10 | **Intro → console continuity**: camera dives from 3D into the 2D map | Seamless first 20 seconds |

---

## 1. Honest diagnosis: why it scores 5/10

Taken from our own screenshots at 1280×720 (`main` @ `912e601`):

| Problem | Evidence | Fix |
|---|---|---|
| **Map reads as a wiring diagram** | 1 px grey-green lines, 9 px dots, no ground, no scale; at overview the network fills ~40% of the canvas and floats in empty space | W1 terrain + diameter-scaled pipes + flow |
| **No hero moment** | Detect = colored dots + 3 pills; crew feedback = a node turns grey. Nothing visibly *changes shape* | W2 search cloud |
| **Top bar is a form** | 4 selects + 3 buttons + badge across 1280 px reads like a settings page, and the story steps compete with knobs | W5 mission stepper; knobs move to a Scenario popover |
| **Text-heavy side panel** | Agent trace is 12+ lines of 0.88 rem italic; tags at 0.62 rem are unreadable from 5 m | W5 type scale floor; W3 captions carry the story |
| **Low contrast on projector** | Ink-on-ink panels (#0C1F23 on #071316) and silt text (#8FA6A0) wash out | W8 Projector mode + contrast floor |
| **Badges everywhere** | MOCK, SIMULATED, RELATIVE SCORE tags on every row add visual noise | W5 provenance consolidated into one legend line per card plus hover |
| **Motion is per-component** | Each widget animates differently (springs here, fades there) | W6 one motion spec |
| **Stakes are abstract** | "≈9.0 L/s · simulated estimate" never becomes "you are losing X litres right now" | W7 live impact ticker |
| **Intro and console feel like two apps** | 3D page → hard cut → flat 2D | W10 camera continuity |

**Not the problem:** correctness, honesty rules, or features. Keep all of them; this round is presentation.

---

## 2. Design principles for this round

1. **One hero per screen.** Each step has exactly one thing that moves; everything else holds still.
2. **Show, then label.** Visual first (cloud, flow, route), numbers second, provenance third (on hover).
3. **Readable at 5 m.** Minimum 15 px for anything a judge must read, 13 px absolute floor, 4.5:1 contrast.
4. **Honest stays honest.** Scores remain *relative score*; illustrative layers (flow direction, terrain)
   are labeled *illustrative*; truth stays tracer-violet and reveal-only.
5. **Offline or it doesn't ship.** Every asset is bundled; verified with external requests blocked.
6. **Degrade, never break.** Software GL, reduced motion, and no-WebGL all get a designed fallback.

---

## 3. Workstreams in detail

### W1 · Map engine 2.0 (deck.gl)

**Swap the Cytoscape canvas for deck.gl `OrthographicView`.** No basemap tiles, so it stays offline.
Keep Cytoscape behind a flag as the fallback (`VITE_MAP_ENGINE=cytoscape`).

**Packages (verified current):** `@deck.gl/core@9.4.0`, `@deck.gl/layers@9.4.0`,
`@deck.gl/geo-layers@9.4.0` (for `TripsLayer`), `@deck.gl/react@9.4.0`.

| Layer | deck.gl class | Data source | Visual spec |
|---|---|---|---|
| Terrain | `BitmapLayer` | `public/terrain/net3-hillshade.png`, generated at build time from Net3 node elevations (W9) | Hillshade multiplied over ink-950, 18% opacity, plus 1 px contour lines every 5 m |
| Pipes | `PathLayer` | `/network` pipes; width from Net3 diameter (bundled static file, cosmetic only) | `widthUnits: "pixels"`, 1.5–6 px by diameter; verdigris at 70%; round caps |
| Water flow | `TripsLayer` | Paths ordered **downhill from reservoirs/tanks by graph distance** | 1 particle per ~300 m; `trailLength` 180; currentTime driven by rAF; labeled *illustrative flow* |
| Junctions | `ScatterplotLayer` | `/network` nodes | 3 px idle; grow on hover with `transitions` |
| Sensors | `IconLayer` | Custom logger pictogram (W9) | 22 px phosphor, pulsing halo when its reading drives the top match |
| Search cloud | W2 | — | — |
| Crew route | `TripsLayer` | `route` + graph shortest paths | Bright verdigris comet travelling depot → node in 1.6 s, then marching dashes |
| Labels | `TextLayer` | Top 3, sensors, truth | JetBrains Mono, 15 px, ink outline |
| Truth | `ScatterplotLayer` + HTML crosshair | `/reveal` | Unchanged tracer violet; ring "drops in" from 3× scale |

**Camera:** `OrthographicView` with `controller: { inertia: true }`; framing uses `fitBounds`-style math
we already have (2-hop context, zoom cap 2.2).

**Acceptance**
- 60 fps on a mid laptop GPU; ≥ 30 fps in headless software GL (measured with `performance.now()` deltas).
- Flow particles are visibly downhill from River/Lake/tanks; legend says *illustrative flow*.
- Flag `VITE_MAP_ENGINE=cytoscape` restores today's map with zero other changes.

**Contract note (optional, additive v1.2):** add `diameter_m?` to pipes in `/network`. Until then the
frontend uses the bundled Net3 diameters, which are cosmetic and the same network.

---

### W2 · The search cloud (hero)

**What it is:** a soft, glowing field over the network showing where the leak probably is, which
**contracts with every crew report**.

**Data (no new endpoints):**
1. `/detect` → `candidates[].score` (top 10, relative scores).
2. Diffuse each score 2 hops along real pipes: `field[n] = Σ score[c] · exp(-d(c,n)/σ)`, σ = 350 m,
   graph distance via our `Graph.dijkstra`. Computed in a Web Worker-free loop (92 nodes, < 2 ms).
3. Render as a `ScatterplotLayer` with `radiusUnits: "pixels"`, radius 40–110 px by field value,
   additive blending (`parameters: { blend: true, blendFunc: [SRC_ALPHA, ONE] }`), color = existing score
   ramp at 22% alpha. The overlapping discs read as one continuous cloud.
4. Cloud **area** in m² shows in a chip: "Search area: 2.4 km² → 0.3 km²".

**Animation:**
- Detect: cloud blooms from each sensor that saw a drop toward the candidates (900 ms, `easeOutExpo`).
- "Nothing found": that region **burns out** (alpha → 0 over 500 ms, embers fade), and the remaining cloud
  re-normalizes and **tightens** with deck.gl attribute transitions (`transitions: { getRadius: 800 }`).
- "Leak found": the cloud collapses to the node in 600 ms, then one vermilion shockwave ring.
- Search-area chip counts down with a number ticker (W6).

**Honesty:** caption "Relative score diffused along pipes. A visual aid, not a probability map."

**Acceptance**
- In Demo A the audience sees the cloud shrink twice: Detect → miss → find.
- Area chip numbers come only from the field computation and are labeled *illustrative*.

---

### W3 · Present mode (cinematic walkthrough)

**Entry:** `F` key or "Present" button. Side panel slides out (400 ms), map goes full-bleed, browser
Fullscreen API on request.

**Layout**
```
┌──────────────────────────────────────────────────────────────┐
│ ① Simulate  ② Detect  ③ Investigate  ④ Confirm  ⑤ Reveal    │  chapter rail (current one glows)
│                                                              │
│                       [ full map + cloud ]                   │
│                                                              │
│  ┌───────────────────────────────────────┐   ┌────────────┐  │
│  │ DETECT                                │   │ 1.73 M L   │  │  lower-third caption + one big number
│  │ Six sensors felt the drop.            │   │ lost/day   │  │
│  │ The search narrows to 3 junctions.    │   └────────────┘  │
│  └───────────────────────────────────────┘                   │
└──────────────────────────────────────────────────────────────┘
```

- **Captions** are templates filled only from API values (same rule as the report): e.g.
  `"{live_sensors} sensors felt the drop. The search narrows to {n} junctions."`
- **Camera choreography** per chapter (W6 table): wide → push in on cloud → follow crew comet →
  hold on truth.
- `→` / Space = next chapter, `←` = previous, `Esc` = exit. Works with the existing Next logic.
- Speaker notes (`N`) appear on a second window via `window.open` + `BroadcastChannel` (optional).

**Acceptance:** Demo A runs start to finish with only the → key; every caption number matches the panel.

---

### W4 · Evidence fingerprint (explainability)

**The question judges ask:** "Why that node?" Answer it visually.

- Source: `simulate_hypothesis` tool result → `per_sensor[{sensor, observed, predicted}]`.
- **Fingerprint chart** (agent tab + Present mode): one row per sensor, two bars (observed vs
  predicted) as a diverging bar around 0 m. When they match, the bars **interlock** like a key; the
  fit label (good / fair / poor) appears as a stamp.
- **On the map:** each sensor gets a mini gauge (arc) showing its pressure drop; the two sensors that
  matter most pulse.
- Colors: observed = verdigris (#2A9C86), predicted = clay (#C2785F), the pair already validated
  for CVD; predicted is hatched as secondary encoding.

**Acceptance:** the dataviz validator passes on dark *and* projector surfaces; table view exists.

---

### W5 · Hierarchy & layout

**Top bar → Mission stepper.**
```
[◆ AquaTrace]   ① Simulate ─── ② Detect ─── ③ Investigate ─── ④ Confirm ─── ⑤ Reveal    [Scenario ▾] [⌨] [MOCK]
```
- Each step is a pill with state: done (verdigris check), current (glow plus a primary button), locked (dim).
- Seed / size / noise / sensors move into a **Scenario popover** (`[Scenario ▾]`), with Demo A/B as large
  cards that carry their one-line story.

**Side panel**
- Header: one **status sentence** in 1.4 rem ("Investigating · crew at node 123 · 1 of 3 visits").
- Candidate list: top 3 as cards; ranks 4–10 collapse into a "+7 more" row.
- Agent trace: **collapsed by default to a 4-step summary** (Rank → Hypothesis → Route → Recommend) with an
  "expand full trace" toggle; Present mode shows captions instead.

**Type scale** (17 px root): display 2.4/1.6/1.25 rem; body 1 rem; meta 0.88 rem; **floor 0.8 rem**
(today we go down to 0.62 rem; all of those get raised or removed).

**Provenance:** one legend line per card ("values: simulated · scores: relative") plus a hover popover
per number. This removes ~60% of the badge noise while keeping every label reachable.

**Acceptance:** at 1280×720 a first-time viewer can say what step we're on and what to click next
within 3 s (hallway test with 3 people).

---

### W6 · Motion system

One spec, used everywhere (`src/ui/motion.ts`):

| Token | Value | Use |
|---|---|---|
| `dur.micro` | 120 ms | Hovers, presses |
| `dur.ui` | 240 ms | Panels, tabs, cards |
| `dur.scene` | 800 ms | Camera moves, cloud transitions |
| `dur.hero` | 1600 ms | Crew comet, reveal |
| `ease.out` | `cubic-bezier(.16,1,.3,1)` (expo-out) | Entrances |
| `ease.inOut` | `cubic-bezier(.65,0,.35,1)` | Camera |
| `spring.ui` | stiffness 320, damping 30 | Layout shifts |

**Choreography per step:** (1) camera move → (2) hero visual → (3) numbers tick → (4) panel updates.
Never all at once; 120 ms stagger between phases.

- **Tab and panel changes:** View Transitions API (`document.startViewTransition`) with a cross-fade +
  6 px slide; falls back to motion's `AnimatePresence`.
- **Number tickers:** every headline number counts up (`useSpring` on value, tabular numerals).
- **Reduced motion:** all of the above become 120 ms opacity fades; the cloud jumps between states.
- **Sound (off by default, `M` to toggle):** 3 synthesized Web Audio cues: soft sonar ping on Detect, low
  thud on "nothing found", bright chime on found. No audio files to license.

**Acceptance:** no animation longer than 1.6 s blocks input; everything works with reduced motion.

---

### W7 · Impact layer

- **"While you search" ticker** (Present mode + panel header):
  `est_leak_lps × seconds since Detect`, shown as litres lost, with Rs value from the Repairs assumption.
  Label: *simulated estimate · assumed Rs/L*.
- **Result card** on Leak found (also exported as PNG via `html-to-image` for slides):
  inspections used vs naive baseline expectation, route km, litres saved per day if fixed today.
- **Evaluation tab hero:** one sentence + one number ("2.6× better than a naive search"), chart below.

**Acceptance:** every impact number is traceable to a tool/API value or a labeled assumption.

---

### W8 · Projector mode (light theme "Indus Silt")

Already designed earlier, now built as a toggle (`T` key, persisted in `localStorage`):

| Token | Dark (current) | Projector |
|---|---|---|
| bg | #071316 | #F3EEE3 (silt paper) |
| text | #E8E2D0 | #1B2340 (indigo ink) |
| pipe | #3FBFA6 | #2F6F68 |
| score ramp | #3B5B57 → #F2B33D → #FF5A36 | #9DB2AD → #E9A23B → #C4452B |
| truth | #B48CFF | #5B3FD6 |
| sensor | #D4F26A | #2F7D4F |

- Implemented as CSS variables swapped on `:root[data-theme="projector"]`; deck.gl layers read the same tokens.
- Contrast floor checked with APCA (Lc ≥ 60 body, ≥ 75 small text) via a dev-only script.

**Acceptance:** screenshot with a simulated washed-out projector (CSS `filter: contrast(.7) brightness(1.15)`)
stays readable.

---

### W9 · Assets: exact sources, no vague pictures

**Principle:** generate what we can (perfect fit, no license risk, works offline). Use photography only
where real-world context matters (the intro's problem beat), with verified licenses.

| Asset | Source | License | Path | How |
|---|---|---|---|---|
| Terrain hillshade (2048×2048 PNG) | **Generated** from Net3 node elevations (`net3.json`) | Ours | `public/terrain/net3-hillshade.png` | `scripts/build-terrain.mjs`: IDW-interpolate elevations on a grid → hillshade (azimuth 315°, altitude 45°) → PNG via `pngjs` |
| Contour lines (SVG) | **Generated** from the same grid (marching squares) | Ours | `public/terrain/net3-contours.svg` | Same script, 5 m interval |
| Sensor logger, crew van, valve, reservoir, tank pictograms | **Drawn by us** as 24×24 SVGs on Lucide's grid (2 px stroke) | Ours (Lucide itself is ISC) | `src/ui/icons/*.svg` | Hand-authored; one family |
| Intro "problem" photo | Unsplash: *"a large pipe is coming out of the water"*, Jacob Vathikulam, India, 2022: https://unsplash.com/photos/a-large-pipe-is-coming-out-of-the-water-YzZuCdBQ4Jg | Unsplash License (verified) | `public/img/intro-pipe.avif` | Download once, crop 16:9, AVIF ~120 kB, duotone in ink/verdigris via CSS `mix-blend-mode` |
| Karachi water-tanker photo (optional) | Wikimedia Commons `File:Water_tanker_karachi.jpg` | **Verify before use** (page wouldn't load during research) | `public/img/karachi-tanker.avif` | Only if the license and attribution are confirmed |
| Water/caustic texture | **Generated** SVG `feTurbulence` (already used) | Ours | inline | — |
| Display font (optional upgrade) | `@fontsource-variable/fraunces@5.3.0` for the intro headline only | OFL | npm | Adds editorial character; console keeps Bricolage |
| Sound cues | **Synthesized** with the Web Audio API | Ours | `src/ui/sound.ts` | No files |
| OG / slide image | **Rendered by us** from the 3D intro (`canvas.toDataURL`) | Ours | `public/og.png` | 1200×630 |

Attribution line for the photo goes in the intro footer and the README.

---

### W10 · Intro → console continuity

- Clicking **Enter** flies the 3D camera from its orbit to a straight **top-down** view of the same network
  (1.2 s, `ease.inOut`), crossfades to the deck.gl 2D map at the **same framing** (300 ms), and the panel
  slides in. Same nodes, same place: no hard cut.
- Intro gets a 3-beat scroll-less sequence (auto-advance, click to skip):
  1. **Problem:** the photo (W9) with a user-supplied, sourced statistic about water loss.
     *We need you to provide the figure and its source; we will not invent one.*
  2. **Approach:** the network rises out of the terrain; sensors light up one by one.
  3. **Promise:** "Find the leak, not the guess." → Enter.

**Acceptance:** the transition holds 60 fps on a GPU; with reduced motion it is a 200 ms crossfade.

---

## 4. Iterative refinement process

Four rounds. Each ends with screenshots, a scorecard and a commit on `sohaib-frontend`.

| Round | Contents | Exit gate |
|---|---|---|
| **R1 Foundation** | W5 layout + type floor, W6 motion tokens, W8 theme tokens | Hallway test passes; no text below 0.8 rem |
| **R2 Hero** | W1 deck.gl map + W2 search cloud | Demo A cloud shrinks twice; ≥ 30 fps in software GL |
| **R3 Story** | W3 Present mode, W4 fingerprint, W7 impact | Demo A runs with only →; captions match panel numbers |
| **R4 Polish** | W9 assets, W10 continuity, sound, projector QA | Full checklist (section 6) green |

**Review protocol each round**
1. Screenshots at 1280×720, 1920×1080 and simulated projector (washed-out filter) for each demo step.
2. Self-score against the rubric (section 5), with the weakest category fixed first.
3. Offline run with external requests blocked; reduced-motion run; backend-down run.
4. Commit, push, and post the scorecard in the commit body.

---

## 5. Scorecard (how we'll know it's 10/10)

| Category (weight) | Today | Target | Evidence we'll show |
|---|---|---|---|
| First impression (15%) | 6 | 10 | Intro → console continuity, terrain map |
| Clarity of story (20%) | 5 | 10 | Mission stepper, Present mode captions, hallway test |
| Hero moment (15%) | 3 | 10 | Search cloud collapsing in Demo A |
| Explainability (15%) | 5 | 9 | Fingerprint chart, sensor gauges |
| Visual polish & consistency (15%) | 6 | 10 | Motion spec, one icon family, type scale |
| Projector readability (10%) | 4 | 9 | Projector mode, APCA check |
| Robustness (10%) | 8 | 10 | Offline, reduced motion, no WebGL, backend down |

*"Today" are our own estimates from screenshots, not the panel's breakdown.*

---

## 6. Final QA checklist

- [ ] Demo A and Demo B end to end in Present mode with only the keyboard
- [ ] Search cloud shrinks on every "nothing found" and snaps on "found"
- [ ] All text ≥ 0.8 rem; APCA passes in both themes
- [ ] 60 fps GPU / ≥ 30 fps software GL on the map; intro → console transition smooth
- [ ] Zero external requests (blocked-network run)
- [ ] `prefers-reduced-motion` run: nothing longer than 200 ms, nothing broken
- [ ] No-WebGL run: Cytoscape fallback map + flat intro
- [ ] Backend-down run: readable error + Retry
- [ ] Every number traceable to an API value or a labeled assumption; truth only after Reveal
- [ ] `npm test`, `npm run build`, `oxlint` clean; README updated (Present mode, theme toggle, assets credits)

---

## 7. Scope guard and risks

**Not in this round:** new backend endpoints (the `diameter_m` field is optional), real geographic basemaps,
multi-leak UI, mobile layout beyond "doesn't break".

| Risk | Likelihood | Mitigation |
|---|---|---|
| deck.gl migration takes longer than planned | Medium | Ship W2 first on top of Cytoscape (HTML/canvas cloud overlay), then swap engines; flag keeps Cytoscape |
| Software GL on the judges' laptop is slow | Medium | Auto-detect fps < 30 → disable flow particles and terrain, keep the cloud |
| Present mode captions drift from data | Low | Captions are templates over API values; one test asserts numbers match |
| Photo license unclear | Low | Unsplash image verified; Wikimedia image only after verification |
| Too much motion distracts | Medium | One hero per step (principle 1); reduced-motion parity |

---

## 8. Decisions needed from you before I start

1. **Approve W1 (deck.gl migration)?** Recommended. The alternative is to do W2 on Cytoscape only: faster, but
   the map stays diagram-like.
2. **Present mode as the default demo path?** Recommended yes.
3. **Projector mode:** toggle only, or default when the screen is ≥ 1920 px wide? Recommended: toggle (`T`).
4. **Sound cues:** keep (off by default) or drop?
5. **Intro statistic:** please send one sourced figure on water loss (e.g. non-revenue water in a Pakistani
   city) with its source. Otherwise the problem beat uses no number.
6. **Font upgrade:** Fraunces for the intro headline: yes or no?

---

## Appendix A · Files this plan touches

```
frontend/
  scripts/build-terrain.mjs          (new)  hillshade + contours from Net3 elevations
  public/terrain/*, public/img/*     (new)  generated + verified assets
  src/features/map/                  (new)  deck.gl engine: layers/, camera.ts, cloud.ts, flow.ts
  src/features/network/              (kept) Cytoscape fallback behind VITE_MAP_ENGINE
  src/features/present/              (new)  PresentMode, ChapterRail, Captions, captions.ts
  src/features/evidence/             (new)  Fingerprint chart, sensor gauges
  src/features/impact/               (new)  ticker, result card, PNG export
  src/features/controls/             (rework) MissionStepper, ScenarioPopover
  src/ui/motion.ts, sound.ts, icons/ (new)  motion tokens, audio cues, pictograms
  src/index.css                      (rework) theme tokens incl. projector theme, type floor
```

## Appendix B · References

- deck.gl examples gallery: https://deck.gl/examples
- deck.gl TripsLayer (gallery): https://deckgl.readthedocs.io/en/latest/gallery/trips_layer.html
- deck.gl views docs mirror (OrthographicView): https://tessl.io/registry/tessl/npm-deck-gl/files/docs/views.md
- OrthographicView + line layer notebook: https://observablehq.com/@cornhundred/deck-gl-line-layer-orthographic-view
- Unsplash photo (verified): https://unsplash.com/photos/a-large-pipe-is-coming-out-of-the-water-YzZuCdBQ4Jg
- Wikimedia tanker photo (to verify): https://commons.wikimedia.org/wiki/File:Water_tanker_karachi.jpg
