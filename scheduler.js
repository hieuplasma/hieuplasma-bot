import cron from 'node-cron';

const jobs = [];

// Chạy fn theo lịch cron, giờ Việt Nam. Lỗi được log và chuyển cho onError
// (thường là báo cho chủ bot) thay vì làm sập bot.
export function scheduleJob(name, expression, fn, onError) {
    const task = cron.schedule(
        expression,
        async () => {
            try {
                await fn();
            } catch (error) {
                console.error(`Job "${name}" lỗi:`, error.message);
                onError?.(name, error);
            }
        },
        { timezone: 'Asia/Ho_Chi_Minh' },
    );
    jobs.push({ name, expression, task });
    return task;
}

export function listJobs() {
    return jobs.map(({ name, expression }) => ({ name, expression }));
}
