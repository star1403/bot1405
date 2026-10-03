// server.js - SmartChef Central Server
// Version 5.0.0 - Final with Full Logging + Deposit System + TEST Mode

require('./utils/env');

const http = require('http');
const logger = require('./utils/logger');
const database = require('./database');
const { Router, parseBody, sendJson, getClientIp, rateLimit } = require('./http-helper');
const { botManager, FEES } = require('./engines/bot-engine');
const {
    decryptApiKey, encryptApiKey, hashPassword, verifyPassword, generateToken, verifyToken
} = require('./utils/crypto');

const PORT = parseInt(process.env.PORT || '3000');
const DEPOSIT_AMOUNT = parseFloat(process.env.DEPOSIT_AMOUNT || '2.0');
const MIN_DEPOSIT_USDT = parseFloat(process.env.MIN_DEPOSIT_USDT || '2.0');
const REFERRAL_CODE = process.env.REFERRAL_CODE || '821dm2zz';
const REFERRAL_LINK = process.env.REFERRAL_LINK || 'https://wallex.ir/signup?ref=821dm2zz';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const router = new Router();

// ============================================================
// Health
// ============================================================
router.get('/health', async (req, res) => {
    const stats = database.getGlobalStats();
    sendJson(res, 200, {
        ok: true, status: 'healthy',
        timestamp: new Date().toISOString(), version: '5.0.0',
        stats: {
            totalTrades: stats.count,
            totalProfit: Number(stats.total.toFixed(6)),
            totalCreatorShare: Number(stats.our_total.toFixed(6)),
            runningBots: botManager.getRunningCount()
        }
    });
});

router.get('/', async (req, res) => {
    sendJson(res, 200, {
        name: 'SmartChef Server',
        version: '5.0.0',
        status: 'running',
        mode: process.env.MODE || 'TEST',
        referral: {
            code: REFERRAL_CODE,
            link: REFERRAL_LINK
        }
    });
});

// Public endpoint for referral info
router.get('/api/public/referral', async (req, res) => {
    sendJson(res, 200, {
        ok: true,
        code: REFERRAL_CODE,
        link: REFERRAL_LINK,
        discountPercent: 20,
        minDeposit: MIN_DEPOSIT_USDT
    });
});

// ============================================================
// Auth helper
// ============================================================
function authenticate(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) return null;
    const decoded = verifyToken(auth.substring(7));
    if (!decoded) return null;
    const user = database.getUserById(decoded.userId);
    if (!user || user.status === 'banned') return null;
    return user;
}

