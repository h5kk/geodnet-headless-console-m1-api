ARG BUILD_FROM
FROM $BUILD_FROM

# Set shell
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# Setup base
RUN \
    apk add --no-cache \
        nodejs \
        npm \
        chromium \
        nss \
        freetype \
        freetype-dev \
        harfbuzz \
        ca-certificates \
        ttf-freefont \
        nodejs \
        yarn

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install app dependencies
RUN npm ci

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Define environment variable for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Start the app
CMD ["node", "index.js"]