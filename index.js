const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;

const REFRESH_INTERVAL = parseInt(process.env.REFRESH_INTERVAL || '60') * 60 * 1000; // Convert minutes to milliseconds
const INACTIVITY_TIMEOUT = parseInt(process.env.INACTIVITY_TIMEOUT || '5') * 60 * 1000; // Convert minutes to milliseconds

const activeBrowsers = new Map();
const latestSatelliteData = new Map();
const lastActivityTime = new Map();
const setupInProgress = new Set();

function countEffectiveSats(data, snrThreshold = 32) {
    const satSystems = ['satinfoG', 'satinfoR', 'satinfoE', 'satinfoC'];
    
    return satSystems.reduce((count, system) => {
        if ( !data.hasOwnProperty('satInfo') || data.satInfo.hasOwnProperty('system') || !Array.isArray(data.satInfo[system]) ) {
            return count;
        }

        return count + data.satInfo[system].filter(sat => sat.snr >= snrThreshold).length;
    }, 0);
}

function aggregateSatInfo(data) {
    const result = [];

    if ( !data || !data.satInfo ) {
        return result;
    }

    const satInfoKeys = Object.keys(data.satInfo);
  
    for (const key of satInfoKeys) {
      const satellites = data.satInfo[key];
      for (const sat of satellites) {
        result.push({
          sys_channel: sat.sys + sat.prn,
          snr: sat.snr
        });
      }
    }
  
    return result;
}

  function processHourlyData(data) {

    if ( !data || !data.xData ) {
        return null;
    }

    return data.xData.map((dateTime, index) => {
        // Parse the date and time
        const [datePart, hourPart] = dateTime.split(' ');
        const isoDateTime = `${datePart}T${hourPart.padStart(2, '0')}:00:00Z`;

        return {
            timestamp: new Date(isoDateTime).toISOString(),
            onLineRate: data.yData.onLineRate[index],
            satRate: data.yData.satRate[index]
        };
    }).filter(d => typeof d.onLineRate !== 'undefined');
}

