FROM node:22-slim
WORKDIR /app
RUN groupadd -r app && useradd -r -g app app && mkdir -p /app/data && chown app:app /app/data
COPY worker.mjs server.mjs ./
USER app
ENV NODE_NO_WARNINGS=1
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:5000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
