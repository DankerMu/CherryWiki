FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

RUN addgroup --system --gid 1000 worker \
    && adduser --system --uid 1000 --ingroup worker worker

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/

USER worker
EXPOSE 9092
CMD ["python", "-m", "src"]
