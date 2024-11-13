#!/usr/bin/with-contenv bashio
set -e

# Print some information
bashio::log.info "Starting Geodnet Headless Console API..."

# Get config values
export REFRESH_INTERVAL=$(bashio::config 'refresh_interval')
export INACTIVITY_TIMEOUT=$(bashio::config 'inactivity_timeout')

# Start the API server
cd /usr/src/app
exec node index.js