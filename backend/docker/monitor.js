const { docker, hostManager } = require('./client');
const { scanImage } = require('../security/scanner');
const EventEmitter = require('events');
const metricsStore = require('../db/metrics-store');
const { predictContainer } = require('./predictor');

class ContainerMonitor extends EventEmitter {
    constructor() {
        super();
        this.metrics = new Map();
        this.watchers = new Map();
        this.healthTimers = new Map();
        this.containerLabels = new Map();
        this.containerInfoCache = new Map(); // Full inspect data for dependency graph
        this.lastHealthState = new Map();
        this.pollingInterval = 30000; // 30 seconds default
        this.isRunning = false;
        this.isPolling = false;
        this.timer = null;

        // Upstream feature tracking
        this.lastStorePush = new Map();
        this.securityTimers = new Map();
        this.restartCounts = new Map();
        this.containerNames = new Map();
        this.lastInspectTimes = new Map();
        this.lastPredictTimes = new Map();
        // Track container-to-host mapping for multi-host support
        this.containerHosts = new Map();
    }

    /**
     * Start monitoring a container (supports compound IDs)
     * @param {string} compoundId - Compound ID (hostId:containerId) or raw containerId
     * @param {string} hostId - Optional explicit host ID
     */
    async startMonitoring(compoundId, hostId = null) {
        // Use compound ID as the key for all maps
        if (this.watchers.has(compoundId)) return;

        // Parse compound ID to get host and container
        const parsed = hostManager.parseId(compoundId);
        const targetHostId = hostId || parsed.hostId;
        const containerId = parsed.containerId || compoundId;

        // Get the appropriate Docker client
        const client = hostManager.initialized 
            ? hostManager.getClient(targetHostId) 
            : docker;

        if (!client) {
            console.error(`[Monitor] No client available for host '${targetHostId}'`);
            return;
        }

        // 1. Listen for Docker events (lifecycle management)
        try {
            const container = client.getContainer(containerId);
            const data = await container.inspect();
            const imageId = data.Image;
            
            // Track initial restart count
            this.restartCounts.set(compoundId, data.RestartCount || 0);
            // Track container name
            this.containerNames.set(compoundId, data.Name.replace(/^\//, ''));
            // Track which host this container is on
            this.containerHosts.set(compoundId, targetHostId);

            let buffer = '';
            eventStream.on('data', (chunk) => {
                buffer += chunk.toString('utf8');
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

            this.watchers.set(compoundId, stream);

            // Schedule periodic scans after successful stream setup
            this.scheduleSecurityScan(compoundId, imageId);

            stream.on('data', async (chunk) => {
                try {
                    const stats = JSON.parse(chunk.toString());
                    const parsed = this.parseStats(stats);
                    // Add hostId to metrics
                    parsed.hostId = targetHostId;
                    this.metrics.set(compoundId, parsed);

                    // Throttle inspect requests to every 30s to update restart counts
                    const now = Date.now();
                    const lastInspect = this.lastInspectTimes.get(compoundId) || 0;
                    
                    if (now - lastInspect > 30000) {
                        this.lastInspectTimes.set(compoundId, now);  // guard before await
                        try {
                            const currentInfo = await container.inspect();
                            this.restartCounts.set(compoundId, currentInfo.RestartCount || 0);
                        } catch (inspectError) {
                            // Suppress transient inspect errors
                        }
                    } catch (e) {
                        // ignore malformed event line
                    }
                }
            });

                    const lastPredict = this.lastPredictTimes.get(compoundId) || 0;

                    if (now - lastPredict > 5000) {
                        metricsStore.push(compoundId, { 
                            cpuPercent: parsed.raw.cpuPercent, 
                            memPercent: parsed.raw.memPercent, 
                            restartCount: this.restartCounts.get(compoundId) || 0 
                        });

                        const prediction = predictContainer(compoundId);
                        if (prediction && prediction.probability > 0.3) {
                            this.emit('prediction', { 
                                ...prediction, 
                                containerName: this.containerNames.get(compoundId),
                                hostId: targetHostId
                            });
                        }
                        this.lastPredictTimes.set(compoundId, now);
                    }
                } catch (e) {
                    // Ignore parse errors from partial chunks
                }
            }

            // Parallel polling
            await Promise.allSettled(containers.map(c => this.pollSingle(c.Id)));
        } catch (error) {
            console.error('❌ Global poll failed:', error);
        } finally {
            this.isPolling = false;
        }
    }

    async pollSingle(containerId) {
        try {
            const container = docker.getContainer(containerId);
            const now = Date.now();

            stream.on('error', (err) => {
                console.error(`Stream error for ${compoundId}:`, err);
                this.stopMonitoring(compoundId);
            });

            stream.on('end', () => {
                this.stopMonitoring(compoundId);
            });

            const prediction = predictContainer(containerId);
            if (prediction && prediction.probability > 0.3) {
                this.emit('prediction', { ...prediction, containerName: this.containerNames.get(containerId) });
            }

            // 4. Smart Branch: Health Check
            await this.checkContainerHealth(containerId);

        } catch (error) {
            console.error(`Failed to start monitoring ${compoundId}:`, error);
            this.stopMonitoring(compoundId); // Clean up any timers/watchers
        }
    }

    stopMonitoring(compoundId) {
        if (this.watchers.has(compoundId)) {
            const stream = this.watchers.get(compoundId);
            if (stream && stream.destroy) stream.destroy();
            this.watchers.delete(compoundId);
            this.metrics.delete(compoundId);
            this.lastStorePush.delete(compoundId);
            if (this.lastPredictTimes) this.lastPredictTimes.delete(compoundId);
            this.restartCounts.delete(compoundId);
            this.containerNames.delete(compoundId);
            this.lastInspectTimes.delete(compoundId);
            this.containerHosts.delete(compoundId);
            metricsStore.clear(compoundId);
        }
        if (this.securityTimers.has(compoundId)) {
            clearInterval(this.securityTimers.get(compoundId));
            this.securityTimers.delete(compoundId);
        }
    }

    scheduleSecurityScan(compoundId, imageId) {
        // Run scan immediately if not cached recently (scanner internally checks cache)
        scanImage(imageId).catch(err => console.error(`[Security] Automated scan failed for ${compoundId}:`, err.message));

        // Schedule periodic scans (e.g., daily)
        const interval = 24 * 60 * 60 * 1000;
        const timer = setInterval(() => {
            scanImage(imageId).catch(err => console.error(`[Security] Periodic scan failed for ${compoundId}:`, err.message));
        }, interval);

        this.securityTimers.set(compoundId, timer);
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
            timestamp: new Date(),
            raw: {
                cpuPercent,
                memPercent,
                memLimit
            }
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

    getMetrics(compoundId) {
        return this.metrics.get(compoundId);
    }

    /**
     * Get all metrics aggregated across hosts
     * @returns {Object} Map of compoundId -> metrics
     */
    getAllMetrics() {
        return Object.fromEntries(this.metrics);
    }

    /**
     * Get metrics for a specific host
     * @param {string} hostId - Host ID
     * @returns {Object} Map of compoundId -> metrics for that host
     */
    getMetricsByHost(hostId) {
        const result = {};
        for (const [compoundId, metrics] of this.metrics) {
            if (this.containerHosts.get(compoundId) === hostId) {
                result[compoundId] = metrics;
            }
        }
        return result;
    }

    /**
     * Get host ID for a container
     * @param {string} compoundId - Container compound ID
     * @returns {string|undefined} Host ID
     */
    getContainerHost(compoundId) {
        return this.containerHosts.get(compoundId);
    }

    async checkContainerHealth(containerId) {
        try {
            const container = docker.getContainer(containerId);
            const info = await container.inspect();

            // Determine if truly unhealthy (from docker healthcheck or state)
            const isRunning = info.State.Running;
            const healthStatus = info.State.Health ? info.State.Health.Status : (isRunning ? 'healthy' : 'unhealthy');
            const isHealthy = healthStatus === 'healthy' || healthStatus === 'starting';

            const lastState = this.lastHealthState.get(containerId);
            if (lastState !== isHealthy) {
                this.lastHealthState.set(containerId, isHealthy);

                // State changed! Run through flap detector
                const flapResult = flapDetector.record(containerId, isHealthy);

                if (!isHealthy && !flapResult.suppressAlert) {
                    // Generate an alert and pass to correlator
                    const labels = this.containerLabels.get(containerId) || {};
                    const alert = { containerId, labels, type: 'container_failure', isHealthy };
                    alertCorrelator.add(alert);
                }
            }
        } catch (error) {
            if (error.statusCode === 404) {
                // Container is confirmed gone — stop polling
                console.warn(`Container ${containerId} no longer exists, stopping monitoring.`);
                this.cleanup(containerId);
            } else {
                // console.error(`Health check failed for ${containerId}:`, error.message);
            }
        }
    }

    getCorrelatedGroups() {
        // Re-derive from correlator on each call. Now that groupId is
        // deterministic, this is safe and keeps data current (respects
        // the 60-second correlation window, auto-expiring recovered groups).
        return alertCorrelator.correlate();
    }
}

module.exports = new ContainerMonitor();
