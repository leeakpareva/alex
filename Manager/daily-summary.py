#!/usr/bin/env python3
"""Generate daily ALEX conversation summaries as markdown files."""

import json
import os
import re
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

import typer

app = typer.Typer(help="Generate daily ALEX conversation summaries.")

CONVO_DIR = Path.home() / ".alex" / "conversations"
ARCHIVE_DIR = CONVO_DIR / "archive"
DAILY_BASE = Path.home() / "ALEX_NAVADA" / "daily"

# Default backfill start date
BACKFILL_START = date(2026, 1, 31)

# Channel classification based on chat ID
CHANNEL_MAP = [
    (re.compile(r"^terminal-chat"), "Terminal"),
    (re.compile(r"^control-api"), "Control API"),
    (re.compile(r"^slack-"), "Slack"),
    (re.compile(r"^web-"), "Web"),
    (re.compile(r"^email-action-"), "Email"),
    (re.compile(r"^kemet-"), "Kemet"),
    (re.compile(r"^\d+$"), "Telegram"),
]


def classify_channel(chat_id: str) -> str:
    """Return human-readable channel name for a chat ID."""
    for pattern, name in CHANNEL_MAP:
        if pattern.match(chat_id):
            return name
    return "Unknown"


def extract_chat_id_from_archive(filename: str) -> str:
    """Extract chat ID from an archive filename like 'control-api-1770195367076.json'."""
    base = filename.replace(".json", "")
    m = re.match(r"^(.+)-(\d{13})$", base)
    if m:
        return m.group(1)
    # Fallback: return the whole base without extension
    return base


