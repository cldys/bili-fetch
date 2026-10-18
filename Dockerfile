FROM node:22-bookworm-slim

# Match the current local yt-dlp release; change explicitly when upgrading.
ARG YT_DLP_VERSION=2026.08.19
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg python3 \
    && apt-get clean
RUN curl --fail --location --retry 3 \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/yt-dlp" \
      --output /usr/local/bin/yt-dlp \
    && curl --fail --location --retry 3 \
      "https://github.com/yt-dlp/yt-dlp/releases/download/${YT_DLP_VERSION}/SHA2-256SUMS" \
      --output /tmp/yt-dlp-checksums \
    && cd /usr/local/bin \
    && grep '  yt-dlp$' /tmp/yt-dlp-checksums | sha256sum --check --strict \
    && chmod 755 /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

ENV HOST=0.0.0.0 PORT=4317 BILIFETCH_DATA_DIRECTORY=/data
USER node
EXPOSE 4317
CMD ["node", "src/server.js"]
