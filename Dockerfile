ARG BUILD_FROM
FROM ${BUILD_FROM}

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Add Supervisor integration
COPY rootfs /

ENV \
    DEBIAN_FRONTEND="noninteractive" \
    CHROMIUM_FLAGS="--disable-gpu --disable-software-rasterizer --disable-dev-shm-usage --no-sandbox"

# Set up prerequisites
RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
        chromium \
        chromium-l10n \
        nodejs \
        npm \
        git \
        procps \
        ca-certificates \
        gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci --only=production

# Copy app source
COPY . .

# Set environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copy root filesystem
COPY rootfs /

# Make scripts executable
RUN chmod a+x /etc/services.d/*/run \
    && chmod a+x /etc/s6-overlay/s6-rc.d/*/run

ENTRYPOINT ["/init"]
CMD []