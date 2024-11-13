ARG BUILD_FROM
FROM $BUILD_FROM

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Install dependencies
RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        nodejs \
        npm \
        chromium \
        ca-certificates \
        curl \
        gnupg \
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
ENV \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Make scripts executable
RUN chmod a+x /etc/services.d/geodnet-api/run \
    && chmod a+x /etc/services.d/geodnet-api/finish

ENTRYPOINT ["/init"]
CMD []