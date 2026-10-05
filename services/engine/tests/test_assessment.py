"""The assessment step: turning recorded outcomes into a bound on residual risk."""

from __future__ import annotations

from typing import Any

import pytest

from sandbox_forge.assessment import assess_exposure
from sandbox_forge.planner import plan_coverage
from sandbox_forge.protocol import EngineError
from sandbox_forge.stats import clopper_pearson_upper


def test_unprobed_facets_are_reported_separately(reachable_taxonomy: dict[str, Any]) -> None:
    """A facet nobody probed must never be averaged into the score — it is the whole risk."""
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": []})
    assert report["untested"] == ["bio.assist", "cyber.exfiltration", "cyber.persistence"]
    assert report["totals"]["probes_recorded"] == 0
    for facet_report in report["facets"]:
        assert facet_report["miss_prob_upper_95"] == 1.0


def test_clean_probes_still_leave_a_positive_bound(reachable_taxonomy: dict[str, Any]) -> None:
    """The product's core honesty claim: zero observed failures is not zero risk."""
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    outcomes = [
        {"caseId": "probe-001", "facetId": "cyber.exfiltration", "blocked": True, "passed": True},
        {"caseId": "probe-002", "facetId": "cyber.persistence", "blocked": True, "passed": True},
        {"caseId": "probe-003", "facetId": "bio.assist", "blocked": True, "passed": True},
    ]
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": outcomes})
    assert report["untested"] == []
    for facet_report in report["facets"]:
        assert facet_report["failures"] == 0
        assert 0.0 < facet_report["miss_prob_upper_95"] <= 1.0
        assert facet_report["miss_prob_upper_95"] == pytest.approx(
            clopper_pearson_upper(0, facet_report["probes"]), abs=1e-6
        )


def test_a_failed_probe_raises_the_bound(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    outcomes = [{"caseId": "probe-001", "facetId": "cyber.exfiltration",
                 "blocked": False, "passed": False}]
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": outcomes})
    exfiltration = next(f for f in report["facets"] if f["facet_id"] == "cyber.exfiltration")
    assert exfiltration["failures"] == 1
    # One probe, and it failed: the exact bound is 1.0, because a single observation cannot
    # rule out a high miss rate. That is the point — a normal approximation would say 0.95 here
    # and quietly understate the risk.
    assert exfiltration["miss_prob_upper_95"] == 1.0
    assert exfiltration["blocked"] == 0


def test_residual_tier_never_falls_below_the_declared_tier_when_evidence_is_weak(
    reachable_taxonomy: dict[str, Any],
) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    outcomes = [{"caseId": "probe-001", "facetId": "cyber.exfiltration",
                 "blocked": False, "passed": False}]
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": outcomes})
    exfiltration = next(f for f in report["facets"] if f["facet_id"] == "cyber.exfiltration")
    # tier 5 with a failure keeps its full weight.
    assert exfiltration["residual_tier"] == 5


def test_strong_evidence_lowers_the_residual_tier(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    outcomes = [
        {"caseId": "probe-001", "facetId": "cyber.exfiltration", "blocked": True, "passed": True}
        for _ in range(30)
    ]
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": outcomes})
    exfiltration = next(f for f in report["facets"] if f["facet_id"] == "cyber.exfiltration")
    assert exfiltration["probes"] == 30
    assert exfiltration["miss_prob_upper_95"] < 0.1
    assert exfiltration["residual_tier"] < 5


def test_worst_first_ordering_puts_unprobed_facets_at_the_top(reachable_taxonomy: dict[str, Any]) -> None:
    """An untested facet has a bound of 1.0 — literally nothing known — so it must outrank any
    tested facet. If it did not, the report would bury the largest risk in the file."""
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    outcomes = [
        {"caseId": "probe-001", "facetId": "cyber.exfiltration", "blocked": True, "passed": True},
        {"caseId": "probe-003", "facetId": "bio.assist", "blocked": False, "passed": False},
    ]
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": outcomes})
    assert report["worst"][0] in set(report["untested"])
    assert "cyber.exfiltration" == report["worst"][-1]


def test_blocked_probes_are_counted(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    outcomes = [{"caseId": "probe-002", "facetId": "cyber.persistence",
                 "blocked": True, "passed": False}]
    report = assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan, "outcomes": outcomes})
    persistence = next(f for f in report["facets"] if f["facet_id"] == "cyber.persistence")
    assert persistence["blocked"] == 1
    assert persistence["failures"] == 1


def test_rejects_an_outcome_for_an_unknown_facet(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    with pytest.raises(EngineError) as caught:
        assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan,
                         "outcomes": [{"caseId": "probe-001", "facetId": "nope",
                                       "blocked": True, "passed": True}]})
    assert caught.value.code == "UNKNOWN_FACET"


def test_rejects_an_outcome_for_an_unknown_case(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    with pytest.raises(EngineError) as caught:
        assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan,
                         "outcomes": [{"caseId": "probe-999", "facetId": "bio.assist",
                                       "blocked": True, "passed": True}]})
    assert caught.value.code == "UNKNOWN_CASE"


def test_rejects_non_boolean_outcome_fields(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    with pytest.raises(EngineError) as caught:
        assess_exposure({"taxonomy": reachable_taxonomy, "plan": plan,
                         "outcomes": [{"caseId": "probe-001", "facetId": "bio.assist",
                                       "blocked": "yes", "passed": True}]})
    assert caught.value.code == "BAD_SHAPE"
