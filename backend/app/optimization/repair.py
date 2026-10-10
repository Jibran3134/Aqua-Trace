"""Deterministic exact sparse repair selection with an honest greedy comparison."""
from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal

from app.core.errors import DomainError

DEFAULT_COST = Decimal("50000")
LITRES_PER_LPS_DAY = Decimal("86400")


@dataclass(frozen=True)
class RepairItem:
    node: str
    flow: Decimal
    cost: Decimal
    defaulted: bool


def _money(value: float) -> Decimal:
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def optimize(budget: float, candidates: list[dict], value_per_litre: float = .05) -> dict:
    budget_d = _money(budget)
    value_d = _money(value_per_litre)
    if budget_d < 0 or value_d <= 0:
        raise DomainError("invalid_financial_input", "Budget and value assumptions must be positive.",
                          "Provide a nonnegative budget and positive value per litre.", 422)
    items: list[RepairItem] = []
    seen: set[str] = set()
    for candidate in candidates:
        node = candidate["node"]
        if node in seen:
            raise DomainError("invalid_candidates", "Repair nodes must be unique.",
                              "Remove duplicate node IDs and retry.", 422)
        seen.add(node)
        cost = (_money(candidate["repair_cost_pkr"])
                if candidate.get("repair_cost_pkr") is not None else DEFAULT_COST)
        items.append(RepairItem(node, _money(candidate["est_leak_lps"]), cost,
                                candidate.get("repair_cost_pkr") is None))
    # Sparse exact 0/1 frontier. Benefit is litres/day; Decimal avoids float budget drift.
    frontier: dict[Decimal, tuple[Decimal, tuple[int, ...]]] = {Decimal(0): (Decimal(0), ())}
    for index, item in enumerate(items):
        updates = {}
        for cost, (benefit, mask) in frontier.items():
            new_cost = cost + item.cost
            if new_cost <= budget_d:
                new_benefit = benefit + item.flow * LITRES_PER_LPS_DAY
                prior = frontier.get(new_cost) or updates.get(new_cost)
                if prior is None or new_benefit > prior[0]:
                    updates[new_cost] = (new_benefit, mask + (index,))
        frontier.update(updates)
        best = Decimal(-1)
        pruned = {}
        for cost in sorted(frontier):
            benefit, mask = frontier[cost]
            if benefit > best:
                pruned[cost] = (benefit, mask)
                best = benefit
        frontier = pruned
    _, (best_benefit, best_mask) = max(frontier.items(), key=lambda pair: (pair[1][0], -pair[0]))
    selected = [items[index] for index in best_mask]
    remaining = sorted(items, key=lambda item: (-(item.flow / item.cost), item.node))
    greedy: list[RepairItem] = []
    spent = Decimal(0)
    for item in remaining:
        if spent + item.cost <= budget_d:
            greedy.append(item)
            spent += item.cost

    def selection(chosen: list[RepairItem]) -> dict:
        return {"selected": [{"node": x.node, "est_leak_lps": float(x.flow),
                              "repair_cost_pkr": float(x.cost), "litres_per_day": float(x.flow * LITRES_PER_LPS_DAY),
                              "cost_defaulted": x.defaulted} for x in chosen],
                "total_cost_pkr": float(sum((x.cost for x in chosen), Decimal(0))),
                "litres_per_day_saved": float(sum((x.flow * LITRES_PER_LPS_DAY for x in chosen), Decimal(0)))}
    chosen = selection(selected)
    greedy_result = selection(greedy)
    value_day = Decimal(str(chosen["litres_per_day_saved"])) * value_d
    return {**chosen, "value_pkr_per_day": float(value_day),
            "payback_days": (float(Decimal(str(chosen["total_cost_pkr"])) / value_day)
                              if value_day else None),
            "greedy": {"selected": [item["node"] for item in greedy_result["selected"]],
                       "total_cost_pkr": greedy_result["total_cost_pkr"],
                       "litres_per_day_saved": greedy_result["litres_per_day_saved"]},
            "assumptions": {"value_per_litre_pkr": float(value_d),
                            "default_repair_cost_pkr": float(DEFAULT_COST),
                            "label": "ASSUMPTION: replace with utility data"},
            "note": "Assumes independent leaks; savings are simulated estimates."}
