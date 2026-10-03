// engines/hwm-engine.js

const PROFIT_SHARE_PERCENT = parseFloat(process.env.PROFIT_SHARE_PERCENT || '20') / 100;
const MIN_TRANSFER_USDT = parseFloat(process.env.MIN_TRANSFER_USDT || '1.2');

function calculateShareFromTrade(netProfit) {
    if (netProfit <= 0) return { userKeeps: 0, creatorShare: 0, total: 0 };
    const creatorShare = netProfit * PROFIT_SHARE_PERCENT;
    return {
        userKeeps: Number((netProfit - creatorShare).toFixed(6)),
        creatorShare: Number(creatorShare.toFixed(6)),
        total: Number(netProfit.toFixed(6))
    };
}

function shouldTriggerTransfer(pendingShare) {
    return pendingShare >= MIN_TRANSFER_USDT;
}

function amountToThreshold(pendingShare) {
    const r = MIN_TRANSFER_USDT - pendingShare;
    return r > 0 ? Number(r.toFixed(6)) : 0;
}

module.exports = {
    PROFIT_SHARE_PERCENT, MIN_TRANSFER_USDT,
    calculateShareFromTrade, shouldTriggerTransfer, amountToThreshold
};