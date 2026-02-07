#!/usr/bin/env python3
"""ALEX Conversation Audit Tool — view all interactions from day 1."""

import json
import glob
import os
import webbrowser
from datetime import datetime
import typer
from typing import Optional

app = typer.Typer(help="ALEX Conversation Audit Tool")

CONVO_DIR = os.path.expanduser("~/.alex/conversations")
ARCHIVE_DIR = os.path.join(CONVO_DIR, "archive")
REPORTS_DIR = "/home/head/ALEX_NAVADA/Manager/reports"
os.makedirs(REPORTS_DIR, exist_ok=True)

ROLE_COLORS = {
    "user": "cyan",
    "assistant": "green",
    "system": "yellow",
}


def load_files(chat_id: Optional[str] = None) -> list[str]:
    if chat_id:
        patterns = [
            os.path.join(CONVO_DIR, f"{chat_id}.json"),
            os.path.join(ARCHIVE_DIR, f"{chat_id}-*.json"),
        ]
    else:
        patterns = [
            os.path.join(CONVO_DIR, "*.json"),
            os.path.join(ARCHIVE_DIR, "*.json"),
        ]
    files = []
    for p in patterns:
        files.extend(glob.glob(p))
    files = [f for f in files if os.path.isfile(f)]
    files.sort(key=os.path.getmtime)
    return files