// ============================================================
// AUTH ROUTES
// ============================================================
router.post('/api/auth/register', async (req, res, body) => {
    if (!body || !body.email || !body.password) {
        return sendJson(res, 400, { error: 'Email and password required' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
        return sendJson(res, 400, { error: 'Invalid email' });
    }
    if (body.password.length < 8) {
        return sendJson(res, 400, { error: 'Password must be at least 8 characters' });
    }
    const ip = getClientIp(req);
    if (!rateLimit(`register:${ip}`, 5, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts' });
    }
    if (database.getUserByEmail(body.email)) {
        return sendJson(res, 409, { error: 'Email already registered' });
    }
    const userId = database.createUser(
        body.email,
        hashPassword(body.password),
        ip,
        req.headers['user-agent'] || 'unknown'
    );
    const token = generateToken(userId, body.email);
    logger.success(`New user registered: ${body.email}`, { userId });
    sendJson(res, 201, {
        ok: true, userId, token,
        message: 'Registration successful.',
        nextStep: 'referral_confirmation'
    });
});

router.post('/api/auth/login', async (req, res, body) => {
    if (!body || !body.email || !body.password) {
        return sendJson(res, 400, { error: 'Email and password required' });
    }
    const ip = getClientIp(req);
    if (!rateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
        return sendJson(res, 429, { error: 'Too many attempts' });
    }
    const user = database.getUserByEmail(body.email);
    if (!user || !verifyPassword(body.password, user.password_hash)) {
        return sendJson(res, 401, { error: 'Invalid credentials' });
    }
    const token = generateToken(user.id, user.email);
    logger.success(`User logged in: ${user.email}`);
    sendJson(res, 200, {
        ok: true, userId: user.id, token,
        status: user.status,
        depositPaid: user.deposit_paid === 1,
        botRunning: user.bot_running === 1,
        apiKeySet: !!user.api_key_encrypted,
        botLocked: user.bot_locked === 1,
        referralConfirmed: user.referral_confirmed_by_user === 1,
        referralVerified: user.referral_verified_by_admin === 1
    });
});

// ============================================================
// SET API KEYS (with detailed logging)
// ============================================================
router.post('/api/auth/set-api-keys', async (req, res, body) => {
    console.log('\n═══════════════════════════════════════════');
    console.log('SET API KEYS REQUEST');
    console.log('═══════════════════════════════════════════');

    const user = authenticate(req);
    if (!user) {
        console.log('❌ Auth failed — no valid token');
        return sendJson(res, 401, { error: 'Unauthorized' });
    }
    console.log(`User: ${user.email} (id=${user.id})`);

    if (!body || !body.apiKey) {
        console.log('❌ apiKey missing in body');
        console.log(`   Body keys: ${body ? Object.keys(body).join(', ') : 'null'}`);
        return sendJson(res, 400, { error: 'apiKey required' });
    }
    console.log(`API key received (length hidden for security)`);

    const apiKeyEnc = encryptApiKey(body.apiKey);
    if (!apiKeyEnc) {
        console.log('❌ Encryption failed');
        return sendJson(res, 500, { error: 'Encryption failed' });
    }
    console.log(`Encrypted key length: ${apiKeyEnc.length}`);

    database.updateUserApiKeys(user.id, apiKeyEnc, null);
    console.log(`✅ API key saved to DB for user ${user.id}`);

    // Verify save worked
    const savedUser = database.getUserById(user.id);
    const verified = !!savedUser.api_key_encrypted;
    console.log(`Verify - api_key_encrypted in DB: ${verified}`);
    console.log(`Verify - length: ${savedUser.api_key_encrypted ? savedUser.api_key_encrypted.length : 0}`);
    console.log('═══════════════════════════════════════════\n');

    logger.success(`API key set for user ${user.id}`);
    sendJson(res, 200, { ok: true, message: 'API key saved.' });
});

// ============================================================
// REFERRAL ROUTES
// ============================================================
router.post('/api/user/referral/confirm', async (req, res, body) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

    // If user skipped
    if (body && (body.skipped === true || body.code === null)) {
        database.updateUser(user.id, {
            referral_confirmed_by_user: 0,
            referral_code_used: null
        });
        logger.info(`User ${user.id} skipped referral code`);
        return sendJson(res, 200, {
            ok: true,
            skipped: true,
            message: 'Referral skipped.'
        });
    }

    // If user confirmed
    if (body && body.code) {
        database.setReferralConfirmedByUser(user.id, body.code);
        logger.success(`User ${user.id} confirmed referral: ${body.code}`);
        return sendJson(res, 200, {
            ok: true,
            message: 'Referral confirmed.'
        });
    }

    sendJson(res, 200, { ok: true, message: 'Referral step completed.' });
});

router.get('/api/user/referral/info', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const info = database.getReferralInfo(user.id);
    sendJson(res, 200, { ok: true, referral: info });
});

// ============================================================
// DEPOSIT ROUTES
// ============================================================
router.get('/api/user/deposit/status', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

    const info = database.getDepositInfo(user.id);
    sendJson(res, 200, {
        ok: true,
        deposit: info,
        walletAddress: process.env.CREATOR_USDT_WALLET,
        network: 'TRC20',
        minimumDeposit: MIN_DEPOSIT_USDT
    });
});

router.get('/api/user/deposit/history', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const history = database.getDepositHistory(user.id, 50);
    sendJson(res, 200, { ok: true, history });
});

router.get('/api/user/deposit/info', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (user.deposit_paid === 1) {
        return sendJson(res, 200, {
            ok: true,
            alreadyPaid: true,
            deposit: database.getDepositInfo(user.id),
            walletAddress: process.env.CREATOR_USDT_WALLET,
            network: 'TRC20'
        });
    }
    sendJson(res, 200, {
        ok: true,
        alreadyPaid: false,
        amount: MIN_DEPOSIT_USDT,
        currency: 'USDT',
        network: 'TRC20',
        walletAddress: process.env.CREATOR_USDT_WALLET,
        warning: 'Send ONLY USDT on TRC20 network. Wrong network = permanent loss.'
    });
});

