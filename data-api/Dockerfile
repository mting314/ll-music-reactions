# Cloud Run service image for the read-only data API (reads Firestore).
# Build with this directory as the context: `gcloud run deploy --source data-api`.
FROM oven/bun:1.3-debian

WORKDIR /app
COPY server.ts ./

ENV PORT=8080
EXPOSE 8080

# Uses Application Default Credentials (the Cloud Run service account) +
# the project id from the metadata server. No env config required.
CMD ["bun", "run", "server.ts"]
