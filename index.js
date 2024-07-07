const ccxt = require('ccxt');
const moment = require('moment');
const WebSocket = require('ws');

const binance = new ccxt.binance({
    apiKey: 'AkOfGwyvvVTy0y64eIAVzgIoF75R25yUcfkz0q1z3e01im2s5ZLFKodU52GGlBNb',
    secret: 'GLaQciUGnqoZZN3kGzOHwr2B4buyzIzEM380jPjpPxBP4nfz9J2MB0apkbME4nHP',
    enableRateLimit: true,
});

binance.setSandboxMode(true);

let currentPosition = null; // Lưu trữ trạng thái hiện tại của vị trí (mua hoặc bán)
let currentOrders = 0; // Theo dõi số lượng lệnh hiện tại
let lastOrderTime = null; // Theo dõi thời gian của lệnh cuối cùng

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

async function checkTradingSignal() {
    const ohlcv = await binance.fetchOHLCV('BTC/USDT', '1m', undefined, 50); // Fetch last 50 minutes of data
    const closes = ohlcv.map(candle => candle[4]);

    const shortSMA = calculateSMA(closes, 10); // 10-period SMA for short-term trend
    const longSMA = calculateSMA(closes, 30); // 30-period SMA for long-term trend

    const lastShortSMA = shortSMA[shortSMA.length - 1];
    const lastLongSMA = longSMA[longSMA.length - 1];
    const prevShortSMA = shortSMA[shortSMA.length - 2];
    const prevLongSMA = longSMA[longSMA.length - 2];
    const lastPrice = closes[closes.length - 1];


    let direction = null;

    // Kiểm tra tín hiệu cắt lên (mua)
    if (prevShortSMA <= prevLongSMA && lastShortSMA > lastLongSMA) {
        direction = 'buy';
    }
    // Kiểm tra tín hiệu cắt xuống (bán)
    else if (prevShortSMA >= prevLongSMA && lastShortSMA < lastLongSMA) {
        direction = 'sell';
    }

    const now = new Date();

    // Kiểm tra các điều kiện trước khi thực hiện lệnh
    if (direction && direction !== currentPosition && currentOrders < 5 && (!lastOrderTime || (now - lastOrderTime) >= 60000)) {
        const TRADE_SIZE = 100;
        const quantity = TRADE_SIZE / lastPrice;
        const order = await binance.createMarketOrder('BTC/USDT', direction, quantity);
        console.log(`${moment().format()}. ${direction} ${quantity} BTC at ${lastPrice} USDT`);
        await getBalance(lastPrice);

        currentPosition = direction; // Cập nhật trạng thái hiện tại của vị trí
        currentOrders += 1; // Tăng số lượng lệnh hiện tại
        lastOrderTime = now; // Cập nhật thời gian của lệnh cuối cùng
    }
}

// Sử dụng WebSocket API của Binance để theo dõi giá theo thời gian thực
const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');

ws.on('message', async (message) => {
    const data = JSON.parse(message);
    // Khi có sự thay đổi giá, kiểm tra tín hiệu giao dịch
    await checkTradingSignal();
});

ws.on('error', (error) => {
    console.error(`WebSocket error: ${error.message}`);
});

ws.on('close', () => {
    console.log('WebSocket connection closed');
});
