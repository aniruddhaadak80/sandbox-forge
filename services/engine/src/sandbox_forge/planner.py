"""The planner: which probes to run, and — more importantly — what will still be untested.

This is the part of the product that must never be a model call. Choosing a probe suite is a
combinatorial decision with a correctness property ("every declared facet is either covered by
a selected probe or named in `uncovered`"), and a language model can produce a plausible-looking
list that quietly fails exactly that property. So the algorithm is written out, and its output
carries a digest so two independent runs can be compared byte for byte.

The selection rule is risk-weighted greedy set cover:

1. score each remaining probe by the total weight of the facets it would newly cover, where a
   facet's weight defaults to its tier — so one tier-5 facet outranks three tier-1 facets;
2. take the highest score;
3. tie-break on the tighter probe (fewer total covers), then on a seeded digest of the probe id.

The seeded tie-break is what makes `seed` mean something: two seeds can produce two different
equally valid suites, while each one is exactly reproducible. Nothing else in the planner is
random, and there is no clock and no filesystem anywhere in this module.
"""

from __future__ import annotations

import hashlib
from typing import Any, Final

from .protocol import EngineError
from .taxonomy import digest, facet_map, parse_taxonomy
from .types import (
    ALGORITHM,
    ENGINE_NAME,
    CoveragePlan,
    CoverageSummary,
    Facet,
    SelectedCase,
    Taxonomy,
    TierCoverage,
)

_ROUND: Final[int] = 6


def _round(value: float) -> float:
    return round(value, _ROUND)


def _tiebreak(seed: int, case_id: str) -> str:
    """A stable, seed-dependent sort key. sha256 rather than hash() because Python's str hash
    is randomised per process, which would silently break reproducibility across runs."""
    return hashlib.sha256(f"{seed}:{case_id}".encode()).hexdigest()


def _validate_budget(payload: dict[str, Any]) -> int:
    budget = payload.get("budget")
    if isinstance(budget, bool) or not isinstance(budget, int):
        raise EngineError("BAD_BUDGET", "budget must be an integer")
    if budget < 0:
        raise EngineError("BAD_BUDGET", f"budget must be >= 0, got {budget}")
    return budget


def _validate_seed(payload: dict[str, Any]) -> int:
    seed = payload.get("seed", 0)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise EngineError("BAD_SEED", "seed must be an integer")
    return seed


def _coverage_summary(facets: list[Facet], covered: set[str]) -> CoverageSummary:
    total = len(facets)
    hits = sum(1 for facet in facets if facet["id"] in covered)

    by_tier: list[TierCoverage] = []
    for tier in sorted({facet["tier"] for facet in facets}):
        tier_facets = [facet for facet in facets if facet["tier"] == tier]
        tier_covered = sum(1 for facet in tier_facets if facet["id"] in covered)
        by_tier.append(
            {
                "tier": tier,
                "facets": len(tier_facets),
                "covered": tier_covered,
                "ratio": _round(tier_covered / len(tier_facets)) if tier_facets else 0.0,
            }
        )

    return {
        "facets": total,
        "covered": hits,
        "ratio": _round(hits / total) if total else 0.0,
        "by_tier": by_tier,
    }


def _weight(facet: Facet) -> float:
    return float(facet["weight"])


def _taxonomy_digest(taxonomy: Taxonomy) -> str:
    """A digest over the semantic content of a taxonomy.

    Deliberately excludes cosmetic fields: a plan certificate should not change because someone
    added a probe label, but it must change the moment a facet, a tier or a weight moves.
    """
    return digest(
        {
            "name": taxonomy["name"],
            "version": taxonomy["version"],
            "facets": sorted(
                (
                    {
                        "id": facet["id"],
                        "label": facet["label"],
                        "tier": facet["tier"],
                        "family": facet["family"],
                        "weight": facet["weight"],
                    }
                    for facet in taxonomy["facets"]
                ),
                key=lambda item: item["id"],
            ),
            "cases": sorted(
                (
                    {"id": case["id"], "tier": case["tier"], "covers": sorted(case["covers"])}
                    for case in taxonomy["cases"]
                ),
                key=lambda item: item["id"],
            ),
        }
    )


