// Full Russian Roulette game simulation with 6 AI players
import kaspaWasm from "kaspa-wasm";
import WebSocket from "ws";

const {
  RpcClient, Resolver, XPrv, Mnemonic, PrivateKeyGenerator,
  createTransactions, payToAddressScript
} = kaspaWasm;

const PLAYERS = [
  { name: "Claude", mnemonic: "brush urban marble audit ecology laundry rhythm chalk squirrel sorry mixed juice recipe element bar food system scorpion deal knock endorse hurt owner glance" },
  { name: "Opus", mnemonic: "aerobic popular neither smile night uncover local rubber embark gadget month unlock mix original wise news tail stick idea label claim leaf lab general" },
  { name: "Sonnet", mnemonic: "gift someone orchard busy dwarf snap toilet voyage exile token wrestle scatter raccoon mask work pass shell soft sting term maple gasp portion aisle" },
  { name: "Haiku", mnemonic: "spring pause awake denial boat heart strike behave solve transfer ahead dinner broccoli people wild toddler enlist toilet vicious file hold scale scrap lecture" },
  { name: "GPT", mnemonic: "fruit venture border pause clever gadget file fit youth merry young subway goose vehicle prevent repair wisdom middle flavor cotton nasty ivory speak cricket" },
  { name: "Gemini", mnemonic: "infant better name cruise cart puzzle sword coyote logic rug private nest office smile grace camp volume protect garage crush aspect episode broccoli lobster" }
];

const API_URL = "http://localhost:4001";
const WS_URL = "ws://localhost:4002";
const SEAT_PRICE = 10; // 10 KAS per seat (minimum)

// Setup wallets
async function setupWallets() {
  const wallets = [];
  for (const p of PLAYERS) {
    const mnemonic = new Mnemonic(p.mnemonic);
    const xprv = new XPrv(mnemonic.toSeed());
    const keyGen = new PrivateKeyGenerator(xprv, false, 0n);
    const privateKey = keyGen.receiveKey(0);
    const address = privateKey.toAddress("testnet");
    wallets.push({ name: p.name, privateKey, address: address.toString() });
  }
  return wallets;
}

// Create RPC connection
async function createRpc() {
  const rpc = new RpcClient({
    resolver: new Resolver(),
    networkId: "testnet-10"
  });
  await rpc.connect();
  return rpc;
}

// Create a game room
async function createRoom() {
  const res = await fetch(API_URL + "/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "REGULAR", seatPrice: SEAT_PRICE })
  });
  const data = await res.json();
  console.log("Created room:", data.room.id);
  console.log("Deposit address:", data.room.depositAddress);
  return data.room;
}

// Connect player to WebSocket and join room using wallet address
function connectPlayer(wallet, roomId) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const walletAddress = wallet.address;
    let resolved = false;

    ws.on("open", () => {
      // Join the room with wallet address
      ws.send(JSON.stringify({
        event: "join_room",
        payload: { roomId, walletAddress }
      }));
    });

    ws.on("message", (data) => {
      if (resolved) return;
      const msg = JSON.parse(data.toString());
      if (msg.event === "room:update") {
        // Check if player is now in a seat (by wallet address)
        const seat = msg.payload.room.seats.find(s => s.walletAddress === walletAddress);
        if (seat) {
          resolved = true;
          console.log("  " + wallet.name + " -> seat " + seat.index);
          resolve({ ws, walletAddress, seat, room: msg.payload.room });
        }
      }
    });

    ws.on("error", (err) => {
      if (!resolved) reject(err);
    });

    setTimeout(() => {
      if (!resolved) reject(new Error(wallet.name + " timed out joining room"));
    }, 10000);
  });
}

// Send deposit from wallet to room's deposit address
async function sendDeposit(rpc, wallet, depositAddress, amount) {
  const { entries: utxos } = await rpc.getUtxosByAddresses({ addresses: [wallet.address] });
  if (utxos.length === 0) {
    throw new Error(wallet.name + " has no UTXOs");
  }

  const addressObj = wallet.privateKey.toAddress("testnet");
  const entries = utxos.map(u => ({
    address: addressObj,
    outpoint: u.outpoint,
    scriptPublicKey: payToAddressScript(addressObj),
    amount: BigInt(u.amount),
    isCoinbase: u.isCoinbase,
    blockDaaScore: BigInt(u.blockDaaScore)
  }));

  const { transactions } = await createTransactions({
    entries,
    outputs: [{ address: depositAddress, amount: BigInt(amount) }],
    changeAddress: addressObj,
    priorityFee: 0n,
    networkId: "testnet-10"
  });

  for (const pending of transactions) {
    await pending.sign([wallet.privateKey]);
    const txId = await pending.submit(rpc);
    console.log(wallet.name + " sent " + (Number(amount) / 100000000) + " KAS -> TX: " + txId.slice(0, 16) + "...");
    return txId;
  }
}

