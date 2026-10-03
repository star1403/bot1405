// engines/bot-engine.js
// ============================================================
// SmartChef Trading Bot Engine - Multi-User Server Version
// Based on bot-wallex-v4-100usdt.js (Version 4.0.0)
// + Deposit System (2 USDT minimum, 20% share deducted from deposit)
// ============================================================

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const hwmEngine = require('./hwm-engine');
const {
    recordTrade, getUserById,
    deductShareFromDeposit, isBotLocked
} = require('../database');

const VERBOSE = false;

// ============================================================
// CONSTANTS (from original bot - UNCHANGED)
// ============================================================
const WALLEX_API_BASE = process.env.WALLEX_API_BASE || 'https://api.wallex.ir';
const ALTFINS_API_BASE = 'https://altfins.com';
const SHARED_ALTFINS_API_KEY = process.env.ALTFINS_API_KEY || '';

const FEES = {
  USDT: { buy: 0.0013, sell: 0.0013 },
  TMN:  { buy: 0.0030, sell: 0.0030 }
};

const CONVERSION_FEES = {
  USDT_TO_TMN: 0.0013,
  TMN_TO_USDT: 0.0030
};

const MIN_ORDER = {
  USDT: 1.2,
  TMN: 50000
};

const ARB_CONFIG = {
  enabled: true,
  preferBetterMarket: true,
  minGrossUsdtToUsdt: 0.35,
  minGrossTmnToTmn: 0.55,
  minGrossCrossMarket: 0.45,
  minNetTmnPercent: 0.25,
  minNetUsdtFromTmnPercent: 0.25,
  tmnLockMsAfterLoss: 45 * 60 * 1000
};

const MIN_GROUP_NET_USDT = 0.003;

const DAILY_RISK = {
  maxDailyLossUsdt: 4,
  maxDailyLossPercent: 4,
  maxOpenPositions: 10,
  maxCapitalPercent: 60,
  minFreeUsdtToBuy: 1.3
};

const TRADE_SAFETY = {
    minLiquidityMultiplier: 2.0,
    minLiquidityMultiplierSell: 3.0,
    orderBookLevels: 10,
    requireActiveMarket: true,
    requireValidPrice: true,
    requirePositiveNetOnSell: true,
    requireSellLiquidityCheck: true,
    maxSpreadPercent: 1.2,
    minQuoteVolume24h: 2500,
    minBidDepthUsdt: 80,
    minAskDepthUsdt: 80
};

const DEFAULT_TEST_BALANCE = 100;

const EXIT_CONFIG = {
    confirmationCount: 5,
    minProfitPercent: 0.5,
    checkOnEveryTick: true
};

const BUY_FAIL_COOLDOWN_MS = 3 * 60 * 1000;
const MAX_FAILS = 2;
const BACKUP_INTERVAL = 2500;
const PRICE_CACHE_TTL_MS = 1800;
const DUST_EPSILON = 1e-10;

// ============================================================
// MARKET REGIME SETTINGS
// ============================================================
const BEAR_SETTINGS = {
    firstDrop: 0.4, lastDrop: 16,
    stepAmounts: [1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.1],
    name: 'BEAR', icon: 'B',
    emergencySteps: {
        drops: [17, 19, 21, 23.5, 26],
        capitals: [1.8, 1.7, 1.6, 1.5, 1.4]
    }
};

const BULL_SETTINGS = {
    firstDrop: 0.35, lastDrop: 6.5,
    stepAmounts: [1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2.0, 2.05, 2.1, 2.15],
    name: 'BULL', icon: 'U',
    emergencySteps: {
        drops: [7, 8, 9.5, 11, 12.5],
        capitals: [1.4, 1.35, 1.3, 1.25, 1.2]
    }
};

const SIDEWAYS_SETTINGS = {
    firstDrop: 0.4, lastDrop: 9.5,
    stepAmounts: [1.2, 1.25, 1.3, 1.35, 1.4, 1.45, 1.5, 1.55, 1.6, 1.65, 1.7, 1.75, 1.8, 1.85, 1.9, 1.95, 2.0, 2.05, 2.1, 2.15],
    name: 'SIDEWAYS', icon: 'S',
    emergencySteps: {
        drops: [10, 11.5, 13, 14.5, 16],
        capitals: [1.6, 1.55, 1.5, 1.45, 1.4]
    }
};

const KNOWN_TRENDING_TOKENS = [
  '1INCH', 'AAVE', 'ADA', 'AIOZ', 'ALGO', 'ANKR', 'APE', 'APT', 'AR', 'ARB',
  'AVAX', 'AXS', 'BCH', 'BLUR', 'BNB', 'BONK', 'CAKE', 'COPXON', 'CRO', 'CRV',
  'DASH', 'DOGE', 'DOGS', 'DOT', 'EGLD', 'ELON', 'ENJ', 'ETH', 'FIL', 'FLOKI',
  'FTM', 'GALA', 'GMX', 'GRAM', 'HBAR', 'HYPE', 'ICP', 'IMX', 'INJ', 'JUP',
  'KAVA', 'LDO', 'LINK', 'LTC', 'MAGA', 'MAJOR', 'MANA', 'MATIC', 'MKR', 'NEAR',
  'NOT', 'NVDAX', 'OP', 'PAXG', 'PENGU', 'PEPE', 'POL', 'PPLTON', 'QNT', 'RPL',
  'RUNE', 'S', 'SAND', 'SEI', 'SHIB', 'SLVON', 'SNX', 'SOL', 'STX', 'SUI',
  'SUSHI', 'THETA', 'TIA', 'TON', 'TRUMP', 'TRX', 'UNI', 'UNGON', 'VET', 'WIF',
  'WLD', 'XAUT', 'XLM', 'XMR', 'XRP', 'ZEC', 'ZIL', '1BBABYDOGE'
];

// Near-stable / pegged assets — never open new positions on these
const STABLECOIN_BLACKLIST = new Set([
  'USDT', 'USDC', 'USD', 'USDS', 'USDE', 'USDD', 'TUSD', 'FDUSD', 'DAI', 'BUSD',
  'FRAX', 'GUSD', 'USDP', 'PYUSD', 'EURC', 'EURT', 'XUSD', 'SUSD', 'LUSD',
  'UST', 'USTC', 'CUSD', 'OUSD', 'MIM', 'DOLA', 'CRVUSD', 'GHO', 'USDY',
  'TMN', 'IRT', 'RLS'
]);

// ============================================================
// SHARED ALTFINS CACHE
// ============================================================
const SHARED_CACHE_FILE = path.join(__dirname, '..', 'data', 'altfins-cache.json');

let sharedAltfinsCache = {
    signals: [],
    lastFetch: 0,
    fetchInProgress: false
};

async function loadSharedAltfinsCache() {
    try {
        const raw = await fs.readFile(SHARED_CACHE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.signals)) {
            sharedAltfinsCache = { ...sharedAltfinsCache, ...parsed };
        }
    } catch (e) {}
}

async function saveSharedAltfinsCache() {
    try {
        const dir = path.dirname(SHARED_CACHE_FILE);
        if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
        await fs.writeFile(SHARED_CACHE_FILE, JSON.stringify(sharedAltfinsCache, null, 2));
    } catch (e) {}
}

loadSharedAltfinsCache();

// ============================================================
// BOT CLASS
// ============================================================
class SmartChefBot {
    constructor(userId, apiKey, apiSecret, options = {}) {
        this.userId = userId;
        this.apiKey = apiKey;
        this.apiSecret = apiSecret || null;
        this.running = false;
        this.options = options;

        this.altfinsPersonalKey = options.altfinsPersonalKey || null;

        this.dataDir = options.dataDir || path.join(__dirname, '..', 'data', 'users', String(userId));
        this._ensureDataDir();

        this.DATA_FILE = path.join(this.dataDir, 'bot-data.json');
        this.DATA_FILE_PREV = path.join(this.dataDir, 'bot-data-prev.json');
        this.SELL_HISTORY_FILE = path.join(this.dataDir, 'sell-history.json');
        this.BUY_HISTORY_FILE = path.join(this.dataDir, 'buy-history.json');
        this.LOG_FILE = path.join(this.dataDir, 'bot-log.json');
        this.JUMP_HISTORY_FILE = path.join(this.dataDir, 'jump-history.json');

        this.state = this._defaultState();
        this.freedCapital = 0;
        this.maxConcurrentCapital = 0;
        this.maxSingleTransactionCapital = 0;
        this.buyHistory = {};
        this.botLogs = [];
        this.crisisCount = 0;

        this.connectionFailCount = 0;
        this.isConnectionHealthy = true;
        this.shouldStopTrading = false;
        this.lastBackupTime = 0;

        this.COOLDOWN_SECONDS = 300;
        this.tmnSellLockedUntil = 0;
        this.buyBlockedUntil = 0;
        this.cooldownMap = new Map();
        this.isFillingSlots = false;

        this.symbolLocks = new Set();

        this.dailyStartEquity = 0;
        this.dailyRealizedPnL = 0;
        this.dailyResetDate = '';

        this.debugLogs = [];
        this.debugLoggingEnabled = false;

        this.priceCache = new Map();
        this.marketDataCache = new Map();

        this._tableDrawing = false;

        // ⭐ Deposit lock state
        this.lockedByDeposit = false;
    }

    _defaultState() {
        return {
            activeTransactions: [],
            testBalance: 100,
            testTmnBalance: 10000000,
            settings: {
                maxConcurrent: 4,
                maxSteps: 25,
                maxTradeCapital: 10,
                sellPercentages: [],
                stepRanges: [],
                stepAmounts: [],
                completeOnlyMode: false,
                selectionMode: 'AUTO',
                jumpBuyMode: 'SINGLE',
                verboseLogging: false,
                pairSelectionCriteria: {
                    volumeWeight: 40, volatilityWeight: 10, spreadWeight: 25,
                    trendWeight: 15, liquidityWeight: 20
                },
                minimumVolume: 2500,
                minimumVolatility: 0.15,
                maximumSpread: 1.2,
                minimumPrice: 0.00000001,
                minimumTrendScore: 55,
                executionMode: process.env.MODE === 'TEST' ? 'TEST' : 'REAL',
                adaptiveMode: true,
                manualPairs: [],
                marketTrendFilter: {
                    enabled: true,
                    btcSymbol: 'BTCUSDT',
                    btcDumpPercent: 2.5,
                    btcLookbackHours: 4,
                    maxSameClusterPositions: 1,
                    correlatedTokens: {
                        'LAYER1': ['SOL', 'AVAX', 'NEAR', 'DOT', 'ADA', 'ATOM', 'EGLD', 'ICP'],
                        'DEFI':   ['UNI', 'AAVE', 'CRV', 'SUSHI', 'MKR', 'COMP', 'SNX', 'LDO'],
                        'MEME':   ['DOGE', 'SHIB', 'PEPE', 'WIF', 'BONK', 'FLOKI', 'MAGA', 'DOGS'],
                        'L2':     ['ARB', 'OP', 'MATIC', 'IMX', 'STX', 'POL', 'BLUR'],
                        'AI':     ['FET', 'AGIX', 'RNDR', 'TAO', 'WLD', 'AIOZ'],
                        'GAMING': ['SAND', 'MANA', 'AXS', 'GALA', 'ENJ', 'APE'],
                        'PAYMENT':['XRP', 'XLM', 'LTC', 'BCH', 'DASH', 'ZEC'],
                        'STABLE_BTC': ['PAXG', 'XAUT', 'NVDAX', 'SLVON', 'UNGON']
                    }
                }
            },
            sellHistory: [],
            lastUsdTmnRate: 0,
            mode: 'auto',
            pairScores: {},
            usageCount: {},
            marketRegime: 'SIDEWAYS',
            lastRegimeCheck: 0,
            priceHistory: {},
            regimeConfidence: 0,
            lastRegimeDisplay: null,
            jumpHistory: [],
            dustBalances: {}
        };
    }

    async _ensureDataDir() {
        try {
            await fs.mkdir(this.dataDir, { recursive: true });
        } catch (e) {
            logger.error(`Failed to create data dir for user ${this.userId}`, { error: e.message });
        }
    }

