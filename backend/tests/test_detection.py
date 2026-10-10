"""Physical generation and inference acceptance, without external infrastructure."""

import copy
import math

import pytest

from app.core.config import LEAK_AREAS_M2, Settings
from app.core.errors import DomainError
from app.detection.scenarios import AREA_JITTER_RANGE, ScenarioGenerator
from app.detection.service import Detector
from app.hydraulics.service import HydraulicService
from app.hydraulics.signatures import SignatureLibrary


@pytest.fixture(scope="module")
def detection_context():
    settings = Settings(_env_file=None, environment="test")
    hydraulics = HydraulicService(settings)
    signatures = SignatureLibrary(settings, hydraulics)
    signatures.build()
    generator = ScenarioGenerator(settings, hydraulics, signatures)
    return settings, hydraulics, signatures, generator


def test_generation_is_seeded_and_non_circular(detection_context):
    _, hydraulics, signatures, generator = detection_context
    first, first_truth = generator.make(0)
    second, second_truth = generator.make(0)
    assert first == second
    assert first_truth == second_truth
    assert first_truth.true_leak_node in signatures.candidate_order
    assert first_truth.true_leak_node != "10"
    assert 0.9 <= first_truth.demand_mult <= 1.1
    assert (AREA_JITTER_RANGE[0] * LEAK_AREAS_M2[first_truth.true_size]
            <= first_truth.effective_area_m2
            <= AREA_JITTER_RANGE[1] * LEAK_AREAS_M2[first_truth.true_size])
    assert set(first.readings) == set(hydraulics.default_sensors(6))
    assert first.pressures_all
    assert not hasattr(first, "true_leak_node")


def test_sensor_noise_is_stable_for_reordered_and_subset_sensors(detection_context):
    _, _, _, generator = detection_context
    first, _ = generator.make(1, sensors=["101", "105", "129"])
    reversed_observation, _ = generator.make(1, sensors=["129", "105", "101"])
    subset, _ = generator.make(1, sensors=["105"])
    assert first.readings == reversed_observation.readings
    assert subset.readings["105"] == first.readings["105"]


def test_complete_dropout_and_nonpositive_explicit_sensor(detection_context):
    settings, hydraulics, signatures, _ = detection_context
    generator = ScenarioGenerator(settings.model_copy(update={"sensor_dropout_rate": 1}),
                                  hydraulics, signatures)
    observation, _ = generator.make(2, sensors=["10", "101"])
    assert observation.readings == {"10": None, "101": None}


@pytest.mark.parametrize("kwargs", [
    {"seed": -1}, {"seed": True}, {"seed": 2**32},
    {"seed": 1, "size": "gigantic"}, {"seed": 1, "noise": "missing"},
    {"seed": 1, "sensors": ["Lake"]}, {"seed": 1, "sensors": []},
    {"seed": 1, "sensors": ["101", "101"]}, {"seed": 1, "k": 13},
])
def test_generator_validates_inputs(detection_context, kwargs):
    with pytest.raises(DomainError) as error:
        detection_context[3].make(**kwargs)
    assert error.value.status_code == 422


def test_default_six_sensor_mid_noise_accuracy_gate(detection_context):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    hits = 0
    for seed in range(10):
        observation, truth = generator.make(seed)
        result = detector.analyze(observation)
        hits += truth.true_leak_node in [item.node for item in result.response.candidates[:3]]
    assert hits >= 6, f"Only {hits}/10 validation leaks reached the top three."


def test_heldout_no_leak_abstention_gate(detection_context):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    abstentions = sum(
        detector.analyze(generator.make_no_leak(seed, "mid")).response.status
        == "insufficient_evidence" for seed in range(30000, 30030)
    )
    assert abstentions >= 27, f"Only {abstentions}/30 heldout no-leak cases abstained."


def test_detection_determinism_and_private_data_independence(detection_context):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    observation, _ = generator.make(4)
    first = detector.analyze(observation)
    second = detector.analyze(generator.make(4)[0])
    assert first.response.model_dump_json() == second.response.model_dump_json()
    assert first.weights == second.weights
    hidden = copy.deepcopy(observation)
    hidden.seed = -999
    hidden.pressures_all = {"not-a-real-node": float("nan")}
    assert detector.analyze(hidden).response == first.response
    assert len(first.weights) == 91
    assert all(math.isfinite(value) and value > 0 for value in first.weights.values())
    assert sum(first.weights.values()) == pytest.approx(1)
    payload = first.response.model_dump()
    assert not {"true_leak_node", "true_size", "seed", "pressures_all"}.intersection(payload)


