const monitor = require('./backend/docker/monitor');

async function verify() {
    console.log('🧪 Starting Performance Verification...');
    try {
        // Start monitoring a dummy container for verification
        const dummyId = 'verification-container';
        await monitor.startMonitoring(dummyId);
        console.log('✅ Monitor started for verification container.');

        console.log('🧪 Verification complete.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Verification failed:', error);
        process.exit(1);
    }
}

verify();
