"""The operation registry — the whole engine's public surface, in one table.

Every entry is a pure function of its input. Adding an operation here is the only way to make
something callable from the TypeScript side, which is what keeps the boundary honest: there is
no way to reach the engine that bypasses this table.
"""

from __future__ import annotations

from typing import Any, Final

from .assessment import assess_exposure
from .merge import merge_taxonomies
from .planner import plan_coverage
from .protocol import EngineError
from .taxonomy import lint_taxonomy, parse_taxonomy

#: A tiny wrapper for `lint_taxonomy` so every entry point takes one argument, like the others.
def lint(payload: Any) -> Any:
    return lint_taxonomy(parse_taxonomy(payload.get("taxonomy") if isinstance(payload, dict) else payload))


OPERATIONS: Final[dict[str, Any]] = {
    "plan_coverage": plan_coverage,
    "assess_exposure": assess_exposure,
    "merge_taxonomies": merge_taxonomies,
    "lint_taxonomy": lint,
}


def analyse(op: str, payload: Any) -> Any:
    handler = OPERATIONS.get(op)
    if handler is None:
        known = ", ".join(sorted(OPERATIONS))
        raise EngineError("UNKNOWN_OP", f"unknown op {op!r}; available: {known}")
    return handler(payload)
