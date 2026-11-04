import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";
dotenv.config('./.env');

import { getGoldPrices } from "./gia_vang.js";
import { getFuelPrices } from "./gia_xang.js";
import { getTemperatures } from "./nhiet_do.js";
import { getRouteHome, PRESET_LOCATIONS, LOCATION_BUTTON_PREFIX } from "./ve_nha.js";
import { listJobs } from "./scheduler.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
// User id của chủ bot: gõ /myid khi chat riêng với bot để lấy, rồi điền vào .env.
const OWNER_CHAT_ID = process.env.OWNER_CHAT_ID;

// Create a bot using polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// Mạng chập chờn làm polling lỗi liên tục (ESOCKETTIMEDOUT, 502...), thư viện tự thử lại.
// Mỗi loại lỗi chỉ log tối đa 1 lần/phút, không thì log phình lên hàng trăm MB.
const lastPollingErrorAt = {};
bot.on("polling_error", (error) => {
  const key = `${error.code}:${error.message}`;
  const now = Date.now();
  if (now - (lastPollingErrorAt[key] || 0) < 60_000) return;
  lastPollingErrorAt[key] = now;
  console.error(`[polling_error] ${new Date().toISOString()} ${key}`);
});

function isOwner(msg) {
  return Boolean(OWNER_CHAT_ID) && String(msg.from?.id) === OWNER_CHAT_ID;
}

// Bọc handler của lệnh chỉ chủ bot được dùng. Chưa cấu hình OWNER_CHAT_ID thì chặn hết.
function ownerOnly(handler) {
  return (msg, match) => {
    if (!isOwner(msg)) {
      return bot.sendMessage(msg.chat.id, "⛔ Lệnh này chỉ dành cho chủ bot.");
    }
    return handler(msg, match);
  };
}

// Báo riêng cho chủ bot, ví dụ làm onError khi thêm lịch:
// scheduleJob("ban-tin-sang", "0 7 * * 1-5", fn, (name, e) => notifyOwner(`⚠️ ${name}: ${e.message}`))
function notifyOwner(text) {
  if (!OWNER_CHAT_ID) return;
  bot.sendMessage(OWNER_CHAT_ID, text).catch((error) => console.error("notifyOwner error:", error.message));
}


// Command listener
bot.onText(/\/giavang/, async (msg) => {
  const chatId = msg.chat.id;
  const price = await getGoldPrices();
  bot.sendMessage(chatId, price);
});

bot.onText(/\/giaxang/, async (msg) => {
    const chatId = msg.chat.id;
    const price = await getFuelPrices();
    bot.sendMessage(chatId, price);
  });

bot.onText(/\/nhietdo/, async (msg) => {
    const chatId = msg.chat.id;
    const weather = await getTemperatures();
    bot.sendMessage(chatId, weather);
  });

// Nút inline (callback) hoạt động cả trong group, kể cả khi bot bật privacy mode.
bot.onText(/\/venha/, (msg) => {
  const inline_keyboard = PRESET_LOCATIONS.map((l, i) => [{ text: LOCATION_BUTTON_PREFIX + l.name, callback_data: `venha:${i}` }]);
  bot.sendMessage(msg.chat.id, "Bạn đang ở đâu?", { reply_markup: { inline_keyboard } });

  // Nút gửi vị trí hiện tại chỉ dùng được khi chat riêng với bot.
  if (msg.chat.type === "private") {
    bot.sendMessage(msg.chat.id, "Hoặc gửi vị trí hiện tại:", {
      reply_markup: {
        keyboard: [[{ text: "📡 Gửi vị trí hiện tại", request_location: true }]],
        resize_keyboard: true,
        one_time_keyboard: true,
      },
    });
  }
});

async function replyRouteHome(chatId, origin) {
  const text = await getRouteHome(origin);
  bot.sendMessage(chatId, text, { reply_markup: { remove_keyboard: true }, disable_web_page_preview: true });
}

bot.on("callback_query", async (query) => {
  const match = query.data?.match(/^venha:(\d+)$/);
  if (!match || !query.message) return;
  const origin = PRESET_LOCATIONS[Number(match[1])];
  await bot.answerCallbackQuery(query.id);
  if (origin) replyRouteHome(query.message.chat.id, origin);
});

bot.on("location", (msg) => {
  replyRouteHome(msg.chat.id, {
    name: "vị trí hiện tại",
    latitude: msg.location.latitude,
    longitude: msg.location.longitude,
  });
});

bot.onText(/\/myid/, (msg) => {
  bot.sendMessage(msg.chat.id, `User id của bạn: ${msg.from.id}\nChat id: ${msg.chat.id}`);
});

bot.onText(/\/status/, ownerOnly((msg) => {
  const uptimeMinutes = Math.round(process.uptime() / 60);
  const memoryMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const jobs = listJobs();
  const jobLines = jobs.length ? jobs.map((j) => `• ${j.name} (${j.expression})`).join("\n") : "• (chưa có)";
  bot.sendMessage(
    msg.chat.id,
    `🤖 Bot đang chạy ${Math.floor(uptimeMinutes / 60)} giờ ${uptimeMinutes % 60} phút\n` +
      `💾 RAM: ${memoryMb} MB\n` +
      `⏰ Lịch tự động:\n${jobLines}`,
  );
}));

// Danh sách lệnh dùng chung cho menu "/" của Telegram và /help.
const COMMANDS = [
  { command: "giavang", description: "Xem giá vàng" },
  { command: "giaxang", description: "Xem giá xăng dầu" },
  { command: "nhietdo", description: "Xem nhiệt độ Hà Nội, Hải Thịnh, Phù Khê" },
  { command: "venha", description: "Tìm đường nhanh nhất về nhà bằng xe máy" },
  { command: "myid", description: "Xem user id / chat id" },
  { command: "status", description: "Tình trạng bot (chỉ chủ bot)" },
  { command: "help", description: "Xem các lệnh hỗ trợ" },
];
bot.setMyCommands(COMMANDS).catch((error) => console.error("setMyCommands error:", error.message));

// Help command
const help = COMMANDS.map((c) => `/${c.command} - ${c.description}`).join("\n");
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Chào mừng bạn đến với bot Hieuplasma!\n" + "Vui lòng nhập /help để xem các lệnh hỗ trợ.");
}
);
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, help);
}
);
