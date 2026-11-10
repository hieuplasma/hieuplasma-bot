import { getValue, setValue } from './store.js';

// Ghi chú lưu trong data/store.json: { nextId, items: [{ id, text, at }] }, cũ trước mới sau.
const KEY = 'notes';
export const PAGE_SIZE = 10;
const SEARCH_LIMIT = 20;
const PREVIEW_CHARS = 300;
const TELEGRAM_MAX_TEXT = 4000;

function load() {
    return getValue(KEY, { nextId: 1, items: [] });
}

export function addNote(text) {
    const data = load();
    const note = { id: data.nextId, text: text.trim(), at: Date.now() };
    setValue(KEY, { nextId: data.nextId + 1, items: [...data.items, note] });
    return note;
}

export function deleteNote(id) {
    const data = load();
    const items = data.items.filter((n) => n.id !== id);
    if (items.length === data.items.length) return false;
    setValue(KEY, { ...data, items });
    return true;
}

// Bỏ dấu để tìm "dau nhot" ra "dầu nhớt".
function normalize(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
}

function formatTime(ms) {
    return new Date(ms).toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

function formatNote(n) {
    const text = n.text.length > PREVIEW_CHARS ? n.text.slice(0, PREVIEW_CHARS) + '…' : n.text;
    return `#${n.id} · ${formatTime(n.at)}\n${text}`;
}

function deleteButtons(notes, page) {
    const rows = [];
    for (let i = 0; i < notes.length; i += 5) {
        rows.push(notes.slice(i, i + 5).map((n) => ({ text: `🗑 #${n.id}`, callback_data: `notes:del:${n.id}:${page}` })));
    }
    return rows;
}

// Ghép các ghi chú vào tin nhắn, dừng trước khi quá giới hạn của Telegram.
function joinWithinLimit(header, blocks) {
    let text = header;
    let shown = 0;
    for (const block of blocks) {
        if (text.length + block.length + 2 > TELEGRAM_MAX_TEXT) break;
        text += '\n\n' + block;
        shown += 1;
    }
    return { text, shown };
}

// Một trang danh sách, mới nhất trước. page 0 = mới nhất.
export function renderNotesPage(page = 0) {
    const all = [...load().items].reverse();
    if (!all.length) return { text: '📝 Chưa có ghi chú nào.\nGõ /note <nội dung> để ghi.' };

    const pages = Math.ceil(all.length / PAGE_SIZE);
    page = Math.min(Math.max(page, 0), pages - 1);
    const slice = all.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
    const header = `📝 Ghi chú (${all.length}) - trang ${page + 1}/${pages}, mới nhất trước:`;
    const { text, shown } = joinWithinLimit(header, slice.map(formatNote));

    const nav = [];
    if (page > 0) nav.push({ text: '⬅️ Mới hơn', callback_data: `notes:p:${page - 1}` });
    if (page < pages - 1) nav.push({ text: 'Cũ hơn ➡️', callback_data: `notes:p:${page + 1}` });
    const inline_keyboard = [...deleteButtons(slice.slice(0, shown), page), ...(nav.length ? [nav] : [])];
    return { text, reply_markup: { inline_keyboard } };
}

export function renderSearch(query) {
    const q = normalize(query);
    const found = [...load().items].reverse().filter((n) => normalize(n.text).includes(q));
    if (!found.length) return { text: `🔍 Không có ghi chú nào chứa "${query}".` };
    const more = found.length > SEARCH_LIMIT ? ` (hiện ${SEARCH_LIMIT} cái mới nhất)` : '';
    const list = found.slice(0, SEARCH_LIMIT);
    const { text, shown } = joinWithinLimit(`🔍 ${found.length} ghi chú chứa "${query}"${more}:`, list.map(formatNote));
    return { text, reply_markup: { inline_keyboard: deleteButtons(list.slice(0, shown), 0) } };
}

export function getNote(id) {
    return load().items.find((n) => n.id === id);
}
