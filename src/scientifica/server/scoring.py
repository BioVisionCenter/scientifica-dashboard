"""Counting-game score: rewards accuracy steeply, speed gently.

score = 1000 * exp(-|guess - true| / (0.1 * true)) * exp(-t / 90)
"""

import math


def compute_score(guess: int, true_count: int, time_seconds: float) -> int:
    accuracy = math.exp(-abs(guess - true_count) / (0.1 * true_count))
    speed = math.exp(-time_seconds / 90.0)
    return round(1000.0 * accuracy * speed)