def extract_content(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return str(content)


def detect_channel(chat_id: str, filepath: str) -> str:
    """Detect the channel from chat ID or file path."""
    cid = chat_id.lower()
    if "terminal" in cid:
        return "Terminal"
    elif "slack" in cid:
        return "Slack"
    elif "control" in cid or "api" in cid:
        return "Control API"
    elif "email" in cid or "inbox" in cid:
        return "Email"
    elif cid.isdigit():
        return "Telegram"
    else:
        return "Other"


def gather_report_data(files: list[str], search: Optional[str] = None) -> list[dict]:
    """Gather structured data from conversation files for HTML report generation."""
    records = []

    for f in files:
        try:
            data = json.load(open(f))
            if isinstance(data, list):
                msgs = data
            elif isinstance(data, dict):
                msgs = data.get("messages", [])
            else:
                continue
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

        if not msgs:
            continue

        # Search filter
        if search:
            msgs = [m for m in msgs if search.lower() in extract_content(m.get("content", "")).lower()]
            if not msgs:
                continue

        basename = os.path.basename(f)
        if "/archive/" in f or "\\archive\\" in f:
            chat_id = basename.rsplit("-", 1)[0] if "-" in basename else basename.replace(".json", "")
        else:
            chat_id = basename.replace(".json", "")

        modified_ts = os.path.getmtime(f)
        modified_dt = datetime.fromtimestamp(modified_ts)
        channel = detect_channel(chat_id, f)

        # Find first user message
        first_user_msg = ""
        for m in msgs:
            if m.get("role") == "user":
                first_user_msg = extract_content(m.get("content", ""))
                break

        records.append({
            "file": basename,
            "filepath": f,
            "chat_id": chat_id,
            "channel": channel,
            "date": modified_dt.strftime("%Y-%m-%d"),
            "time": modified_dt.strftime("%H:%M"),
            "datetime": modified_dt,
            "message_count": len(msgs),
            "first_user_msg": first_user_msg[:120] + ("..." if len(first_user_msg) > 120 else ""),
        })

    return records


def generate_html_report(records: list[dict], chat_id: Optional[str], search: Optional[str]) -> str:
    """Generate a standalone HTML report and return the file path."""
    now = datetime.now()
    today = now.strftime("%Y-%m-%d")
    timestamp = now.strftime("%H%M")
    date_folder = os.path.join(REPORTS_DIR, today)
    os.makedirs(date_folder, exist_ok=True)
    suffix = ""
    if chat_id:
        suffix += f"-{chat_id}"
    if search:
        suffix += f"-search-{search.replace(' ', '_')}"
    report_path = os.path.join(date_folder, f"conversations-{timestamp}{suffix}.html")

    total_messages = sum(r["message_count"] for r in records)
    total_conversations = len(records)

    # Date range
    if records:
        dates = [r["datetime"] for r in records]
        date_min = min(dates).strftime("%Y-%m-%d")
        date_max = max(dates).strftime("%Y-%m-%d")
        date_range = f"{date_min} to {date_max}"
    else:
        date_range = "N/A"

    # Channels active
    channels = set(r["channel"] for r in records)
    channels_active = len(channels)

    # Chart 1: Messages per day
    msgs_per_day: dict[str, int] = {}
    for r in records:
        msgs_per_day[r["date"]] = msgs_per_day.get(r["date"], 0) + r["message_count"]
    day_labels = sorted(msgs_per_day.keys())
    day_values = [msgs_per_day[d] for d in day_labels]

    # Chart 2: Messages by channel
    msgs_per_channel: dict[str, int] = {}
    for r in records:
        msgs_per_channel[r["channel"]] = msgs_per_channel.get(r["channel"], 0) + r["message_count"]
    channel_labels = list(msgs_per_channel.keys())
    channel_values = [msgs_per_channel[c] for c in channel_labels]

    # Chart 3: Messages per chat ID (top 10)
    msgs_per_chat: dict[str, int] = {}
    for r in records:
        msgs_per_chat[r["chat_id"]] = msgs_per_chat.get(r["chat_id"], 0) + r["message_count"]
    sorted_chats = sorted(msgs_per_chat.items(), key=lambda x: x[1], reverse=True)[:10]
    chat_labels = [c[0] for c in sorted_chats]
    chat_values = [c[1] for c in sorted_chats]

    # Table rows
    sorted_records = sorted(records, key=lambda r: r["datetime"], reverse=True)
    table_rows = ""
    for r in sorted_records:
        escaped_msg = (
            r["first_user_msg"]
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )
        table_rows += f"""
            <tr>
                <td>{r["date"]}</td>
                <td>{r["time"]}</td>
                <td>{r["chat_id"]}</td>
                <td><span class="channel-badge">{r["channel"]}</span></td>
                <td style="text-align:center">{r["message_count"]}</td>
                <td class="msg-preview">{escaped_msg}</td>
            </tr>"""

    # Build subtitle
    subtitle_parts = []
    if chat_id:
        subtitle_parts.append(f"Filtered to chat: {chat_id}")
    if search:
        subtitle_parts.append(f'Search: "{search}"')
    subtitle_html = f'<p class="subtitle">{" | ".join(subtitle_parts)}</p>' if subtitle_parts else ""

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ALEX Conversation Audit Report &mdash; {today}</title>
    <script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            background: #1a1a2e;
            color: #e0e0e0;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            padding: 24px;
            line-height: 1.6;
        }}
        .header {{
            text-align: center;
            padding: 32px 0 16px;
        }}
        .header h1 {{
            font-size: 28px;
            font-weight: 700;
            color: #e0e0e0;
            letter-spacing: 0.5px;
        }}
        .header .subtitle {{
            color: #8888aa;
            font-size: 14px;
            margin-top: 6px;
        }}
        .stats-bar {{
            display: flex;
            gap: 16px;
            justify-content: center;
            flex-wrap: wrap;
            margin: 24px 0 32px;
        }}
        .stat-card {{
            background: #16213e;
            border-radius: 10px;
            padding: 18px 28px;
            text-align: center;
            min-width: 180px;
            border: 1px solid #0f3460;
        }}
        .stat-card .stat-value {{
            font-size: 32px;
            font-weight: 700;
            color: #e0e0e0;
        }}
        .stat-card .stat-label {{
            font-size: 12px;
            text-transform: uppercase;
            color: #8888aa;
            letter-spacing: 1px;
            margin-top: 4px;
        }}
        .charts-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 24px;
        }}
        .chart-card {{
            background: #16213e;
            border-radius: 10px;
            padding: 20px;
            border: 1px solid #0f3460;
        }}
        .chart-card.full-width {{
            grid-column: 1 / -1;
        }}
        .chart-card h2 {{
            font-size: 16px;
            color: #e0e0e0;
            margin-bottom: 12px;
            font-weight: 600;
        }}
        .table-card {{
            background: #16213e;
            border-radius: 10px;
            padding: 20px;
            border: 1px solid #0f3460;
            overflow-x: auto;
        }}
        .table-card h2 {{
            font-size: 16px;
            color: #e0e0e0;
            margin-bottom: 16px;
            font-weight: 600;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            font-size: 13px;
        }}
        thead th {{
            background: #0f3460;
            color: #e0e0e0;
            padding: 10px 12px;
            text-align: left;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 11px;
            letter-spacing: 0.5px;
            border-bottom: 2px solid #1a1a2e;
        }}
        tbody tr {{
            border-bottom: 1px solid #1a1a2e;
        }}
        tbody tr:hover {{
            background: #0f3460;
        }}
        tbody td {{
            padding: 8px 12px;
            color: #c0c0d0;
        }}
        .channel-badge {{
            display: inline-block;
            background: #0f3460;
            color: #e0e0e0;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
        }}
        .msg-preview {{
            max-width: 320px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            color: #8888aa;
            font-size: 12px;
        }}
        .footer {{
            text-align: center;
            padding: 24px 0 8px;
            color: #555;
            font-size: 12px;
        }}
    </style>
