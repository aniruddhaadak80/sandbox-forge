"""Merging taxonomies: every disagreement has to be visible."""

from __future__ import annotations

from typing import Any

from sandbox_forge.merge import merge_taxonomies


def base(name: str = "left") -> dict[str, Any]:
    return {
        "version": "1.0.0",
        "name": name,
        "facets": [{"id": "a.one", "label": "A one", "tier": 3, "family": "x", "weight": 3.0}],
        "cases": [{"id": "c.1", "label": "C1", "tier": 3, "covers": ["a.one"]}],
    }


def test_merges_disjoint_taxonomies() -> None:
    right = base("right")
    right["facets"].append(
        {"id": "b.one", "label": "B one", "tier": 4, "family": "y", "weight": 4.0}
    )
    right["cases"].append({"id": "c.2", "label": "C2", "tier": 4, "covers": ["b.one"]})

    result = merge_taxonomies({"left": base(), "right": right})
    assert result["added_facets"] == ["b.one"]
    assert result["added_cases"] == ["c.2"]
    assert result["conflicts"] == []
    assert result["merged"]["name"] == "left+right"


def test_reports_a_tier_disagreement_and_keeps_the_left_value() -> None:
    right = base("right")
    right["facets"][0]["tier"] = 5
    result = merge_taxonomies({"left": base(), "right": right})
    assert [conflict["kind"] for conflict in result["conflicts"]] == ["facet-tier"]
    kept = next(f for f in result["merged"]["facets"] if f["id"] == "a.one")
    assert kept["tier"] == 3


def test_reports_a_label_disagreement() -> None:
    right = base("right")
    right["facets"][0]["label"] = "Totally different"
    result = merge_taxonomies({"left": base(), "right": right})
    assert any(conflict["kind"] == "facet-label" for conflict in result["conflicts"])


def test_reports_a_case_covering_different_facets() -> None:
    right = base("right")
    right["facets"].append(
        {"id": "b.one", "label": "B one", "tier": 3, "family": "y", "weight": 3.0}
    )
    right["cases"][0]["covers"] = ["a.one", "b.one"]
    result = merge_taxonomies({"left": base(), "right": right})
    assert any(conflict["kind"] == "case-covers" for conflict in result["conflicts"])
    kept = next(c for c in result["merged"]["cases"] if c["id"] == "c.1")
    assert kept["covers"] == ["a.one"]


def test_merged_output_is_sorted_and_deduplicated() -> None:
    right = base("right")
    right["facets"].append({"id": "a.zero", "label": "A zero", "tier": 1,
                            "family": "x", "weight": 1.0})
    result = merge_taxonomies({"left": base(), "right": right})
    ids = [facet["id"] for facet in result["merged"]["facets"]]
    assert ids == sorted(ids)
    assert len(ids) == len(set(ids))
