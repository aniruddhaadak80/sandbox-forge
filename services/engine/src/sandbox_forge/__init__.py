"""Deterministic engine for sandbox-forge.

The engine is deliberately dependency-free. Every operation is a pure function:
same input, same output, no clock, no network, no randomness. Time and any entropy
must be passed in by the caller.
"""

from .analysis import OPERATIONS, analyse
from .assessment import assess_exposure
from .merge import merge_taxonomies
from .planner import plan_coverage
from .protocol import EngineError, dispatch
from .stats import clopper_pearson_upper
from .taxonomy import digest, lint_taxonomy, parse_taxonomy

__all__ = [
    "EngineError",
    "dispatch",
    "OPERATIONS",
    "analyse",
    "assess_exposure",
    "clopper_pearson_upper",
    "digest",
    "lint_taxonomy",
    "merge_taxonomies",
    "parse_taxonomy",
    "plan_coverage",
]
__version__ = "0.1.0"
