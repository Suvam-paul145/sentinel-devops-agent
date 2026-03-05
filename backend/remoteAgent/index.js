/**
 * Sentinel Remote Agent
 * 
 * A lightweight Node.js process that can be deployed on remote hosts to:
 * 1. Expose a /metrics endpoint for local health data collection
 * 2. Forward health data back to the central Sentinel backend via a webhook
 * 
 * Usage:
 *   SENTINEL_BACKEND=http://central-sentinel:4000 \
 *   AGENT_SECRET=your-webhook-secret \
 *   CLUSTER_ID=prod-eu \
 *   node remoteAgent/index.js
 */

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// Configuration from environment
const config = {
  port: parseInt(process.env.AGENT_PORT || '5000', 10),
  sentinelBackend: process.env.SENTINEL_BACKEND || 'http://localhost:4000',
  webhookSecret: process.env.AGENT_SECRET || '',
  clusterId: process.env.CLUSTER_ID || 'remote-agent',
  clusterName: process.env.CLUSTER_NAME || 'Remote Agent',
  region: process.env.REGION || 'unknown',
  reportIntervalMs: parseInt(process.env.REPORT_INTERVAL_MS || '30000', 10),
  localServicesConfig: process.env.LOCAL_SERVICES ? JSON.parse(process.env.LOCAL_SERVICES) : []
};

// In-memory health state
let healthState = {
  clusterId: config.clusterId,
  clusterName: config.clusterName,
  region: config.region,
  lastUpdated: new Date().toISOString(),
  services: {}
};

/**
 * Generate HMAC signature for webhook payload
 */
function generateSignature(payload, secret) {
  if (!secret) return '';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(JSON.stringify(payload));
  return 'sha256=' + hmac.digest('hex');
}

/**
 * Check health of a single service
 */
async function checkServiceHealth(service) {
  const start = Date.now();
  try {
    const response = await axios.get(service.url, { timeout: 10000 });
    const duration = Date.now() - start;
    return {
      name: service.name,
      status: 'healthy',
      code: response.status,
      latencyMs: duration,
      lastUpdated: new Date().toISOString()
    };
  } catch (error) {
    const duration = Date.now() - start;
    const code = error.response?.status || 503;
    return {
      name: service.name,
      status: code >= 500 ? 'critical' : 'degraded',
      code,
      latencyMs: duration,
      error: error.code || error.message,
      lastUpdated: new Date().toISOString()
    };
  }
}

/**
 * Check all configured services
 */
async function checkAllServices() {
  const results = {};
  
  for (const service of config.localServicesConfig) {
    const health = await checkServiceHealth(service);
    results[service.name] = health;
  }
  
  healthState.services = results;
  healthState.lastUpdated = new Date().toISOString();
  
  return results;
}

/**
 * Report health data to central Sentinel backend
 */
async function reportToCentral() {
  if (!config.sentinelBackend) {
    console.log('[Agent] No SENTINEL_BACKEND configured, skipping report');
    return;
  }

  try {
    const payload = {
      type: 'agent_report',
      clusterId: config.clusterId,
      clusterName: config.clusterName,
      region: config.region,
      timestamp: new Date().toISOString(),
      services: healthState.services
    };

    const signature = generateSignature(payload, config.webhookSecret);
    
    const headers = {
      'Content-Type': 'application/json',
      'X-Sentinel-Agent-Id': config.clusterId
    };
    
    if (signature) {
      headers['X-Sentinel-Signature'] = signature;
    }

    await axios.post(
      `${config.sentinelBackend}/api/remote-agent/report`,
      payload,
      { headers, timeout: 10000 }
    );
    
    console.log(`[Agent] Reported health data to ${config.sentinelBackend}`);
  } catch (error) {
    console.error(`[Agent] Failed to report to central: ${error.message}`);
  }
}

// ============================================
// API Endpoints
// ============================================

/**
 * GET /health - Agent health check
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    clusterId: config.clusterId,
    clusterName: config.clusterName,
    region: config.region,
    uptime: process.uptime()
  });
});

/**
 * GET /metrics - Get current health metrics
 */
app.get('/metrics', (req, res) => {
  res.json(healthState);
});

/**
 * POST /refresh - Trigger immediate health check
 */
app.post('/refresh', async (req, res) => {
  try {
    const results = await checkAllServices();
    res.json({
      success: true,
      services: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /configure - Update local services configuration
 */
app.post('/configure', (req, res) => {
  const { services } = req.body;
  
  if (!Array.isArray(services)) {
    return res.status(400).json({ error: 'services must be an array' });
  }
  
  config.localServicesConfig = services;
  console.log(`[Agent] Updated services configuration: ${services.length} services`);
  
  res.json({
    success: true,
    servicesCount: services.length
  });
});

/**
 * GET /config - Get current agent configuration (without secrets)
 */
app.get('/config', (req, res) => {
  res.json({
    clusterId: config.clusterId,
    clusterName: config.clusterName,
    region: config.region,
    sentinelBackend: config.sentinelBackend,
    reportIntervalMs: config.reportIntervalMs,
    servicesCount: config.localServicesConfig.length
  });
});

// ============================================
// Startup
// ============================================

/**
 * Start the remote agent
 */
function startAgent() {
  // Start periodic health checking
  if (config.localServicesConfig.length > 0) {
    checkAllServices(); // Initial check
    setInterval(checkAllServices, Math.min(config.reportIntervalMs, 5000));
  }

  // Start periodic reporting to central
  if (config.sentinelBackend) {
    setInterval(reportToCentral, config.reportIntervalMs);
  }

  // Start HTTP server
  app.listen(config.port, () => {
    console.log(`
╔══════════════════════════════════════════════════════════╗
║           SENTINEL REMOTE AGENT                          ║
╠══════════════════════════════════════════════════════════╣
║ Port:           ${String(config.port).padEnd(41)}║
║ Cluster ID:     ${config.clusterId.padEnd(41)}║
║ Region:         ${config.region.padEnd(41)}║
║ Backend:        ${config.sentinelBackend.substring(0, 41).padEnd(41)}║
║ Services:       ${String(config.localServicesConfig.length).padEnd(41)}║
╚══════════════════════════════════════════════════════════╝
    `);
  });
}

// Export for testing
module.exports = {
  app,
  checkServiceHealth,
  checkAllServices,
  reportToCentral,
  generateSignature,
  config,
  startAgent
};

// Run if executed directly
if (require.main === module) {
  startAgent();
}
