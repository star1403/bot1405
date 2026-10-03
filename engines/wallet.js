// engines/wallet.js - Hardened deposit verification (TRC20 USDT)
// Zero-dependency (uses built-in fetch)

const logger = require('../utils/logger');

const CREATOR_WALLET   = process.env.CREATOR_USDT_WALLET || '';
const TRONGRID_API_KEY = process.env.TRONGRID_API_KEY || '';
const USDT_CONTRACT    = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // official USDT TRC20
const TRONGRID_BASE    = 'https://api.trongrid.io';

function headers() {
    const h = { 'Content-Type': 'application/json' };
    if (TRONGRID_API_KEY) h['TRON-PRO-API-KEY'] = TRONGRID_API_KEY;
    return h;
}

/**
 * Convert 20-byte hex address (from TRC20 transfer data) to base58 TRON address
 * Simple implementation without external libs.
 */
function hexAddressToBase58(hex20) {
    try {
        // TRON address = 0x41 + 20-byte address, then base58check
        const addrHex = '41' + hex20.toLowerCase().replace(/^0x/, '');
        const addrBuf = Buffer.from(addrHex, 'hex');
        const hash1 = require('crypto').createHash('sha256').update(addrBuf).digest();
        const hash2 = require('crypto').createHash('sha256').update(hash1).digest();
        const checksum = hash2.slice(0, 4);
        const full = Buffer.concat([addrBuf, checksum]);
        return base58Encode(full);
    } catch (e) {
        return null;
    }
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58Encode(buffer) {
    let num = BigInt('0x' + buffer.toString('hex'));
    let encoded = '';
    while (num > 0n) {
        const rem = Number(num % 58n);
        num = num / 58n;
        encoded = BASE58_ALPHABET[rem] + encoded;
    }
    // leading zeros
    for (let i = 0; i < buffer.length && buffer[i] === 0; i++) {
        encoded = '1' + encoded;
    }
    return encoded;
}

// ============================================================
// VERIFY DEPOSIT — hardened
// ============================================================
async function verifyDeposit(txHash, expectedAmount) {
    // ---------- TEST MODE ----------
    if (process.env.MODE === 'TEST') {
        logger.info(`[TEST MODE] Deposit auto-confirmed (skipping TronGrid)`, {
            txHash: (txHash || '').substring(0, 12) + '...',
            amount: expectedAmount
        });
        return {
            ok: true,
            amount: expectedAmount,
            from: 'TEST_MODE',
            to: CREATOR_WALLET,
            confirmed: true,
            testMode: true
        };
    }

    // ---------- REAL MODE ----------
    if (!CREATOR_WALLET) {
        return { ok: false, error: 'CREATOR_USDT_WALLET not configured' };
    }
    if (!txHash || typeof txHash !== 'string' || txHash.length < 40) {
        return { ok: false, error: 'Invalid txHash' };
    }

    try {
        const url = `${TRONGRID_BASE}/v1/transactions/${txHash}/info`;
        // also try the plain transactions endpoint as fallback
        let res = await fetch(`${TRONGRID_BASE}/v1/transactions/${txHash}`, { headers: headers() });

        if (res.status === 404) {
            return { ok: false, error: 'Transaction not found on TronGrid' };
        }
        if (!res.ok) {
            return { ok: false, error: `TronGrid HTTP ${res.status}` };
        }

        const json = await res.json();
        if (!json.data || json.data.length === 0) {
            return { ok: false, error: 'Transaction not found' };
        }

        const tx = json.data[0];
        const contract = tx.raw_data?.contract?.[0];
        if (!contract || contract.type !== 'TriggerSmartContract') {
            return { ok: false, error: 'Not a TRC20 smart-contract transaction' };
        }

        const value = contract.parameter?.value || {};
        const contractAddress = value.contract_address;

        // Check it is the official USDT contract
        // TronGrid sometimes returns hex, sometimes base58 — normalize
        const usdtHex = '41a614f803b6fd780986a42c78ec9c7f77e6ded13c'; // TR7NHqje... in hex
        if (contractAddress && !contractAddress.toLowerCase().includes('a614f803b6fd780986a42c78ec9c7f77e6ded13c')) {
            // allow base58 form too
            if (contractAddress !== USDT_CONTRACT) {
                return { ok: false, error: 'Not USDT TRC20 contract' };
            }
        }

        const data = value.data || '';
        if (!data || data.length < 136) {
            return { ok: false, error: 'Invalid transfer data' };
        }

        // TRC20 transfer(address,uint256) selector = a9059cbb
        const method = data.substring(0, 8).toLowerCase();
        if (method !== 'a9059cbb') {
            return { ok: false, error: 'Not a transfer method' };
        }

        // recipient address (32 bytes padded) → last 20 bytes
        const toHex = data.substring(32, 72); // 40 hex chars = 20 bytes
        const toAddress = hexAddressToBase58(toHex);

        if (!toAddress || toAddress !== CREATOR_WALLET) {
            logger.warn('Deposit to wrong address', {
                expected: CREATOR_WALLET,
                got: toAddress || 'decode_failed'
            });
            return { ok: false, error: 'Transfer was not sent to the official deposit wallet' };
        }

        // amount (next 32 bytes)
        const amountHex = data.substring(72, 136);
        const amount = parseInt(amountHex, 16) / 1_000_000; // USDT has 6 decimals

        if (isNaN(amount) || amount < expectedAmount * 0.99) {
            return {
                ok: false,
                error: 'Amount too low',
                got: amount,
                expected: expectedAmount
            };
        }

        // Confirmations
        const blockNumber = tx.blockNumber || 0;
        let confirmed = false;
        let confirmations = 0;
        if (blockNumber > 0) {
            try {
                const nowRes = await fetch(`${TRONGRID_BASE}/wallet/getnowblock`, { headers: headers() });
                const nowJson = await nowRes.json();
                const currentBlock = nowJson.block_header?.raw_data?.number || 0;
                confirmations = currentBlock - blockNumber;
                confirmed = confirmations >= 19; // ~1 minute on TRON
            } catch (e) {
                // if we cannot get current block, still accept if tx exists and amount is correct
                // but mark as unconfirmed so caller can ask user to wait
                confirmed = false;
            }
        }

        return {
            ok: true,
            amount,
            from: 'unknown',
            to: toAddress,
            blockNumber,
            confirmed,
            confirmations
        };
    } catch (e) {
        logger.error('verifyDeposit error', { error: e.message });
        return { ok: false, error: e.message };
    }
}

// ============================================================
// GET CREATOR BALANCE
// ============================================================
async function getCreatorUSDTBalance() {
    if (process.env.MODE === 'TEST') return 0;
    if (!CREATOR_WALLET) return 0;
    try {
        const url = `${TRONGRID_BASE}/v1/accounts/${CREATOR_WALLET}`;
        const res = await fetch(url, { headers: headers() });
        const json = await res.json();
        if (!json.data || json.data.length === 0) return 0;
        const acc = json.data[0];
        for (const tok of acc.trc20 || []) {
            if (tok[USDT_CONTRACT]) return parseFloat(tok[USDT_CONTRACT]) / 1_000_000;
        }
        return 0;
    } catch (e) {
        return 0;
    }
}

// ============================================================
// SEND USDT — intentionally NOT automatic (security)
// ============================================================
async function sendUSDT(toAddress, amount) {
    if (process.env.MODE === 'TEST') {
        logger.info(`[TEST MODE] Would transfer ${amount} USDT to ${toAddress}`);
        return {
            ok: true,
            txHash: 'TEST_TX_' + Date.now(),
            amount,
            to: toAddress,
            testMode: true
        };
    }

    // We deliberately do NOT keep a private key on the server.
    // Automatic transfer is disabled for security.
    logger.warn('Automatic USDT transfer is disabled for security. Manual transfer required.');
    return {
        ok: false,
        error: 'Auto-transfer disabled. Please transfer manually from your wallet.',
        needsManual: true,
        amount,
        toAddress
    };
}

module.exports = {
    verifyDeposit,
    sendUSDT,
    getCreatorUSDTBalance,
    CREATOR_WALLET,
    USDT_CONTRACT
};
