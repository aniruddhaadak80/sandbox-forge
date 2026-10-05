"""Taxonomy parsing, validation, canonicalisation and digests.

A taxonomy is the product's input of record: the facets a probe suite must exercise and the
probes available to exercise them. Everything downstream is a function of it, so it is
validated strictly and hashed — two labs that declare the same taxonomy can prove it, because
the digest is over a canonical byte representation, not over whatever key order they happened
to serialise.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any, Final, cast

from .protocol import EngineError
from .types import (
    ID_PATTERN,
    MAX_TIER,
    MIN_TIER,
    Facet,
    LintResult,
    ProbeCase,
    Taxonomy,
    TaxonomyIssue,
    Tier,
)

_ID_RE: Final[re.Pattern[str]] = re.compile(ID_PATTERN)


def canonical_json(value: Any) -> str:
    """Stable JSON: sorted keys, no insignificant whitespace, UTF-8 preserved.

    Every digest in this product is taken over this form, so key order in the source file can
    never change a certificate.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def digest(value: Any) -> str:
    """sha256 over the canonical form, truncated to 16 hex chars for readability in a terminal."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()[:16]


def is_valid_id(value: str) -> bool:
    return bool(_ID_RE.match(value))


def _require_mapping(payload: Any, field: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"{field!r} must be an object")
    return payload


def _require_str(payload: dict[str, Any], key: str, where: str) -> str:
    value = payload.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EngineError("MISSING_FIELD", f"{where} is missing a non-empty {key!r}")
    return value


def _require_tier(payload: dict[str, Any], where: str) -> Tier:
    value = payload.get("tier")
    # bool is an int in Python; a taxonomy with tier: true is a bug, not a tier of 1.
    if isinstance(value, bool) or not isinstance(value, int):
        raise EngineError("BAD_TIER", f"{where}.tier must be an integer in {MIN_TIER}..{MAX_TIER}")
    if not MIN_TIER <= value <= MAX_TIER:
        raise EngineError("BAD_TIER", f"{where}.tier must be in {MIN_TIER}..{MAX_TIER}, got {value}")
    # The range check above is what makes this cast sound; Tier is Literal, so the only way to
    # satisfy the type checker is to assert the invariant that was just verified at runtime.
    return cast(Tier, value)


def _optional_str(payload: dict[str, Any], key: str, fallback: str) -> str:
    value = payload.get(key)
    if isinstance(value, str) and value.strip():
        return value
    return fallback


def _parse_facet(payload: Any, index: int) -> Facet:
    where = f"facets[{index}]"
    obj = _require_mapping(payload, where)
    identifier = _require_str(obj, "id", where)
    if not is_valid_id(identifier):
        raise EngineError("BAD_ID", f"{where}.id {identifier!r} must match {ID_PATTERN}")
    tier = _require_tier(obj, where)
    family = _optional_str(obj, "family", "unclassified")
    weight = obj.get("weight", float(tier))
    if isinstance(weight, bool) or not isinstance(weight, (int, float)):
        raise EngineError("BAD_WEIGHT", f"{where}.weight must be a number")
    if weight < 0:
        raise EngineError("BAD_WEIGHT", f"{where}.weight must be >= 0")

    return {
        "id": identifier,
        "label": _require_str(obj, "label", where),
        "tier": tier,
        "family": family,
        "weight": float(weight),
    }


def _parse_case(payload: Any, index: int) -> ProbeCase:
    where = f"cases[{index}]"
    obj = _require_mapping(payload, where)
    identifier = _require_str(obj, "id", where)
    if not is_valid_id(identifier):
        raise EngineError("BAD_ID", f"{where}.id {identifier!r} must match {ID_PATTERN}")

    covers = obj.get("covers")
    if not isinstance(covers, list) or not covers:
        raise EngineError("MISSING_FIELD", f"{where}.covers must be a non-empty array")
    parsed_covers: list[str] = []
    for position, facet_id in enumerate(covers):
        if not isinstance(facet_id, str) or not is_valid_id(facet_id):
            raise EngineError("BAD_ID", f"{where}.covers[{position}] must be a facet id")
        parsed_covers.append(facet_id)

    return {
        "id": identifier,
        "label": _optional_str(obj, "label", identifier),
        "tier": _require_tier(obj, where),
        "covers": parsed_covers,
    }


def parse_taxonomy(payload: Any) -> Taxonomy:
    """Parse and strictly validate a taxonomy. Raises EngineError with a stable code.

    This is the boundary, so it is the one place allowed to be defensive: everything after it
    can assume well-formed input.
    """
    obj = _require_mapping(payload, "taxonomy")
    facets_raw = obj.get("facets")
    cases_raw = obj.get("cases")
    if not isinstance(facets_raw, list):
        raise EngineError("MISSING_FIELD", "taxonomy.facets must be an array")
    if not isinstance(cases_raw, list):
        raise EngineError("MISSING_FIELD", "taxonomy.cases must be an array")

    facets = [_parse_facet(item, index) for index, item in enumerate(facets_raw)]
    cases = [_parse_case(item, index) for index, item in enumerate(cases_raw)]

    seen_facets: set[str] = set()
    for facet in facets:
        if facet["id"] in seen_facets:
            raise EngineError("DUPLICATE_ID", f"facet {facet['id']!r} is declared twice")
        seen_facets.add(facet["id"])

    seen_cases: set[str] = set()
    for case in cases:
        if case["id"] in seen_cases:
            raise EngineError("DUPLICATE_ID", f"case {case['id']!r} is declared twice")
        seen_cases.add(case["id"])

    version = obj.get("version", "0.0.0")
    name = obj.get("name", "untitled")
    if not isinstance(version, str):
        raise EngineError("BAD_SHAPE", "taxonomy.version must be a string")
    if not isinstance(name, str):
        raise EngineError("BAD_SHAPE", "taxonomy.name must be a string")

    return {"version": version, "name": name, "facets": facets, "cases": cases}


def facet_map(taxonomy: Taxonomy) -> dict[str, Facet]:
    return {facet["id"]: facet for facet in taxonomy["facets"]}


def case_map(taxonomy: Taxonomy) -> dict[str, ProbeCase]:
    return {case["id"]: case for case in taxonomy["cases"]}


#: Codes that make a taxonomy invalid. Everything else is advisory: a report that cries wolf
#: gets ignored, so only genuine blockers are allowed to fail a lint run.
ERROR_CODES: Final[frozenset[str]] = frozenset(
    {"UNKNOWN_FACET", "UNREACHABLE_FACET", "TIER_UNDERSTATED"}
)


def lint_taxonomy(taxonomy: Taxonomy) -> LintResult:
    """Report on a taxonomy without raising: what is broken and what is unreachable.

    Unreachable facets matter more than they look. A facet no probe covers cannot be covered
    by any plan, so it would silently inflate the denominator of every coverage ratio — the
    exact failure mode this product is built to make impossible to hide.

    Tier consistency is one-directional on purpose. A probe declared *below* the riskiest thing
    it touches is a real defect: it will sort as less important than it is. A probe declared
    above is merely conservative, and is reported as a warning without failing the lint.
    """
    issues: list[TaxonomyIssue] = []
    facets = facet_map(taxonomy)
    covered: set[str] = set()

    for case in taxonomy["cases"]:
        known = [facets[facet_id]["tier"] for facet_id in case["covers"] if facet_id in facets]
        for facet_id in case["covers"]:
            if facet_id not in facets:
                issues.append(
                    {
                        "code": "UNKNOWN_FACET",
                        "level": "error",
                        "where": f"case:{case['id']}",
                        "message": f"covers unknown facet {facet_id!r}",
                    }
                )
                continue
            covered.add(facet_id)

        if not known:
            continue
        riskiest = max(known)
        if case["tier"] < riskiest:
            issues.append(
                {
                    "code": "TIER_UNDERSTATED",
                    "level": "error",
                    "where": f"case:{case['id']}",
                    "message": (
                        f"declared tier {case['tier']} but covers a tier-{riskiest} facet; "
                        "a probe must never sort below the riskiest thing it exercises"
                    ),
                }
            )
        elif case["tier"] > riskiest:
            issues.append(
                {
                    "code": "TIER_OVERSTATED",
                    "level": "warning",
                    "where": f"case:{case['id']}",
                    "message": (
                        f"declared tier {case['tier']} but its riskiest facet is tier {riskiest}; "
                        "conservative, not wrong"
                    ),
                }
            )

    unreachable = sorted(set(facets) - covered)
    for facet_id in unreachable:
        issues.append(
            {
                "code": "UNREACHABLE_FACET",
                "level": "error",
                "where": f"facet:{facet_id}",
                "message": "no declared case covers this facet, so no plan can reach it",
            }
        )

    return {
        "ok": not any(issue["code"] in ERROR_CODES for issue in issues),
        "issues": issues,
        "facets": len(taxonomy["facets"]),
        "cases": len(taxonomy["cases"]),
        "reachable": len(covered & set(facets)),
        "unreachable": unreachable,
    }