    // ============================================================
    // SYMBOL LOCKS
    // ============================================================
    acquireSymbolLock(symbol, timeoutMs = 30000) {
        if (this.symbolLocks.has(symbol)) return false;
        this.symbolLocks.add(symbol);
        setTimeout(() => this.symbolLocks.delete(symbol), timeoutMs);
        return true;
    }
    releaseSymbolLock(symbol) {
        this.symbolLocks.delete(symbol);
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ============================================================
    // LOGGING
    // ============================================================
    async addLog(logType, message, data = null) {
        const logEntry = { timestamp: new Date().toISOString(), type: logType, message, data };
        this.botLogs.push(logEntry);
        if (this.botLogs.length > 1000) this.botLogs = this.botLogs.slice(-1000);
        try { await fs.writeFile(this.LOG_FILE, JSON.stringify(this.botLogs, null, 2)); } catch (err) {}
        if (logType === 'ERROR') logger.error(`[User ${this.userId}] ${message}`);
        else if (logType === 'WARNING') logger.warn(`[User ${this.userId}] ${message}`);
    }

    async addDebugLog(message, data = null) {
        if (!this.debugLoggingEnabled) return;
        const entry = { timestamp: new Date().toISOString(), message, data };
        this.debugLogs.push(entry);
        if (this.debugLogs.length > 1000) this.debugLogs = this.debugLogs.slice(-1000);
    }

    async logQuiet(message, data = null) {
        await this.addLog('INFO', message, data);
        await this.addDebugLog(message, data);
    }

    logImportant(message) {
        logger.info(`[User ${this.userId}] ${message}`);
    }

    // ============================================================
    // API CALL
    // ============================================================
    async apiCall(endpoint, options = {}) {
        const url = `${WALLEX_API_BASE}${endpoint}`;
        const maxTries = 3;
        let lastErr = null;

        for (let tries = 0; tries < maxTries; tries++) {
            let res;
            try {
                res = await fetch(url, {
                    ...options,
                    headers: {
                        'X-API-Key': this.apiKey,
                        'Content-Type': 'application/json',
                        ...(options.headers || {})
                    }
                });
            } catch (networkErr) {
                lastErr = networkErr;
                if (tries < maxTries - 1) { await this._sleep(1000 * (tries + 1)); continue; }
                await this.addLog('ERROR', `API network error after ${maxTries} tries [${endpoint}]: ${networkErr.message}`);
                throw networkErr;
            }

            if (res.status === 429) {
                await this._sleep((tries + 1) * 2000);
                continue;
            }

            if (!res.ok) {
                const errorText = await res.text().catch(() => '');
                const err = new Error(`HTTP ${res.status}: ${errorText}`);
                err.httpStatus = res.status;
                await this.addLog('ERROR', `API Call failed [${endpoint}]: ${err.message}`);
                throw err;
            }

            const json = await res.json();
            if (!json.success) {
                const err = new Error(json.message || 'API error');
                await this.addLog('ERROR', `API Call unsuccessful [${endpoint}]: ${err.message}`);
                throw err;
            }
            return json.result !== undefined ? json.result : json;
        }
        throw lastErr || new Error(`API call failed after ${maxTries} tries [${endpoint}]`);
    }

    // ============================================================
    // ⭐ PROFIT REPORTING HOOK WITH DEPOSIT DEDUCTION
    // ============================================================
    async reportProfitableTrade(tradeData) {
    const { symbol, buyPrice, sellPrice, quantity, netProfit, market, orderType } = tradeData;

    if (netProfit <= 0) {
        return { ok: false, reason: 'no_profit' };
    }

    // Calculate 20% share
    const share = hwmEngine.calculateShareFromTrade(netProfit);

    // Record trade
    try {
        recordTrade(
            this.userId, symbol, buyPrice, sellPrice, quantity,
            share.total, share.creatorShare, market, orderType
        );
    } catch (e) {
        logger.error(`[User ${this.userId}] Failed to record trade`, { error: e.message });
        return { ok: false, reason: 'db_error' };
    }

    // ⭐ Deduct share from user's deposit
    const deductResult = deductShareFromDeposit(
        this.userId,
        share.creatorShare,
        share.total
    );

    logger.showUserProfit(share.userKeeps);
    logger.showShare(share.creatorShare);

    // Display deposit info
    if (deductResult.ok) {
        logger.info(`[User ${this.userId}] Deposit: ${deductResult.newBalance.toFixed(4)} USDT (deducted ${deductResult.deducted.toFixed(4)})`);

        // ⭐ Only lock in REAL mode
        const isTestMode = (process.env.MODE || 'TEST') === 'TEST';
        if (deductResult.locked && !isTestMode) {
            logger.warn(`[User ${this.userId}] 🛑 DEPOSIT EXHAUSTED — LOCKING BOT`);
            await this.addLog('WARNING', 'Bot locked: deposit exhausted');
            this.lockedByDeposit = true;
            await this.lockBot();
        } else if (deductResult.warning === 'low_deposit' && !isTestMode) {
            logger.warn(`[User ${this.userId}] ⚠️ Low deposit: ${deductResult.newBalance.toFixed(4)} USDT`);
        }
    }

    return {
        ok: true,
        userKeeps: share.userKeeps,
        creatorShare: share.creatorShare,
        deducted: deductResult.deducted,
        depositBalance: deductResult.newBalance,
        locked: deductResult.locked && !isTestMode,
        warning: deductResult.warning
    };
}

    // ============================================================
    // ⭐ LOCK BOT (called when deposit exhausted)
    // ============================================================
    async lockBot() {
        logger.warn(`[User ${this.userId}] Locking bot — deposit exhausted`);
        this.lockedByDeposit = true;
        this.running = false;
        // Note: active positions are kept open per user's decision
        // Only new trades are prevented
    }

    // ============================================================
    // SYMBOL LIMITS
    // ============================================================
    async getSymbolLimits(symbol) {
        try {
            const info = await this.getMarketInfo(symbol);
            if (!info) return null;
            const minQty = parseFloat(info.minQty);
            const minNotional = parseFloat(info.minNotional);

            let qtyDecimals = 8;
            if (info.minQty != null) {
                const s = String(info.minQty);
                if (s.includes('.')) qtyDecimals = s.split('.')[1].length;
                else qtyDecimals = 0;
            }
            if (info.stepSize != null) {
                const ss = parseFloat(info.stepSize);
                if (!isNaN(ss)) {
                    if (ss >= 0 && ss <= 12 && Number.isInteger(ss)) qtyDecimals = Math.min(qtyDecimals, Math.floor(ss));
                    else if (ss > 0 && ss < 1) {
                        const stepStr = ss.toFixed(12).replace(/0+$/, '');
                        if (stepStr.includes('.')) qtyDecimals = Math.min(qtyDecimals, stepStr.split('.')[1].length);
                    }
                }
            }
            if (info.baseAssetPrecision != null && !isNaN(parseInt(info.baseAssetPrecision))) {
                const bap = parseInt(info.baseAssetPrecision);
                if (bap >= 0 && bap <= 12) qtyDecimals = Math.min(qtyDecimals, bap);
            }

            let priceDecimals = 8;
            if (info.tickSize != null) {
                const ts = parseFloat(info.tickSize);
                if (!isNaN(ts)) {
                    if (ts >= 0 && ts <= 12 && Number.isInteger(ts)) priceDecimals = Math.floor(ts);
                    else if (ts > 0 && ts < 1) {
                        const tickStr = ts.toFixed(12).replace(/0+$/, '');
                        if (tickStr.includes('.')) priceDecimals = tickStr.split('.')[1].length;
                    }
                }
            }
            if (info.quotePrecision != null && !isNaN(parseInt(info.quotePrecision))) {
                const qp = parseInt(info.quotePrecision);
                if (qp >= 0 && qp <= 12) priceDecimals = Math.min(priceDecimals, qp);
            }

            return {
                minQty: isNaN(minQty) ? 0 : minQty,
                minNotional: isNaN(minNotional) ? 0 : minNotional,
                maxQty: parseFloat(info.maxQty) || Infinity,
                qtyDecimals, priceDecimals,
                stepSize: info.stepSize, tickSize: info.tickSize,
                isMarketTypeEnable: info.isMarketTypeEnable === true,
                info
            };
        } catch (e) { return null; }
    }

    orderMeetsMinimums(limits, side, quantity, price, quoteAmount = null) {
        if (!limits) return { ok: false, reason: 'no_limits' };
        const qty = parseFloat(quantity) || 0;
        const px = parseFloat(price) || 0;
        if (qty <= 0) return { ok: false, reason: 'qty_zero' };
        if (limits.minQty > 0 && qty + 1e-12 < limits.minQty) {
            return { ok: false, reason: 'qty_below_minQty', have: qty, need: limits.minQty };
        }
        let notional = 0;
        if (quoteAmount != null && quoteAmount > 0) notional = parseFloat(quoteAmount);
        else if (px > 0) notional = qty * px;
        if (limits.minNotional > 0 && notional + 1e-8 < limits.minNotional) {
            return { ok: false, reason: 'notional_below_minNotional', have: notional, need: limits.minNotional };
        }
        if (limits.maxQty && qty > limits.maxQty) {
            return { ok: false, reason: 'qty_above_maxQty' };
        }
        return { ok: true, notional, qty };
    }

    // ============================================================
    // DUAL PRICES / AVERAGES
    // ============================================================
    computeDualPrices(executedPrice, market, rate) {
        let priceUsdtEq, priceTmnEq;
        let valid = true;
        if (market === 'USDT') {
            priceUsdtEq = executedPrice;
            priceTmnEq = rate > 0 ? executedPrice * rate : executedPrice;
            if (!(rate > 0)) valid = false;
        } else {
            priceTmnEq = executedPrice;
            if (rate > 0) priceUsdtEq = executedPrice / rate;
            else { priceUsdtEq = NaN; valid = false; }
        }
        return { priceUsdtEq, priceTmnEq, rawPrice: executedPrice, valid };
    }

    computeDualAverages(unsoldBuys, rate) {
        let totalQty = 0, totalWeightedUsdt = 0, totalWeightedTmn = 0, totalCapitalUsed = 0;
        for (const buy of unsoldBuys) {
            const qty = buy.quantity;
            const buyMarket = buy.market || 'USDT';
            const rawPrice = buy.rawPrice || buy.price;
            const capitalUsed = buy.capitalUsed || 0;
            const rateAtBuy = buy.rateAtBuy || 0;

            let priceUsdtEq, priceTmnEq;
            if (buy.priceUsdtEq > 0 && buy.priceTmnEq > 0) {
                priceUsdtEq = buy.priceUsdtEq;
                priceTmnEq = buy.priceTmnEq;
            } else if (buy.priceUsdtEq > 0 && rateAtBuy > 0) {
                priceUsdtEq = buy.priceUsdtEq;
                priceTmnEq = buy.priceUsdtEq * rateAtBuy;
            } else if (buy.priceTmnEq > 0 && rateAtBuy > 0) {
                priceTmnEq = buy.priceTmnEq;
                priceUsdtEq = buy.priceTmnEq / rateAtBuy;
            } else if (qty > 0 && capitalUsed > 0) {
                priceUsdtEq = capitalUsed / qty;
                const refRate = rateAtBuy > 0 ? rateAtBuy : rate;
                priceTmnEq = (refRate > 0) ? priceUsdtEq * refRate : rawPrice;
            } else {
                const dual = this.computeDualPrices(rawPrice, buyMarket, rateAtBuy > 0 ? rateAtBuy : rate);
                priceUsdtEq = dual.priceUsdtEq || 0;
                priceTmnEq = dual.priceTmnEq || 0;
            }
            totalQty += qty;
            totalWeightedUsdt += priceUsdtEq * qty;
            totalWeightedTmn += priceTmnEq * qty;
            totalCapitalUsed += capitalUsed;
        }
        return {
            totalQty,
            avgUsdt: totalQty > 0 ? totalWeightedUsdt / totalQty : 0,
            avgTmn: totalQty > 0 ? totalWeightedTmn / totalQty : 0,
            totalCapitalUsed
        };
    }

    // ============================================================
    // VALIDATE BUY WILL BE SELLABLE
    // ============================================================
    async validateBuyWillBeSellable(baseToken, quoteBudgetUsdt, preferredPath = null) {
        const rate = await this.getUsdTmnRate() || this.state.lastUsdTmnRate || 0;
        let path = preferredPath;
        if (!path) path = await this.evaluateBestBuyPath(baseToken, quoteBudgetUsdt);
        if (!path) return { ok: false, reason: 'no_buy_path' };

        const buySymbol = path.symbol;
        const quoteAmount = path.quoteAmount;
        const buyPrice = path.price;
        const buyFee = path.fee || 0.0015;
        const estQty = (quoteAmount * (1 - buyFee)) / buyPrice;

        const buyLimits = await this.getSymbolLimits(buySymbol);
        const buyCheck = this.orderMeetsMinimums(buyLimits, 'BUY', estQty, buyPrice, quoteAmount);
        if (!buyCheck.ok) {
            return { ok: false, reason: 'buy_limits', message: `Buy blocked on ${buySymbol}: ${buyCheck.message || buyCheck.reason}` };
        }

        const buyLiquidity = await this.hasSufficientLiquidity(buySymbol, 'BUY', estQty);
        if (!buyLiquidity.ok) {
            return { ok: false, reason: 'buy_liquidity', message: `Buy liquidity blocked on ${buySymbol}: ${buyLiquidity.reason}` };
        }

        const sellLiquidityEntry = await this.hasSufficientLiquidity(buySymbol, 'SELL', estQty);
        if (!sellLiquidityEntry.ok) {
            return { ok: false, reason: 'sell_liquidity_entry_market', message: `Sell liquidity blocked on ${buySymbol}: ${sellLiquidityEntry.reason}` };
        }

        let usdtNotional = quoteBudgetUsdt;
        if (path.market === 'TMN' && rate > 0) usdtNotional = quoteAmount / rate;

        const usdtSym = this.toUsdtSymbol(baseToken);
        const tmnSym = this.toTmnSymbol(baseToken);
        let usdtPrice = 0, tmnPrice = 0;
        try { usdtPrice = await this.getCurrentPrice(usdtSym); } catch {}
        try { tmnPrice = await this.getCurrentPrice(tmnSym); } catch {}

        let canSellUsdt = false, canSellTmn = false;
        let usdtFailMsg = '', tmnFailMsg = '';

        if (usdtPrice > 0) {
            const sellLimitsUsdt = await this.getSymbolLimits(usdtSym);
            const sellCheckUsdt = this.orderMeetsMinimums(sellLimitsUsdt, 'SELL', estQty, usdtPrice, null);
            const usdtLiquidity = await this.hasSufficientLiquidity(usdtSym, 'SELL', estQty);
            if (sellCheckUsdt.ok && usdtLiquidity.ok) canSellUsdt = true;
            else {
                if (!sellCheckUsdt.ok) usdtFailMsg = sellCheckUsdt.message || sellCheckUsdt.reason;
                else usdtFailMsg = `liquidity: ${usdtLiquidity.reason}`;
            }
        }
        if (tmnPrice > 0) {
            const sellLimitsTmn = await this.getSymbolLimits(tmnSym);
            const sellCheckTmn = this.orderMeetsMinimums(sellLimitsTmn, 'SELL', estQty, tmnPrice, null);
            const tmnLiquidity = await this.hasSufficientLiquidity(tmnSym, 'SELL', estQty);
            if (sellCheckTmn.ok && tmnLiquidity.ok) canSellTmn = true;
            else {
                if (!sellCheckTmn.ok) tmnFailMsg = sellCheckTmn.message || sellCheckTmn.reason;
                else tmnFailMsg = `liquidity: ${tmnLiquidity.reason}`;
            }
        }

        if (!canSellUsdt && !canSellTmn) {
            return {
                ok: false, reason: 'unsellable_on_any_market',
                message: `Qty ${estQty.toFixed(8)} cannot be sold later (USDT: ${usdtFailMsg || 'n/a'} | TMN: ${tmnFailMsg || 'n/a'})`
            };
        }

        return {
            ok: true, path, estQty, usdtNotional, buyLimits,
            canSellUsdt, canSellTmn, buyLiquidity, sellLiquidityEntry,
            message: `OK: buy on ${buySymbol}, qty≈${estQty.toFixed(6)}, sellable USDT=${canSellUsdt} TMN=${canSellTmn}`
        };
    }

    // ============================================================
    // BALANCE
    // ============================================================
    async getDetailedBalance() {
        const usdt = this.state.settings.executionMode === 'TEST'
            ? (this.state.testBalance != null && this.state.testBalance > 0 ? this.state.testBalance : DEFAULT_TEST_BALANCE)
            : await this.getUSDTBalance();

        const tmn = this.state.settings.executionMode === 'TEST'
            ? (this.state.testTmnBalance || 0)
            : await this.getTMNBalance();

        let rate = this.state.lastUsdTmnRate || 0;
        if (!rate || rate <= 0) {
            try { rate = await this.getUsdTmnRate(); } catch {}
        }

        const tmnInUsdt = rate > 0 ? tmn / rate : 0;
        const totalEquity = usdt + tmnInUsdt;

        let blockedUSDT = 0, blockedTMN = 0;
        for (const tx of this.state.activeTransactions) {
            if (tx.buys && Array.isArray(tx.buys)) {
                for (const buy of tx.buys) {
                    if (buy.sold) continue;
                    if (buy.market === 'TMN') blockedTMN += buy.capitalUsed || 0;
                    else blockedUSDT += buy.capitalUsed || 0;
                }
            } else {
                const buyMarket = tx.buyMarket || 'USDT';
                const capital = tx.capitalUsed || 0;
                if (buyMarket === 'USDT') blockedUSDT += capital;
                else blockedTMN += capital;
            }
        }

        const blockedTMNInUsdt = rate > 0 ? blockedTMN / rate : 0;
        const blockedTotalInUsdt = blockedUSDT + blockedTMNInUsdt;
        const available = totalEquity - blockedTotalInUsdt;
        const isOverleveraged = blockedTotalInUsdt > totalEquity;

        return {
            usdt, tmn, rate, tmnInUsdt, totalEquity,
            blockedUSDT, blockedTMN, blockedTMNInUsdt, blockedTotal: blockedTotalInUsdt,
            available, isOverleveraged,
            hasSufficientUSDT: usdt >= MIN_ORDER.USDT,
            hasSufficientTMN: tmn >= MIN_ORDER.TMN
        };
    }

        async getUSDTBalance() {
        if (this.state.settings.executionMode === 'TEST') {
            if (this.state.testBalance == null || this.state.testBalance === 0) {
                this.state.testBalance = DEFAULT_TEST_BALANCE;
            }
            return this.state.testBalance;
        }
        try {
            const result = await this.apiCall('/v1/account/balances');
            if (result && result.balances && result.balances.USDT) return parseFloat(result.balances.USDT.value);
            return 0;
        } catch (error) { return 0; }
    }

            async getTMNBalance() {
        if (this.state.settings.executionMode === 'TEST') {
            if (this.state.testTmnBalance == null) this.state.testTmnBalance = 10000000;
            return this.state.testTmnBalance;
        }
        try {
            const result = await this.apiCall('/v1/account/balances');
            if (result && result.balances && result.balances.TMN) return parseFloat(result.balances.TMN.value);
            return 0;
        } catch (error) { return 0; }
    }

    async getTokenBalance(symbol) {
        if (this.state.settings.executionMode === 'TEST') {
            const tx = this.state.activeTransactions.find(t =>
                t.symbol === symbol ||
                t.symbol === symbol.replace('TMN', 'USDT') ||
                t.symbol === symbol.replace('USDT', 'TMN'));
            if (tx && tx.totalQuantity) return tx.totalQuantity;
            return 0;
        }
        try {
            const baseToken = symbol.replace('USDT', '').replace('TMN', '');
            const result = await this.apiCall('/v1/account/balances');
            if (result && result.balances && result.balances[baseToken]) return parseFloat(result.balances[baseToken].value);
            return 0;
        } catch (error) { return 0; }
    }

    // ============================================================
    // PRICE / MARKET DATA
    // ============================================================
    _cacheGet(map, key, ttl) {
        const e = map.get(key);
        if (!e) return null;
        if (Date.now() - e.ts > ttl) { map.delete(key); return null; }
        return e;
    }
    _cacheSet(map, key, value) {
        map.set(key, { ...value, ts: Date.now() });
    }

    async getCurrentPrice(symbol) {
        try {
            const hit = this._cacheGet(this.priceCache, symbol, PRICE_CACHE_TTL_MS);
            if (hit && hit.mid > 0) return hit.mid;
            const mdHit = this._cacheGet(this.marketDataCache, symbol, PRICE_CACHE_TTL_MS);
            if (mdHit && mdHit.data && mdHit.data.midPrice > 0) {
                this._cacheSet(this.priceCache, symbol, { mid: mdHit.data.midPrice });
                return mdHit.data.midPrice;
            }
            const depth = await this.apiCall(`/v1/depth?symbol=${symbol}`);
            const asks = depth.ask || [];
            const bids = depth.bid || [];
            if (asks.length === 0 || bids.length === 0) return 0;
            const bestAsk = parseFloat(asks[0]?.price || 0);
            const bestBid = parseFloat(bids[0]?.price || 0);
            const mid = (bestAsk + bestBid) / 2 || 0;
            if (mid > 0) this._cacheSet(this.priceCache, symbol, { mid });
            return mid;
        } catch { return 0; }
    }

    async getMarketData(symbol) {
        try {
            const hit = this._cacheGet(this.marketDataCache, symbol, PRICE_CACHE_TTL_MS);
            if (hit && hit.data) return hit.data;
            const depth = await this.apiCall(`/v1/depth?symbol=${symbol}`);
            const asks = depth.ask || [];
            const bids = depth.bid || [];
            if (asks.length === 0 || bids.length === 0) return null;
            const bestAsk = parseFloat(asks[0]?.price || 0);
            const bestBid = parseFloat(bids[0]?.price || 0);
            const midPrice = (bestAsk + bestBid) / 2;
            const spreadPercent = bestAsk > 0 ? ((bestAsk - bestBid) / midPrice * 100) : 0;
            const levels = TRADE_SAFETY.orderBookLevels;
            const askDepth8 = asks.slice(0, levels).reduce((sum, ask) => sum + parseFloat(ask.quantity || 0), 0);
            const bidDepth8 = bids.slice(0, levels).reduce((sum, bid) => sum + parseFloat(bid.quantity || 0), 0);
            const askDepth = asks.slice(0, 5).reduce((sum, ask) => sum + parseFloat(ask.quantity || 0), 0);
            const bidDepth = bids.slice(0, 5).reduce((sum, bid) => sum + parseFloat(bid.quantity || 0), 0);
            const data = { bestAsk, bestBid, midPrice, spreadPercent, askDepth, bidDepth, askDepth8, bidDepth8, askLevels: asks.length, bidLevels: bids.length };
            this._cacheSet(this.marketDataCache, symbol, { data });
            if (midPrice > 0) this._cacheSet(this.priceCache, symbol, { mid: midPrice });
            return data;
        } catch { return null; }
    }

    async getMarketInfo(symbol) {
        try {
            const data = await this.apiCall('/v1/markets');
            return data.symbols?.[symbol] || null;
        } catch { return null; }
    }

    async getUsdTmnRate() {
        try {
            const p = await this.getCurrentPrice('USDTTMN');
            if (p > 0) {
                this.state.lastUsdTmnRate = p;
                return p;
            }
        } catch {}
        if (this.state.lastUsdTmnRate > 0) return this.state.lastUsdTmnRate;
        return 0;
    }

    // ============================================================
    // MARKET STATE CHECKS
    // ============================================================
    async isMarketActiveAndValid(symbol) {
        try {
            const marketInfo = await this.getMarketInfo(symbol);
            if (!marketInfo) return { ok: false, reason: 'market_info_missing' };
            const tradingEnabled =
                marketInfo.isTrading !== false &&
                marketInfo.tradingEnabled !== false &&
                marketInfo.status !== 'HALT' &&
                marketInfo.status !== 'BREAK' &&
                marketInfo.status !== 'CLOSED';
            if (TRADE_SAFETY.requireActiveMarket && !tradingEnabled) return { ok: false, reason: 'market_not_active' };
            const price = await this.getCurrentPrice(symbol);
            if (TRADE_SAFETY.requireValidPrice && (!price || price <= 0 || isNaN(price))) return { ok: false, reason: 'invalid_price' };
            return { ok: true, price, marketInfo };
        } catch (err) {
            return { ok: false, reason: `error: ${err.message}` };
        }
    }

    async hasSufficientLiquidity(symbol, side, tradeSizeBase) {
        try {
            if (!tradeSizeBase || tradeSizeBase <= 0) return { ok: false, reason: 'invalid_trade_size' };
            const md = await this.getMarketData(symbol);
            if (!md) return { ok: false, reason: 'no_depth' };
            let multiplier = TRADE_SAFETY.minLiquidityMultiplier;
            if (side === 'SELL') multiplier = TRADE_SAFETY.minLiquidityMultiplierSell;
            const required = tradeSizeBase * multiplier;
            if (side === 'BUY') {
                if (md.askDepth8 < required) return { ok: false, reason: 'insufficient_ask_liquidity' };
            } else {
                if (md.bidDepth8 < required) return { ok: false, reason: 'insufficient_bid_liquidity' };
            }
            return { ok: true };
        } catch (err) {
            return { ok: false, reason: `error: ${err.message}` };
        }
    }

    async canExecuteBuy(symbol, quoteAmount) {
        const quoteMarket = this.getQuoteMarket(symbol);
        const active = await this.isMarketActiveAndValid(symbol);
        if (!active.ok) return { ok: false, reason: active.reason };
        const price = active.price;
        if (!price || price <= 0) return { ok: false, reason: 'invalid_price' };
        const limits = await this.getSymbolLimits(symbol);
        const buyFee = FEES[quoteMarket] ? FEES[quoteMarket].buy : 0.0015;
        const estQty = (quoteAmount * (1 - buyFee)) / price;
        const minCheck = this.orderMeetsMinimums(limits, 'BUY', estQty, price, quoteAmount);
        if (!minCheck.ok) return { ok: false, reason: minCheck.reason };

        const liqBuy = await this.hasSufficientLiquidity(symbol, 'BUY', estQty);
        if (!liqBuy.ok) return { ok: false, reason: liqBuy.reason };
        const liqSell = await this.hasSufficientLiquidity(symbol, 'SELL', estQty);
        if (!liqSell.ok) return { ok: false, reason: 'insufficient_sell_liquidity' };

        return { ok: true, price, estQty, limits, minCheck };
    }

    async canExecuteSell(symbol, quantity, avgPrice = null, totalCapitalUsed = null) {
        const active = await this.isMarketActiveAndValid(symbol);
        if (!active.ok) return { ok: false, reason: active.reason };
        const price = active.price;
        if (!price || price <= 0) return { ok: false, reason: 'invalid_price' };
        const limits = await this.getSymbolLimits(symbol);
        const minCheck = this.orderMeetsMinimums(limits, 'SELL', quantity, price, null);
        if (!minCheck.ok) return { ok: false, reason: minCheck.reason };
        const liq = await this.hasSufficientLiquidity(symbol, 'SELL', quantity);
        if (!liq.ok) return { ok: false, reason: liq.reason };
        if (TRADE_SAFETY.requirePositiveNetOnSell && avgPrice != null && totalCapitalUsed != null && totalCapitalUsed > 0) {
            const quoteMarket = this.getQuoteMarket(symbol);
            const sellFeeEstimate = FEES[quoteMarket] ? FEES[quoteMarket].sell : 0.0013;
            const expectedNet = (price * quantity * (1 - sellFeeEstimate)) - totalCapitalUsed;
            if (expectedNet <= 0) return { ok: false, reason: 'expected_net_not_positive' };
        }
        return { ok: true, price, limits, minCheck };
    }

    // ============================================================
    // DUAL MARKET HELPERS
    // ============================================================
    getBaseToken(symbol) { return symbol.replace(/USDT$/, '').replace(/TMN$/, ''); }
    toUsdtSymbol(base) { return base + 'USDT'; }
    toTmnSymbol(base) { return base + 'TMN'; }
    getQuoteMarket(symbol) { return symbol.endsWith('TMN') ? 'TMN' : 'USDT'; }

    // ============================================================
    // FORMATTERS
    // ============================================================
    formatQuantity(quantity, marketInfo, limits = null) {
        let decimals = 8;
        if (limits && limits.qtyDecimals != null && limits.qtyDecimals >= 0) {
            decimals = limits.qtyDecimals;
        } else {
            const minQtyRaw = (limits && limits.minQty != null) ? limits.minQty : (marketInfo && marketInfo.minQty);
            if (minQtyRaw != null) {
                const s = String(minQtyRaw);
                decimals = s.includes('.') ? s.split('.')[1].length : 0;
            } else if (marketInfo && marketInfo.stepSize != null) {
                const ss = parseFloat(marketInfo.stepSize);
                if (!isNaN(ss) && ss >= 0 && ss <= 12 && Number.isInteger(ss)) decimals = Math.floor(ss);
            }
        }
        if (decimals < 0) decimals = 0;
        if (decimals > 12) decimals = 12;
        const minQty = parseFloat((limits && limits.minQty) || (marketInfo && marketInfo.minQty) || 0);
        const factor = Math.pow(10, decimals);
        let rounded = Math.floor((Number(quantity) + 1e-14) * factor) / factor;
        if (minQty > 0 && rounded < minQty) {
            rounded = minQty;
            rounded = Math.floor((rounded + 1e-14) * factor) / factor;
        }
        return rounded.toFixed(decimals);
    }

    formatPrice(price, marketInfo, limits = null) {
        let decimals = 8;
        if (limits && limits.priceDecimals != null && !isNaN(limits.priceDecimals)) {
            decimals = limits.priceDecimals;
        } else if (marketInfo && marketInfo.tickSize != null) {
            const ts = parseFloat(marketInfo.tickSize);
            if (!isNaN(ts)) {
                if (ts >= 0 && ts <= 12 && Number.isInteger(ts)) decimals = Math.floor(ts);
                else if (ts > 0 && ts < 1) {
                    const tickStr = ts.toFixed(12).replace(/0+$/, '');
                    if (tickStr.includes('.')) decimals = tickStr.split('.')[1].length;
                }
            }
        } else if (marketInfo && marketInfo.quotePrecision != null && !isNaN(parseInt(marketInfo.quotePrecision))) {
            decimals = parseInt(marketInfo.quotePrecision);
        }
        if (isNaN(decimals) || decimals < 0) decimals = 0;
        if (decimals > 12) decimals = 12;
        const n = Number(price);
        if (!isFinite(n) || n <= 0) return (0).toFixed(decimals);
        return n.toFixed(decimals);
    }

    formatQty(qty, prec) { return Number(qty.toFixed(prec)); }

    async getPrecision(symbol) {
        const markets = await this.apiCall('/v1/markets');
        return markets.symbols?.[symbol]?.baseAssetPrecision ?? 8;
    }

    // ============================================================
    // ORDER EXECUTION
    // ============================================================
    isTerminalOrderStatus(order) {
        if (!order) return false;
        if (order.active === false) return true;
        const status = String(order.status || '').toUpperCase();
        return ['FILLED', 'DONE', 'CANCELED', 'CANCELLED', 'REJECTED', 'EXPIRED'].includes(status);
    }

    isFilledStatus(order) {
        if (!order) return false;
        const status = String(order.status || '').toUpperCase();
        if (status === 'FILLED' || status === 'DONE') return true;
        if (parseFloat(order.executedPercent) >= 99.9) return true;
        return false;
    }

    async waitForOrderFill(clientOrderId, { timeoutMs = 25000, intervalMs = 800, cancelOnTimeout = true } = {}) {
        const start = Date.now();
        let lastOrder = null;
        while (Date.now() - start < timeoutMs) {
            try {
                lastOrder = await this.apiCall(`/v1/account/orders/${clientOrderId}`);
                if (this.isTerminalOrderStatus(lastOrder)) return lastOrder;
            } catch (e) {}
            await this._sleep(intervalMs);
        }
        if (cancelOnTimeout) {
            try { await this.apiCall(`/v1/account/orders/${clientOrderId}`, { method: 'DELETE' }); } catch (e) {}
            await this._sleep(400);
            try { lastOrder = await this.apiCall(`/v1/account/orders/${clientOrderId}`); } catch (e) {}
        }
        return lastOrder;
    }

    summarizeOrderFee(order, marketInfo) {
        const baseAsset = marketInfo && marketInfo.baseAsset;
        const quoteAsset = marketInfo && marketInfo.quoteAsset;
        let feeBase = 0, feeQuote = 0;
        const fills = Array.isArray(order && order.fills) ? order.fills : [];
        if (fills.length > 0) {
            for (const f of fills) {
                const amt = parseFloat(f.fee) || 0;
                if (f.feeAsset === baseAsset) feeBase += amt;
                else if (f.feeAsset === quoteAsset) feeQuote += amt;
            }
        }
        return { feeBase, feeQuote };
    }

    parseExecutedQty(order) {
        return parseFloat(order && (order.executedQty ?? order.origQty)) || 0;
    }

    parseExecutedSum(order, fallbackPrice) {
        let sum = parseFloat(order && (order.executedSum ?? order.sum));
        if (!isNaN(sum) && sum > 0) return sum;
        const qty = this.parseExecutedQty(order);
        const price = parseFloat(order && order.executedPrice) || fallbackPrice || 0;
        return qty * price;
    }

    estimateMarketImpact(depthSide, neededQty, bestPrice) {
        if (!Array.isArray(depthSide) || depthSide.length === 0 || neededQty <= 0 || bestPrice <= 0) {
            return { ok: false, reason: 'no_depth', impactPct: 999 };
        }
        let remaining = neededQty;
        let lastPrice = bestPrice;
        let cumulativeQty = 0;
        for (const level of depthSide) {
            const px = parseFloat(level.price);
            const qty = parseFloat(level.quantity);
            if (!(px > 0) || !(qty > 0)) continue;
            const take = Math.min(remaining, qty);
            remaining -= take;
            cumulativeQty += take;
            lastPrice = px;
            if (remaining <= 1e-12) break;
        }
        if (remaining > neededQty * 0.05) return { ok: false, reason: 'insufficient_depth', impactPct: 999 };
        const impactPct = Math.abs((lastPrice - bestPrice) / bestPrice) * 100;
        if (impactPct > 1.8) return { ok: false, reason: 'high_impact', impactPct };
        return { ok: true, impactPct };
    }

    makeClientId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }

    async placeOrderWithMarketLimitFallback({ symbol, side, quantity, marketInfo, limits, bestPrice, depthSide, preferMarket = true }) {
        const qtyStr = String(quantity);
        const qtyNum = parseFloat(qtyStr);
        if (!(qtyNum > 0)) throw new Error(`Invalid quantity for ${side} ${symbol}`);

        const canMarket = preferMarket && ((limits && limits.isMarketTypeEnable) || (marketInfo && marketInfo.isMarketTypeEnable === true));
        let useMarket = canMarket;
        if (useMarket) {
            const impact = this.estimateMarketImpact(depthSide, qtyNum, bestPrice);
            if (!impact.ok) useMarket = false;
        }

        if (useMarket) {
            const myClientId = this.makeClientId(side.toLowerCase() + 'm');
            const orderData = { symbol, side, type: 'MARKET', quantity: qtyStr, client_id: myClientId };
            let placeResult;
            try {
                placeResult = await this.apiCall('/v1/account/orders', { method: 'POST', body: JSON.stringify(orderData) });
            } catch (e) { useMarket = false; }

            if (useMarket && placeResult) {
                const orderClientId = (placeResult && placeResult.clientOrderId) || myClientId;
                const finalOrder = await this.waitForOrderFill(orderClientId, { timeoutMs: 18000, intervalMs: 700 });
                const actualQty = finalOrder ? this.parseExecutedQty(finalOrder) : 0;
                if (finalOrder && actualQty > 0 && (this.isFilledStatus(finalOrder) || actualQty >= qtyNum * 0.97)) {
                    return { order: finalOrder, clientOrderId: orderClientId, usedType: 'MARKET', actualQty };
                }
                try { await this.apiCall(`/v1/account/orders/${orderClientId}`, { method: 'DELETE' }); } catch (e) {}
            }
        }

        try {
            const freshDepth = await this.apiCall(`/v1/depth?symbol=${symbol}`);
            if (side === 'BUY') {
                const asks = freshDepth.ask || [];
                if (asks.length > 0) { const px = parseFloat(asks[0].price); if (px > 0) bestPrice = px; }
            } else {
                const bids = freshDepth.bid || [];
                if (bids.length > 0) { const px = parseFloat(bids[0].price); if (px > 0) bestPrice = px; }
            }
        } catch (e) {}

        let limitPriceRaw = bestPrice;
        if (side === 'BUY') limitPriceRaw = bestPrice * 1.0035;
        else limitPriceRaw = bestPrice * 0.9965;

        let orderPrice = this.formatPrice(limitPriceRaw, marketInfo, limits);
        if (parseFloat(orderPrice) === 0 || isNaN(parseFloat(orderPrice))) {
            orderPrice = this.formatPrice(bestPrice, marketInfo, limits);
            if (parseFloat(orderPrice) === 0) orderPrice = bestPrice.toFixed(8);
        }

        const myClientId = this.makeClientId(side.toLowerCase() + 'l');
        const orderData = { symbol, side, type: 'LIMIT', quantity: qtyStr, price: orderPrice, client_id: myClientId };

        let placeResult;
        try {
            placeResult = await this.apiCall('/v1/account/orders', { method: 'POST', body: JSON.stringify(orderData) });
        } catch (placeErr) {
            const msg = placeErr.message || '';
            if (/1006|موجودی/i.test(msg)) this.buyBlockedUntil = Date.now() + BUY_FAIL_COOLDOWN_MS;
            throw placeErr;
        }
        const orderClientId = (placeResult && placeResult.clientOrderId) || myClientId;
        const finalOrder = await this.waitForOrderFill(orderClientId, { timeoutMs: 25000, intervalMs: 700, cancelOnTimeout: true });
        const actualQty = finalOrder ? this.parseExecutedQty(finalOrder) : 0;
        if (!finalOrder || actualQty <= 0) {
            try { await this.apiCall(`/v1/account/orders/${orderClientId}`, { method: 'DELETE' }); } catch (e) {}
            throw new Error(`LIMIT ${side} order [${symbol}] did not fill`);
        }
        return { order: finalOrder, clientOrderId: orderClientId, usedType: 'LIMIT', actualQty };
    }

        async placeMarketBuy(symbol, quoteAmount) {
        const quoteMarket = this.getQuoteMarket(symbol);
        const buyFee = FEES[quoteMarket].buy;
        const cap = await this.ensureCapital(quoteMarket, quoteAmount);
        if (!cap.ok) {
            this.buyBlockedUntil = Date.now() + BUY_FAIL_COOLDOWN_MS;
            throw new Error(`BUY capital [${symbol}]: ${cap.reason}`);
        }
        const gate = await this.canExecuteBuy(symbol, quoteAmount);
        if (!gate.ok) throw new Error(`BUY blocked [${symbol}]: ${gate.reason}`);
        const limits = gate.limits || await this.getSymbolLimits(symbol);

                        if (this.state.settings.executionMode === 'TEST') {
            const price = gate.price || await this.getCurrentPrice(symbol);
            if (price <= 0) throw new Error('Invalid market price');
            const prec = (limits && limits.qtyDecimals != null) ? limits.qtyDecimals : await this.getPrecision(symbol);

            // ⭐ Deduct from correct market balance (same as REAL)
            if (quoteMarket === 'USDT') {
                this.state.testBalance = (this.state.testBalance || 0) - quoteAmount;
            } else {
                this.state.testTmnBalance = (this.state.testTmnBalance || 0) - quoteAmount;
            }

            const netQuote = quoteAmount * (1 - buyFee);
            let qty = this.formatQty(netQuote / price, prec);
            const minCheck = this.orderMeetsMinimums(limits, 'BUY', qty, price, quoteAmount);
            if (!minCheck.ok) {
                // Refund to correct market
                if (quoteMarket === 'USDT') {
                    this.state.testBalance = (this.state.testBalance || 0) + quoteAmount;
                } else {
                    this.state.testTmnBalance = (this.state.testTmnBalance || 0) + quoteAmount;
                }
                throw new Error(`BUY min limits [${symbol}]: ${minCheck.reason}`);
            }
            if (qty <= 0) throw new Error('Invalid buy quantity');
            return { executedPrice: price, quantity: qty, rawExecutedQty: qty, grossValue: quoteAmount, market: quoteMarket, fee: buyFee, partiallyFilled: false, orderTypeUsed: 'TEST' };
        }

        // ... REAL mode continues unchanged
        const marketInfo = await this.getMarketInfo(symbol);
        if (!marketInfo) throw new Error(`Cannot get market info for ${symbol}`);
        const depth = await this.apiCall(`/v1/depth?symbol=${symbol}`);
        const asks = depth.ask || [];
        if (asks.length === 0) throw new Error(`No ask orders`);
        const bestAsk = parseFloat(asks[0].price);
        if (!bestAsk || bestAsk <= 0) throw new Error(`Invalid bestAsk`);

        const rawQuantity = quoteAmount / bestAsk;
        const formattedQuantity = this.formatQuantity(rawQuantity, marketInfo, limits);
        const qtyNum = parseFloat(formattedQuantity);

        try {
            const bal = await this.getDetailedBalance();
            if (quoteMarket === 'TMN' && bal.tmn < qtyNum * bestAsk * 0.99) {
                this.buyBlockedUntil = Date.now() + BUY_FAIL_COOLDOWN_MS;
                throw new Error(`BUY capital [${symbol}]: insufficient TMN`);
            }
            if (quoteMarket === 'USDT' && bal.usdt < qtyNum * bestAsk * 0.99) {
                this.buyBlockedUntil = Date.now() + BUY_FAIL_COOLDOWN_MS;
                throw new Error(`BUY capital [${symbol}]: insufficient USDT`);
            }
        } catch (e) { if (/BUY capital/i.test(e.message)) throw e; }

        const minCheck = this.orderMeetsMinimums(limits, 'BUY', qtyNum, bestAsk, quoteAmount);
        if (!minCheck.ok) throw new Error(`BUY min limits [${symbol}]: ${minCheck.reason}`);

        const result = await this.placeOrderWithMarketLimitFallback({
            symbol, side: 'BUY', quantity: formattedQuantity,
            marketInfo, limits, bestPrice: bestAsk, depthSide: asks, preferMarket: true
        });

        const finalOrder = result.order;
        const actualQty = result.actualQty;
        const actualSum = this.parseExecutedSum(finalOrder, bestAsk);
        const avgExecutedPrice = actualQty > 0 ? actualSum / actualQty : bestAsk;
        const feeInfo = this.summarizeOrderFee(finalOrder, marketInfo);
        let netQty = actualQty - feeInfo.feeBase;
        if (netQty <= 0) throw new Error(`BUY net qty zero`);

        return {
            executedPrice: avgExecutedPrice, quantity: netQty, rawExecutedQty: actualQty,
            grossValue: actualSum, market: quoteMarket, fee: buyFee, feeInfo,
            clientOrderId: result.clientOrderId,
            partiallyFilled: actualQty < qtyNum * 0.999,
            orderTypeUsed: result.usedType
        };
    }

    async placeMarketSell(symbol, quantity, avgPrice = null, totalCapitalUsed = null) {
        const quoteMarket = this.getQuoteMarket(symbol);
        const sellFee = FEES[quoteMarket].sell;
        const gate = await this.canExecuteSell(symbol, quantity, avgPrice, totalCapitalUsed);
        if (!gate.ok) throw new Error(`SELL blocked [${symbol}]: ${gate.reason}`);
        const limits = gate.limits || await this.getSymbolLimits(symbol);

                if (this.state.settings.executionMode === 'TEST') {
            const price = gate.price || await this.getCurrentPrice(symbol);
            if (price <= 0 || isNaN(price)) throw new Error(`Invalid price`);
            const prec = (limits && limits.qtyDecimals != null) ? limits.qtyDecimals : await this.getPrecision(symbol);
            quantity = this.formatQty(quantity, prec);
            if (quantity <= 0) throw new Error('Invalid sell qty');
            const minCheck = this.orderMeetsMinimums(limits, 'SELL', quantity, price, null);
            if (!minCheck.ok) throw new Error(`SELL min limits: ${minCheck.reason}`);
            const grossReceived = quantity * price;
            const netReceived = grossReceived * (1 - sellFee);

            // ⭐ Add to correct market balance (same as REAL)
            if (quoteMarket === 'USDT') {
                this.state.testBalance = (this.state.testBalance || 0) + netReceived;
            } else {
                this.state.testTmnBalance = (this.state.testTmnBalance || 0) + netReceived;
            }

            return {
                executedPrice: price, received: netReceived, grossReceived,
                market: quoteMarket, fee: sellFee, rawExecutedQty: quantity, quantity,
                partiallyFilled: false, orderTypeUsed: 'TEST'
            };
        }

        const tokenBalance = await this.getTokenBalance(symbol);
        if (tokenBalance < quantity * 0.999) throw new Error(`Insufficient balance`);
        const marketInfo = await this.getMarketInfo(symbol);
        if (!marketInfo) throw new Error(`No market info`);
        const depth = await this.apiCall(`/v1/depth?symbol=${symbol}`);
        const bids = depth.bid || [];
        if (bids.length === 0) throw new Error(`No bids`);
        const bestBid = parseFloat(bids[0].price);
        if (!bestBid || bestBid <= 0) throw new Error(`Invalid bestBid`);
        const formattedQuantity = this.formatQuantity(quantity, marketInfo, limits);
        const qtyNum = parseFloat(formattedQuantity);
        const minCheck = this.orderMeetsMinimums(limits, 'SELL', qtyNum, bestBid, null);
        if (!minCheck.ok) throw new Error(`SELL min limits: ${minCheck.reason}`);

        const result = await this.placeOrderWithMarketLimitFallback({
            symbol, side: 'SELL', quantity: formattedQuantity,
            marketInfo, limits, bestPrice: bestBid, depthSide: bids, preferMarket: true
        });

        const finalOrder = result.order;
        const actualQty = result.actualQty;
        const grossReceived = this.parseExecutedSum(finalOrder, bestBid);
        const avgExecutedPrice = actualQty > 0 ? grossReceived / actualQty : bestBid;
        const feeInfo = this.summarizeOrderFee(finalOrder, marketInfo);
        const netReceived = grossReceived - feeInfo.feeQuote;

        return {
            executedPrice: avgExecutedPrice, received: netReceived, grossReceived,
            rawExecutedQty: actualQty, clientOrderId: result.clientOrderId,
            market: quoteMarket, fee: sellFee, feeInfo,
            partiallyFilled: actualQty < qtyNum * 0.999,
            orderTypeUsed: result.usedType
        };
    }

    // ============================================================
    // CAPITAL MANAGEMENT
    // ============================================================
            // ============================================================
    // CAPITAL MANAGEMENT
    // ============================================================
    async ensureCapital(quoteMarket, neededAmount) {
        if (neededAmount <= 0) return { ok: true };
        const balance = await this.getDetailedBalance();

        if (quoteMarket === 'USDT') {
            if (balance.usdt >= neededAmount) {
                return { ok: true, balance: balance.usdt, market: 'USDT' };
            }

            // ⭐ Try to convert from TMN
            const rate = balance.rate || await this.getUsdTmnRate();
            if (!rate || rate <= 0) return { ok: false, reason: 'no_rate' };

            const shortfall = neededAmount - balance.usdt;
            const conversionFee = CONVERSION_FEES.TMN_TO_USDT;
            const tmnNeeded = (shortfall / (1 - conversionFee)) * rate * 1.1;

            if (balance.tmn < tmnNeeded) {
                return { ok: false, reason: 'insufficient_tmn_for_convert', need: tmnNeeded, have: balance.tmn };
            }

            const conv = await this.convertUsdtTmn(tmnNeeded, 'TMN_TO_USDT');
            if (!conv.ok) return conv;

            const newBalance = await this.getDetailedBalance();
            return newBalance.usdt >= neededAmount
                ? { ok: true, balance: newBalance.usdt, converted: true, fromMarket: 'TMN' }
                : { ok: false, reason: 'convert_insufficient' };
        } else {
            if (balance.tmn >= neededAmount) {
                return { ok: true, balance: balance.tmn, market: 'TMN' };
            }

            // ⭐ Try to convert from USDT
            const rate = balance.rate || await this.getUsdTmnRate();
            if (!rate || rate <= 0) return { ok: false, reason: 'no_rate' };

            const shortfall = neededAmount - balance.tmn;
            const conversionFee = CONVERSION_FEES.USDT_TO_TMN;
            const usdtNeeded = (shortfall / rate) / (1 - conversionFee) * 1.1;

            if (balance.usdt < usdtNeeded) {
                return { ok: false, reason: 'insufficient_usdt_for_convert', need: usdtNeeded, have: balance.usdt };
            }

            const conv = await this.convertUsdtTmn(usdtNeeded, 'USDT_TO_TMN');
            if (!conv.ok) return conv;

            const newBalance = await this.getDetailedBalance();
            return newBalance.tmn >= neededAmount
                ? { ok: true, balance: newBalance.tmn, converted: true, fromMarket: 'USDT' }
                : { ok: false, reason: 'convert_insufficient' };
        }
    }
	
