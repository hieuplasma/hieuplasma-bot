import axios from 'axios';
import * as cheerio from 'cheerio';

import { sendTelegramMessage } from './send_tele.js';

const messageTime = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh'
  });

// pvoil.com.vn is now behind Cloudflare's bot challenge and can't be scraped
// directly, so we read Petrolimex's official retail prices via webgia.com,
// which republishes them in a plain HTML table.
function parseFuelPrices(html) {
    const $ = cheerio.load(html);
    const updatedAt = $('h1.h-head small').text().replace(/^-\s*/, '').trim();

    let message = `Giá xăng dầu Petrolimex - ${updatedAt || messageTime}:\n\n`;

    $('table').first().find('tbody tr').each((_, row) => {
        const name = $(row).find('th a').text().trim();
        if (!name) return;
        const cells = $(row).find('td');
        const zone1 = $(cells[0]).text().trim();
        const zone2 = $(cells[1]).text().trim();
        const icon = name.includes('Xăng') ? '⛽' : '🛢️';
        message += `${icon} ${name}: Vùng 1: ${zone1}đ/lít, Vùng 2: ${zone2}đ/lít\n`;
    });

    message += `\n(Nguồn: Petrolimex, qua webgia.com)`;

    return message;
}

export async function getFuelPrices() {
    try {
        const response = await axios.get('https://webgia.com/gia-xang-dau/petrolimex/');
        return parseFuelPrices(response.data);
    }
    catch (error) {
        console.error('Error:', error.message);
        return "Không thể lấy được giá xăng dầu";
    }
}

async function start() {
    const message = await getFuelPrices();
    if (message !== undefined) {
        await sendTelegramMessage(message);
    }
}

// Call the start function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    start();
}