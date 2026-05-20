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

EXPOSE 8000

CMD ["uvicorn", "hoba_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
