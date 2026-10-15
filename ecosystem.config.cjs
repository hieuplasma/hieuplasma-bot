module.exports = {
    apps: [
        {
            name: "hieuplasma_bot",
            script: "bot.js",
            watch: true,
            cron_restart: '00 01 * * *',
            env: {
                NODE_ENV: "development",
            },
            env_production: {
                NODE_ENV: "production",
            },
        },
    ],
};