def test_dropout_reordering_custom_sensors_and_single_live_gate(detection_context):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    observation, _ = generator.make(3, sensors=["101", "105", "129"])
    reordered, _ = generator.make(3, sensors=["129", "105", "101"])
    first, second = detector.analyze(observation), detector.analyze(reordered)
    assert [(c.node, c.score) for c in first.response.candidates] == [
        (c.node, c.score) for c in second.response.candidates]
    assert first.response.evidence.noise_floor == second.response.evidence.noise_floor
    observation.readings["101"] = None
    observation.readings["105"] = None
    assert detector.analyze(observation).response.status == "insufficient_evidence"
    observation.readings["129"] = None
    offline = detector.analyze(observation)
    assert offline.response.candidates == []
    assert offline.response.evidence.live_sensors == 0
    assert "No live sensors" in offline.response.note


def test_current_weights_are_not_multiplied_by_initial_fit_again(detection_context):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    observation, _ = generator.make(4)
    initial = detector.analyze(observation)
    least = min(initial.weights, key=initial.weights.get)
    supplied = {node: 1e-12 for node in signatures.candidate_order}
    supplied[least] = 0.6
    supplied[initial.response.candidates[0].node] = 0.4
    updated = detector.analyze(observation, supplied)
    assert updated.response.candidates[0].node == least
    assert updated.weights[least] == pytest.approx(.6)
    assert detector.analyze(observation, updated.weights).weights[least] == pytest.approx(.6)
    with pytest.raises(DomainError):
        detector.analyze(observation, {"nonexistent": 1})


def test_noise_floor_cache_distinguishes_live_geometry_and_sigma(detection_context):
    settings, hydraulics, signatures, generator = detection_context

    class PublicCache:
        def __init__(self):
            self.data = {}

        def cache_key(self, bucket, *parts):
            return str((bucket, parts))

        def get_json(self, key):
            return self.data.get(key)

        def set_json(self, key, value):
            self.data[key] = value

    cache = PublicCache()
    detector = Detector(settings, hydraulics, signatures, generator, cache)
    one, _ = generator.make(4, sensors=["101", "105"])
    two, _ = generator.make(4, sensors=["101", "129"])
    detector.analyze(one)
    detector.analyze(two)
    changed_sigma = copy.deepcopy(two)
    changed_sigma.noise_sigma = .5
    detector.analyze(changed_sigma)
    assert len(cache.data) == 3
    assert all(set(value) == {"noise_floor"} for value in cache.data.values())


def test_fingerprint_and_projection_follow_signature_publication(detection_context, monkeypatch):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    before = detector.fingerprint
    observation, _ = generator.make(1)
    live, residual, rows = detector.fit_inputs(observation)
    result = detector.analyze(observation)
    candidate = result.response.candidates[0].node
    column = signatures.candidate_order.index(candidate)
    assert len(live) == 6
    assert float(((residual - result.alphas[candidate] * rows[:, column]) ** 2).sum()) \
        == pytest.approx(result.errors[candidate], abs=1e-9)
    monkeypatch.setattr(signatures, "fingerprint", signatures.fingerprint + "changed")
    assert detector.fingerprint != before
    detector.fit_inputs(observation)
    assert detector._direction_identity[0] == signatures.fingerprint


def test_fingerprint_changes_with_output_and_calibration_settings(detection_context, monkeypatch):
    settings, hydraulics, signatures, generator = detection_context
    detector = Detector(settings, hydraulics, signatures, generator)
    for key, value in (("detector_top_k", 3), ("noise_floor_percentile", 99),
                       ("demand_projection", False), ("detector_tau", .1)):
        changed = Detector(settings.model_copy(update={key: value}), hydraulics, signatures, generator)
        assert changed.fingerprint != detector.fingerprint
    before = detector.fingerprint
    monkeypatch.setattr("app.detection.service.DEMAND_MULT_RANGE", (.8, 1.2))
    assert detector.fingerprint != before
