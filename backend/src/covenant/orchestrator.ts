// ABOUTME: Stateful per-room covenant lifecycle service (KSNV-158). Ports the TN10-proven sequence
// ABOUTME: (buildGame -> prep exact-value UTXOs -> assemble ANYONECANPAY join -> sign 0x81 -> broadcast
// ABOUTME: join -> signature-free RESOLVE settle) from scripts/covenant-tn10.ts into a service the game
// ABOUTME: state machine drives. Bots sign via the Rust fund_sign ground-truth signer; humans sign via
// ABOUTME: Kasware signPskt(0x81) in the browser and hand the scriptSig back. Custody = the L1 P2SH pot.

import { execFileSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { config, covenant } from '../config.js'
import { logger } from '../utils/logger.js'
import { kaspaClient } from '../crypto/kaspa-client.js'
import {
  buildGame,
  deriveCtx,
  commit,
  generateSecret,
  type Seat,
} from './game-service.js'
import { assembleFundingPskt, type FundingContribution } from './pskt.js'

// kaspa-wasm resolves to vendor/kaspa-wasm (see package.json), same module kaspa-client.ts loads.
let wasm: any = null
async function loadWasm(): Promise<any> {
  if (!wasm) wasm = await import('kaspa-wasm')
  return wasm
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SUBNET_ZERO = '0'.repeat(40)

/** The Rust ground-truth 0x81 signer (self-verifies each input on the v2.0.1 VM before returning). */
function fundSignBin(): string {
  if (covenant.harnessBin) return path.join(path.dirname(covenant.harnessBin), 'fund_sign')
  return path.resolve(HERE, '../../../covenant-harness/lc-harness-target/release/fund_sign')
}

export interface CovenantSeat {
  seatIndex: number
  /** payout/refund destination (bot address, or the human's connected wallet address) */
  address: string
  payoutSpkHex: string
  /** x-only pubkey (hex) for the N-of-N coop-abort branch */
  coopPubkeyHex: string
  isBot: boolean
  /** bots only: server-held signing key (hex). Never set for humans. */
  botPrivHex?: string
  /** 192B secret. Bots: server-generated at seat add. Humans: revealed by the client before emit. */
  secretHex?: string
  commitHex?: string
  /** the exact-value UTXO this seat contributes to the join */
  prepped?: { transactionId: string; index: number; amount: bigint }
  /** filled once the 0x81 join input is signed (bot: fund_sign, human: Kasware) */
  signedScriptSigHex?: string
}

interface CovenantGame {
  roomId: string
  stake: bigint
  pot: bigint
  fee: bigint
  fundFee: bigint
  perInput: bigint
  d1: number
  d2: number
  seats: CovenantSeat[]
  serverSecretHex: string
  serverCommitHex: string
  // filled by prepareAndEmit
  artifact?: any
  potSpk?: { version: number; scriptHex: string }
  potAddress?: string
  victimSeat?: number
  ctxHex?: string
  // filled by the join/settle phases
  joinTxid?: string
  settleTxid?: string
}

const N_SEATS = 6

export class CovenantOrchestrator {
  private games = new Map<string, CovenantGame>()

  has(roomId: string): boolean {
    return this.games.has(roomId)
  }

  get(roomId: string): CovenantGame | undefined {
    return this.games.get(roomId)
  }

  /** Start a covenant game for a room. Server generates its own secret + commit up front. */
  initGame(roomId: string, stakeSompi: bigint): CovenantGame {
    if (this.games.has(roomId)) return this.games.get(roomId)!
    const pot = BigInt(N_SEATS) * stakeSompi
    const fundFee = covenant.fundFeeSompi
    // ceil(fundFee / N) so Σ inputs >= pot + fundFee
    const perInput = stakeSompi + (fundFee + BigInt(N_SEATS) - 1n) / BigInt(N_SEATS)
    const serverSecretHex = generateSecret()
    const game: CovenantGame = {
      roomId,
      stake: stakeSompi,
      pot,
      fee: covenant.feeSompi,
      fundFee,
      perInput,
      d1: covenant.d1,
      d2: covenant.d2,
      seats: [],
      serverSecretHex,
      serverCommitHex: commit(serverSecretHex),
    }
    this.games.set(roomId, game)
    logger.info('[covenant] initGame', { roomId, stake: stakeSompi.toString(), pot: pot.toString(), perInput: perInput.toString() })
    return game
  }

  /** Add a bot seat: derive its keypair from the wallet mnemonic (matches the proven scripts' botKeypair)
   *  and generate its 192B secret server-side. */
  async addBotSeat(roomId: string, seatIndex: number, botId: string): Promise<CovenantSeat> {
    const game = this.require(roomId)
    const w = await loadWasm()
    const kp = await this.botKeypair(botId)
    const payoutSpkHex = (w.payToAddressScript(new w.Address(kp.address)).script as string)
    const secretHex = generateSecret()
    const seat: CovenantSeat = {
      seatIndex,
      address: kp.address,
      payoutSpkHex,
      coopPubkeyHex: kp.xOnly,
      isBot: true,
      botPrivHex: kp.privHex,
      secretHex,
      commitHex: commit(secretHex),
    }
    this.upsertSeat(game, seat)
    return seat
  }

  /** Add a human seat. The client generates its own 192B secret and publishes only the COMMIT at join;
   *  the secret is revealed later (revealHumanSecret) before the artifact is emitted. */
  async addHumanSeat(
    roomId: string,
    seatIndex: number,
    walletAddress: string,
    coopPubkeyHex: string,
    commitHex: string
  ): Promise<CovenantSeat> {
    const game = this.require(roomId)
    const w = await loadWasm()
    const payoutSpkHex = (w.payToAddressScript(new w.Address(walletAddress)).script as string)
    let xOnly = coopPubkeyHex.replace(/^0x/, '').toLowerCase()
    if (xOnly.length === 66) xOnly = xOnly.slice(2) // strip 33-byte compressed prefix
    if (xOnly.length !== 64) throw new Error(`bad human pubkey length ${xOnly.length}`)
    const seat: CovenantSeat = {
      seatIndex,
      address: walletAddress,
      payoutSpkHex,
      coopPubkeyHex: xOnly,
      isBot: false,
      commitHex,
    }
    this.upsertSeat(game, seat)
    return seat
  }

  /** Verify a human's revealed secret matches their committed hash, then store it. */
  revealHumanSecret(roomId: string, seatIndex: number, secretHex: string): void {
    const game = this.require(roomId)
    const seat = game.seats.find((s) => s.seatIndex === seatIndex)
    if (!seat) throw new Error(`seat ${seatIndex} not found`)
    if (seat.isBot) throw new Error(`seat ${seatIndex} is a bot`)
    if (commit(secretHex) !== seat.commitHex) throw new Error('human reveal does not match committed hash')
    seat.secretHex = secretHex
  }

  /** All N seats present and every seat has a secret (bots always; humans after reveal). */
  readyToEmit(roomId: string): boolean {
    const game = this.games.get(roomId)
    if (!game) return false
    return game.seats.length === N_SEATS && game.seats.every((s) => !!s.secretHex)
  }

  /**
   * Emit the covenant artifact from all seat secrets: derive ctx = H(commits), buildGame (VM-self-verified),
   * store the pot P2SH + baked RESOLVE victim. Must run BEFORE funding (players fund INTO the pot P2SH).
   */
  async prepareAndEmit(roomId: string): Promise<{ potAddress: string; victimSeat: number; potSpk: any }> {
    const game = this.require(roomId)
    if (game.seats.length !== N_SEATS) throw new Error(`need ${N_SEATS} seats, have ${game.seats.length}`)
    const ordered = [...game.seats].sort((a, b) => a.seatIndex - b.seatIndex)
    const w = await loadWasm()

    const seats: Seat[] = ordered.map((s) => ({ payoutSpkHex: s.payoutSpkHex, coopPubkeyHex: s.coopPubkeyHex }))
    const seatSecretsHex = ordered.map((s) => s.secretHex!)
    const treasurySpkHex = (w.payToAddressScript(new w.Address(config.treasuryAddress)).script as string)

    const built = buildGame(
      seats,
      treasurySpkHex,
      { stake: game.stake, fee: game.fee, d1: game.d1, d2: game.d2 },
      { serverSecretHex: game.serverSecretHex, seatSecretsHex }
    )
    const potSpk = built.artifact.potScriptPublicKey
    const victim = built.artifact.paths.find((p: any) => p.name === 'resolve').victimSeat
    const potAddress = w
      .addressFromScriptPublicKey({ version: potSpk.version, script: potSpk.scriptHex }, config.network)
      .toString()

    game.artifact = built.artifact
    game.potSpk = potSpk
    game.potAddress = potAddress
    game.victimSeat = victim
    game.ctxHex = built.roomNonceHex
    logger.info('[covenant] artifact emitted', { roomId, potAddress, victimSeat: victim, ctx: game.ctxHex.slice(0, 16) })
    return { potAddress, victimSeat: victim, potSpk }
  }

  /** For a bot seat: prep an exact-value UTXO of `perInput` (self-send split), proven manual v0 tx. */
  async prepBotUtxo(roomId: string, seatIndex: number): Promise<void> {
    const game = this.require(roomId)
    const seat = game.seats.find((s) => s.seatIndex === seatIndex)
    if (!seat || !seat.isBot) throw new Error(`seat ${seatIndex} is not a bot`)
    const w = await loadWasm()
    const rpc = kaspaClient.getRpcClient()
    const addr = new w.Address(seat.address)
    const spkHex = w.payToAddressScript(addr).script as string
    const PREP_FEE = 300_000n

    const { utxos } = await kaspaClient.getUtxosByAddress(seat.address)
    const src = utxos
      .map((e: any) => ({ e, amt: BigInt(e.amount) }))
      .sort((a: any, b: any) => (a.amt > b.amt ? -1 : 1))[0]
    if (!src || src.amt < game.perInput + PREP_FEE + 20_000_000n) {
      throw new Error(`bot seat ${seatIndex} (${seat.address}): no UTXO large enough to split (have ${src?.amt})`)
    }
    const change = src.amt - game.perInput - PREP_FEE
    const prepInput = {
      previousOutpoint: { transactionId: src.e.outpoint.transactionId, index: src.e.outpoint.index },
      signatureScript: '',
      sequence: 0n,
      sigOpCount: 1,
      utxo: {
        address: seat.address,
        outpoint: { transactionId: src.e.outpoint.transactionId, index: src.e.outpoint.index },
        amount: src.amt,
        scriptPublicKey: { version: 0, script: spkHex },
        blockDaaScore: 0n,
        isCoinbase: false,
      },
    }
    const prepOutputs = [
      { value: game.perInput, scriptPublicKey: { version: 0, script: spkHex } },
      { value: change, scriptPublicKey: { version: 0, script: spkHex } },
    ]
    const prepTx = new w.Transaction({
      version: 0,
      inputs: [prepInput],
      outputs: prepOutputs,
      lockTime: 0n,
      subnetworkId: SUBNET_ZERO,
      gas: 0n,
      payload: '',
    })
    const sigPush: string = w.createInputSignature(prepTx, 0, new w.PrivateKey(seat.botPrivHex), w.SighashType.All)
    const signedInput = { ...prepInput, signatureScript: sigPush }
    delete (signedInput as any).utxo
    const txid = await this.submitV0(rpc, w, [signedInput], prepOutputs, 0n)
    seat.prepped = { transactionId: txid, index: 0, amount: game.perInput }
    logger.info('[covenant] bot prepped exact UTXO', { roomId, seatIndex, txid, perInput: game.perInput.toString() })
  }

  /** Record a human seat's prepped UTXO. Server locates the exact-value UTXO the client's prep self-send
   *  created (amount === perInput at the human's address). */
  async findHumanPreppedUtxo(roomId: string, seatIndex: number): Promise<boolean> {
    const game = this.require(roomId)
    const seat = game.seats.find((s) => s.seatIndex === seatIndex)
    if (!seat || seat.isBot) throw new Error(`seat ${seatIndex} is not a human`)
    const { utxos } = await kaspaClient.getUtxosByAddress(seat.address)
    const match = utxos.find((e: any) => BigInt(e.amount) === game.perInput)
    if (!match) return false
    seat.prepped = {
      transactionId: match.outpoint.transactionId,
      index: match.outpoint.index,
      amount: game.perInput,
    }
    logger.info('[covenant] human prepped UTXO found', { roomId, seatIndex, txid: match.outpoint.transactionId })
    return true
  }

  /**
   * Assemble the funding join from all prepped UTXOs (validates via assembleFundingPskt), build the join
   * Transaction, and return the safe-JSON for any human seat to sign (0x81 over the frozen output set).
   */
  async assembleJoinForSigning(roomId: string): Promise<{ txJsonString: string; humanSeatIndexes: number[] }> {
    const game = this.require(roomId)
    if (!game.potSpk) throw new Error('artifact not emitted yet')
    const ordered = [...game.seats].sort((a, b) => a.seatIndex - b.seatIndex)
    if (ordered.some((s) => !s.prepped)) throw new Error('not all seats have prepped UTXOs')
    const w = await loadWasm()

    const contributions: FundingContribution[] = ordered.map((s) => ({
      outpoint: { transactionId: s.prepped!.transactionId, index: s.prepped!.index },
      utxoAmount: s.prepped!.amount,
      utxoScriptPublicKey: { version: 0, scriptHex: (w.payToAddressScript(new w.Address(s.address)).script as string) },
      playerAddress: s.address,
    }))
    // validates frozen output set + N 0x81 inputs + funding invariants (throws on violation)
    assembleFundingPskt({
      contributions,
      pot: { scriptPublicKey: { version: game.potSpk.version, scriptHex: game.potSpk.scriptHex }, amount: game.pot },
      feeFloor: game.fundFee,
      stake: game.stake,
      expectedN: N_SEATS,
    })

    const txInputs = ordered.map((s) => ({
      previousOutpoint: { transactionId: s.prepped!.transactionId, index: s.prepped!.index },
      signatureScript: '',
      sequence: 0n,
      sigOpCount: 1,
      utxo: {
        address: s.address,
        outpoint: { transactionId: s.prepped!.transactionId, index: s.prepped!.index },
        amount: s.prepped!.amount,
        scriptPublicKey: { version: 0, script: (w.payToAddressScript(new w.Address(s.address)).script as string) },
        blockDaaScore: 0n,
        isCoinbase: false,
      },
    }))
    const signTx = new w.Transaction({
      version: 0,
      inputs: txInputs,
      outputs: [{ value: game.pot, scriptPublicKey: { version: game.potSpk.version, script: game.potSpk.scriptHex } }],
      lockTime: 0n,
      subnetworkId: SUBNET_ZERO,
      gas: 0n,
      payload: '',
    })
    return {
      txJsonString: signTx.serializeToSafeJSON(),
      humanSeatIndexes: ordered.filter((s) => !s.isBot).map((s) => s.seatIndex),
    }
  }

  /** Record a human's signed join input. Fails fast if Kasware emitted the wrong wire hashtype
   *  (v2.0.1 rejects anything but 0x81 for ALL|ANYONECANPAY). */
  submitHumanSignedInput(roomId: string, seatIndex: number, scriptSigHex: string): void {
    const game = this.require(roomId)
    const seat = game.seats.find((s) => s.seatIndex === seatIndex)
    if (!seat || seat.isBot) throw new Error(`seat ${seatIndex} is not a human`)
    if (!scriptSigHex || scriptSigHex.length < 100) throw new Error(`human scriptSig missing/short: ${scriptSigHex}`)
    if (scriptSigHex.slice(-2).toLowerCase() !== '81') {
      throw new Error(`human scriptSig hashtype is 0x${scriptSigHex.slice(-2)}, expected 0x81 (SIGHASH_ALL|ANYONECANPAY)`)
    }
    seat.signedScriptSigHex = scriptSigHex
  }

  /** Sign all bot join inputs via the Rust fund_sign 0x81 signer (self-verified on the v2.0.1 VM). */
  signBotInputs(roomId: string): void {
    const game = this.require(roomId)
    if (!game.potSpk) throw new Error('artifact not emitted yet')
    const bots = game.seats.filter((s) => s.isBot).sort((a, b) => a.seatIndex - b.seatIndex)
    if (bots.some((s) => !s.prepped)) throw new Error('not all bots prepped')
    const spec = {
      version: 0,
      lockTime: '0',
      outputs: [{ value: game.pot.toString(), spkVersion: game.potSpk.version, spkHex: game.potSpk.scriptHex }],
      inputs: bots.map((s) => ({
        txid: s.prepped!.transactionId,
        index: s.prepped!.index,
        sequence: '0',
        sigOpCount: 1,
        utxoAmount: s.prepped!.amount.toString(),
        utxoSpkVersion: 0,
        utxoSpkHex: (this.spkForBotSync(s)),
        privHex: s.botPrivHex,
      })),
    }
    const parsed = JSON.parse(
      execFileSync(fundSignBin(), [], { input: JSON.stringify(spec), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim()
    )
    if (!parsed.selfVerified) throw new Error('fund_sign did not self-verify bot inputs')
    // fund_sign returns inputs in the order given; map back to seats by position
    parsed.inputs.forEach((si: any) => {
      const seat = bots[si.inputIndex]
      seat.signedScriptSigHex = si.scriptSigHex
    })
  }

  /** Combine all signed inputs (seat order) and broadcast the join tx. Until this lands, nobody has paid. */
  async broadcastJoin(roomId: string): Promise<string> {
    const game = this.require(roomId)
    if (!game.potSpk) throw new Error('artifact not emitted yet')
    const ordered = [...game.seats].sort((a, b) => a.seatIndex - b.seatIndex)
    if (ordered.some((s) => !s.signedScriptSigHex)) throw new Error('not all inputs signed')
    const w = await loadWasm()
    const rpc = kaspaClient.getRpcClient()
    const inputs = ordered.map((s) => ({
      previousOutpoint: { transactionId: s.prepped!.transactionId, index: s.prepped!.index },
      signatureScript: s.signedScriptSigHex,
      sequence: 0n,
      sigOpCount: 1,
    }))
    const outputs = [{ value: game.pot, scriptPublicKey: { version: game.potSpk.version, script: game.potSpk.scriptHex } }]
    const txid = await this.submitV0(rpc, w, inputs, outputs, 0n)
    game.joinTxid = txid
    logger.info('[covenant] JOIN broadcast', { roomId, txid })
    return txid
  }

  /** Broadcast the signature-free RESOLVE settle: spends the pot, outputs script-forced to survivors + house. */
  async broadcastSettle(roomId: string): Promise<string> {
    const game = this.require(roomId)
    if (!game.artifact || !game.joinTxid) throw new Error('cannot settle before join')
    const w = await loadWasm()
    const rpc = kaspaClient.getRpcClient()
    const rp = game.artifact.paths.find((p: any) => p.name === 'resolve')
    if (!rp || !rp.signatureFree) throw new Error('resolve path missing / not signature-free')
    const sigops = Math.max(1, Math.ceil((rp.usedScriptUnits - 9999) / 100000))
    const inputs = [
      {
        previousOutpoint: { transactionId: game.joinTxid, index: 0 },
        signatureScript: rp.scriptSigHex,
        sequence: 0n,
        sigOpCount: sigops,
      },
    ]
    const outputs = rp.outputs.map((o: any) => ({
      value: BigInt(o.value),
      scriptPublicKey: { version: o.version, script: o.scriptHex },
    }))
    const txid = await this.submitV0(rpc, w, inputs, outputs, BigInt(rp.lockTime))
    game.settleTxid = txid
    logger.info('[covenant] SETTLE (RESOLVE) broadcast', { roomId, txid, victimSeat: game.victimSeat })
    return txid
  }

  /** The baked RESOLVE victim seat index — the PLAYING loop must make THIS seat die so UI == on-chain. */
  victimSeatIndex(roomId: string): number | undefined {
    return this.games.get(roomId)?.victimSeat
  }

  /** The per-survivor RESOLVE payout in sompi, read from the baked artifact (the modal/most-frequent
   *  output value — survivors get equal shares; the treasury output is the lone different one). Lets the
   *  UI show the ACTUAL on-chain amount instead of the custodial formula. */
  resolvePerSurvivorSompi(roomId: string): bigint {
    const g = this.require(roomId)
    const rp = g.artifact?.paths?.find((p: any) => p.name === 'resolve')
    if (!rp) throw new Error('no resolve path in artifact')
    const counts = new Map<string, number>()
    for (const o of rp.outputs) {
      const k = String(o.value)
      counts.set(k, (counts.get(k) || 0) + 1)
    }
    let best = String(rp.outputs[0].value)
    let bestCount = 0
    for (const [k, c] of counts) {
      if (c > bestCount) {
        bestCount = c
        best = k
      }
    }
    return BigInt(best)
  }

  /** join / settle txids for a room (for the game record + UI). */
  txids(roomId: string): { joinTxid?: string; settleTxid?: string; potAddress?: string } {
    const g = this.games.get(roomId)
    return { joinTxid: g?.joinTxid, settleTxid: g?.settleTxid, potAddress: g?.potAddress }
  }

  cleanup(roomId: string): void {
    this.games.delete(roomId)
  }

  // ---- internals ----

  private require(roomId: string): CovenantGame {
    const g = this.games.get(roomId)
    if (!g) throw new Error(`no covenant game for room ${roomId}`)
    return g
  }

  private upsertSeat(game: CovenantGame, seat: CovenantSeat): void {
    const i = game.seats.findIndex((s) => s.seatIndex === seat.seatIndex)
    if (i >= 0) game.seats[i] = seat
    else game.seats.push(seat)
  }

  private spkForBotSync(seat: CovenantSeat): string {
    // payoutSpkHex is the seat's P2PK spk == the utxo spk (bot funds from its own address)
    return seat.payoutSpkHex
  }

  private async submitV0(rpc: any, w: any, inputs: any[], outputs: any[], lockTime: bigint): Promise<string> {
    const tx = new w.Transaction({
      version: 0,
      inputs,
      outputs,
      lockTime,
      subnetworkId: SUBNET_ZERO,
      gas: 0n,
      payload: '',
    })
    const { transactionId } = await rpc.submitTransaction({ transaction: tx, allowOrphan: false })
    return transactionId
  }

  private async botKeypair(botId: string): Promise<{ address: string; privHex: string; xOnly: string }> {
    const w = await loadWasm()
    const xprv = new w.XPrv(new w.Mnemonic(config.walletMnemonic).toSeed())
    const hash = crypto.createHash('sha256').update(botId).digest()
    const index = hash.readUInt32BE(0) % 0x80000000
    const pk = xprv
      .deriveChild(44, true)
      .deriveChild(111111, true)
      .deriveChild(0, true)
      .deriveChild(0, false)
      .deriveChild(index, false)
      .toPrivateKey()
    return {
      address: pk.toAddress(config.network).toString(),
      privHex: pk.toString(),
      xOnly: pk.toKeypair().xOnlyPublicKey.toString() as string,
    }
  }
}

export const covenantOrchestrator = new CovenantOrchestrator()
