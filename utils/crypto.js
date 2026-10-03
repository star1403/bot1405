// utils/crypto.js - Hardened encryption & JWT (Node built-in crypto only)

const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '';
const JWT_SECRET     = process.env.JWT_SECRET || '';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters');
}
if (!JWT_SECRET || JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
}

function getAesKey() {
    return crypto.createHash('sha256').update(ENCRYPTION_KEY).digest();
}

function encryptApiKey(plaintext) {
    if (!plaintext) return null;
    try {
        const key = getAesKey();
        const iv  = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        const encrypted = Buffer.concat([
            cipher.update(plaintext, 'utf8'),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();
        return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        console.error('Encryption failed:', e.message);
        return null;
    }
}

function decryptApiKey(ciphertext) {
    if (!ciphertext) return null;
    try {
        const parts = ciphertext.split(':');
        if (parts.length !== 3) return null;
        const key = getAesKey();
        const iv  = Buffer.from(parts[0], 'hex');
        const tag = Buffer.from(parts[1], 'hex');
        const encrypted = Buffer.from(parts[2], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        const decrypted = Buffer.concat([
            decipher.update(encrypted),
            decipher.final()
        ]);
        return decrypted.toString('utf8');
    } catch (e) {
        return null;
    }
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    try {
        const [salt, hash] = stored.split(':');
        const testHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
        return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(testHash, 'hex'));
    } catch (e) {
        return false;
    }
}

function base64url(buf) {
    return Buffer.from(buf).toString('base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64').toString('utf8');
}

function parseExpiry(exp) {
    const match = String(exp).match(/^(\d+)([smhd])$/);
    if (!match) return 7 * 24 * 3600;
    const n = parseInt(match[1], 10);
    const mult = { s: 1, m: 60, h: 3600, d: 86400 };
    return n * (mult[match[2]] || 86400);
}

function generateToken(userId, email) {
    const header  = { alg: 'HS256', typ: 'JWT' };
    const now     = Math.floor(Date.now() / 1000);
    const payload = {
        userId,
        email,
        iat: now,
        exp: now + parseExpiry(JWT_EXPIRES_IN),
        jti: crypto.randomBytes(8).toString('hex')
    };
    const h = base64url(JSON.stringify(header));
    const p = base64url(JSON.stringify(payload));
    const data = `${h}.${p}`;
    const sig = crypto.createHmac('sha256', JWT_SECRET).update(data).digest();
    return `${data}.${base64url(sig)}`;
}

function verifyToken(token) {
    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;
        const [h, p, s] = parts;
        const data = `${h}.${p}`;
        const expectedSig = base64url(
            crypto.createHmac('sha256', JWT_SECRET).update(data).digest()
        );
        if (expectedSig.length !== s.length ||
            !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(s))) {
            return null;
        }
        const payload = JSON.parse(base64urlDecode(p));
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        return null;
    }
}

module.exports = {
    encryptApiKey, decryptApiKey,
    hashPassword, verifyPassword,
    generateToken, verifyToken
};
