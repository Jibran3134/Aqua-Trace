# AquaTrace Presentation Guide

## 1. The one-sentence pitch

**AquaTrace helps a water utility decide where to send its next inspection crew when a hidden leak is suspected, using a few noisy pressure sensors, hydraulic simulation, and an explainable investigation workflow.**

The system is a decision-support prototype. It does not claim to replace a utility's SCADA system, field crew, or engineering judgment.

## 2. The problem we selected

Water leaks are expensive even when they are not visible. Treated water has already consumed energy and treatment chemicals, yet a leak can remain underground for a long time. A utility usually has:

- a large pipe network;
- only a small number of pressure sensors;
- noisy or incomplete readings; and
- limited crews and time.

The difficult question is not simply “is there a leak?” It is **which location should the crew inspect first?** A wrong first visit wastes travel time. A weak detection system can also create false confidence and send a crew to an unhelpful location.

## 3. How we came up with the solution

We broke the problem into a sequence that a real operator can understand:

1. Build a hydraulic model of the pipe network.
2. Hide a leak in a controlled scenario and generate sensor readings.
3. Compare the readings with the expected no-leak network behavior.
4. Rank likely junctions instead of pretending to know the answer with certainty.
5. Give an investigator a short, explainable inspection plan.
6. Update the ranking when a crew reports “found” or “nothing found.”
7. Turn confirmed leaks into a repair backlog and choose repairs within a budget.

This turns raw measurements into an operational decision while keeping every important assumption visible.

## 4. What we built

### Hydraulic simulation

The backend uses the `Net3.inp` EPANET network model through WNTR. It creates deterministic scenarios with a seed, leak size, demand variation, sensor noise, and optional missing readings. This gives us a repeatable benchmark while we do not yet have utility SCADA data.

### Leak detection

The detector creates hydraulic response signatures for candidate junctions, projects out common demand changes, fits non-negative candidate contributions, and reports a **relative score**. A noise-floor guard can abstain when the evidence is too weak. The score is deliberately not labelled as a probability.

### Investigation agent

The agent has four bounded tools: rank candidates, simulate a hypothesis, plan an inspection, and recommend a sensor addition. The response is assembled from validated tool outputs. Gemini and Groq can be configured later; a deterministic scripted fallback keeps the demo working without credentials.

### Field feedback and repair planning

Crew results are stored with a revision number. A stale update is rejected, while a repeated request is safe to retry. Confirmed leaks become repair items. The repair endpoint computes an exact sparse budget plan and compares it with a greedy baseline.

### Frontend contract

The React frontend talks to the FastAPI endpoints through an adapter. It shows the network, sensor readings, ranked candidates, investigation trace, field feedback, evaluation, and repair plan. It labels simulated, estimated, measured, and assumed values separately.

## 5. Suggested slide-by-slide story

### Slide 1 — Title and outcome

“AquaTrace: from noisy pressure readings to the next best leak inspection.” Show the network map and one ranked candidate.

### Slide 2 — Why the problem matters

Explain that underground leaks waste treated water and crew time. Emphasize the sparse-sensor problem: a utility cannot measure every pipe continuously.

### Slide 3 — Our idea

Show the chain: **network model → noisy observations → ranked search area → crew feedback → repair priority**.

### Slide 4 — Live demo

Use a fixed seed so the story is repeatable:

1. Wait for the API readiness indicator.
2. Load the network.
3. Simulate a leak with a fixed seed.
4. Run detection and point out that the score is relative.
5. Open the investigation plan.
6. Submit a simulated “nothing found” result.
7. Run the next investigation and show the re-ranking.
8. Use Reveal only at the end to explain the benchmark answer.
9. Open Repairs and show the budget assumptions.

Say clearly that the network and leak are simulated for this hackathon demo.

### Slide 5 — Why the result is trustworthy

Mention four controls:

- physics-based WNTR/EPANET simulation rather than invented map values;
- deterministic seeds and portable fingerprints for repeatability;
- abstention when evidence is near the noise floor;
- strict API schemas, hidden truth storage, and bounded AI tools.

### Slide 6 — Validation

Present the measured prototype checks:

