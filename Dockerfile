FROM node:24-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node LICENSE NOTICE ./
RUN mkdir /data && chown node:node /data
USER node
ENV NODE_ENV=production METIS_DATA_DIR=/data METIS_HOST=0.0.0.0 PORT=4880
EXPOSE 4880
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:4880/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node","--no-warnings","src/main.cjs"]
