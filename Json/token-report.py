#!/usr/bin/env python3
"""ALEX Token Usage Report — Analyses API token logs and estimates costs."""

import json
import os
import sys
from datetime import datetime
from collections import defaultdict
from pathlib import Path

TOKENS_DIR = Path("/home/head/.alex/logs/tokens")
REPORT_OUT = Path("/home/head/navada-1/Json/TOKEN-REPORT.txt")

# Also check the older logs in parent dir
LOGS_DIR = Path("/home/head/.alex/logs")

# Pricing per 1M tokens (input/output)
PRICING = {
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.00, "label": "Haiku 3.5"},
    "claude-3-haiku-20240307":   {"input": 0.25, "output": 1.25, "label": "Haiku 3"},
    "claude-sonnet-4-20250514":  {"input": 3.00, "output": 15.00, "label": "Sonnet 4"},
    "claude-sonnet-4-5-20250929":{"input": 3.00, "output": 15.00, "label": "Sonnet 4.5"},
    "deepseek-chat":             {"input": 0.14, "output": 0.28, "label": "DeepSeek"},
    "gpt-4o":                    {"input": 2.50, "output": 10.00, "label": "GPT-4o"},
    "gpt-5.2":                   {"input": 2.50, "output": 10.00, "label": "GPT-5.2"},
}

DEFAULT_PRICING = {"input": 3.00, "output": 15.00, "label": "Unknown"}


def load_all_logs():
    """Load all .jsonl token log files."""
    entries = []
    files = []

    # Collect from tokens/ subdir
    if TOKENS_DIR.exists():
        files.extend(sorted(TOKENS_DIR.glob("tokens_*.jsonl")))

    # Collect from parent logs/ dir (older format)
    for f in sorted(LOGS_DIR.glob("tokens_*.jsonl")):
        if f not in files:
            files.append(f)

    for f in sorted(files):
        with open(f, "r") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    return entries


def estimate_cost(model, input_tokens, output_tokens):
    """Estimate USD cost for a single API call."""
    p = PRICING.get(model, DEFAULT_PRICING)
    return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


def model_label(model):
    p = PRICING.get(model)
    return p["label"] if p else model[:30]