router.post('/api/user/deposit/verify', async (req, res, body) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (!body || !body.txHash) return sendJson(res, 400, { error: 'txHash required' });

    const wallet = require('./engines/wallet');
    const result = await wallet.verifyDeposit(body.txHash, MIN_DEPOSIT_USDT);

    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });
    if (!result.confirmed) {
        return sendJson(res, 202, {
            ok: false, pending: true,
            message: 'Not yet confirmed. Try again in a few minutes.',
            confirmations: result.confirmations || 0
        });
    }

    const depositResult = database.addDeposit(
        user.id,
        result.amount || MIN_DEPOSIT_USDT,
        body.txHash,
        user.deposit_paid === 1 ? 'recharge' : 'initial'
    );

    if (!depositResult.ok) {
        if (depositResult.reason === 'tx_already_used') {
            return sendJson(res, 409, { ok: false, error: 'This transaction was already used' });
        }
        return sendJson(res, 400, { ok: false, error: depositResult.reason || 'Deposit failed' });
    }

    if (user.deposit_paid !== 1) {
        database.markDepositPaid(user.id, result.amount || MIN_DEPOSIT_USDT, body.txHash);
    }

    logger.success(`Deposit confirmed for user ${user.id}: +${result.amount} USDT`);

    sendJson(res, 200, {
        ok: true,
        message: 'Deposit confirmed.',
        deposit: result,
        newBalance: depositResult.newBalance,
        botUnlocked: depositResult.botUnlocked
    });
});

// Legacy endpoints
router.get('/api/payment/deposit-info', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (user.deposit_paid === 1) return sendJson(res, 200, { ok: true, alreadyPaid: true });
    sendJson(res, 200, {
        ok: true, alreadyPaid: false,
        deposit: {
            amount: MIN_DEPOSIT_USDT, currency: 'USDT', network: 'TRC20',
            walletAddress: process.env.CREATOR_USDT_WALLET,
            warning: 'Send ONLY USDT on TRC20 network. Wrong network = permanent loss.'
        }
    });
});

router.post('/api/payment/verify', async (req, res, body) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (!body || !body.txHash) return sendJson(res, 400, { error: 'txHash required' });

    const wallet = require('./engines/wallet');
    const result = await wallet.verifyDeposit(body.txHash, MIN_DEPOSIT_USDT);

    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error });
    if (!result.confirmed) {
        return sendJson(res, 202, {
            ok: false, pending: true,
            message: 'Not yet confirmed. Try again in a few minutes.',
            confirmations: result.confirmations || 0
        });
    }

    const depositResult = database.addDeposit(user.id, result.amount || MIN_DEPOSIT_USDT, body.txHash, 'manual');
    if (!depositResult.ok) {
        if (depositResult.reason === 'tx_already_used') {
            return sendJson(res, 409, { ok: false, error: 'This transaction was already used' });
        }
        return sendJson(res, 400, { ok: false, error: depositResult.reason || 'Deposit failed' });
    }
    if (user.deposit_paid !== 1) {
        database.markDepositPaid(user.id, result.amount || MIN_DEPOSIT_USDT, body.txHash);
    }
    logger.success(`Deposit confirmed (legacy) for user ${user.id}`);
    sendJson(res, 200, { ok: true, message: 'Deposit confirmed.', deposit: result, newBalance: depositResult.newBalance });
});

