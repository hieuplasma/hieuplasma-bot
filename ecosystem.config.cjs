module.exports = {
    apps: [
        {
            name: "hieuplasma_bot",
            script: "bot.js",
            // Không watch: deploy.sh tự restart sau khi git pull + yarn install xong.
            watch: false,
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
