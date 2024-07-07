const ccxt = require('ccxt');
const moment = require('moment');
const WebSocket = require('ws');

const binance = new ccxt.binance({
    apiKey: 'AkOfGwyvvVTy0y64eIAVzgIoF75R25yUcfkz0q1z3e01im2s5ZLFKodU52GGlBNb',
    secret: 'GLaQciUGnqoZZN3kGzOHwr2B4buyzIzEM380jPjpPxBP4nfz9J2MB0apkbME4nHP',
    enableRateLimit: true,
});

binance.setSandboxMode(true);

let currentPosition = null;
let currentOrders = 0;
let lastOrderTime = null;
let openOrders = [];
let lastCheckedTime = new Date().getTime(); // Thời gian lần kiểm tra cuối cùng

async function getBalance(btcPrice) {
    const balance = await binance.fetchBalance();
    const total = balance.total;
    console.log(`Balance BTC: ${total.BTC}, USDT: ${total.USDT}`);
    console.log(`USD: ${(total.BTC - 1) * btcPrice + total.USDT}`);
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
    const order = {
        direction,
        quantity,
        entryPrice: price,
        closePrice: null,
        status: 'open'
    };
    openOrders.push(order);
    currentOrders += 1;
    lastOrderTime = new Date();
}

function closeOrder(order, closePrice) {
    order.status = 'closed';
    order.closePrice = closePrice;
    currentOrders -= 1;

    const profitOrLoss = order.direction === 'buy'
        ? (closePrice - order.entryPrice) * order.quantity
        : (order.entryPrice - closePrice) * order.quantity;

    console.log(`Order closed: ${order.direction} ${order.quantity} BTC at ${closePrice} USDT, P/L: ${profitOrLoss} USDT`);
}

async function checkTradingSignal() {
    const now = new Date().getTime();
    if (now - lastCheckedTime < 5000) { // Chỉ kiểm tra mỗi 5 giây
        return;
    }
    lastCheckedTime = now;

    const ohlcv = await binance.fetchOHLCV('BTC/USDT', '1m', undefined, 50);
    const closes = ohlcv.map(candle => candle[4]);

    const shortSMA = calculateSMA(closes, 10);
    const longSMA = calculateSMA(closes, 30);

    const lastShortSMA = shortSMA[shortSMA.length - 1];
    const lastLongSMA = longSMA[longSMA.length - 1];
    const prevShortSMA = shortSMA[shortSMA.length - 2];
    const prevLongSMA = longSMA[longSMA.length - 2];
    const lastPrice = closes[closes.length - 1];

    let direction = null;

    if (prevShortSMA <= prevLongSMA && lastShortSMA > lastLongSMA) {
        direction = 'buy';
    } else if (prevShortSMA >= prevLongSMA && lastShortSMA < lastLongSMA) {
        direction = 'sell';
    }

    if (direction && direction !== currentPosition && currentOrders < 5 && (!lastOrderTime || (now - lastOrderTime) >= 60000)) {
        const TRADE_SIZE = 100;
        const quantity = TRADE_SIZE / lastPrice;
        executeOrder(direction, quantity, lastPrice);
        console.log(`${moment().format()}. ${direction} ${quantity} BTC at ${lastPrice} USDT current order ${currentOrders}`);
        await getBalance(lastPrice);

        currentPosition = direction;
    }

    for (let order of openOrders) {
        if (order.status === 'open') {
            const profitOrLoss = order.direction === 'buy'
                ? (lastPrice - order.entryPrice) * order.quantity
                : (order.entryPrice - lastPrice) * order.quantity;
            const profitOrLossPercent = profitOrLoss / (order.entryPrice * order.quantity);

            if (profitOrLossPercent > 0.01 || profitOrLossPercent < -0.01) {
                closeOrder(order, lastPrice);
            }
        }
    }
}

const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

ws.on('message', async (message) => {
    const data = JSON.parse(message);
    await checkTradingSignal();
});

ws.on('error', (error) => {
    console.error(`WebSocket error: ${error.message}`);
});

ws.on('close', () => {
    console.log('WebSocket connection closed');
});
