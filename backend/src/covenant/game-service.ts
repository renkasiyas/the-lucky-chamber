// ABOUTME: Backend covenant game orchestration — generation lives server-side (locked architecture:
// ABOUTME: generate=server/Rust, verify=client). Given a roster, produces the covenant artifact by shelling
// ABOUTME: to the prebuilt Rust `deploy_artifacts` bin. TEST/bot mode generates secrets; production takes
// ABOUTME: player commits (clients generate their own secrets). Clients never build scripts — they verify.

import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const R = 6;
const SHARD = 32;
const SECRET_BYTES = R * SHARD; // 192
const N_SEATS = 6;

/** One seat's on-chain identity for the covenant. */
export interface Seat {
  /** scriptPubKey (script bytes hex, version 0) this seat is paid to (from the player's wallet address) */
  payoutSpkHex: string;
  /** x-only pubkey (hex) for the N-of-N coop-abort branch */
  coopPubkeyHex: string;
}

export interface GameParams {
  stake: bigint;
  fee: bigint;
  d1: number;
  d2: number;
}

export interface BuiltGame {
  /** emitted artifact (redeemScriptHex, potScriptPublicKey, paths[], params, ...) */
  artifact: any;
  /** the server's RNG contribution (server holds this) */
  serverSecretHex: string;
  /** per-seat 192B secrets. TEST/bot mode: generated here. Production: reconstructed from player reveals. */
  seatSecretsHex: string[];
  /** the room-nonce used as the RNG ctx (locked decision: ctx = room-nonce) */
  roomNonceHex: string;
}

/** 192-byte secret from a CSPRNG (R shards of 32B). */
export function generateSecret(): string {
  return crypto.randomBytes(SECRET_BYTES).toString('hex');
}

/** commit = SHA256(secret) — what a player publishes during matchmaking. */
export function commit(secretHex: string): string {
  return crypto.createHash('sha256').update(Buffer.from(secretHex, 'hex')).digest('hex');
}

/** Path to the prebuilt Rust emitter (override with LC_HARNESS_BIN; prod ships it in the image). */
function harnessBin(): string {
  if (process.env.LC_HARNESS_BIN) return process.env.LC_HARNESS_BIN;
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../covenant-harness/lc-harness-target/release/deploy_artifacts');
}

/**
 * Compile the covenant blob for this game by shelling to the prebuilt Rust emitter.
 * The bin re-executes every emitted path on the v2.0.1 VM and exits non-zero if any fails, so a
 * returned artifact is VM-self-verified. Diagnostics go to our stderr; the artifact is read from LC_OUT.
 */
export function emitArtifact(config: object, params: GameParams): any {
  const tmp = path.join(os.tmpdir(), `lc-${crypto.randomBytes(8).toString('hex')}`);
  const cfgPath = `${tmp}.cfg.json`;
  const outPath = `${tmp}.artifact.json`;
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  try {
    execFileSync(harnessBin(), [], {
      env: {
        ...process.env,
        LC_POT_CONFIG: cfgPath,
        LC_STAKE: params.stake.toString(),
        LC_FEE: params.fee.toString(),
        LC_D1: String(params.d1),
        LC_D2: String(params.d2),
        LC_OUT: outPath,
      },
      stdio: ['ignore', 'ignore', 'inherit'],
      maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } finally {
    for (const f of [cfgPath, outPath]) {
      try {
        fs.unlinkSync(f);
      } catch {
        /* ignore */
      }
    }
  }
}

/** Assemble the LC_POT_CONFIG for a roster. Pure — testable without shelling out. */
export function buildPotConfig(
  seats: Seat[],
  treasurySpkHex: string,
  serverSecretHex: string,
  seatSecretsHex: string[],
  roomNonceHex: string
): object {
  if (seats.length !== N_SEATS) throw new Error(`expected ${N_SEATS} seats, got ${seats.length}`);
  if (seatSecretsHex.length !== N_SEATS) throw new Error(`expected ${N_SEATS} seat secrets`);
  if (roomNonceHex.length !== 64) throw new Error('roomNonce must be 32 bytes');
  return {
    payoutSpks: seats.map((s) => s.payoutSpkHex),
    houseSpk: treasurySpkHex,
    ctxHex: roomNonceHex,
    serverSecretHex,
    seatSecretsHex,
    coopPubkeysHex: seats.map((s) => s.coopPubkeyHex),
  };
}

/**
 * Build a covenant game for a roster. TEST/bot mode (no `secrets`): the server generates per-seat secrets so
 * an autonomous bot game can play. Production: pass `secrets` reconstructed from player reveals (server holds
 * only its own). ctx = a fresh room-nonce (locked decision).
 */
export function buildGame(
  seats: Seat[],
  treasurySpkHex: string,
  params: GameParams,
  secrets?: { serverSecretHex: string; seatSecretsHex: string[] }
): BuiltGame {
  const serverSecretHex = secrets?.serverSecretHex ?? generateSecret();
  const seatSecretsHex = secrets?.seatSecretsHex ?? seats.map(() => generateSecret());
  const roomNonceHex = crypto.randomBytes(32).toString('hex');
  const config = buildPotConfig(seats, treasurySpkHex, serverSecretHex, seatSecretsHex, roomNonceHex);
  const artifact = emitArtifact(config, params);
  return { artifact, serverSecretHex, seatSecretsHex, roomNonceHex };
}