// ============================================================
// USER STATUS
// ============================================================
router.get('/api/user/status', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

    const stats = database.getUserStats(user.id);
    const pending = user.pending_share || 0;
    const threshold = parseFloat(process.env.MIN_TRANSFER_USDT || '1.2');
    const depositInfo = database.getDepositInfo(user.id);
    const referralInfo = database.getReferralInfo(user.id);
    const bot = botManager.getBot(user.id);

    let responseData = {
        ok: true,
        user: {
            id: user.id,
            email: user.email,
            status: user.status,
            depositPaid: user.deposit_paid === 1,
            depositAmount: user.deposit_amount,
            botRunning: user.bot_running === 1,
            botLocked: (process.env.MODE === 'REAL') ? (user.bot_locked === 1) : false,
            apiKeySet: !!user.api_key_encrypted
        },
        botActuallyRunning: bot ? bot.running : false,
        apiKeySet: !!user.api_key_encrypted,
        mode: process.env.MODE || 'TEST',
        marketRegime: 'SIDEWAYS',
        crisisCount: 0,
        cooldownSeconds: 300,
        maxConcurrent: 4,
        maxSteps: 25,
        jumpBuyMode: 'SINGLE',
        maxTradeCapital: 10,
        sellHistoryCount: 0,
        maxConcurrentCapital: '0.00',
        maxSingleTransactionCapital: '0.00',
        todayPnL: 0,
        dailyLossLimitUsdt: 4,
        dailyLossLimitPercent: 4,
        totalUnrealizedPnL: 0,
        lockedByDeposit: false,
        stats: {
            totalTrades: stats.count,
            totalProfit: Number(stats.total.toFixed(6)),
            totalCreatorShare: Number(stats.our_total.toFixed(6)),
            userKeeps: Number((stats.total - stats.our_total).toFixed(6))
        },
        balance: {
            usdt: 0, tmn: 0, rate: 0, tmnInUsdt: 0, totalEquity: 0,
            blockedTotal: 0, blockedUSDT: 0, blockedTMN: 0, blockedTMNInUsdt: 0,
            available: 0, isOverleveraged: false
        },
        deposit: depositInfo,
        referral: referralInfo,
        activeTransactions: [],
        dustBalances: {},
        clusterStatus: {},
        pendingShare: {
            current: Number(pending.toFixed(6)),
            threshold,
            remaining: Math.max(0, threshold - pending),
            thresholdReached: pending >= threshold
        }
    };

    if (bot) {
        try {
            const snapshot = await bot.getStatusSnapshot();
            responseData.mode = snapshot.mode;
            responseData.marketRegime = snapshot.marketRegime;
            responseData.crisisCount = snapshot.crisisCount;
            responseData.cooldownSeconds = snapshot.cooldownSeconds;
            responseData.maxConcurrent = snapshot.maxConcurrent;
            responseData.maxSteps = snapshot.maxSteps;
            responseData.jumpBuyMode = snapshot.jumpBuyMode;
            responseData.maxTradeCapital = snapshot.maxTradeCapital;
            responseData.sellHistoryCount = snapshot.sellHistoryCount;
            responseData.maxConcurrentCapital = snapshot.maxConcurrentCapital;
            responseData.maxSingleTransactionCapital = snapshot.maxSingleTransactionCapital;
            responseData.todayPnL = snapshot.todayPnL;
            responseData.dailyLossLimitUsdt = snapshot.dailyLossLimitUsdt;
            responseData.dailyLossLimitPercent = snapshot.dailyLossLimitPercent;
            responseData.totalUnrealizedPnL = snapshot.totalUnrealizedPnL;
            responseData.lockedByDeposit = snapshot.lockedByDeposit;
            responseData.balance = snapshot.balance;
            responseData.activeTransactions = snapshot.activeTransactions;
            responseData.dustBalances = snapshot.dustBalances;
            responseData.clusterStatus = snapshot.clusterStatus;
        } catch (e) {
            logger.error(`Failed to get snapshot for user ${user.id}`, { error: e.message });
        }
    }

    sendJson(res, 200, responseData);
});

router.get('/api/user/trades', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const trades = database.listUserTrades(user.id, 50);
    sendJson(res, 200, {
        ok: true, count: trades.length,
        trades: trades.map(t => ({
            id: t.id, symbol: t.symbol, profit: t.profit,
            creatorShare: t.our_share,
            userKeeps: Number((t.profit - t.our_share).toFixed(6)),
            timestamp: t.trade_timestamp
        }))
    });
});

