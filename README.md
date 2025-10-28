# VS Array Exchange API

A Node.js + Express API to fetch, store, and display country data along with exchange rates and GDP estimates.

## Features

- Fetches country data from [REST Countries API](https://restcountries.com/).
- Fetches USD exchange rates from [Open Exchange Rates API](https://open.er-api.com/).
- Calculates estimated GDP for each country.
- Stores data in MySQL database.
- Generates a summary image of total countries and top 5 countries by GDP.

## Endpoints

### POST `/countries/refresh`
Fetch and save all countries, update exchange rates, and calculate estimated GDP. Also generates a summary image.

**Response:**
```json
{ "message": "Countries refreshed successfully" }