</head>
<body>
    <div class="header">
        <h1>ALEX Conversation Audit Report &mdash; {today}</h1>
        {subtitle_html}
    </div>

    <div class="stats-bar">
        <div class="stat-card">
            <div class="stat-value">{total_messages}</div>
            <div class="stat-label">Total Messages</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{total_conversations}</div>
            <div class="stat-label">Conversations</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{date_range}</div>
            <div class="stat-label">Date Range</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">{channels_active}</div>
            <div class="stat-label">Channels Active</div>
        </div>
    </div>

    <div class="charts-grid">
        <div class="chart-card full-width">
            <h2>Messages Per Day</h2>
            <div id="chart-per-day"></div>
        </div>
        <div class="chart-card">
            <h2>Messages by Channel</h2>
            <div id="chart-by-channel"></div>
        </div>
        <div class="chart-card">
            <h2>Top 10 Most Active Chat IDs</h2>
            <div id="chart-per-chat"></div>
        </div>
    </div>

    <div class="table-card">
        <h2>All Conversations</h2>
        <table>
            <thead>
                <tr>
                    <th>Date</th>
                    <th>Time</th>
                    <th>Chat ID</th>
                    <th>Channel</th>
                    <th>Messages</th>
                    <th>First User Message</th>
                </tr>
            </thead>
            <tbody>
                {table_rows}
            </tbody>
        </table>
    </div>

    <div class="footer">
        Generated by ALEX Conversation Audit Tool on {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}
    </div>

    <script>
        var plotlyLayout = {{
            paper_bgcolor: 'rgba(0,0,0,0)',
            plot_bgcolor: 'rgba(0,0,0,0)',
            font: {{ color: '#e0e0e0', family: 'Segoe UI, sans-serif' }},
            margin: {{ l: 50, r: 20, t: 10, b: 50 }},
            xaxis: {{ gridcolor: '#2a2a4a', tickfont: {{ size: 11 }} }},
            yaxis: {{ gridcolor: '#2a2a4a', tickfont: {{ size: 11 }} }},
        }};
        var plotlyConfig = {{ responsive: true, displayModeBar: false }};

        // Chart 1: Messages per day
        Plotly.newPlot('chart-per-day', [{{
            x: {json.dumps(day_labels)},
            y: {json.dumps(day_values)},
            type: 'bar',
            marker: {{ color: '#0f3460' }},
            hovertemplate: '%{{x}}<br>%{{y}} messages<extra></extra>'
        }}], {{
            ...plotlyLayout,
            margin: {{ l: 50, r: 20, t: 10, b: 60 }},
            xaxis: {{ ...plotlyLayout.xaxis, tickangle: -45 }},
            yaxis: {{ ...plotlyLayout.yaxis, title: 'Messages' }},
        }}, plotlyConfig);

        // Chart 2: Messages by channel (pie)
        Plotly.newPlot('chart-by-channel', [{{
            labels: {json.dumps(channel_labels)},
            values: {json.dumps(channel_values)},
            type: 'pie',
            hole: 0.4,
            marker: {{
                colors: ['#0f3460', '#1a1a6e', '#2a4080', '#3a60a0', '#4a80c0', '#5aa0e0']
            }},
            textfont: {{ color: '#e0e0e0' }},
            hovertemplate: '%{{label}}<br>%{{value}} messages (%{{percent}})<extra></extra>'
        }}], {{
            ...plotlyLayout,
            margin: {{ l: 20, r: 20, t: 10, b: 20 }},
            showlegend: true,
            legend: {{ font: {{ color: '#e0e0e0', size: 11 }} }}
        }}, plotlyConfig);

        // Chart 3: Messages per chat (top 10)
        Plotly.newPlot('chart-per-chat', [{{
            x: {json.dumps(chat_values)},
            y: {json.dumps(chat_labels)},
            type: 'bar',
            orientation: 'h',
            marker: {{ color: '#0f3460' }},
            hovertemplate: '%{{y}}<br>%{{x}} messages<extra></extra>'
        }}], {{
            ...plotlyLayout,
            margin: {{ l: 140, r: 20, t: 10, b: 40 }},
            xaxis: {{ ...plotlyLayout.xaxis, title: 'Messages' }},
            yaxis: {{ ...plotlyLayout.yaxis, autorange: 'reversed' }},
        }}, plotlyConfig);
    </script>
