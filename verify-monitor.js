const monitor = require('./backend/docker/monitor');

async function verify() {
    console.log('🧪 Starting Performance Verification...');
    try {
        await monitor.init();
        console.log('✅ Monitor initialized successfully.');

        // Wait for first poll
        console.log('⏳ Waiting for initial poll...');
        await new Promise(resolve => setTimeout(resolve, 5000));

        const metrics = Array.from(monitor.metrics.entries());
        console.log(`📊 Collected metrics for ${metrics.length} containers.`);

        if (monitor.isRunning) {
            console.log('✅ Event listener is running.');
        } else {
            throw new Error('Monitor should be running');
        }

        console.log('🧪 Verification complete.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Verification failed:', error);
        process.exit(1);
    }
}

verify();
