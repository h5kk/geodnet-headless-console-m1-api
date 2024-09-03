const puppeteer = require('puppeteer');
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

    if (setupInProgress.has(key)) {
        console.log(`Setup already in progress for key: ${key}`);
        return;
    }

    setupInProgress.add(key);
    console.log(`Setting up browser for key: ${key}`);

    const setupProcess = async () => {
        try {
            //launch browser
            const browser = await puppeteer.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
                // defaultViewport: null,
                // args: ['--start-maximized']
            });

            const page = await browser.newPage();

            //load geodnet console, map
            await page.goto('https://console.geodnet.com/map',
                { timeout: 90000 }
            );

            // Wait for the loading dimmer to become hidden
            console.log("waiting for map")
            await page.waitForFunction(
                () => !document.querySelector('.ui.active.dimmer.loadingVerifyMountpoint') || 
                       document.querySelector('.ui.active.dimmer.loadingVerifyMountpoint').style.display === 'none',
                { timeout: 90000 }
            );
            console.log("loaded map")


            await page.type('#mount_query', key);

            await page.waitForSelector('.mineTableColumn', { timeout: 90000 });


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

            const getLastData = async () => {
                return await page.evaluate(() => ({
                    ...window.lastData,
                    hourly: window.lastUptimeData
                }));
            };

            await page.evaluate((key) => {
                const rows = document.querySelectorAll('tr.mineTableColumn');
                for (let row of rows) {
                    if (row.firstElementChild.textContent.includes(key)) {
                        row.firstElementChild.click();
                        break;
                    }
                }
            }, key);

            const intervalId = setInterval(async () => {
                try {
                    const newData = await getLastData();
                    const existingData = latestSatelliteData.get(hashedKey);
                    
                    if ( (!existingData && newData) || (newData && existingData && newData.lastPacketTime !== existingData.lastPacketTime) ) {
                        latestSatelliteData.set(hashedKey, newData);
                    }

                } catch (error) {
                    console.error(`Error extracting data for ${key}:`, error);
                    clearInterval(intervalId);
                    await browser.close();
                    setTimeout(() => setupProcess(), 30000); // Restart after 30 seconds
                }
            }, 1000);

            const refreshIntervalId = setInterval(async () => {
                console.log(`Refreshing browser for key: ${key}`);
                await refreshBrowser(key);
            }, REFRESH_INTERVAL);

            activeBrowsers.set(key, { browser, page, intervalId, refreshIntervalId });
            console.log(`Listener for ${key} started successfully.`);
        } catch (error) {
            console.error(`Error setting up browser for ${key}:`, error);
            setTimeout(() => setupProcess(), 30000); // Retry setup after 30 seconds
        } finally {
            setupInProgress.delete(key);
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
