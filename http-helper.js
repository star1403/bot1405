// http-helper.js
// Zero-dependency HTTP helpers (hardened)

const http = require('http');

// ---------- Body parser ----------
function parseBody(req) {
    return new Promise((resolve) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 1_000_000) { // 1MB limit
                req.destroy();
                resolve(null);
            }
        });
        req.on('end', () => {
            if (!data) return resolve({});
            try { resolve(JSON.parse(data)); }
            catch { resolve(null); }
        });
        req.on('error', () => resolve(null));
    });
}

// ---------- JSON response ----------
function sendJson(res, statusCode, obj) {
    const allowedOrigin = process.env.ALLOWED_ORIGIN || 'http://localhost:3000';
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Admin-Secret',
        'Access-Control-Allow-Credentials': 'true',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store'
    });
    res.end(JSON.stringify(obj));
}

// ---------- Get client IP ----------
function getClientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.socket.remoteAddress || 'unknown';
}

// ---------- Simple router ----------
class Router {
    constructor() {
        this.routes = [];
    }

    add(method, pathPattern, ...handlers) {
        const paramNames = [];
        const regexStr = pathPattern
            .replace(/\/:([^/]+)/g, (_, name) => {
                paramNames.push(name);
                return '/([^/]+)';
            })
            .replace(/\//g, '\\/');
        const regex = new RegExp(`^${regexStr}$`);
        this.routes.push({ method, regex, paramNames, handlers });
    }

    get(p, ...h) { this.add('GET', p, ...h); }
    post(p, ...h) { this.add('POST', p, ...h); }
    put(p, ...h) { this.add('PUT', p, ...h); }
    delete(p, ...h) { this.add('DELETE', p, ...h); }

    match(method, pathname) {
        for (const route of this.routes) {
            if (route.method !== method) continue;
            const m = pathname.match(route.regex);
            if (m) {
                const params = {};
                route.paramNames.forEach((name, i) => {
                    params[name] = decodeURIComponent(m[i + 1]);
                });
                return { handlers: route.handlers, params };
            }
        }
        return null;
    }
}

// ---------- Rate limiter (in-memory with auto cleanup) ----------
const rateBuckets = new Map();
const CLEANUP_INTERVAL = 5 * 60 * 1000; // every 5 min

setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of rateBuckets) {
        if (now - bucket.start > 30 * 60 * 1000) { // older than 30 min
            rateBuckets.delete(key);
        }
    }
}, CLEANUP_INTERVAL).unref();

function rateLimit(key, max, windowMs) {
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now - bucket.start > windowMs) {
        bucket = { start: now, count: 0 };
        rateBuckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= max;
}

module.exports = {
    parseBody, sendJson, getClientIp,
    Router, rateLimit
};
