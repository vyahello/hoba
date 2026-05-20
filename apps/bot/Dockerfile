FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

RUN pip install uv

WORKDIR /app

COPY pyproject.toml ./
COPY src/ ./src/
RUN uv pip install --system -e ".[dev]"

COPY tests/ ./tests/

CMD ["python", "-m", "hoba_bot"]
