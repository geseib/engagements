# Multi-stage Dockerfile for Archive Server

# Base stage with common dependencies
FROM node:18-alpine AS base
WORKDIR /app

# Install system dependencies
RUN apk add --no-cache \
    curl \
    postgresql-client \
    ca-certificates \
    openssl

# Copy package files
COPY package*.json ./

# Development stage
FROM base AS development
ENV NODE_ENV=development

# Install all dependencies (including dev dependencies)
RUN npm ci

# Copy source code
COPY src/ ./src/
COPY certs/ ./certs/

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 3443

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3443/health || exit 1

# Start development server with nodemon
CMD ["npm", "run", "dev"]

# Production build stage
FROM base AS build
ENV NODE_ENV=production

# Install all dependencies for building
RUN npm ci --include=dev

# Copy source code
COPY src/ ./src/

# Run any build steps if needed
RUN npm run build

# Production stage
FROM base AS production
ENV NODE_ENV=production

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built application from build stage
COPY --from=build --chown=nodejs:nodejs /app/src ./src
COPY --from=build --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy certificates directory (will be mounted in production)
RUN mkdir -p certs logs && \
    chown -R nodejs:nodejs certs logs

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3443

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD curl -f http://localhost:3443/health || exit 1

# Start production server
CMD ["npm", "start"]

# Testing stage
FROM development AS test
ENV NODE_ENV=test

# Install test dependencies
RUN npm ci

# Copy test files
COPY tests/ ./tests/

# Run tests
CMD ["npm", "test"]