const ccxt = require('ccxt');
const moment = require('moment');
const fs = require('fs');

const binance = new ccxt.binance({
    apiKey: 'YOUR_API_KEY',
    secret: 'YOUR_SECRET_KEY',
    enableRateLimit: true,
});

binance.setSandboxMode(true);

let currentPosition = null;
let currentOrders = 0;
let lastOrderTime = null;
let balance = { BTC: 1, USDT: 10000 }; // Giả lập số dư ban đầu

async function getBalance(btcPrice) {
    console.log(`Balance BTC: ${balance.BTC}, USDT: ${balance.USDT}`);
    console.log(`USD: ${(balance.BTC - 1) * btcPrice + balance.USDT}`);
}

function calculateSMA(prices, period) {
    const sma = prices.map((price, index, array) => {
        if (index < period - 1) return null;
        const subset = array.slice(index - period + 1, index + 1);
        const sum = subset.reduce((acc, value) => acc + value, 0);
        return sum / period;
    });
    return sma;
}

function executeOrder(direction, quantity, price) {
    if (direction === 'buy') {
        balance.BTC += quantity;
        balance.USDT -= quantity * price;
    } else if (direction === 'sell') {
        balance.BTC -= quantity;
        balance.USDT += quantity * price;
    }
    console.log(`${moment().format()}. ${direction} ${quantity} BTC at ${price} USDT`);
    currentOrders += 1;
    lastOrderTime = new Date();
}

async function backtest() {
    const now = moment();
    const oneMonthAgo = moment().subtract(1, 'months');

    let since = binance.parse8601(oneMonthAgo.format());
    const ohlcv = [];

    while (since < binance.parse8601(now.format())) {
        const newData = await binance.fetchOHLCV('BTC/USDT', '1m', since, 1000);
        ohlcv.push(...newData);
        since = newData[newData.length - 1][0] + 60000; // 1 minute in milliseconds
    }

    const closes = ohlcv.map(candle => candle[4]);

    for (let i = 0; i < closes.length; i++) {
        const shortSMA = calculateSMA(closes.slice(0, i + 1), 10);
        const longSMA = calculateSMA(closes.slice(0, i + 1), 30);

        const lastShortSMA = shortSMA[shortSMA.length - 1];
        const lastLongSMA = longSMA[longSMA.length - 1];
        const prevShortSMA = shortSMA[shortSMA.length - 2];
        const prevLongSMA = longSMA[longSMA.length - 2];
        const lastPrice = closes[i];

        let direction = null;

        if (prevShortSMA <= prevLongSMA && lastShortSMA > lastLongSMA) {
            direction = 'buy';
        } else if (prevShortSMA >= prevLongSMA && lastShortSMA < lastLongSMA) {
            direction = 'sell';
        }

        const now = new Date();

        if (direction && direction !== currentPosition && currentOrders < 5 && (!lastOrderTime || (now - lastOrderTime) >= 60000)) {
            const TRADE_SIZE = 100;
            const quantity = TRADE_SIZE / lastPrice;
            executeOrder(direction, quantity, lastPrice);
            currentPosition = direction;
        }
    }

    const finalPrice = closes[closes.length - 1];
    getBalance(finalPrice);
}

backtest();
