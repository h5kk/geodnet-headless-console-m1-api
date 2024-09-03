# GEOdnet Headless Console API Home Assistant Addon

This addon provides an API for accessing GEOdnet Console data.

## Installation

1. Add this repository to your Home Assistant instance.
2. Install the "GEOdnet Headless Console API" addon.
3. Start the addon.

## Configuration

The addon can be configured with the following options:

- `refresh_interval`: The interval (in minutes) at which the browser is refreshed. Default is 60 minutes.
- `inactivity_timeout`: The timeout (in minutes) after which an inactive browser is shut down. Default is 5 minutes.

## Usage

Once the addon is running, you can access the API at `http://your-home-assistant:3000`.

Available endpoints:

- `/api/listen?key=<miner_key>`: Start listening for a specific miner.
- `/api/shutdown?key=<miner_key>`: Stop listening for a specific miner.
- `/api/stats?key=<miner_key>&autostart=true`: Get stats for a specific miner. Set `autostart=true` to automatically start listening if not already.

Replace `<miner_key>` with the last 5 characters of your miner's serial number.