// ============================================================
// BOT CONTROL (with detailed logging)
// ============================================================
router.post('/api/bot/start', async (req, res) => {
    console.log('\n═══════════════════════════════════════════');
    console.log('BOT START REQUEST');
    console.log('═══════════════════════════════════════════');

    const user = authenticate(req);
    if (!user) {
        console.log('❌ Auth failed');
        return sendJson(res, 401, { error: 'Unauthorized' });
    }

    const currentMode = process.env.MODE || 'TEST';
    const isTestMode = currentMode === 'TEST';

    console.log(`Mode: ${currentMode} | User: ${user.email} (id=${user.id})`);
    console.log(`User status: ${user.status}`);
    console.log(`API key in DB: ${!!user.api_key_encrypted}`);
    console.log(`API key length: ${user.api_key_encrypted ? user.api_key_encrypted.length : 0}`);
    console.log(`Deposit balance: ${user.deposit_balance || 0}`);
    console.log(`Bot locked: ${user.bot_locked}`);
    console.log(`Bot running in DB: ${user.bot_running}`);

    // ⭐ In TEST mode: skip deposit check
    if (!isTestMode) {
        console.log('REAL mode — checking deposit...');

        if (user.bot_locked === 1) {
            const depositInfo = database.getDepositInfo(user.id);
            console.log('❌ Bot locked (REAL mode)');
            return sendJson(res, 402, {
                error: 'Bot locked',
                message: 'Deposit exhausted. Please recharge.',
                nextStep: 'deposit',
                deposit: depositInfo
            });
        }

        const depositInfo = database.getDepositInfo(user.id);
        if (!depositInfo || depositInfo.balance < 2) {
            console.log('❌ REAL mode requires 2 USDT deposit');
            return sendJson(res, 402, {
                error: 'Deposit required',
                message: 'REAL mode requires at least 2 USDT deposit.',
                nextStep: 'deposit',
                deposit: depositInfo
            });
        }
        console.log(`✅ Deposit OK: ${depositInfo.balance}`);
    } else {
        console.log('✅ TEST mode — no deposit required');
    }

    // ⭐ Check API key
    if (!user.api_key_encrypted) {
        console.log('❌ API KEY MISSING — returning 400');
        console.log(`   Value: ${user.api_key_encrypted}`);
        console.log(`   Type: ${typeof user.api_key_encrypted}`);
        console.log(`   User keys: ${Object.keys(user).join(', ')}`);
        console.log('═══════════════════════════════════════════\n');
        return sendJson(res, 400, {
            error: 'API key missing',
            message: 'Please set your Wallex API key first.',
            nextStep: 'set-api-keys'
        });
    }
    console.log(`✅ API key exists in DB`);

    const apiKey = decryptApiKey(user.api_key_encrypted);
    if (!apiKey) {
        console.log('❌ API key decryption FAILED');
        console.log('═══════════════════════════════════════════\n');
        return sendJson(res, 500, {
            error: 'Failed to decrypt API key',
            message: 'Your API key may be corrupted. Please re-enter it.'
        });
    }
    console.log(`✅ API key decrypted successfully`);

    const existing = botManager.getBot(user.id);
    if (existing && existing.running) {
        console.log('ℹ️  Bot already running');
        return sendJson(res, 200, {
            ok: true,
            alreadyRunning: true,
            message: 'Bot already running.'
        });
    }

    console.log('🔄 Creating bot and starting...');
    const bot = await botManager.startBot(user.id, apiKey, null, {
        onTransferTriggered: async (userId, amount) => {
            logger.profit(`Transfer triggered for user ${userId}: ${amount} USDT`);
            database.recordTransfer(userId, amount, process.env.CREATOR_USDT_WALLET);
        }
    });

    if (!bot) {
        console.log('❌ Bot failed to start (botManager returned null)');
        console.log('   This usually means:');
        console.log('   - API key is invalid (Wallex rejected it)');
        console.log('   - Network error');
        console.log('   - Wallex API unreachable');
        console.log('═══════════════════════════════════════════\n');
        return sendJson(res, 500, {
            error: 'Failed to start bot',
            message: 'Your API key may be invalid. Please check your Wallex API key.'
        });
    }

    database.updateBotStatus(user.id, true);
    console.log('✅ Bot started successfully');
	    // ⭐ In TEST mode, auto-unlock the bot in DB (since no deposit required)
    if (isTestMode && user.bot_locked === 1) {
        database.updateUser(user.id, {
            bot_locked: 0,
            lock_reason: null,
            locked_at: null
        });
        console.log('✅ Bot unlocked in DB (TEST mode)');
    }
    console.log('═══════════════════════════════════════════\n');

    sendJson(res, 200, {
        ok: true,
        message: 'Bot started.',
        status: bot.getStatus()
    });
});

