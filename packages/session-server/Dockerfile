# Multi-stage build for the session-server.
# Stage 1 installs deps and compiles TypeScript; stage 2 is a slim runtime.
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY packages/session-server/package.json packages/session-server/
RUN npm install
COPY packages/shared packages/shared
COPY packages/session-server packages/session-server
RUN npm run build --workspace @codesession/session-server

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/packages/session-server/package.json ./packages/session-server/
COPY --from=build /app/packages/session-server/dist ./packages/session-server/dist
EXPOSE 8080
CMD ["node", "packages/session-server/dist/index.js"]
