ARG BUILD_FROM
FROM $BUILD_FROM

# Setup base system
RUN \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        chromium \
        chromium-l10n \
        nodejs \
        npm \
        ca-certificates \
        fonts-liberation \
        wget \
        gnupg \
        curl \
    && rm -rf /var/lib/apt/lists/* \
    && npm install -g npm@latest

# Set working directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY . .

# Set environment variables
ENV \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

# Copy data for add-on
COPY run.sh /
RUN chmod a+x /run.sh

CMD [ "/run.sh" ]