router.post('/api/bot/stop', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const stopped = await botManager.stopBot(user.id);
    database.updateBotStatus(user.id, false);
    sendJson(res, 200, { ok: true, stopped, message: stopped ? 'Bot stopped.' : 'Bot was not running.' });
});

router.get('/api/bot/status', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    const bot = botManager.getBot(user.id);
    if (!bot) return sendJson(res, 200, {
        ok: true,
        running: false,
        locked: user.bot_locked === 1
    });
    sendJson(res, 200, {
        ok: true,
        running: bot.running,
        locked: user.bot_locked === 1,
        status: bot.getStatus()
    });
});

// ============================================================
// BOT SETTINGS
// ============================================================
router.get('/api/bot/settings', async (req, res) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });

    const bot = botManager.getBot(user.id);
    const defaults = {
        maxConcurrent: 4, maxSteps: 25, maxTradeCapital: 10,
        adaptiveMode: true, executionMode: process.env.MODE || 'TEST',
        completeOnlyMode: false, selectionMode: 'AUTO', manualPairs: [],
        jumpBuyMode: 'SINGLE', verboseLogging: false, cooldownSeconds: 300,
        minGrossUsdtToUsdt: 0.35, minGrossTmnToTmn: 0.55, minGrossCrossMarket: 0.45
    };

    if (!bot) return sendJson(res, 200, { ok: true, settings: defaults, botRunning: false });

    const s = bot.state.settings;
    const settings = {
        maxConcurrent: s.maxConcurrent || 4,
        maxSteps: s.maxSteps || 25,
        maxTradeCapital: s.maxTradeCapital || 10,
        adaptiveMode: s.adaptiveMode !== false,
        executionMode: s.executionMode || 'TEST',
        completeOnlyMode: s.completeOnlyMode === true,
        selectionMode: s.selectionMode || 'AUTO',
        manualPairs: s.manualPairs || [],
        jumpBuyMode: s.jumpBuyMode || 'SINGLE',
        verboseLogging: s.verboseLogging === true,
        cooldownSeconds: bot.COOLDOWN_SECONDS || 300,
        minGrossUsdtToUsdt: 0.35, minGrossTmnToTmn: 0.55, minGrossCrossMarket: 0.45
    };
    sendJson(res, 200, { ok: true, settings, botRunning: bot.running });
});

