"""Seeded hydraulic ground truth generation, kept separate from detection."""

from __future__ import annotations

import math
from functools import lru_cache

import numpy as np

from app.core.config import DEMAND_MULT_RANGE, LEAK_AREAS_M2, NOISE_SIGMA_M, Settings
from app.core.errors import DomainError
from app.domain.models import ScenarioObservation, ScenarioTruth
from app.hydraulics.service import HydraulicService
from app.hydraulics.signatures import SignatureLibrary

AREA_JITTER_RANGE = (0.85, 1.15)


class ScenarioGenerator:
    """Generate physical scenarios; public projection is the API layer's job."""

    def __init__(
        self, settings: Settings, hydraulics: HydraulicService, signatures: SignatureLibrary,
    ) -> None:
        self.settings = settings
        self.hydraulics = hydraulics
        self.signatures = signatures

    def validate_sensors(self, sensors: list[str] | None, k: int) -> list[str]:
        """Resolve a bounded, unique list of junctions; explicit sensors take precedence."""
        if sensors is None:
            if isinstance(k, bool) or not isinstance(k, int) or not 1 <= k <= 12:
                raise DomainError("invalid_sensor_count", "Choose between one and twelve sensors.",
                                  "Use k from 1 to 12.", 422)
            return self.hydraulics.default_sensors(k)
        if not 1 <= len(sensors) <= 12 or len(set(sensors)) != len(sensors):
            raise DomainError("invalid_sensors", "Sensors must contain one to twelve unique junctions.",
                              "Choose distinct junction IDs from GET /network.", 422)
        for node in sensors:
            self.hydraulics.validate_junction(node)
        return list(sensors)

    @staticmethod
    def _validate_seed(seed: int) -> None:
        if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed < 2 ** 32:
            raise DomainError("invalid_seed", "Seed must be an unsigned 32-bit integer.",
                              "Choose an integer from 0 to 4294967295.", 422)

    @staticmethod
    def _validate_noise(noise: str) -> None:
        if noise not in NOISE_SIGMA_M:
            raise DomainError("invalid_noise", "Unknown sensor noise level.",
                              "Choose low, mid or high.", 422)

    def observe(
        self, pressures: dict[str, float], sensors: list[str], sigma: float, seed: int,
    ) -> dict[str, float | None]:
        """Apply sensor-stable Gaussian noise/dropout, independent of sensor list order."""
        self._validate_seed(seed)
        resolved = self.validate_sensors(sensors, len(sensors))
        if not math.isfinite(sigma) or sigma < 0:
            raise DomainError("invalid_noise", "Noise sigma must be finite and nonnegative.",
                              "Use an assumed noise standard deviation in metres.", 422)
        # Draw for every junction in a fixed order, allowing offline sensor comparisons
        # to reuse identical readings at shared nodes without seeing ground truth.
        rng = np.random.default_rng(seed)
        candidates = self.hydraulics.candidate_nodes()
        errors = dict(zip(candidates, rng.normal(0, sigma, len(candidates)), strict=True))
        dropout = dict(zip(candidates, rng.random(len(candidates)), strict=True))
        readings = {}
        for node in resolved:
            if node not in pressures or not math.isfinite(pressures[node]):
                raise DomainError("invalid_pressures", "Pressure input is incomplete or nonfinite.",
                                  "Generate a fresh hydraulic snapshot.", 422)
            readings[node] = (
                None if dropout[node] < self.settings.sensor_dropout_rate
                else round(float(pressures[node]) + float(errors[node]), 8)
            )
        return readings

    def make(
        self, seed: int, size: str | None = None, noise: str = "mid",
        sensors: list[str] | None = None, k: int = 6,
    ) -> tuple[ScenarioObservation, ScenarioTruth]:
        """Simulate one random leak under demand/area mismatch, then add sensor noise."""
        self._validate_seed(seed)
        self._validate_noise(noise)
        if size is not None and size not in LEAK_AREAS_M2:
            raise DomainError("invalid_size", "Unknown synthetic leak size.",
                              "Choose small, medium or large.", 422)
        resolved = self.validate_sensors(sensors, k)
        self.signatures.ensure_ready()
        rng = np.random.default_rng(seed)
        node = str(rng.choice(self.signatures.candidate_order))
        chosen_size = size or str(rng.choice(list(LEAK_AREAS_M2)))
        demand = float(rng.uniform(*DEMAND_MULT_RANGE))
        area = LEAK_AREAS_M2[chosen_size] * float(rng.uniform(*AREA_JITTER_RANGE))
        result = self.hydraulics.run(node, area, demand)
        sigma = NOISE_SIGMA_M[noise]
        observation = ScenarioObservation(
            seed=seed, sensors=resolved,
            readings=self.observe(result.pressures, resolved, sigma, seed),
            noise=noise, noise_sigma=sigma, pressures_all=result.pressures,
        )
        truth = ScenarioTruth(
            true_leak_node=node, true_size=chosen_size, demand_mult=demand,
            effective_area_m2=result.effective_area_m2, leak_flow_lps=result.leak_flow_lps,
            retry_count=result.retry_count,
        )
        return observation, truth

    @lru_cache(maxsize=256)
    def _no_leak_pressures(self, seed: int) -> dict[str, float]:
        rng = np.random.default_rng(seed)
        demand = float(rng.uniform(*DEMAND_MULT_RANGE))
        return self.hydraulics.run(demand_mult=demand).pressures

    def make_no_leak(
        self, seed: int, noise: str, sensors: list[str] | None = None, k: int = 6,
    ) -> ScenarioObservation:
        """Calibrate/validate noise with actual demand-perturbed no-leak hydraulics."""
        self._validate_seed(seed)
        self._validate_noise(noise)
        resolved = self.validate_sensors(sensors, k)
        pressures = self._no_leak_pressures(seed).copy()
        sigma = NOISE_SIGMA_M[noise]
        return ScenarioObservation(
            seed=seed, sensors=resolved,
            readings=self.observe(pressures, resolved, sigma, seed),
            noise=noise, noise_sigma=sigma, pressures_all=pressures,
        )
