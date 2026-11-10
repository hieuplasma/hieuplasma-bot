import fs from 'fs';
import os from 'os';
import path from 'path';
import { getValue, setValue } from './store.js';
import { formatDuration, listPm2Apps, tailLines } from './server_status.js';

// ---------------------------------------------------------------- báo web sập
// Bot chạy cùng server nên gọi thẳng cổng của từng app (bắt được app chết / treo,
// không bắt được lỗi nginx, DNS, SSL). Khi tên miền chạy lại có thể thêm URL https://... vào đây.
// name trùng tên app pm2 để gợi ý /logs.
export const SITES = [
    { name: 'uongbia', url: 'http://localhost:1234' },
    { name: 'familytree', url: 'http://localhost:10000' },
    { name: 'hieutm-website', url: 'http://localhost:9000' },
];
const TIMEOUT_MS = 10_000;
const FAILS_BEFORE_ALERT = 2; // kiểm tra mỗi phút, lỗi 2 lần liên tiếp mới báo (bỏ qua lúc app đang restart)
const REMIND_EVERY_MS = 60 * 60_000; // còn sập thì nhắc lại mỗi giờ

async function probe(url) {
    const started = Date.now();
    try {
        const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
        await res.body?.cancel();
        if (res.status >= 500) return { ok: false, reason: `HTTP ${res.status}` };
        return { ok: true, ms: Date.now() - started };
    } catch (error) {
        if (error.name === 'TimeoutError') return { ok: false, reason: `quá ${TIMEOUT_MS / 1000}s không phản hồi` };
        return { ok: false, reason: error.cause?.code || error.message };
    }
}

export async function checkSites(notify, sites = SITES) {
    const before = getValue('monitor.sites', {});
    const state = {};
    const now = Date.now();
    const results = await Promise.all(sites.map(async (site) => [site, await probe(site.url)]));

    for (const [site, result] of results) {
        const st = { fails: 0, ...before[site.name] };
        if (result.ok) {
            if (st.alerted) notify(`🟢 ${site.name} đã chạy lại (sập khoảng ${formatDuration(now - st.downSince)})`);
            state[site.name] = { fails: 0 };
            continue;
        }
        st.fails += 1;
        st.downSince ??= now;
        if (st.fails >= FAILS_BEFORE_ALERT && (!st.alerted || now - st.lastAlertAt >= REMIND_EVERY_MS)) {
            notify(
                st.alerted
                    ? `🔴 ${site.name} vẫn sập (${formatDuration(now - st.downSince)}): ${result.reason}`
                    : `🔴 ${site.name} sập: ${result.reason}\n${site.url}\nXem log: /logs ${site.name}`,
            );
            st.alerted = true;
            st.lastAlertAt = now;
        }
        state[site.name] = st;
    }
    if (JSON.stringify(state) !== JSON.stringify(before)) setValue('monitor.sites', state);
}

// ---------------------------------------------------------------- báo app crash
// pm2.log ghi mỗi lần app thoát: restart theo lịch / restart tay / deploy là "code [0]",
// crash là code khác 0. Bot đọc phần mới của pm2.log mỗi phút (vị trí đã đọc lưu trong store,
// nên bot tự crash thì lúc chạy lại vẫn báo được).
const PM2_LOG = path.join(process.env.PM2_HOME || path.join(os.homedir(), '.pm2'), 'pm2.log');
const MAX_READ = 1024 * 1024;
const CRASH_ALERT_GAP_MS = 10 * 60_000; // crash liên tục thì gộp, mỗi app tối đa 1 tin / 10 phút
const LOG_LINES_IN_ALERT = 15;

const pendingCrashes = {}; // tên app -> { count, reasons: Set }
const lastCrashAlertAt = {};

function readNewPm2Log() {
    const size = fs.statSync(PM2_LOG).size;
    let offset = getValue('monitor.pm2LogOffset');
    // Lần đầu chạy: bắt đầu từ cuối file, không báo lại chuyện cũ.
    if (offset === undefined) {
        setValue('monitor.pm2LogOffset', size);
        return '';
    }
    if (size < offset) offset = 0; // file bị xoay vòng / xóa
    if (size === offset) return '';
    const start = Math.max(offset, size - MAX_READ);
    const buf = Buffer.alloc(size - start);
    const fd = fs.openSync(PM2_LOG, 'r');
    try {
        fs.readSync(fd, buf, 0, buf.length, start);
    } finally {
        fs.closeSync(fd);
    }
    setValue('monitor.pm2LogOffset', size);
    return buf.toString('utf8');
}

// Trả về [{ name, reason }] cho mỗi lần crash trong đoạn log.
export function parseCrashes(text, appsById) {
    const crashes = [];
    for (const line of text.split('\n')) {
        let m = line.match(/App \[(.+):(\d+)\] exited with code \[([^\]]*)\] via signal \[([^\]]*)\]/);
        if (m && m[3] !== '0') {
            crashes.push({ name: m[1], reason: m[3] === 'null' ? `bị kill (${m[4]})` : `exit code ${m[3]}` });
            continue;
        }
        m = line.match(/Process (\d+) restarted because it exceeds --max-memory-restart/);
        if (m) crashes.push({ name: appsById[m[1]] || `app #${m[1]}`, reason: 'vượt giới hạn RAM' });
    }
    return crashes;
}

async function errorLogTail(app) {
    if (!app?.errLogPath) return '';
    try {
        const lines = await tailLines(app.errLogPath, LOG_LINES_IN_ALERT);
        return lines.length ? `\n\nLog lỗi gần nhất:\n${lines.join('\n').slice(-1500)}` : '';
    } catch {
        return '';
    }
}

export async function checkPm2(notify) {
    const apps = await listPm2Apps();
    const byName = Object.fromEntries(apps.map((a) => [a.name, a]));
    const appsById = Object.fromEntries(apps.map((a) => [a.pmId, a.name]));
    const now = Date.now();

    for (const { name, reason } of parseCrashes(readNewPm2Log(), appsById)) {
        const p = (pendingCrashes[name] ||= { count: 0, reasons: new Set() });
        p.count += 1;
        p.reasons.add(reason);
    }
    for (const [name, p] of Object.entries(pendingCrashes)) {
        if (now - (lastCrashAlertAt[name] || 0) < CRASH_ALERT_GAP_MS) continue;
        delete pendingCrashes[name];
        lastCrashAlertAt[name] = now;
        const times = p.count > 1 ? ` ${p.count} lần` : '';
        notify(`💥 ${name} crash${times} (${[...p.reasons].join(', ')})` + (await errorLogTail(byName[name])));
    }

    // App không còn online (errored sau khi crash liên tục, hoặc bị stop).
    const before = getValue('monitor.apps', {});
    const state = {};
    for (const app of apps) {
        const down = app.status !== 'online';
        if (down && !before[app.name]) notify(`🔴 App ${app.name} đang ${app.status}, không chạy.\nXem log: /logs ${app.name}`);
        if (!down && before[app.name]) notify(`🟢 App ${app.name} đã online lại`);
        if (down) state[app.name] = true;
    }
    if (JSON.stringify(state) !== JSON.stringify(before)) setValue('monitor.apps', state);
}