async function setupBrowserAndPage(key) {
    const hashedKey = crypto.createHash('sha256').update(key).digest('hex');
    const startTime = Date.now();

    if (setupInProgress.has(key)) {
        console.log(`Setup already in progress for key: ${key}`);
        return;
    }

    setupInProgress.add(key);
    console.log(`Setting up browser for key: ${key}`);

    const setupProcess = async () => {
        try {
            console.log(`Configuring launch options for key: ${key}`);
            const launchOptions = {
                args: ['--no-sandbox', "--disabled-setupid-sandbox"],
                defaultViewport: chromium.defaultViewport,
                executablePath: await chromium.executablePath,
                headless: true,
                ignoreHTTPSErrors: true,
            };

            console.log(`Launching browser for key: ${key}`);
            const browserStartTime = Date.now();
            const browser = await puppeteer.launch(launchOptions);
            console.log(`Browser launched successfully for key: ${key}. Time taken: ${Date.now() - browserStartTime}ms`);

            console.log(`Creating new page for key: ${key}`);
            const pageStartTime = Date.now();
            const page = await browser.newPage();
            console.log(`New page created for key: ${key}. Time taken: ${Date.now() - pageStartTime}ms`);

            console.log(`Navigating to GEOdnet console for key: ${key}`);
            const navigationStartTime = Date.now();
            await page.goto('https://console.geodnet.com/map', { timeout: 90000 });
            console.log(`Navigation completed for key: ${key}. Time taken: ${Date.now() - navigationStartTime}ms`);

            console.log(`Waiting for map to load for key: ${key}`);
            const mapLoadStartTime = Date.now();
            await page.waitForFunction(
                () => !document.querySelector('.ui.active.dimmer.loadingVerifyMountpoint') || 
                       document.querySelector('.ui.active.dimmer.loadingVerifyMountpoint').style.display === 'none',
                { timeout: 90000 }
            );
            console.log(`Map loaded successfully for key: ${key}. Time taken: ${Date.now() - mapLoadStartTime}ms`);

            console.log(`Typing miner key: ${key}`);
            const typingStartTime = Date.now();
            await page.type('#mount_query', key);
            console.log(`Miner key typed for: ${key}. Time taken: ${Date.now() - typingStartTime}ms`);

            console.log(`Waiting for miner table to load for key: ${key}`);
            const tableLoadStartTime = Date.now();
            await page.waitForSelector('.mineTableColumn', { timeout: 90000 });
            console.log(`Miner table loaded for key: ${key}. Time taken: ${Date.now() - tableLoadStartTime}ms`);

            console.log(`Setting up data extraction for key: ${key}`);
            const extractionSetupStartTime = Date.now();
            await page.evaluate(() => {
                if (Meteor && Meteor.connection) {
                    const originalCall = Meteor.call;
                    Meteor.call = function(name) {
                        const args = Array.from(arguments);
                       
                        // Check if the last argument is a callback
                        const lastArg = args[args.length - 1];
                        if (typeof lastArg === 'function') {
                            args[args.length - 1] = function(error, result) {
                                //console.log('Meteor Method Response:', name, { error, result });
                                if (name === 'getRealData') {
                                    //console.log("updating data")
                                    window.lastData = result
                                } else if ( name == 'getOnLine3DayMiners' ) {
                                    window.lastUptimeData = result
                                }

                                lastArg(error, result);
                            };


                        } else {
                            // If no callback, use a promise to log the response
                            const promise = originalCall.apply(this, args);
                            promise.then(
                                result => console.log('Meteor Method Response (Promise):', name, { result }),
                                error => console.log('Meteor Method Error (Promise):', name, { error })
                            );
                            return promise;
                        }
                        
                        return originalCall.apply(this, args);
                    };
                }
            });
            console.log(`Data extraction setup completed for key: ${key}. Time taken: ${Date.now() - extractionSetupStartTime}ms`);

            const getLastData = async () => {
                return await page.evaluate(() => ({
                    ...window.lastData,
                    hourly: window.lastUptimeData
                }));
            };

            console.log(`Clicking on miner row for key: ${key}`);
            const clickStartTime = Date.now();
            await page.evaluate((key) => {
                const rows = document.querySelectorAll('tr.mineTableColumn');
                for (let row of rows) {
                    if (row.firstElementChild.textContent.includes(key)) {
                        row.firstElementChild.click();
                        break;
                    }
                }
            }, key);
            console.log(`Miner row clicked for key: ${key}. Time taken: ${Date.now() - clickStartTime}ms`);

            console.log(`Setting up data polling interval for key: ${key}`);
            const intervalId = setInterval(async () => {
                try {
                    const newData = await getLastData();
                    const existingData = latestSatelliteData.get(hashedKey);
                    
                    if ( (!existingData && newData) || (newData && existingData && newData.lastPacketTime !== existingData.lastPacketTime) ) {
                        console.log(`Updating data for key: ${key}`);
                        latestSatelliteData.set(hashedKey, newData);
                    }
                } catch (error) {
                    console.error(`Error extracting data for ${key}:`, error);
                    clearInterval(intervalId);
                    await browser.close();
                    console.log(`Scheduling browser restart for key: ${key}`);
                    setTimeout(() => setupProcess(), 30000);
                }
            }, 1000);

            console.log(`Setting up browser refresh interval for key: ${key}`);
            const refreshIntervalId = setInterval(async () => {
                console.log(`Refreshing browser for key: ${key}`);
                await refreshBrowser(key);
            }, REFRESH_INTERVAL);

            activeBrowsers.set(key, { browser, page, intervalId, refreshIntervalId });
            console.log(`Listener for ${key} started successfully. Total setup time: ${Date.now() - startTime}ms`);
        } catch (error) {
            console.error(`Error setting up browser for ${key}:`, error);
            console.log(`Scheduling retry for key: ${key}`);
            setTimeout(() => setupProcess(), 30000);
        } finally {
            setupInProgress.delete(key);
            console.log(`Setup process completed for key: ${key}. Total time: ${Date.now() - startTime}ms`);
        }
    };

    await setupProcess();
}

async function refreshBrowser(key) {
    if (activeBrowsers.has(key)) {
        const { browser, page, intervalId, refreshIntervalId } = activeBrowsers.get(key);
        clearInterval(intervalId);
        await browser.close();
        activeBrowsers.delete(key);

        // Re-setup the browser and page
        await setupBrowserAndPage(key);
    }
}

