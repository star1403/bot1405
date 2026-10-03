#!/usr/bin/env node
// client.js - SmartChef Client Panel
// Version 4.2.0 - With Referral + Deposit + Lock System

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const http = require('http');
const https = require('https');

// ============================================================
// Config
// ============================================================
const CONFIG_PATH = path.join(__dirname, 'config.json');
let config = { serverUrl: 'http://localhost:3000', language: 'en' };
try {
    if (fs.existsSync(CONFIG_PATH)) {
        config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
} catch (e) {}

// ============================================================
// Session
// ============================================================
let session = {
    token: null,
    userId: null,
    email: null,
    depositPaid: false,
    botRunning: false,
    botLocked: false,
    apiKeySet: false,
    referralConfirmed: false,
    referralVerified: false,
    referralInfo: null,
    depositInfo: null
};

// ============================================================
// ANSI Colors
// ============================================================
const C = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[91m',
    green: '\x1b[92m',
    yellow: '\x1b[93m',
    blue: '\x1b[94m',
    magenta: '\x1b[95m',
    cyan: '\x1b[96m',
    white: '\x1b[97m',
    gold: '\x1b[38;5;220m',
    orange: '\x1b[38;5;208m',
    pink: '\x1b[38;5;213m',
    lime: '\x1b[38;5;154m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgRed: '\x1b[41m',
    bgBlue: '\x1b[44m',
    clearScreen: '\x1b[2J\x1b[H'
};

// ============================================================
// HTTP
// ============================================================
function httpRequest(method, urlPath, body = null, token = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(config.serverUrl);
        const isHttps = url.protocol === 'https:';
        const lib = isHttps ? https : http;

        const data = body ? JSON.stringify(body) : '';
        const headers = {
            'Content-Type': 'application/json',
            'User-Agent': 'SmartChef-Client/4.2.0'
        };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        if (data) headers['Content-Length'] = Buffer.byteLength(data);

        const options = {
            hostname: url.hostname,
            port: url.port || (isHttps ? 443 : 80),
            path: urlPath,
            method,
            headers,
            timeout: 30000
        };

        const req = lib.request(options, (res) => {
            let responseData = '';
            res.on('data', chunk => responseData += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(responseData);
                    resolve({ status: res.statusCode, data: parsed });
                } catch (e) {
                    resolve({ status: res.statusCode, data: responseData });
                }
            });
        });

        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

        if (data) req.write(data);
        req.end();
    });
}

// ============================================================
// Prompt helpers
// ============================================================
function createRl() {
    return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, hidden = false) {
    return new Promise(resolve => {
        if (!hidden) {
            rl.question(question, ans => resolve(ans.trim()));
            return;
        }
        const stdin = process.stdin;
        const stdout = process.stdout;
        stdout.write(question);
        let input = '';
        const onData = (char) => {
            char = char.toString();
            switch (char) {
                case '\n': case '\r': case '\u0004':
                    stdin.removeListener('data', onData);
                    stdout.write('\n');
                    resolve(input);
                    break;
                case '\u0003':
                    process.exit();
                    break;
                case '\u007f':
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                        stdout.write('\b \b');
                    }
                    break;
                default:
                    input += char;
                    stdout.write('*');
                    break;
            }
        };
        stdin.on('data', onData);
    });
}

async function pause(msg = 'Press Enter to continue...') {
    const rl = createRl();
    await new Promise(resolve => rl.question(msg, () => { rl.close(); resolve(); }));
}

async function choose(question, options) {
    console.log('');
    console.log(C.cyan + question + C.reset);
    console.log('');
    options.forEach((opt, i) => {
        console.log(`  ${C.bright}${i + 1}${C.reset}. ${opt}`);
    });
    console.log('');
    const rl = createRl();
    while (true) {
        const ans = await new Promise(resolve => rl.question(`Choose (1-${options.length}): `, resolve));
        const n = parseInt(ans);
        if (n >= 1 && n <= options.length) {
            rl.close();
            return n - 1;
        }
        console.log(C.red + 'Invalid choice. Try again.' + C.reset);
    }
}

// ============================================================
// Display helpers
// ============================================================
function clear() { process.stdout.write(C.clearScreen); }

function header() {
    console.log('');
    console.log(C.cyan + '='.repeat(72) + C.reset);
    console.log(C.cyan + C.bright + '  ✨  SmartChef Trading Bot — Client Panel  ✨' + C.reset);
    console.log(C.cyan + '='.repeat(72) + C.reset);
    console.log('');
}

