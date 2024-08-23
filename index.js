const puppeteer = require('puppeteer');
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;

const activeBrowsers = new Map();
const latestSatelliteData = new Map();

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

    const setupProcess = async () => {
        try {
            const browser = await puppeteer.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
                // defaultViewport: null,
                // args: ['--start-maximized']
            });

            const page = await browser.newPage();

            await page.goto('https://console.geodnet.com/map');

            await page.waitForSelector('#mount_query', { timeout: 90000 });

            await page.type('#mount_query', key);

            await page.waitForSelector('.mineTableColumn');


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

            activeBrowsers.set(key, { browser, page });
            console.log(`Listener for ${key} started successfully.`);
        } catch (error) {
            console.error(`Error setting up browser for ${key}:`, error);
            setTimeout(() => setupProcess(), 30000); // Retry setup after 30 seconds
        }
    };

    await setupProcess();
}

app.get('/api/listen', async (req, res) => {
    const { key } = req.query;
    if (!key) {
        return res.status(400).json({ error: 'Key is required' });
    }

    if (activeBrowsers.has(key)) {
        return res.status(400).json({ error: 'Browser already listening for this key' });
    }

    try {
        setupBrowserAndPage(key);
        res.json({ message: `Started listening for key: ${key}` });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to start browser' });
    }
});

app.get('/api/stats', (req, res) => {
    const { key } = req.query;
    if (!key) {
        return res.status(400).json({ error: 'Key is required (last 5 chars in SN)' });
    }

    const hashedKey = crypto.createHash('sha256').update(key).digest('hex');
    const data = latestSatelliteData.get(hashedKey);
    
    if (!data) {
        return res.status(404).json({ error: `Miner with key '${key}' is not monitored (or have not come up yet). Start monitor by calling /api/listen?key=${key}` });
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
    for (const { browser, intervalId } of activeBrowsers.values()) {
        clearInterval(intervalId);
        await browser.close();
    }
    process.exit();
});
