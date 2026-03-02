const fs = require('fs');
const path = require('path');

/**
 * Dynamically resolves and decodes raw environment configs and hosts.json.
 * @returns {Array} List of host configuration definitions
 */
function loadHostsConfig() {
    // 1. Check environment variable
    if (process.env.HOSTS_CONFIG) {
        try {
            const parsed = JSON.parse(process.env.HOSTS_CONFIG);
            return parsed.hosts && Array.isArray(parsed.hosts) ? parsed.hosts : (Array.isArray(parsed) ? parsed : [parsed]);
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
            if (parsed.hosts && Array.isArray(parsed.hosts)) {
                return parsed.hosts;
            }
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
