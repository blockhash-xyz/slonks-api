# syntax=docker/dockerfile:1.7
FROM oven/bun:1.2.19 AS deps
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/api/package.json packages/api/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/core/package.json packages/core/package.json
RUN bun install --frozen-lockfile || bun install

FROM ubuntu:24.04 AS runtime
WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PATH="/root/.nargo/bin:/root/.bb:${PATH}"

ARG NOIR_VERSION=1.0.0-beta.16
ARG BB_VERSION=3.0.0-nightly.20251104
ARG PRECOMPILE_PROVER=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git gzip tar \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L https://raw.githubusercontent.com/noir-lang/noirup/refs/heads/main/install | bash \
  && /root/.nargo/bin/noirup --version "${NOIR_VERSION}" \
  && curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/refs/heads/next/barretenberg/bbup/install | bash \
  && /root/.bb/bbup --version "${BB_VERSION}" \
  && nargo --version \
  && bb --version

COPY --from=deps /usr/local/bin/bun /usr/local/bin/bun
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN if [ "${PRECOMPILE_PROVER}" = "true" ]; then \
    mkdir -p /opt/slonks-prover/slop_model_proof/src \
    && cp packages/cli/assets/slop_model_proof/Nargo.toml /opt/slonks-prover/slop_model_proof/Nargo.toml \
    && cp packages/cli/assets/slop_model_proof/src/main.nr /opt/slonks-prover/slop_model_proof/src/main.nr \
    && cd /opt/slonks-prover/slop_model_proof \
    && nargo compile \
    && bb write_vk \
      -s ultra_honk \
      --disable_zk \
      --oracle_hash keccak \
      -b target/slop_model_proof.json \
      -o target/proof-keccak/vk; \
  fi

# Default to the web process. Fly's [processes] block overrides this per process group.
EXPOSE 8080
CMD ["bun", "packages/api/src/web.ts"]