	    // ============================================================
    // CONVERT USDT ↔ TMN
    // ============================================================
    async convertUsdtTmn(amount, direction) {
        if (amount <= 0) return { ok: false, reason: 'zero_amount' };
        const rate = await this.getUsdTmnRate();
        if (!rate || rate <= 0) return { ok: false, reason: 'no_usdttmn_rate' };
        this.state.lastUsdTmnRate = rate;

        if (this.state.settings.executionMode === 'TEST') {
            // ⭐ In TEST mode, do the conversion exactly like REAL
            if (direction === 'USDT_TO_TMN') {
                if ((this.state.testBalance || 0) < amount) {
                    return { ok: false, reason: 'insufficient_usdt' };
                }
                const fee = CONVERSION_FEES.USDT_TO_TMN;
                const tmnOut = amount * rate * (1 - fee);
                this.state.testBalance = (this.state.testBalance || 0) - amount;
                this.state.testTmnBalance = (this.state.testTmnBalance || 0) + tmnOut;
                return { ok: true, received: tmnOut, rate };
            } else {
                if ((this.state.testTmnBalance || 0) < amount) {
                    return { ok: false, reason: 'insufficient_tmn' };
                }
                const fee = CONVERSION_FEES.TMN_TO_USDT;
                const usdtOut = (amount / rate) * (1 - fee);
                this.state.testTmnBalance = (this.state.testTmnBalance || 0) - amount;
                this.state.testBalance = (this.state.testBalance || 0) + usdtOut;
                return { ok: true, received: usdtOut, rate };
            }
        }

        // REAL mode
        try {
            if (direction === 'USDT_TO_TMN') {
                const sell = await this.placeMarketSell('USDTTMN', amount);
                return { ok: true, received: sell.received || 0, rate };
            } else {
                const buy = await this.placeMarketBuy('USDTTMN', amount);
                return { ok: true, received: buy.quantity || 0, rate };
            }
        } catch (err) {
            return { ok: false, reason: err.message };
        }
    }

    // ============================================================
    // EVALUATE BEST BUY PATH
    // ============================================================
    async evaluateBestBuyPath(baseToken, quoteBudgetUsdt) {
        const rate = await this.getUsdTmnRate();
        const usdtSym = this.toUsdtSymbol(baseToken);
        const tmnSym = this.toTmnSymbol(baseToken);
        let usdtPrice = 0, tmnPrice = 0;
        try { usdtPrice = await this.getCurrentPrice(usdtSym); } catch {}
        try { tmnPrice = await this.getCurrentPrice(tmnSym); } catch {}

        let freeUsdt = 0, freeTmn = 0;
        try {
            const bal = await this.getDetailedBalance();
            freeUsdt = bal.usdt || 0;
            freeTmn = bal.tmn || 0;
        } catch (_) {}

        const options = [];
        if (usdtPrice > 0) {
            const fee = FEES.USDT.buy;
            const effectiveCost = usdtPrice / (1 - fee);
            const canPayUsdt = freeUsdt >= quoteBudgetUsdt * 0.98;
            const tmnNeededForConvert = rate > 0 ? (quoteBudgetUsdt * rate * 1.15) : Infinity;
            const canConvertFromTmn = freeTmn >= tmnNeededForConvert;
            if (canPayUsdt || canConvertFromTmn) {
                options.push({ market: 'USDT', symbol: usdtSym, price: usdtPrice, quoteAmount: quoteBudgetUsdt, quoteCurrency: 'USDT', effectiveUsdtCostPerUnit: effectiveCost, fee, fundedBy: canPayUsdt ? 'USDT' : 'TMN_CONVERT' });
            }
        }
        if (tmnPrice > 0 && rate > 0) {
            const fee = FEES.TMN.buy;
            const priceInUsdt = tmnPrice / rate;
            const effectiveCost = priceInUsdt / (1 - fee);
            const quoteAmountTmn = quoteBudgetUsdt * rate;
            const canPayTmn = freeTmn >= quoteAmountTmn * 0.98;
            const usdtNeededForConvert = (quoteAmountTmn / rate) * 1.15;
            const canConvertFromUsdt = freeUsdt >= usdtNeededForConvert;
            if (canPayTmn || canConvertFromUsdt) {
                options.push({ market: 'TMN', symbol: tmnSym, price: tmnPrice, quoteAmount: quoteAmountTmn, quoteCurrency: 'TMN', effectiveUsdtCostPerUnit: effectiveCost, fee, rate, fundedBy: canPayTmn ? 'TMN' : 'USDT_CONVERT' });
            }
        }
        if (options.length === 0) return null;

        const usdtOpt = options.find(o => o.market === 'USDT' && o.fundedBy === 'USDT');
        const tmnOpt = options.find(o => o.market === 'TMN');
        if (usdtOpt) {
            if (!tmnOpt) return usdtOpt;
            const savingPct = (usdtOpt.effectiveUsdtCostPerUnit - tmnOpt.effectiveUsdtCostPerUnit) / usdtOpt.effectiveUsdtCostPerUnit * 100;
            if (savingPct >= 0.4) return tmnOpt;
            return usdtOpt;
        }
        options.sort((a, b) => a.effectiveUsdtCostPerUnit - b.effectiveUsdtCostPerUnit);
        return options[0];
    }

    // ============================================================
    // EVALUATE BEST SELL PATH
    // ============================================================
    async evaluateBestSellPath(tx, quantity, totalCapitalUsedUsdt, avgBuyPriceUsdt) {
        const base = this.getBaseToken(tx.symbol);
        const buyMarket = tx.buyMarket || 'USDT';
        const rate = await this.getUsdTmnRate();
        const usdtSym = this.toUsdtSymbol(base);
        const tmnSym = this.toTmnSymbol(base);

        const unsoldBuys = (tx.buys || []).filter(b => !b.sold);
        const dual = this.computeDualAverages(unsoldBuys, rate);

        let usdtPrice = 0, tmnPrice = 0;
        try { usdtPrice = await this.getCurrentPrice(usdtSym); } catch {}
        try { tmnPrice = await this.getCurrentPrice(tmnSym); } catch {}

        const options = [];
        if (usdtPrice > 0) {
            const sellFee = FEES.USDT.sell;
            const priceUsdtEq = usdtPrice;
            const avg = dual.avgUsdt;
            const grossPct = avg > 0 ? ((priceUsdtEq - avg) / avg) * 100 : 0;
            const net = quantity * priceUsdtEq * (1 - sellFee) - dual.totalCapitalUsed;
            const netPct = dual.totalCapitalUsed > 0 ? (net / dual.totalCapitalUsed) * 100 : 0;
            let minGrossRequired = buyMarket === 'USDT' ? ARB_CONFIG.minGrossUsdtToUsdt : ARB_CONFIG.minGrossCrossMarket;
            let minNetRequired = buyMarket === 'TMN' ? ARB_CONFIG.minNetUsdtFromTmnPercent : 0;
            options.push({ market: 'USDT', symbol: usdtSym, price: usdtPrice, priceUsdtEq, avgPriceUsdt: dual.avgUsdt, avgPriceTmn: dual.avgTmn, grossPct, netProfit: net, netPct, direction: `${buyMarket}→USDT`, sellFee, minGrossRequired, minNetRequired, quantity });
        }
        if (tmnPrice > 0 && rate > 0) {
            const sellFee = FEES.TMN.sell;
            const priceUsdtEq = tmnPrice / rate;
            const avg = dual.avgUsdt;
            const grossPct = avg > 0 ? ((priceUsdtEq - avg) / avg) * 100 : 0;
            const tmnReceived = quantity * tmnPrice * (1 - sellFee);
            const conversionFee = CONVERSION_FEES.TMN_TO_USDT;
            const usdtFromTmn = (tmnReceived / rate) * (1 - conversionFee);
            const net = usdtFromTmn - dual.totalCapitalUsed;
            const netPct = dual.totalCapitalUsed > 0 ? (net / dual.totalCapitalUsed) * 100 : 0;
            let minGrossRequired = buyMarket === 'TMN' ? ARB_CONFIG.minGrossTmnToTmn : ARB_CONFIG.minGrossCrossMarket;
            options.push({ market: 'TMN', symbol: tmnSym, price: tmnPrice, priceUsdtEq, avgPriceUsdt: dual.avgUsdt, avgPriceTmn: dual.avgTmn, grossPct, netProfit: net, netPct, direction: `${buyMarket}→TMN`, sellFee, rate, minGrossRequired, minNetRequired: ARB_CONFIG.minNetTmnPercent, conversionFee, quantity });
        }

        if (options.length === 0) {
            return { market: 'USDT', symbol: usdtSym, price: usdtPrice || 0, priceUsdtEq: usdtPrice || 0, grossPct: 0, netProfit: 0, netPct: 0, direction: `${buyMarket}→USDT`, sellFee: FEES.USDT.sell, viable: false };
        }

        const tmnLocked = Date.now() < this.tmnSellLockedUntil;
        const viable = options.filter(o => {
            if (!(o.netProfit > 0 && o.priceUsdtEq > o.avgPriceUsdt)) return false;
            if (o.grossPct < o.minGrossRequired) return false;
            if (o.minNetRequired > 0 && o.netPct < o.minNetRequired) return false;
            if (o.market === 'TMN' && tmnLocked) return false;
            return true;
        });

        if (viable.length === 0) {
            options.sort((a, b) => b.netProfit - a.netProfit);
            return { ...options[0], viable: false };
        }

        viable.sort((a, b) => b.netProfit - a.netProfit);
        const best = viable[0];
        const usdtOpt = viable.find(o => o.market === 'USDT');
        if (best.market === 'TMN' && usdtOpt) {
            if (best.netProfit <= usdtOpt.netProfit * 1.05) return { ...usdtOpt, viable: true };
        }
        return { ...best, viable: true };
    }

    // ============================================================
    // DYNAMIC SELL PERCENT
    // ============================================================
    calculateDynamicSellPercent(tx, targetStep, market) {
        if (!tx || !tx.buys || tx.buys.length === 0) return { sellPercent: 0.5 };
        const unsoldBuys = tx.buys.filter(b => !b.sold);
        if (unsoldBuys.length === 0) return { sellPercent: 0.5 };

        let totalCapital = 0, totalQuantity = 0, totalWeightedPrice = 0;
        for (const buy of unsoldBuys) {
            totalCapital += buy.capitalUsed;
            totalQuantity += buy.quantity;
            const price = market === 'TMN' ? (buy.priceTmnEq || buy.price) : (buy.priceUsdtEq || buy.price);
            totalWeightedPrice += price * buy.quantity;
        }
        const avgPrice = totalQuantity > 0 ? totalWeightedPrice / totalQuantity : tx.firstBuyPrice;
        const currentStep = targetStep || tx.currentStep || 1;
        const totalSteps = this.state.settings.maxSteps || 25;

        let baseProfit = 0.35;
        let buyFee = 0;
        const buyMarket = tx.buyMarket || 'USDT';
        if (buyMarket === 'USDT') buyFee = FEES.USDT.buy * 100;
        else buyFee = FEES.TMN.buy * 100;

        let sellFee = 0;
        if (market === 'USDT') sellFee = FEES.USDT.sell * 100;
        else sellFee = FEES.TMN.sell * 100;

        let conversionFee = 0;
        if (buyMarket !== market) {
            if (buyMarket === 'USDT' && market === 'TMN') conversionFee = CONVERSION_FEES.USDT_TO_TMN * 100;
            else if (buyMarket === 'TMN' && market === 'USDT') conversionFee = CONVERSION_FEES.TMN_TO_USDT * 100;
        }

        const stepBonus = (currentStep / totalSteps) * 0.22;

        let regimeBonus = 0;
        const regime = tx.marketRegime || this.state.marketRegime || 'SIDEWAYS';
        if (regime === 'BEAR') regimeBonus = 0.25;
        else if (regime === 'SIDEWAYS') regimeBonus = 0.08;

        let jumpBonus = 0;
        if (tx.buys.length > 1) {
            const stepsJumped = tx.buys.length - 1;
            jumpBonus = Math.min(stepsJumped * 0.04, 0.35);
        }

        let sellPercent = baseProfit + buyFee + sellFee + conversionFee + stepBonus + regimeBonus + jumpBonus;
        sellPercent = Math.max(0.40, Math.min(2.2, sellPercent));
        sellPercent = Math.round(sellPercent * 100) / 100;

        return { sellPercent, avgPrice };
    }

    // ============================================================
    // DUST
    // ============================================================
    getDustQty(baseToken) {
        if (!baseToken) return 0;
        const entry = this.state.dustBalances && this.state.dustBalances[baseToken];
        if (!entry) return 0;
        const q = parseFloat(entry.quantity) || 0;
        return q > DUST_EPSILON ? q : 0;
    }

    setDustQty(baseToken, quantity, originSymbol = null) {
        if (!baseToken) return;
        if (!this.state.dustBalances) this.state.dustBalances = {};
        const q = parseFloat(quantity) || 0;
        if (q <= DUST_EPSILON) { delete this.state.dustBalances[baseToken]; return; }
        this.state.dustBalances[baseToken] = {
            quantity: q,
            updatedAt: new Date().toISOString(),
            lastSymbol: originSymbol || (this.state.dustBalances[baseToken] && this.state.dustBalances[baseToken].lastSymbol) || null
        };
    }

    getAllDustSummary() {
        if (!this.state.dustBalances) return {};
        const out = {};
        for (const [base, entry] of Object.entries(this.state.dustBalances)) {
            const q = parseFloat(entry.quantity) || 0;
            if (q > DUST_EPSILON) out[base] = q;
        }
        return out;
    }

    // ============================================================
    // CAPITAL LIMITS
    // ============================================================
    getMaxTradeCapital() {
        const cap = this.state.settings.maxTradeCapital != null ? this.state.settings.maxTradeCapital : 10;
        return cap > 0 ? cap : 10;
    }
    getRemainingTradeCapital(tx) {
        const used = tx && tx.capitalUsed ? tx.capitalUsed : 0;
        return Math.max(0, this.getMaxTradeCapital() - used);
    }
    clampBuyToPositionLimit(tx, amountUsdt) {
        if (!tx) {
            const maxCap = this.getMaxTradeCapital();
            if (amountUsdt > maxCap) return maxCap;
            return amountUsdt;
        }
        const remaining = this.getRemainingTradeCapital(tx);
        if (remaining <= 0.01) return 0;
        if (remaining < amountUsdt * 0.5) return 0;
        if (amountUsdt > remaining) return remaining;
        return amountUsdt;
    }

    isStepAlreadyBought(tx, step) {
        if (!tx || !tx.buys) return false;
        return tx.buys.some(buy => buy.step === step);
    }

    getDropFromLastBuy(tx) {
        if (!tx.lastBuyPrice || tx.lastBuyPrice <= 0) return 0;
        if (!tx.currentPrice || tx.currentPrice <= 0) return 0;
        return Math.max(0, ((tx.lastBuyPrice - tx.currentPrice) / tx.lastBuyPrice) * 100);
    }

    isSymbolDuplicate(symbol) {
        const base = this.getBaseToken(symbol);
        return this.state.activeTransactions.some(tx => this.getBaseToken(tx.symbol) === base);
    }

    // ============================================================
    // COOLDOWN
    // ============================================================
    async isOnCooldown(symbol) {
        if (!this.cooldownMap.has(symbol)) return false;
        const cooldownEnd = this.cooldownMap.get(symbol);
        if (Date.now() < cooldownEnd) return true;
        this.cooldownMap.delete(symbol);
        return false;
    }

    async addToCooldown(symbol, seconds = null) {
        const sec = seconds || this.COOLDOWN_SECONDS;
        this.cooldownMap.set(symbol, Date.now() + (sec * 1000));
    }

    // ============================================================
    // CANCEL OPEN ORDERS
    // ============================================================
    async cancelOpenOrders(symbol) {
        try {
            let ordersList = [];
            try {
                const openOrders = await this.apiCall(`/v1/account/openOrders?symbol=${encodeURIComponent(symbol)}`);
                if (Array.isArray(openOrders)) ordersList = openOrders;
                else if (openOrders && typeof openOrders === 'object') {
                    if (Array.isArray(openOrders.orders)) ordersList = openOrders.orders;
                    else if (Array.isArray(openOrders[symbol])) ordersList = openOrders[symbol];
                }
            } catch (e1) {
                try {
                    const all = await this.apiCall('/v1/account/openOrders');
                    if (Array.isArray(all)) ordersList = all.filter(o => o && o.symbol === symbol);
                } catch (e2) { return; }
            }
            if (!Array.isArray(ordersList) || ordersList.length === 0) return;
            for (const order of ordersList) {
                const id = order.clientOrderId || order.client_id;
                if (!id) continue;
                try { await this.apiCall(`/v1/account/orders/${id}`, { method: 'DELETE' }); } catch (e) {}
            }
        } catch (err) {}
    }

    // ============================================================
    // PAIR SCORING
    // ============================================================
    calculateVolatility(high, low, current) {
        if (!high || !low || high === low) return 0;
        return ((high - low) / current) * 100;
    }

    calculateTrend(prevClose, current, high24h, low24h) {
        if (!prevClose || !current) return 0;
        const priceChangePercent = ((current - prevClose) / prevClose) * 100;
        const positionInRange = high24h > low24h ? ((current - low24h) / (high24h - low24h) * 100) : 50;
        return (priceChangePercent * 0.7) + ((positionInRange - 50) * 0.3);
    }

    calculateLiquidityScore(volume24h, askDepth, bidDepth, currentPrice) {
        if (!currentPrice || currentPrice <= 0) return 0;
        const volumeScore = Math.min(Math.log10(volume24h + 1) / 8, 1) * 100;
        const depthValue = (askDepth + bidDepth) * currentPrice;
        const depthScore = depthValue > 10000 ? 100 : depthValue > 5000 ? 90 : depthValue > 1000 ? 80 : depthValue > 500 ? 70 : depthValue > 100 ? 60 : depthValue > 50 ? 50 : depthValue > 10 ? 40 : 30;
        return (volumeScore * 0.6 + depthScore * 0.4);
    }

    async calculatePairScore(symbol, marketInfo, stats) {
        try {
            const marketData = await this.getMarketData(symbol);
            if (!marketData || !stats) return 0;
            const volume24h = parseFloat(stats['24h_quoteVolume'] || 0);
            const high24h = parseFloat(stats['24h_high'] || 0);
            const low24h = parseFloat(stats['24h_low'] || 0);
            let prevClose = parseFloat(stats['24h_previousClose'] || 0);
            if (prevClose === 0) prevClose = parseFloat(stats['24h_open'] || 0);

            if (volume24h < (this.state.settings.minimumVolume || 2500)) return 0;
            if (marketData.spreadPercent > (this.state.settings.maximumSpread || 1.2)) return 0;
            if (marketData.midPrice <= 0) return 0;

            const bidDepthUsdt = (marketData.bidDepth8 || marketData.bidDepth || 0) * marketData.midPrice;
            const askDepthUsdt = (marketData.askDepth8 || marketData.askDepth || 0) * marketData.midPrice;
            if (bidDepthUsdt < TRADE_SAFETY.minBidDepthUsdt || askDepthUsdt < TRADE_SAFETY.minAskDepthUsdt) return 0;

            const trendValue = this.calculateTrend(prevClose, marketData.midPrice, high24h, low24h);
            if (trendValue < -8) return 0;

            const volumeScore = volume24h >= 500000 ? 100 : volume24h >= 200000 ? 95 : volume24h >= 100000 ? 90 : volume24h >= 50000 ? 85 : volume24h >= 20000 ? 78 : volume24h >= 10000 ? 70 : volume24h >= 5000 ? 62 : volume24h >= 2500 ? 55 : 40;
            const volatility = this.calculateVolatility(high24h, low24h, marketData.midPrice);
            const volatilityScore = volatility >= 15 ? 70 : volatility >= 10 ? 85 : volatility >= 6 ? 95 : volatility >= 3 ? 100 : volatility >= 1.5 ? 90 : volatility >= 0.8 ? 75 : 55;
            const spreadScore = marketData.spreadPercent <= 0.15 ? 100 : marketData.spreadPercent <= 0.25 ? 95 : marketData.spreadPercent <= 0.40 ? 88 : marketData.spreadPercent <= 0.60 ? 78 : marketData.spreadPercent <= 0.90 ? 65 : marketData.spreadPercent <= 1.2 ? 50 : 20;
            const trendScore = trendValue > 8 ? 95 : trendValue > 4 ? 88 : trendValue > 1.5 ? 80 : trendValue > 0 ? 70 : trendValue > -2 ? 60 : trendValue > -5 ? 45 : 30;
            const liquidityScore = this.calculateLiquidityScore(volume24h, marketData.askDepth, marketData.bidDepth, marketData.midPrice);

            const weights = this.state.settings.pairSelectionCriteria;
            const totalWeight = weights.volumeWeight + weights.volatilityWeight + weights.spreadWeight + weights.trendWeight + weights.liquidityWeight;
            return Math.round(((volumeScore * weights.volumeWeight + volatilityScore * weights.volatilityWeight + spreadScore * weights.spreadWeight + trendScore * weights.trendWeight + liquidityScore * weights.liquidityWeight) / totalWeight) * 10) / 10;
        } catch (error) { return 0; }
    }

