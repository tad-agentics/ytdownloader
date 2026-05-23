FROM node:20-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 curl ca-certificates unzip \
  && curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
     -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp \
  && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh -s v2.2.3 \
  && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV PATH="/usr/local/bin:${PATH}"

FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 NODE_OPTIONS="--max-old-space-size=2048"
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