router.post('/api/bot/settings', async (req, res, body) => {
    const user = authenticate(req);
    if (!user) return sendJson(res, 401, { error: 'Unauthorized' });
    if (!body) return sendJson(res, 400, { error: 'Body required' });

    const bot = botManager.getBot(user.id);
    if (!bot) return sendJson(res, 404, { error: 'Bot not running. Start bot first.' });

    try {
        const s = bot.state.settings;
        const updates = [];

        if (body.maxConcurrent != null) {
            const v = parseInt(body.maxConcurrent);
            if (v >= 1 && v <= 20) { s.maxConcurrent = v; updates.push('maxConcurrent'); }
        }
        if (body.maxSteps != null) {
            const v = parseInt(body.maxSteps);
            if (v >= 1 && v <= 25) { s.maxSteps = v; updates.push('maxSteps'); }
        }
        if (body.maxTradeCapital != null) {
            const v = parseFloat(body.maxTradeCapital);
            if (v >= 0.5 && v <= 100) { s.maxTradeCapital = v; updates.push('maxTradeCapital'); }
        }
        if (body.adaptiveMode != null) {
            s.adaptiveMode = body.adaptiveMode === true || body.adaptiveMode === 'true';
            updates.push('adaptiveMode');
        }
        if (body.executionMode != null) {
            const m = String(body.executionMode).toUpperCase();
            if (m === 'TEST' || m === 'REAL') { s.executionMode = m; updates.push('executionMode'); }
        }
        if (body.completeOnlyMode != null) {
            s.completeOnlyMode = body.completeOnlyMode === true || body.completeOnlyMode === 'true';
            updates.push('completeOnlyMode');
        }
        if (body.selectionMode != null) {
            const m = String(body.selectionMode).toUpperCase();
            if (m === 'AUTO' || m === 'MANUAL') { s.selectionMode = m; updates.push('selectionMode'); }
        }
        if (body.manualPairs != null) {
            s.manualPairs = Array.isArray(body.manualPairs) ? body.manualPairs : [];
            updates.push('manualPairs');
        }
        if (body.jumpBuyMode != null) {
            const m = String(body.jumpBuyMode).toUpperCase();
            if (m === 'SINGLE' || m === 'CUMULATIVE') { s.jumpBuyMode = m; updates.push('jumpBuyMode'); }
        }
        if (body.verboseLogging != null) {
            s.verboseLogging = body.verboseLogging === true || body.verboseLogging === 'true';
            updates.push('verboseLogging');
        }
        if (body.cooldownSeconds != null) {
            const v = parseInt(body.cooldownSeconds);
            if (v >= 60 && v <= 3600) { bot.COOLDOWN_SECONDS = v; updates.push('cooldownSeconds'); }
        }

        if (body.maxSteps != null) await bot.initializeStepSettings();

        await bot.saveState();
        logger.success(`Settings updated for user ${user.id}: ${updates.join(', ')}`);

        sendJson(res, 200, { ok: true, message: 'Settings updated.', updated: updates });
    } catch (e) {
        logger.error(`Failed to update settings for user ${user.id}`, { error: e.message });
        sendJson(res, 500, { error: 'Failed to update settings', message: e.message });
    }
});

// ============================================================
// ADMIN
// ============================================================
router.get('/api/admin/stats', async (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return sendJson(res, 403, { error: 'Forbidden' });
    const stats = database.getGlobalStats();
    const users = database.listAllUsers();
    sendJson(res, 200, {
        ok: true,
        stats: {
            totalUsers: users.length,
            paidUsers: users.filter(u => u.deposit_paid === 1).length,
            runningBots: botManager.getRunningCount(),
            totalTrades: stats.count,
            totalProfit: Number(stats.total.toFixed(6)),
            totalCreatorShare: Number(stats.our_total.toFixed(6))
        }
    });
});

router.get('/api/admin/users', async (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return sendJson(res, 403, { error: 'Forbidden' });
    sendJson(res, 200, { ok: true, users: database.listAllUsers() });
});

router.get('/api/admin/referrals', async (req, res) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return sendJson(res, 403, { error: 'Forbidden' });
    sendJson(res, 200, { ok: true, users: database.listUsersForReferralReview() });
});

router.post('/api/admin/referral/verify', async (req, res, body) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return sendJson(res, 403, { error: 'Forbidden' });
    if (!body || !body.userId) return sendJson(res, 400, { error: 'userId required' });
    const verified = body.verified === true;
    database.setReferralVerifiedByAdmin(body.userId, verified);
    logger.warn(`Admin set referral verified=${verified} for user ${body.userId}`);
    sendJson(res, 200, { ok: true, message: `Referral ${verified ? 'verified' : 'rejected'}` });
});

router.post('/api/admin/unlock-bot', async (req, res, body) => {
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) return sendJson(res, 403, { error: 'Forbidden' });
    if (!body || !body.userId) return sendJson(res, 400, { error: 'userId required' });
    database.updateUser(body.userId, { bot_locked: 0, lock_reason: null, locked_at: null });
    sendJson(res, 200, { ok: true, message: 'Bot unlocked' });
});

// ============================================================
// VALIDATE + BANNER
// ============================================================
function validateEnvironment() {
    const required = ['JWT_SECRET', 'ENCRYPTION_KEY', 'CREATOR_USDT_WALLET'];
    const missing = required.filter(k => !process.env[k]);
    if (missing.length > 0) {
        console.error('Missing env vars:', missing.join(', '));
        process.exit(1);
    }
    if (process.env.ENCRYPTION_KEY.length !== 32) {
        console.error('ENCRYPTION_KEY must be exactly 32 characters');
        process.exit(1);
    }
}