    // ============================================================
    // ALTFINS
    // ============================================================
    async altfinsApiCall(endpoint, options = {}, apiKeyOverride = null) {
        const key = apiKeyOverride || this.altfinsPersonalKey || SHARED_ALTFINS_API_KEY;
        if (!key) throw new Error('No Altfins API key');
        const url = `${ALTFINS_API_BASE}${endpoint}`;
        const method = (options.method || 'GET').toUpperCase();
        const headers = {
            'Accept': 'application/json',
            'X-API-KEY': key,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...(options.headers || {})
        };
        let tries = 0;
        const maxTries = 3;
        while (tries < maxTries) {
            try {
                const res = await fetch(url, { method, headers, body: options.body ? JSON.stringify(options.body) : undefined });
                if (res.status === 429) {
                    await new Promise(r => setTimeout(r, (tries + 1) * 2000));
                    tries++;
                    continue;
                }
                if (!res.ok) {
                    const errText = await res.text();
                    throw new Error(`Altfins HTTP ${res.status}: ${errText.slice(0, 200)}`);
                }
                return await res.json();
            } catch (err) {
                tries++;
                if (tries >= maxTries) throw err;
                await new Promise(r => setTimeout(r, 1000 * tries));
            }
        }
    }

    async getAltfinsBullishSignals(limit = 40) {
        if (this.altfinsPersonalKey) {
            try {
                const data = await this.altfinsApiCall('/api/v2/public/signals-feed/search-requests', {
                    method: 'POST',
                    body: { signalDirection: 'BULLISH', page: 0, size: Math.min(Math.max(limit, 10), 100) }
                }, this.altfinsPersonalKey);
                return Array.isArray(data?.content) ? data.content : (Array.isArray(data) ? data : []);
            } catch (err) {
                await this.logQuiet(`Personal Altfins error: ${err.message}`);
            }
        }

        const CACHE_TTL_MS = 5 * 60 * 1000;
        if (Date.now() - sharedAltfinsCache.lastFetch < CACHE_TTL_MS && sharedAltfinsCache.signals.length > 0) {
            return sharedAltfinsCache.signals.slice(0, limit);
        }

        if (!sharedAltfinsCache.fetchInProgress && SHARED_ALTFINS_API_KEY) {
            sharedAltfinsCache.fetchInProgress = true;
            try {
                const data = await this.altfinsApiCall('/api/v2/public/signals-feed/search-requests', {
                    method: 'POST',
                    body: { signalDirection: 'BULLISH', page: 0, size: Math.min(Math.max(limit, 10), 100) }
                }, SHARED_ALTFINS_API_KEY);
                const signals = Array.isArray(data?.content) ? data.content : (Array.isArray(data) ? data : []);
                sharedAltfinsCache.signals = signals;
                sharedAltfinsCache.lastFetch = Date.now();
                await saveSharedAltfinsCache();
            } catch (err) {
                await this.logQuiet(`Shared Altfins error: ${err.message}`);
            } finally {
                sharedAltfinsCache.fetchInProgress = false;
            }
        }

        return sharedAltfinsCache.signals.slice(0, limit);
    }

    // ============================================================
    // GET AVAILABLE PAIRS
    // ============================================================
    async getAvailablePairs(maxCount = 10) {
        if (this.state.settings.selectionMode === 'MANUAL') {
            const activeSymbols = new Set(this.state.activeTransactions.map(tx => tx.symbol));
            const availablePairs = (this.state.settings.manualPairs || []).filter(p => !activeSymbols.has(p));
            if (availablePairs.length === 0) return [];
            const validPairs = [];
            for (const symbol of availablePairs) {
                try {
                    const marketsData = await this.apiCall('/v1/markets');
                    const info = marketsData.symbols?.[symbol];
                    if (info) {
                        const stats = info.stats || {};
                        const volume24h = parseFloat(stats['24h_quoteVolume'] || 0);
                        if (volume24h >= this.state.settings.minimumVolume) validPairs.push(symbol);
                    }
                } catch (err) {}
                await new Promise(r => setTimeout(r, 300));
            }
            return [...new Set(validPairs)].slice(0, maxCount);
        }

        let signals = [];
        let altfinsOk = false;
        try {
            signals = await this.getAltfinsBullishSignals(Math.max(maxCount * 5, 40));
            if (signals && signals.length > 0) altfinsOk = true;
        } catch (err) { altfinsOk = false; }

        const activeSymbols = new Set(this.state.activeTransactions.map(tx => tx.symbol));
        const marketsData = await this.apiCall('/v1/markets');
        const symbolsObj = marketsData.symbols || {};

        let candidateTokens = [];
        let candidateSource = 'wallex';

        if (altfinsOk) {
            const seenTokens = new Set();
            for (const sig of signals) {
                const token = String(sig.symbol || sig.coin || '').toUpperCase().trim();
                if (!token || seenTokens.has(token)) continue;
                if (STABLECOIN_BLACKLIST.has(token)) continue;
                if (['BTC', 'ETH'].includes(token) && candidateTokens.length > 3) continue;
                seenTokens.add(token);
                candidateTokens.push({ token, signalName: sig.signalName || sig.signalKey || '', fromAltfins: true });
                if (candidateTokens.length >= maxCount * 4) break;
            }
            candidateSource = 'altfins';
        }

                if (candidateTokens.length === 0) {
            candidateSource = 'wallex';
            const ranked = [];
            const seenTokens = new Set();
            // ⭐ [FIX] Scan BOTH USDT and TMN markets
            for (const sym of Object.keys(symbolsObj)) {
                let token = null;
                if (sym.endsWith('USDT')) token = sym.replace(/USDT$/, '');
                else if (sym.endsWith('TMN')) token = sym.replace(/TMN$/, '');
                else continue;

                if (!token || STABLECOIN_BLACKLIST.has(token) || ['BTC', 'ETH'].includes(token)) continue;
                if (seenTokens.has(token)) continue;

                const info = symbolsObj[sym] || {};
                const stats = info.stats || {};
                const vol = parseFloat(stats['24h_quoteVolume'] || stats.quoteVolume || 0) || 0;
                const last = parseFloat(stats['lastPrice'] || stats.last || 0) || 0;
                if (vol < (this.state.settings.minimumVolume || 0)) continue;
                if (last > 0 && last < (this.state.settings.minimumPrice || 0)) continue;
                ranked.push({ token, vol, last, symbol: sym });
                seenTokens.add(token);
            }
            ranked.sort((a, b) => b.vol - a.vol);
            const poolSize = Math.max(40, maxCount * 15);
            for (const r of ranked.slice(0, poolSize)) {
                candidateTokens.push({ token: r.token, fromAltfins: false });
            }
        }

        const scoredPairs = [];
        for (const cand of candidateTokens) {
            const usdtSym = cand.token + 'USDT';
            const tmnSym = cand.token + 'TMN';
            let symbol = null, marketInfo = null;
            if (symbolsObj[usdtSym]) { symbol = usdtSym; marketInfo = symbolsObj[usdtSym]; }
            else if (symbolsObj[tmnSym]) { symbol = tmnSym; marketInfo = symbolsObj[tmnSym]; }
            if (!symbol || !marketInfo) continue;
            if (activeSymbols.has(usdtSym) || activeSymbols.has(tmnSym)) continue;
            if (await this.isOnCooldown(usdtSym) || await this.isOnCooldown(tmnSym)) continue;

            const stats = marketInfo.stats || {};
            const volume24h = parseFloat(stats['24h_quoteVolume'] || 0);
            const currentPrice = parseFloat(stats['lastPrice'] || 0);
            if (volume24h < this.state.settings.minimumVolume) continue;
            if (currentPrice < this.state.settings.minimumPrice) continue;

            const testAmount = this.state.settings.stepAmounts?.[0] || 1.2;
            try {
                const sellable = await this.validateBuyWillBeSellable(cand.token, testAmount, null);
                if (!sellable.ok) continue;
            } catch (e) { continue; }

            const score = await this.calculatePairScore(symbol, marketInfo, stats);
            const boosted = cand.fromAltfins ? score + 8 : score;
            scoredPairs.push({ symbol, score: boosted, volume24h, token: cand.token, source: cand.fromAltfins ? 'altfins' : 'wallex' });
            if (scoredPairs.length >= maxCount * 2) break;
        }

        scoredPairs.sort((a, b) => b.score - a.score);
        const take = Math.max(maxCount, Math.min(scoredPairs.length, Math.max(12, maxCount * 3)));
        return scoredPairs.slice(0, take).map(p => p.symbol);
    }

    // ============================================================
    // CONNECTION CHECK
    // ============================================================
    async checkConnectionOnly() {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            const res = await fetch('https://api.wallex.ir/v1/markets?limit=1', { signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
                this.connectionFailCount = 0;
                this.isConnectionHealthy = true;
                return true;
            }
            throw new Error('API not ok');
        } catch (err) {
            this.connectionFailCount++;
            if (this.connectionFailCount >= MAX_FAILS) {
                this.isConnectionHealthy = false;
                if (!this.shouldStopTrading) await this.forceBackup();
            }
            return false;
        }
    }

    async forceBackup() {
        try {
            const backupState = {
                activeTransactions: JSON.parse(JSON.stringify(this.state.activeTransactions)),
                sellHistory: JSON.parse(JSON.stringify(this.state.sellHistory)),
                buyHistory: JSON.parse(JSON.stringify(this.buyHistory)),
                jumpHistory: JSON.parse(JSON.stringify(this.state.jumpHistory)),
                marketRegime: this.state.marketRegime,
                testBalance: this.state.testBalance,
                testTmnBalance: this.state.testTmnBalance || 0,
                lastUsdTmnRate: this.state.lastUsdTmnRate || 0,
                settings: this.state.settings,
                maxConcurrentCapital: this.maxConcurrentCapital,
                maxSingleTransactionCapital: this.maxSingleTransactionCapital,
                crisisCount: this.crisisCount,
                timestamp: Date.now()
            };
            const file = path.join(this.dataDir, 'bot-data-auto-backup.json');
            await fs.writeFile(file, JSON.stringify(backupState, null, 2));
            this.lastBackupTime = Date.now();
        } catch (err) {}
    }

    async createAutoBackup() {
        const now = Date.now();
        if (now - this.lastBackupTime < BACKUP_INTERVAL) return;
        await this.forceBackup();
    }

    // ============================================================
    // STATE SAVE / LOAD
    // ============================================================
    async saveState() {
        try {
            const transactionsToSave = this.state.activeTransactions.map(tx => ({
                symbol: tx.symbol, firstBuyPrice: tx.firstBuyPrice, lastBuyPrice: tx.lastBuyPrice,
                currentStep: tx.currentStep,
                buys: tx.buys.map(buy => ({
                    step: buy.step, price: buy.price, priceUsdtEq: buy.priceUsdtEq, priceTmnEq: buy.priceTmnEq,
                    rawPrice: buy.rawPrice, rateAtBuy: buy.rateAtBuy, quantity: buy.quantity, capitalUsed: buy.capitalUsed,
                    sold: buy.sold || false, sellPrice: buy.sellPrice, sellTimestamp: buy.sellTimestamp,
                    buyTimestamp: buy.buyTimestamp, isCumulative: buy.isCumulative || false,
                    cumulativeFromStep: buy.cumulativeFromStep, cumulativeToStep: buy.cumulativeToStep,
                    market: buy.market || 'USDT', jumpMode: buy.jumpMode
                })),
                totalQuantity: tx.totalQuantity, capitalUsed: tx.capitalUsed,
                currentPrice: tx.currentPrice, currentPriceTmn: tx.currentPriceTmn,
                waitingForCapital: tx.waitingForCapital || false,
                pendingStep: tx.pendingStep || null, pendingBuyPrice: tx.pendingBuyPrice || null,
                marketRegime: tx.marketRegime || 'SIDEWAYS', regimeSwitched: tx.regimeSwitched || false,
                exitConfirmCount: tx.exitConfirmCount || 0, originalRegime: tx.originalRegime,
                switchedAtStep: tx.switchedAtStep, switchedAtDrop: tx.switchedAtDrop,
                pendingJump: tx.pendingJump || null, pendingJumpCapital: tx.pendingJumpCapital || null,
                buyMarket: tx.buyMarket || 'USDT', buyMarketHistory: tx.buyMarketHistory || [tx.buyMarket || 'USDT'],
                preferredSellMarket: tx.preferredSellMarket || null
            }));

            const stateToSave = {
                activeTransactions: transactionsToSave,
                settings: this.state.settings,
                testBalance: this.state.testBalance,
                testTmnBalance: this.state.testTmnBalance || 0,
                lastUsdTmnRate: this.state.lastUsdTmnRate || 0,
                mode: this.state.mode,
                pairScores: this.state.pairScores,
                freedCapital: this.freedCapital,
                usageCount: this.state.usageCount,
                maxConcurrentCapital: this.maxConcurrentCapital,
                maxSingleTransactionCapital: this.maxSingleTransactionCapital,
                marketRegime: this.state.marketRegime,
                lastRegimeCheck: this.state.lastRegimeCheck,
                priceHistory: this.state.priceHistory,
                regimeConfidence: this.state.regimeConfidence,
                crisisCount: this.crisisCount,
                jumpHistory: this.state.jumpHistory,
                sellHistory: this.state.sellHistory,
                buyHistory: this.buyHistory,
                botLogs: this.botLogs.slice(-100),
                cooldownSeconds: this.COOLDOWN_SECONDS,
                dustBalances: this.state.dustBalances || {}
            };

            const payload = JSON.stringify(stateToSave, null, 2);
            const tmpFile = this.DATA_FILE + '.tmp';

            try {
                await fs.writeFile(tmpFile, payload, 'utf8');
                try {
                    if (fsSync.existsSync(this.DATA_FILE)) {
                        const curRaw = await fs.readFile(this.DATA_FILE, 'utf8');
                        if (curRaw && curRaw.trim().length > 50) {
                            await fs.writeFile(this.DATA_FILE_PREV, curRaw, 'utf8');
                        }
                    }
                } catch (_) {}
                try {
                    await fs.rename(tmpFile, this.DATA_FILE);
                } catch (renErr) {
                    await fs.writeFile(this.DATA_FILE, payload, 'utf8');
                    try { await fs.unlink(tmpFile); } catch (_) {}
                }
            } catch (e) {}

            try {
                await fs.writeFile(this.SELL_HISTORY_FILE, JSON.stringify(this.state.sellHistory, null, 2));
                await fs.writeFile(this.BUY_HISTORY_FILE, JSON.stringify(this.buyHistory, null, 2));
                await fs.writeFile(this.JUMP_HISTORY_FILE, JSON.stringify(this.state.jumpHistory, null, 2));
            } catch (e) {}
        } catch (err) {
            await this.addLog('ERROR', `Save state error: ${err.message}`);
        }
    }

    async loadState() {
        try {
            const candidates = [];
            const paths = [this.DATA_FILE, this.DATA_FILE_PREV];
            for (const p of paths) {
                try {
                    const raw = await fs.readFile(p, 'utf8');
                    if (!raw || !raw.trim() || raw.trim().length < 50) continue;
                    const parsed = JSON.parse(raw);
                    if (!parsed || typeof parsed !== 'object') continue;
                    const nTx = Array.isArray(parsed.activeTransactions) ? parsed.activeTransactions.length : 0;
                    const mode = (parsed.settings && parsed.settings.executionMode) || 'TEST';
                    let mtime = 0;
                    try { mtime = (await fs.stat(p)).mtimeMs || 0; } catch (_) {}
                    candidates.push({ path: p, state: parsed, nTx, mode, mtime });
                } catch (_) {}
            }

            if (candidates.length === 0) return false;

            candidates.sort((a, b) => {
                if (b.nTx !== a.nTx) return b.nTx - a.nTx;
                return b.mtime - a.mtime;
            });

            const best = candidates[0];
            const loaded = best.state;

            if (loaded.testBalance !== undefined && loaded.testBalance !== null && loaded.testBalance !== 0) {
                this.state.testBalance = loaded.testBalance;
            }
            if (loaded.testTmnBalance !== undefined) this.state.testTmnBalance = loaded.testTmnBalance;
            if (loaded.lastUsdTmnRate !== undefined) this.state.lastUsdTmnRate = loaded.lastUsdTmnRate;
            if (loaded.sellHistory) this.state.sellHistory = loaded.sellHistory;
            if (loaded.buyHistory) this.buyHistory = loaded.buyHistory;
            if (loaded.jumpHistory) this.state.jumpHistory = loaded.jumpHistory;
            if (loaded.botLogs) this.botLogs = loaded.botLogs;
            if (loaded.settings) this.state.settings = { ...this.state.settings, ...loaded.settings };
            if (loaded.marketRegime) this.state.marketRegime = loaded.marketRegime;
            if (loaded.crisisCount !== undefined) this.crisisCount = loaded.crisisCount;
            if (loaded.maxConcurrentCapital !== undefined) this.maxConcurrentCapital = loaded.maxConcurrentCapital;
            if (loaded.maxSingleTransactionCapital !== undefined) this.maxSingleTransactionCapital = loaded.maxSingleTransactionCapital;
            if (loaded.cooldownSeconds !== undefined) this.COOLDOWN_SECONDS = loaded.cooldownSeconds;
            if (loaded.dustBalances) this.state.dustBalances = loaded.dustBalances;
            if (loaded.freedCapital !== undefined) this.freedCapital = loaded.freedCapital;
            if (loaded.usageCount) this.state.usageCount = loaded.usageCount;
            if (loaded.pairScores) this.state.pairScores = loaded.pairScores;
            if (loaded.priceHistory) this.state.priceHistory = loaded.priceHistory;
            if (loaded.regimeConfidence !== undefined) this.state.regimeConfidence = loaded.regimeConfidence;
            if (loaded.lastRegimeCheck !== undefined) this.state.lastRegimeCheck = loaded.lastRegimeCheck;

            if (loaded.activeTransactions && loaded.activeTransactions.length > 0) {
                this.state.activeTransactions = loaded.activeTransactions.map(tx => ({
                    ...tx,
                    buys: (tx.buys || []).map(buy => ({
                        ...buy,
                        priceUsdtEq: buy.priceUsdtEq || buy.price,
                        priceTmnEq: buy.priceTmnEq || (buy.price * (this.state.lastUsdTmnRate || 1))
                    }))
                }));
                for (const tx of this.state.activeTransactions) {
                    const highest = (tx.buys || []).filter(b => !b.sold).reduce((m, b) => Math.max(m, b.step || 0), 0);
                    if (highest > 0 && (!tx.currentStep || tx.currentStep < highest)) {
                        tx.currentStep = highest;
                    }
                }
            }

            return this.state.activeTransactions.length > 0;
        } catch (err) {
            return false;
        }
    }

    // ============================================================
    // DAILY RISK
    // ============================================================
    resetDailyRiskIfNeeded(currentEquity) {
        const today = new Date().toISOString().slice(0, 10);
        if (this.dailyResetDate !== today) {
            this.dailyResetDate = today;
            this.dailyStartEquity = currentEquity || 0;
            this.dailyRealizedPnL = 0;
        }
    }

    updateDailyPnLFromSell(netProfit) {
        this.dailyRealizedPnL += (netProfit || 0);
    }

    isDailyRiskBreached(currentEquity) {
        this.resetDailyRiskIfNeeded(currentEquity);
        if (this.dailyRealizedPnL <= -DAILY_RISK.maxDailyLossUsdt) return { breached: true };
        if (this.dailyStartEquity > 0) {
            const lossPct = (this.dailyRealizedPnL / this.dailyStartEquity) * 100;
            if (lossPct <= -DAILY_RISK.maxDailyLossPercent) return { breached: true };
        }
        if (this.state.activeTransactions.length >= DAILY_RISK.maxOpenPositions) return { breached: true };
        return { breached: false };
    }

    calculateProfitSummary() {
        let totalProfit = 0;
        const numberOfSells = this.state.sellHistory.length;
        if (numberOfSells > 0) {
            this.state.sellHistory.forEach(sell => { totalProfit += (sell.totalNetProfit || 0); });
        }

        let currentBlockedCapital = 0;
        this.state.activeTransactions.forEach(tx => { currentBlockedCapital += tx.capitalUsed || 0; });
        if (currentBlockedCapital > this.maxConcurrentCapital) this.maxConcurrentCapital = currentBlockedCapital;

        let currentMaxSingleCapital = this.maxSingleTransactionCapital;
        for (const tx of this.state.activeTransactions) {
            if (tx.capitalUsed && tx.capitalUsed > currentMaxSingleCapital) currentMaxSingleCapital = tx.capitalUsed;
        }
        for (const sell of this.state.sellHistory) {
            if (sell.totalCapitalUsed && sell.totalCapitalUsed > currentMaxSingleCapital) currentMaxSingleCapital = sell.totalCapitalUsed;
        }
        if (currentMaxSingleCapital > this.maxSingleTransactionCapital) this.maxSingleTransactionCapital = currentMaxSingleCapital;

        return {
            numberOfSells,
            totalProfit: totalProfit.toFixed(2),
            maxConcurrentCapital: this.maxConcurrentCapital.toFixed(2),
            maxSingleTransactionCapital: this.maxSingleTransactionCapital.toFixed(2)
        };
    }

