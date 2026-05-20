"""`python -m hoba_bot` entry point — used by the Docker CMD."""

from __future__ import annotations

import asyncio

from hoba_bot.main import run

if __name__ == "__main__":
    asyncio.run(run())
