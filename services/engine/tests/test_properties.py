"""Property tests for the invariants that make a certificate worth anything.

Unit tests check the cases someone thought of. These check the claims: determinism, the
cover-or-admit partition, budget monotonicity, and the fact that bounds stay probabilities no
matter what nonsense the taxonomy contains.
"""

from __future__ import annotations

from typing import Any

from hypothesis import given, settings
from hypothesis import strategies as st

from sandbox_forge.assessment import assess_exposure
from sandbox_forge.planner import plan_coverage
from sandbox_forge.stats import clopper_pearson_upper

IDS = st.from_regex(r"\A[a-z][a-z0-9]{0,5}\Z", fullmatch=True)
TIERS = st.integers(min_value=1, max_value=5)


@st.composite
def taxonomies(draw: Any) -> dict[str, Any]:
    """Arbitrary but *valid* taxonomies: unique ids, every cover target declared."""
    facet_ids = draw(st.lists(IDS, min_size=1, max_size=8, unique=True))
    facets = [
        {
            "id": identifier,
            "label": f"Facet {identifier}",
            "tier": draw(TIERS),
            "family": "generated",
            "weight": float(draw(TIERS)),
        }
        for identifier in facet_ids
    ]
    case_count = draw(st.integers(min_value=0, max_value=8))
    cases = []
    for index in range(case_count):
        covers = draw(
            st.lists(
                st.sampled_from(facet_ids), min_size=1, max_size=len(facet_ids), unique=True
            )
        )
        cases.append(
            {
                "id": f"probe-{index}",
                "label": f"Probe {index}",
                "tier": draw(TIERS),
                "covers": covers,
            }
        )
    return {
        "version": draw(st.sampled_from(["1.0.0", "2.0.0"])),
        "name": "generated",
        "facets": facets,
        "cases": cases,
    }


@given(taxonomy=taxonomies(), budget=st.integers(min_value=0, max_value=12), seed=st.integers())
@settings(max_examples=200, deadline=None)
def test_plan_is_deterministic(taxonomy: dict[str, Any], budget: int, seed: int) -> None:
    first = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
    second = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
    assert first == second
    assert first["certificate_digest"] == second["certificate_digest"]


@given(taxonomy=taxonomies(), budget=st.integers(min_value=0, max_value=12), seed=st.integers())
@settings(max_examples=200, deadline=None)
def test_every_facet_is_covered_or_admitted_as_uncovered(
    taxonomy: dict[str, Any], budget: int, seed: int
) -> None:
    """The central claim. A facet can never fall between the two lists."""
    plan = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
    covered = {facet for item in plan["selected"] for facet in item["new_facets"]}
    declared = {facet["id"] for facet in taxonomy["facets"]}
    uncovered = set(plan["uncovered"])

    assert covered | uncovered == declared
    assert not (covered & uncovered)
    assert not (covered - declared)
    assert not (uncovered - declared)


@given(taxonomy=taxonomies(), budget=st.integers(min_value=0, max_value=12), seed=st.integers())
@settings(max_examples=200, deadline=None)
def test_budget_is_never_exceeded(taxonomy: dict[str, Any], budget: int, seed: int) -> None:
    plan = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
    assert len(plan["selected"]) <= budget


@given(taxonomy=taxonomies(), seed=st.integers())
@settings(max_examples=100, deadline=None)
def test_more_budget_never_reduces_coverage(taxonomy: dict[str, Any], seed: int) -> None:
    """Monotonicity: a bigger budget can only help. If it ever does not, the greedy
    tie-breaking is unstable and the certificate cannot be trusted."""
    previous = -1.0
    for budget in range(0, 10):
        plan = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
        assert plan["coverage"]["covered"] >= previous
        previous = float(plan["coverage"]["covered"])


@given(taxonomy=taxonomies(), budget=st.integers(min_value=0, max_value=12), seed=st.integers())
@settings(max_examples=200, deadline=None)
def test_redundant_probes_cannot_add_coverage(
    taxonomy: dict[str, Any], budget: int, seed: int
) -> None:
    """Every probe called redundant is provably redundant, or the word is a lie."""
    plan = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
    covered = {facet for item in plan["selected"] for facet in item["new_facets"]}
    by_id = {case["id"]: set(case["covers"]) for case in taxonomy["cases"]}
    selected = {item["case_id"] for item in plan["selected"]}
    for case_id in plan["redundant"]:
        assert case_id not in selected
        assert by_id[case_id] <= covered


@given(
    successes=st.integers(min_value=0, max_value=50),
    trials=st.integers(min_value=0, max_value=50),
)
@settings(max_examples=300, deadline=None)
def test_confidence_bounds_are_probabilities(successes: int, trials: int) -> None:
    if successes > trials:
        return
    bound = clopper_pearson_upper(successes, trials)
    assert 0.0 < bound <= 1.0


@given(
    successes=st.integers(min_value=0, max_value=50),
    trials=st.integers(min_value=1, max_value=50),
)
@settings(max_examples=200, deadline=None)
def test_confidence_bounds_shrink_with_evidence(successes: int, trials: int) -> None:
    if successes > trials:
        return
    wide = clopper_pearson_upper(successes, trials)
    narrow = clopper_pearson_upper(successes, trials * 4)
    assert narrow <= wide


@given(taxonomy=taxonomies(), budget=st.integers(min_value=0, max_value=8), seed=st.integers())
@settings(max_examples=100, deadline=None)
def test_assessment_reports_every_facet_and_keeps_bounds_sane(
    taxonomy: dict[str, Any], budget: int, seed: int
) -> None:
    plan = plan_coverage({"taxonomy": taxonomy, "budget": budget, "seed": seed})
    report = assess_exposure({"taxonomy": taxonomy, "plan": plan, "outcomes": []})

    assert {item["facet_id"] for item in report["facets"]} == {
        facet["id"] for facet in taxonomy["facets"]
    }
    for item in report["facets"]:
        assert 0.0 < item["miss_prob_upper_95"] <= 1.0
        assert 1 <= item["residual_tier"] <= 5
        assert item["residual_tier"] <= item["tier"]
    assert set(report["untested"]) == {item["facet_id"] for item in report["facets"]}
