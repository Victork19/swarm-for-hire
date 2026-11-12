#!/usr/bin/env python3
"""Deterministic offline swarm market simulation for judging and regression tests."""

import json
import hashlib
import random


SEED = 20261111
TASK_COUNT = 5
BUYER_COUNT = 20
WORKER_COUNT = 5


def run():
    rng = random.Random(SEED)
    buyers = [
        {"id": f"buyer-{index + 1:02d}", "budget": round(0.35 + index * 0.02, 2)}
        for index in range(BUYER_COUNT)
    ]
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
                commitment = hashlib.sha256(
                    f"{task['id']}|{worker['id']}|{price:.2f}|{quality}".encode("utf-8")
                ).hexdigest()
                bids.append({
                    "worker": worker["id"],
                    "price": price,
                    "quality": quality,
                    "commitment": commitment,
                })
        ranked = sorted(bids, key=lambda bid: (-bid["quality"], bid["price"], bid["worker"]))
        winner = ranked[0] if ranked else None
        rounds.append({
            "round": task_index + 1,
            "task": task,
            "buyer_count": BUYER_COUNT,
            "worker_count": WORKER_COUNT,
            "sealed_bid_count": WORKER_COUNT,
            "revealed_bid_count": len(bids),
            "bid_count": len(bids),
            "winner": winner,
            "runner_up": ranked[1] if len(ranked) > 1 else None,
            "clearing_price": winner["price"] if winner else None,
        })

    return {
        "seed": SEED,
        "buyers": BUYER_COUNT,
        "workers": WORKER_COUNT,
        "tasks": TASK_COUNT,
        "rounds": rounds,
    }


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
