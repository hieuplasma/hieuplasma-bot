import axios from 'axios';
import crypto from 'crypto';

import { sendTelegramMessage } from './send_tele.js';

const messageTime = new Date().toLocaleString('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh'
  });

// DOJI retired giavang.doji.vn (old XML API) in favor of banggia.doji.vn, whose
// API encrypts the payload client-side; key/IV layout reverse-engineered from
// the site's JS bundle (chunk-MGKSBPRZ.js, class Z0._k / decrypt()).
const DOJI_AES_KEY = Buffer.from(
    '7a4b8c3d1e9f2a5b6c0d4e8f3a7b1c5d9e2f6a0b4c8d3e7f1a5b9c2d6e0f4a8b',
    'hex'
);

function decryptDojiPayload(base64Data) {
    const buf = Buffer.from(base64Data, 'base64');
    const iv = buf.subarray(0, 16);
    const ciphertext = buf.subarray(16);
    const decipher = crypto.createDecipheriv('aes-256-cbc', DOJI_AES_KEY, iv);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
}

export async function getGoldPrices() {
    try {
        const response = await axios.get('https://banggia.doji.vn/api/TablePrice/GetTablePrice');
        const rows = decryptDojiPayload(response.data.data);

        let messageContent = '';
        for (const row of rows) {
            if (row.type === 'G') {
                messageContent += `${row.materialName}: Mua ${row.priceDojiBuyIn}, Bán ${row.priceDojiSellOut}\n`;
            }
        }

        // Send message to Telegram
        const message = `Giá vàng ${messageTime}:\n\n${messageContent}`;
        return message
    } catch (error) {
        console.error('Error:', error.message);
        return "Không thể lấy được giá vàng";
    }
}

async function start() {
    const message = await getGoldPrices();
    if (message) {
        await sendTelegramMessage(message);
    }
}

// Call the start function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    start();
}