#!/usr/bin/with-contenv bashio

# Get config values
export REFRESH_INTERVAL=$(bashio::config 'refresh_interval')
export INACTIVITY_TIMEOUT=$(bashio::config 'inactivity_timeout')

# Start the API server
cd /usr/src/app
exec node index.js