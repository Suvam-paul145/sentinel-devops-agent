/**
 * Secrets Initialization Module
 *
 * Pre-loads commonly used secrets into cache at application startup.
 * This ensures that getSecretSync() consumers (e.g., AuthService, DB config)
 * can access Vault-sourced secrets through the cache.
 *
 * Usage: Call initializeSecrets() before requiring modules that use getSecretSync().
 */

const { preloadSecrets } = require('./secrets');

const PRELOAD_KEYS = [
  'JWT_SECRET',
  'JWT_ACCESS_EXPIRY',
  'JWT_REFRESH_EXPIRY',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'GROQ_API_KEY',
];

/**
 * Initialize secrets by pre-loading them from Vault (or env fallback) into cache.
 * Must be called before any module that uses getSecretSync().
 */
async function initializeSecrets() {
  await preloadSecrets(PRELOAD_KEYS);
}

module.exports = { initializeSecrets };
