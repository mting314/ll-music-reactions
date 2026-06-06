# Cloud Run image for the ffmpeg export server.
# Bun runtime + ffmpeg, with reaction clips bundled in at /app/clips.
FROM oven/bun:1.3-debian

# ffmpeg is the only system dependency the export job needs.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Server source (pure logic + HTTP entrypoint).
COPY server/ffmpeg.ts server/export.ts ./server/

# Bundle the reaction clips into the image. CLIPS_DIR points the server here.
COPY public/clips ./clips

ENV CLIPS_DIR=/app/clips
ENV PORT=8080
EXPOSE 8080

CMD ["bun", "run", "server/export.ts"]
