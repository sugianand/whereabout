# Build from the repository root:  docker build -f api/Dockerfile -t whereabout-api .
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WHEREABOUT_CATALOG=/app/data/curation/photos.csv

WORKDIR /app

COPY api/pyproject.toml api/pyproject.toml
COPY api/src api/src
RUN pip install ./api

COPY data/curation data/curation

RUN useradd --create-home --uid 10001 whereabout
USER whereabout

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"

CMD ["uvicorn", "whereabout_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
