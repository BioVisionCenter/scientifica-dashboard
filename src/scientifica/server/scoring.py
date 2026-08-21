"""Counting-game score: rewards accuracy steeply, speed gently.

Both factors are normalized by the round's true count, so small and large
images play on the same scale:
- accuracy uses the RELATIVE error (being 10% off costs the same everywhere)
- speed budgets tau seconds per cell (a 25-cell round is expected to be
  ~4x faster than a 110-cell round)

score = max_score * exp(-|guess - true| / (sigma * true)) * exp(-t / (tau * true))

The parameters live in scientifica.toml ([scoring]) and are re-read on edit.
With the defaults (sigma=0.2, tau=6.0): a perfect 100/100 in 30 s scores 951;
136 vs 140 in 50 s scores ~817.
"""

import math

from scientifica.server import runtime_config


def compute_score(guess: int, true_count: int, time_seconds: float) -> int:
    s = runtime_config.get()["scoring"]
    accuracy = math.exp(-abs(guess - true_count) / (s["sigma"] * true_count))
    speed = math.exp(-time_seconds / (s["tau"] * true_count))
    return round(s["max_score"] * accuracy * speed)
