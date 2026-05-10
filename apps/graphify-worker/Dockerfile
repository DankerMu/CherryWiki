FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends git curl && rm -rf /var/lib/apt/lists/*

# Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (pinned)
ARG CLAUDE_CODE_VERSION=2.1.131
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}
ENV DISABLE_AUTOUPDATER=1

# Graphify Python package (pinned)
ARG GRAPHIFY_REF=58271fb5af4c0c123ddbad9c689ee1e220360be8
RUN pip install --no-cache-dir "git+https://github.com/safishamsi/graphify.git@${GRAPHIFY_REF}"

# Non-root user for Claude Code (bypassPermissions rejects root)
RUN addgroup --system --gid 10001 graphify \
 && adduser --system --uid 10001 --ingroup graphify --home /home/graphify graphify

# Verify installations
RUN claude --version && graphify --help && python3 -c "from graphify.build import build_from_json"

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ src/

EXPOSE 9094
CMD ["python", "-m", "src"]
