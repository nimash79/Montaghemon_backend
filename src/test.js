import mediasoup from "mediasoup";

async function runTest() {
    try {
        console.log("در حال راه اندازی Worker...");

        // ایجاد یک Worker
        const worker = await mediasoup.createWorker({
            logLevel: 'warn',
        });

        worker.on('died', () => {
            console.error('Worker مرد!');
            process.exit(1);
        });

        console.log(`Worker با موفقیت ایجاد شد! PID: ${worker.pid}`);

        // ایجاد یک Router برای مدیریت صدا و تصویر
        const router = await worker.createRouter({
            mediaCodecs: [
                {
                    kind: 'audio',
                    mimeType: 'audio/opus',
                    clockRate: 48000,
                    channels: 2
                },
                {
                    kind: 'video',
                    mimeType: 'video/VP8',
                    clockRate: 90000,
                    parameters: { 'x-google-start-bitrate': 1000 }
                }
            ]
        });

        console.log(`Router با موفقیت ایجاد شد. شناسه Router: ${router.id}`);

        // بستن برنامه پس از تست
        console.log("تست موفقیت آمیز بود. در حال بستن...");
        worker.close();
        process.exit(0);

    } catch (error) {
        console.error("خطا در تست mediasoup:", error);
    }
}

runTest();
