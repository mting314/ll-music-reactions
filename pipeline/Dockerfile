# Cloud Run Job image for the daily data refresh.
# Build with this directory as the context: `gcloud run jobs deploy --source pipeline`.
# Bun + git (to clone the upstream scraper + seed repos at runtime).
FROM oven/bun:1.3-debian

RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install pipeline + scraper dependencies.
COPY package.json ./
RUN bun install

# Pipeline source.
COPY . .

# DATABASE_URL is provided at deploy time (Cloud SQL connection).
CMD ["bun", "run", "run-refresh.ts"]
