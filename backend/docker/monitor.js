const { docker } = require('./client');

class ContainerMonitor {
    constructor() {
        this.metrics = new Map();
        this.pollingInterval = 30000; // 30 seconds default
        this.isRunning = false;
        this.timer = null;
    }

    async init() {
        if (this.isRunning) return;
        this.isRunning = true;

        console.log('🚀 Initializing Docker Event-Driven Monitor...');

        // 1. Listen for Docker events (lifecycle management)
        try {
            const eventStream = await docker.getEvents({
                filters: { type: ['container'], event: ['start', 'stop', 'die', 'destroy'] }
            });

            eventStream.on('data', (chunk) => {
                try {
                    const event = JSON.parse(chunk.toString());
                    const containerId = event.id;
                    const action = event.action;

                    if (action === 'start') {
                        console.log(`📡 Container started: ${containerId.substring(0, 12)} - Refreshing metrics soon...`);
                        // Immediate refresh for this container could be forced here
                        setTimeout(() => this.pollSingle(containerId), 1000);
                    } else if (['stop', 'die', 'destroy'].includes(action)) {
                        console.log(`📡 Container stopped: ${containerId.substring(0, 12)} - Clearing metrics`);
                        this.metrics.delete(containerId);
                    }
                } catch (e) {
                    // Ignore parse errors from partial chunks
                }
            });

            eventStream.on('error', (err) => {
                console.error('❌ Docker event stream error:', err);
                this.isRunning = false;
                // Retry initialization after delay
                setTimeout(() => this.init(), 5000);
            });
        } catch (error) {
            console.error('❌ Failed to subscribe to Docker events:', error);
        }

        // 2. Start throttled metrics polling
        this.startPolling();
    }

    startPolling() {
        if (this.timer) clearInterval(this.timer);

        // Initial poll
        this.pollAll();

        this.timer = setInterval(() => {
            this.pollAll();
        }, this.pollingInterval);
    }

    async pollAll() {
        try {
            const containers = await docker.listContainers({ all: false });
            // Process in small batches or with slight delays if list is massive to prevent event loop blocking
            for (const containerInfo of containers) {
                await this.pollSingle(containerInfo.Id);
            }
        } catch (error) {
            console.error('❌ Global poll failed:', error);
        }
    }

    async pollSingle(containerId) {
        try {
            const container = docker.getContainer(containerId);
            // Fetch stats once (stream: false) to get current snapshot
            const stats = await container.stats({ stream: false });
            this.metrics.set(containerId, this.parseStats(stats));
        } catch (error) {
            // Container might have vanished between list and stats
            this.metrics.delete(containerId);
        }
    }

    parseStats(stats) {
        let cpuPercent = 0.0;
        const cpuUsage = stats.cpu_stats?.cpu_usage?.total_usage || 0;
        const preCpuUsage = stats.precpu_stats?.cpu_usage?.total_usage || 0;
        const systemCpuUsage = stats.cpu_stats?.system_cpu_usage || 0;
        const preSystemCpuUsage = stats.precpu_stats?.system_cpu_usage || 0;
        const onlineCpus = stats.cpu_stats?.online_cpus || stats.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;

        const cpuDelta = cpuUsage - preCpuUsage;
        const systemDelta = systemCpuUsage - preSystemCpuUsage;

        if (systemDelta > 0 && cpuDelta > 0) {
            cpuPercent = (cpuDelta / systemDelta) * onlineCpus * 100;
        }

        const memStats = stats.memory_stats || {};
        const memUsage = memStats.usage || 0;
        const memLimit = memStats.limit || 0;
        let memPercent = 0;

        if (memLimit > 0) {
            memPercent = (memUsage / memLimit) * 100;
        }

        return {
            cpu: cpuPercent.toFixed(2),
            memory: {
                usage: this.formatBytes(memUsage),
                limit: this.formatBytes(memLimit),
                percent: memPercent.toFixed(2)
            },
            network: {
                rx: this.formatBytes(stats.networks?.eth0?.rx_bytes || 0),
                tx: this.formatBytes(stats.networks?.eth0?.tx_bytes || 0)
            },
            timestamp: new Date()
        };
    }

    formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const safeIndex = Math.min(Math.max(i, 0), sizes.length - 1);
        return parseFloat((bytes / Math.pow(k, safeIndex)).toFixed(2)) + ' ' + sizes[safeIndex];
    }

    getMetrics(containerId) {
        return this.metrics.get(containerId);
    }
}

module.exports = new ContainerMonitor();
