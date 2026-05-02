FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl && rm -rf /var/lib/apt/lists/*

ARG GRAPHIFY_REF=7359cdace9a098ba8acf29d84d6c4bc1bab0e3b0
RUN pip install --no-cache-dir "git+https://github.com/safishamsi/graphify.git@${GRAPHIFY_REF}"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/

EXPOSE 9094
CMD ["python", "-m", "src"]