def _prepare(payload: Any) -> tuple[Taxonomy, int, int, dict[str, Facet]]:
    """Validate the request and resolve the facet lookup the selection loop needs."""
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "input must be an object")
    budget = _validate_budget(payload)
    seed = _validate_seed(payload)

    taxonomy: Taxonomy = parse_taxonomy(payload.get("taxonomy"))
    if not taxonomy["facets"]:
        raise EngineError("EMPTY_TAXONOMY", "a plan over zero facets certifies nothing")

    facets = facet_map(taxonomy)
    unknown = sorted(
        {
            facet_id
            for case in taxonomy["cases"]
            for facet_id in case["covers"]
            if facet_id not in facets
        }
    )
    if unknown:
        raise EngineError(
            "UNKNOWN_FACET",
            f"case(s) reference facets that are not declared: {', '.join(unknown)}",
        )
    return taxonomy, budget, seed, facets


def plan_coverage(payload: Any) -> CoveragePlan:
    """Select a probe suite of at most `budget` probes and certify what it does not cover."""
    taxonomy, budget, seed, facets = _prepare(payload)

    # A case that lists the same facet twice would double-count its own score.
    candidates: list[tuple[str, frozenset[str]]] = []
    seen: set[str] = set()
    for case in taxonomy["cases"]:
        if case["id"] in seen:
            continue
        seen.add(case["id"])
        candidates.append((case["id"], frozenset(case["covers"])))

    remaining = {facet["id"] for facet in taxonomy["facets"]}
    sizes = {case_id: len(covers) for case_id, covers in candidates}

    selected: list[SelectedCase] = []
    available = list(candidates)

    while len(selected) < budget:
        best_key: tuple[float, int, str] | None = None
        best_id = ""
        best_new: frozenset[str] = frozenset()

        for case_id, covers in available:
            new_facets = covers & remaining
            if not new_facets:
                continue
            # Sum in a canonical order so floating-point weights cannot make the score depend
            # on set iteration order.
            gain = sum(_weight(facets[facet_id]) for facet_id in sorted(new_facets))
            key = (-gain, sizes[case_id], _tiebreak(seed, case_id))
            if best_key is None or key < best_key:
                best_key = key
                best_id = case_id
                best_new = new_facets

        if best_key is None:
            break

        selected.append(
            {
                "case_id": best_id,
                "rank": len(selected) + 1,
                "gain": _round(-best_key[0]),
                "new_facets": sorted(best_new),
            }
        )
        remaining -= best_new
        available = [(case_id, covers) for case_id, covers in available if case_id != best_id]

    # "Budget exhausted" means the budget stopped the plan while coverage was still possible —
    # not merely that the loop ran out of candidates.
    budget_exhausted = (
        len(selected) >= budget
        and bool(remaining)
        and any(covers & remaining for _, covers in available)
    )

    covered = {facet["id"] for facet in taxonomy["facets"]} - remaining

    # A probe is redundant exactly when adding it would change nothing: every facet it covers
    # is already covered by the selection. That is a provable statement, not a heuristic.
    chosen = {item["case_id"] for item in selected}
    redundant = [case_id for case_id, covers in candidates if case_id not in chosen and covers <= covered]

    taxonomy_digest = _taxonomy_digest(taxonomy)

    body: dict[str, Any] = {
        "algorithm": ALGORITHM,
        "generator": ENGINE_NAME,
        "plan_id": f"{taxonomy_digest[:8]}-b{budget}-s{seed}",
        "seed": seed,
        "budget": budget,
        "taxonomy_name": taxonomy["name"],
        "taxonomy_version": taxonomy["version"],
        "taxonomy_digest": taxonomy_digest,
        "selected": selected,
        "redundant": sorted(redundant),
        "uncovered": sorted(remaining),
        "coverage": _coverage_summary(taxonomy["facets"], covered),
        "budget_exhausted": budget_exhausted,
    }
    plan: CoveragePlan = {**body, "certificate_digest": digest(body)}  # type: ignore[typeddict-item]
    return plan


def selected_ids(plan: CoveragePlan) -> list[str]:
    """The selected probe ids, in rank order. Shared with the assessment step."""
    return [item["case_id"] for item in plan["selected"]]
