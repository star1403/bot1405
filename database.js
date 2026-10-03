// database.js - Zero-dependency JSON storage with Deposit + Referral Tracking

const fs = require('fs');
const path = require('path');

const DATA_PATH = process.env.DATABASE_PATH || './data/smartchef.json';
const dataDir = path.dirname(DATA_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const DEFAULT_DB = {
    users: [],
    trades: [],
    transfers: [],
    deposit_logs: [],
    ip_logs: [],
    blocked_ips: [],
    settings: {},
    nextIds: { users: 1, trades: 1, transfers: 1, deposit_logs: 1, ip_logs: 1, blocked_ips: 1 }
};

let db = { ...DEFAULT_DB };
let dirty = false;

function load() {
    try {
        if (fs.existsSync(DATA_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
            db = { ...DEFAULT_DB, ...parsed };
            db.nextIds = { ...DEFAULT_DB.nextIds, ...(parsed.nextIds || {}) };
        } else {
            save();
        }
    } catch (e) {
        console.error('Failed to load DB:', e.message);
        db = { ...DEFAULT_DB };
    }
}

function save() {
    try {
        const tmp = DATA_PATH + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
        fs.renameSync(tmp, DATA_PATH);
        dirty = false;
    } catch (e) {
        console.error('Failed to save DB:', e.message);
    }
}

function markDirty() {
    dirty = true;
    if (!markDirty._timer) {
        markDirty._timer = setTimeout(() => {
            if (dirty) save();
            markDirty._timer = null;
        }, 2000);
    }
}

process.on('SIGINT', () => { save(); process.exit(0); });
process.on('SIGTERM', () => { save(); process.exit(0); });

load();

// ============================================================
// USER OPERATIONS
// ============================================================
function createUser(email, passwordHash, ip, userAgent) {
    const id = db.nextIds.users++;
    const now = new Date().toISOString();
    db.users.push({
        id, email, password_hash: passwordHash,
        api_key_encrypted: null, api_secret_encrypted: null,

        // ⭐ Deposit / ضمانت
        // In TEST mode start with a virtual deposit so share accounting & panel work correctly
        deposit_balance: (process.env.MODE || 'TEST') === 'TEST' ? 10.0 : 0,
        deposit_total_paid: (process.env.MODE || 'TEST') === 'TEST' ? 10.0 : 0,
        total_net_profit: 0,
        total_share_deducted: 0,
        bot_locked: (process.env.MODE || 'TEST') === 'TEST' ? 0 : 1,
        lock_reason: (process.env.MODE || 'TEST') === 'TEST' ? null : 'no_deposit',
        locked_at: (process.env.MODE || 'TEST') === 'TEST' ? null : now,
        initial_deposit_amount: 2.0,
        deposit_paid: (process.env.MODE || 'TEST') === 'TEST' ? 1 : 0,

        // ⭐ TEST balance tracking (virtual trading capital)
        test_balance_usdt: 100,
        test_balance_tmn: 10000000,

        // ⭐ Referral / کد دعوت
        referral_confirmed_by_user: 0,     // کاربر تیک زده (0/1)
        referral_verified_by_admin: 0,     // ادمین تأیید کرده (0/1)
        referral_rejected_by_admin: 0,     // ادمین رد کرده (0/1)
        referral_verified_at: null,
        referral_code_used: null,

        // Stats
        pending_share: 0, total_profit: 0, total_share_paid: 0, total_trades: 0,
        status: 'pending', bot_running: 0,

        last_ip: ip, registration_ip: ip, user_agent: userAgent,
        created_at: now, last_active: now
    });
    markDirty();
    return id;
}

function getUserById(id) { return db.users.find(u => u.id === id) || null; }
function getUserByEmail(email) { return db.users.find(u => u.email === email) || null; }

function updateUser(id, updates) {
    const u = db.users.find(x => x.id === id);
    if (!u) return false;
    Object.assign(u, updates);
    markDirty();
    return true;
}

function updateUserApiKeys(userId, apiKeyEnc, apiSecretEnc) {
    return updateUser(userId, { api_key_encrypted: apiKeyEnc, api_secret_encrypted: apiSecretEnc });
}

function markDepositPaid(userId, amount, txHash) {
    return updateUser(userId, {
        deposit_paid: 1, deposit_amount: amount,
        deposit_tx_hash: txHash,
        deposit_paid_at: new Date().toISOString(),
        status: 'active'
    });
}

function addPendingShare(userId, amount) {
    const u = getUserById(userId);
    if (!u) return;
    u.pending_share = (u.pending_share || 0) + amount;
    markDirty();
}

function resetPendingShare(userId) { return updateUser(userId, { pending_share: 0 }); }
function updateUserLastActive(userId, ip) { return updateUser(userId, { last_active: new Date().toISOString(), last_ip: ip }); }
function updateBotStatus(userId, running) { return updateUser(userId, { bot_running: running ? 1 : 0 }); }
function updateUserStatus(userId, status) { return updateUser(userId, { status }); }

// ============================================================
// REFERRAL OPERATIONS
// ============================================================

/**
 * User confirms they signed up with our referral link
 */
function setReferralConfirmedByUser(userId, codeUsed = '821dm2zz') {
    return updateUser(userId, {
        referral_confirmed_by_user: 1,
        referral_code_used: codeUsed
    });
}

/**
 * Admin verifies (or rejects) that the user actually used our code
 */
function setReferralVerifiedByAdmin(userId, verified) {
    return updateUser(userId, {
        referral_verified_by_admin: verified ? 1 : 0,
        referral_rejected_by_admin: verified ? 0 : 1,
        referral_verified_at: new Date().toISOString()
    });
}

/**
 * List users for referral review (admin panel)
 */
function listUsersForReferralReview() {
    return db.users
        .filter(u => u.referral_confirmed_by_user === 1)
        .map(u => ({
            id: u.id,
            email: u.email,
            referral_confirmed_by_user: u.referral_confirmed_by_user,
            referral_verified_by_admin: u.referral_verified_by_admin,
            referral_rejected_by_admin: u.referral_rejected_by_admin,
            referral_verified_at: u.referral_verified_at,
            referral_code_used: u.referral_code_used,
            deposit_balance: u.deposit_balance || 0,
            bot_locked: u.bot_locked,
            created_at: u.created_at,
            last_active: u.last_active
        }))
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function getReferralInfo(userId) {
    const u = getUserById(userId);
    if (!u) return null;
    return {
        referralCode: '821dm2zz',
        referralLink: 'https://wallex.ir/signup?ref=821dm2zz',
        confirmedByUser: u.referral_confirmed_by_user === 1,
        verifiedByAdmin: u.referral_verified_by_admin === 1,
        rejectedByAdmin: u.referral_rejected_by_admin === 1,
        verifiedAt: u.referral_verified_at,
        codeUsed: u.referral_code_used,
        benefits: {
            discountPercent: 20,
            freeBotUsage: true
        }
    };
}

// ============================================================
// DEPOSIT OPERATIONS
// ============================================================

function addDeposit(userId, amount, txHash, source = 'manual') {
    const u = getUserById(userId);
    if (!u) return { ok: false, reason: 'user_not_found' };

    // Anti-replay: reject if this txHash was already used by anyone
    if (txHash && db.deposit_logs.some(l => l.tx_hash === txHash && l.type === 'deposit')) {
        return { ok: false, reason: 'tx_already_used' };
    }

    const id = db.nextIds.deposit_logs++;
    db.deposit_logs.push({
        id,
        user_id: userId,
        type: 'deposit',
        amount: amount,
        tx_hash: txHash,
        source: source,
        timestamp: new Date().toISOString()
    });

    u.deposit_balance = (u.deposit_balance || 0) + amount;
    u.deposit_total_paid = (u.deposit_total_paid || 0) + amount;

    let botUnlocked = false;
    if (u.bot_locked === 1) {
        u.bot_locked = 0;
        u.lock_reason = null;
        u.locked_at = null;
        botUnlocked = true;
    }

    markDirty();
    return {
        ok: true,
        newBalance: u.deposit_balance,
        newTotalPaid: u.deposit_total_paid,
        botUnlocked: botUnlocked
    };
}

function deductShareFromDeposit(userId, shareAmount, netProfit) {
    const u = getUserById(userId);
    if (!u) return { ok: false, reason: 'user_not_found' };

    // ⭐ In TEST mode, never lock the bot (deposit is virtual)
    const currentMode = process.env.MODE || 'TEST';
    const isTestMode = currentMode === 'TEST';

    const currentBalance = u.deposit_balance || 0;

    // If balance is already 0
    if (currentBalance <= 0) {
        if (!isTestMode && u.bot_locked !== 1) {
            // REAL mode: lock the bot
            u.bot_locked = 1;
            u.lock_reason = 'deposit_exhausted';
            u.locked_at = new Date().toISOString();
            markDirty();
            console.log(`[DB] User ${userId} locked (REAL mode, deposit=0)`);
        }
        // In TEST mode: just log and continue
        if (isTestMode) {
            console.log(`[DB] User ${userId} deposit=0 but TEST mode - not locking`);
        }
        return { ok: true, deducted: 0, newBalance: 0, locked: !isTestMode };
    }

    const actualDeduct = Math.min(shareAmount, currentBalance);
    const newBalance = currentBalance - actualDeduct;

    const id = db.nextIds.deposit_logs++;
    db.deposit_logs.push({
        id,
        user_id: userId,
        type: 'deduct',
        amount: -actualDeduct,
        net_profit: netProfit,
        share_amount: shareAmount,
        actual_deducted: actualDeduct,
        balance_after: newBalance,
        timestamp: new Date().toISOString()
    });

    u.deposit_balance = newBalance;
    u.total_share_deducted = (u.total_share_deducted || 0) + actualDeduct;
    u.total_net_profit = (u.total_net_profit || 0) + netProfit;

    let locked = false;
    if (newBalance <= 0 && !isTestMode) {
        u.bot_locked = 1;
        u.lock_reason = 'deposit_exhausted';
        u.locked_at = new Date().toISOString();
        locked = true;
        console.log(`[DB] User ${userId} locked (REAL mode, deposit depleted)`);
    }

    markDirty();
    return {
        ok: true,
        deducted: actualDeduct,
        newBalance: newBalance,
        locked: locked,
        warning: newBalance > 0 && newBalance < 0.5 ? 'low_deposit' : null
    };
}

function getDepositInfo(userId) {
    const u = getUserById(userId);
    if (!u) return null;

    const balance = u.deposit_balance || 0;
    const isTestMode = (process.env.MODE || 'TEST') === 'TEST';

    // In TEST mode, never report as locked
    const isLocked = isTestMode ? false : (u.bot_locked === 1);

    let status = 'ok';
    if (isLocked) status = 'locked';
    else if (balance <= 0 && !isTestMode) status = 'empty';
    else if (balance < 0.5 && balance > 0) status = 'low';

    return {
        balance: balance,
        totalPaid: u.deposit_total_paid || 0,
        totalNetProfit: u.total_net_profit || 0,
        totalShareDeducted: u.total_share_deducted || 0,
        initialAmount: u.initial_deposit_amount || 2.0,
        botLocked: isLocked,
        lockReason: isLocked ? u.lock_reason : null,
        lockedAt: isLocked ? u.locked_at : null,
        status: status,
        minimumDeposit: parseFloat(process.env.MIN_DEPOSIT_USDT || '2.0')
    };
}

function getDepositHistory(userId, limit = 50) {
    return db.deposit_logs
        .filter(l => l.user_id === userId)
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
}

function isBotLocked(userId) {
    const u = getUserById(userId);
    if (!u) return true;
    return u.bot_locked === 1;
}

// ============================================================
// TRADE OPERATIONS
// ============================================================
function recordTrade(userId, symbol, buyPrice, sellPrice, quantity, profit, ourShare, market, orderType) {
    const id = db.nextIds.trades++;
    db.trades.push({
        id, user_id: userId, symbol,
        buy_price: buyPrice, sell_price: sellPrice, quantity,
        profit, our_share: ourShare, market, order_type: orderType,
        trade_timestamp: new Date().toISOString()
    });
    const u = getUserById(userId);
    if (u) {
        u.total_profit = (u.total_profit || 0) + profit;
        u.total_share_paid = (u.total_share_paid || 0) + ourShare;
        u.total_trades = (u.total_trades || 0) + 1;
        u.pending_share = (u.pending_share || 0) + ourShare;
    }
    markDirty();
}

function listUserTrades(userId, limit = 50) {
    return db.trades
        .filter(t => t.user_id === userId)
        .sort((a, b) => new Date(b.trade_timestamp) - new Date(a.trade_timestamp))
        .slice(0, limit);
}

function getUserStats(userId) {
    const trades = db.trades.filter(t => t.user_id === userId);
    return {
        total: trades.reduce((s, t) => s + (t.profit || 0), 0),
        our_total: trades.reduce((s, t) => s + (t.our_share || 0), 0),
        count: trades.length
    };
}

function getGlobalStats() {
    return {
        total: db.trades.reduce((s, t) => s + (t.profit || 0), 0),
        our_total: db.trades.reduce((s, t) => s + (t.our_share || 0), 0),
        count: db.trades.length
    };
}

// ============================================================
// TRANSFER OPERATIONS
// ============================================================
function recordTransfer(userId, amount, walletAddress) {
    const id = db.nextIds.transfers++;
    db.transfers.push({
        id, user_id: userId, amount, wallet_address: walletAddress,
        tx_hash: null, status: 'pending', error_message: null,
        created_at: new Date().toISOString(), confirmed_at: null
    });
    markDirty();
    return id;
}

function updateTransferStatus(transferId, status, txHash, errorMessage) {
    const t = db.transfers.find(x => x.id === transferId);
    if (!t) return false;
    t.status = status;
    if (txHash) t.tx_hash = txHash;
    if (errorMessage) t.error_message = errorMessage;
    if (status === 'confirmed') t.confirmed_at = new Date().toISOString();
    markDirty();
    return true;
}

function listPendingTransfers() { return db.transfers.filter(t => t.status === 'pending'); }
function listUserTransfers(userId) {
    return db.transfers.filter(t => t.user_id === userId)
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}
function getAllTransfers(limit = 100) {
    return db.transfers.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
}

// ============================================================
// IP OPERATIONS
// ============================================================
function logIp(userId, ip, userAgent, action) {
    const id = db.nextIds.ip_logs++;
    db.ip_logs.push({ id, user_id: userId, ip, user_agent: userAgent, action, timestamp: new Date().toISOString() });
    if (db.ip_logs.length > 50000) db.ip_logs = db.ip_logs.slice(-50000);
    markDirty();
}

function countDistinctIps(userId) {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const ips = new Set();
    for (const log of db.ip_logs) {
        if (log.user_id === userId && new Date(log.timestamp).getTime() >= cutoff) ips.add(log.ip);
    }
    return ips.size;
}

function listIpsForUser(userId) {
    const map = new Map();
    for (const log of db.ip_logs) {
        if (log.user_id !== userId) continue;
        const cur = map.get(log.ip);
        if (!cur || new Date(log.timestamp) > new Date(cur.last_seen)) {
            map.set(log.ip, { ip: log.ip, last_seen: log.timestamp, count: (cur?.count || 0) + 1 });
        } else cur.count++;
    }
    return Array.from(map.values());
}

function isIpBlocked(ip) { return db.blocked_ips.some(b => b.ip === ip); }
function blockIp(ip, reason) {
    if (isIpBlocked(ip)) return false;
    const id = db.nextIds.blocked_ips++;
    db.blocked_ips.push({ id, ip, reason, blocked_at: new Date().toISOString() });
    markDirty();
    return true;
}
function listBlockedIps() { return db.blocked_ips; }

// ============================================================
// LIST ALL USERS (for admin)
// ============================================================
function listAllUsers() {
    return db.users.map(u => ({
        id: u.id, email: u.email, status: u.status,
        deposit_paid: u.deposit_paid, deposit_amount: u.deposit_amount,
        deposit_balance: u.deposit_balance || 0,
        total_net_profit: u.total_net_profit || 0,
        total_share_deducted: u.total_share_deducted || 0,
        bot_locked: u.bot_locked,
        pending_share: u.pending_share, total_profit: u.total_profit,
        total_share_paid: u.total_share_paid, total_trades: u.total_trades,
        bot_running: u.bot_running, last_ip: u.last_ip,
        referral_confirmed_by_user: u.referral_confirmed_by_user || 0,
        referral_verified_by_admin: u.referral_verified_by_admin || 0,
        referral_rejected_by_admin: u.referral_rejected_by_admin || 0,
        created_at: u.created_at, last_active: u.last_active
    }));
}

function listActiveUsers() {
    return db.users.filter(u => u.status === 'active' && u.bot_running === 1);
}

function initializeDatabase() {
    load();
    console.log('Database initialized at:', DATA_PATH);
}

module.exports = {
    initializeDatabase, save,

    // Users
    createUser, getUserById, getUserByEmail, updateUser,
    updateUserApiKeys, markDepositPaid, addPendingShare, resetPendingShare,
    updateUserLastActive, updateBotStatus, updateUserStatus,
    listAllUsers, listActiveUsers, getUserStats, getGlobalStats,

    // Referral
    setReferralConfirmedByUser, setReferralVerifiedByAdmin,
    listUsersForReferralReview, getReferralInfo,

    // Deposit
    addDeposit, deductShareFromDeposit, getDepositInfo, getDepositHistory, isBotLocked,

    // Trades
    recordTrade, listUserTrades,

    // Transfers
    recordTransfer, updateTransferStatus, listPendingTransfers,
    listUserTransfers, getAllTransfers,

    // IP
    logIp, countDistinctIps, listIpsForUser,
    isIpBlocked, blockIp, listBlockedIps
};