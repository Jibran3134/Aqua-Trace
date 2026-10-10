"""Signature-fit inference using observations only, with calibrated abstention."""

from __future__ import annotations

import hashlib
import json
import math
from collections import OrderedDict
from dataclasses import dataclass
from threading import RLock

import numpy as np
from scipy.stats import chi2

from app.core.config import DEMAND_MULT_RANGE, Settings
from app.core.errors import DomainError
from app.detection.scenarios import ScenarioGenerator
from app.domain.models import ScenarioObservation
from app.hydraulics.service import HydraulicService
from app.hydraulics.signatures import SignatureLibrary, center
from app.infra.redis_service import RedisService
from app.schemas.api import Candidate, DetectionResponse, Evidence

NOISE_CALIBRATION_SEEDS = tuple(range(20000, 20030))
_TINY = np.finfo(float).tiny


@dataclass(frozen=True)
class DetectionResult:
    """Public DTO plus full internal scores/fit coefficients for read-only tools."""

    response: DetectionResponse
    weights: dict[str, float]
    alphas: dict[str, float]
    errors: dict[str, float]


class Detector:
    """Rank physical signatures without reading seed, truth or full pressures."""

    def __init__(
        self, settings: Settings, hydraulics: HydraulicService, signatures: SignatureLibrary,
        generator: ScenarioGenerator, redis: RedisService | None = None,
    ) -> None:
        self.settings = settings
        self.hydraulics = hydraulics
        self.signatures = signatures
        self.generator = generator
        self.redis = redis
        self._floor_lock = RLock()
        self._floors: OrderedDict[str, float] = OrderedDict()
        self._floor_generator = ScenarioGenerator(
            settings.model_copy(update={"sensor_dropout_rate": 0.0}), hydraulics, signatures,
        )
        self._calibration_digest = hashlib.sha256(
            json.dumps(NOISE_CALIBRATION_SEEDS).encode()
        ).hexdigest()
        self._direction_identity: tuple | None = None
        self._direction: np.ndarray | None = None

    @property
    def fingerprint(self) -> str:
        """Follow the current signature identity even across background publication."""
        return hashlib.sha256(json.dumps({
            "format": 2, "signatures": self.signatures.fingerprint,
            "tau": self.settings.detector_tau, "center": self.settings.center_residuals,
            "demand_projection": self.settings.demand_projection,
            "demand_projection_anchors": DEMAND_MULT_RANGE, "gaussian_noise_guard": True,
            "detector_top_k": self.settings.detector_top_k,
            "demand_multiplier_range": DEMAND_MULT_RANGE, "noise_calibration_policy": 2,
            "noise_percentile": self.settings.noise_floor_percentile,
            "noise_calibration": self._calibration_digest,
        }, sort_keys=True).encode()).hexdigest()

    @property
    def _demand_direction(self) -> np.ndarray:
        """Approximate unknown demand's spatial pattern using no-leak physics only."""
        self.signatures.ensure_ready()
        identity = (self.signatures.fingerprint, tuple(self.signatures.node_order), DEMAND_MULT_RANGE)
        with self._floor_lock:
            if identity != self._direction_identity:
                low = self.hydraulics.run(demand_mult=DEMAND_MULT_RANGE[0]).pressures
                high = self.hydraulics.run(demand_mult=DEMAND_MULT_RANGE[1]).pressures
                self._direction = np.array([
                    high[node] - low[node] for node in self.signatures.node_order
                ])
                self._direction.setflags(write=False)
                self._direction_identity = identity
            return self._direction

    def _transform(self, residual: np.ndarray, indexes: list[int]) -> np.ndarray:
        if self.settings.demand_projection:
            direction = self._demand_direction[indexes]
            denominator = float(direction @ direction)
            if denominator < 1e-12:
                return residual
            if residual.ndim == 1:
                return residual - direction * float(direction @ residual) / denominator
            return residual - direction[:, None] * (direction @ residual)[None, :] / denominator
        return center(residual) if self.settings.center_residuals else residual

    def _noise_floor(self, live: list[str], noise: str, sigma: float) -> float:
        direction_hash = (
            hashlib.sha256(self._demand_direction.astype("<f8").tobytes()).hexdigest()
            if self.settings.demand_projection else "none"
        )
        payload = (self.fingerprint, live, sigma, self._calibration_digest, direction_hash)
        key = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        with self._floor_lock:
            if key in self._floors:
                self._floors.move_to_end(key)
                return self._floors[key]
            redis_key = self.redis.cache_key("noise-floor", *payload) if self.redis else None
            cached = self.redis.get_json(redis_key) if self.redis else None
            if (isinstance(cached, dict) and isinstance(cached.get("noise_floor"), (int, float))
                    and not isinstance(cached["noise_floor"], bool)
                    and math.isfinite(cached["noise_floor"]) and cached["noise_floor"] >= 0):
                floor = float(cached["noise_floor"])
            else:
                indexes = [self.signatures.node_order.index(node) for node in live]
                baseline = self.signatures.baseline[indexes].astype(float)
                norms = []
                for seed in NOISE_CALIBRATION_SEEDS:
                    calibration = self._floor_generator.make_no_leak(seed, noise, sensors=live)
                    readings = self._floor_generator.observe(
                        calibration.pressures_all, live, sigma, seed,
                    )
                    residual = np.array([readings[node] for node in live]) - baseline
                    norms.append(float(np.linalg.norm(self._transform(residual, indexes))))
                percentile = self.settings.noise_floor_percentile
                removed_dimension = (
                    bool(float(self._demand_direction[indexes] @ self._demand_direction[indexes])
                         >= 1e-12) if self.settings.demand_projection
                    else self.settings.center_residuals
                )
                dimensions = len(live) - int(removed_dimension)
                gaussian_floor = (sigma * math.sqrt(float(chi2.ppf(percentile / 100, dimensions)))
                                  if dimensions > 0 else 0.0)
                floor = round(max(float(np.percentile(norms, percentile)), gaussian_floor), 8)
                if self.redis:
                    self.redis.set_json(redis_key, {"noise_floor": floor})
            self._floors[key] = floor
            while len(self._floors) > 256:
                self._floors.popitem(last=False)
            return floor

    def fit_inputs(
        self, observation: ScenarioObservation,
    ) -> tuple[list[str], np.ndarray, np.ndarray]:
        """Return canonical live IDs, transformed residuals and transformed signatures.

        Investigation hypotheses must use this helper so fit labels and predicted
        residuals refer to the same nuisance-projected space as detection.
        """
        self.signatures.ensure_ready()
        sensors = self.generator.validate_sensors(observation.sensors, len(observation.sensors))
        self.generator._validate_noise(observation.noise)
        sigma = observation.noise_sigma
        if not math.isfinite(sigma) or sigma < 0:
            raise DomainError("invalid_noise", "Noise sigma must be finite and nonnegative.",
                              "Generate a fresh scenario with a configured noise level.", 422)
        live = []
        for node in sensors:
            value = observation.readings.get(node)
            if value is not None:
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise DomainError("invalid_readings", "Sensor readings must be finite or null.",
                                      "Generate a fresh scenario or mark offline sensors null.", 422)
                live.append(node)
        live.sort()  # Canonical sensor coordinates make reordering byte-deterministic.
        if not live:
            return [], np.empty(0), np.empty((0, len(self.signatures.candidate_order)))
        indexes = [self.signatures.node_order.index(node) for node in live]
        residual = np.array([observation.readings[node] for node in live], dtype=float)
        residual -= self.signatures.baseline[indexes].astype(float)
        signatures = self.signatures.matrix[indexes, :].astype(float)
        return live, self._transform(residual, indexes), self._transform(signatures, indexes)

    def analyze(
        self, observation: ScenarioObservation, weights: dict[str, float] | None = None,
    ) -> DetectionResult:
        """Fit every candidate and preserve a supplied current inspection ranking."""
        live, residual, signatures = self.fit_inputs(observation)
        if not live:
            return DetectionResult(
                DetectionResponse(
                    status="insufficient_evidence", candidates=[],
                    evidence=Evidence(residual_norm=0, noise_floor=0, margin_top1_vs_top2=0,
                                      live_sensors=0),
                    note="No live sensors; restore a sensor and collect new readings.",
                ), {}, {}, {},
            )
        denominator = np.sum(signatures * signatures, axis=0) + 1e-12
        alphas = np.maximum(0, (signatures.T @ residual) / denominator)
        errors = np.sum((residual[:, None] - signatures * alphas[None, :]) ** 2, axis=0)
        candidates = self.signatures.candidate_order
        if weights:
            if set(weights) != set(candidates) or any(
                isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or value < 0 for value in weights.values()
            ):
                raise DomainError("invalid_weights", "Candidate ranking contains invalid weights.",
                                  "Run detection again to initialize the full candidate ranking.", 422)
            scores = np.array([weights[node] for node in candidates], dtype=float)
            if not np.any(scores > 0):
                raise DomainError("invalid_weights", "Candidate ranking has no positive weights.",
                                  "Reset the investigation and run detection again.", 422)
            scores = np.maximum(scores, _TINY)
            scores /= scores.max()  # Prevent overflow when supplied weights are very large.
            scores /= scores.sum()
        else:
            logits = -(errors - errors.min()) / self.settings.detector_tau
            scores = np.exp(np.maximum(logits, math.log(_TINY)))
            scores /= scores.sum()
        # Sort quantized fit weights stably, avoiding insignificant BLAS differences.
        order = sorted(range(len(candidates)), key=lambda col: (-round(float(scores[col]), 12),
                                                              candidates[col]))
        margin = min(float(scores[order[0]] / max(scores[order[1]], _TINY)), 1e12)
        norm = round(float(np.linalg.norm(residual)), 8)
        floor = self._noise_floor(live, observation.noise, observation.noise_sigma)
        insufficient = len(live) < 2 or norm < floor
        note = None
        if len(live) < 2:
            note = "Fewer than two live sensors; add or restore a pressure sensor."
        elif insufficient:
            note = "Residual is below the calibrated noise floor; collect more evidence."
        ranked = []
        group = 0
        previous_score = None
        for col in order[:self.settings.detector_top_k]:
            score = float(scores[col])
            if previous_score is None or abs(previous_score - score) > max(previous_score, _TINY) * 0.01:
                group += 1
            ranked.append(Candidate(
                node=candidates[col], score=round(score, 12),
                adjacent_pipes=self.hydraulics.adjacent_pipes(candidates[col]),
                est_leak_lps=round(float(alphas[col] * self.signatures.reference_flows[col]), 8),
                tie_group=group,
            ))
            previous_score = score
        return DetectionResult(
            response=DetectionResponse(
                status="insufficient_evidence" if insufficient else "ok", candidates=ranked,
                evidence=Evidence(residual_norm=norm, noise_floor=floor,
                                  margin_top1_vs_top2=round(margin, 8), live_sensors=len(live)),
                note=note,
            ),
            weights={node: float(scores[col]) for col, node in enumerate(candidates)},
            alphas={node: round(float(alphas[col]), 12) for col, node in enumerate(candidates)},
            errors={node: round(float(errors[col]), 12) for col, node in enumerate(candidates)},
        )
