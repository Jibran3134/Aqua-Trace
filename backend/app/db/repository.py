"""Transactional scenario persistence with revision-based mutation protection."""

from copy import deepcopy
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import DomainError
from app.db.models import ScenarioRow, ScenarioTruthRow
from app.domain.models import ScenarioObservation, ScenarioState, ScenarioTruth


def _unknown_scenario() -> DomainError:
    return DomainError(
        "scenario_not_found", "This scenario does not exist or has expired.",
        "Simulate another hidden leak to begin a new investigation.", 404,
    )


def _scenario_id(value: str | UUID) -> UUID:
    try:
        return value if isinstance(value, UUID) else UUID(value)
    except (ValueError, TypeError, AttributeError) as exc:
        raise _unknown_scenario() from exc


class ScenarioRepository:
    """Caller controls commit/rollback; every mutation remains in one transaction."""

    def __init__(self, session: Session, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or session.info.get("settings") or Settings()

    def create(self, observation: ScenarioObservation, truth: ScenarioTruth) -> UUID:
        """Store observation and truth atomically, without joining their read paths."""
        scenario_id = uuid4()
        now = datetime.now(timezone.utc)
        self.session.add(ScenarioRow(
            id=scenario_id, observation=asdict(observation), weights={}, inspected={},
            resolved=False, history=[], revision=0, created_at=now,
            expires_at=now + timedelta(hours=self.settings.scenario_ttl_hours),
        ))
        self.session.flush()
        self.session.add(ScenarioTruthRow(scenario_id=scenario_id, truth=asdict(truth)))
        self.session.flush()
        return scenario_id

    def load(self, scenario_id: str | UUID, for_update: bool = False) -> ScenarioState:
        """Return observation state only. PostgreSQL row locks serialize reports."""
        query = select(ScenarioRow).where(
            ScenarioRow.id == _scenario_id(scenario_id),
            ScenarioRow.expires_at > func.now(),
        ).execution_options(populate_existing=True)
        if for_update:
            query = query.with_for_update()
        row = self.session.execute(query).scalar_one_or_none()
        if row is None:
            raise _unknown_scenario()
        return ScenarioState(
            id=str(row.id), observation=ScenarioObservation(**deepcopy(row.observation)),
            weights=deepcopy(row.weights), inspected=deepcopy(row.inspected),
            resolved=row.resolved, history=deepcopy(row.history), revision=row.revision,
        )

    def save(self, state: ScenarioState, expected_revision: int) -> None:
        """Reject concurrent/stale writers instead of silently losing field reports."""
        if expected_revision < 0 or state.revision != expected_revision:
            raise DomainError(
                "scenario_conflict", "The investigation changed during this request.",
                "Reload the scenario and retry the action.", 409,
            )
        result = self.session.execute(update(ScenarioRow).where(
            ScenarioRow.id == _scenario_id(state.id),
            ScenarioRow.revision == expected_revision,
            ScenarioRow.expires_at > func.now(),
        ).values(
            observation=asdict(state.observation), weights=deepcopy(state.weights),
            inspected=deepcopy(state.inspected), resolved=state.resolved,
            history=deepcopy(state.history), revision=expected_revision + 1,
        ).execution_options(synchronize_session=False))
        if result.rowcount != 1:
            raise DomainError(
                "scenario_conflict", "The investigation changed or expired during this request.",
                "Reload the scenario or simulate another hidden leak.", 409,
            )
        state.revision = expected_revision + 1

    def reveal(self, scenario_id: str | UUID) -> ScenarioTruth:
        """Explicitly read hidden truth; never invoke from detector or agent code."""
        self.load(scenario_id)
        row = self.session.get(ScenarioTruthRow, _scenario_id(scenario_id))
        if row is None:
            raise _unknown_scenario()
        return ScenarioTruth(**deepcopy(row.truth))

    def cleanup(self) -> int:
        """Remove expired rows and oldest rows over the configured retention cap."""
        result = self.session.execute(delete(ScenarioRow).where(
            ScenarioRow.expires_at <= func.now()
        ).execution_options(synchronize_session=False))
        removed = result.rowcount
        overflow = select(ScenarioRow.id).order_by(
            ScenarioRow.created_at.desc(), ScenarioRow.id.desc(),
        ).offset(self.settings.scenario_max_count)
        result = self.session.execute(delete(ScenarioRow).where(
            ScenarioRow.id.in_(overflow)
        ).execution_options(synchronize_session=False))
        return removed + result.rowcount
