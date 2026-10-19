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

bot.onText(/\/venha/, (msg) => {
  const keyboard = [
    ...PRESET_LOCATIONS.map((l) => [{ text: LOCATION_BUTTON_PREFIX + l.name }]),
    [{ text: "📡 Gửi vị trí hiện tại", request_location: true }],
  ];
  bot.sendMessage(msg.chat.id, "Bạn đang ở đâu? Chọn địa điểm hoặc gửi vị trí hiện tại:", {
    reply_markup: { keyboard, resize_keyboard: true, one_time_keyboard: true },
  });
});

async function replyRouteHome(chatId, origin) {
  const text = await getRouteHome(origin);
  bot.sendMessage(chatId, text, { reply_markup: { remove_keyboard: true }, disable_web_page_preview: true });
}

bot.on("message", (msg) => {
  if (msg.location) {
    return replyRouteHome(msg.chat.id, {
      name: "vị trí hiện tại",
      latitude: msg.location.latitude,
      longitude: msg.location.longitude,
    });
  }
  if (msg.text?.startsWith(LOCATION_BUTTON_PREFIX)) {
    const name = msg.text.slice(LOCATION_BUTTON_PREFIX.length);
    const origin = PRESET_LOCATIONS.find((l) => l.name === name);
    if (origin) return replyRouteHome(msg.chat.id, origin);
  }
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
