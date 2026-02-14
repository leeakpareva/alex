#!/usr/bin/env python3
"""NAVADA Dashboard Server — serves static files + JSON API for ALEX updates"""
import http.server
import socketserver
import os
import sys
import json
import subprocess
from datetime import datetime

PORT = 8080
DIRECTORY = "/home/head/navada-1/dashboard"
DATA_FILE = os.path.join(DIRECTORY, "dashboard_data.json")
BACKUP_FILE = os.path.join(DIRECTORY, "dashboard_data.backup.json")

os.chdir(DIRECTORY)


def read_data():
    try:
        with open(DATA_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def write_data(data):
    data["last_updated"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    with open(DATA_FILE, "w") as f:
        json.dump(data, f, indent=2)


REPO_PATH = "/home/head/navada-1"
TOKEN_LOG_DIR = "/home/head/.alex/logs"

# Anthropic pricing per 1M tokens (USD) — Sonnet, Haiku, DeepSeek
MODEL_PRICING = {
    "claude-sonnet-4-20250514": {"input": 3.0, "output": 15.0},
    "claude-3-5-haiku-20241022": {"input": 0.80, "output": 4.0},
    "deepseek-chat": {"input": 0.14, "output": 0.28},
}
USD_TO_GBP = 0.79


def get_git_commits(limit=30):
    """Get recent git commits from navada-1 repo"""
    try:
        result = subprocess.run(
            ["git", "log", f"--max-count={limit}",
             "--pretty=format:%H|||%h|||%s|||%an|||%ai|||%D"],
            cwd=REPO_PATH, capture_output=True, text=True, timeout=5
        )
        commits = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("|||")
            if len(parts) >= 5:
                commits.append({
                    "hash": parts[0],
                    "short_hash": parts[1],
                    "message": parts[2],
                    "author": parts[3],
                    "date": parts[4],
                    "refs": parts[5] if len(parts) > 5 else ""
                })
        return commits
    except Exception as e:
        return [{"error": str(e)}]


def get_token_stats():
    """Read today's token log and calculate costs in GBP"""
    date = datetime.utcnow().strftime("%Y-%m-%d")
    log_file = os.path.join(TOKEN_LOG_DIR, f"tokens_{date}.jsonl")
    total_in = 0
    total_out = 0
    total_calls = 0
    total_cost_usd = 0.0
    by_model = {}
    try:
        with open(log_file, "r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                model = entry.get("model", "unknown")
                inp = entry.get("input_tokens", 0)
                out = entry.get("output_tokens", 0)
                total_in += inp
                total_out += out
                total_calls += 1
                pricing = MODEL_PRICING.get(model, {"input": 3.0, "output": 15.0})
                cost = (inp / 1_000_000 * pricing["input"]) + (out / 1_000_000 * pricing["output"])
                total_cost_usd += cost
                if model not in by_model:
                    by_model[model] = {"input": 0, "output": 0, "calls": 0, "cost_usd": 0.0}
                by_model[model]["input"] += inp
                by_model[model]["output"] += out
                by_model[model]["calls"] += 1
                by_model[model]["cost_usd"] += cost
    except FileNotFoundError:
        pass
    except Exception:
        pass
    total_cost_gbp = total_cost_usd * USD_TO_GBP
    model_breakdown = []
    for model, stats in by_model.items():
        gbp = stats["cost_usd"] * USD_TO_GBP
        short = "Haiku" if "haiku" in model else "Sonnet" if "sonnet" in model else "DeepSeek" if "deepseek" in model else model
        model_breakdown.append({
            "model": short,
            "calls": stats["calls"],
            "input_tokens": stats["input"],
            "output_tokens": stats["output"],
            "cost_gbp": round(gbp, 4),
        })
    return {
        "date": date,
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_tokens": total_in + total_out,
        "total_calls": total_calls,
        "total_cost_gbp": round(total_cost_gbp, 4),
        "total_cost_usd": round(total_cost_usd, 4),
        "by_model": model_breakdown,
        "avg_cost_per_task_gbp": round(total_cost_gbp / max(total_calls, 1), 4),
    }


class DashboardHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith("/api/commits"):
            commits = get_git_commits()
            self._json_response(200, {"commits": commits})
        elif self.path.startswith("/api/tokens"):
            stats = get_token_stats()
            self._json_response(200, stats)
        elif self.path.startswith("/api/has-backup"):
            self._json_response(200, {"exists": os.path.exists(BACKUP_FILE)})
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == "/api/update":
            try:
                length = int(self.headers.get("Content-Length", 0))
                body = json.loads(self.rfile.read(length)) if length else {}
                action = body.get("action", "")
                data = read_data()

                if action == "add_task":
                    task = body.get("task", {})
                    task.setdefault("time", datetime.utcnow().strftime("%H:%M GMT"))
                    data.setdefault("tasks", []).insert(0, task)
                    # Update summary counts
                    s = data.setdefault("summary", {})
                    s["total_tasks"] = len(data["tasks"])
                    s["completed"] = sum(1 for t in data["tasks"] if t.get("status") == "completed")
                    s["in_progress"] = sum(1 for t in data["tasks"] if t.get("status") == "in_progress")
                    s["failed"] = sum(1 for t in data["tasks"] if t.get("status") == "failed")

                elif action == "update_task":
                    name = body.get("name", "")
                    updates = body.get("updates", {})
                    for t in data.get("tasks", []):
                        if t.get("name") == name:
                            t.update(updates)
                            break
                    s = data.setdefault("summary", {})
                    s["total_tasks"] = len(data.get("tasks", []))
                    s["completed"] = sum(1 for t in data.get("tasks", []) if t.get("status") == "completed")
                    s["in_progress"] = sum(1 for t in data.get("tasks", []) if t.get("status") == "in_progress")
                    s["failed"] = sum(1 for t in data.get("tasks", []) if t.get("status") == "failed")

                elif action == "update_metrics":
                    data["metrics"] = body.get("metrics", data.get("metrics", {}))

                elif action == "add_news":
                    item = body.get("item", {})
                    item.setdefault("time", datetime.utcnow().strftime("%H:%M GMT"))
                    data.setdefault("news", []).insert(0, item)
                    # Keep last 20
                    data["news"] = data["news"][:20]

                elif action == "add_activity":
                    entry = body.get("entry", "")
                    ts = datetime.utcnow().strftime("%H:%M GMT")
                    data.setdefault("activity_log", []).insert(0, {"time": ts, "text": entry})
                    data["activity_log"] = data["activity_log"][:50]

                elif action == "update_services":
                    data["services"] = body.get("services", data.get("services", []))

                elif action == "set_status":
                    data["status"] = body.get("status", "online")

                elif action == "full_replace":
                    # Replace entire data (for bulk updates)
                    data = body.get("data", data)

                else:
                    self._json_response(400, {"error": f"Unknown action: {action}"})
                    return

                write_data(data)
                self._json_response(200, {"ok": True})

            except Exception as e:
                self._json_response(500, {"error": str(e)})
        elif self.path == "/api/clear":
            try:
                import shutil
                data = read_data()
                shutil.copy2(DATA_FILE, BACKUP_FILE)
                cleared = {
                    "agent": data.get("agent", ""),
                    "title": data.get("title", ""),
                    "status": data.get("status", "online"),
                    "heartbeats": data.get("heartbeats", []),
                    "services": data.get("services", []),
                    "tasks": [],
                    "activity_log": [],
                    "news": [],
                    "summary": {"total_tasks": 0, "completed": 0, "in_progress": 0, "failed": 0},
                    "metrics": {},
                }
                write_data(cleared)
                self._json_response(200, {"ok": True, "message": "Dashboard cleared, backup saved"})
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif self.path == "/api/restore":
            try:
                if not os.path.exists(BACKUP_FILE):
                    self._json_response(404, {"error": "No backup found"})
                    return
                import shutil
                shutil.copy2(BACKUP_FILE, DATA_FILE)
                self._json_response(200, {"ok": True, "message": "Dashboard restored from backup"})
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        else:
            self._json_response(404, {"error": "Not found"})

    def _json_response(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


class ReuseAddrServer(socketserver.TCPServer):
    allow_reuse_address = True


print(f"📊 NAVADA Dashboard starting on http://0.0.0.0:{PORT}", flush=True)
sys.stdout.flush()

try:
    with ReuseAddrServer(("0.0.0.0", PORT), DashboardHandler) as httpd:
        httpd.serve_forever()
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