- backend focused suite: **66 tests passed**;
- frontend suite: **33 tests passed**;
- live Docker verification: readiness, database, Redis, network, scenario, detection, and reveal all passed;
- simulation diagnostics: 33/50 validation scenarios had the true leak in the top three, 7/10 acceptance scenarios passed, and 29/30 no-leak holdout scenarios avoided a false call.

These are simulation results, not field-utility accuracy claims.

### Slide 7 — Technical choices

Use a simple table in the presentation:

| Need | Choice | Reason |
|---|---|---|
| API | FastAPI | Typed, fast Python service with automatic OpenAPI docs |
| Hydraulic model | WNTR + EPANET file | Reproducible water-network physics |
| Durable state | PostgreSQL | Transactions and an easy path to Supabase |
| Cache and limits | Redis | Fast shared cache and atomic token bucket |
| AI safety | fixed tools and Pydantic validation | Prevent free-form model output from controlling the system |
| Delivery | Docker Compose | Same local setup for every teammate |

### Slide 8 — Honest boundaries and next step

The current demo uses a benchmark network, synthetic readings, one leak at a time, steady-state snapshots, and assumed repair values. The next production step is to import a utility's EPANET/GIS model and calibrated sensor data, then validate against historical incidents. Authentication and full production authorization are intentionally excluded from this hackathon scope.

## 6. Main challenges and our decisions

### Demand changes looked like leaks

Changing demand can move every pressure at once. We added a demand projection and fit candidate effects after removing the common demand component.

### Small signals disappeared in the noise

The detector estimates a noise floor from the configured sensor noise and abstains when the best explanation is not sufficiently separated. This is safer than always returning a confident-looking location.

### The baseline network contains difficult values

The inherited Net3 model has a known negative-pressure baseline node. We preserved that benchmark behavior and avoid using it as an active leak candidate instead of silently rewriting the model.

### AI can be manipulated or invent facts

The model receives a small sanitized context, never the private truth, and can only request allowlisted tools. Tool arguments and outputs are schema-validated. If providers fail, the deterministic scripted investigator still produces a safe response.

### Two people can update the same field report

PostgreSQL row locking plus compare-and-swap revision checks prevent an old browser or agent turn from overwriting newer evidence.

### Frontend and backend contracts changed during integration

The frontend adapter normalizes field names and optional values at one boundary. This allowed the backend and frontend to evolve without scattering compatibility code through the UI.

## 7. Short demo script

“We start with a water-network model and a few pressure sensors. AquaTrace creates a repeatable hidden-leak scenario and adds realistic demand variation and noise. The detector compares the observations with hydraulic signatures and returns a ranked search area. The investigator turns that ranking into a crew route. When the crew reports that nothing was found, the backend records the evidence and re-ranks the remaining candidates. Confirmed leaks become repair work, and the optimizer chooses a budget-feasible plan. The final Reveal action is only for evaluating the simulated benchmark; it is never used by the detector or the AI.”

## 8. Likely questions and clear answers

**Is this connected to a real utility?**  Not yet. The current benchmark uses `Net3.inp`; the same API accepts a future calibrated utility network and sensor feed.

**Is the score a probability?**  No. It is a relative fit score. The UI labels it that way to avoid overstating certainty.

**Why use an LLM at all?**  The LLM explains and sequences bounded investigation tools. It does not perform the hydraulic calculation or decide truth.

**Can the LLM see the hidden answer?**  No. Truth is kept in a private database boundary and is exposed only through the demo Reveal route.

**What happens when the evidence is weak?**  The detector can abstain and recommend another sensor or inspection step.

**How would a real network enter the system?**  A utility can export an EPANET `.inp` model, or convert GIS assets into that format, then provide calibrated sensor metadata and readings.

**Is it production-ready?**  It is a strong, tested hackathon prototype. Production use still needs authentication, utility calibration, historical validation, monitoring, and deployment hardening.

## 9. Words to avoid during the pitch

Avoid saying “guaranteed,” “exact probability,” “fully autonomous,” or “field-proven.” Say “ranked,” “relative score,” “decision support,” and “validated on simulated scenarios.”
