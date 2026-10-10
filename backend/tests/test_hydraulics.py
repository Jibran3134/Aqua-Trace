"""Real WNTR acceptance tests, independent of PostgreSQL and Redis."""

import copy
import time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest

from app.core.config import LEAK_AREAS_M2, Settings
from app.core.errors import DomainError
from app.hydraulics.service import HydraulicService, SimulationError


@pytest.fixture(scope="module")
def hydraulics() -> HydraulicService:
    return HydraulicService(Settings(_env_file=None, environment="test"))


def test_real_baseline_and_leak(hydraulics):
    started = time.perf_counter()
    baseline = hydraulics.run()
    seconds = time.perf_counter() - started
    assert seconds < 2.0
    assert all(np.isfinite(baseline.pressures[node]) for node in hydraulics.candidate_nodes())
    assert baseline.leak_flow_lps is None
    leaked = hydraulics.run("101", LEAK_AREAS_M2["medium"])
    assert leaked.pressures["101"] < baseline.pressures["101"]
    assert leaked.leak_flow_lps > 0
    assert leaked.effective_area_m2 == LEAK_AREAS_M2["medium"]
    assert leaked.retry_count == 0


def test_deterministic_runs_and_pristine_template(hydraulics):
    before = copy.deepcopy(hydraulics._template.to_dict())
    first = hydraulics.run("101", LEAK_AREAS_M2["medium"], 1.03)
    second = hydraulics.run("101", LEAK_AREAS_M2["medium"], 1.03)
    assert first == second
    assert hydraulics._template.to_dict() == before
    assert hydraulics._template.sim_time == 0
    assert not hydraulics._template.get_node("101").leak


def test_candidates_network_and_sensor_graph(hydraulics):
    assert len(hydraulics.candidate_nodes()) == 92
    assert {"River", "Lake", "1", "2", "3"}.isdisjoint(hydraulics.candidate_nodes())
    assert "601" in hydraulics.candidate_nodes()  # A zero-demand junction remains eligible.
    assert len(hydraulics.network_payload()["nodes"]) == 97
    assert len(hydraulics.network_payload()["pipes"]) == 119
    graph = hydraulics.graph()
    graph.remove_node("101")
    assert "101" in hydraulics.graph()  # Callers cannot mutate the service graph.
    assert len(set(hydraulics.default_sensors(6))) == 6
    assert "10" not in hydraulics.default_sensors(6)
    assert hydraulics.default_sensors(6) == hydraulics.default_sensors(6)
    assert "101" in hydraulics.adjacent_pipes("101")
    assert "10" not in hydraulics.adjacent_pipes("10")  # Pump 10 is not a pipe.


@pytest.mark.parametrize("kwargs", [
    {"leak_node": "Lake", "leak_area": 0.001},
    {"leak_node": "101"}, {"leak_area": 0.001},
    {"demand_mult": float("nan")}, {"demand_mult": 0},
    {"leak_node": "101", "leak_area": -1},
])
def test_invalid_simulation_inputs(hydraulics, kwargs):
    with pytest.raises(DomainError) as error:
        hydraulics.run(**kwargs)
    assert error.value.status_code == 422


def test_retry_effective_area_and_private_errors(hydraulics, monkeypatch):
    from app.hydraulics.service import wntr

    _ = hydraulics._baseline_negative_nodes
    original = wntr.sim.WNTRSimulator.run_sim
    calls = []

    def fail_first(simulator, **kwargs):
        calls.append(simulator._wn.get_node("101").leak_area)
        if len(calls) == 1:
            raise RuntimeError("hidden leak 101")
        return original(simulator, **kwargs)

    monkeypatch.setattr(wntr.sim.WNTRSimulator, "run_sim", fail_first)
    result = hydraulics.run("101", 0.001)
    assert calls == [0.001, 0.0005]
    assert result.effective_area_m2 == 0.0005
    assert result.retry_count == 1

    def fail_always(*args, **kwargs):
        raise RuntimeError("hidden leak 101")

    monkeypatch.setattr(wntr.sim.WNTRSimulator, "run_sim", fail_always)
    with pytest.raises(SimulationError) as error:
        hydraulics.run("101", 0.001)
    assert error.value.status_code == 503
    assert "101" not in str(error.value)


