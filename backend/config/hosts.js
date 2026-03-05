const fs = require('fs');
const path = require('path');

/**
 * Validates and normalizes host entries, filtering out invalid configurations.
 * @param {*} parsed - Parsed configuration object or array
 * @returns {Array} Filtered array of valid host configurations
 */
function normalizeHosts(parsed) {
    const candidates = Array.isArray(parsed?.hosts)
        ? parsed.hosts
        : (Array.isArray(parsed) ? parsed : []);

    return candidates.filter(h =>
        h &&
        typeof h.id === 'string' &&
        typeof h.type === 'string'
    );
}

/**
 * Dynamically resolves and decodes raw environment configs and hosts.json.
 * @returns {Array} List of host configuration definitions
 */
function loadHostsConfig() {
    // 1. Check environment variable
    if (process.env.HOSTS_CONFIG) {
        try {
            const parsed = JSON.parse(process.env.HOSTS_CONFIG);
            const hosts = normalizeHosts(parsed);
            if (hosts.length) return hosts;
            console.error('HOSTS_CONFIG has no valid host entries; falling back');
        } catch (err) {
            console.error('Failed to parse HOSTS_CONFIG from environment:', err);
        }
    }

    // 2. Check hosts.json file
    const configPath = path.join(__dirname, 'hosts.json');
    if (fs.existsSync(configPath)) {
        try {
            const data = fs.readFileSync(configPath, 'utf8');
            const parsed = JSON.parse(data);
            const hosts = normalizeHosts(parsed);
            if (hosts.length) return hosts;
            console.error('hosts.json has no valid host entries; falling back');
        } catch (err) {
            console.error('Failed to parse hosts.json:', err);
        }
    }

    // 3. Fallback to default local Docker socket
    return [
        {
            id: "local",
            label: "Local Host",
            type: "local",
            socketPath: process.env.DOCKER_SOCKET || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock')
        }
    ];
}

module.exports = { loadHostsConfig };
