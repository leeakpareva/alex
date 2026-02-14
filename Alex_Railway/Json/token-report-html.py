#!/usr/bin/env python3
"""ALEX Token Usage Report — HTML version with charts."""

import json
import os
import sys
from datetime import datetime
from collections import defaultdict
from pathlib import Path

TOKENS_DIR = Path("/home/head/.alex/logs/tokens")
LOGS_DIR = Path("/home/head/.alex/logs")
REPORT_OUT = Path("/home/head/navada-1/Json/TOKEN-REPORT.html")

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
    entries = []
    files = []
    if TOKENS_DIR.exists():
        files.extend(sorted(TOKENS_DIR.glob("tokens_*.jsonl")))
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
    p = PRICING.get(model, DEFAULT_PRICING)
    return (input_tokens * p["input"] + output_tokens * p["output"]) / 1_000_000


def model_label(model):
    p = PRICING.get(model)
    return p["label"] if p else model.split("/")[-1][:25]


def generate_html(entries):
    daily = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    by_model = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    by_source = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    by_task = defaultdict(lambda: {"input": 0, "output": 0, "calls": 0, "cost": 0.0})
    hourly = defaultdict(int)

    total_input = total_output = total_calls = 0
    total_cost = 0.0

    for e in entries:
        ts = e.get("timestamp", "")
        model = e.get("model", "unknown")
        inp = e.get("input_tokens", 0)
        out = e.get("output_tokens", 0)
        source = e.get("source", "user")
        task = e.get("taskName", "")
        cost = estimate_cost(model, inp, out)

        day = ts[:10] if ts else "unknown"
        daily[day]["input"] += inp
        daily[day]["output"] += out
        daily[day]["calls"] += 1
        daily[day]["cost"] += cost

        by_model[model]["input"] += inp
        by_model[model]["output"] += out
        by_model[model]["calls"] += 1
        by_model[model]["cost"] += cost

        by_source[source]["input"] += inp
        by_source[source]["output"] += out
        by_source[source]["calls"] += 1
        by_source[source]["cost"] += cost

        if task:
            by_task[task]["input"] += inp
            by_task[task]["output"] += out
            by_task[task]["calls"] += 1
            by_task[task]["cost"] += cost

        today = datetime.now().strftime("%Y-%m-%d")
        if ts.startswith(today):
            hour = ts[11:13] if len(ts) > 13 else "00"
            hourly[hour] += 1

        total_input += inp
        total_output += out
        total_cost += cost
        total_calls += 1

    now = datetime.now().strftime("%A %d %B %Y, %H:%M")
    first_day = min(daily.keys()) if daily else "n/a"
    last_day = max(daily.keys()) if daily else "n/a"
    num_days = len(daily)
    avg_cost = total_cost / num_days if num_days > 0 else 0
    avg_calls = total_calls // num_days if num_days > 0 else 0

    # Chart data
    daily_labels = json.dumps(sorted(daily.keys()))
    daily_costs = json.dumps([round(daily[d]["cost"], 2) for d in sorted(daily.keys())])
    daily_calls = json.dumps([daily[d]["calls"] for d in sorted(daily.keys())])

    model_labels = json.dumps([model_label(m) for m in sorted(by_model.keys(), key=lambda m: by_model[m]["cost"], reverse=True)])
    model_costs = json.dumps([round(by_model[m]["cost"], 2) for m in sorted(by_model.keys(), key=lambda m: by_model[m]["cost"], reverse=True)])

    source_labels = json.dumps(sorted(by_source.keys(), key=lambda s: by_source[s]["cost"], reverse=True))
    source_costs = json.dumps([round(by_source[s]["cost"], 2) for s in sorted(by_source.keys(), key=lambda s: by_source[s]["cost"], reverse=True)])

    hourly_labels = json.dumps([f"{h:02d}:00" for h in range(24)])
    hourly_data = json.dumps([hourly.get(f"{h:02d}", 0) for h in range(24)])

    # Daily table rows
    daily_rows = ""
    for day in sorted(daily.keys()):
        d = daily[day]
        tot = d["input"] + d["output"]
        daily_rows += f"""<tr>
            <td>{day}</td><td>{d['calls']:,}</td>
            <td>{d['input']:,}</td><td>{d['output']:,}</td>
            <td>{tot:,}</td><td class="cost">${d['cost']:.2f}</td>
        </tr>"""

    # Model table rows
    model_rows = ""
    for model in sorted(by_model.keys(), key=lambda m: by_model[m]["cost"], reverse=True):
        d = by_model[model]
        pct = (d["cost"] / total_cost * 100) if total_cost > 0 else 0
        model_rows += f"""<tr>
            <td>{model_label(model)}</td><td>{d['calls']:,}</td>
            <td>{d['input']:,}</td><td>{d['output']:,}</td>
            <td class="cost">${d['cost']:.2f}</td><td>{pct:.1f}%</td>
        </tr>"""

    # Source table rows
    source_rows = ""
    for src in sorted(by_source.keys(), key=lambda s: by_source[s]["cost"], reverse=True):
        d = by_source[src]
        source_rows += f"""<tr>
            <td>{src}</td><td>{d['calls']:,}</td>
            <td>{d['input']+d['output']:,}</td><td class="cost">${d['cost']:.2f}</td>
        </tr>"""

    # Task table rows
    task_rows = ""
    for task in sorted(by_task.keys(), key=lambda t: by_task[t]["cost"], reverse=True):
        d = by_task[task]
        task_rows += f"""<tr>
            <td>{task}</td><td>{d['calls']:,}</td>
            <td>{d['input']+d['output']:,}</td><td class="cost">${d['cost']:.2f}</td>
        </tr>"""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ALEX Token Usage Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
