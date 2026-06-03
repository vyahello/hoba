#!/usr/bin/env python3
"""Who connected to Hoba! — a read-only visitor/usage report.

Stitches together the three places Hoba records who used the app:

  1. DB `users` table .......... identity (tg_id, name, lang, timestamps)
  2. API container logs ........ `ws.connect` events (internal user_id ↔ when)
  3. webapp container logs ..... nginx access log (OS / device / browser UA)

Run it on the box (or anywhere with `docker` access to the stack):

    python3 scripts/visitors.py
    python3 scripts/visitors.py --since 24h        # only the last 24h
    python3 scripts/visitors.py --nginx-log /var/log/nginx/access.log  # + real client IPs (needs sudo)

Notes / honest limits:
  * Telegram identity (§1/§2) and device/OS (§3) come from different layers
    and cannot be auto-joined: the static webapp layer has no auth, and the
    proxy masks client IPs in the container log. §3 tells you WHAT devices
    hit the app; §1/§2 tell you WHO authenticated. Pass --nginx-log to add
    real client IPs from the host nginx log (the only place they survive).
  * `docker logs` retains only the current buffer (since container start /
    log rotation) — it is NOT a permanent history. For durable analytics,
    persist events to the DB (a feature, not this script's job).
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

API_CONTAINER_DEFAULT = "hoba-api-1"
WEBAPP_CONTAINER_DEFAULT = "hoba-webapp-1"
DB_PATH_IN_CONTAINER = "/app/data/hoba.db"

# nginx "combined" access-log line.
_NGINX_RE = re.compile(
    r'^(?P<ip>\S+) \S+ \S+ \[(?P<ts>[^\]]+)\] '
    r'"(?P<method>\S+) (?P<path>\S+)[^"]*" (?P<status>\d+) (?P<size>\S+) '
    r'"(?P<referer>[^"]*)" "(?P<ua>[^"]*)"'
)
_NGINX_TS_FMT = "%d/%b/%Y:%H:%M:%S %z"

# User-Agents we never want to count as a human visitor.
_BOT_RE = re.compile(
    r"bot|crawl|spider|slurp|claudebot|gptbot|ahrefs|semrush|"
    r"censys|zgrab|masscan|nmap|curl|wget|python-requests|go-http|"
    r"facebookexternalhit|telegrambot|headless",
    re.IGNORECASE,
)


def _run(cmd: list[str]) -> str:
    """Run a command, return stdout; exit cleanly with context on failure."""
    try:
        return subprocess.run(
            cmd, check=True, capture_output=True, text=True
        ).stdout
    except FileNotFoundError:
        sys.exit(f"error: `{cmd[0]}` not found on PATH")
    except subprocess.CalledProcessError as exc:
        sys.exit(f"error running {' '.join(cmd)}:\n{exc.stderr.strip()}")


# ──────────────────────────────────────────────────────────────────────────
# User-Agent classification
# ──────────────────────────────────────────────────────────────────────────
def classify_ua(ua: str) -> tuple[str, str, str]:
    """Return (os, device, browser) best-effort from a User-Agent string."""
    os_name = "unknown"
    device = "unknown"
    browser = "unknown"

    m = re.search(r"iPhone OS (\d+)[_.](\d+)", ua)
    if m:
        os_name, device = f"iOS {m.group(1)}.{m.group(2)}", "iPhone"
    elif re.search(r"iPad.*OS (\d+)[_.](\d+)", ua):
        m = re.search(r"OS (\d+)[_.](\d+)", ua)
        os_name, device = f"iPadOS {m.group(1)}.{m.group(2)}", "iPad"
    elif (m := re.search(r"Android (\d+(?:\.\d+)?)", ua)):
        os_name, device = f"Android {m.group(1)}", "Android"
    elif "Windows NT 10.0" in ua:
        os_name, device = "Windows 10/11", "Desktop"
    elif (m := re.search(r"Windows NT (\d+\.\d+)", ua)):
        os_name, device = f"Windows NT {m.group(1)}", "Desktop"
    elif "Mac OS X" in ua or "Macintosh" in ua:
        os_name, device = "macOS", "Desktop"
    elif "Linux" in ua:
        os_name, device = "Linux", "Desktop"

    if "Telegram" in ua:
        browser = "Telegram WebView"
    elif "CriOS" in ua or "Chrome" in ua:
        browser = "Chrome"
    elif "Firefox" in ua:
        browser = "Firefox"
    elif "Mobile/" in ua or "Safari" in ua:
        browser = "Safari/WebView"

    return os_name, device, browser


# ──────────────────────────────────────────────────────────────────────────
# Source 1 — DB users
# ──────────────────────────────────────────────────────────────────────────
@dataclass
class DbUser:
    uid: int
    tg_id: int
    username: str | None
    name: str
    lang: str
    created: str
    last_active: str


def load_users(api_container: str) -> dict[int, DbUser]:
    py = (
        "import sqlite3,json;"
        f"c=sqlite3.connect('{DB_PATH_IN_CONTAINER}');"
        "rows=c.execute('SELECT id,tg_id,tg_username,first_name,last_name,"
        "language_code,created_at,last_active_at FROM users').fetchall();"
        "print(json.dumps(rows))"
    )
    out = _run(["docker", "exec", api_container, "python", "-c", py])
    users: dict[int, DbUser] = {}
    for uid, tg_id, un, fn, ln, lang, cr, la in json.loads(out):
        name = " ".join(p for p in (fn, ln) if p).strip()
        users[uid] = DbUser(uid, tg_id, un, name, lang or "-", str(cr)[:19], str(la)[:19])
    return users


# ──────────────────────────────────────────────────────────────────────────
# Source 2 — API ws.connect events
# ──────────────────────────────────────────────────────────────────────────
@dataclass
class Sessions:
    connects: int = 0
    first: str = ""
    last: str = ""


def load_ws_sessions(api_container: str, since: datetime | None) -> tuple[dict[int, Sessions], int]:
    out = _run(["docker", "logs", api_container])
    per_user: dict[int, Sessions] = defaultdict(Sessions)
    rejected = 0
    for line in out.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        ev = rec.get("event")
        ts = rec.get("timestamp", "")
        if since and ts:
            try:
                if datetime.fromisoformat(ts.replace("Z", "+00:00")) < since:
                    continue
            except ValueError:
                pass
        if ev == "ws.auth.rejected":
            rejected += 1
        elif ev == "ws.connect":
            uid = rec.get("user_id")
            if uid is None:
                continue
            s = per_user[uid]
            s.connects += 1
            if not s.first:
                s.first = ts
            s.last = ts
    return per_user, rejected


# ──────────────────────────────────────────────────────────────────────────
# Source 3 — webapp nginx access log (devices / OS)
# ──────────────────────────────────────────────────────────────────────────
@dataclass
class Client:
    ua: str
    os: str
    device: str
    browser: str
    hits: int = 0
    app_hits: int = 0  # requests with a hobagame referer = real in-app loads
    first: datetime | None = None
    last: datetime | None = None
    ips: set[str] = field(default_factory=set)


def parse_access_log(lines: list[str], since: datetime | None) -> tuple[dict[str, Client], int, int]:
    clients: dict[str, Client] = {}
    bot_hits = 0
    bot_uas: set[str] = set()
    for line in lines:
        m = _NGINX_RE.match(line.strip())
        if not m:
            continue
        ua = m.group("ua")
        try:
            ts = datetime.strptime(m.group("ts"), _NGINX_TS_FMT)
        except ValueError:
            ts = None
        if since and ts and ts < since:
            continue
        if _BOT_RE.search(ua) or ua in ("-", ""):
            bot_hits += 1
            bot_uas.add(ua)
            continue
        c = clients.get(ua)
        if c is None:
            os_, dev, br = classify_ua(ua)
            c = clients[ua] = Client(ua=ua, os=os_, device=dev, browser=br)
        c.hits += 1
        if "hobagame" in m.group("referer"):
            c.app_hits += 1
        c.ips.add(m.group("ip"))
        if ts:
            c.first = ts if c.first is None or ts < c.first else c.first
            c.last = ts if c.last is None or ts > c.last else c.last
    return clients, bot_hits, len(bot_uas)


# ──────────────────────────────────────────────────────────────────────────
# Rendering
# ──────────────────────────────────────────────────────────────────────────
def _hdr(title: str) -> None:
    print(f"\n\033[1m{title}\033[0m")
    print("─" * len(title))


def main() -> None:
    ap = argparse.ArgumentParser(description="Hoba! visitor / usage report")
    ap.add_argument("--api-container", default=API_CONTAINER_DEFAULT)
    ap.add_argument("--webapp-container", default=WEBAPP_CONTAINER_DEFAULT)
    ap.add_argument("--since", help="window, e.g. 24h / 7d / 90m (default: all buffered)")
    ap.add_argument("--nginx-log", help="path to host nginx access.log for real client IPs (needs read perms)")
    args = ap.parse_args()

    since: datetime | None = None
    if args.since:
        m = re.fullmatch(r"(\d+)([hdm])", args.since)
        if not m:
            sys.exit("--since must look like 24h, 7d, or 90m")
        n, unit = int(m.group(1)), m.group(2)
        delta = {"h": timedelta(hours=n), "d": timedelta(days=n), "m": timedelta(minutes=n)}[unit]
        since = datetime.now(timezone.utc) - delta

    users = load_users(args.api_container)
    sessions, rejected = load_ws_sessions(args.api_container, since)

    # ── §1 registered users ────────────────────────────────────────────
    _hdr(f"[1] REGISTERED USERS — {len(users)} total" + (f"  (since {args.since})" if since else ""))
    print(f"  {'tg_id':<12} {'username':<18} {'name':<22} {'lang':<4} {'first open':<19}  last active")
    for u in sorted(users.values(), key=lambda x: x.last_active, reverse=True):
        flag = "  ← probe/test" if u.name.lower() == "probe" else ""
        un = f"@{u.username}" if u.username else "-"
        print(f"  {u.tg_id:<12} {un:<18} {u.name[:22]:<22} {u.lang:<4} {u.created:<19}  {u.last_active}{flag}")
    langs: dict[str, int] = defaultdict(int)
    for u in users.values():
        langs[u.lang] += 1
    print("  language: " + ", ".join(f"{k}={v}" for k, v in sorted(langs.items())))

    # ── §2 websocket sessions ──────────────────────────────────────────
    _hdr("[2] WEBSOCKET CONNECTIONS — from API logs (current buffer only)")
    if not sessions:
        print("  (no ws.connect events in the buffer)")
    else:
        print(f"  {'who':<32} {'connects':<9} {'first':<21} last")
        for uid, s in sorted(sessions.items(), key=lambda kv: kv[1].last, reverse=True):
            u = users.get(uid)
            who = (f"@{u.username}" if u and u.username else (u.name if u else f"user_id={uid}"))
            print(f"  {who[:32]:<32} {s.connects:<9} {s.first[:19]:<21} {s.last[:19]}")
    print(f"  auth rejections in buffer: {rejected}")

    # ── §3 devices / OS ────────────────────────────────────────────────
    raw = _run(["docker", "logs", args.webapp_container]).splitlines()
    clients, bot_hits, bot_uas = parse_access_log(raw, since)
    _hdr("[3] CLIENT DEVICES / OS — from webapp nginx log (humans only; bots excluded)")
    if not clients:
        print("  (no human requests in the buffer)")
    else:
        print(f"  {'OS':<16} {'device':<10} {'browser':<18} {'hits':<6} {'in-app':<7} {'first':<17} last")
        for c in sorted(clients.values(), key=lambda x: x.hits, reverse=True):
            f = c.first.strftime("%m-%d %H:%M") if c.first else "-"
            l = c.last.strftime("%m-%d %H:%M") if c.last else "-"
            print(f"  {c.os:<16} {c.device:<10} {c.browser:<18} {c.hits:<6} {c.app_hits:<7} {f:<17} {l}")
    print(f"  ({len(clients)} distinct human UA(s); excluded {bot_hits} bot/scanner hits from {bot_uas} bot UA(s))")

    # ── §4 real client IPs (optional, host nginx log) ──────────────────
    if args.nginx_log:
        try:
            with open(args.nginx_log, encoding="utf-8", errors="replace") as fh:
                host_lines = fh.readlines()
        except OSError as exc:
            print(f"\n  (could not read {args.nginx_log}: {exc}; try sudo)")
            return
        # Only lines for the Hoba vhost / its endpoints carry useful client IPs.
        hoba = [ln for ln in host_lines if "hobagame" in ln or "/socket.io" in ln or "/api/" in ln]
        by_ip: dict[str, Client] = {}
        ipclients, _, _ = parse_access_log(hoba, since)
        # parse_access_log keys by UA; re-key by ip+ua for a per-client view
        _hdr("[4] REAL CLIENT IPs — from host nginx log")
        rows: dict[tuple[str, str], int] = defaultdict(int)
        for ln in hoba:
            m = _NGINX_RE.match(ln.strip())
            if not m or _BOT_RE.search(m.group("ua")):
                continue
            os_, dev, _ = classify_ua(m.group("ua"))
            rows[(m.group("ip"), f"{os_} / {dev}")] += 1
        print(f"  {'client IP':<20} {'os / device':<24} hits")
        for (ip, od), n in sorted(rows.items(), key=lambda kv: kv[1], reverse=True):
            print(f"  {ip:<20} {od:<24} {n}")


if __name__ == "__main__":
    main()
