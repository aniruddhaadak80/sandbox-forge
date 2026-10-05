"""The confidence bounds, checked against something independent.

A wrong confidence bound would not crash anything — it would just make every number in the
product quietly wrong, which is the worst possible failure mode. So these tests compare the
continued-fraction evaluation against a separate power-series evaluation, and check the one
case with a closed-form answer.
"""

from __future__ import annotations

import math

import pytest

from sandbox_forge.stats import (
    beta_quantile,
    clopper_pearson_upper,
    regularised_incomplete_beta,
    regularised_incomplete_beta_series,
)


@pytest.mark.parametrize(
    ("x", "a", "b"),
    [
        (0.1, 1.0, 1.0),
        (0.5, 2.0, 5.0),
        (0.3, 6.0, 5.0),
        (0.02, 21.0, 14.0),
        (0.6, 9.0, 3.0),
    ],
)
def test_continued_fraction_agrees_with_series(x: float, a: float, b: float) -> None:
    """Two unrelated derivations of I_x must agree. Restricted to x <= 0.6 because the series
    converges slowly as x approaches 1 — above that the closed forms below are the check."""
    fraction = regularised_incomplete_beta(x, a, b)
    series = regularised_incomplete_beta_series(x, a, b)
    assert fraction == pytest.approx(series, abs=1e-10)


@pytest.mark.parametrize("x", [0.1, 0.25, 0.5, 0.75, 0.9, 0.99])
@pytest.mark.parametrize("a", [1.0, 2.0, 4.0, 11.0])
def test_matches_the_closed_form_when_b_is_one(x: float, a: float) -> None:
    """Beta(a, 1) has the power density a*x**(a-1), so its CDF is exactly x**a."""
    assert regularised_incomplete_beta(x, a, 1.0) == pytest.approx(x**a, abs=1e-10)


@pytest.mark.parametrize("x", [0.1, 0.25, 0.5, 0.75, 0.9, 0.99])
@pytest.mark.parametrize("b", [1.0, 2.0, 4.0, 11.0])
def test_matches_the_closed_form_when_a_is_one(x: float, b: float) -> None:
    """Beta(1, b) has density b*(1-x)**(b-1), so its CDF is 1 - (1-x)**b."""
    assert regularised_incomplete_beta(x, 1.0, b) == pytest.approx(1.0 - (1.0 - x) ** b, abs=1e-10)


@pytest.mark.parametrize("x", [0.05, 0.3, 0.5, 0.77, 0.95])
@pytest.mark.parametrize(("a", "b"), [(2.0, 5.0), (6.0, 5.0), (11.0, 2.0), (40.0, 3.0)])
def test_complement_identity_holds(x: float, a: float, b: float) -> None:
    """I_x(a, b) + I_{1-x}(b, a) == 1 for every a, b. This is the check that works across the
    whole domain, including x near 1, where the series is unusable."""
    assert regularised_incomplete_beta(x, a, b) + regularised_incomplete_beta(
        1.0 - x, b, a
    ) == pytest.approx(1.0, abs=1e-10)


def test_incomplete_beta_is_the_probability_integral() -> None:
    """I_x(1, 1) == x exactly: the beta(1,1) density is uniform on [0, 1]."""
    for x in (0.1, 0.25, 0.5, 0.75, 0.9):
        assert regularised_incomplete_beta(x, 1.0, 1.0) == pytest.approx(x, abs=1e-12)


def test_incomplete_beta_endpoints() -> None:
    assert regularised_incomplete_beta(0.0, 2.0, 3.0) == 0.0
    assert regularised_incomplete_beta(1.0, 2.0, 3.0) == 1.0


def test_beta_quantile_inverts_the_cdf() -> None:
    for p in (0.05, 0.25, 0.5, 0.75, 0.95):
        x = beta_quantile(p, 3.0, 7.0)
        assert regularised_incomplete_beta(x, 3.0, 7.0) == pytest.approx(p, abs=1e-9)


def test_beta_quantile_rejects_impossible_probabilities() -> None:
    for bad in (0.0, 1.0, -0.1, 1.4):
        with pytest.raises(ValueError):
            beta_quantile(bad, 2.0, 2.0)


def test_clopper_pearson_zero_failures_matches_closed_form() -> None:
    """With no observed failures the exact bound is 1 - alpha**(1/n); this checks we take that
    branch rather than approximating it."""
    for trials in (1, 5, 10, 100):
        expected = 1.0 - 0.05 ** (1.0 / trials)
        assert clopper_pearson_upper(0, trials) == pytest.approx(expected, abs=1e-12)


def test_clopper_pearson_all_failures_is_certain() -> None:
    for trials in (1, 4, 40):
        assert clopper_pearson_upper(trials, trials) == 1.0


def test_clopper_pearson_no_probes_learns_nothing() -> None:
    assert clopper_pearson_upper(0, 0) == 1.0


def test_clopper_pearson_upper_is_the_beta_quantile() -> None:
    """The interior case must equal the (1 - alpha) quantile of Beta(k+1, n-k) — a different code
    path from the closed forms used at the edges, so this catches a sign or argument error."""
    for trials in (10, 25, 60):
        for successes in range(1, trials):
            expected = beta_quantile(
                0.95, float(successes) + 1.0, float(trials - successes)
            )
            assert clopper_pearson_upper(successes, trials) == pytest.approx(expected, abs=1e-9)


def test_clopper_pearson_upper_rises_with_more_failures() -> None:
    """Monotone in k, which is the property that makes the number usable for ranking."""
    trials = 40
    bounds = [clopper_pearson_upper(k, trials) for k in range(trials + 1)]
    # strict=False is deliberate: the point is to pair each element with the one after it.
    assert all(a < b for a, b in zip(bounds, bounds[1:], strict=False))


def test_clopper_pearson_upper_widens_with_more_trials() -> None:
    """More evidence about a clean facet must give a strictly better bound."""
    bounds = [clopper_pearson_upper(0, n) for n in (2, 5, 10, 50, 200)]
    assert all(a > b for a, b in zip(bounds, bounds[1:], strict=False))


def test_clopper_pearson_rejects_impossible_counts() -> None:
    with pytest.raises(ValueError):
        clopper_pearson_upper(3, 2)
    with pytest.raises(ValueError):
        clopper_pearson_upper(-1, 5)
    with pytest.raises(ValueError):
        clopper_pearson_upper(0, -5)
    with pytest.raises(ValueError):
        clopper_pearson_upper(0, 5, alpha=0.0)


def test_bounds_stay_a_probability() -> None:
    for trials in range(0, 30):
        for successes in range(0, trials + 1):
            bound = clopper_pearson_upper(successes, trials)
            assert 0.0 < bound <= 1.0
            assert math.isfinite(bound)
