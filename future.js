const ccxt = require('ccxt');
const moment = require('moment');

const binance = new ccxt.binance({
    apiKey: 'AkOfGwyvvVTy0y64eIAVzgIoF75R25yUcfkz0q1z3e01im2s5ZLFKodU52GGlBNb',
    secret: 'GLaQciUGnqoZZN3kGzOHwr2B4buyzIzEM380jPjpPxBP4nfz9J2MB0apkbME4nHP',
    enableRateLimit: true,
});

binance.setSandboxMode(true);

let balance = { USDT: 1000 }; // Giả lập số dư ban đầu cho USDT trên futures
let currentOrders = 0;
let lastOrderTime = null;
let orderDetails = [];

async function getBalance() {
    console.log(`Balance USDT: ${balance.USDT}`);
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

function executeOrder(direction, quantity, price, close) {
    const order = {
        direction,
        quantity,
        entryPrice: price,
        closePrice: null,
        status: 'open'
    };
    orderDetails.push(order);
    currentOrders += 1;
    lastOrderTime = new Date();

    if (direction === 'buy') {
        balance.USDT -= quantity * price;
    } else if (direction === 'sell') {
        balance.USDT += quantity * price;
    }
}

function closeOrder(order, closePrice) {
    order.status = 'closed';
    order.closePrice = closePrice;
    currentOrders -= 1;

    const profitOrLoss = order.direction === 'buy'
        ? (closePrice - order.entryPrice) * order.quantity
        : (order.entryPrice - closePrice) * order.quantity;

    balance.USDT += profitOrLoss;

    return profitOrLoss;
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

        if (direction && currentOrders < 5 && (!lastOrderTime || (now - lastOrderTime) >= 60000)) {
            const TRADE_SIZE_PERCENT = 0.1; // 10%
            const tradeSize = balance.USDT * TRADE_SIZE_PERCENT;
            const quantity = tradeSize / lastPrice;
            executeOrder(direction, quantity, lastPrice);
        }

        // Check and close orders based on profit/loss criteria
        for (let order of orderDetails) {
            if (order.status === 'open') {
                const profitOrLoss = order.direction === 'buy'
                    ? (lastPrice - order.entryPrice) * order.quantity
                    : (order.entryPrice - lastPrice) * order.quantity;
                const profitOrLossPercent = profitOrLoss / (order.entryPrice * order.quantity);

                if (profitOrLossPercent > 0.01 || (currentOrders === 5 && profitOrLossPercent < -0.01)) {
                    closeOrder(order, lastPrice);
                }
            }
        }
    }

    const finalPrice = closes[closes.length - 1];
    getBalance(finalPrice);
}

backtest();