    // ============================================================
    // MARKET REGIME DETECTION
    // ============================================================
    async detectMarketRegime() {
        try {
            const now = Date.now();
            const checkInterval = 15 * 60 * 1000;
            if (now - this.state.lastRegimeCheck < checkInterval && this.state.regimeConfidence > 0.7) return this.state.marketRegime;
            const marketsData = await this.apiCall('/v1/markets');
            const symbolsObj = marketsData.symbols || {};
            let totalChange = 0, positiveCount = 0, negativeCount = 0, count = 0;
            for (const [symbol, info] of Object.entries(symbolsObj)) {
                if (!symbol.endsWith('USDT')) continue;
                const stats = info.stats || {};
                const change24h = parseFloat(stats['24h_change'] || 0);
                const volume24h = parseFloat(stats['24h_quoteVolume'] || 0);
                if (Math.abs(change24h) > 0.01 && volume24h > 10000) {
                    totalChange += change24h;
                    if (change24h > 0) positiveCount++;
                    if (change24h < 0) negativeCount++;
                    count++;
                }
            }
            if (count === 0) return this.state.marketRegime;
            const avgChange = totalChange / count;
            const positiveRatio = positiveCount / count;
            let newRegime = this.state.marketRegime;
            let confidence = 0;
            if (avgChange > 2 && positiveRatio > 0.6) {
                newRegime = 'BULL';
                confidence = Math.min(0.5 + (avgChange / 20), 0.9);
            } else if (avgChange < -2 && negativeCount > positiveCount) {
                newRegime = 'BEAR';
                confidence = Math.min(0.5 + (Math.abs(avgChange) / 20), 0.9);
            } else {
                newRegime = 'SIDEWAYS';
                confidence = 0.7;
            }
            this.state.marketRegime = newRegime;
            this.state.regimeConfidence = confidence;
            this.state.lastRegimeCheck = now;
            await this.saveState();
            return newRegime;
        } catch (err) {
            return this.state.marketRegime;
        }
    }

    calculateDropPercentages(firstDrop, lastDrop, steps, emergencyDrops = null) {
        const drops = [];
        if (steps === 1) return [firstDrop];
        const logFirst = Math.log(firstDrop);
        const logLast = Math.log(lastDrop);
        const logStep = (logLast - logFirst) / (steps - 1);
        for (let i = 0; i < steps; i++) {
            let drop = Math.exp(logFirst + (i * logStep));
            drops.push(Number(drop.toFixed(2)));
        }
        if (emergencyDrops && emergencyDrops.length > 0) {
            for (const drop of emergencyDrops) drops.push(drop);
        }
        return drops;
    }

    generateStepRanges(dropPercentages) {
        const stepRanges = [];
        for (let i = 0; i < dropPercentages.length; i++) {
            stepRanges.push({ step: i + 1, min: Number((i === 0 ? 0 : dropPercentages[i-1]).toFixed(2)), max: Number(dropPercentages[i].toFixed(2)) });
        }
        return stepRanges;
    }

    generateLinearSellPercentages(totalSteps) {
        const minProfit = 0.5, maxProfit = 0.8;
        const percentages = [];
        for (let i = 0; i < totalSteps; i++) {
            const profit = minProfit + (i / (totalSteps - 1)) * (maxProfit - minProfit);
            percentages.push(Number(profit.toFixed(2)));
        }
        return percentages;
    }

    getSettingsForRegime(regime, totalSteps = 25) {
        let settings, emergencyData;
        switch (regime) {
            case 'BEAR': settings = { ...BEAR_SETTINGS }; emergencyData = BEAR_SETTINGS.emergencySteps; break;
            case 'BULL': settings = { ...BULL_SETTINGS }; emergencyData = BULL_SETTINGS.emergencySteps; break;
            default: settings = { ...SIDEWAYS_SETTINGS }; emergencyData = SIDEWAYS_SETTINGS.emergencySteps;
        }
        const normalSteps = 20;
        const dropPercentages = this.calculateDropPercentages(settings.firstDrop, settings.lastDrop, normalSteps, emergencyData ? emergencyData.drops : null);
        const stepAmounts = [...settings.stepAmounts];
        if (emergencyData && emergencyData.capitals) stepAmounts.push(...emergencyData.capitals);
        const sellPercentages = this.generateLinearSellPercentages(stepAmounts.length);
        const stepRanges = this.generateStepRanges(dropPercentages);
        return { regime, dropPercentages, stepAmounts, stepRanges, sellPercentages, icon: settings.icon, name: settings.name, totalSteps: stepAmounts.length };
    }

    async updateBotSettingsForRegime() {
        const regime = await this.detectMarketRegime();
        const regimeSettings = this.getSettingsForRegime(regime, 25);
        this.state.settings.stepAmounts = regimeSettings.stepAmounts;
        this.state.settings.sellPercentages = regimeSettings.sellPercentages;
        this.state.settings.stepRanges = regimeSettings.stepRanges;
        this.state.settings.maxSteps = regimeSettings.totalSteps;
        return regime;
    }

    async initializeStepSettings() {
    const regime = this.state.marketRegime || 'SIDEWAYS';
    const regimeSettings = this.getSettingsForRegime(regime, 25);
    
    this.state.settings.stepAmounts = regimeSettings.stepAmounts;
    this.state.settings.sellPercentages = regimeSettings.sellPercentages;
    this.state.settings.stepRanges = regimeSettings.stepRanges;
    this.state.settings.maxSteps = regimeSettings.totalSteps;
    
    console.log(`[${this.userId}] Step settings initialized: ${regimeSettings.stepRanges.length} ranges, ${regimeSettings.stepAmounts.length} amounts`);
    console.log(`[${this.userId}] First 5 ranges: ${JSON.stringify(regimeSettings.stepRanges.slice(0, 5))}`);
    console.log(`[${this.userId}] Last 5 ranges: ${JSON.stringify(regimeSettings.stepRanges.slice(-5))}`);
    
    await this.saveState();
    return true;
}

    // ============================================================
    // CLUSTER
    // ============================================================
    getTokenCluster(token) {
        try {
            const filter = this.state.settings.marketTrendFilter;
            if (!filter || !filter.enabled) return null;
            const clusters = filter.correlatedTokens || {};
            const upperToken = String(token).toUpperCase();
            for (const [clusterName, tokens] of Object.entries(clusters)) {
                if (Array.isArray(tokens) && tokens.includes(upperToken)) return clusterName;
            }
            return null;
        } catch (err) { return null; }
    }

    countActivePositionsInCluster(cluster) {
        if (!cluster) return 0;
        try {
            let count = 0;
            for (const tx of this.state.activeTransactions) {
                const base = this.getBaseToken(tx.symbol);
                if (this.getTokenCluster(base) === cluster) count++;
            }
            return count;
        } catch (err) { return 0; }
    }

    canOpenInCluster(token) {
        try {
            const filter = this.state.settings.marketTrendFilter;
            if (!filter || !filter.enabled) return { ok: true };
            const cluster = this.getTokenCluster(token);
            if (!cluster) return { ok: true };
            const current = this.countActivePositionsInCluster(cluster);
            const max = filter.maxSameClusterPositions || 1;
            if (current >= max) {
                return { ok: false, reason: 'cluster_limit', message: `Cluster "${cluster}" already has ${current} active position(s)` };
            }
            return { ok: true, cluster, current };
        } catch (err) { return { ok: true }; }
    }

    getClusterStatus() {
        try {
            const summary = {};
            for (const tx of this.state.activeTransactions) {
                const base = this.getBaseToken(tx.symbol);
                const cluster = this.getTokenCluster(base);
                if (cluster) summary[cluster] = (summary[cluster] || 0) + 1;
            }
            return summary;
        } catch (err) { return {}; }
    }

    // ============================================================
    // DOWNTREND
    // ============================================================
    async isMarketInDowntrend() {
        try {
            const filter = this.state.settings.marketTrendFilter;
            if (!filter || !filter.enabled) return false;
            const btcInfo = await this.getMarketInfo(filter.btcSymbol);
            if (!btcInfo) return false;
            const stats = btcInfo.stats || {};
            const change24h = parseFloat(stats['24h_change'] || 0);
            const estimatedChange4h = change24h / 6;
            if (estimatedChange4h < -filter.btcDumpPercent) return true;

            const marketsData = await this.apiCall('/v1/markets');
            const symbolsObj = marketsData.symbols || {};
            let negativeCount = 0, total = 0;
            for (const [sym, info] of Object.entries(symbolsObj)) {
                if (!sym.endsWith('USDT')) continue;
                const ch = parseFloat((info.stats || {})['24h_change'] || 0);
                if (Math.abs(ch) > 0.01) {
                    total++;
                    if (ch < 0) negativeCount++;
                }
            }
            if (total > 10 && (negativeCount / total) > 0.7) return true;
            return false;
        } catch (err) { return false; }
    }

    // ============================================================
    // JUMP BUY
    // ============================================================
    calculateJumpCapital(fromStep, toStep, mode = 'SINGLE') {
        let total = 0;
        if (mode === 'SINGLE') {
            total = this.state.settings.stepAmounts[toStep - 1] || 0;
        } else {
            for (let step = fromStep + 1; step <= toStep; step++) {
                total += this.state.settings.stepAmounts[step - 1] || 0;
            }
        }
        return total;
    }

    async cancelPendingOrder(tx) {
        if (!tx.waitingForCapital) return false;
        tx.waitingForCapital = false;
        tx.pendingStep = null;
        tx.pendingBuyPrice = null;
        tx.pendingJump = null;
        tx.pendingJumpCapital = null;
        await this.saveState();
        return true;
    }

    async updatePendingOrdersStatus() {
        for (const tx of this.state.activeTransactions) {
            if (tx.waitingForCapital && tx.pendingStep) {
                const dropFromLastBuy = this.getDropFromLastBuy(tx);
                const range = this.state.settings.stepRanges.find(r => r.step === tx.pendingStep);
                if (!range || dropFromLastBuy < range.min || dropFromLastBuy > range.max) {
                    tx.waitingForCapital = false;
                    tx.pendingStep = null;
                    tx.pendingBuyPrice = null;
                    tx.pendingJump = null;
                    tx.pendingJumpCapital = null;
                    await this.saveState();
                } else {
                    tx.pendingBuyPrice = tx.lastBuyPrice * (1 - (range.min / 100));
                }
            }
        }
    }

    async executeCumulativeJumpBuy(tx, targetStep, dropPercent) {
        const fromStep = tx.currentStep;
        const jumpMode = this.state.settings.jumpBuyMode || 'SINGLE';
        const base = this.getBaseToken(tx.symbol);

        const existingSteps = new Set((tx.buys || []).filter(b => !b.sold).map(b => b.step));
        if (existingSteps.has(targetStep) || this.isStepAlreadyBought(tx, targetStep)) {
            if (tx.currentStep < targetStep) {
                tx.currentStep = targetStep;
                await this.saveState();
            }
            return false;
        }

        let cumulativeCapital = this.calculateJumpCapital(fromStep, targetStep, jumpMode);
        const remainingCapital = this.getRemainingTradeCapital(tx);
        if (remainingCapital < cumulativeCapital * 0.5 && remainingCapital < cumulativeCapital) return false;
        cumulativeCapital = this.clampBuyToPositionLimit(tx, cumulativeCapital);
        if (cumulativeCapital <= 0) return false;

        const bestBuy = await this.evaluateBestBuyPath(base, cumulativeCapital);
        if (!bestBuy) return false;

        const sellable = await this.validateBuyWillBeSellable(base, cumulativeCapital, bestBuy);
        if (!sellable.ok) return false;

        const cap = await this.ensureCapital(bestBuy.market, bestBuy.quoteAmount);
        if (!cap.ok) {
            tx.waitingForCapital = true;
            tx.pendingSince = Date.now();
            tx.pendingStep = targetStep;
            tx.pendingJump = { fromStep, toStep: targetStep, cumulativeCapital, mode: jumpMode, preferredMarket: bestBuy.market };
            tx.pendingJumpCapital = cumulativeCapital;
            await this.saveState();
            return false;
        }

        try {
            const buy = await this.placeMarketBuy(bestBuy.symbol, bestBuy.quoteAmount);
            const rate = bestBuy.rate || this.state.lastUsdTmnRate || 1;
            const capitalUsedUsdt = (buy.grossValue != null)
                ? (bestBuy.market === 'TMN' ? (rate > 0 ? buy.grossValue / rate : cumulativeCapital) : buy.grossValue)
                : cumulativeCapital;
            const dual = this.computeDualPrices(buy.executedPrice, bestBuy.market, rate);

            tx.buys.push({
                step: targetStep,
                price: dual.priceUsdtEq, priceUsdtEq: dual.priceUsdtEq, priceTmnEq: dual.priceTmnEq,
                rawPrice: dual.rawPrice, rateAtBuy: rate,
                quantity: buy.quantity, capitalUsed: capitalUsedUsdt, sold: false,
                buyTimestamp: new Date().toISOString(),
                isCumulative: (jumpMode === 'CUMULATIVE'),
                cumulativeFromStep: (jumpMode === 'CUMULATIVE') ? fromStep + 1 : null,
                cumulativeToStep: (jumpMode === 'CUMULATIVE') ? targetStep : null,
                jumpMode, market: bestBuy.market
            });

            if (!tx.buyMarketHistory) tx.buyMarketHistory = [];
            if (!tx.buyMarketHistory.includes(bestBuy.market)) tx.buyMarketHistory.push(bestBuy.market);

            if (!this.buyHistory[tx.symbol]) this.buyHistory[tx.symbol] = [];
            if (jumpMode === 'SINGLE') {
                if (!this.buyHistory[tx.symbol].includes(targetStep)) this.buyHistory[tx.symbol].push(targetStep);
            } else {
                for (let step = fromStep + 1; step <= targetStep; step++) {
                    if (!this.buyHistory[tx.symbol].includes(step)) this.buyHistory[tx.symbol].push(step);
                }
            }
            this.buyHistory[tx.symbol].sort((a, b) => a - b);

            this.state.jumpHistory.push({
                symbol: tx.symbol, fromStep, toStep: targetStep,
                cumulativeCapital: capitalUsedUsdt, buyPrice: dual.priceUsdtEq,
                dropPercent, mode: jumpMode, market: bestBuy.market,
                timestamp: new Date().toISOString()
            });

            tx.currentStep = targetStep;
            tx.totalQuantity += buy.quantity;
            tx.lastBuyPrice = dual.priceUsdtEq;
            tx.capitalUsed += capitalUsedUsdt;
            tx.buyMarket = bestBuy.market;
            if (capitalUsedUsdt > this.maxSingleTransactionCapital) this.maxSingleTransactionCapital = capitalUsedUsdt;
            tx.waitingForCapital = false;
            tx.pendingStep = null;
            tx.pendingBuyPrice = null;
            tx.pendingJump = null;
            tx.pendingJumpCapital = null;

            await this.saveState();
            this.logImportant(`${jumpMode} jump buy completed on ${bestBuy.market}`);
            return true;
        } catch (err) {
            await this.addLog('ERROR', `${jumpMode} jump buy error: ${err.message}`);
            return false;
        }
    }

    // ============================================================
    // REGIME SWITCH / SMART EXIT
    // ============================================================
    async checkAndSwitchRegime(tx) {
        if (tx.regimeSwitched) return false;
        const dropFromFirstBuy = ((tx.firstBuyPrice - tx.currentPrice) / tx.firstBuyPrice) * 100;
        let maxAllowedDrop = 0;
        switch (tx.marketRegime) {
            case 'BEAR': maxAllowedDrop = 20; break;
            case 'BULL': maxAllowedDrop = 8; break;
            default: maxAllowedDrop = 12;
        }
        if (dropFromFirstBuy <= maxAllowedDrop) return false;
        this.crisisCount++;
        const highestBought = (tx.buys || []).filter(b => !b.sold).reduce((m, b) => Math.max(m, b.step || 0), tx.currentStep || 1);

        tx.marketRegime = 'BEAR';
        tx.regimeSwitched = true;
        tx.currentStep = highestBought;
        tx.originalRegime = tx.originalRegime || 'SIDEWAYS';
        tx.switchedAtStep = highestBought;
        tx.switchedAtDrop = dropFromFirstBuy;
        await this.saveState();
        return true;
    }

    async checkAndExecuteSmartExit(tx) {
        if (!tx.regimeSwitched) return false;
        if (!tx.buys || tx.buys.length === 0) return false;
        const unsoldBuys = tx.buys.filter(b => !b.sold);
        if (unsoldBuys.length === 0) return false;

        const rate = this.state.lastUsdTmnRate || 0;
        const dual = this.computeDualAverages(unsoldBuys, rate);
        const usdtSym = this.toUsdtSymbol(this.getBaseToken(tx.symbol));
        let usdtPrice = 0;
        try { usdtPrice = await this.getCurrentPrice(usdtSym); } catch {}
        if (usdtPrice <= 0) return false;

        const expectedNet = (usdtPrice * dual.totalQty * (1 - FEES.USDT.sell)) - dual.totalCapitalUsed;
        const expectedNetPct = dual.totalCapitalUsed > 0 ? (expectedNet / dual.totalCapitalUsed) * 100 : 0;
        const canExit = (usdtPrice >= dual.avgUsdt && expectedNet > 0 && expectedNetPct >= EXIT_CONFIG.minProfitPercent);

        if (canExit) {
            tx.exitConfirmCount = (tx.exitConfirmCount || 0) + 1;
            if (tx.exitConfirmCount >= EXIT_CONFIG.confirmationCount) {
                try {
                    const baseTok = this.getBaseToken(tx.symbol);
                    const dustQty = this.getDustQty(baseTok);
                    let qtyToSell = dual.totalQty + dustQty;
                    if (this.state.settings.executionMode !== 'TEST') {
                        try {
                            const realBal = await this.getTokenBalance(usdtSym);
                            if (realBal > 0 && realBal < qtyToSell) qtyToSell = realBal * 0.9999;
                        } catch (e) {}
                    }

                    const sell = await this.placeMarketSell(usdtSym, qtyToSell, dual.avgUsdt, dual.totalCapitalUsed);
                    let actualSold = sell.rawExecutedQty || sell.quantity || qtyToSell;

                    const coveredFromTx = Math.min(actualSold, dual.totalQty);
                    const leftoverFromTx = Math.max(0, dual.totalQty - coveredFromTx);
                    const dustConsumed = Math.min(dustQty, Math.max(0, actualSold - coveredFromTx));
                    this.setDustQty(baseTok, leftoverFromTx + Math.max(0, dustQty - dustConsumed), usdtSym);

                    const soldFraction = dual.totalQty > 0 ? (coveredFromTx / dual.totalQty) : 1;
                    const capitalForThisSell = dual.totalCapitalUsed * soldFraction;
                    const receivedForTx = qtyToSell > 0 ? (sell.received * (coveredFromTx / qtyToSell)) : sell.received;
                    const finalProfit = receivedForTx - capitalForThisSell;

                    if (finalProfit > 0) {
                        await this.reportProfitableTrade({
                            symbol: tx.symbol, buyPrice: dual.avgUsdt, sellPrice: sell.executedPrice,
                            quantity: coveredFromTx, netProfit: finalProfit, market: 'USDT',
                            orderType: sell.orderTypeUsed || 'CRISIS_EXIT'
                        });
                    }

                    const sellRecord = {
                        symbol: tx.symbol, type: 'CRISIS_EXIT',
                        totalQuantity: coveredFromTx, actualSoldQuantity: actualSold, dustIncluded: dustQty,
                        avgBuyPrice: dual.avgUsdt, sellPrice: sell.executedPrice,
                        totalCapitalUsed: capitalForThisSell, totalNetProfit: finalProfit,
                        buyMarket: tx.buyMarket || 'USDT', market: 'USDT',
                        timestamp: new Date().toISOString()
                    };
                    this.state.sellHistory.push(sellRecord);
                    this.updateDailyPnLFromSell(finalProfit);

                    if (coveredFromTx >= dual.totalQty * 0.99 || leftoverFromTx <= DUST_EPSILON) {
                        for (const buy of unsoldBuys) {
                            buy.sold = true;
                            buy.sellPrice = sell.executedPrice;
                            buy.sellTimestamp = new Date().toISOString();
                        }
                        if (this.buyHistory[tx.symbol]) delete this.buyHistory[tx.symbol];
                        const index = this.state.activeTransactions.findIndex(t => t.symbol === tx.symbol);
                        if (index !== -1) this.state.activeTransactions.splice(index, 1);
                    } else {
                        for (const buy of unsoldBuys) {
                            buy.quantity = Math.max(0, buy.quantity * (1 - soldFraction));
                            if (buy.capitalUsed) buy.capitalUsed = Math.max(0, buy.capitalUsed * (1 - soldFraction));
                        }
                        tx.totalQuantity = Math.max(0, (tx.totalQuantity || 0) - coveredFromTx);
                        tx.capitalUsed = Math.max(0, (tx.capitalUsed || 0) - capitalForThisSell);
                    }
                    await this.addToCooldown(tx.symbol, 300);
                    await this.saveState();
                    return true;
                } catch (err) {
                    await this.addLog('ERROR', `Crisis exit error ${tx.symbol}: ${err.message}`);
                }
            }
        } else {
            tx.exitConfirmCount = 0;
        }
        return false;
    }

