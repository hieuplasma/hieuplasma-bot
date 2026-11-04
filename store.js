import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Lưu trạng thái nhỏ (giá lần trước, nhắc việc, ...) vào data/store.json.
// data/ không nằm trong git nên deploy (git reset) không đụng tới.
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');

let cache = null;

function load() {
    if (cache) return cache;
    try {
        cache = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    } catch {
        cache = {};
    }
    return cache;
}

export function getValue(key, fallback) {
    const value = load()[key];
    return value === undefined ? fallback : value;
}

// Ghi ra file tạm rồi rename để file không bị hỏng nếu bot tắt giữa chừng.
export function setValue(key, value) {
    load()[key] = value;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STORE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
    fs.renameSync(tmp, STORE_FILE);
}
