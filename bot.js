import TelegramBot from "node-telegram-bot-api";
import * as dotenv from "dotenv";
dotenv.config('./.env');

import { getGoldPrices } from "./gia_vang.js";
import { getFuelPrices } from "./gia_xang.js";
import { getTemperatures } from "./nhiet_do.js";

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



// Help command
const help = `
/start - Start the bot
/help - Xem các lệnh hỗ trợ

/giavang - Xem giá vàng
/giaxang - Xem giá xăng dầu
/nhietdo - Xem nhiệt độ Hà Nội, Hải Thịnh, Phù Khê
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
