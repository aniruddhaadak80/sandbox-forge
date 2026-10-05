"""Exact binomial confidence bounds, implemented from first principles.

The product's credibility rests on these numbers, so they are computed exactly rather than
approximated: Clopper-Pearson bounds are the inversion of the regularised incomplete beta
function, which we evaluate with a continued fraction and invert by bisection. No SciPy, no
sampling, no seeded randomness — the same inputs always give the same bound to the last bit.

Two independent evaluations of the beta function (continued fraction and power series) are
cross-checked against each other in the tests, because a silently wrong confidence bound
would make every number in this product a lie.
"""

from __future__ import annotations

import math

#: Iterations are a fixed count, not a convergence race, so the result cannot depend on
#: floating-point luck or machine timing.
_BISECTION_STEPS = 200
_EPSILON = 1.0e-15
_TINY = 1.0e-300


def _log_beta(a: float, b: float) -> float:
    """ln B(a, b) via lgamma. Stable for the ranges a facet count can produce."""
    return math.lgamma(a) + math.lgamma(b) - math.lgamma(a + b)


def _betacf(a: float, b: float, x: float) -> float:
    """Continued fraction for the incomplete beta function (modified Lentz's method)."""
    qab = a + b
    qap = a + 1.0
    qam = a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    if abs(d) < _TINY:
        d = _TINY
    d = 1.0 / d
    h = d

    for m in range(1, 301):
        m2 = 2 * m
        aa = m * (b - m) * x / ((qam + m2) * (a + m2))
        d = 1.0 + aa * d
        if abs(d) < _TINY:
            d = _TINY
        c = 1.0 + aa / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        h *= d * c

        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
        d = 1.0 + aa * d
        if abs(d) < _TINY:
            d = _TINY
        c = 1.0 + aa / c
        if abs(c) < _TINY:
            c = _TINY
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < _EPSILON:
            break

    return h


def regularised_incomplete_beta(x: float, a: float, b: float) -> float:
    """The regularised incomplete beta function I_x(a, b), in [0, 1]."""
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0

    front = math.exp(a * math.log(x) + b * math.log1p(-x) - _log_beta(a, b))

    # The continued fraction converges quickly only on one side of the crossover point, so
    # the identity I_x(a,b) = 1 - I_{1-x}(b,a) is used to stay on the fast side.
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _betacf(a, b, x) / a
    return 1.0 - front * _betacf(b, a, 1.0 - x) / b


def regularised_incomplete_beta_series(x: float, a: float, b: float) -> float:
    """I_x(a, b) by the hypergeometric series — slow near x = 1, and kept only to cross-check.

    This is an independent derivation from the continued fraction, so agreement between the
    two is real evidence rather than the same code counted twice. It converges quickly only
    for small x, which is why the tests use it on a restricted range and use the closed forms
    elsewhere.

        I_x(a, b) = x^a / B(a, b) * SUM_n [ (1-b)_n / n! * x^n / (a + n) ]
    """
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0

    front = math.exp(a * math.log(x) - _log_beta(a, b))
    t_n = 1.0
    total = 1.0 / a
    for n in range(1, 1001):
        t_n *= ((n - b) * x) / n
        total += t_n / (a + n)
        if abs(t_n / (a + n)) < abs(total) * _EPSILON:
            break
    return front * total


def beta_quantile(p: float, a: float, b: float) -> float:
    """Inverse of I_x(a, b): the x where I_x(a, b) == p. Monotone, so plain bisection is exact
    enough and, unlike a Newton iteration, cannot run away."""
    if not 0.0 < p < 1.0:
        raise ValueError(f"p must be in (0, 1), got {p}")
    if a <= 0.0 or b <= 0.0:
        raise ValueError("a and b must be positive")

    low = 0.0
    high = 1.0
    for _ in range(_BISECTION_STEPS):
        mid = (low + high) / 2.0
        if regularised_incomplete_beta(mid, a, b) < p:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


def clopper_pearson_upper(successes: int, trials: int, alpha: float = 0.05) -> float:
    """Exact upper (1 - alpha) confidence bound on a binomial probability.

    `successes` counts the events of interest — for this product, probes that FAILED to hold
    the boundary — and `trials` counts every probe run against the facet.

    Edge cases are treated as facts rather than as arithmetic accidents:

    * no probes at all -> 1.0. Nothing was learned, so nothing may be claimed.
    * every probe failed -> 1.0.
    * no probe failed -> still a positive bound. Zero observed failures is not proof of zero
      risk, and reporting 0.0 here is exactly the lie this product exists to prevent.
    """
    if trials < 0:
        raise ValueError(f"trials must be >= 0, got {trials}")
    if successes < 0 or successes > trials:
        raise ValueError(f"successes must be in [0, {trials}], got {successes}")
    if not 0.0 < alpha < 1.0:
        raise ValueError(f"alpha must be in (0, 1), got {alpha}")

    if trials == 0:
        return 1.0
    if successes == trials:
        return 1.0
    if successes == 0:
        # Closed form: the exact bound for zero observed successes. Used directly because it
        # is both exact and far cheaper than inverting the beta function. math.pow rather than
        # `**`, because typeshed types float.__pow__ as Any (it can yield complex).
        return 1.0 - math.pow(alpha, 1.0 / trials)

    return beta_quantile(1.0 - alpha, float(successes) + 1.0, float(trials - successes))
