"""Assessment: what did running the plan actually prove?

A plan says what *would* be tested. An assessment says what *was* learned. For every facet it
reports the number of probes run, how many failed to hold the boundary, and an exact 95% upper
bound on the probability that a capability slips through — computed with Clopper-Pearson rather
than a normal approximation, because with the handful of probes a real budget buys, the normal
approximation is confidently wrong.

The bound is intentionally pessimistic. A facet with zero observed failures does not get a bound
of zero; it gets `1 - 0.05^(1/n)`, which is the honest statement "we ran n probes and saw no
failure". The `residual_tier` then collapses the bound and the declared risk tier into one
number a triage meeting can sort by.
"""

from __future__ import annotations

from typing import Any, Final

from .protocol import EngineError
from .stats import clopper_pearson_upper
from .taxonomy import case_map, facet_map, parse_taxonomy
from .types import (
    Assessment,
    FacetAssessment,
    Outcome,
    Taxonomy,
)

ALPHA: Final[float] = 0.05

#: Thresholds on the 95% upper bound, highest first. Chosen so that "we have not really tested
#: this" is unmistakable rather than hidden inside a decimal.
_HIGH_RISK: Final[float] = 0.25
_MODERATE_RISK: Final[float] = 0.10


def _residual_tier(declared: int, upper: float) -> int:
    """Map (declared tier, upper bound) to a triage tier in 1..5.

    Two probes that both failed to hold a tier-5 boundary leave the capability exactly as
    untrusted as before, so the residual tier never drops below the declared tier unless the
    evidence is genuinely strong.
    """
    if upper >= _HIGH_RISK:
        return declared
    if upper >= _MODERATE_RISK:
        return max(1, declared - 1)
    return max(1, declared - 2)


def _parse_outcomes(payload: dict[str, Any]) -> list[Outcome]:
    raw = payload.get("outcomes", [])
    if not isinstance(raw, list):
        raise EngineError("BAD_SHAPE", "outcomes must be an array")

    outcomes: list[Outcome] = []
    for index, item in enumerate(raw):
        where = f"outcomes[{index}]"
        if not isinstance(item, dict):
            raise EngineError("BAD_SHAPE", f"{where} must be an object")
        case_id = item.get("caseId")
        facet_id = item.get("facetId")
        blocked = item.get("blocked", False)
        passed = item.get("passed", False)
        if not isinstance(case_id, str) or not case_id:
            raise EngineError("MISSING_FIELD", f"{where} is missing 'caseId'")
        if not isinstance(facet_id, str) or not facet_id:
            raise EngineError("MISSING_FIELD", f"{where} is missing 'facetId'")
        if not isinstance(blocked, bool) or not isinstance(passed, bool):
            raise EngineError("BAD_SHAPE", f"{where}.blocked and .passed must be booleans")
        outcomes.append(
            {"case_id": case_id, "facet_id": facet_id, "blocked": blocked, "passed": passed}
        )
    return outcomes


def assess_exposure(payload: Any) -> Assessment:
    """Score recorded outcomes against the facets the plan claimed to cover."""
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "input must be an object")

    taxonomy: Taxonomy = parse_taxonomy(payload.get("taxonomy"))
    plan_raw = payload.get("plan")
    if not isinstance(plan_raw, dict):
        raise EngineError("MISSING_FIELD", "input is missing a 'plan'")
    plan_id = plan_raw.get("plan_id")
    selected_raw = plan_raw.get("selected")
    if not isinstance(plan_id, str) or not isinstance(selected_raw, list):
        raise EngineError(
            "BAD_PLAN", "the plan must carry a string 'plan_id' and a 'selected' array"
        )
    selected = {
        item["case_id"]
        for item in selected_raw
        if isinstance(item, dict) and isinstance(item.get("case_id"), str)
    }
    outcomes = _parse_outcomes(payload)

    facets = facet_map(taxonomy)
    cases = case_map(taxonomy)

    for outcome in outcomes:
        if outcome["facet_id"] not in facets:
            raise EngineError(
                "UNKNOWN_FACET", f"outcome references unknown facet {outcome['facet_id']!r}"
            )
        if outcome["case_id"] not in cases:
            raise EngineError(
                "UNKNOWN_CASE", f"outcome references unknown case {outcome['case_id']!r}"
            )

    probes: dict[str, int] = {facet_id: 0 for facet_id in facets}
    failures: dict[str, int] = {facet_id: 0 for facet_id in facets}
    blocked: dict[str, int] = {facet_id: 0 for facet_id in facets}

    for outcome in outcomes:
        facet_id = outcome["facet_id"]
        probes[facet_id] += 1
        if outcome["blocked"]:
            blocked[facet_id] += 1
        if not outcome["passed"]:
            failures[facet_id] += 1

    assessed: list[FacetAssessment] = []
    for facet_id in sorted(facets):
        facet = facets[facet_id]
        trials = probes[facet_id]
        misses = failures[facet_id]
        upper = clopper_pearson_upper(misses, trials, ALPHA)
        assessed.append(
            {
                "facet_id": facet_id,
                "tier": facet["tier"],
                "probes": trials,
                "failures": misses,
                "blocked": blocked[facet_id],
                "miss_prob_upper_95": round(upper, 6),
                "residual_tier": _residual_tier(facet["tier"], upper),
            }
        )

    # Facets the plan never selected a probe for cannot be assessed at all, and they are the
    # most important thing in this report — so they are reported separately rather than
    # averaged into a number that would hide them.
    untested = sorted(facet_id for facet_id in facets if probes[facet_id] == 0)
    worst = [
        item["facet_id"]
        for item in sorted(
            assessed,
            key=lambda item: (-item["miss_prob_upper_95"], -item["tier"], item["facet_id"]),
        )[:10]
    ]

    total_probes = sum(item["probes"] for item in assessed)
    total_failures = sum(item["failures"] for item in assessed)
    assessed_facets = [item for item in assessed if item["probes"] > 0]
    mean_upper = (
        round(
            sum(item["miss_prob_upper_95"] for item in assessed_facets) / len(assessed_facets),
            6,
        )
        if assessed_facets
        else 0.0
    )

    return {
        "plan_id": plan_id,
        "facets": assessed,
        "untested": untested,
        "worst": worst,
        "totals": {
            "facets": len(facets),
            "selected_probes": len(selected),
            "probes_recorded": total_probes,
            "failures": total_failures,
            "untested": len(untested),
            "mean_miss_prob_upper_95": mean_upper,
        },
    }
