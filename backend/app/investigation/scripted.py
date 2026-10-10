"""Deterministic investigation policy shared by scripted and provider turns."""

from pydantic import ValidationError

from app.domain.models import ScenarioState
from app.investigation.tools import InvestigationTools, PlanResult
from app.schemas.api import AgentEvent, AgentResponse

ACTION_TEXT = {
    "rank_candidates": "Ranking uninspected candidates from sensor residuals.",
    "simulate_hypothesis": "Comparing the leading signature with the live readings.",
    "plan_inspection": "Planning pipe-network paths through the leading candidates.",
    "recommend_sensor_addition": "Checking where an additional sensor can separate candidates.",
}


class InvestigationFlow:
    """Finite policy: providers may invoke tools, but cannot alter decisions or text."""

    def __init__(self, state: ScenarioState, source: str) -> None:
        self.source = source
        self.inspections_used = len(state.inspected)
        self.events: list[AgentEvent] = []
        self.next_name: str | None = None if state.resolved else "rank_candidates"
        self.next_args: dict = {"top_k": 3}
        self.ranking: dict | None = None
        self.response: AgentResponse | None = None
        if state.resolved:
            route, length = [], 0.0
            for event in reversed(state.history):
                if event.get("type") == "tool_result" and event.get("name") == "plan_inspection":
                    try:
                        plan = PlanResult.model_validate(event.get("result"))
                        route, length = plan.order, plan.total_length_m
                        break
                    except ValidationError:
                        continue
            self.response = AgentResponse(
                events=[AgentEvent(step=1, type="final",
                                   result={"inspections_used": self.inspections_used,
                                           "total_length_m": length},
                                   text=f"Investigation resolved after {self.inspections_used} "
                                        "recorded crew inspections.")],
                source=source, state="resolved", inspections_used=self.inspections_used,
                route=route, route_length_m=length,
            )

    def accept(self, name: str, args: dict, result: dict) -> None:
        step = 1 + sum(event.type == "tool_call" for event in self.events)
        self.events.extend([
            AgentEvent(step=step, type="thought", text=ACTION_TEXT[name]),
            AgentEvent(step=step, type="tool_call", name=name, args=args),
            AgentEvent(step=step, type="tool_result", name=name, result=result),
        ])
        if name == "rank_candidates":
            self.ranking = result
            if (result["status"] != "ok" or not result["candidates"]
                    or result["evidence"]["margin_top1_vs_top2"] < 2):
                self.next_name, self.next_args = "recommend_sensor_addition", {}
            else:
                self.next_name = "simulate_hypothesis"
                self.next_args = {"node": result["candidates"][0]["node"]}
        elif name == "simulate_hypothesis":
            if result["fit_label"] == "poor":
                self.next_name, self.next_args = "recommend_sensor_addition", {}
            else:
                self.next_name = "plan_inspection"
                self.next_args = {"nodes": [c["node"] for c in self.ranking["candidates"]],
                                  "depot": None}
        elif name == "recommend_sensor_addition":
            node = result["recommended"]
            text = (f"Evidence is insufficient for an inspection recommendation. Add a sensor "
                    f"at node {node} and collect new readings." if node else
                    "Evidence is insufficient for an inspection recommendation. "
                    "Collect more live sensor readings before continuing.")
            self.events.append(AgentEvent(step=step + 1, type="abstain", text=text))
            self.response = AgentResponse(events=self.events, source=self.source, state="abstained",
                                          recommended_node=node, recommended_sensor=node,
                                          route=[],
                                          inspections_used=self.inspections_used)
            self.next_name = None
        elif name == "plan_inspection":
            order = result["order"]
            self.events.append(AgentEvent(step=step + 1, type="recommendation",
                                          text=f"Inspect node {order[0]} first "
                                               f"(route: {' → '.join(order)})."))
            self.response = AgentResponse(events=self.events, source=self.source,
                                          state="investigating", recommended_node=order[0],
                                          route=order, route_length_m=result["total_length_m"],
                                          inspections_used=self.inspections_used)
            self.next_name = None


class ScriptedInvestigator:
    def __init__(self, tools: InvestigationTools) -> None:
        self.tools = tools

    def run(self, state: ScenarioState) -> AgentResponse:
        flow = InvestigationFlow(state, "scripted")
        while flow.next_name:
            name, args = flow.next_name, flow.next_args
            flow.accept(name, args, self.tools.execute(state, name, args))
        return flow.response
