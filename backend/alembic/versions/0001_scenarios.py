"""Separate observation state from hidden truth in PostgreSQL schemas.

Revision ID: 0001_scenarios
Revises: None
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0001_scenarios"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS aquatrace")
    op.execute("CREATE SCHEMA IF NOT EXISTS aquatrace_private")
    op.execute("REVOKE ALL ON SCHEMA aquatrace_private FROM PUBLIC")
    op.create_table(
        "scenarios",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("observation", postgresql.JSONB(), nullable=False),
        sa.Column("weights", postgresql.JSONB(), nullable=False),
        sa.Column("inspected", postgresql.JSONB(), nullable=False),
        sa.Column("resolved", sa.Boolean(), nullable=False),
        sa.Column("history", postgresql.JSONB(), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("revision >= 0", name=op.f("ck_scenarios_revision_nonnegative")),
        sa.CheckConstraint("expires_at > created_at", name=op.f("ck_scenarios_expiry_after_creation")),
        sa.PrimaryKeyConstraint("id", name="pk_scenarios"), schema="aquatrace",
    )
    op.create_index("ix_scenarios_expires_at", "scenarios", ["expires_at"], schema="aquatrace")
    op.create_index("ix_scenarios_created_at", "scenarios", ["created_at"], schema="aquatrace")
    op.create_table(
        "scenario_truth",
        sa.Column("scenario_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("truth", postgresql.JSONB(), nullable=False),
        sa.ForeignKeyConstraint(
            ["scenario_id"], ["aquatrace.scenarios.id"],
            ondelete="CASCADE", name="fk_scenario_truth_scenario_id_scenarios",
        ),
        sa.PrimaryKeyConstraint("scenario_id", name="pk_scenario_truth"),
        schema="aquatrace_private",
    )
    op.execute("REVOKE ALL ON TABLE aquatrace_private.scenario_truth FROM PUBLIC")


def downgrade() -> None:
    op.drop_table("scenario_truth", schema="aquatrace_private")
    op.drop_index("ix_scenarios_created_at", table_name="scenarios", schema="aquatrace")
    op.drop_index("ix_scenarios_expires_at", table_name="scenarios", schema="aquatrace")
    op.drop_table("scenarios", schema="aquatrace")
    # Schemas may contain other application objects; do not delete them implicitly.
