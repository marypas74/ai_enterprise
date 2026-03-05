# Build stage
FROM node:20-bullseye-slim AS builder

WORKDIR /app

RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

COPY . .
RUN npm run build

# Production stage
FROM node:20-bullseye-slim AS production

WORKDIR /app

RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 --create-home --shell /bin/bash -g nodejs nodejs

# Install LibreOffice, poppler-utils and fonts for document conversion
RUN apt-get update && apt-get install -y \
    libreoffice \
    fonts-dejavu \
    fonts-droid-fallback \
    fonts-freefont-ttf \
    fonts-liberation \
    default-jre \
    poppler-utils \
    wget \
    python3 \
    python3-pip \
    && python3 -m pip install --no-cache-dir pdf2docx \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

COPY --from=builder /app/dist ./dist

RUN chown -R nodejs:nodejs /app

USER nodejs

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
