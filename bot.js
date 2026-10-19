import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";
dotenv.config('./.env');

import { getGoldPrices } from "./gia_vang.js";
import { getFuelPrices } from "./gia_xang.js";
import { getTemperatures } from "./nhiet_do.js";
import { getRouteHome, PRESET_LOCATIONS, LOCATION_BUTTON_PREFIX } from "./ve_nha.js";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN

// Create a bot using polling
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });


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

// Help command
const help = `
/start - Start the bot
/help - Xem các lệnh hỗ trợ

/giavang - Xem giá vàng
/giaxang - Xem giá xăng dầu
/nhietdo - Xem nhiệt độ Hà Nội, Hải Thịnh, Phù Khê
/venha - Tìm đường nhanh nhất về nhà bằng xe máy
`;
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