def test_concurrent_simulations_are_independent(hydraulics):
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: hydraulics.run("101", 0.0005), range(2)))
    assert results[0] == results[1]


def test_nonpositive_leak_junction_rejected(hydraulics):
    baseline = hydraulics.run()
    assert baseline.pressures["10"] < 0  # Preserve this actual benchmark operating state.
    with pytest.raises(SimulationError):
        hydraulics.run("10", LEAK_AREAS_M2["medium"])


def test_signature_build_load_corruption_and_thread_coordination(hydraulics, tmp_path):
    from app.hydraulics.signatures import SignatureLibrary, SignaturesNotReady

    settings = Settings(_env_file=None, environment="test", cache_dir=tmp_path)
    library = SignatureLibrary(settings, hydraulics)
    with pytest.raises(SignaturesNotReady):
        library.ensure_ready()
    started = time.perf_counter()
    progress = []
    library.build(progress.append)
    assert library.last_build_seconds < 30
    assert time.perf_counter() - started < 30
    assert progress[-1] == 100
    assert library.get_state()["ready"]
    assert "10" in library.get_state()["skipped"]
    assert library.matrix.shape == (97, 91)
    assert library.matrix.dtype == np.float32
    assert np.isfinite(library.matrix).all()
    assert all((library.matrix[:, col] < 0).any() for col in range(91))
    assert not library.matrix.flags.writeable
    restored = SignatureLibrary(settings, hydraulics)
    restored.load()
    assert restored.last_load_seconds < 1
    np.testing.assert_array_equal(restored.matrix, library.matrix)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(lambda _: restored.build(), range(2)))
    library.cache_path.write_bytes(b"not an npz artifact")
    with pytest.raises(SignaturesNotReady):
        restored.load()
    restored.build()
    assert restored.get_state()["ready"]
    np.testing.assert_array_equal(restored.matrix, library.matrix)


def test_signature_network_hash_invalidates_cache(hydraulics, tmp_path):
    from app.hydraulics.signatures import SignatureLibrary

    settings = Settings(_env_file=None, environment="test", cache_dir=tmp_path)
    library = SignatureLibrary(settings, hydraulics)
    copied_network = tmp_path / "changed.inp"
    copied_network.write_bytes(settings.net_file.read_bytes() + b"\n; hash test\n")
    changed = SignatureLibrary(settings.model_copy(update={"net_file": copied_network}), hydraulics)
    assert library.fingerprint != changed.fingerprint


def test_center_works_for_sensor_vectors_and_matrices():
    from app.hydraulics.signatures import center

    np.testing.assert_array_equal(center(np.array([1., 3.])), [-1., 1.])
    np.testing.assert_array_equal(center(np.array([[1., 2.], [3., 4.]])), [[-1., -1.], [1., 1.]])
    assert center(np.array([])).size == 0


def test_signature_identity_is_portable_across_lf_and_crlf(hydraulics, tmp_path):
    from app.hydraulics.fingerprint import canonical_network_sha256
    from app.hydraulics.signatures import SignatureLibrary

    settings = Settings(_env_file=None, environment="test", cache_dir=tmp_path)
    lf = tmp_path / "lf.inp"
    crlf = tmp_path / "crlf.inp"
    canonical = settings.net_file.read_bytes().replace(b"\r\n", b"\n")
    lf.write_bytes(canonical)
    crlf.write_bytes(canonical.replace(b"\n", b"\r\n"))
    assert lf.read_bytes() != crlf.read_bytes()
    assert canonical_network_sha256(lf) == canonical_network_sha256(crlf)
    unix = SignatureLibrary(settings.model_copy(update={"net_file": lf}), hydraulics)
    windows = SignatureLibrary(settings.model_copy(update={"net_file": crlf}), hydraulics)
    assert unix.fingerprint == windows.fingerprint
