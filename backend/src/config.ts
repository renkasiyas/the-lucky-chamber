// ABOUTME: Configuration loader for backend environment variables
// ABOUTME: Validates and exports config for Kaspa network, wallet, and server settings

import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { Network, type Config } from '../../shared/index.js'
import { logger } from './utils/logger.js'

// Determine env file based on NODE_ENV
const nodeEnv = process.env.NODE_ENV || 'local'
const envMap: Record<string, string> = {
  production: '.env.prod',
  development: '.env.dev',
  local: '.env.local',
}
const envFile = envMap[nodeEnv] || '.env.local'

// Load the appropriate env file
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const envPath = path.resolve(__dirname, '..', envFile)
dotenv.config({ path: envPath })

function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] || defaultValue
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

function getEnvNumber(key: string, defaultValue: number): number {
  const value = process.env[key]
  if (!value) return defaultValue
  const num = parseInt(value, 10)
  if (isNaN(num)) {
    throw new Error(`Invalid number for environment variable ${key}: ${value}`)
  }
  return num
}

function getEnvBoolean(key: string, defaultValue: boolean): boolean {
  const value = process.env[key]
  if (!value) return defaultValue
  return value.toLowerCase() === 'true' || value === '1'
}

export const config: Config & { botsEnabled: boolean } = {
  network: getEnv('NETWORK', Network.TESTNET) as Network,
  rpcUrl: '', // Not used - Resolver auto-discovers nodes
  walletMnemonic: getEnv('WALLET_MNEMONIC'),
  treasuryAddress: getEnv('TREASURY_ADDRESS'),
  houseCutPercent: getEnvNumber('HOUSE_CUT_PERCENT', 5),
  port: getEnvNumber('PORT', 4201),
  botsEnabled: getEnvBoolean('BOTS_ENABLED', false),
}

// Validation
if (![Network.MAINNET, Network.TESTNET].includes(config.network)) {
  throw new Error(`Invalid NETWORK: ${config.network}. Must be 'mainnet' or 'testnet-10'`)
}

if (config.houseCutPercent < 0 || config.houseCutPercent > 100) {
  throw new Error(`Invalid HOUSE_CUT_PERCENT: ${config.houseCutPercent}. Must be 0-100`)
}

logger.info(`Config loaded`, {
  envFile,
  nodeEnv,
  network: config.network,
  port: config.port,
  houseCutPercent: config.houseCutPercent,
  treasury: config.treasuryAddress,
})