async function shutdownBrowser(key) {
    if (activeBrowsers.has(key)) {
        const { browser, intervalId, refreshIntervalId } = activeBrowsers.get(key);
        clearInterval(intervalId);
        clearInterval(refreshIntervalId);
        await browser.close();
        activeBrowsers.delete(key);

        const hashedKey = crypto.createHash('sha256').update(key).digest('hex');
        latestSatelliteData.delete(hashedKey);
        lastActivityTime.delete(key);

        console.log(`Stopped listening for key: ${key}`);
    }
}

function updateLastActivityTime(key) {
    lastActivityTime.set(key, Date.now());
}

//Check for inactivity and shutdown browser
setInterval(() => {
    const now = Date.now();
    for (const [key, lastActivity] of lastActivityTime.entries()) {
        if (now - lastActivity > INACTIVITY_TIMEOUT) {
            console.log(`Inactivity timeout reached for key: ${key}`);
            shutdownBrowser(key);
        }
    }
}, 60000); // Check every minute

app.get('/api/listen', async (req, res) => {
    const { key } = req.query;
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }

    if (activeBrowsers.has(key) || setupInProgress.has(key)) {
        return res.status(400).json({ error: 'Browser already listening or setup in progress for this key' });
    }

    try {
        setupBrowserAndPage(key);
        updateLastActivityTime(key);
        res.json({ message: `Started listening for key: ${key}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to start browser' });
    }
});

app.get('/api/shutdown', async (req, res) => {
    const { key } = req.query;

    console.log('Shutdown request received for key:', key);

    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }

    if (!activeBrowsers.has(key)) {
        return res.status(404).json({ error: 'No active browser found for this key' });
    }

    try {
        await shutdownBrowser(key);
        res.json({ message: `Stopped listening for key: ${key}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to stop browser' });
    }
});

app.get('/api/stats', async (req, res) => {
    const { key, autostart = 'false' } = req.query;
    if (!key) {
        return res.status(400).json({ error: 'Key is required (last 5 chars in SN)' });
    }

    const hashedKey = crypto.createHash('sha256').update(key).digest('hex');

    if (!activeBrowsers.has(key) && !setupInProgress.has(key)) {
        if (autostart.toLowerCase() === 'true') {
            try {
                await setupBrowserAndPage(key);
            } catch (error) {
                return res.status(500).json({ error: 'Failed to start monitoring' });
            }
        } else {
            return res.status(404).json({ error: `Miner with key '${key}' is not monitored. Start monitor by calling /api/listen?key=${key} or use autostart=true parameter` });
        }
    }

    updateLastActivityTime(key);

    // Wait for data to be available (max 30 seconds)
    let retries = 45;
    while (retries > 0 && !latestSatelliteData.has(hashedKey)) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        retries--;
    }

    let data = latestSatelliteData.get(hashedKey);
    
    if (!data) {
        return res.status(404).json({ error: `No data available for key '${key}' after 30 seconds` });
    }

        // Additional 5-second wait for effective satellites update
    let effectiveSatellites = countEffectiveSats(data);
    
    if (effectiveSatellites === 0) {
        for (let i = 0; i < 5; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            data = latestSatelliteData.get(hashedKey);
            effectiveSatellites = countEffectiveSats(data);
            if (effectiveSatellites > 0) break;
        }
    }

    const response = {
        total_satellites: data.satelliteNum,
        effective_satellites: countEffectiveSats(data),
        last_packet_time: data.lastPacketTime,
        dataByte: data.dataByte,
        latency: data.latency,
        satInfo: aggregateSatInfo(data),
        hourlyData: processHourlyData(data.hourly),
    };

    res.json(response);
});



app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
});

process.on('SIGINT', async () => {
    console.log('Shutting down gracefully');
    for (const [key, { browser, intervalId, refreshIntervalId }] of activeBrowsers.entries()) {
        clearInterval(intervalId);
        clearInterval(refreshIntervalId);
        await browser.close();
    }
    activeBrowsers.clear();
    latestSatelliteData.clear();
    lastActivityTime.clear();
    process.exit();
});
