FROM node:20-slim

ARG CLAUDE_CODE_VERSION=latest

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    git \
    python3 \
    python3-pip \
    python3-venv \
    tini \
  && rm -rf /var/lib/apt/lists/*

COPY tools/cherrydb/requirements.txt /tmp/cherrydb-requirements.txt
COPY tools/cherrywiki/requirements.txt /tmp/cherrywiki-requirements.txt

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" \
  && python3 -m venv /opt/cherry-tools \
  && /opt/cherry-tools/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/cherry-tools/bin/pip install --no-cache-dir \
    -r /tmp/cherrydb-requirements.txt \
    -r /tmp/cherrywiki-requirements.txt \
  && rm -f /tmp/cherrydb-requirements.txt /tmp/cherrywiki-requirements.txt

RUN groupadd --gid 10001 agent \
  && useradd --uid 10001 --gid 10001 --home-dir /home/agent --create-home --shell /usr/sbin/nologin agent \
  && mkdir -p /work/agent /graphs /home/agent/.cache \
  && chown -R 10001:10001 /work/agent /home/agent/.cache

ENV PATH="/opt/cherry-tools/bin:/app/tools/cherrydb:/app/tools/cherrywiki:/opt/graphify/bin:${PATH}" \
  PYTHONPATH="/app/tools" \
  HOME="/home/agent" \
  TMPDIR="/tmp"

WORKDIR /work/agent
USER 10001:10001

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sleep", "infinity"]