// ============================================================
// ⭐ WELCOME MESSAGE (Referral Focus)
// ============================================================
async function showWelcomeWithReferral() {
    clear();
    console.log('');
    console.log('');
    console.log(C.gold + C.bright + '    +==============================================================+' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |          ' + C.white + C.bright + 'Welcome to SmartChef Trading Bot' + C.gold + C.bright + '             |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    +==============================================================+' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.yellow + C.bright + 'A SPECIAL GIFT FOR YOU:' + C.gold + C.bright + '                                    |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.green + C.bright + '[+] 20% LOWER trading fees on Wallex' + C.gold + C.bright + '                |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.green + C.bright + '[+] FREE usage of SmartChef bot' + C.gold + C.bright + '                     |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.green + C.bright + '[+] Faster and optimized trades' + C.gold + C.bright + '                     |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    +==============================================================+' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.pink + C.bright + 'Please sign up on Wallex using this link:' + C.gold + C.bright + '           |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.bgBlue + C.white + C.bright + '  https://wallex.ir/signup?ref=821dm2zz                     ' + C.reset + C.gold + C.bright + '   |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.lime + C.bright + 'Or enter this referral code on Wallex:' + C.gold + C.bright + '               |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |                  ' + C.bgYellow + C.bright + '   821dm2zz   ' + C.reset + C.gold + C.bright + '                            |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    +==============================================================+' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.orange + C.bright + 'WITHOUT this referral code, using the bot is' + C.gold + C.bright + '        |' + C.reset);
    console.log(C.gold + C.bright + '    |   ' + C.orange + C.bright + 'NOT possible.' + C.gold + C.bright + '                                            |' + C.reset);
    console.log(C.gold + C.bright + '    |                                                              |' + C.reset);
    console.log(C.gold + C.bright + '    +==============================================================+' + C.reset);
    console.log('');

    await pause('Press Enter to continue...');
}

// ============================================================
// ⭐ Referral Confirmation
// ============================================================
async function doReferralConfirm() {
    clear();
    header();

    let referralInfo = { code: '821dm2zz', link: 'https://wallex.ir/signup?ref=821dm2zz', discountPercent: 20 };
    try {
        const res = await httpRequest('GET', '/api/public/referral');
        if (res.data && res.data.ok) {
            referralInfo = {
                code: res.data.code,
                link: res.data.link,
                discountPercent: res.data.discountPercent || 20,
                minDeposit: res.data.minDeposit
            };
            session.referralInfo = referralInfo;
        }
    } catch (e) {}

    console.log('');
    console.log(C.cyan + '-'.repeat(72) + C.reset);
    console.log(C.bright + C.yellow + '  REFERRAL CODE (OPTIONAL)' + C.reset);
    console.log(C.cyan + '-'.repeat(72) + C.reset);
    console.log('');
    console.log(C.white + '  To get special benefits, we recommend signing up on Wallex' + C.reset);
    console.log(C.white + '  with the code below. It is OPTIONAL but highly recommended:' + C.reset);
    console.log('');
    console.log('  ' + C.bgYellow + C.bright + '   Referral Code: ' + referralInfo.code + '   ' + C.reset);
    console.log('');
    console.log('  ' + C.cyan + 'Link: ' + C.white + referralInfo.link + C.reset);
    console.log('');
    console.log(C.green + '  Benefits of using this code:' + C.reset);
    console.log(C.green + '    [+] 20% LOWER trading fees on Wallex' + C.reset);
    console.log(C.green + '    [+] Faster and optimized trades' + C.reset);
    console.log('');
    console.log(C.yellow + C.bright + '  NOTE: You can skip this step if you already have an account.' + C.reset);
    console.log(C.yellow + '  The bot will work either way.' + C.reset);
    console.log('');

    const rl = createRl();
    const ans = await new Promise(resolve => rl.question(
        C.green + '  Did you sign up on Wallex with this code? (yes/no/skip): ' + C.reset,
        resolve
    ));
    rl.close();

    const normalized = ans.toLowerCase().trim();

    // If user says "skip" or "no", we still continue but mark as not confirmed
    if (normalized === 'skip' || normalized === 's' || normalized === 'no' || normalized === 'n') {
        console.log('');
        console.log(C.yellow + '  [INFO] Referral code skipped.' + C.reset);
        console.log(C.dim + '  You can still use the bot normally.' + C.reset);
        console.log(C.dim + '  If you change your mind, use the code later: ' + referralInfo.code + C.reset);
        console.log('');
        session.referralConfirmed = false;

        // Try to save "skipped" state (if server supports it)
        try {
            await httpRequest('POST', '/api/user/referral/confirm', { code: null, skipped: true }, session.token);
        } catch (e) {}

        await pause();
        return true;  // ⭐ IMPORTANT: return true so registration continues
    }

    if (normalized === 'yes' || normalized === 'y') {
        try {
            const res = await httpRequest('POST', '/api/user/referral/confirm', { code: referralInfo.code }, session.token);
            if (res.data.ok) {
                session.referralConfirmed = true;
                console.log('');
                console.log(C.green + C.bright + '  [OK] Referral code confirmed!' + C.reset);
                console.log(C.dim + '  Thank you for supporting us!' + C.reset);
                console.log('');
                await pause();
                return true;
            } else {
                console.log(C.yellow + '  [WARN] Could not save referral status, but continuing.' + C.reset);
                await pause();
                return true;  // ⭐ continue anyway
            }
        } catch (e) {
            console.log(C.yellow + '  [WARN] Server error, but continuing.' + C.reset);
            await pause();
            return true;  // ⭐ continue anyway
        }
    }

    // Any other input — continue
    console.log(C.yellow + '  [INFO] Continuing without referral confirmation.' + C.reset);
    await pause();
    return true;
}

// ============================================================
// Deposit Display / Charge
// ============================================================
function renderDepositBox(deposit, walletAddress) {
    const balance = deposit?.balance || 0;
    const minimum = deposit?.minimumDeposit || 2.0;
    const botLocked = deposit?.botLocked;
    const status = deposit?.status || 'ok';

    console.log('');
    if (botLocked) {
        console.log(C.bgRed + C.white + C.bright + '  [!] DEPOSIT EXHAUSTED - BOT LOCKED  ' + C.reset);
        console.log('');
        console.log(C.red + C.bright + '  +================================================================+' + C.reset);
        console.log(C.red + C.bright + '  |                                                                |' + C.reset);
        console.log(C.red + C.bright + '  |   Deposit balance:  ' + C.bgRed + C.white + ' 0.0000 USDT ' + C.reset + C.red + C.bright + '                             |' + C.reset);
        console.log(C.red + C.bright + '  |                                                                |' + C.reset);
        console.log(C.red + C.bright + '  |   Minimum recharge: ' + C.yellow + C.bright + minimum + ' USDT' + C.reset + C.red + C.bright + '                              |' + C.reset);
        console.log(C.red + C.bright + '  |   Network:          ' + C.cyan + C.bright + 'TRC20' + C.reset + C.red + C.bright + '                                         |' + C.reset);
        console.log(C.red + C.bright + '  |                                                                |' + C.reset);
        console.log(C.red + C.bright + '  |   Wallet Address:                                              |' + C.reset);
        console.log(C.red + C.bright + '  |   ' + C.bgGreen + C.white + C.bright + ' ' + (walletAddress || '---') + ' ' + C.reset + C.red + C.bright + '  |' + C.reset);
        console.log(C.red + C.bright + '  |                                                                |' + C.reset);
        console.log(C.red + C.bright + '  |   WARNING: Send ONLY USDT on TRC20 network.                    |' + C.reset);
        console.log(C.red + C.bright + '  |   Wrong network = PERMANENT LOSS of funds.                     |' + C.reset);
        console.log(C.red + C.bright + '  |                                                                |' + C.reset);
        console.log(C.red + C.bright + '  +================================================================+' + C.reset);
        console.log('');
    } else if (status === 'low') {
        console.log(C.bgYellow + C.reset + C.yellow + C.bright + '  [!] WARNING: Your deposit is running low  ' + C.reset);
        console.log('');
        console.log(C.yellow + C.bright + '  Deposit balance: ' + C.white + C.bright + balance.toFixed(4) + ' USDT' + C.reset);
        console.log(C.yellow + '  Please recharge soon to avoid interruption.' + C.reset);
        console.log('');
    } else {
        console.log(C.green + C.bright + '  Deposit active: ' + C.white + C.bright + balance.toFixed(4) + ' USDT' + C.reset);
        console.log(C.dim + `  (Total net profit: ${(deposit?.totalNetProfit || 0).toFixed(4)} | Share deducted: ${(deposit?.totalShareDeducted || 0).toFixed(4)})` + C.reset);
        console.log('');
    }
}

async function doDepositCharge() {
    clear();
    header();

    let info;
    try {
        const res = await httpRequest('GET', '/api/user/deposit/status', null, session.token);
        info = res.data;
        session.depositInfo = info.deposit;
    } catch (e) {
        console.log(C.red + '  Cannot fetch deposit info: ' + e.message + C.reset);
        await pause();
        return false;
    }

    console.log('');
    console.log(C.cyan + '-'.repeat(72) + C.reset);
    console.log(C.bright + C.yellow + '  DEPOSIT RECHARGE' + C.reset);
    console.log(C.cyan + '-'.repeat(72) + C.reset);
    console.log('');
    console.log(C.white + `  Current balance:  ` + C.bright + C.yellow + (info.deposit?.balance || 0).toFixed(4) + ' USDT' + C.reset);
    console.log(C.white + `  Minimum deposit:  ` + C.bright + C.lime + info.minimumDeposit + ' USDT' + C.reset);
    console.log(C.white + `  Network:          ` + C.bright + C.cyan + 'TRC20' + C.reset);
    console.log('');
    console.log(C.white + C.bright + '  Wallet Address:' + C.reset);
    console.log('  ' + C.bgGreen + C.white + C.bright + '  ' + info.walletAddress + '  ' + C.reset);
    console.log('');
    console.log(C.yellow + C.bright + '  WARNING: Send ONLY USDT on TRC20 network.' + C.reset);
    console.log(C.yellow + '  Wrong network = PERMANENT LOSS of funds.' + C.reset);
    console.log('');

    await pause('  After sending, press Enter...');

    console.log('');
    const rl = createRl();
    const txHash = await ask(rl, C.cyan + '  Enter TX Hash: ' + C.reset);
    rl.close();

    if (!txHash || txHash.length < 10) {
        console.log(C.red + '  [FAIL] Invalid TX Hash.' + C.reset);
        await pause();
        return false;
    }

    console.log('');
    console.log(C.cyan + '  Verifying transaction...' + C.reset);
    console.log('');

    try {
        const res = await httpRequest('POST', '/api/user/deposit/verify', { txHash }, session.token);
        if (res.data.ok) {
            console.log(C.green + C.bright + '  [OK] Deposit successfully added!' + C.reset);
            console.log(C.green + `  New balance: ${res.data.newBalance?.toFixed(4)} USDT` + C.reset);
            if (res.data.botUnlocked) {
                console.log(C.green + C.bright + '  [OK] Bot UNLOCKED!' + C.reset);
                session.botLocked = false;
            }
            await pause();
            return true;
        } else if (res.data.pending) {
            console.log(C.yellow + '  [WAIT] Transaction found but not yet confirmed.' + C.reset);
            console.log(C.yellow + '  Please wait a few minutes and try again.' + C.reset);
            await pause();
            return false;
        } else {
            console.log(C.red + '  [FAIL] ' + (res.data.error || 'Verification failed') + C.reset);
            await pause();
            return false;
        }
    } catch (e) {
        console.log(C.red + '  [FAIL] Error: ' + e.message + C.reset);
        await pause();
        return false;
    }
}

async function showDepositHistory() {
    clear();
    header();
    console.log(C.cyan + C.bright + '  DEPOSIT HISTORY' + C.reset);
    console.log('');

    try {
        const res = await httpRequest('GET', '/api/user/deposit/history', null, session.token);
        const history = res.data.history || [];

        if (history.length === 0) {
            console.log(C.yellow + '  No transactions recorded yet.' + C.reset);
            await pause();
            return;
        }

        console.log(C.white + '  ' + '-'.repeat(72) + C.reset);
        console.log(C.cyan + `  ${'Date'.padEnd(22)} ${'Type'.padEnd(12)} ${'Amount'.padEnd(14)} ${'Balance'.padEnd(14)}` + C.reset);
        console.log(C.white + '  ' + '-'.repeat(72) + C.reset);

        for (const h of history) {
            const date = new Date(h.timestamp).toISOString().replace('T', ' ').substring(0, 19);
            const type = h.type === 'deposit' ? 'Deposit' : 'Share Deduct';
            const amtStr = (h.amount >= 0 ? '+' : '') + (h.amount || 0).toFixed(4);
            const balanceAfter = h.balance_after !== undefined ? h.balance_after.toFixed(4) : '-';
            const color = h.amount >= 0 ? C.green : C.red;
            console.log(`  ${C.dim}${date}${C.reset}  ${C.white}${type.padEnd(12)}${C.reset}  ${color}${amtStr.padEnd(14)}${C.reset}  ${C.yellow}${balanceAfter}${C.reset}`);
        }

        console.log(C.white + '  ' + '-'.repeat(72) + C.reset);
        console.log('');
    } catch (e) {
        console.log(C.red + '  Error: ' + e.message + C.reset);
    }
    await pause();
}

// ============================================================
// Format helpers
// ============================================================
function fmtPrice(p) {
    const n = Number(p);
    if (!isFinite(n) || n === 0) return '0.0000';
    if (Math.abs(n) < 0.0001) return n.toFixed(8);
    if (Math.abs(n) < 0.01) return n.toFixed(6);
    if (Math.abs(n) < 1) return n.toFixed(4);
    if (Math.abs(n) < 1000) return n.toFixed(4);
    return n.toFixed(2);
}

function cell(str, width) {
    const s = String(str == null ? '' : str);
    if (s.length > width) return s.slice(0, width);
    return s.padEnd(width);
}

function fmtUpnl(usdt, pct) {
    if (!isFinite(usdt)) return 'n/a';
    const sign = usdt >= 0 ? '+' : '';
    return `${sign}${usdt.toFixed(3)} ${(pct >= 0 ? '+' : '')}${pct.toFixed(1)}%`;
}

// ============================================================
// Build dashboard
// ============================================================
function buildDashboardLines(status) {
    const lines = [];
    const modeLabel = status.mode || 'TEST';
    const regimeIcon = status.marketRegime === 'BEAR' ? 'BEAR' :
                       (status.marketRegime === 'BULL' ? 'BULL' : 'SIDE');
    const balance = status.balance || {};
    const stats = status.stats || {};
    const pending = status.pendingShare || {};
    const deposit = status.deposit || {};
    const rows = status.activeTransactions || [];
    const cluster = status.clusterStatus || {};

    lines.push('');
    lines.push(`${C.cyan}${'='.repeat(72)}${C.reset}`);
    lines.push(`${C.cyan}${C.bright}  USER ${status.user.id} - SMART CHEF BOT (${modeLabel} MODE)${C.reset}`);
    lines.push(`${C.cyan}${'='.repeat(72)}${C.reset}`);
    lines.push('');

    // DEPOSIT SECTION
    const depBalance = deposit.balance || 0;
    const depLocked = deposit.botLocked;
    const depStatus = deposit.status || 'ok';

    lines.push('');
    if (depLocked) {
        lines.push(`${C.bgRed}${C.white}${C.bright}  [!] DEPOSIT EXHAUSTED - BOT LOCKED                             ${C.reset}`);
        lines.push(`${C.red}${C.bright}  Deposit Balance: ${C.white}${C.bright}0.0000 USDT${C.reset}`);
        lines.push(`${C.red}  Please recharge to continue trading.${C.reset}`);
        lines.push('');
    } else if (depStatus === 'low') {
        lines.push(`${C.bgYellow}${C.reset}${C.yellow}${C.bright}  [!] DEPOSIT LOW - Please recharge soon                         ${C.reset}`);
        lines.push(`${C.yellow}${C.bright}  Deposit Balance: ${C.white}${C.bright}${depBalance.toFixed(4)} USDT${C.reset}`);
        lines.push('');
    } else {
        lines.push(`${C.green}${C.bright}  DEPOSIT: ${C.white}${C.bright}${depBalance.toFixed(4)} USDT${C.reset} ${C.green}[OK]${C.reset}`);
        lines.push(`${C.dim}     Total net profit: ${(deposit.totalNetProfit || 0).toFixed(4)} USDT | Share deducted: ${(deposit.totalShareDeducted || 0).toFixed(4)} USDT${C.reset}`);
        lines.push('');
    }

    // Balance Summary
    lines.push(`${C.white}${C.bright}BALANCE SUMMARY:${C.reset}`);
    lines.push(`   USDT Balance:     ${C.green}${(balance.usdt || 0).toFixed(4)} USDT${C.reset}`);
    lines.push(`   TMN Balance:      ${C.green}${(balance.tmn || 0).toFixed(0)} TMN${C.reset} (${(balance.tmnInUsdt || 0).toFixed(4)} USDT @ ${(balance.rate || 0).toFixed(0)})`);
    lines.push(`   ${'-'.repeat(50)}`);
    lines.push(`   Total Equity:     ${C.bright}${(balance.totalEquity || 0).toFixed(4)} USDT${C.reset}`);
    lines.push(`   Blocked Capital:  ${C.yellow}${(balance.blockedTotal || 0).toFixed(4)} USDT${C.reset}`);
    lines.push(`   Available:        ${C.green}${(balance.available || 0).toFixed(4)} USDT${C.reset}`);
    if (balance.isOverleveraged) {
        lines.push(`   ${C.red}${C.bright}WARNING: Blocked > Equity!${C.reset}`);
    }
    lines.push(`   Mode: ${modeLabel} | Market: ${regimeIcon} | Crisis: ${status.crisisCount || 0}`);
    lines.push('');

    // Statistics
    lines.push(`${C.white}${C.bright}STATISTICS:${C.reset}`);
    lines.push(`   ${C.cyan}Number of Sells: ${status.sellHistoryCount || 0} | Total Profit: ${(stats.totalProfit || 0).toFixed(2)} USDT${C.reset}`);
    lines.push(`   ${C.gold}${C.bright}Creator Share (20%): ${(stats.totalCreatorShare || 0).toFixed(4)} USDT${C.reset}`);
    const dailyColor = (status.todayPnL || 0) >= 0 ? C.green : C.red;
    const dailySign = (status.todayPnL || 0) >= 0 ? '+' : '';
    lines.push(`   ${dailyColor}Today PnL: ${dailySign}${(status.todayPnL || 0).toFixed(3)} USDT${C.reset}`);
    lines.push(`   Max Concurrent Capital: ${C.orange}${parseFloat(status.maxConcurrentCapital || 0).toFixed(2)} USDT${C.reset}`);
    lines.push(`   Max Single Capital: ${C.orange}${parseFloat(status.maxSingleTransactionCapital || 0).toFixed(2)} USDT${C.reset}`);
    lines.push(`   Active Transactions: ${rows.length}/${status.maxConcurrent || 4}`);
    lines.push(`   Max Steps: ${status.maxSteps || 25} | Jump Buy Mode: ${status.jumpBuyMode || 'SINGLE'}`);
    lines.push(`   Max Trade Capital: ${status.maxTradeCapital || 10} USDT`);

    const clusterKeys = Object.keys(cluster);
    if (clusterKeys.length > 0) {
        const clusterParts = clusterKeys.map(k => `${k}:${cluster[k]}`).join(' | ');
        lines.push(`   Clusters: ${clusterParts}`);
    }
    lines.push('');

    // Pending share
    lines.push(`${C.white}${C.bright}PENDING CREATOR SHARE:${C.reset}`);
    lines.push(`   Accumulated: ${C.yellow}${(pending.current || 0).toFixed(4)} USDT${C.reset}`);
    lines.push(`   Threshold:   ${(pending.threshold || 1.2).toFixed(4)} USDT`);
    lines.push('');

    // Active Transactions Table
    if (rows.length === 0) {
        lines.push(`${C.dim}   No active transactions${C.reset}`);
        lines.push('');
    } else {
        const colWidths = {
            num: 4, stp: 4, mode: 6, pair: 14, market: 5,
            lastBuy: 10, current: 10, dropPct: 5,
            avgPriceUsdt: 10, sellPct: 5, sellTargUsdt: 10,
            totalQty: 10, upnl: 13
        };
        const keys = Object.keys(colWidths);
        const headerParts = ['Num', 'Stp', 'Mode', 'Pair', 'Mkt', 'LastBuy', 'Curr', 'D%', 'AvgUSDT', 'S%', 'TargUSDT', 'Qty', 'uPnL'];

        const makeSep = () => { let s = '+'; for (const k of keys) s += '-'.repeat(colWidths[k]) + '+'; return s; };
        const makeHeader = () => { let h = '|'; for (let i = 0; i < keys.length; i++) h += headerParts[i].padEnd(colWidths[keys[i]]) + '|'; return h; };

        const separator = makeSep();
        lines.push(`${C.cyan}${separator}${C.reset}`);
        lines.push(`${C.cyan}${makeHeader()}${C.reset}`);
        lines.push(`${C.cyan}${separator}${C.reset}`);

        let num = 1;
        let totalUpnl = 0;

        for (const row of rows) {
            const upnlStr = fmtUpnl(row.uPnl || 0, row.uPnlPct || 0);
            const upnlColored = (row.uPnl || 0) >= 0
                ? `${C.green}${cell(upnlStr, colWidths.upnl)}${C.reset}`
                : `${C.red}${cell(upnlStr, colWidths.upnl)}${C.reset}`;

            let line = '|';
            line += cell(num, colWidths.num) + '|';
            line += cell(row.step, colWidths.stp) + '|';
            line += cell(row.mode, colWidths.mode) + '|';
            line += cell(row.symbol, colWidths.pair) + '|';
            line += cell(row.buyMarket, colWidths.market) + '|';
            line += cell(fmtPrice(row.lastBuyPrice), colWidths.lastBuy) + '|';
            line += cell(fmtPrice(row.currentPrice), colWidths.current) + '|';
            line += cell((row.dropPct || 0).toFixed(2), colWidths.dropPct) + '|';
            line += cell(fmtPrice(row.avgUsdt), colWidths.avgPriceUsdt) + '|';
            line += cell(Number(row.sellPct || 0).toFixed(2), colWidths.sellPct) + '|';
            line += cell(fmtPrice(row.targetUsdt), colWidths.sellTargUsdt) + '|';
            line += cell(Number(row.totalQty || 0).toFixed(4), colWidths.totalQty) + '|';
            line += upnlColored + '|';
            lines.push(line);
            totalUpnl += row.uPnl || 0;
            num++;
        }

        lines.push(`${C.cyan}${separator}${C.reset}`);
        const totalSign = totalUpnl >= 0 ? '+' : '';
        const totalColor = totalUpnl >= 0 ? C.green : C.red;
        lines.push(`   Total unrealized PnL: ${totalColor}${totalSign}${totalUpnl.toFixed(4)} USDT${C.reset}`);
        lines.push('');
    }

    const dustKeys = Object.keys(status.dustBalances || {});
    if (dustKeys.length > 0) {
        lines.push(`${C.yellow}DUST LEDGER:${C.reset}`);
        for (const base of dustKeys) {
            lines.push(`   ${base}: ${(status.dustBalances[base] || 0).toFixed(8)}`);
        }
        lines.push('');
    }

    lines.push(`${C.cyan}${'='.repeat(72)}${C.reset}`);
    lines.push(`${C.dim}   Refreshing every 5 seconds... Press Ctrl+C to return to menu${C.reset}`);
    lines.push('');

    return lines;
}

// ============================================================
// NO-FLICKER RENDERER
// ============================================================
function renderNoFlicker(lines, isFirstRender) {
    const ESC = '\x1b';
    let out = '';
    if (isFirstRender) {
        out = `${ESC}[2J${ESC}[H${ESC}[?25l`;
    } else {
        out = `${ESC}[H`;
    }
    for (const line of lines) {
        out += line + `${ESC}[K\n`;
    }
    out += `${ESC}[J`;
    if (isFirstRender) out += `${ESC}[?25h`;
    process.stdout.write(out);
}

// ============================================================
// API Actions
// ============================================================
async function doLogin() {
    const rl = createRl();
    const email = await ask(rl, 'Email: ');
    const password = await ask(rl, 'Password: ', true);
    rl.close();

    try {
        const res = await httpRequest('POST', '/api/auth/login', { email, password });
        if (res.status === 200 && res.data.ok) {
            session.token = res.data.token;
            session.userId = res.data.userId;
            session.email = email;
            session.depositPaid = res.data.depositPaid;
            session.apiKeySet = res.data.apiKeySet || false;
            session.botLocked = res.data.botLocked || false;
            session.referralConfirmed = res.data.referralConfirmed || false;
            session.referralVerified = res.data.referralVerified || false;

            session.botRunning = false;
            try {
                const check = await httpRequest('GET', '/api/bot/status', null, session.token);
                if (check.data && check.data.running !== undefined) {
                    session.botRunning = check.data.running;
                    session.botLocked = check.data.locked || false;
                }
            } catch (e) {}

            console.log(C.green + '\n[OK] Login successful!\n' + C.reset);
            return true;
        } else {
            console.log(C.red + '\n[FAIL] Login failed: ' + (res.data.error || 'Unknown') + C.reset);
            return false;
        }
    } catch (e) {
        console.log(C.red + '\n[FAIL] Connection error: ' + e.message + C.reset);
        return false;
    }
}

async function doRegister() {
    // First show welcome with referral
    await showWelcomeWithReferral();

    const rl = createRl();
    const email = await ask(rl, 'Email: ');
    const password = await ask(rl, 'Password (min 8 chars): ', true);
    const password2 = await ask(rl, 'Confirm password: ', true);
    rl.close();

    if (password !== password2) {
        console.log(C.red + '\n[FAIL] Passwords do not match.\n' + C.reset);
        return false;
    }
    if (password.length < 8) {
        console.log(C.red + '\n[FAIL] Password must be at least 8 characters.\n' + C.reset);
        return false;
    }

    try {
        const res = await httpRequest('POST', '/api/auth/register', { email, password });
        if (res.status === 201 && res.data.ok) {
            session.token = res.data.token;
            session.userId = res.data.userId;
            session.email = email;
            session.apiKeySet = false;
            session.depositPaid = false;
            session.botLocked = true;
            session.referralConfirmed = false;

            console.log(C.green + '\n[OK] Registration successful!\n' + C.reset);

            // Confirm referral (optional)
            await doReferralConfirm();

            // Ask: TEST or REAL?
            clear();
            header();
            console.log('');
            console.log(C.cyan + '='.repeat(72) + C.reset);
            console.log(C.cyan + C.bright + '  CHOOSE MODE' + C.reset);
            console.log(C.cyan + '='.repeat(72) + C.reset);
            console.log('');
            console.log(C.white + '  Please choose how you want to start:' + C.reset);
            console.log('');
            console.log(C.green + C.bright + '  [1] TEST MODE (Recommended)' + C.reset);
            console.log(C.white + '      - Free, no deposit required' + C.reset);
            console.log(C.white + '      - 100 USDT virtual balance for testing' + C.reset);
            console.log(C.white + '      - No real trades' + C.reset);
            console.log('');
            console.log(C.yellow + C.bright + '  [2] REAL MODE' + C.reset);
            console.log(C.white + '      - Requires 2 USDT deposit' + C.reset);
            console.log(C.white + '      - Real trades with real money' + C.reset);
            console.log('');

            const rl3 = createRl();
            const modeChoice = await new Promise(resolve => rl3.question(
                C.cyan + '  Choose (1 or 2): ' + C.reset,
                resolve
            ));
            rl3.close();

            const isRealMode = (modeChoice.trim() === '2');

            if (isRealMode) {
                // REAL mode — require deposit
                await doDepositCharge();
                if (!session.depositInfo || session.depositInfo.botLocked) {
                    console.log(C.red + '  Deposit required for REAL mode.' + C.reset);
                    await pause();
                    return false;
                }
            } else {
                // TEST mode — no deposit
                console.log('');
                console.log(C.green + C.bright + '  [OK] TEST MODE selected!' + C.reset);
                console.log(C.white + '  You can start the bot without deposit.' + C.reset);
                console.log(C.white + '  Virtual balance: 100 USDT' + C.reset);
                console.log('');
                await pause();
            }

            // Ask for API key
            await doSetApiKeys();

            return true;
        } else {
            console.log(C.red + '\n[FAIL] Registration failed: ' + (res.data.error || 'Unknown') + C.reset);
            return false;
        }
    } catch (e) {
        console.log(C.red + '\n[FAIL] Connection error: ' + e.message + C.reset);
        return false;
    }
}

async function doSetApiKeys() {
    console.log('');
    console.log(C.cyan + '  Enter your Wallex API Key:' + C.reset);
    console.log(C.white + '  Get it from: https://wallex.ir -> Profile -> API' + C.reset);
    console.log(C.yellow + '  Enable: Spot Trading + Read Balance. DISABLE: Withdrawal' + C.reset);
    console.log('');

    const rl = createRl();
    const apiKey = await ask(rl, 'API Key: ');
    rl.close();

    if (!apiKey || apiKey.length < 10) {
        console.log(C.red + '\n[FAIL] Invalid API key.\n' + C.reset);
        return false;
    }

    try {
        const res = await httpRequest('POST', '/api/auth/set-api-keys', { apiKey }, session.token);
        if (res.data.ok) {
            console.log(C.green + '\n[OK] API key saved securely.\n' + C.reset);
            session.apiKeySet = true;
            return true;
        } else {
            console.log(C.red + '\n[FAIL] ' + (res.data.error || res.data.message) + C.reset);
            return false;
        }
    } catch (e) {
        console.log(C.red + '\n[FAIL] Error: ' + e.message + C.reset);
        return false;
    }
}

async function doStartBot() {
    try {
        console.log(C.cyan + '\nStarting bot on server...\n' + C.reset);
        const res = await httpRequest('POST', '/api/bot/start', null, session.token);
        if (res.data.ok) {
            console.log(C.green + '[OK] ' + (res.data.message || 'Bot started.') + '\n' + C.reset);
            session.botRunning = true;
            return true;
        } else {
            console.log(C.red + '\n[FAIL] ' + (res.data.error || res.data.message) + C.reset);
            if (res.data.nextStep === 'deposit') {
                console.log(C.yellow + '\n[INFO] Please recharge your deposit to continue.\n' + C.reset);
            }
            return false;
        }
    } catch (e) {
        console.log(C.red + '\n[FAIL] Error: ' + e.message + C.reset);
        return false;
    }
}

async function doStopBot() {
    try {
        const res = await httpRequest('POST', '/api/bot/stop', null, session.token);
        if (res.data.ok) {
            console.log(C.yellow + '\n[STOP] ' + (res.data.message || 'Bot stopped.') + '\n' + C.reset);
            session.botRunning = false;
            return true;
        }
    } catch (e) {
        console.log(C.red + '\n[FAIL] Error: ' + e.message + C.reset);
        return false;
    }
}

async function showTrades() {
    try {
        const res = await httpRequest('GET', '/api/user/trades?limit=20', null, session.token);
        if (!res.data.trades || res.data.trades.length === 0) {
            console.log(C.yellow + '\n  No trades yet.\n' + C.reset);
            return;
        }
        console.log('');
        console.log(C.cyan + '  Recent trades:' + C.reset);
        console.log(C.white + '  ' + '-'.repeat(72) + C.reset);
        console.log(C.cyan + `  ${'Symbol'.padEnd(14)} ${'Profit'.padEnd(12)} ${'Your Keep'.padEnd(14)} ${'Time'.padEnd(20)}` + C.reset);
        console.log(C.white + '  ' + '-'.repeat(72) + C.reset);
        for (const t of res.data.trades) {
            const time = new Date(t.timestamp).toISOString().replace('T', ' ').substring(0, 19);
            console.log(
                '  ' +
                C.white + String(t.symbol).padEnd(14) + C.reset +
                C.green + String(t.profit.toFixed(4)).padEnd(12) + C.reset +
                C.green + C.bright + String(t.userKeeps.toFixed(4)).padEnd(14) + C.reset +
                C.dim + time + C.reset
            );
        }
        console.log(C.white + '  ' + '-'.repeat(72) + C.reset);
        console.log('');
    } catch (e) {
        console.log(C.red + '\n[FAIL] Error: ' + e.message + C.reset);
    }
}

// ============================================================
// LIVE DASHBOARD
// ============================================================
async function runLiveDashboard() {
    return new Promise(async (resolve) => {
        let running = true;
        let isFirstRender = true;

        const onSigint = () => { running = false; };
        process.on('SIGINT', onSigint);

        while (running) {
            try {
                const res = await httpRequest('GET', '/api/user/status', null, session.token);
                if (res.status === 200 && res.data.ok) {
                    // Update session state
                    session.botLocked = res.data.user.botLocked || res.data.lockedByDeposit;
                    if (res.data.deposit) session.depositInfo = res.data.deposit;

                    const lines = buildDashboardLines(res.data);
                    renderNoFlicker(lines, isFirstRender);
                    isFirstRender = false;

                    // If locked, exit dashboard
                    if (session.botLocked) {
                        running = false;
                    }
                } else {
                    if (isFirstRender) {
                        clear();
                        console.log(C.red + '\n[FAIL] Cannot fetch status.\n' + C.reset);
                    }
                }
            } catch (e) {
                if (isFirstRender) {
                    clear();
                    console.log(C.red + 'Error: ' + e.message + C.reset);
                }
            }
            for (let i = 0; i < 50 && running; i++) {
                await new Promise(r => setTimeout(r, 100));
            }
        }

        process.stdout.write('\x1b[?25h');
        process.removeListener('SIGINT', onSigint);

                if (session.botLocked) {
            clear();
            console.log('');
            console.log(C.bgRed + C.white + C.bright + '  [!] DEPOSIT EXHAUSTED - BOT LOCKED  ' + C.reset);
            console.log('');
            console.log(C.yellow + '  Bot stopped. Please recharge your deposit.' + C.reset);
            console.log(C.yellow + '  From main menu, choose "Deposit Recharge".' + C.reset);
            console.log('');
            await pause();
        } else {
            clear();
            console.log(C.yellow + '\nExited live dashboard.\n' + C.reset);
            await new Promise(r => setTimeout(r, 800));
        }
        resolve();
    });
}

// ============================================================
// SETTINGS MENU
// ============================================================
async function runSettingsMenu() {
    let settings;
    try {
        const res = await httpRequest('GET', '/api/bot/settings', null, session.token);
        if (!res.data.ok) {
            console.log(C.red + '\n[FAIL] ' + (res.data.error || 'Cannot load settings') + C.reset);
            await pause();
            return;
        }
        settings = res.data.settings;
    } catch (e) {
        console.log(C.red + '\n[FAIL] Cannot load settings: ' + e.message + C.reset);
        await pause();
        return;
    }

    if (settings.executionMode === 'REAL') {
        console.log('');
        console.log(C.red + C.bright + '  WARNING: Bot is running in REAL mode!' + C.reset);
        await new Promise(r => setTimeout(r, 2000));
    }

    while (true) {
        clear();
        header();
        console.log(C.cyan + C.bright + '  BOT SETTINGS' + C.reset);
        console.log('');
        console.log(C.white + `  Current values:` + C.reset);
        console.log(`    1.  Max concurrent transactions:  ${C.yellow}${settings.maxConcurrent}${C.reset}`);
        console.log(`    2.  Number of steps:              ${C.yellow}${settings.maxSteps}${C.reset}`);
        console.log(`    3.  Adaptive Mode:                ${settings.adaptiveMode ? C.green + 'ON' : C.dim + 'OFF'}${C.reset}`);
        console.log(`    4.  Execution Mode:               ${settings.executionMode === 'REAL' ? C.red + 'REAL' : C.green + 'TEST'}${C.reset}`);
        console.log(`    5.  Complete Only Mode:           ${settings.completeOnlyMode ? C.green + 'ON' : C.dim + 'OFF'}${C.reset}`);
        console.log(`    6.  Pair Selection Mode:          ${C.yellow}${settings.selectionMode}${C.reset}${settings.selectionMode === 'MANUAL' ? ` (${settings.manualPairs.length} pairs)` : ''}`);
        console.log(`    7.  Jump Buy Mode:                ${C.yellow}${settings.jumpBuyMode}${C.reset}`);
        console.log(`    8.  Max Trade Capital:            ${C.yellow}${settings.maxTradeCapital} USDT${C.reset}`);
        console.log(`    9.  Min Gross Profit USDT->USDT:  ${C.yellow}${settings.minGrossUsdtToUsdt}%${C.reset}`);
        console.log(`   10.  Min Gross Profit TMN->TMN:    ${C.yellow}${settings.minGrossTmnToTmn}%${C.reset}`);
        console.log(`   11.  Min Gross Profit Cross:       ${C.yellow}${settings.minGrossCrossMarket}%${C.reset}`);
        console.log(`   12.  Debug Logging:                ${settings.verboseLogging ? C.green + 'ON' : C.dim + 'OFF'}${C.reset}`);
        console.log(`   13.  Cooldown Time:                ${C.yellow}${settings.cooldownSeconds} sec${C.reset}`);
        console.log('');

        const options = [
            'Max concurrent transactions',
            'Number of steps',
            'Toggle Adaptive Mode',
            'Switch Execution Mode (TEST/REAL)',
            'Toggle Complete Only Mode',
            'Change Pair Selection Mode',
            'Change Jump Buy Mode',
            'Max Trade Capital',
            'Min Gross Profit USDT->USDT',
            'Min Gross Profit TMN->TMN',
            'Min Gross Profit Cross-Market',
            'Toggle Debug Logging',
            'Cooldown Time',
            'Return to Menu',
            'Cancel (discard changes)'
        ];

        const idx = await choose('Choose setting to change:', options);
        let updateBody = null;

        try {
            switch (idx) {
                case 0: {
                    const rl = createRl();
                    const v = await ask(rl, `Enter new max concurrent (1-20) [${settings.maxConcurrent}]: `);
                    rl.close();
                    if (v) {
                        const n = parseInt(v);
                        if (n >= 1 && n <= 20) updateBody = { maxConcurrent: n };
                        else { console.log(C.red + 'Invalid.' + C.reset); await pause(); }
                    }
                    break;
                }
                case 1: {
                    const rl = createRl();
                    const v = await ask(rl, `Enter new number of steps (1-25) [${settings.maxSteps}]: `);
                    rl.close();
                    if (v) {
                        const n = parseInt(v);
                        if (n >= 1 && n <= 25) updateBody = { maxSteps: n };
                        else { console.log(C.red + 'Invalid.' + C.reset); await pause(); }
                    }
                    break;
                }
                case 2: updateBody = { adaptiveMode: !settings.adaptiveMode }; break;
                case 3: {
                    const newMode = settings.executionMode === 'REAL' ? 'TEST' : 'REAL';
                    console.log('');
                    console.log(C.yellow + `  Switch to ${newMode} mode?` + C.reset);
                    if (newMode === 'REAL') console.log(C.red + C.bright + '  WARNING: REAL mode uses real money!' + C.reset);
                    const rl = createRl();
                    const confirm = await ask(rl, 'Confirm (yes/no): ');
                    rl.close();
                    if (confirm.toLowerCase() === 'yes' || confirm.toLowerCase() === 'y') updateBody = { executionMode: newMode };
                    break;
                }
                case 4: updateBody = { completeOnlyMode: !settings.completeOnlyMode }; break;
                case 5: {
                    const newMode = settings.selectionMode === 'AUTO' ? 'MANUAL' : 'AUTO';
                    if (newMode === 'MANUAL') {
                        console.log('');
                        console.log(C.cyan + '  Enter trading pairs (comma separated):' + C.reset);
                        const rl = createRl();
                        const input = await ask(rl, '  Pairs: ');
                        rl.close();
                        const pairs = input.split(',').map(p => p.trim().toUpperCase()).filter(p => p.endsWith('USDT') || p.endsWith('TMN'));
                        if (pairs.length > 0) updateBody = { selectionMode: 'MANUAL', manualPairs: pairs };
                        else { console.log(C.red + '  No valid pairs.' + C.reset); await pause(); }
                    } else {
                        updateBody = { selectionMode: 'AUTO', manualPairs: [] };
                    }
                    break;
                }
                case 6: {
                    const newMode = settings.jumpBuyMode === 'SINGLE' ? 'CUMULATIVE' : 'SINGLE';
                    updateBody = { jumpBuyMode: newMode };
                    break;
                }
                case 7: {
                    const rl = createRl();
                    const v = await ask(rl, `Enter max trade capital USDT (0.5-100) [${settings.maxTradeCapital}]: `);
                    rl.close();
                    if (v) {
                        const n = parseFloat(v);
                        if (n >= 0.5 && n <= 100) updateBody = { maxTradeCapital: n };
                        else { console.log(C.red + 'Invalid.' + C.reset); await pause(); }
                    }
                    break;
                }
                case 8: case 9: case 10:
                    console.log(C.yellow + '\n  These thresholds are hard-coded.' + C.reset);
                    await pause();
                    break;
                case 11: updateBody = { verboseLogging: !settings.verboseLogging }; break;
                case 12: {
                    const rl = createRl();
                    const v = await ask(rl, `Enter cooldown seconds (60-3600) [${settings.cooldownSeconds}]: `);
                    rl.close();
                    if (v) {
                        const n = parseInt(v);
                        if (n >= 60 && n <= 3600) updateBody = { cooldownSeconds: n };
                        else { console.log(C.red + 'Invalid.' + C.reset); await pause(); }
                    }
                    break;
                }
                case 13: return;
                case 14:
                    console.log(C.yellow + '\n  Cancelled.\n' + C.reset);
                    await pause();
                    return;
            }

            if (updateBody) {
                const res = await httpRequest('POST', '/api/bot/settings', updateBody, session.token);
                if (res.data.ok) {
                    console.log(C.green + '\n[OK] Setting updated.' + C.reset);
                    const reload = await httpRequest('GET', '/api/bot/settings', null, session.token);
                    if (reload.data.ok) settings = reload.data.settings;
                    await new Promise(r => setTimeout(r, 1200));
                } else {
                    console.log(C.red + '\n[FAIL] ' + (res.data.error || 'Failed') + C.reset);
                    await pause();
                }
            }
        } catch (e) {
            console.log(C.red + '\n[FAIL] ' + e.message + C.reset);
            await pause();
        }
    }
}

// ============================================================
// MAIN MENU
// ============================================================
// ============================================================
// MAIN MENU
// ============================================================
async function mainMenu() {
    while (true) {
        clear();
        header();
        console.log(C.white + '  Logged in as: ' + C.reset + C.bright + C.cyan + session.email + C.reset);
        console.log(C.white + '  Bot status:   ' + C.reset + (session.botRunning ? C.green + 'RUNNING' + C.reset : C.dim + 'STOPPED' + C.reset));
        console.log(C.white + '  Deposit:      ' + C.reset + (session.depositPaid ? C.green + 'PAID' + C.reset : C.yellow + 'PENDING' + C.reset));
        console.log(C.white + '  API Key:      ' + C.reset + (session.apiKeySet ? C.green + 'SET' + C.reset : C.yellow + 'NOT SET' + C.reset));

        // ⭐ Fetch current mode + deposit info FIRST
        let currentMode = 'TEST';
        let depositBalance = 0;
        try {
            const statusRes = await httpRequest('GET', '/api/user/status', null, session.token);
            if (statusRes.data && statusRes.data.ok) {
                currentMode = statusRes.data.mode || 'TEST';
                if (statusRes.data.deposit) {
                    session.depositInfo = statusRes.data.deposit;
                    depositBalance = statusRes.data.deposit.balance || 0;
                }
                session.botLocked = statusRes.data.user.botLocked || statusRes.data.lockedByDeposit || false;
            }
        } catch (e) {}

        // ⭐ Define isTestMode + hasDeposit AFTER fetching
        const isTestMode = currentMode === 'TEST';
        const hasDeposit = depositBalance >= 2;

        if (session.botLocked && !isTestMode) {
            console.log(C.red + C.bright + '  [!] BOT LOCKED - DEPOSIT EXHAUSTED' + C.reset);
        } else if (isTestMode) {
            console.log(C.green + C.bright + '  [TEST MODE] - No deposit required' + C.reset);
        }
        console.log('');

        // Show deposit box only if NOT in TEST mode
        if (!isTestMode) {
            renderDepositBox(session.depositInfo, session.referralInfo?.walletAddress);
        }

        // ⭐ Build menu options
        const options = [];
        const actions = [];

        // START BOT — always available in TEST mode, requires deposit in REAL mode
        if (session.apiKeySet && !session.botRunning) {
            if (isTestMode) {
                options.push('START BOT (TEST MODE - Free)');
                actions.push('start');
            } else if (hasDeposit && !session.botLocked) {
                options.push('START BOT (REAL MODE)');
                actions.push('start');
            } else {
                options.push('[LOCKED] Deposit required for REAL mode');
                actions.push('depositCharge');
            }
        }

        // If bot is running, show dashboard/stop
        if (session.botRunning) {
            options.push('OPEN LIVE DASHBOARD');
            actions.push('dashboard');
            options.push('STOP BOT');
            actions.push('stop');
        }

        // API Key
        if (!session.apiKeySet) {
            options.push('Set API Key');
            actions.push('apikeys');
        } else {
            options.push('Update API Key');
            actions.push('apikeys');
        }

        // Deposit options — only in REAL mode
        if (!isTestMode) {
            options.push('Deposit Recharge');
            actions.push('depositCharge');
            options.push('Deposit History');
            actions.push('depositHistory');
        }

        // Always available
        options.push('Show recent trades');
        actions.push('trades');
        options.push('Bot Settings');
        actions.push('settings');
        options.push('Logout');
        actions.push('logout');

        const idx = await choose('What would you like to do?', options);
        const action = actions[idx];

        switch (action) {
            case 'depositCharge':
                await doDepositCharge();
                break;
            case 'depositHistory':
                await showDepositHistory();
                break;
            case 'apikeys':
                await doSetApiKeys();
                await pause();
                break;
            case 'start': {
                const started = await doStartBot();
                if (started) {
                    console.log(C.green + '\nOpening live dashboard in 2 seconds...\n' + C.reset);
                    await new Promise(r => setTimeout(r, 2000));
                    await runLiveDashboard();
                } else {
                    await pause();
                }
                break;
            }
            case 'dashboard':
                await runLiveDashboard();
                break;
            case 'stop':
                await doStopBot();
                await pause();
                break;
            case 'trades':
                await showTrades();
                await pause();
                break;
            case 'settings':
                await runSettingsMenu();
                break;
            case 'logout':
                session = {
                    token: null, userId: null, email: null,
                    depositPaid: false, botRunning: false, botLocked: false,
                    apiKeySet: false, referralConfirmed: false,
                    referralVerified: false, referralInfo: null, depositInfo: null
                };
                return;
        }
    }
}

// ============================================================
// ENTRY
// ============================================================
async function main() {
    clear();
    header();

    let connected = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
        try {
            const res = await httpRequest('GET', '/health');
            if (res.status === 200 && res.data.ok) {
                connected = true;
                console.log(C.green + '  [OK] Connected to server (' + config.serverUrl + ')\n' + C.reset);
                break;
            }
        } catch (e) {
            process.stdout.write(`\r  ${C.dim}Waiting for server... (${attempt}/10)${C.reset}`);
            await new Promise(r => setTimeout(r, 1500));
        }
    }

    if (!connected) {
        console.log(C.red + '\n  [FAIL] Cannot connect to server: ' + config.serverUrl + '\n' + C.reset);
        await pause('Press Enter to exit...');
        process.exit(1);
    }

    while (true) {
        const idx = await choose('Welcome! Please choose:', [
            'Login',
            'Register (new account)',
            'Exit'
        ]);

        if (idx === 2) {
            console.log(C.cyan + '\n  Goodbye!\n' + C.reset);
            process.exit(0);
        }

        let success = false;
        if (idx === 0) success = await doLogin();
        else if (idx === 1) success = await doRegister();

        if (success) {
            if (session.botLocked) {
                // Bot locked - stay in main menu
                await mainMenu();
            } else if (session.botRunning) {
                console.log(C.green + '\n[OK] Bot is running. Opening live dashboard...\n' + C.reset);
                await new Promise(r => setTimeout(r, 1500));
                await runLiveDashboard();
                if (!session.botLocked) {
                    await mainMenu();
                }
            } else {
                await mainMenu();
            }
        }

        await new Promise(r => setTimeout(r, 1200));
    }
}

main().catch(err => {
    console.error(C.red + 'Fatal error: ' + err.message + C.reset);
    process.exit(1);
});