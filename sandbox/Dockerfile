# The only place an agent may run OpenCode. Nothing in this image can see the
# host's ~/.config/opencode or ~/.local/share/opencode — see AGENTS.md.
FROM node:26-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git jq procps \
  && rm -rf /var/lib/apt/lists/*

# The two CLIs the board shells out to for @-mentions. They are here so the
# lookup path can be exercised for real — the arguments, the exit codes, the
# "you are not logged in" failure. They are NOT logged in and there is nothing
# in this image to log them in with: the host's authenticated `acli` and `gh`
# are off limits (AGENTS.md), and HOME is the throwaway /sandbox tree, so
# neither CLI can reach a host credential store. For answers with content in
# them, put tests/fixtures/cli on PATH — see MENTION_MOCKS below.
ARG GH_VERSION=2.63.2
RUN arch="$(dpkg --print-architecture)" \
  && curl -fsSL "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${arch}.tar.gz" \
     | tar -xz -C /tmp \
  && install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${arch}/bin/gh" /usr/local/bin/gh \
  && rm -rf "/tmp/gh_${GH_VERSION}_linux_${arch}" \
  && curl -fsSL -o /usr/local/bin/acli "https://acli.atlassian.com/linux/latest/acli_linux_${arch}/acli" \
  && chmod 0755 /usr/local/bin/acli \
  && gh --version && acli --version

# Every path OpenCode and the board write to lives under /sandbox, which is a
# throwaway volume. There is no host state to fall back to and nothing to leak.
ENV HOME=/sandbox/home \
    XDG_CONFIG_HOME=/sandbox/home/.config \
    XDG_DATA_HOME=/sandbox/home/.local/share \
    XDG_CACHE_HOME=/sandbox/home/.cache \
    OPENCODE_CONFIG_DIR=/sandbox/opencode/config \
    OPENCODE_DB=/sandbox/opencode/data/opencode.db \
    OPENCODE_DISABLE_AUTOUPDATE=1 \
    BOARD_STATE_FILE=/sandbox/board_state.json \
    HOST=0.0.0.0 \
    VITE_DEV_HOST=0.0.0.0 \
    GH_TOKEN= \
    GITHUB_TOKEN= \
    GH_CONFIG_DIR=/sandbox/home/.config/gh \
    ACLI_CONFIG_DIR=/sandbox/home/.config/acli \
    PORT=3001 \
    API_PORT=3001 \
    VITE_DEV_PORT=3999

WORKDIR /app

# node_modules is built in the image: the host tree is darwin-arm64 and its
# esbuild/rollup binaries cannot run here.
COPY package.json package-lock.json ./
# Electron is only for packing the Mac app; the sandbox never runs it.
RUN ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci

# After `npm ci`, so building another version for the compatibility run only
# redoes this layer (see README.md). The default is the newest version the e2e
# has passed on; the tested range is in README.md.
ARG OPENCODE_VERSION=1.18.32
RUN npm install -g opencode-ai@${OPENCODE_VERSION} && opencode --version

COPY sandbox/entrypoint.sh /usr/local/bin/sandbox-entrypoint
RUN chmod +x /usr/local/bin/sandbox-entrypoint

# The repo is baked in rather than bind-mounted: Colima's VM only mounts $HOME,
# so a repo kept anywhere else is not visible to it. Only this layer is
# rebuilt when the code changes, so `npm run sandbox:*` rebuilds first and stays
# quick. See README.md for the live-mount alternative.
COPY . .

EXPOSE 3001 3999
ENTRYPOINT ["sandbox-entrypoint"]
CMD ["bash"]
