import { ethers } from "hardhat";
import {
  Contract,
  InteropClient,
  Provider,
  utils,
  Wallet,
  getGwBlockForBatch,
} from "zksync-ethers";

const PRIVATE_KEY =
  "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

// verify these endpoints in zksync-era/chains/<CHAIN>/configs/general.yaml
const CHAIN1_RPC = "http://localhost:3050"; // zk_chain_1
const CHAIN2_RPC = "http://localhost:3150"; // zk_chain_2
const GW_RPC = "http://localhost:3250"; // gateway
const GW_CHAIN_ID = BigInt("506");

if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");

// Chain 1
const providerChain1 = new Provider(CHAIN1_RPC);
const providerl1 = new Provider("http://localhost:8545");
const walletChain1 = new Wallet(PRIVATE_KEY, providerChain1, providerl1);

// Chain 2
const providerChain2 = new Provider(CHAIN2_RPC);
const walletChain2 = new Wallet(PRIVATE_KEY, providerChain2, providerl1);

const interop = new InteropClient({
  gateway: {
    // 'testnet' | 'mainnet' | 'local'
    env: "local",
    gwRpcUrl: GW_RPC,
    gwChainId: GW_CHAIN_ID,
  },
});

async function main() {
  const message = "Some L2->L1 message";
  const sent = await interop.sendMessage(walletChain1, message);
  console.log("Sent on source chain:", sent);

  let status: any = "QUEUED";
  while (status !== "EXECUTED") {
    await utils.sleep(10000);
    status = await checkStatus(sent.txHash, providerChain1);
    console.log("Status:", status);
  }

  // for local testing only
  const root = await updateLocalChainInteropRoot(sent.txHash);
  console.log("Interop root is updated:", root);

  const verifyRes = await interop.verifyMessage({
    txHash: sent.txHash,
    srcProvider: providerChain1, // source chain provider (to fetch proof + batch details)
    targetChain: providerChain2, // target chain provider (to read interop root + verify)
    // includeProofInputs: true, // optional debug info
  });
  console.log("Message is verified:", verifyRes.verified);
}

async function checkStatus(txHash: `0x${string}`, provider: Provider) {
  const status = await interop.getMessageStatus(provider, txHash);
  return status;
}

// force interop root to update on local chain 2
async function updateLocalChainInteropRoot(
  txHash: `0x${string}`,
  timeoutMs = 120_000
): Promise<string> {
  const receipt = await (
    await walletChain1.provider.getTransaction(txHash)
  ).waitFinalize();
  const gw = new ethers.JsonRpcProvider(GW_RPC);
  const gwBlock = await getGwBlockForBatch(
    BigInt(receipt.l1BatchNumber!),
    providerChain1,
    gw
  );

  // fetch the interop root from target chain
  const InteropRootStorage = new Contract(
    utils.L2_INTEROP_ROOT_STORAGE_ADDRESS,
    utils.L2_INTEROP_ROOT_STORAGE_ABI,
    walletChain2
  );

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const root: string = await InteropRootStorage.interopRoots(
      GW_CHAIN_ID,
      gwBlock
    );
    if (root && root !== "0x" + "0".repeat(64)) return root;
    // send tx just to get chain2 to seal batch
    const t = await walletChain2.sendTransaction({
      to: walletChain2.address,
      value: BigInt(1),
    });
    await (await walletChain2.provider.getTransaction(t.hash)).waitFinalize();
  }
  throw new Error(
    `Chain2 did not import interop root for (${GW_CHAIN_ID}, ${gwBlock}) in time`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
