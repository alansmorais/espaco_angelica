# Production Dockerfile for Google Cloud Run
FROM node:20-slim AS builder

WORKDIR /app

# Copy dependency specifications
COPY package.json package-lock.json ./

# Install all dependencies for build
RUN npm ci

# Copy application source code and generate production build
COPY . .
RUN npm run build

# Stage 2: Minimal runtime container
FROM node:20-slim AS runner

WORKDIR /app

# Install production dependencies only (includes tsx and express)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy server script and built assets from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/index.html ./index.html

# Cloud Run defaults: production environment and dynamic PORT injection
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# Start Express server via tsx
CMD ["npm", "start"]
