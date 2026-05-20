FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN pip install uv

WORKDIR /app

# Install hoba_api first — hoba_bot imports models/services/db from it.
COPY apps/api/pyproject.toml ./api/
COPY apps/api/src/ ./api/src/
RUN cd /app/api && uv pip install --system -e .

# Install hoba_bot
COPY apps/bot/pyproject.toml ./bot/
COPY apps/bot/src/ ./bot/src/
RUN cd /app/bot && uv pip install --system -e ".[dev]"

COPY apps/bot/tests/ ./bot/tests/

# Stay at /app so `DATABASE_URL=sqlite+aiosqlite:///./data/hoba.db`
# resolves to /app/data/hoba.db — the same file mounted into the api
# container, which is how the two services share a SQLite database.
WORKDIR /app

CMD ["python", "-m", "hoba_bot"]