def extract_text(content) -> str:
    """Extract plain text from a message content field (string or content blocks array)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    parts.append(block.get("text", ""))
                elif block.get("type") == "tool_result":
                    # Skip tool results in summaries
                    pass
                elif block.get("type") == "tool_use":
                    # Skip tool calls in summaries
                    pass
        return " ".join(parts)
    return str(content)


def load_conversation(filepath: Path) -> list[dict]:
    """Load messages from a conversation JSON file."""
    try:
        with open(filepath, "r") as f:
            data = json.load(f)
    except (json.JSONDecodeError, IOError, OSError):
        return []

    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        return data.get("messages", [])
    return []


def get_first_user_message(messages: list[dict]) -> str:
    """Get the first user message text, truncated to ~100 chars.

    Falls back to assistant's first text if no user message has readable text.
    """
    def _truncate(text: str) -> str:
        text = text.replace("\n", " ").strip()
        if len(text) > 100:
            return text[:97] + "..."
        return text

    # First pass: look for user messages with real text
    for msg in messages:
        if msg.get("role") == "user":
            text = extract_text(msg.get("content", "")).strip()
            if not text:
                continue
            # Skip tool_result-only messages (no useful text)
            if text.startswith("{") and ('"tool_use_id"' in text or '"success"' in text):
                continue
            return _truncate(text)

    # Fallback: use assistant's first text
    for msg in messages:
        if msg.get("role") == "assistant":
            text = extract_text(msg.get("content", "")).strip()
            if text:
                return _truncate(f"[Assistant] {text}")

    return "(empty conversation)"


def count_messages(messages: list[dict]) -> int:
    """Count actual messages (user + assistant only)."""
    return len([m for m in messages if m.get("role") in ("user", "assistant")])


def gather_conversations_for_date(target: date) -> dict[str, list[dict]]:
    """
    Gather all conversations for a specific date, grouped by chat ID.

    Each entry in the returned dict maps a chat_id to a list of dicts:
      {"filepath": Path, "messages": [...], "mtime": datetime}
    """
    result: dict[str, list[dict]] = defaultdict(list)

    target_start = datetime.combine(target, datetime.min.time())
    target_end = datetime.combine(target + timedelta(days=1), datetime.min.time())

    # Scan active conversation files
    if CONVO_DIR.exists():
        for filepath in CONVO_DIR.glob("*.json"):
            if not filepath.is_file():
                continue
            mtime = datetime.fromtimestamp(filepath.stat().st_mtime)
            if target_start <= mtime < target_end:
                chat_id = filepath.stem
                messages = load_conversation(filepath)
                if messages:
                    result[chat_id].append({
                        "filepath": filepath,
                        "messages": messages,
                        "mtime": mtime,
                    })

    # Scan archive files
    if ARCHIVE_DIR.exists():
        for filepath in ARCHIVE_DIR.glob("*.json"):
            if not filepath.is_file():
                continue
            mtime = datetime.fromtimestamp(filepath.stat().st_mtime)
            if target_start <= mtime < target_end:
                chat_id = extract_chat_id_from_archive(filepath.name)
                messages = load_conversation(filepath)
                if messages:
                    result[chat_id].append({
                        "filepath": filepath,
                        "messages": messages,
                        "mtime": mtime,
                    })

    return dict(result)


def build_summary_markdown(target: date, conversations: dict[str, list[dict]]) -> str:
    """Build the markdown summary content for a given date."""
    day_name = target.strftime("%A")
    day_num = target.strftime("%d")
    month_name = target.strftime("%b")
    year = target.strftime("%Y")

    # Calculate stats
    total_conversations = sum(len(entries) for entries in conversations.values())
    total_messages = 0
    channels_seen = set()

    for chat_id, entries in conversations.items():
        channel = classify_channel(chat_id)
        channels_seen.add(channel)
        for entry in entries:
            total_messages += count_messages(entry["messages"])

    lines = [
        f"# Daily ALEX Summary — {day_name} {day_num} {month_name} {year}",
        "",
        "## Stats",
        f"- Total conversations: {total_conversations}",
        f"- Total messages: {total_messages}",
        f"- Channels: {', '.join(sorted(channels_seen)) if channels_seen else 'None'}",
        "",
        "## Conversations",
    ]

    # Group by channel, then by chat ID
    channel_groups: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    for chat_id, entries in conversations.items():
        channel = classify_channel(chat_id)
        channel_groups[channel][chat_id].extend(entries)

    # Sort channels for consistent output
    channel_order = ["Telegram", "Terminal", "Control API", "Slack", "Web", "Email", "Kemet", "Unknown"]
    sorted_channels = sorted(
        channel_groups.keys(),
        key=lambda c: channel_order.index(c) if c in channel_order else 999,
    )

    for channel in sorted_channels:
        chat_ids = channel_groups[channel]

        for chat_id in sorted(chat_ids.keys()):
            entries = chat_ids[chat_id]

            # Build section header
            if channel == "Telegram":
                header = f"### Telegram — {chat_id}"
            elif channel in ("Terminal", "Control API"):
                header = f"### {channel}"
            else:
                header = f"### {channel} — {chat_id}"

            lines.append("")
            lines.append(header)

            # Sort entries by modification time
            entries_sorted = sorted(entries, key=lambda e: e["mtime"])

            for entry in entries_sorted:
                time_str = entry["mtime"].strftime("%H:%M")
                msg_count = count_messages(entry["messages"])
                first_msg = get_first_user_message(entry["messages"])

                if msg_count > 20:
                    lines.append(f"- **{time_str}** — {msg_count} messages exchanged, {first_msg}")
                else:
                    lines.append(f"- **{time_str}** — {first_msg}")

    lines.append("")
    return "\n".join(lines)


def get_output_path(target: date) -> Path:
    """Get the output file path for a given date."""
    month_folder = target.strftime("%b-%Y")  # e.g. Feb-2026
    day_name = target.strftime("%A")
    day_num = target.strftime("%d")
    month_name = target.strftime("%b")
    year = target.strftime("%Y")
    filename = f"{day_name}-{day_num}-{month_name}-{year}.md"
    return DAILY_BASE / month_folder / filename


@app.command()
def generate(
    target_date: Optional[str] = typer.Option(
        None,
        "--date",
        "-d",
        help="Date to generate summary for (YYYY-MM-DD). Defaults to today.",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Overwrite existing summary files.",
    ),
):
    """Generate a daily conversation summary for a specific date (default: today)."""
    if target_date:
        try:
            target = datetime.strptime(target_date, "%Y-%m-%d").date()
        except ValueError:
            typer.secho(f"Invalid date format: {target_date}. Use YYYY-MM-DD.", fg="red")
            raise typer.Exit(1)
    else:
        target = date.today()

    _generate_for_date(target, force)


@app.command()
def backfill(
    from_date: Optional[str] = typer.Option(
        None,
        "--from",
        help=f"Start date (YYYY-MM-DD). Defaults to {BACKFILL_START.isoformat()}.",
    ),
    to_date: Optional[str] = typer.Option(
        None,
        "--to",
        help="End date (YYYY-MM-DD). Defaults to today.",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        "-f",
        help="Overwrite existing summary files.",
    ),
):
    """Generate summaries for a range of dates (default: Jan 31 to today)."""
    if from_date:
        try:
            start = datetime.strptime(from_date, "%Y-%m-%d").date()
        except ValueError:
            typer.secho(f"Invalid date format: {from_date}. Use YYYY-MM-DD.", fg="red")
            raise typer.Exit(1)
    else:
        start = BACKFILL_START

    if to_date:
        try:
            end = datetime.strptime(to_date, "%Y-%m-%d").date()
        except ValueError:
            typer.secho(f"Invalid date format: {to_date}. Use YYYY-MM-DD.", fg="red")
            raise typer.Exit(1)
    else:
        end = date.today()

    if start > end:
        typer.secho(f"Start date {start} is after end date {end}.", fg="red")
        raise typer.Exit(1)

    current = start
    generated = 0
    skipped = 0
    empty = 0

    while current <= end:
        result = _generate_for_date(current, force, quiet=True)
        if result == "generated":
            generated += 1
        elif result == "skipped":
            skipped += 1
        elif result == "empty":
            empty += 1
        current += timedelta(days=1)

    typer.echo()
    typer.secho(
        f"Backfill complete: {generated} generated, {skipped} skipped (existing), {empty} empty (no conversations).",
        fg="green",
        bold=True,
    )


def _generate_for_date(target: date, force: bool, quiet: bool = False) -> str:
    """
    Generate summary for a single date.
    Returns: 'generated', 'skipped', or 'empty'.
    """
    output_path = get_output_path(target)

    # Check for existing file
    if output_path.exists() and not force:
        if not quiet:
            typer.secho(
                f"File already exists: {output_path}\nUse --force to overwrite.",
                fg="yellow",
            )
        else:
            typer.secho(f"  SKIP  {target.isoformat()} — file exists", fg="yellow")
        return "skipped"

    # Gather conversations
    conversations = gather_conversations_for_date(target)

    if not conversations:
        if not quiet:
            typer.secho(f"No conversations found for {target.isoformat()}.", fg="yellow")
        else:
            typer.secho(f"  EMPTY {target.isoformat()} — no conversations", fg="bright_black")
        return "empty"

    # Build markdown
    markdown = build_summary_markdown(target, conversations)

    # Create directory and write
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(markdown)

    total_convos = sum(len(entries) for entries in conversations.values())
    total_msgs = 0
    for entries in conversations.values():
        for entry in entries:
            total_msgs += count_messages(entry["messages"])

    if not quiet:
        typer.secho(f"Generated: {output_path}", fg="green", bold=True)
        typer.echo(f"  {total_convos} conversations, {total_msgs} messages")
    else:
        typer.secho(
            f"  OK    {target.isoformat()} — {total_convos} convos, {total_msgs} msgs → {output_path.name}",
            fg="green",
        )

    return "generated"


if __name__ == "__main__":
    app()