// Wait for room state to change
function waitForRoomState(connections, targetState, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const listener = (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.event === "room:update" && msg.payload.room.state === targetState) {
        connections.forEach(c => c.ws.removeListener("message", listener));
        resolve(msg.payload.room);
      }
    };

    connections.forEach(c => c.ws.on("message", listener));

    setTimeout(() => {
      connections.forEach(c => c.ws.removeListener("message", listener));
      reject(new Error("Timeout waiting for state " + targetState));
    }, timeout);
  });
}

// Submit client seed (must be 32+ chars)
function submitClientSeed(ws, roomId, walletAddress, seatIndex) {
  // Generate a 64 char hex string (32 bytes)
  const randomBytes = [];
  for (let i = 0; i < 32; i++) {
    randomBytes.push(Math.floor(Math.random() * 256).toString(16).padStart(2, '0'));
  }
  const clientSeed = randomBytes.join('');
  ws.send(JSON.stringify({
    event: "submit_client_seed",
    payload: { roomId, walletAddress, seatIndex, clientSeed }
  }));
  console.log("Seat " + seatIndex + " submitted client seed: " + clientSeed.slice(0, 16) + "...");
}

// Main game
async function playGame() {
  console.log("\n=== RUSSIAN ROULETTE - 6 AI PLAYERS ===\n");

  // Setup
  console.log("Setting up wallets...");
  const wallets = await setupWallets();
  wallets.forEach(w => console.log("  " + w.name + ": " + w.address.slice(0, 40) + "..."));

  const rpc = await createRpc();
  console.log("Connected to Kaspa testnet\n");

  // Create room
  console.log("Creating game room...");
  const room = await createRoom();

  // Connect all players
  console.log("\nPlayers joining room...");
  const connections = [];
  for (const wallet of wallets) {
    try {
      const conn = await connectPlayer(wallet, room.id);
      connections.push({ ...conn, wallet });
    } catch (err) {
      console.error("Failed to connect " + wallet.name + ":", err.message);
    }
  }

  if (connections.length < 6) {
    console.log("Not all players joined. Exiting.");
    await rpc.disconnect();
    connections.forEach(c => c.ws.close());
    return;
  }

  console.log("\nAll 6 players joined!");

  // Get current room state
  const roomRes = await fetch(API_URL + "/api/rooms/" + room.id);
  const { room: currentRoom } = await roomRes.json();
  console.log("\nRoom state:", currentRoom.state);
  console.log("Room deposit address:", currentRoom.depositAddress);

  // If in FUNDING state, send deposits to the SINGLE room deposit address
  if (currentRoom.state === "FUNDING") {
    console.log("\nSending deposits to room address...");
    const depositAmount = BigInt(SEAT_PRICE * 100000000); // Convert KAS to sompi

    for (const conn of connections) {
      try {
        // All players send to the same room deposit address
        await sendDeposit(rpc, conn.wallet, currentRoom.depositAddress, depositAmount);
      } catch (err) {
        console.error("Deposit failed for " + conn.wallet.name + ":", err.message);
      }
    }

    console.log("\nWaiting for deposits to confirm (may take a minute)...");
    try {
      const lockedRoom = await waitForRoomState(connections, "LOCKED", 120000);
      console.log("All deposits confirmed! Room is LOCKED");
    } catch (err) {
      console.log("Timeout waiting for LOCKED state. Deposits may still be confirming.");
    }
  }

  // Get updated room state
  const roomRes2 = await fetch(API_URL + "/api/rooms/" + room.id);
  const { room: room2 } = await roomRes2.json();
  console.log("\nCurrent room state:", room2.state);

  // If in LOCKED state, submit client seeds
  if (room2.state === "LOCKED") {
    console.log("\nSubmitting client seeds...");
    for (const conn of connections) {
      submitClientSeed(conn.ws, room.id, conn.walletAddress, conn.seat.index);
      await new Promise(r => setTimeout(r, 500)); // Small delay between submissions
    }

    console.log("\nWaiting for game to play...");
    try {
      const settledRoom = await waitForRoomState(connections, "SETTLED", 30000);
      console.log("\n=== GAME SETTLED! ===");

      // Find who died
      const deadSeat = settledRoom.seats.find(s => !s.alive);
      const survivors = settledRoom.seats.filter(s => s.alive);

      if (deadSeat) {
        const deadPlayer = wallets.find(w => w.address === deadSeat.walletAddress);
        console.log("💀 " + (deadPlayer?.name || "Unknown") + " (seat " + deadSeat.index + ") is DEAD");
      }

      console.log("🎉 Survivors: " + survivors.map(s => {
        const player = wallets.find(w => w.address === s.walletAddress);
        return player?.name || "Unknown";
      }).join(", "));

      console.log("Payout TX:", settledRoom.payoutTxId);
    } catch (err) {
      console.log("Timeout waiting for game to settle.");
    }
  }

  // Cleanup
  console.log("\nCleaning up...");
  await rpc.disconnect();
  connections.forEach(c => c.ws.close());
  console.log("Done!");
}

playGame().catch(console.error);
