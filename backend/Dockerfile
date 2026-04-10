# Build stage
FROM node:20-bullseye-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .
COPY src/modules/tools /app/src/modules/tools
# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-bullseye-slim AS production

WORKDIR /app

# Create non-root user
RUN groupadd -g 1001 nodejs && \
    useradd -u 1001 --create-home --shell /bin/bash -g nodejs nodejs

# Install tini (init process to reap zombie child processes like soffice),
# LibreOffice, poppler-utils, fonts, and Python sandbox
RUN apt-get update && apt-get install -y \
    tini \
    libreoffice \
    fonts-dejavu \
    fonts-droid-fallback \
    fonts-freefont-ttf \
    fonts-liberation \
    default-jre \
    poppler-utils \
    wget \
    procps \
    python3 \
    python3-pip \
    && python3 -m pip install --no-cache-dir \
       requests beautifulsoup4 lxml trafilatura pandas \
       numpy matplotlib Pillow openpyxl sympy scipy tabulate \
       python-docx PyMuPDF==1.23.26 pdf2docx==0.5.6 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json package-lock.json* ./

# Install production dependencies only
RUN npm ci --omit=dev --legacy-peer-deps && npm cache clean --force

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Copy guides (static HTML files)
COPY src/guides ./dist/guides

# Copy sandbox Python files
COPY src/sandbox ./sandbox

# Copy conversion scripts
COPY src/scripts ./dist/scripts

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check (wget is in the debian image now)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use tini as init process to reap zombie child processes (soffice, python, etc.)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start application
CMD ["node", "dist/index.js"]
