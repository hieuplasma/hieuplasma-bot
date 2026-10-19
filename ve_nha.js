import axios from 'axios';

// Nhà: đặt HOME_LAT / HOME_LNG / HOME_NAME trong .env để ghi đè.
export const HOME = {
    name: process.env.HOME_NAME || 'Nhà (Tòa nhà C13 - Bộ Quốc phòng)',
    latitude: Number(process.env.HOME_LAT) || 20.98045,
    longitude: Number(process.env.HOME_LNG) || 105.8266,
};

// Hai chỗ làm để chọn.
export const PRESET_LOCATIONS = [
    { name: 'FPT Tower - Cầu Giấy', latitude: 21.0270144, longitude: 105.7886937 },
    { name: 'Skylink JSC', latitude: 20.9689155, longitude: 105.7694573 },
];

export const LOCATION_BUTTON_PREFIX = '📍 ';

function mapsLink(origin, dest) {
    const params = new URLSearchParams({
        api: '1',
        origin: `${origin.latitude},${origin.longitude}`,
        destination: `${dest.latitude},${dest.longitude}`,
        travelmode: 'two-wheeler',
    });
    return `https://www.google.com/maps/dir/?${params}`;
}

function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h} giờ ${m} phút` : `${m} phút`;
}

// Google Routes API: xe máy (TWO_WHEELER), có tính giao thông, lấy tuyến nhanh nhất.
async function routeWithGoogle(origin, dest, key) {
    const waypoint = (p) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });
    const { data } = await axios.post(
        'https://routes.googleapis.com/directions/v2:computeRoutes',
        {
            origin: waypoint(origin),
            destination: waypoint(dest),
            travelMode: 'TWO_WHEELER',
            routingPreference: 'TRAFFIC_AWARE',
            languageCode: 'vi-VN',
            units: 'METRIC',
        },
        {
            timeout: 10000,
            headers: {
                'X-Goog-Api-Key': key,
                'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.description',
            },
        },
    );
    const route = data.routes?.[0];
    if (!route) throw new Error('Google không trả về tuyến đường');
    return {
        seconds: parseInt(route.duration, 10),
        meters: route.distanceMeters,
        via: route.description,
        source: 'Google Maps',
    };
}

// Gộp các bước liên tiếp cùng tên đường, bỏ đoạn ngắn (< 300m) để chỉ còn các đường chính.
function summarizeRoads(steps) {
    const roads = [];
    for (const step of steps) {
        const name = step.name || step.ref;
        if (!name) continue;
        const last = roads[roads.length - 1];
        if (last && last.name === name) last.meters += step.distance;
        else roads.push({ name, meters: step.distance });
    }
    const main = roads.filter((r) => r.meters >= 300);
    const merged = main.filter((r, i) => i === 0 || r.name !== main[i - 1].name);
    return merged.map((r) => `${r.name} (${r.meters >= 1000 ? (r.meters / 1000).toFixed(1) + ' km' : Math.round(r.meters / 10) * 10 + ' m'})`).join(' → ');
}

// Dự phòng khi chưa có API key: OSRM (profile ô tô, chỉ mang tính ước lượng).
async function routeWithOsrm(origin, dest) {
    const coords = `${origin.longitude},${origin.latitude};${dest.longitude},${dest.latitude}`;
    const { data } = await axios.get(`https://router.project-osrm.org/route/v1/driving/${coords}`, {
        timeout: 10000,
        params: { overview: 'false', steps: 'true' },
    });
    const route = data.routes?.[0];
    if (!route) throw new Error('OSRM không trả về tuyến đường');
    return {
        seconds: route.duration,
        meters: route.distance,
        via: summarizeRoads(route.legs.flatMap((leg) => leg.steps)),
        source: 'OSRM (ước lượng)',
    };
}

export async function getRouteHome(origin) {
    const key = process.env.GOOGLE_MAPS_API_KEY;
    let route;
    try {
        route = key ? await routeWithGoogle(origin, HOME, key) : await routeWithOsrm(origin, HOME);
    } catch (error) {
        console.error('Route error:', error.response?.data || error.message);
        route = null;
    }

    const link = mapsLink(origin, HOME);
    if (!route) {
        return `Không tính được tuyến đường, mở Google Maps để xem:\n${link}`;
    }
    return (
        `🏍️ Về nhà (${HOME.name}) từ ${origin.name}\n` +
        `⏱️ ${formatDuration(route.seconds)} • 📏 ${(route.meters / 1000).toFixed(1)} km\n` +
        (route.via ? `🛣️ ${route.via}\n` : '') +
        `\n🗺️ Mở Google Maps (xe máy):\n${link}\n\n(Nguồn: ${route.source})`
    );
}
