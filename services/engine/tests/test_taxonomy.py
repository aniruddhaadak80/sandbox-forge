"""Taxonomy validation and the lint report."""

from __future__ import annotations

from typing import Any

import pytest

from sandbox_forge.protocol import EngineError
from sandbox_forge.taxonomy import canonical_json, digest, is_valid_id, lint_taxonomy, parse_taxonomy


def test_parses_a_well_formed_taxonomy(small_taxonomy: dict[str, Any]) -> None:
    parsed = parse_taxonomy(small_taxonomy)
    assert parsed["name"] == "test-baseline"
    assert len(parsed["facets"]) == 4
    assert len(parsed["cases"]) == 4


def test_weight_defaults_to_the_tier() -> None:
    parsed = parse_taxonomy({
        "version": "1.0.0",
        "name": "defaults",
        "facets": [{"id": "a.one", "label": "A", "tier": 4, "family": "x"}],
        "cases": [{"id": "c.1", "label": "C", "tier": 4, "covers": ["a.one"]}],
    })
    assert parsed["facets"][0]["weight"] == 4.0


@pytest.mark.parametrize("identifier", ["ok", "a.b", "a-b", "a.b-c", "x1.y2", "1a"])
def test_accepts_valid_identifiers(identifier: str) -> None:
    assert is_valid_id(identifier) is True


@pytest.mark.parametrize(
    "identifier", ["", "A.b", "a..b", ".a", "a.", "a b", "a/b", "a_b.c!", "-a"]
)
def test_rejects_invalid_identifiers(identifier: str) -> None:
    assert is_valid_id(identifier) is False


def test_rejects_a_duplicate_facet_id() -> None:
    with pytest.raises(EngineError) as caught:
        parse_taxonomy({
            "version": "1", "name": "dupe",
            "facets": [
                {"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": 1.0},
                {"id": "a.one", "label": "Again", "tier": 2, "family": "x", "weight": 1.0},
            ],
            "cases": [],
        })
    assert caught.value.code == "DUPLICATE_ID"


def test_rejects_a_duplicate_case_id() -> None:
    with pytest.raises(EngineError) as caught:
        parse_taxonomy({
            "version": "1", "name": "dupe",
            "facets": [{"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": 1.0}],
            "cases": [
                {"id": "c.1", "label": "C", "tier": 1, "covers": ["a.one"]},
                {"id": "c.1", "label": "C again", "tier": 1, "covers": ["a.one"]},
            ],
        })
    assert caught.value.code == "DUPLICATE_ID"


@pytest.mark.parametrize("tier", [0, 6, -1, "3", 2.5, True, None])
def test_rejects_an_out_of_range_tier(tier: object) -> None:
    with pytest.raises(EngineError) as caught:
        parse_taxonomy({
            "version": "1", "name": "tier",
            "facets": [{"id": "a.one", "label": "A", "tier": tier, "family": "x", "weight": 1.0}],
            "cases": [],
        })
    assert caught.value.code == "BAD_TIER"


def test_rejects_a_negative_weight() -> None:
    with pytest.raises(EngineError) as caught:
        parse_taxonomy({
            "version": "1", "name": "w",
            "facets": [{"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": -1.0}],
            "cases": [],
        })
    assert caught.value.code == "BAD_WEIGHT"


def test_rejects_a_case_with_no_coverage() -> None:
    with pytest.raises(EngineError) as caught:
        parse_taxonomy({
            "version": "1", "name": "empty-case",
            "facets": [{"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": 1.0}],
            "cases": [{"id": "c.1", "label": "C", "tier": 1, "covers": []}],
        })
    assert caught.value.code == "MISSING_FIELD"


def test_lint_passes_a_consistent_taxonomy(small_taxonomy: dict[str, Any]) -> None:
    result = lint_taxonomy(parse_taxonomy(small_taxonomy))
    assert result["unreachable"] == []
    assert result["reachable"] == result["facets"]
    assert result["ok"] is True
    assert not [issue for issue in result["issues"] if issue["level"] == "error"]


def test_lint_reports_a_facet_nothing_probes() -> None:
    result = lint_taxonomy(parse_taxonomy({
        "version": "1", "name": "gap",
        "facets": [{"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": 1.0},
                   {"id": "a.two", "label": "B", "tier": 2, "family": "x", "weight": 2.0}],
        "cases": [{"id": "c.1", "label": "C", "tier": 1, "covers": ["a.one"]}],
    }))
    assert result["unreachable"] == ["a.two"]
    assert result["ok"] is False
    assert any(issue["code"] == "UNREACHABLE_FACET" for issue in result["issues"])


def test_lint_reports_a_case_referencing_an_unknown_facet() -> None:
    result = lint_taxonomy(parse_taxonomy({
        "version": "1", "name": "dangling",
        "facets": [{"id": "a.one", "label": "A", "tier": 1, "family": "x", "weight": 1.0}],
        "cases": [{"id": "c.1", "label": "C", "tier": 1, "covers": ["a.one", "a.ghost"]}],
    }))
    assert any(issue["code"] == "UNKNOWN_FACET" for issue in result["issues"])
    assert result["ok"] is False


def test_lint_fails_a_probe_declared_below_the_risk_it_touches() -> None:
    """The asymmetry is the point: understated is a defect, overstated is only conservative."""
    understated = lint_taxonomy(parse_taxonomy({
        "version": "1", "name": "understated",
        "facets": [{"id": "a.one", "label": "A", "tier": 5, "family": "x", "weight": 5.0}],
        "cases": [{"id": "c.1", "label": "C", "tier": 1, "covers": ["a.one"]}],
    }))
    assert any(issue["code"] == "TIER_UNDERSTATED" for issue in understated["issues"])
    assert understated["ok"] is False

    overstated = lint_taxonomy(parse_taxonomy({
        "version": "1", "name": "overstated",
        "facets": [{"id": "a.one", "label": "A", "tier": 2, "family": "x", "weight": 2.0}],
        "cases": [{"id": "c.1", "label": "C", "tier": 5, "covers": ["a.one"]}],
    }))
    assert any(issue["code"] == "TIER_OVERSTATED" for issue in overstated["issues"])
    assert overstated["ok"] is True


def test_issues_carry_a_level(small_taxonomy: dict[str, Any]) -> None:
    result = lint_taxonomy(parse_taxonomy(small_taxonomy))
    assert all(issue["level"] in {"error", "warning"} for issue in result["issues"])


def test_canonical_json_is_order_independent() -> None:
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})
    assert canonical_json({"a": 2, "b": 1}) == '{"a":2,"b":1}'


def test_digest_is_stable_across_key_order() -> None:
    assert digest({"a": 1, "b": [1, 2]}) == digest({"b": [1, 2], "a": 1})
    assert digest({"a": 1}) != digest({"a": 2})
