import kaspaWasm from 'kaspa-wasm';
const { RpcClient, Resolver } = kaspaWasm;

const rpc = new RpcClient({
  resolver: new Resolver(),
  networkId: 'testnet-10'
});

await rpc.connect();

const address = 'kaspatest:qp8wuaux4al4gp6599a3qw7gvr78qywywr6ydj0xkdkfga39y67k5l844wd9x';
const result = await rpc.getUtxosByAddresses({ addresses: [address] });

console.log('Deposit address:', address);
console.log('UTXOs:', result.entries?.length || 0);
result.entries?.forEach((e, i) => {
  const kas = Number(e.amount) / 100000000;
  console.log('  UTXO ' + i + ': ' + e.amount + ' sompi (' + kas + ' KAS)');
});
const total = result.entries?.reduce((sum, e) => sum + BigInt(e.amount), 0n) || 0n;
console.log('Total:', total.toString(), 'sompi =', Number(total) / 100000000, 'KAS');

await rpc.disconnect();
