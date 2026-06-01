FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN addgroup --system --gid 1000 worker \
    && adduser --system --uid 1000 --ingroup worker worker

COPY packages/python-worker-protocol/ packages/python-worker-protocol/
COPY apps/ingestion-worker/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && pip install --no-cache-dir ./packages/python-worker-protocol

COPY apps/ingestion-worker/src/ src/

USER worker
EXPOSE 9091
CMD ["python", "-m", "src"]
