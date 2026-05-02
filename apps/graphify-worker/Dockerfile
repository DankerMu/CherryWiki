FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl && rm -rf /var/lib/apt/lists/*

ARG GRAPHIFY_REF=58271fb5af4c0c123ddbad9c689ee1e220360be8
RUN pip install --no-cache-dir "git+https://github.com/safishamsi/graphify.git@${GRAPHIFY_REF}"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/

EXPOSE 9094
CMD ["python", "-m", "src"]