</body>
</html>"""

    with open(report_path, "w") as f:
        f.write(html)

    return report_path


@app.command()
def view(
    chat_id: Optional[str] = typer.Argument(None, help="Filter by chat ID (e.g. 6920669447, terminal-chat, control-api)"),
    last: Optional[int] = typer.Option(None, "--last", "-l", help="Show only the last N messages per file"),
    search: Optional[str] = typer.Option(None, "--search", "-s", help="Search for keyword in messages"),
    summary: bool = typer.Option(False, "--summary", help="Show file summary only, no messages"),
    html: bool = typer.Option(False, "--html", help="Generate a visual HTML report instead of terminal output"),
):
    """View all ALEX conversations. Optionally filter by chat ID, search, or limit messages."""
    files = load_files(chat_id)

    if not files:
        typer.secho(f"No conversations found{f' for {chat_id}' if chat_id else ''}.", fg="red")
        raise typer.Exit(1)

    # HTML report mode
    if html:
        records = gather_report_data(files, search=search)
        if not records:
            typer.secho("No matching conversations found for report.", fg="red")
            raise typer.Exit(1)
        report_path = generate_html_report(records, chat_id=chat_id, search=search)
        typer.secho(f"Report generated: {report_path}", fg="green", bold=True)
        webbrowser.open(f"file://{report_path}")
        return

    # Original text-mode output
    total_files = 0
    total_messages = 0

    for f in files:
        try:
            data = json.load(open(f))
            if isinstance(data, list):
                msgs = data
            elif isinstance(data, dict):
                msgs = data.get("messages", [])
            else:
                continue
        except (json.JSONDecodeError, KeyError, ValueError):
            continue

        if not msgs:
            continue

        # Search filter
        if search:
            msgs = [m for m in msgs if search.lower() in extract_content(m.get("content", "")).lower()]
            if not msgs:
                continue

        # Last N filter
        if last:
            msgs = msgs[-last:]

        modified = datetime.fromtimestamp(os.path.getmtime(f)).strftime("%Y-%m-%d %H:%M")
        total_files += 1
        total_messages += len(msgs)

        typer.echo()
        typer.secho(f"{'='*70}", fg="bright_black")
        typer.secho(f"  {os.path.basename(f)}", fg="bright_white", bold=True)
        typer.secho(f"  {modified}  |  {len(msgs)} messages", fg="bright_black")
        typer.secho(f"{'='*70}", fg="bright_black")

        if summary:
            continue

        for m in msgs:
            role = m.get("role", "unknown")
            content = extract_content(m.get("content", ""))
            color = ROLE_COLORS.get(role, "white")
            label = role.upper()
            typer.secho(f"[{label}]", fg=color, bold=True, nl=False)
            typer.echo(f" {content}")

    typer.echo()
    typer.secho(f"  Total: {total_files} files, {total_messages} messages", fg="bright_white", bold=True)


@app.command()
def list_chats():
    """List all unique chat IDs with message counts."""
    files = load_files()
    chats: dict[str, dict] = {}

    for f in files:
        basename = os.path.basename(f)
        # Extract chat ID from filename
        if "/archive/" in f or "\\archive\\" in f:
            chat_id = basename.rsplit("-", 1)[0] if "-" in basename else basename.replace(".json", "")
        else:
            chat_id = basename.replace(".json", "")

        try:
            data = json.load(open(f))
            if isinstance(data, list):
                msg_count = len(data)
            elif isinstance(data, dict):
                msg_count = len(data.get("messages", []))
            else:
                msg_count = 0
        except (json.JSONDecodeError, KeyError, ValueError, AttributeError):
            msg_count = 0

        if chat_id not in chats:
            chats[chat_id] = {"files": 0, "messages": 0, "latest": 0}
        chats[chat_id]["files"] += 1
        chats[chat_id]["messages"] += msg_count
        mtime = os.path.getmtime(f)
        if mtime > chats[chat_id]["latest"]:
            chats[chat_id]["latest"] = mtime

    typer.secho(f"\n{'Chat ID':<40} {'Files':>6} {'Messages':>10} {'Last Active':>20}", fg="bright_white", bold=True)
    typer.secho("-" * 80, fg="bright_black")

    for chat_id, info in sorted(chats.items(), key=lambda x: x[1]["latest"], reverse=True):
        last_active = datetime.fromtimestamp(info["latest"]).strftime("%Y-%m-%d %H:%M")
        typer.echo(f"{chat_id:<40} {info['files']:>6} {info['messages']:>10} {last_active:>20}")

    typer.echo()


if __name__ == "__main__":
    app()