def generate_report(entries):
    """Generate the full report."""
    lines = []
    w = lines.append

    # --- Aggregate data ---
    daily = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    by_model = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    by_source = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    by_task = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    hourly = defaultdict(int)

    total_input = 0
    total_output = 0
    total_cost = 0.0
    total_calls = 0

    for e in entries:
        ts = e.get("timestamp", "")
        model = e.get("model", "unknown")
        inp = e.get("input_tokens", 0)
        out = e.get("output_tokens", 0)
        source = e.get("source", "user")
        task = e.get("taskName", "")

        cost = estimate_cost(model, inp, out)

        # Daily
        day = ts[:10] if ts else "unknown"
        daily[day]["input"] += inp
        daily[day]["output"] += out
        daily[day]["calls"] += 1
        daily[day]["cost"] += cost

        # By model
        by_model[model]["input"] += inp
        by_model[model]["output"] += out
        by_model[model]["calls"] += 1
        by_model[model]["cost"] += cost

        # By source
        by_source[source]["input"] += inp
        by_source[source]["output"] += out
        by_source[source]["calls"] += 1
        by_source[source]["cost"] += cost

        # By task
        if task:
            by_task[task]["input"] += inp
            by_task[task]["output"] += out
            by_task[task]["calls"] += 1
            by_task[task]["cost"] += cost

        # Hourly (today only)
        today = datetime.now().strftime("%Y-%m-%d")
        if ts.startswith(today):
            hour = ts[11:13] if len(ts) > 13 else "00"
            hourly[hour] += 1

        total_input += inp
        total_output += out
        total_cost += cost
        total_calls += 1

    # --- Build report ---
    now = datetime.now().strftime("%A %d %B %Y, %H:%M:%S")
    first_day = min(daily.keys()) if daily else "n/a"
    last_day = max(daily.keys()) if daily else "n/a"
    num_days = len(daily)

    w("=" * 80)
    w("  ALEX TOKEN USAGE REPORT")
    w(f"  Generated: {now}")
    w(f"  Period: {first_day} to {last_day} ({num_days} days)")
    w("=" * 80)
    w("")

    # --- Totals ---
    w("  TOTALS")
    w("  " + "-" * 70)
    w(f"  API calls:      {total_calls:,}")
    w(f"  Input tokens:   {total_input:,}")
    w(f"  Output tokens:  {total_output:,}")
    w(f"  Total tokens:   {total_input + total_output:,}")
    w(f"  Est. cost:      ${total_cost:.2f}")
    if num_days > 0:
        w(f"  Avg/day:        ${total_cost / num_days:.2f}/day  |  {total_calls // num_days} calls/day")
    w("")

    # --- Daily breakdown ---
    w("  DAILY BREAKDOWN")
    w("  " + "-" * 70)
    w(f"  {'DATE':<14} {'CALLS':>7} {'INPUT':>10} {'OUTPUT':>10} {'TOTAL':>10} {'COST':>9}")
    w(f"  {'----':<14} {'-----':>7} {'-----':>10} {'------':>10} {'-----':>10} {'----':>9}")
    for day in sorted(daily.keys()):
        d = daily[day]
        tot = d["input"] + d["output"]
        w(f"  {day:<14} {d['calls']:>7,} {d['input']:>10,} {d['output']:>10,} {tot:>10,} ${d['cost']:>7.2f}")
    w("")

    # --- By model ---
    w("  BY MODEL")
    w("  " + "-" * 70)
    w(f"  {'MODEL':<22} {'CALLS':>7} {'INPUT':>10} {'OUTPUT':>10} {'COST':>9} {'%COST':>7}")
    w(f"  {'-----':<22} {'-----':>7} {'-----':>10} {'------':>10} {'----':>9} {'-----':>7}")
    for model in sorted(by_model.keys(), key=lambda m: by_model[m]["cost"], reverse=True):
        d = by_model[model]
        pct = (d["cost"] / total_cost * 100) if total_cost > 0 else 0
        w(f"  {model_label(model):<22} {d['calls']:>7,} {d['input']:>10,} {d['output']:>10,} ${d['cost']:>7.2f} {pct:>6.1f}%")
    w("")

    # --- By source ---
    w("  BY SOURCE")
    w("  " + "-" * 70)
    w(f"  {'SOURCE':<22} {'CALLS':>7} {'TOKENS':>12} {'COST':>9}")
    w(f"  {'------':<22} {'-----':>7} {'------':>12} {'----':>9}")
    for src in sorted(by_source.keys(), key=lambda s: by_source[s]["cost"], reverse=True):
        d = by_source[src]
        w(f"  {src:<22} {d['calls']:>7,} {d['input']+d['output']:>12,} ${d['cost']:>7.2f}")
    w("")

    # --- By scheduled task ---
    if by_task:
        w("  BY SCHEDULED TASK")
        w("  " + "-" * 70)
        w(f"  {'TASK':<32} {'CALLS':>7} {'TOKENS':>12} {'COST':>9}")
        w(f"  {'----':<32} {'-----':>7} {'------':>12} {'----':>9}")
        for task in sorted(by_task.keys(), key=lambda t: by_task[t]["cost"], reverse=True):
            d = by_task[task]
            w(f"  {task:<32} {d['calls']:>7,} {d['input']+d['output']:>12,} ${d['cost']:>7.2f}")
        w("")

    # --- Hourly activity (today) ---
    if hourly:
        w("  TODAY'S HOURLY ACTIVITY")
        w("  " + "-" * 70)
        max_calls = max(hourly.values()) if hourly else 1
        for h in range(24):
            hh = f"{h:02d}"
            count = hourly.get(hh, 0)
            bar = "#" * int(count / max_calls * 40) if max_calls > 0 else ""
            if count > 0:
                w(f"  {hh}:00  {bar:<40} {count}")
        w("")

    w("=" * 80)
    w("  END OF REPORT")
    w("=" * 80)

    return "\n".join(lines)


def main():
    entries = load_all_logs()
    if not entries:
        print("No token logs found.")
        sys.exit(1)

    report = generate_report(entries)

    # Write to file
    with open(REPORT_OUT, "w") as f:
        f.write(report + "\n")

    # Also print to stdout
    print(report)
    print(f"\nSaved to: {REPORT_OUT}")


if __name__ == "__main__":
    main()
