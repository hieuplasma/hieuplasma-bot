import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import { promisify } from 'util';

const run = promisify(execFile);

// Ngưỡng đánh dấu ⚠️ cho RAM / đĩa (%).
const WARN_PERCENT = 85;

export function formatDuration(ms) {
    const minutes = Math.floor(ms / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    if (days > 0) return `${days} ngày ${hours} giờ`;
    if (hours > 0) return `${hours} giờ ${minutes % 60} phút`;
    return `${minutes} phút`;
}

function formatGb(bytes) {
    return (bytes / 1024 ** 3).toFixed(1);
}

function usageLine(label, used, total) {
    const percent = Math.round((used / total) * 100);
    const warn = percent >= WARN_PERCENT ? ' ⚠️' : '';
    return `${label}: ${formatGb(used)}/${formatGb(total)} GB (${percent}%)${warn}`;
}

// App pm2 (bỏ qua module như pm2-logrotate).
export async function listPm2Apps() {
    const { stdout } = await run('pm2', ['jlist'], { timeout: 10000, maxBuffer: 10 * 1024 * 1024 });
    return JSON.parse(stdout)
        .filter((p) => !p.pm2_env.pmx_module)
        .map((p) => ({
            name: p.name,
            pmId: p.pm_id,
            status: p.pm2_env.status,
            uptimeMs: p.pm2_env.status === 'online' ? Date.now() - p.pm2_env.pm_uptime : 0,
            restarts: p.pm2_env.restart_time,
            memory: p.monit?.memory || 0,
            cpu: p.monit?.cpu || 0,
            errLogPath: p.pm2_env.pm_err_log_path,
            outLogPath: p.pm2_env.pm_out_log_path,
        }));
}

async function diskUsage() {
    const { stdout } = await run('df', ['-kP', '/'], { timeout: 10000 });
    const [, totalKb, usedKb] = stdout.trim().split('\n').pop().split(/\s+/);
    return { total: Number(totalKb) * 1024, used: Number(usedKb) * 1024 };
}

export async function getServerStatus() {
    const messageTime = new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const lines = [`🖥️ Server ${os.hostname()} - ${messageTime}`];

    const load = os.loadavg().map((n) => n.toFixed(2)).join(' ');
    lines.push(`⏱️ Bật ${formatDuration(os.uptime() * 1000)} • Load ${load} (${os.cpus().length} CPU)`);
    lines.push('💾 ' + usageLine('RAM', os.totalmem() - os.freemem(), os.totalmem()));
    try {
        const disk = await diskUsage();
        lines.push('💽 ' + usageLine('Đĩa /', disk.used, disk.total));
    } catch (error) {
        lines.push('💽 Đĩa: không đọc được');
    }

    let apps = [];
    try {
        apps = await listPm2Apps();
        lines.push('', '📦 App pm2:');
        for (const app of apps) {
            const icon = app.status === 'online' ? '🟢' : '🔴';
            const state = app.status === 'online' ? formatDuration(app.uptimeMs) : app.status;
            lines.push(`${icon} ${app.name}: ${state}, ↻${app.restarts}, ${Math.round(app.memory / 1024 ** 2)} MB, CPU ${app.cpu}%`);
        }
    } catch (error) {
        console.error('pm2 jlist error:', error.message);
        lines.push('', '📦 Không đọc được pm2');
    }

    return { text: lines.join('\n'), apps };
}

export async function restartPm2App(name) {
    await run('pm2', ['restart', name], { timeout: 30000 });
}

// n dòng cuối (không rỗng) của file log, bỏ mã màu ANSI. Chỉ đọc 64KB cuối nên file lớn cũng nhanh.
export async function tailLines(file, n) {
    const fh = await fs.promises.open(file, 'r');
    try {
        const { size } = await fh.stat();
        const length = Math.min(size, 64 * 1024);
        const buf = Buffer.alloc(length);
        await fh.read(buf, 0, length, size - length);
        const lines = buf.toString('utf8').replace(/\x1b\[[0-9;]*m/g, '').split('\n');
        if (length < size) lines.shift(); // dòng đầu có thể bị cắt dở
        return lines.filter((l) => l.trim()).slice(-n);
    } finally {
        await fh.close();
    }
}
