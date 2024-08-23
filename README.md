This is a project to enable a simple API for personal use to monitor your own Geodnet miners.

It launches a headless chrome which navigates to https://console.geodnet.com/map and then fetches the data that is public in the sidebar when clicking a specific miner.
It does NOT require any login credentials, wallet information or other personal information. You can monitor whichever miner you want to.

If someone claims to require any other information to use this API, watch out for scammers.

To enable the API for a miner you need to do a HTTP GET request to 
http://{ip}:{port}/api/listen?key=1234A
where 1234A is the last 5 in your miner serial number.

It will take about 20-30 seconds to launch before you can start fetching the data from 
http://{ip}:{port}/api/stats?key=1234A

The application works that it monkey patches Meteor, the library that Geodnet console uses for fetching data, then just proxies the data through a custom function to store the same data in the application, when requesting the data it will always respond with the latest data.
Requesting the data from the API more often, does not increase any load on Geodnet servers, it will just use the cache.

If you want to see what actually happens, you can run the browser in a visible state by changing headless flag to true in index.js where puppeteer is initialized
