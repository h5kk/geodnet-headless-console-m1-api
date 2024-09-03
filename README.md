# GEOdnet Headless Console API Home Assistant Addon

This addon provides an API for accessing GEOdnet Console data.

## Installation

1. Navigate to your Home Assistant's Supervisor panel.
2. In the sidebar click on "Add-on Store".
3. Click the menu icon (⋮) in the top right corner and select "Repositories".
4. Add this repository URL: `https://github.com/erikarenhill/geodnet-headless-console-api`
5. Click "Add".
6. The "GEOdnet Headless Console API" addon should now be visible in the addon store.
7. Click on it and then click "Install".

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

## Development

For local development:

1. Clone this repository.
2. Install dependencies with `npm install`.
3. Run the server with `npm start`.

## Building

To build the Docker images:

1. For a normal Docker image: `docker build -t geodnet-headless-console-api .`
2. For a Home Assistant addon: `docker build -t geodnet-headless-console-api-hass -f Dockerfile.hass .`

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
