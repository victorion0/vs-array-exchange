# VS-Array-Exchange

A Node.js + Express API that fetches country data, exchange rates, and estimates GDP values. Stores and manages the data in a MySQL database.  

---

## Features

- Fetches all countries from [REST Countries API](https://restcountries.com/)  
- Retrieves USD exchange rates from [ExchangeRate API](https://open.er-api.com/)  
- Calculates estimated GDP based on population and exchange rate  
- CRUD operations on country data via RESTful endpoints  
- Status endpoint to monitor total countries and last refresh  
- CORS enabled for front-end integration  

---

## Installation

1. Clone the repository:  
```bash
git clone https://github.com/your-username/vs-array-exchange.git
cd vs-array-exchange
