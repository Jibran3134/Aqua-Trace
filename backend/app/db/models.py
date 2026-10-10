"""Observation and hidden-truth storage are deliberately separate tables."""

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, MetaData
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_name)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class ScenarioRow(Base):
    """Internal observation state; serializers must still project public fields."""

    __tablename__ = "scenarios"
    __table_args__ = (
        CheckConstraint("revision >= 0", name="revision_nonnegative"),
        CheckConstraint("expires_at > created_at", name="expiry_after_creation"),
        Index("ix_scenarios_expires_at", "expires_at"),
        Index("ix_scenarios_created_at", "created_at"),
        {"schema": "aquatrace"},
    )

    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True)
    observation: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    weights: Mapped[dict[str, float]] = mapped_column(JSONB, nullable=False)
    inspected: Mapped[dict[str, bool]] = mapped_column(JSONB, nullable=False)
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False)
    history: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class ScenarioTruthRow(Base):
    """Only reveal and offline evaluation paths may read this private table."""

    __tablename__ = "scenario_truth"
    __table_args__ = {"schema": "aquatrace_private"}

    scenario_id: Mapped[UUID] = mapped_column(
        PGUUID(as_uuid=True), ForeignKey("aquatrace.scenarios.id", ondelete="CASCADE"),
        primary_key=True,
    )
    truth: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
