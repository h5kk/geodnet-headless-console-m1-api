ARG BUILD_FROM
FROM $BUILD_FROM

# Install dependencies for chrome-aws-lambda
RUN apk --no-cache add \
    nodejs \
    npm \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    python3 \
    make \
    g++ \
    curl \
    fontconfig \
    alsa-lib \
    at-spi2-core \
    cairo \
    cups-libs \
    dbus-glib \
    eudev-libs \
    expat \
    ttf-opensans

# Set the working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install Puppeteer and chrome-aws-lambda dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["node", "index.js"]
