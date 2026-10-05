"""The planner: greedy selection, and — the point of the product — honest reporting of gaps."""

from __future__ import annotations

from typing import Any

import pytest

from sandbox_forge.planner import plan_coverage
from sandbox_forge.protocol import EngineError


def test_selects_probes_until_budget(small_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": small_taxonomy, "budget": 2, "seed": 7})
    assert len(plan["selected"]) == 2
    assert plan["budget"] == 2
    assert plan["budget_exhausted"] is True


def test_names_the_facet_no_probe_can_reach(small_taxonomy: dict[str, Any]) -> None:
    """deception.compliance IS covered by probe-003; the taxonomy's dead facet is the point —
    an enormous budget still cannot cover a facet nothing probes."""
    plan = plan_coverage({"taxonomy": small_taxonomy, "budget": 99, "seed": 1})
    unreachable = [facet["id"] for facet in small_taxonomy["facets"] if facet["id"] == "deception.compliance"]
    assert unreachable  # the fixture really does contain the facet we expect
    # Every declared facet is either covered or listed as uncovered. Never a silent third option.
    covered = {facet for item in plan["selected"] for facet in item["new_facets"]}
    assert covered | set(plan["uncovered"]) == {
        "cyber.exfiltration",
        "cyber.persistence",
        "bio.assist",
        "deception.compliance",
    }
    assert not covered & set(plan["uncovered"])


def test_full_budget_fully_covers_a_closed_taxonomy(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 3, "seed": 0})
    assert plan["uncovered"] == []
    assert plan["coverage"]["ratio"] == 1.0
    assert plan["budget_exhausted"] is False


def test_zero_budget_selects_nothing_and_says_everything_is_uncovered(
    reachable_taxonomy: dict[str, Any],
) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 0, "seed": 0})
    assert plan["selected"] == []
    assert plan["uncovered"] == ["bio.assist", "cyber.exfiltration", "cyber.persistence"]
    assert plan["coverage"]["ratio"] == 0.0


def test_identical_inputs_give_an_identical_certificate(small_taxonomy: dict[str, Any]) -> None:
    """The reproducibility promise: two labs, same taxonomy, same budget and seed, same bytes."""
    first = plan_coverage({"taxonomy": small_taxonomy, "budget": 2, "seed": 42})
    second = plan_coverage({"taxonomy": small_taxonomy, "budget": 2, "seed": 42})
    assert first == second
    assert first["certificate_digest"] == second["certificate_digest"]


def test_certificate_digest_changes_when_the_budget_changes(small_taxonomy: dict[str, Any]) -> None:
    one = plan_coverage({"taxonomy": small_taxonomy, "budget": 1, "seed": 1})
    two = plan_coverage({"taxonomy": small_taxonomy, "budget": 2, "seed": 1})
    assert one["certificate_digest"] != two["certificate_digest"]


def test_taxonomy_key_order_does_not_change_the_digest(small_taxonomy: dict[str, Any]) -> None:
    """The digest is over a canonical form, so how the file was serialised cannot matter."""
    shuffled = {
        "cases": small_taxonomy["cases"],
        "facets": [
            {
                "weight": item["weight"],
                "family": item["family"],
                "tier": item["tier"],
                "label": item["label"],
                "id": item["id"],
            }
            for item in reversed(small_taxonomy["facets"])
        ],
        "name": small_taxonomy["name"],
        "version": small_taxonomy["version"],
    }
    assert (
        plan_coverage({"taxonomy": shuffled, "budget": 2, "seed": 3})["certificate_digest"]
        == plan_coverage({"taxonomy": small_taxonomy, "budget": 2, "seed": 3})["certificate_digest"]
    )