<style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #0a0a0f;
        color: #e0e0e0;
        padding: 24px;
        max-width: 1200px;
        margin: 0 auto;
    }}
    h1 {{
        font-size: 28px;
        color: #fff;
        margin-bottom: 4px;
    }}
    .subtitle {{
        color: #888;
        font-size: 14px;
        margin-bottom: 32px;
    }}
    .cards {{
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 16px;
        margin-bottom: 32px;
    }}
    .card {{
        background: #151520;
        border: 1px solid #252535;
        border-radius: 12px;
        padding: 20px;
    }}
    .card .label {{
        font-size: 12px;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 1px;
        margin-bottom: 8px;
    }}
    .card .value {{
        font-size: 28px;
        font-weight: 700;
        color: #fff;
    }}
    .card .value.cost {{ color: #4ade80; }}
    .card .value.calls {{ color: #60a5fa; }}
    .card .value.tokens {{ color: #c084fc; }}
    .card .sub {{
        font-size: 12px;
        color: #666;
        margin-top: 4px;
    }}
    .charts {{
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 24px;
        margin-bottom: 32px;
    }}
    .chart-box {{
        background: #151520;
        border: 1px solid #252535;
        border-radius: 12px;
        padding: 20px;
    }}
    .chart-box h3 {{
        font-size: 15px;
        color: #ccc;
        margin-bottom: 16px;
    }}
    .chart-box canvas {{
        max-height: 280px;
    }}
    .full-width {{ grid-column: 1 / -1; }}
    h2 {{
        font-size: 18px;
        color: #fff;
        margin: 32px 0 16px;
        padding-bottom: 8px;
        border-bottom: 1px solid #252535;
    }}
    table {{
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 24px;
        font-size: 14px;
    }}
    th {{
        text-align: left;
        padding: 10px 12px;
        background: #151520;
        color: #888;
        font-weight: 600;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        border-bottom: 1px solid #252535;
    }}
    td {{
        padding: 10px 12px;
        border-bottom: 1px solid #1a1a28;
    }}
    tr:hover td {{
        background: #151520;
    }}
    td.cost {{
        color: #4ade80;
        font-weight: 600;
    }}
    .footer {{
        text-align: center;
        color: #555;
        font-size: 12px;
        margin-top: 48px;
        padding-top: 24px;
        border-top: 1px solid #252535;
    }}
    @media (max-width: 768px) {{
        .charts {{ grid-template-columns: 1fr; }}
        .cards {{ grid-template-columns: repeat(2, 1fr); }}
    }}
</style>
</head>
<body>

<h1>ALEX Token Usage Report</h1>
<p class="subtitle">Generated {now} &mdash; {first_day} to {last_day} ({num_days} days)</p>

<div class="cards">
    <div class="card">
        <div class="label">Total Cost</div>
        <div class="value cost">${total_cost:.2f}</div>
        <div class="sub">${avg_cost:.2f}/day avg</div>
    </div>
    <div class="card">
        <div class="label">API Calls</div>
        <div class="value calls">{total_calls:,}</div>
        <div class="sub">{avg_calls}/day avg</div>
    </div>
    <div class="card">
        <div class="label">Input Tokens</div>
        <div class="value tokens">{total_input:,}</div>
    </div>
    <div class="card">
        <div class="label">Output Tokens</div>
        <div class="value tokens">{total_output:,}</div>
    </div>
    <div class="card">
        <div class="label">Total Tokens</div>
        <div class="value tokens">{total_input + total_output:,}</div>
    </div>
</div>

<div class="charts">
    <div class="chart-box">
        <h3>Daily Cost ($)</h3>
        <canvas id="dailyCostChart"></canvas>
    </div>
    <div class="chart-box">
        <h3>Daily API Calls</h3>
        <canvas id="dailyCallsChart"></canvas>
    </div>
    <div class="chart-box">
        <h3>Cost by Model</h3>
        <canvas id="modelChart"></canvas>
    </div>
    <div class="chart-box">
        <h3>Cost by Source</h3>
        <canvas id="sourceChart"></canvas>
    </div>
    <div class="chart-box full-width">
        <h3>Today's Hourly Activity</h3>
        <canvas id="hourlyChart"></canvas>
    </div>
</div>

<h2>Daily Breakdown</h2>
<table>
    <tr><th>Date</th><th>Calls</th><th>Input</th><th>Output</th><th>Total</th><th>Cost</th></tr>
    {daily_rows}
</table>

<h2>By Model</h2>
<table>
    <tr><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Cost</th><th>% Cost</th></tr>
    {model_rows}
</table>

<h2>By Source</h2>
<table>
    <tr><th>Source</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr>
    {source_rows}
</table>

<h2>By Scheduled Task</h2>
<table>
    <tr><th>Task</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr>
    {task_rows}
</table>

<div class="footer">
    ALEX &mdash; Global Economist at NAVADA &mdash; Token Usage Report<br>
    Auto-generated by token-report-html.py
</div>

<script>
const chartFont = {{ family: "-apple-system, sans-serif", size: 11 }};
const gridColor = "rgba(255,255,255,0.06)";
const tickColor = "#666";
Chart.defaults.color = tickColor;
Chart.defaults.font = chartFont;

new Chart(document.getElementById("dailyCostChart"), {{
    type: "bar",
    data: {{
        labels: {daily_labels},
        datasets: [{{ label: "Cost ($)", data: {daily_costs},
            backgroundColor: "rgba(74,222,128,0.7)", borderRadius: 4 }}]
    }},
    options: {{ plugins: {{ legend: {{ display: false }} }},
        scales: {{ y: {{ grid: {{ color: gridColor }}, ticks: {{ callback: v => "$"+v }} }},
                   x: {{ grid: {{ display: false }} }} }} }}
}});

new Chart(document.getElementById("dailyCallsChart"), {{
    type: "bar",
    data: {{
        labels: {daily_labels},
        datasets: [{{ label: "Calls", data: {daily_calls},
            backgroundColor: "rgba(96,165,250,0.7)", borderRadius: 4 }}]
    }},
    options: {{ plugins: {{ legend: {{ display: false }} }},
        scales: {{ y: {{ grid: {{ color: gridColor }} }}, x: {{ grid: {{ display: false }} }} }} }}
}});

new Chart(document.getElementById("modelChart"), {{
    type: "doughnut",
    data: {{
        labels: {model_labels},
        datasets: [{{ data: {model_costs},
            backgroundColor: ["#4ade80","#60a5fa","#c084fc","#f472b6","#fb923c","#facc15","#34d399","#a78bfa","#f87171","#38bdf8","#e879f9","#fbbf24","#4ade80","#818cf8"] }}]
    }},
    options: {{ plugins: {{ legend: {{ position: "right", labels: {{ boxWidth: 12, padding: 8 }} }} }} }}
}});

new Chart(document.getElementById("sourceChart"), {{
    type: "doughnut",
    data: {{
        labels: {source_labels},
        datasets: [{{ data: {source_costs},
            backgroundColor: ["#4ade80","#60a5fa","#c084fc","#f472b6","#fb923c","#facc15","#34d399","#a78bfa","#f87171"] }}]
    }},
    options: {{ plugins: {{ legend: {{ position: "right", labels: {{ boxWidth: 12, padding: 8 }} }} }} }}
}});

new Chart(document.getElementById("hourlyChart"), {{
    type: "bar",
    data: {{
        labels: {hourly_labels},
        datasets: [{{ label: "Calls", data: {hourly_data},
            backgroundColor: "rgba(192,132,252,0.7)", borderRadius: 4 }}]
    }},
    options: {{ plugins: {{ legend: {{ display: false }} }},
        scales: {{ y: {{ grid: {{ color: gridColor }} }}, x: {{ grid: {{ display: false }} }} }} }}
}});
</script>

</body>
</html>"""

    return html


def main():
    entries = load_all_logs()
    if not entries:
        print("No token logs found.")
        sys.exit(1)

    html = generate_html(entries)
    with open(REPORT_OUT, "w") as f:
        f.write(html)

    print(f"Report saved: {REPORT_OUT}")
    print(f"Open in browser: file://{REPORT_OUT}")


if __name__ == "__main__":
    main()