    // ============================================================
    // START NEW GRID
    // ============================================================
    async startNewGrid(symbol) {
        const base = this.getBaseToken(symbol);
        const lockKey = `grid_${base}`;
        if (!this.acquireSymbolLock(lockKey)) return false;
        try {
            const usdtSym = this.toUsdtSymbol(base);
            const existingTx = this.state.activeTransactions.find(tx => this.getBaseToken(tx.symbol) === base);
            if (existingTx) return false;
            if (await this.isOnCooldown(usdtSym) || await this.isOnCooldown(this.toTmnSymbol(base))) return false;
            const maxConcurrent = this.state.settings.maxConcurrent || 10;
            if (this.state.activeTransactions.length >= maxConcurrent) return false;

            if (await this.isMarketInDowntrend()) {
                await this.addToCooldown(usdtSym, 600);
                await this.addToCooldown(this.toTmnSymbol(base), 600);
                return false;
            }

            const clusterCheck = this.canOpenInCluster(base);
            if (!clusterCheck.ok) {
                await this.addToCooldown(usdtSym, 900);
                await this.addToCooldown(this.toTmnSymbol(base), 900);
                return false;
            }

            const currentRegime = await this.detectMarketRegime();
            const regimeSettings = this.getSettingsForRegime(currentRegime, 25);
            let amountUsdt = regimeSettings.stepAmounts[0] || 1.2;
            amountUsdt = this.clampBuyToPositionLimit(null, amountUsdt);
            if (amountUsdt <= 0) return false;

            const bestBuy = await this.evaluateBestBuyPath(base, amountUsdt);
            if (!bestBuy) return false;

            const sellable = await this.validateBuyWillBeSellable(base, amountUsdt, bestBuy);
            if (!sellable.ok) {
                try { await this.addToCooldown(usdtSym, 300); await this.addToCooldown(this.toTmnSymbol(base), 300); } catch (_) {}
                return false;
            }

            const cap = await this.ensureCapital(bestBuy.market, bestBuy.quoteAmount);
            if (!cap.ok) return false;

            if (this.state.settings.executionMode === 'REAL') {
                await this.cancelOpenOrders(bestBuy.symbol);
            }

            const buy = await this.placeMarketBuy(bestBuy.symbol, bestBuy.quoteAmount);
            const rate = bestBuy.rate || this.state.lastUsdTmnRate || 1;
            const capitalUsedUsdt = (buy.grossValue != null)
                ? (bestBuy.market === 'TMN' ? (rate > 0 ? buy.grossValue / rate : amountUsdt) : buy.grossValue)
                : amountUsdt;
            if (capitalUsedUsdt > this.maxSingleTransactionCapital) this.maxSingleTransactionCapital = capitalUsedUsdt;

            const stillNotExists = !this.state.activeTransactions.find(tx => this.getBaseToken(tx.symbol) === base);
            if (!stillNotExists) return false;

            const dual = this.computeDualPrices(buy.executedPrice, bestBuy.market, rate);

            this.state.activeTransactions.push({
                symbol: usdtSym,
                firstBuyPrice: dual.priceUsdtEq,
                lastBuyPrice: dual.priceUsdtEq,
                currentStep: 1,
                buys: [{
                    step: 1, price: dual.priceUsdtEq, priceUsdtEq: dual.priceUsdtEq, priceTmnEq: dual.priceTmnEq,
                    rawPrice: dual.rawPrice, rateAtBuy: rate, quantity: buy.quantity, capitalUsed: capitalUsedUsdt,
                    sold: false, buyTimestamp: new Date().toISOString(), isCumulative: false, market: bestBuy.market
                }],
                totalQuantity: buy.quantity, capitalUsed: capitalUsedUsdt,
                currentPrice: dual.priceUsdtEq, currentPriceTmn: dual.priceTmnEq,
                waitingForCapital: false, pendingStep: null, pendingBuyPrice: null,
                marketRegime: currentRegime, regimeSwitched: false, exitConfirmCount: 0,
                pendingJump: null, pendingJumpCapital: null,
                buyMarket: bestBuy.market, buyMarketHistory: [bestBuy.market],
                preferredSellMarket: null
            });

            this.logImportant(`${usdtSym} bought on ${bestBuy.market} @ ${buy.executedPrice}`);

            if (!this.buyHistory[usdtSym]) this.buyHistory[usdtSym] = [];
            if (!this.buyHistory[usdtSym].includes(1)) {
                this.buyHistory[usdtSym].push(1);
                this.buyHistory[usdtSym].sort((a, b) => a - b);
            }
            await this.saveState();
            return true;
        } catch (err) {
            await this.addLog('ERROR', `${symbol} start error: ${err.message}`);
            try {
                await this.addToCooldown(symbol, 600);
                const baseTok = this.getBaseToken(symbol);
                await this.addToCooldown(baseTok + 'USDT', 600);
                await this.addToCooldown(baseTok + 'TMN', 600);
            } catch (_) {}
            if (/1006|موجودی|insufficient|capital|BUY capital/i.test(err.message || '')) {
                this.buyBlockedUntil = Date.now() + BUY_FAIL_COOLDOWN_MS;
            }
            return false;
        } finally {
            this.releaseSymbolLock(lockKey);
        }
    }

    // ============================================================
    // FILL EMPTY SLOTS
    // ============================================================
    async fillEmptySlots(reason = 'startup') {
        // ⭐ Check deposit lock ONLY in REAL mode
        const currentMode = process.env.MODE || 'TEST';
        const isTestMode = currentMode === 'TEST';

        if (!isTestMode && (this.lockedByDeposit || isBotLocked(this.userId))) {
            return;
        }

        if (Date.now() < this.buyBlockedUntil) return;
        try {
            const bal = await this.getDetailedBalance();
            const risk = this.isDailyRiskBreached(bal.totalEquity);
            if (risk.breached) return;
            if (bal.blockedTotal > (bal.totalEquity * DAILY_RISK.maxCapitalPercent / 100)) return;
            const minStep = (this.state.settings.stepAmounts && this.state.settings.stepAmounts[0]) || 1.0;
            if ((bal.available || 0) < Math.max(minStep * 0.95, DAILY_RISK.minFreeUsdtToBuy)) return;
        } catch (_) {}
        if (this.isFillingSlots) return false;
        this.isFillingSlots = true;
        try {
            if (this.state.settings.completeOnlyMode) return false;
            const maxConcurrent = Math.min(this.state.settings.maxConcurrent || 8, DAILY_RISK.maxOpenPositions);
            const slotsAvailable = maxConcurrent - this.state.activeTransactions.length;
            if (slotsAvailable <= 0) return false;
            const balance = await this.getDetailedBalance();
            const minAmount = this.state.settings.stepAmounts[0] || 1.0;
            const availableBalance = balance.available;
            if (availableBalance < minAmount) return false;
            const needToStart = Math.min(slotsAvailable, Math.floor(availableBalance / minAmount));
            if (needToStart <= 0) return false;

            const allPairs = await this.getAvailablePairs(Math.max(12, needToStart + 10));
            const activeSymbols = new Set(this.state.activeTransactions.map(tx => tx.symbol));
            const availablePairs = [];
            for (const pair of allPairs) {
                if (activeSymbols.has(pair)) continue;
                if (await this.isOnCooldown(pair)) continue;
                availablePairs.push(pair);
                if (availablePairs.length >= Math.max(8, needToStart * 5)) break;
            }
            if (availablePairs.length === 0) return false;

            let started = 0;
            for (const pair of availablePairs) {
                if (this.state.activeTransactions.length >= maxConcurrent) break;
                if (started >= needToStart) break;
                const ok = await this.startNewGrid(pair);
                if (ok) { started++; await this._sleep(1500); }
                else { await this._sleep(800); }
            }
            if (started > 0) {
                this.logImportant(`Started ${started} new grid(s) (${reason})`);
            }
            return started > 0;
        } catch (err) {
            await this.addLog('ERROR', `fillEmptySlots error: ${err.message}`);
            return false;
        } finally {
            this.isFillingSlots = false;
        }
    }

    // ============================================================
    // GROUP SELL TARGET
    // ============================================================
    calculateGroupSellTarget(tx) {
        const unsoldBuys = tx.buys.filter(b => !b.sold);
        if (unsoldBuys.length === 0) return null;
        const rate = this.state.lastUsdTmnRate || 0;
        const dual = this.computeDualAverages(unsoldBuys, rate);
        const lastStep = unsoldBuys[unsoldBuys.length - 1].step;
        const buyMarket = tx.buyMarket || 'USDT';

        const dynamicUSDT = this.calculateDynamicSellPercent(tx, lastStep, 'USDT');
        const dynamicTMN = this.calculateDynamicSellPercent(tx, lastStep, 'TMN');
        const sellPctUsdt = dynamicUSDT.sellPercent;
        const targetSellPriceUsdt = dual.avgUsdt * (1 + sellPctUsdt / 100);
        const sellPctTmn = dynamicTMN.sellPercent;
        const targetSellPriceTmn = dual.avgTmn * (1 + sellPctTmn / 100);

        const expectedNetAtUsdt = (price) => {
            if (dual.totalCapitalUsed <= 0 || dual.totalQty <= 0) return 0;
            const grossValue = price * dual.totalQty;
            const fee = FEES.USDT.sell;
            return grossValue * (1 - fee) - dual.totalCapitalUsed;
        };
        const expectedNetAtTmn = (price) => {
            if (dual.totalCapitalUsed <= 0 || dual.totalQty <= 0 || rate <= 0) return 0;
            const grossValueTmn = price * dual.totalQty;
            const fee = FEES.TMN.sell;
            const netTmn = grossValueTmn * (1 - fee);
            const netUsdt = (netTmn / rate) * (1 - CONVERSION_FEES.TMN_TO_USDT);
            return netUsdt - dual.totalCapitalUsed;
        };

        return {
            totalQuantity: dual.totalQty, totalCapitalUsed: dual.totalCapitalUsed,
            avgPriceUsdt: dual.avgUsdt, avgPriceTmn: dual.avgTmn,
            targetSellPriceUsdt, targetSellPriceTmn,
            sellPctUsdt, sellPctTmn,
            expectedNetAtUsdt, expectedNetAtTmn,
            unsoldBuys, buyMarket, lastStep, rate
        };
    }

