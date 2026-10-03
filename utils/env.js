// utils/env.js
// Zero-dependency .env loader + STRICT validation for REAL mode safety

const fs = require('fs');
const path = require('path');

function loadEnv() {
    const envPath = path.join(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        console.warn('[WARN] .env file not found — using process.env only');
        return;
    }
    const content = fs.readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let val = trimmed.slice(eq + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
    }
}

loadEnv();

// ============================================================
// STRICT VALIDATION — crash if critical secrets are missing/weak
// ============================================================
const MODE = (process.env.MODE || 'TEST').toUpperCase();
process.env.MODE = MODE;

if (!['TEST', 'REAL'].includes(MODE)) {
    console.error('[FATAL] MODE must be either TEST or REAL. Got:', process.env.MODE);
    process.exit(1);
}

const REQUIRED_ALWAYS = [
    { key: 'ENCRYPTION_KEY', minLen: 32, desc: 'AES encryption key for API keys' },
    { key: 'JWT_SECRET',     minLen: 32, desc: 'JWT signing secret' },
];

const REQUIRED_REAL = [
    { key: 'CREATOR_USDT_WALLET', minLen: 30, desc: 'Your TRC20 USDT wallet address' },
];

function checkRequired(list) {
    const missing = [];
    for (const item of list) {
        const val = process.env[item.key];
        if (!val || val.length < item.minLen) {
            missing.push(`${item.key} (min ${item.minLen} chars) — ${item.desc}`);
        }
    }
    return missing;
}

const alwaysMissing = checkRequired(REQUIRED_ALWAYS);
if (alwaysMissing.length > 0) {
    console.error('[FATAL] Missing or too-short required environment variables:');
    alwaysMissing.forEach(m => console.error('  -', m));
    console.error('\nGenerate strong secrets with:');
    console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

if (MODE === 'REAL') {
    const realMissing = checkRequired(REQUIRED_REAL);
    if (realMissing.length > 0) {
        console.error('[FATAL] REAL mode requires these extra variables:');
        realMissing.forEach(m => console.error('  -', m));
        process.exit(1);
    }
    // Extra safety: warn if wallet looks like test address
    const wallet = process.env.CREATOR_USDT_WALLET || '';
    if (!wallet.startsWith('T') || wallet.length < 34) {
        console.error('[FATAL] CREATOR_USDT_WALLET does not look like a valid TRON address');
        process.exit(1);
    }
}

console.log(`[ENV] Mode: ${MODE} | Encryption & JWT secrets OK`);

module.exports = process.env;