function banner() {
    console.log('');
    console.log('='.repeat(70));
    console.log('  SmartChef Server v5.0.0');
    console.log('='.repeat(70));
    console.log('  Mode:            ' + (process.env.MODE || 'TEST'));
    console.log('  Port:            ' + PORT);
    console.log('  Creator Wallet:  ' + process.env.CREATOR_USDT_WALLET);
    console.log('  Min Deposit:     ' + MIN_DEPOSIT_USDT + ' USDT');
    console.log('  Profit Share:    ' + (process.env.PROFIT_SHARE_PERCENT || 20) + '%');
    console.log('  Referral Code:   ' + REFERRAL_CODE);
    console.log('  Referral Link:   ' + REFERRAL_LINK);
    console.log('  Altfins Key:     ' + (process.env.ALTFINS_API_KEY ? 'SET' : 'NOT SET'));
    if (process.env.MODE === 'TEST') {
        console.log('  ⭐ TEST MODE: No deposit required to start bot');
    } else {
        console.log('  ⭐ REAL MODE: 2 USDT deposit required to start bot');
    }
    console.log('='.repeat(70));
    console.log('');
}

// ============================================================
// START
// ============================================================
async function main() {
    validateEnvironment();
    database.initializeDatabase();
    banner();

    // Auto-resume bots
    console.log('[SERVER] Checking for active bots to resume...');
    const activeUsers = database.listActiveUsers();
    if (activeUsers.length > 0) {
        console.log(`[SERVER] Found ${activeUsers.length} active user(s)`);
        for (const activeUser of activeUsers) {
            try {
                if (activeUser.bot_locked === 1) {
                    console.log(`[SERVER] User ${activeUser.id} is locked, skipping`);
                    database.updateBotStatus(activeUser.id, false);
                    continue;
                }
                if (!activeUser.api_key_encrypted) {
                    database.updateBotStatus(activeUser.id, false);
                    continue;
                }
                const apiKey = decryptApiKey(activeUser.api_key_encrypted);
                if (!apiKey) {
                    database.updateBotStatus(activeUser.id, false);
                    continue;
                }
                const bot = await botManager.startBot(activeUser.id, apiKey, null, {
                    onTransferTriggered: async (userId, amount) => {
                        logger.profit(`Transfer triggered for user ${userId}: ${amount} USDT`);
                        database.recordTransfer(userId, amount, process.env.CREATOR_USDT_WALLET);
                    }
                });
                if (!bot) database.updateBotStatus(activeUser.id, false);
            } catch (e) {
                database.updateBotStatus(activeUser.id, false);
            }
        }
    } else {
        console.log('[SERVER] No active bots to resume');
    }

    const server = http.createServer(async (req, res) => {
        try {
            if (req.method === 'OPTIONS') return sendJson(res, 200, { ok: true });
            const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
            const match = router.match(req.method, url.pathname);
            if (!match) return sendJson(res, 404, { error: 'Not found', path: url.pathname });
            const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await parseBody(req) : null;
            req.params = match.params;
            for (const handler of match.handlers) {
                await handler(req, res, body);
            }
        } catch (e) {
            console.error('Request error:', e.message);
            if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error', message: e.message });
        }
    });

    server.listen(PORT, () => {
        logger.success(`Server listening on port ${PORT}`);
        console.log('');
    });

    process.on('SIGINT', async () => {
        console.log('\nShutting down...');
        database.save();
        for (const bot of botManager.getAllBots()) {
            try { await bot.stop(); } catch (e) {}
        }
        process.exit(0);
    });

    process.on('SIGTERM', async () => {
        console.log('\nShutting down...');
        database.save();
        for (const bot of botManager.getAllBots()) {
            try { await bot.stop(); } catch (e) {}
        }
        process.exit(0);
    });
}

process.on('uncaughtException', (err) => console.error('Uncaught:', err.message));
process.on('unhandledRejection', (reason) => console.error('Unhandled:', String(reason)));

main();