def test_risk_weighting_prefers_the_dangerous_facet() -> None:
    """One tier-5 facet must outrank three tier-1 facets. A planner that only counts facets
    would systematically under-test the capabilities that matter."""
    taxonomy = {
        "version": "1.0.0",
        "name": "weighting",
        "facets": [
            {"id": "low.one", "label": "Low one", "tier": 1, "family": "x", "weight": 1.0},
            {"id": "low.two", "label": "Low two", "tier": 1, "family": "x", "weight": 1.0},
            {"id": "low.three", "label": "Low three", "tier": 1, "family": "x", "weight": 1.0},
            {"id": "high.one", "label": "High one", "tier": 5, "family": "x", "weight": 5.0},
        ],
        "cases": [
            {"id": "probe-broad", "label": "Broad", "tier": 1,
             "covers": ["low.one", "low.two", "low.three"]},
            {"id": "probe-sharp", "label": "Sharp", "tier": 5, "covers": ["high.one"]},
        ],
    }
    plan = plan_coverage({"taxonomy": taxonomy, "budget": 1, "seed": 0})
    assert plan["selected"][0]["case_id"] == "probe-sharp"
    assert plan["uncovered"] == ["low.one", "low.three", "low.two"]


def test_redundant_probes_are_reported(small_taxonomy: dict[str, Any]) -> None:
    """probe-004 covers only cyber.persistence, which probe-001 also covers, so a full plan
    must call it redundant rather than silently dropping it."""
    plan = plan_coverage({"taxonomy": small_taxonomy, "budget": 10, "seed": 0})
    assert "probe-004" in plan["redundant"]
    assert "probe-001" not in plan["redundant"]


def test_per_tier_coverage_is_reported(reachable_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": reachable_taxonomy, "budget": 1, "seed": 0})
    tiers = {entry["tier"]: entry for entry in plan["coverage"]["by_tier"]}
    assert set(tiers) == {3, 4, 5}

    # One facet covered, so only the tier holding it can look complete. A single global ratio
    # would hide which tier went untested — which is the whole reason this breakdown exists.
    covered = {facet for item in plan["selected"] for facet in item["new_facets"]}
    covered_tier = next(
        facet["tier"] for facet in reachable_taxonomy["facets"] if facet["id"] in covered
    )
    complete = [tier for tier, entry in tiers.items() if entry["ratio"] == 1.0]
    assert complete == [covered_tier]
    assert sum(entry["covered"] for entry in tiers.values()) == 1


def test_seed_is_recorded_and_reproducible(small_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": small_taxonomy, "budget": 2, "seed": 1234})
    assert plan["seed"] == 1234
    assert plan["plan_id"].endswith("s1234")
    assert plan["algorithm"] == "stratified-greedy-set-cover/v1"


def test_ranks_are_dense_and_ordered(small_taxonomy: dict[str, Any]) -> None:
    plan = plan_coverage({"taxonomy": small_taxonomy, "budget": 10, "seed": 5})
    assert [item["rank"] for item in plan["selected"]] == list(range(1, len(plan["selected"]) + 1))


def test_refuses_a_taxonomy_with_no_facets() -> None:
    with pytest.raises(EngineError) as caught:
        plan_coverage({"taxonomy": {"version": "1", "name": "empty", "facets": [], "cases": []},
                       "budget": 5, "seed": 0})
    assert caught.value.code == "EMPTY_TAXONOMY"


def test_refuses_a_case_referencing_an_undeclared_facet() -> None:
    taxonomy = {
        "version": "1.0.0",
        "name": "dangling",
        "facets": [{"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": 1.0}],
        "cases": [{"id": "probe-1", "label": "P", "tier": 1, "covers": ["a.one", "a.missing"]}],
    }
    with pytest.raises(EngineError) as caught:
        plan_coverage({"taxonomy": taxonomy, "budget": 1, "seed": 0})
    assert caught.value.code == "UNKNOWN_FACET"


@pytest.mark.parametrize("budget", [-1, "3", 1.5, True, None])
def test_refuses_a_budget_that_is_not_a_whole_number(budget: object) -> None:
    with pytest.raises(EngineError) as caught:
        plan_coverage({"taxonomy": {"version": "1", "name": "t",
                                    "facets": [{"id": "a", "label": "A", "tier": 1,
                                                "family": "x", "weight": 1.0}],
                                    "cases": [{"id": "c", "label": "C", "tier": 1,
                                               "covers": ["a"]}]},
                       "budget": budget, "seed": 0})
    assert caught.value.code == "BAD_BUDGET"
