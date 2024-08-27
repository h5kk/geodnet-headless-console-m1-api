docker stop geodnet-api
docker rm geodnet-api
docker run -d -p 3000:3000 --name geodnet-api --restart unless-stopped geodnet-scraper-api
