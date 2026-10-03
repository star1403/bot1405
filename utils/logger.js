// utils/logger.js
// Zero-dependency logger with ANSI colors + sensitive data redaction

const fs = require('fs');
const path = require('path');

const LOG_LEVEL   = process.env.LOG_LEVEL || 'info';
const LOG_TO_FILE = process.env.LOG_TO_FILE === 'true';
const LOG_DIR     = path.join(__dirname, '..', 'logs');

if (LOG_TO_FILE && !fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}

const C = {
    reset:  '\x1b[0m',
    bright: '\x1b[1m',
    dim:    '\x1b[2m',
    red:    '\x1b[91m',
    green:  '\x1b[92m',
    yellow: '\x1b[93m',
    blue:   '\x1b[94m',
    cyan:   '\x1b[96m',
    white:  '\x1b[97m',
    gold:   '\x1b[38;5;220m',
    orange: '\x1b[38;5;208m'
};

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3, success: 4, profit: 5 };
const NAMES  = { debug: 'DEBUG', info: 'INFO ', warn: 'WARN ', error: 'ERROR', success: 'OK   ', profit: 'PROFIT' };
const COLORS = {
    debug: C.dim, info: C.cyan, warn: C.yellow, error: C.red,
    success: C.green, profit: C.gold
};

// Redact sensitive fields before logging
const SENSITIVE_KEYS = [
    'apikey', 'api_key', 'apisecret', 'api_secret', 'password', 'token',
    'secret', 'privatekey', 'private_key', 'authorization', 'jwt', 'encryption_key'
];

function redact(value) {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') {
        // if it looks like a long key/token, mask it
        if (value.length > 20 && /^[a-zA-Z0-9+/=_-]+$/.test(value)) {
            return value.substring(0, 6) + '***REDACTED***';
        }
        return value;
    }
    if (typeof value !== 'object') return value;

    if (Array.isArray(value)) return value.map(redact);

    const copy = {};
    for (const [k, v] of Object.entries(value)) {
        const lower = k.toLowerCase();
        if (SENSITIVE_KEYS.some(s => lower.includes(s))) {
            copy[k] = '***REDACTED***';
        } else {
            copy[k] = redact(v);
        }
    }
    return copy;
}

function log(level, message, data = null) {
    if ((LEVELS[level] ?? 99) < (LEVELS[LOG_LEVEL] ?? 1)) return;

    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const name  = NAMES[level] || level.toUpperCase();
    const color = COLORS[level] || C.white;

    let output = `${C.dim}[${timestamp}]${C.reset} ${color}[${name}]${C.reset} ${message}`;
    if (data !== null && data !== undefined) {
        const safe = redact(data);
        if (typeof safe === 'object') {
            output += '\n' + color + JSON.stringify(safe, null, 2) + C.reset;
        } else {
            output += ' ' + safe;
        }
    }
    console.log(output);

    if (LOG_TO_FILE) {
        try {
            const plain = `[${timestamp}] [${name.trim()}] ${message}` +
                (data ? ' ' + (typeof data === 'object' ? JSON.stringify(redact(data)) : data) : '');
            const logFile = path.join(LOG_DIR, `smartchef-${new Date().toISOString().slice(0, 10)}.log`);
            fs.appendFileSync(logFile, plain + '\n');
        } catch (e) { /* ignore file write errors */ }
    }
}

const logger = {
    debug:   (m, d) => log('debug',   m, d),
    info:    (m, d) => log('info',    m, d),
    warn:    (m, d) => log('warn',    m, d),
    error:   (m, d) => log('error',   m, d),
    success: (m, d) => log('success', m, d),
    profit:  (m, d) => log('profit',  m, d),

    showShare: (amount, symbol = 'USDT') => {
        console.log(`${C.gold}${C.bright}  Share to creator: ${Number(amount).toFixed(4)} ${symbol}${C.reset}`);
    },
    showUserProfit: (amount, symbol = 'USDT') => {
        console.log(`${C.green}  User profit: ${Number(amount).toFixed(4)} ${symbol}${C.reset}`);
    },
    separator: () => console.log(`${C.cyan}${'-'.repeat(60)}${C.reset}`)
};

module.exports = logger;
