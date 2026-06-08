# Cloud Run service image for the read-only data API.
# Build with this directory as the context: `gcloud run deploy --source data-api`.
FROM oven/bun:1.3-debian

WORKDIR /app
COPY server.ts ./

ENV PORT=8080
EXPOSE 8080

# DATABASE_URL is provided at deploy time (Cloud SQL connection).
CMD ["bun", "run", "server.ts"]
