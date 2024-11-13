const puppeteer = require('puppeteer');
const express = require('express');
const crypto = require('crypto');
const cors = require('cors');

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;

const REFRESH_INTERVAL = parseInt(process.env.REFRESH_INTERVAL || '60') * 60 * 1000;
const INACTIVITY_TIMEOUT = parseInt(process.env.INACTIVITY_TIMEOUT || '5') * 60 * 1000;

const activeBrowsers = new Map();
const latestSatelliteData = new Map();
const lastActivityTime = new Map();
const setupInProgress = new Set();

// Platform-specific browser configuration
const getPlatformSpecificLaunchOptions = () => ({
    args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-zygote',
        '--disable-audio-output'
    ],
    headless: "new",
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
});

// Existing helper functions remain the same
function countEffectiveSats(data, snrThreshold = 32) {
    const satSystems = ['satinfoG', 'satinfoR', 'satinfoE', 'satinfoC'];
    
    return satSystems.reduce((count, system) => {
        if (!data.hasOwnProperty('satInfo') || data.satInfo.hasOwnProperty('system') || !Array.isArray(data.satInfo[system])) {
            return count;
        }
        return count + data.satInfo[system].filter(sat => sat.snr >= snrThreshold).length;
    }, 0);
}

function aggregateSatInfo(data) {
    const result = [];
    if (!data || !data.satInfo) {
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
    if (!data || !data.xData) {
        return null;
    }

    return data.xData.map((dateTime, index) => {
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
    console.log(`Setting up browser for key: ${key}`);

    if (setupInProgress.has(key)) {
        console.log(`Setup already in progress for key: ${key}`);
        return;
    }

    setupInProgress.add(key);

    try {
        const browser = await puppeteer.launch(getPlatformSpecificLaunchOptions());
        const page = await browser.newPage();
        
        // Set a reasonable viewport size
        await page.setViewport({ width: 1280, height: 800 });

        // Add error handling for navigation
        await page.goto('https://console.geodnet.com/map', { 
            timeout: 90000,
            waitUntil: ['domcontentloaded', 'networkidle2']
        });

        await page.waitForFunction(
            () => !document.querySelector('.ui.active.dimmer.loadingVerifyMountpoint') || 
                   document.querySelector('.ui.active.dimmer.loadingVerifyMountpoint').style.display === 'none',
            { timeout: 90000 }
        );

        await page.type('#mount_query', key);
        await page.waitForSelector('.mineTableColumn', { timeout: 90000 });

        // Setup data extraction
        await page.evaluate(() => {
            if (Meteor && Meteor.connection) {
                const originalCall = Meteor.call;
                Meteor.call = function(name) {
                    const args = Array.from(arguments);
                    const lastArg = args[args.length - 1];
                    if (typeof lastArg === 'function') {
                        args[args.length - 1] = function(error, result) {
                            if (name === 'getRealData') {
                                window.lastData = result;
                            } else if (name == 'getOnLine3DayMiners') {
                                window.lastUptimeData = result;
                            }
                            lastArg(error, result);
                        };
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

        // Click on miner row
        await page.evaluate((key) => {
            const rows = document.querySelectorAll('tr.mineTableColumn');
            for (let row of rows) {
                if (row.firstElementChild.textContent.includes(key)) {
                    row.firstElementChild.click();
                    break;
                }
            }
        }, key);

        // Setup data polling
        const intervalId = setInterval(async () => {
            try {
                const newData = await getLastData();
                if (newData) {
                    latestSatelliteData.set(hashedKey, newData);
                }
            } catch (error) {
                console.error(`Error extracting data for ${key}:`, error);
                clearInterval(intervalId);
                await browser.close();
                setTimeout(() => setupBrowserAndPage(key), 30000);
            }
        }, 1000);

        // Setup browser refresh
        const refreshIntervalId = setInterval(async () => {
            console.log(`Refreshing browser for key: ${key}`);
            await refreshBrowser(key);
        }, REFRESH_INTERVAL);

        activeBrowsers.set(key, { browser, page, intervalId, refreshIntervalId });
        console.log(`Listener for ${key} started successfully`);

    } catch (error) {
        console.error(`Error setting up browser for ${key}:`, error);
        setTimeout(() => setupBrowserAndPage(key), 30000);
    } finally {
        setupInProgress.delete(key);
    }
}

// Rest of the code (API endpoints, etc.) remains the same

process.on('SIGTERM', async () => {
    console.log('Received SIGTERM. Shutting down gracefully...');
    for (const [key, { browser, intervalId, refreshIntervalId }] of activeBrowsers.entries()) {
        clearInterval(intervalId);
        clearInterval(refreshIntervalId);
        await browser.close();
    }
    process.exit(0);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Server running at http://0.0.0.0:${port}`);
});