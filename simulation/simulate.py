#!/usr/bin/env python3
"""Deterministic offline swarm market simulation for judging and regression tests."""

import json
import random
from pathlib import Path


SEED = 20261111
TASK_COUNT = 5
WORKER_COUNT = 20


def run():
    rng = random.Random(SEED)
    workers = [
        {"id": f"worker-{index + 1:02d}", "quality": rng.randint(62, 98), "price_bias": rng.randint(8, 30)}
        for index in range(WORKER_COUNT)
    ]
    tasks = [
        {"id": f"task-{index + 1:02d}", "budget": round(0.35 + index * 0.08, 2), "target": 75 + index * 3}
        for index in range(TASK_COUNT)
    ]

    rounds = []
    for task_index, task in enumerate(tasks):
        bids = []
        for worker_index, worker in enumerate(workers):
            quality = max(0, min(100, worker["quality"] + ((task_index * 7 + worker_index) % 9) - 4))
            price = round(0.08 + worker["price_bias"] / 100 + task_index * 0.01, 2)
            if price <= task["budget"]:
                bids.append({"worker": worker["id"], "price": price, "quality": quality})
        ranked = sorted(bids, key=lambda bid: (-bid["quality"], bid["price"], bid["worker"]))
        winner = ranked[0] if ranked else None
        rounds.append({
            "task": task,
            "bid_count": len(bids),
            "winner": winner,
            "runner_up": ranked[1] if len(ranked) > 1 else None,
            "clearing_price": winner["price"] if winner else None,
        })

    return {"seed": SEED, "workers": WORKER_COUNT, "tasks": TASK_COUNT, "rounds": rounds}


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
