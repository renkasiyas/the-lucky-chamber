// ABOUTME: Unit tests for the pure parts of the covenant game orchestration (commit, secret gen, config
// ABOUTME: assembly). The end-to-end emit+fund+settle path is execution-validated on TN10 (rebuild-log).
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import { commit, generateSecret, buildPotConfig, deriveCtx, Seat } from './game-service';

const seats6 = (): Seat[] =>
  Array.from({ length: 6 }, (_, i) => ({ payoutSpkHex: `20${'0'.repeat(62)}${i}ac`, coopPubkeyHex: String(i).repeat(64) }));

describe('covenant game-service', () => {
  it('commit = SHA256(secret bytes)', () => {
    const s = 'ab'.repeat(192);
    const expected = crypto.createHash('sha256').update(Buffer.from(s, 'hex')).digest('hex');
    expect(commit(s)).toBe(expected);
  });

  it('generateSecret is a 192-byte hex string', () => {
    expect(generateSecret()).toMatch(/^[0-9a-f]{384}$/);
  });

  it('buildPotConfig assembles LC_POT_CONFIG in the expected shape', () => {
    const seats = seats6();
    const server = 's'.repeat(384);
    const seatSecrets = Array.from({ length: 6 }, (_, i) => String(i).repeat(384));
    const nonce = 'n'.repeat(64);
    const cfg: any = buildPotConfig(seats, 'houseSPK', server, seatSecrets, nonce);
    expect(cfg.payoutSpks).toEqual(seats.map((s) => s.payoutSpkHex));
    expect(cfg.houseSpk).toBe('houseSPK');
    expect(cfg.coopPubkeysHex).toEqual(seats.map((s) => s.coopPubkeyHex));
    expect(cfg.serverSecretHex).toBe(server);
    expect(cfg.seatSecretsHex).toEqual(seatSecrets);
    expect(cfg.ctxHex).toBe(nonce);
  });

  it('buildPotConfig rejects wrong seat count, secret count, and nonce size', () => {
    expect(() => buildPotConfig([], 'h', 's', [], 'n'.repeat(64))).toThrow();
    expect(() => buildPotConfig(seats6(), 'h', 's', Array(3).fill('s'), 'n'.repeat(64))).toThrow();
    expect(() => buildPotConfig(seats6(), 'h', 's', Array(6).fill('s'), 'short')).toThrow();
  });

  // deriveCtx binds the covenant ctx to the round's commitments (anti-grinding). NOTE (KSNV-158 follow-up):
  // it sorts the seat commits, so ctx is seat-order-blind while the RNG is seat-order-dependent — a full
  // provably-fair deployment must also bind a canonical seat order. This test pins the current contract.
  const sc = () => Array.from({ length: 6 }, (_, i) => crypto.createHash('sha256').update('seat' + i).digest('hex'));
  const server = () => crypto.createHash('sha256').update('server').digest('hex');

  it('deriveCtx: deterministic 32-byte ctx = SHA256(sorted(seatCommits) || serverCommit)', () => {
    const ctx = deriveCtx(sc(), server());
    expect(ctx).toMatch(/^[0-9a-f]{64}$/);
    expect(deriveCtx(sc(), server())).toBe(ctx); // deterministic
    const h = crypto.createHash('sha256');
    [...sc()].sort().forEach((c) => h.update(Buffer.from(c, 'hex')));
    h.update(Buffer.from(server(), 'hex'));
    expect(ctx).toBe(h.digest('hex'));
  });

  it('deriveCtx: changing any commit changes ctx; seat-commit order does not (sorted)', () => {
    const base = deriveCtx(sc(), server());
    const changed = sc(); changed[0] = crypto.createHash('sha256').update('other').digest('hex');
    expect(deriveCtx(changed, server())).not.toBe(base);
    expect(deriveCtx(sc(), crypto.createHash('sha256').update('other-server').digest('hex'))).not.toBe(base);
    const shuffled = sc().reverse();
    expect(deriveCtx(shuffled, server())).toBe(base); // order-independent (documented gap)
  });
});
