import axios from 'axios';

import { sendTelegramMessage } from './send_tele.js';

// Ưu tiên hiển thị theo thứ tự trong mảng này.
const LOCATIONS = [
    { name: 'Hà Nội', latitude: 21.0285, longitude: 105.8542 },
    { name: 'Hải Thịnh - Ninh Bình', latitude: 19.9936, longitude: 106.2386 },
    { name: 'Phù Khê - Bắc Ninh', latitude: 21.1167, longitude: 105.9667 },
];

// https://open-meteo.com/en/docs#weathervariables (WMO weather codes)
function describeWeather(code) {
    if (code === 0) return '☀️ Trời quang';
    if (code <= 2) return '🌤️ Ít mây';
    if (code === 3) return '☁️ Nhiều mây';
    if (code === 45 || code === 48) return '🌫️ Sương mù';
    if (code >= 51 && code <= 57) return '🌦️ Mưa phùn';
    if (code >= 61 && code <= 67) return '🌧️ Mưa';
    if (code >= 71 && code <= 77) return '❄️ Tuyết';
    if (code >= 80 && code <= 82) return '🌧️ Mưa rào';
    if (code >= 95) return '⛈️ Dông';
    return '🌡️ Không rõ';
}

function formatLocationWeather(name, { current, daily }) {
    return (
        `📍 ${name}\n` +
        `${describeWeather(current.weather_code)}: ${Math.round(current.temperature_2m)}°C ` +
        `(cảm giác ${Math.round(current.apparent_temperature)}°C), ` +
        `độ ẩm ${current.relative_humidity_2m}%\n` +
        `Hôm nay: ${Math.round(daily.temperature_2m_min[0])}° - ${Math.round(daily.temperature_2m_max[0])}°C, ` +
        `khả năng mưa ${daily.precipitation_probability_max[0]}%`
    );
}

// One batched request for all locations (fewer rate-limit hits), retried on failure.
async function fetchWeather(retries = 3) {
    for (let attempt = 1; ; attempt++) {
        try {
            const { data } = await axios.get('https://api.open-meteo.com/v1/forecast', {
                timeout: 10000,
                params: {
                    latitude: LOCATIONS.map((l) => l.latitude).join(','),
                    longitude: LOCATIONS.map((l) => l.longitude).join(','),
                    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code',
                    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
                    timezone: 'Asia/Ho_Chi_Minh',
                    forecast_days: 1,
                },
            });
            return Array.isArray(data) ? data : [data];
        } catch (error) {
            console.error(`Error (attempt ${attempt}/${retries}):`, error.message);
            if (attempt >= retries) throw error;
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
    }
}

export async function getTemperatures() {
    const messageTime = new Date().toLocaleString('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
    });

    try {
        const results = await fetchWeather();
        const body = LOCATIONS.map((location, i) => formatLocationWeather(location.name, results[i])).join('\n\n');
        return `Nhiệt độ - ${messageTime}:\n\n${body}\n\n(Nguồn: Open-Meteo)`;
    } catch (error) {
        return 'Không thể lấy được nhiệt độ';
    }
}

async function start() {
    const message = await getTemperatures();
    if (message !== undefined) {
        await sendTelegramMessage(message);
    }
}

// Call the start function if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    start();
}
