from app.optimization.repair import optimize


def test_exact_repair_beats_greedy_fractional_cost_case():
    result = optimize(100, [
        {"node": "101", "est_leak_lps": 1.0, "repair_cost_pkr": 49},
        {"node": "103", "est_leak_lps": 2.0, "repair_cost_pkr": 49},
        {"node": "105", "est_leak_lps": 0.5, "repair_cost_pkr": 50},
    ])
    assert result["total_cost_pkr"] == 98.0
    assert [item["node"] for item in result["selected"]] == ["101", "103"]
    assert result["litres_per_day_saved"] > 0


def test_default_cost_is_explicitly_reported():
    result = optimize(50_000, [{"node": "101", "est_leak_lps": 1.0}])
    assert result["selected"][0]["cost_defaulted"] is True
    assert result["assumptions"]["default_repair_cost_pkr"] == 50_000.0
