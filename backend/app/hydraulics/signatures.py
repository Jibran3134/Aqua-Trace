"""Versioned atomic leak signature cache with process and thread coordination."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from threading import RLock
from time import perf_counter
from zipfile import BadZipFile

import numpy as np
import scipy
import wntr
from filelock import FileLock, Timeout

from app.core.config import (
    DISCHARGE_COEFF,
    LEAK_AREAS_M2,
    MINIMUM_PRESSURE_M,
    REQUIRED_PRESSURE_M,
    Settings,
)
from app.core.errors import DomainError
from app.hydraulics.fingerprint import NETWORK_HASH_POLICY, canonical_network_sha256
from app.hydraulics.service import HydraulicService, SimulationError


class SignaturesNotReady(DomainError):
    """A missing, invalid or incomplete signature artifact."""

    def __init__(self) -> None:
        super().__init__(
            "signatures_not_ready", "Hydraulic signatures are not ready yet.",
            "Wait for GET /health signatures_ready=true and try again.", 503,
        )


def center(values: np.ndarray) -> np.ndarray:
    """Remove sensor common mode from a vector or sensor-by-candidate matrix."""
    values = np.asarray(values, dtype=float)
    return values - values.mean(axis=0, keepdims=True) if values.size else values.copy()


class SignatureLibrary:
    """Publish complete immutable arrays only after a validated cache/build."""

    FORMAT_VERSION = 1

    def __init__(self, settings: Settings, hydraulics: HydraulicService) -> None:
        self.settings = settings
        self.hydraulics = hydraulics
        self._lock = RLock()
        self.matrix: np.ndarray | None = None
        self.baseline: np.ndarray | None = None
        self.reference_flows: np.ndarray | None = None
        self.node_order: list[str] = []
        self.candidate_order: list[str] = []
        self.fingerprint = self._fingerprint()
        self._state = {"ready": False, "progress": 0.0, "built_at": None,
                       "n_candidates": 0, "skipped": []}
        self.last_build_seconds: float | None = None
        self.last_load_seconds: float | None = None

    @property
    def cache_path(self) -> Path:
        return self.settings.cache_dir / "signatures.npz"

    def _fingerprint(self) -> str:
        physical_config = {
            "format": self.FORMAT_VERSION, "wntr": wntr.__version__,
            "numpy": np.__version__, "scipy": scipy.__version__,
            "network_sha256": canonical_network_sha256(self.settings.net_file),
            "network_hash_policy": NETWORK_HASH_POLICY,
            "reference_size": "medium", "areas": LEAK_AREAS_M2,
            "discharge": DISCHARGE_COEFF, "demand_model": "PDD",
            "required_pressure": REQUIRED_PRESSURE_M, "minimum_pressure": MINIMUM_PRESSURE_M,
            "pressure_exponent": 0.5, "snapshot_s": 0, "precision_decimals": 8,
            "inherited_negative_exception": "10",
        }
        return hashlib.sha256(json.dumps(physical_config, sort_keys=True).encode()).hexdigest()

    def get_state(self) -> dict:
        """Return a copy of progress without exposing partially built arrays."""
        # Build does not hold this lock while simulating, so health remains responsive.
        return {**self._state, "skipped": list(self._state["skipped"])}

    def ensure_ready(self) -> None:
        """Guard endpoints which require fully published signatures."""
        if not self._state["ready"]:
            raise SignaturesNotReady()

    def load(self) -> None:
        """Load a complete matching artifact; invalid artifacts remain unready."""
        started = perf_counter()
        try:
            with np.load(self.cache_path, allow_pickle=False) as cached:
                metadata = json.loads(str(cached["metadata"].item()))
                matrix = np.array(cached["matrix"], dtype=np.float32)
                baseline = np.array(cached["baseline"], dtype=np.float32)
                reference_flows = np.array(cached["reference_flows"], dtype=np.float32)
            nodes, candidates = metadata["node_order"], metadata["candidate_order"]
            expected_nodes = {node["id"] for node in self.hydraulics.network_payload()["nodes"]}
            if (
                metadata["fingerprint"] != self.fingerprint
                or not nodes or not candidates
                or len(set(nodes)) != len(nodes) or set(nodes) != expected_nodes
                or len(set(candidates)) != len(candidates)
                or not set(candidates).issubset(self.hydraulics.candidate_nodes())
                or matrix.shape != (len(nodes), len(candidates))
                or baseline.shape != (len(nodes),)
                or reference_flows.shape != (len(candidates),)
                or not np.isfinite(matrix).all() or not np.isfinite(baseline).all()
                or not np.isfinite(reference_flows).all() or (reference_flows <= 0).any()
                or not isinstance(metadata["built_at"], str)
                or not isinstance(metadata["skipped"], list)
            ):
                raise ValueError("Invalid signature artifact")
            self._publish(matrix, baseline, reference_flows, metadata)
            self.last_load_seconds = perf_counter() - started
        except (OSError, ValueError, KeyError, TypeError, EOFError, BadZipFile):
            self._state = {**self._state, "ready": False}
            raise SignaturesNotReady() from None

    def _publish(
        self, matrix: np.ndarray, baseline: np.ndarray, reference_flows: np.ndarray,
        metadata: dict,
    ) -> None:
        for array in (matrix, baseline, reference_flows):
            array.setflags(write=False)
        self.matrix, self.baseline, self.reference_flows = matrix, baseline, reference_flows
        self.node_order = list(metadata["node_order"])
        self.candidate_order = list(metadata["candidate_order"])
        self._state = {
            "ready": True, "progress": 100.0, "built_at": metadata["built_at"],
            "n_candidates": len(self.candidate_order), "skipped": list(metadata["skipped"]),
        }

    def build(self, progress_callback: Callable[[float], None] | None = None) -> None:
        """Load a valid artifact or build once across threads and worker processes."""
        started = perf_counter()
        self.settings.cache_dir.mkdir(parents=True, exist_ok=True)
        try:
            with self._lock, FileLock(str(self.cache_path) + ".lock", timeout=300):
                try:
                    self.load()
                    return
                except SignaturesNotReady:
                    pass
                baseline_result = self.hydraulics.run()
                nodes = list(baseline_result.pressures)
                baseline = np.array([baseline_result.pressures[node] for node in nodes])
                columns, candidates, flows, effective_areas, skipped = [], [], [], [], []
                all_candidates = self.hydraulics.candidate_nodes()
                for index, node in enumerate(all_candidates):
                    try:
                        result = self.hydraulics.run(node, LEAK_AREAS_M2["medium"])
                        column = np.array([result.pressures[name] for name in nodes]) - baseline
                        if result.leak_flow_lps <= 0 or not np.isfinite(column).all():
                            raise SimulationError()
                        columns.append(column)
                        candidates.append(node)
                        flows.append(result.leak_flow_lps)
                        effective_areas.append(result.effective_area_m2)
                    except SimulationError:
                        skipped.append(node)
                    progress = round(100 * (index + 1) / len(all_candidates), 2)
                    self._state = {**self._state, "ready": False, "progress": progress,
                                   "skipped": skipped.copy()}
                    if progress_callback is not None:
                        progress_callback(progress)
                if not columns:
                    raise SignaturesNotReady()
                matrix = np.column_stack(columns).astype(np.float32)
                baseline = baseline.astype(np.float32)
                reference_flows = np.array(flows, dtype=np.float32)
                metadata = {
                    "fingerprint": self.fingerprint, "format": self.FORMAT_VERSION,
                    "built_at": datetime.now(UTC).isoformat(), "node_order": nodes,
                    "candidate_order": candidates, "skipped": skipped,
                    "effective_reference_areas_m2": effective_areas,
                    "reference_size": "medium", "time_step": "t0", "wntr": wntr.__version__,
                }
                self._save(matrix, baseline, reference_flows, metadata)
                self._publish(matrix, baseline, reference_flows, metadata)
                self.last_build_seconds = perf_counter() - started
        except (OSError, Timeout):
            self._state = {**self._state, "ready": False}
            raise SignaturesNotReady() from None

    def _save(
        self, matrix: np.ndarray, baseline: np.ndarray, reference_flows: np.ndarray,
        metadata: dict,
    ) -> None:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(dir=self.settings.cache_dir, suffix=".npz",
                                             delete=False) as target:
                temporary = Path(target.name)
                np.savez_compressed(
                    target, matrix=matrix, baseline=baseline, reference_flows=reference_flows,
                    metadata=np.array(json.dumps(metadata, sort_keys=True)),
                )
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary, self.cache_path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
