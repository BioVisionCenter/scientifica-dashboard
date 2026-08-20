"""Counting-game score: rewards accuracy steeply, speed gently.

Both factors are normalized by the patch's true count, so small and large
patches play on the same scale:
- accuracy uses the RELATIVE error (10% off costs the same everywhere)
- speed budgets SECONDS_PER_CELL per cell (a 25-cell sheet is expected to
  be ~4x faster than a 110-cell sheet)

score = 1000 * exp(-|guess - true| / (0.1 * true)) * exp(-t / (SECONDS_PER_CELL * true))
"""

import math

SECONDS_PER_CELL = 1.0


def compute_score(guess: int, true_count: int, time_seconds: float) -> int:
    accuracy = math.exp(-abs(guess - true_count) / (0.1 * true_count))
    speed = math.exp(-time_seconds / (SECONDS_PER_CELL * true_count))
    return round(1000.0 * accuracy * speed)
