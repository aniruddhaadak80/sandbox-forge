"""Shared fixtures: small taxonomies with known structure, so tests state only what matters."""

from __future__ import annotations

from typing import Any

import pytest


def pytest_addoption(parser: pytest.Parser) -> None:
    """Registered so `--update-golden` is a real flag rather than a usage error."""
    parser.addoption(
        "--update-golden",
        action="store_true",
        default=False,
        help="rewrite the golden files under tests/golden instead of comparing against them",
    )


def facet(identifier: str, tier: int, family: str = "core", weight: float | None = None) -> dict[str, Any]:
    return {
        "id": identifier,
        "label": identifier.replace(".", " ").replace("-", " ").title(),
        "tier": tier,
        "family": family,
        "weight": float(tier) if weight is None else weight,
    }


def case(identifier: str, covers: list[str], tier: int) -> dict[str, Any]:
    return {"id": identifier, "label": identifier.upper(), "tier": tier, "covers": covers}


@pytest.fixture
def small_taxonomy() -> dict[str, Any]:
    """Four facets, four probes, and one facet no probe can reach.

    The unreachable facet is deliberate: it is the case the product exists to surface, so it
    belongs in almost every test.
    """
    return {
        "version": "1.0.0",
        "name": "test-baseline",
        "facets": [
            facet("cyber.exfiltration", 5, "cyber"),
            facet("cyber.persistence", 4, "cyber"),
            facet("bio.assist", 5, "bio"),
            facet("deception.compliance", 4, "deception"),
        ],
        "cases": [
            case("probe-001", ["cyber.exfiltration", "cyber.persistence"], 5),
            case("probe-002", ["bio.assist"], 5),
            # Declared tier 5 because it touches a tier-5 facet — declaring 4 would be the
            # TIER_UNDERSTATED defect the linter exists to catch.
            case("probe-003", ["deception.compliance", "cyber.exfiltration"], 5),
            # probe-004 covers only facets already covered by 001/003: provably redundant, and
            # deliberately overstated in tier so the warning path is exercised too.
            case("probe-004", ["cyber.persistence"], 5),
        ],
    }


@pytest.fixture
def reachable_taxonomy() -> dict[str, Any]:
    """The same shape, but every facet is reachable — a taxonomy a plan can fully cover."""
    return {
        "version": "1.0.0",
        "name": "test-closed",
        "facets": [
            facet("cyber.exfiltration", 5, "cyber"),
            facet("cyber.persistence", 4, "cyber"),
            facet("bio.assist", 3, "bio"),
        ],
        "cases": [
            case("probe-001", ["cyber.exfiltration"], 5),
            case("probe-002", ["cyber.persistence"], 4),
            case("probe-003", ["bio.assist"], 3),
        ],
    }