    // ============================================================
    // MONITOR
    // ============================================================
    // ============================================================
    // MONITOR
    // ============================================================
    async monitor() {
        // Check deposit lock ONLY in REAL mode
        const currentMode = process.env.MODE || 'TEST';
        const isTestMode = currentMode === 'TEST';

        if (!isTestMode && isBotLocked(this.userId)) {
            this.lockedByDeposit = true;
        }

        const connectionOk = await this.checkConnectionOnly();
        if (!connectionOk) {
            if (this.connectionFailCount >= MAX_FAILS && !this.shouldStopTrading) {
                this.shouldStopTrading = true;
                this.logImportant('CONNECTION LOST - trading paused');
            }
            return;
        }
        if (this.shouldStopTrading) {
            this.shouldStopTrading = false;
            this.logImportant('CONNECTION RESTORED - resuming');
            for (const tx of this.state.activeTransactions) {
                if (tx && tx.symbol) tx.currentPrice = await this.getCurrentPrice(tx.symbol);
            }
            await this.saveState();
        }
        try {
            const balance = await this.getDetailedBalance();
            if (balance.isOverleveraged) {
                await this.saveState();
                await this.createAutoBackup();
                return;
            }
            if (this.state.settings.adaptiveMode) await this.updateBotSettingsForRegime();

            // [FIX] Ensure stepRanges exists
            if (!this.state.settings.stepRanges || this.state.settings.stepRanges.length === 0) {
                console.log(`[FIX ${this.userId}] stepRanges empty - initializing...`);
                await this.initializeStepSettings();
            }

            for (const tx of this.state.activeTransactions) {
                if (!tx || !tx.symbol) continue;
                const base = this.getBaseToken(tx.symbol);
                const usdtSym = this.toUsdtSymbol(base);
                const tmnSym = this.toTmnSymbol(base);
                const rate = this.state.lastUsdTmnRate || await this.getUsdTmnRate();
                const usdtPx = await this.getCurrentPrice(usdtSym);
                const tmnPx = await this.getCurrentPrice(tmnSym);
                if (usdtPx > 0) tx.currentPrice = usdtPx;
                if (tmnPx > 0 && rate > 0) tx.currentPriceTmn = tmnPx;
            }

            await this.updatePendingOrdersStatus();
            for (const tx of this.state.activeTransactions) {
                if (!tx.regimeSwitched) await this.checkAndSwitchRegime(tx);
            }
            for (let i = this.state.activeTransactions.length - 1; i >= 0; i--) {
                const tx = this.state.activeTransactions[i];
                const exited = await this.checkAndExecuteSmartExit(tx);
                if (exited) continue;
            }

            // Only process buys if not locked
            if (!this.lockedByDeposit) {
                const maxSteps = this.state.settings.maxSteps || 25;
                for (const tx of this.state.activeTransactions) {
                    if (!tx || !tx.symbol) continue;
                    const base = this.getBaseToken(tx.symbol);
                    const lockKey = `buy_${base}`;
                    if (!this.acquireSymbolLock(lockKey)) continue;
                    try {
                        const dropFromLastBuy = this.getDropFromLastBuy(tx);
                        const existingSteps = new Set((tx.buys || []).filter(b => !b.sold).map(b => b.step));

                        // [FIX] Find best matching step using all ranges
                        let targetStep = -1;
                        const allRanges = this.state.settings.stepRanges || [];

                        for (const range of allRanges) {
                            if (range.step <= tx.currentStep) continue;
                            if (existingSteps.has(range.step)) continue;

                            if (dropFromLastBuy >= range.min && dropFromLastBuy <= range.max) {
                                targetStep = range.step;
                                break;
                            }
                            if (dropFromLastBuy < range.min) {
                                break;
                            }
                        }

                        // [FIX] Fallback: if drop is beyond all defined ranges
                        if (targetStep === -1) {
                            for (const range of allRanges) {
                                if (range.step <= tx.currentStep) continue;
                                if (existingSteps.has(range.step)) continue;
                                if (dropFromLastBuy > range.max) {
                                    targetStep = range.step;
                                }
                            }
                        }

                        if (targetStep !== -1 && !tx.waitingForCapital) {
                            const jumpMode = this.state.settings.jumpBuyMode || 'SINGLE';
                            const isJump = targetStep > tx.currentStep + 1;
                            if (isJump) {
                                await this.executeCumulativeJumpBuy(tx, targetStep, dropFromLastBuy);
                            } else {
                                const nextRange = this.state.settings.stepRanges.find(r => r.step === targetStep);
                                if (nextRange && dropFromLastBuy >= nextRange.min) {
                                    if (this.isStepAlreadyBought(tx, targetStep)) continue;
                                    let requiredCapitalNormal = this.state.settings.stepAmounts[targetStep - 1] || 0;
                                    const remainingCapitalNormal = this.getRemainingTradeCapital(tx);
                                    if (remainingCapitalNormal <= 0) {
                                        tx.currentStep = targetStep;
                                        await this.saveState();
                                        continue;
                                    }
                                    if (remainingCapitalNormal < requiredCapitalNormal * 0.5) {
                                        tx.currentStep = targetStep;
                                        await this.saveState();
                                        continue;
                                    }
                                    if (requiredCapitalNormal > remainingCapitalNormal) requiredCapitalNormal = remainingCapitalNormal;
                                    const currentBalance = await this.getDetailedBalance();
                                    if (currentBalance.available >= requiredCapitalNormal) {
                                        const baseTok = this.getBaseToken(tx.symbol);
                                        const sellableStep = await this.validateBuyWillBeSellable(baseTok, requiredCapitalNormal, null);
                                        if (!sellableStep.ok) {
                                            tx.currentStep = targetStep;
                                            await this.saveState();
                                            continue;
                                        }

                                        const buyMarketForStep = tx.buyMarket || 'USDT';
                                        const buySymbolForStep = buyMarketForStep === 'USDT' ? this.toUsdtSymbol(baseTok) : this.toTmnSymbol(baseTok);
                                        const rate = this.state.lastUsdTmnRate || 0;
                                        let quoteAmountForStep = requiredCapitalNormal;
                                        if (buyMarketForStep === 'TMN' && rate > 0) quoteAmountForStep = requiredCapitalNormal * rate;

                                        const buy = await this.placeMarketBuy(buySymbolForStep, quoteAmountForStep);
                                        const dual = this.computeDualPrices(buy.executedPrice, buyMarketForStep, rate);
                                        const actualCapitalUsedUsdt = (buy.grossValue != null)
                                            ? (buyMarketForStep === 'TMN' ? (rate > 0 ? buy.grossValue / rate : requiredCapitalNormal) : buy.grossValue)
                                            : requiredCapitalNormal;

                                        tx.buys.push({
                                            step: targetStep, price: dual.priceUsdtEq, priceUsdtEq: dual.priceUsdtEq,
                                            priceTmnEq: dual.priceTmnEq, rawPrice: dual.rawPrice, rateAtBuy: rate,
                                            quantity: buy.quantity, capitalUsed: actualCapitalUsedUsdt, sold: false,
                                            buyTimestamp: new Date().toISOString(), isCumulative: false, market: buyMarketForStep
                                        });
                                        existingSteps.add(targetStep);
                                        if (!tx.buyMarketHistory) tx.buyMarketHistory = [];
                                        if (!tx.buyMarketHistory.includes(buyMarketForStep)) tx.buyMarketHistory.push(buyMarketForStep);
                                        tx.currentStep = targetStep;
                                        tx.totalQuantity += buy.quantity;
                                        tx.lastBuyPrice = dual.priceUsdtEq;
                                        tx.capitalUsed += actualCapitalUsedUsdt;
                                        if (actualCapitalUsedUsdt > this.maxSingleTransactionCapital) this.maxSingleTransactionCapital = actualCapitalUsedUsdt;

                                        if (!this.buyHistory[tx.symbol]) this.buyHistory[tx.symbol] = [];
                                        if (!this.buyHistory[tx.symbol].includes(targetStep)) {
                                            this.buyHistory[tx.symbol].push(targetStep);
                                            this.buyHistory[tx.symbol].sort((a, b) => a - b);
                                        }
                                        await this.saveState();
                                        this.logImportant(`${tx.symbol}: Step ${targetStep} bought`);
                                    } else {
                                        tx.waitingForCapital = true;
                                        tx.pendingSince = Date.now();
                                        tx.pendingStep = targetStep;
                                        await this.saveState();
                                    }
                                }
                            }
                        } else if (targetStep === -1 && tx.waitingForCapital && !tx.pendingJump) {
                            tx.waitingForCapital = false;
                            tx.pendingStep = null;
                            tx.pendingBuyPrice = null;
                            await this.saveState();
                        }
                    } finally {
                        this.releaseSymbolLock(lockKey);
                    }
                }
            }

            // Group sells
            let hasSoldSomething = false;
            for (let i = this.state.activeTransactions.length - 1; i >= 0; i--) {
                const tx = this.state.activeTransactions[i];
                if (await this.isOnCooldown(tx.symbol)) continue;
                if (!tx || !tx.symbol) continue;
                const base = this.getBaseToken(tx.symbol);
                const lockKey = `sell_${base}`;
                if (!this.acquireSymbolLock(lockKey)) continue;
                try {
                    const unsoldBuys = tx.buys.filter(b => b.sold === false);
                    if (unsoldBuys.length === 0) continue;
                    const groupInfo = this.calculateGroupSellTarget(tx);
                    if (!groupInfo) continue;
                    if (!tx.buyMarket) tx.buyMarket = 'USDT';

                    if (this.state.settings.executionMode === 'REAL') {
                        await this.cancelOpenOrders(this.toUsdtSymbol(base));
                        await this.cancelOpenOrders(this.toTmnSymbol(base));
                    }

                    const rate = this.state.lastUsdTmnRate || 0;
                    const usdtSym = this.toUsdtSymbol(base);
                    const tmnSym = this.toTmnSymbol(base);
                    let usdtPrice = 0, tmnPrice = 0;
                    try { usdtPrice = await this.getCurrentPrice(usdtSym); } catch {}
                    try { tmnPrice = await this.getCurrentPrice(tmnSym); } catch {}

                    const grossProfitUsdt = groupInfo.avgPriceUsdt > 0 ? ((usdtPrice - groupInfo.avgPriceUsdt) / groupInfo.avgPriceUsdt) * 100 : 0;
                    const expectedNetUsdt = groupInfo.expectedNetAtUsdt(usdtPrice);
                    const expectedNetPctUsdt = groupInfo.totalCapitalUsed > 0 ? (expectedNetUsdt / groupInfo.totalCapitalUsed) * 100 : 0;
                    // Require NET profit % (after all fees) >= target sellPct, not just gross
                    const baseCanSellUsdt = (usdtPrice > 0 && usdtPrice >= groupInfo.targetSellPriceUsdt && expectedNetUsdt > MIN_GROUP_NET_USDT && expectedNetPctUsdt >= groupInfo.sellPctUsdt);

                    const grossProfitTmn = groupInfo.avgPriceTmn > 0 ? ((tmnPrice - groupInfo.avgPriceTmn) / groupInfo.avgPriceTmn) * 100 : 0;
                    const expectedNetTmn = groupInfo.expectedNetAtTmn(tmnPrice);
                    const expectedNetPctTmn = groupInfo.totalCapitalUsed > 0 ? (expectedNetTmn / groupInfo.totalCapitalUsed) * 100 : 0;
                    const baseCanSellTmn = (tmnPrice > 0 && tmnPrice >= groupInfo.targetSellPriceTmn && expectedNetTmn > MIN_GROUP_NET_USDT && expectedNetPctTmn >= groupInfo.sellPctTmn && Date.now() >= this.tmnSellLockedUntil);

                    let bestPath = null;
                    try { bestPath = await this.evaluateBestSellPath(tx, groupInfo.totalQuantity, groupInfo.totalCapitalUsed, groupInfo.avgPriceUsdt); } catch (e) {}
                    const arbReady = !!((!baseCanSellUsdt && !baseCanSellTmn && bestPath && bestPath.viable === true && bestPath.netProfit > MIN_GROUP_NET_USDT));

                    const canSell = baseCanSellUsdt || baseCanSellTmn || arbReady;
                    if (!canSell) continue;
                    if (tx.waitingForCapital) await this.cancelPendingOrder(tx);

                    let sellSymbol, sellDirection, sellMarket;
                    if (baseCanSellUsdt && baseCanSellTmn) sellMarket = expectedNetUsdt >= expectedNetTmn ? 'USDT' : 'TMN';
                    else if (baseCanSellUsdt) sellMarket = 'USDT';
                    else if (baseCanSellTmn) sellMarket = 'TMN';
                    else if (arbReady) sellMarket = bestPath.market;
                    else continue;

                    if (sellMarket === 'USDT') { sellSymbol = usdtSym; sellDirection = `${tx.buyMarket}→USDT`; }
                    else { sellSymbol = tmnSym; sellDirection = `${tx.buyMarket}→TMN`; }

                    const baseTok = this.getBaseToken(tx.symbol);
                    const dustQty = this.getDustQty(baseTok);
                    let qtyFromTx = groupInfo.totalQuantity;
                    let qtyToSell = qtyFromTx + dustQty;

                    if (this.state.settings.executionMode !== 'TEST') {
                        try {
                            const realBal = await this.getTokenBalance(sellSymbol);
                            if (realBal > 0 && realBal < qtyToSell) qtyToSell = realBal * 0.9999;
                        } catch (e) {}
                    }

                    const sell = await this.placeMarketSell(sellSymbol, qtyToSell, sellMarket === 'USDT' ? groupInfo.avgPriceUsdt : groupInfo.avgPriceTmn, groupInfo.totalCapitalUsed);

                    let actualSold = sell.rawExecutedQty || sell.quantity || qtyToSell;

                    const coveredFromTx = Math.min(actualSold, qtyFromTx);
                    const leftoverFromTx = Math.max(0, qtyFromTx - coveredFromTx);
                    const dustConsumed = Math.min(dustQty, Math.max(0, actualSold - coveredFromTx));
                    this.setDustQty(baseTok, leftoverFromTx + Math.max(0, dustQty - dustConsumed), sellSymbol);

                    const soldFraction = qtyFromTx > 0 ? (coveredFromTx / qtyFromTx) : 1;
                    const capitalForThisSell = groupInfo.totalCapitalUsed * soldFraction;

                    // Convert received amount to USDT-equivalent (include conversion fee for TMN)
                    let receivedUsdt = sell.received;
                    if (sell.market === 'TMN' && rate > 0) {
                        // sell.received is already after TMN sell fee; also apply TMN→USDT conversion fee
                        receivedUsdt = (sell.received / rate) * (1 - CONVERSION_FEES.TMN_TO_USDT);
                    }

                    const receivedForTx = qtyToSell > 0 ? (receivedUsdt * (coveredFromTx / qtyToSell)) : receivedUsdt;
                    const finalNetProfit = receivedForTx - capitalForThisSell;
                    const profitPercent = capitalForThisSell > 0 ? (finalNetProfit / capitalForThisSell) * 100 : 0;
                    let sellPriceUsdtEq = sell.executedPrice;
                    if (sell.market === 'TMN' && rate > 0) sellPriceUsdtEq = sell.executedPrice / rate;

                    if (finalNetProfit > 0) {
                        await this.reportProfitableTrade({
                            symbol: tx.symbol, buyPrice: groupInfo.avgPriceUsdt, sellPrice: sellPriceUsdtEq,
                            quantity: coveredFromTx, netProfit: finalNetProfit, market: sellMarket,
                            orderType: sell.orderTypeUsed || 'UNKNOWN'
                        });
                    } else if (finalNetProfit < 0 && sell.market === 'TMN') {
                        this.tmnSellLockedUntil = Date.now() + ARB_CONFIG.tmnLockMsAfterLoss;
                    }

                    const sellRecord = {
                        symbol: tx.symbol, sellSymbol, direction: sellDirection, type: 'GROUP_SELL',
                        steps: unsoldBuys.map(b => b.step),
                        totalQuantity: coveredFromTx, actualSoldQuantity: actualSold,
                        dustIncluded: dustQty,
                        avgBuyPriceUsdt: groupInfo.avgPriceUsdt, avgBuyPriceTmn: groupInfo.avgPriceTmn,
                        sellPrice: sell.executedPrice, sellPriceUsdtEq,
                        rateAtSell: rate > 0 ? rate : null,
                        buyMarket: tx.buyMarket || 'USDT',
                        totalCapitalUsed: capitalForThisSell, totalNetProfit: finalNetProfit,
                        profitPercent, lastStep: groupInfo.lastStep,
                        market: sell.market || 'USDT',
                        timestamp: new Date().toISOString()
                    };
                    this.state.sellHistory.push(sellRecord);
                    this.updateDailyPnLFromSell(finalNetProfit);
                    await this.addToCooldown(tx.symbol, 300);

                    const almostFullySold = (coveredFromTx >= qtyFromTx * 0.99) || (leftoverFromTx <= DUST_EPSILON);

                    if (almostFullySold) {
                        for (const buy of unsoldBuys) {
                            buy.sold = true;
                            buy.sellPrice = sell.executedPrice;
                            buy.sellTimestamp = new Date().toISOString();
                        }
                        tx.capitalUsed = Math.max(0, (tx.capitalUsed || 0) - groupInfo.totalCapitalUsed);
                        tx.totalQuantity = Math.max(0, (tx.totalQuantity || 0) - qtyFromTx);

                        if (this.buyHistory[tx.symbol]) {
                            for (const buy of unsoldBuys) {
                                const idx = this.buyHistory[tx.symbol].indexOf(buy.step);
                                if (idx !== -1) this.buyHistory[tx.symbol].splice(idx, 1);
                            }
                            if (this.buyHistory[tx.symbol].length === 0) delete this.buyHistory[tx.symbol];
                        }
                    } else {
                        for (const buy of unsoldBuys) {
                            const soldPart = buy.quantity * soldFraction;
                            buy.quantity = Math.max(0, buy.quantity - soldPart);
                            if (buy.capitalUsed) buy.capitalUsed = Math.max(0, buy.capitalUsed * (1 - soldFraction));
                        }
                        tx.totalQuantity = Math.max(0, (tx.totalQuantity || 0) - coveredFromTx);
                        tx.capitalUsed = Math.max(0, (tx.capitalUsed || 0) - capitalForThisSell);
                    }

                    await this.saveState();
                    hasSoldSomething = true;
                    if (tx.buys.every(b => b.sold === true) && tx.buys.length > 0) {
                        this.state.activeTransactions.splice(i, 1);
                        await this.saveState();
                    }
                } catch (err) {
                    await this.addLog('ERROR', `Group sell error ${tx.symbol}: ${err.message}`);
                } finally {
                    this.releaseSymbolLock(lockKey);
                }
            }

            if (hasSoldSomething) await this.fillEmptySlots('after_sell');
            if (!this.state.settings.completeOnlyMode && !this.lockedByDeposit) await this.fillEmptySlots('regular_check');

            await this.saveState();
            await this.createAutoBackup();
        } catch (err) {
            await this.addLog('ERROR', `Monitor error: ${err.message}`);
        }
    }
    // ============================================================
    // START / STOP / STATUS
    // ============================================================
            async start() {
        console.log(`\n[BOT ${this.userId}] ═══════════════════════════`);
        console.log(`[BOT ${this.userId}] START CALLED`);
        console.log(`[BOT ${this.userId}] Current running: ${this.running}`);
        console.log(`[BOT ${this.userId}] Execution mode: ${this.state.settings.executionMode}`);
        console.log(`[BOT ${this.userId}] Test balance: ${this.state.testBalance}`);
        console.log(`[BOT ${this.userId}] ═══════════════════════════`);

        if (this.running) {
            logger.warn(`[User ${this.userId}] Bot already running`);
            return false;
        }

        // ⭐ Deposit lock check — ONLY in REAL mode
        const currentMode = process.env.MODE || 'TEST';
        const isTestMode = currentMode === 'TEST';

        if (!isTestMode && isBotLocked(this.userId)) {
            logger.warn(`[User ${this.userId}] Cannot start bot — deposit locked (REAL mode)`);
            this.lockedByDeposit = true;
            return false;
        }

        if (isTestMode) {
            console.log(`[BOT ${this.userId}] TEST mode — deposit check skipped`);
            this.lockedByDeposit = false;  // ⭐ IMPORTANT: reset

            // Ensure virtual deposit exists so share accounting & panel work correctly
            try {
                const user = getUserById(this.userId);
                if (user && (user.deposit_balance == null || user.deposit_balance <= 0)) {
                    const { updateUser } = require('../database');
                    updateUser(this.userId, {
                        deposit_balance: 10.0,
                        deposit_total_paid: Math.max(user.deposit_total_paid || 0, 10.0),
                        deposit_paid: 1,
                        bot_locked: 0,
                        lock_reason: null,
                        locked_at: null
                    });
                    console.log(`[BOT ${this.userId}] TEST virtual deposit initialized: 10 USDT`);
                }
            } catch (e) {
                console.log(`[BOT ${this.userId}] Could not init virtual deposit: ${e.message}`);
            }
        }

        logger.info(`[User ${this.userId}] Starting bot...`);
        this.running = true;

        if (this.state.settings.executionMode === 'TEST') {
            if (this.state.testBalance == null || this.state.testBalance === 0) {
                this.state.testBalance = DEFAULT_TEST_BALANCE;
                console.log(`[BOT ${this.userId}] TEST balance initialized: ${DEFAULT_TEST_BALANCE} USDT`);
            }
        }

        console.log(`[BOT ${this.userId}] Validating API key...`);
        try {
            await this.apiCall('/v1/account/balances');
            console.log(`[BOT ${this.userId}] API key VALIDATED`);
            logger.success(`[User ${this.userId}] API key validated`);
        } catch (e) {
            console.log(`[BOT ${this.userId}] API key INVALID: ${e.message}`);
            logger.error(`[User ${this.userId}] Invalid API key`, { error: e.message });
            this.running = false;
            return false;
        }

        await this.loadState();
        await this.initializeStepSettings();
        if (this.state.settings.adaptiveMode) await this.updateBotSettingsForRegime();

        try {
            await this.fillEmptySlots('startup');
        } catch (e) {
            logger.error(`[User ${this.userId}] fillEmptySlots failed`, { error: e.message });
        }

        this._scheduleMonitor();
        this._startRetryLoop();
        this._startPeriodicSave();

        console.log(`[BOT ${this.userId}] BOT FULLY STARTED`);
        console.log(`[BOT ${this.userId}] ═══════════════════════════\n`);
        logger.success(`[User ${this.userId}] Bot started successfully`);
        return true;
    }

    async stop() {
        logger.info(`[User ${this.userId}] Stopping bot...`);
        this.running = false;
        await this.saveState();
        logger.success(`[User ${this.userId}] Bot stopped`);
        return true;
    }

    _scheduleMonitor() {
        const MONITOR_ACTIVE_MS = 5000;
        const MONITOR_IDLE_MS = 15000;
        let monitorBusy = false;
        const run = async () => {
            if (!this.running) return;
            if (!monitorBusy) {
                monitorBusy = true;
                try { await this.monitor(); } catch (e) {}
                finally { monitorBusy = false; }
            }
            const delay = (this.state.activeTransactions && this.state.activeTransactions.length > 0) ? MONITOR_ACTIVE_MS : MONITOR_IDLE_MS;
            if (this.running) setTimeout(run, delay);
        };
        run();
    }

    _startRetryLoop() {
        let busy = false;
        const loop = async () => {
            if (!this.running) return;
            if (!busy) {
                busy = true;
                try {
                    const maxConcurrent = this.state.settings.maxConcurrent || 10;
                    if (this.state.activeTransactions.length < maxConcurrent && !this.lockedByDeposit) {
                        const balance = await this.getDetailedBalance();
                        const minAmount = this.state.settings.stepAmounts?.[0] || 1.2;
                        if (balance.available >= minAmount) {
                            await this.fillEmptySlots('retry_loop');
                        }
                    }
                } catch (e) {}
                finally { busy = false; }
            }
            if (this.running) setTimeout(loop, 5 * 60 * 1000);
        };
        setTimeout(loop, 5 * 60 * 1000);
    }

    _startPeriodicSave() {
        let busy = false;
        const loop = async () => {
            if (!this.running) return;
            if (!busy) {
                busy = true;
                try { await this.saveState(); await this.forceBackup(); } catch (e) {}
                finally { busy = false; }
            }
            if (this.running) setTimeout(loop, 2500);
        };
        setTimeout(loop, 2500);
    }

    // ============================================================
    // STATUS SNAPSHOT
    // ============================================================
    async getStatusSnapshot() {
        const balance = await this.getDetailedBalance();
        const summary = this.calculateProfitSummary();

        const rows = [];
        let totalUnrealizedPnL = 0;

        for (const tx of this.state.activeTransactions) {
            try {
                const unsoldBuys = (tx.buys || []).filter(b => !b.sold);
                const rate = this.state.lastUsdTmnRate || 0;
                const dual = this.computeDualAverages(unsoldBuys, rate);

                const lastUnsoldBuy = unsoldBuys[unsoldBuys.length - 1];
                const lastBuyPrice = lastUnsoldBuy ? (lastUnsoldBuy.priceUsdtEq || lastUnsoldBuy.price) : (tx.firstBuyPrice || 0);
                const highestBoughtStep = (tx.buys || []).filter(b => !b.sold).reduce((m, b) => Math.max(m, b.step || 0), 0);
                const currentStep = highestBoughtStep || (lastUnsoldBuy ? lastUnsoldBuy.step : tx.currentStep) || 1;
                const dropPct = this.getDropFromLastBuy(tx);

                const dynamicSell = this.calculateDynamicSellPercent(tx, currentStep, 'USDT');
                const sellPctUsdt = dynamicSell.sellPercent;
                const targetUsdt = dual.avgUsdt * (1 + sellPctUsdt / 100);

                const curPrice = tx.currentPrice || 0;
                const sellFee = FEES.USDT.sell;
                let uPnl = 0, uPnlPct = 0;
                if (dual.totalQty > 0 && curPrice > 0 && dual.totalCapitalUsed > 0) {
                    const netIfSold = dual.totalQty * curPrice * (1 - sellFee);
                    uPnl = netIfSold - dual.totalCapitalUsed;
                    uPnlPct = (uPnl / dual.totalCapitalUsed) * 100;
                    totalUnrealizedPnL += uPnl;
                }

                const txRegime = tx.marketRegime || 'SIDEWAYS';
                let modeText = txRegime === 'BEAR' ? 'BEAR' : (txRegime === 'BULL' ? 'BULL' : 'SIDE');
                if (tx.regimeSwitched) modeText = 'CRIS';
                if (lastUnsoldBuy) {
                    if (lastUnsoldBuy.isCumulative) modeText = 'CUM';
                    else if (lastUnsoldBuy.jumpMode === 'SINGLE' && (lastUnsoldBuy.step || 0) > 1) modeText = 'JMP';
                }

                rows.push({
                    symbol: tx.symbol, step: currentStep, mode: modeText,
                    buyMarket: tx.buyMarket || 'USDT',
                    lastBuyPrice: lastBuyPrice, currentPrice: curPrice, dropPct: dropPct,
                    avgUsdt: dual.avgUsdt, sellPct: sellPctUsdt, targetUsdt: targetUsdt,
                    totalQty: dual.totalQty, capitalUsed: dual.totalCapitalUsed,
                    uPnl: uPnl, uPnlPct: uPnlPct
                });
            } catch (e) {}
        }

        return {
            mode: this.state.settings.executionMode || 'TEST',
            marketRegime: this.state.marketRegime || 'SIDEWAYS',
            crisisCount: this.crisisCount,
            cooldownSeconds: this.COOLDOWN_SECONDS,
            maxConcurrent: this.state.settings.maxConcurrent || 4,
            maxSteps: this.state.settings.maxSteps || 25,
            jumpBuyMode: this.state.settings.jumpBuyMode || 'SINGLE',
            maxTradeCapital: this.state.settings.maxTradeCapital || 10,
            sellHistoryCount: this.state.sellHistory.length,
            maxConcurrentCapital: summary.maxConcurrentCapital,
            maxSingleTransactionCapital: summary.maxSingleTransactionCapital,
            todayPnL: this.dailyRealizedPnL || 0,
            dailyLossLimitUsdt: DAILY_RISK.maxDailyLossUsdt,
            dailyLossLimitPercent: DAILY_RISK.maxDailyLossPercent,
            totalUnrealizedPnL: totalUnrealizedPnL,
            lockedByDeposit: (process.env.MODE === 'REAL') ? this.lockedByDeposit : false,
            balance: {
                usdt: balance.usdt, tmn: balance.tmn, rate: balance.rate,
                tmnInUsdt: balance.tmnInUsdt, totalEquity: balance.totalEquity,
                blockedTotal: balance.blockedTotal, blockedUSDT: balance.blockedUSDT,
                blockedTMN: balance.blockedTMN, blockedTMNInUsdt: balance.blockedTMNInUsdt,
                available: balance.available, isOverleveraged: balance.isOverleveraged
            },
            activeTransactions: rows,
            dustBalances: this.getAllDustSummary(),
            clusterStatus: this.getClusterStatus()
        };
    }

    getStatus() {
        return {
            userId: this.userId,
            running: this.running,
            activeTransactions: this.state.activeTransactions.length,
            totalSells: this.state.sellHistory.length,
            marketRegime: this.state.marketRegime,
            crisisCount: this.crisisCount,
            lastUsdTmnRate: this.state.lastUsdTmnRate,
            testBalance: this.state.testBalance,
            lockedByDeposit: this.lockedByDeposit
        };
    }
}

// ============================================================
// BOT MANAGER
// ============================================================
class BotManager {
    constructor() {
        this.bots = new Map();
    }

    async startBot(userId, apiKey, apiSecret, options = {}) {
        if (this.bots.has(userId)) {
            const existing = this.bots.get(userId);
            if (existing.running) return existing;
            this.bots.delete(userId);
        }

        const bot = new SmartChefBot(userId, apiKey, apiSecret, options);
        const started = await bot.start();
        if (!started) return null;

        this.bots.set(userId, bot);
        logger.success(`Bot started for user ${userId}`);
        return bot;
    }

    async stopBot(userId) {
        const bot = this.bots.get(userId);
        if (!bot) return false;
        await bot.stop();
        this.bots.delete(userId);
        return true;
    }

    getBot(userId) { return this.bots.get(userId); }
    getAllBots() { return Array.from(this.bots.values()); }
    getRunningCount() { return this.bots.size; }
}

const botManager = new BotManager();

module.exports = {
    SmartChefBot,
    botManager,
    FEES,
    CONVERSION_FEES,
    MIN_ORDER,
    TRADE_SAFETY
};