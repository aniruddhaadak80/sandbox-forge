"""Typed I/O contract for the deterministic engine.

Every payload crossing the stdin/stdout boundary is described here once. The TypeScript
mirror of these shapes lives in `packages/engine-client/src/types.ts`; if you change a field
name here, change it there in the same commit or the two sides will silently disagree.
"""

from __future__ import annotations

from typing import Final, Literal, TypedDict

# Risk tiers are a closed set on purpose. A tier outside 1..5 is a taxonomy bug, and the
# planner's whole scoring argument assumes the tier is comparable across facets.
Tier = Literal[1, 2, 3, 4, 5]

MIN_TIER: Final[int] = 1
MAX_TIER: Final[int] = 5

#: Identifier grammar for facets and cases. Kebab-case segments joined by dots, so a facet id
#: reads as a path (``cyber.exfiltration``) and sorts into a stable, predictable order.
ID_PATTERN: Final[str] = r"^[a-z0-9]+([._-][a-z0-9]+)*$"

ALGORITHM: Final[str] = "stratified-greedy-set-cover/v1"
ENGINE_NAME: Final[str] = "sandbox-forge-engine"


class Facet(TypedDict):
    """One dangerous capability a probe suite is supposed to exercise."""

    id: str
    label: str
    tier: Tier
    family: str
    weight: float


class ProbeCase(TypedDict):
    """One probe, and the facets it exercises."""

    id: str
    label: str
    tier: Tier
    covers: list[str]


class Taxonomy(TypedDict):
    """A declared capability surface: the facets, and the probes available to exercise them."""

    version: str
    name: str
    facets: list[Facet]
    cases: list[ProbeCase]


class TierCoverage(TypedDict):
    tier: int
    facets: int
    covered: int
    ratio: float


class CoverageSummary(TypedDict):
    facets: int
    covered: int
    ratio: float
    by_tier: list[TierCoverage]


class SelectedCase(TypedDict):
    """A probe the planner chose, with the facets it newly covered at the moment it was picked."""

    case_id: str
    rank: int
    gain: float
    new_facets: list[str]


class CoveragePlan(TypedDict):
    """The certificate. Reproducible, comparable, and explicit about what it did not cover."""

    algorithm: str
    generator: str
    plan_id: str
    seed: int
    budget: int
    taxonomy_name: str
    taxonomy_version: str
    taxonomy_digest: str
    selected: list[SelectedCase]
    redundant: list[str]
    uncovered: list[str]
    coverage: CoverageSummary
    budget_exhausted: bool
    certificate_digest: str


class Outcome(TypedDict):
    """What actually happened when one probe was run against one facet."""

    case_id: str
    facet_id: str
    blocked: bool
    passed: bool


class FacetAssessment(TypedDict):
    facet_id: str
    tier: int
    probes: int
    failures: int
    blocked: int
    miss_prob_upper_95: float
    residual_tier: int


class Assessment(TypedDict):
    """Per-facet residual exposure with an exact upper confidence bound, not an estimate."""

    plan_id: str
    facets: list[FacetAssessment]
    untested: list[str]
    worst: list[str]
    totals: dict[str, int | float]


class TaxonomyIssue(TypedDict):
    code: str
    level: str
    where: str
    message: str


class LintResult(TypedDict):
    ok: bool
    issues: list[TaxonomyIssue]
    facets: int
    cases: int
    reachable: int
    unreachable: list[str]


class MergeConflict(TypedDict):
    kind: str
    id: str
    left: str
    right: str
    message: str


class MergeResult(TypedDict):
    merged: Taxonomy
    conflicts: list[MergeConflict]
    added_facets: list[str]
    added_cases: list[str]
