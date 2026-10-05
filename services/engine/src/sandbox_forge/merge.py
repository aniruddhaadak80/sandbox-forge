"""Merging two capability taxonomies.

Alignment groups publish their facet lists in incompatible shapes: same capability, different id
spelling; same id, different risk tier; one taxonomy that simply knows about a family the other
has never heard of. Merging is where those disagreements have to surface, because a silent
merge is how a capability ends up counted once at tier 3 and once at tier 5 and nobody notices
which number won.

So `merge_taxonomies` never picks a winner silently. Where the two sides disagree it emits a
conflict and keeps the left-hand value, and the caller decides.
"""

from __future__ import annotations

from typing import Any

from .protocol import EngineError
from .taxonomy import parse_taxonomy
from .types import Facet, MergeConflict, MergeResult, ProbeCase, Taxonomy


def _merge_facets(
    left: list[Facet], right: list[Facet], conflicts: list[MergeConflict]
) -> tuple[list[Facet], list[str]]:
    by_id = {facet["id"]: facet for facet in left}
    added: list[str] = []

    for facet in right:
        existing = by_id.get(facet["id"])
        if existing is None:
            by_id[facet["id"]] = facet
            added.append(facet["id"])
            continue

        if existing["tier"] != facet["tier"]:
            conflicts.append(
                {
                    "kind": "facet-tier",
                    "id": facet["id"],
                    "left": str(existing["tier"]),
                    "right": str(facet["tier"]),
                    "message": (
                        f"facet {facet['id']!r} is tier {existing['tier']} on the left and "
                        f"{facet['tier']} on the right; kept {existing['tier']}"
                    ),
                }
            )
        if existing["label"] != facet["label"]:
            conflicts.append(
                {
                    "kind": "facet-label",
                    "id": facet["id"],
                    "left": existing["label"],
                    "right": facet["label"],
                    "message": (
                        f"facet {facet['id']!r} has two labels; kept {existing['label']!r}"
                    ),
                }
            )

    return sorted(by_id.values(), key=lambda facet: facet["id"]), sorted(added)


def _merge_cases(
    left: list[ProbeCase], right: list[ProbeCase], conflicts: list[MergeConflict]
) -> tuple[list[ProbeCase], list[str]]:
    by_id = {case["id"]: case for case in left}
    added: list[str] = []

    for case in right:
        existing = by_id.get(case["id"])
        if existing is None:
            by_id[case["id"]] = case
            added.append(case["id"])
            continue

        if sorted(existing["covers"]) != sorted(case["covers"]):
            conflicts.append(
                {
                    "kind": "case-covers",
                    "id": case["id"],
                    "left": ",".join(sorted(existing["covers"])),
                    "right": ",".join(sorted(case["covers"])),
                    "message": (
                        f"case {case['id']!r} covers different facets on each side; "
                        "kept the left-hand definition"
                    ),
                }
            )

    return sorted(by_id.values(), key=lambda case: case["id"]), sorted(added)


def merge_taxonomies(payload: Any) -> MergeResult:
    """Union two taxonomies, reporting every disagreement instead of resolving one silently."""
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "input must be an object")

    left: Taxonomy = parse_taxonomy(payload.get("left"))
    right: Taxonomy = parse_taxonomy(payload.get("right"))

    conflicts: list[MergeConflict] = []
    facets, added_facets = _merge_facets(left["facets"], right["facets"], conflicts)
    cases, added_cases = _merge_cases(left["cases"], right["cases"], conflicts)

    merged: Taxonomy = {
        # The name records that this is a merge, so a certificate produced from it can never be
        # mistaken for a certificate from either input.
        "name": f"{left['name']}+{right['name']}",
        "version": f"{left['version']}+{right['version']}",
        "facets": facets,
        "cases": cases,
    }

    return {
        "merged": merged,
        "conflicts": conflicts,
        "added_facets": added_facets,
        "added_cases": added_cases,
    }
