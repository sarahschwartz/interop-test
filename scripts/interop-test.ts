import { ethers } from "hardhat";
import { Contract, Provider, utils, Wallet } from "zksync-ethers";
import * as L2_MESSAGE_V_JSON from "../utils/L2MessageVerification.json";

const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

const DST_L2_RPC = process.env.DST_L2_RPC ?? "http://localhost:3350";
const GW_RPC     = process.env.GW_RPC     ?? "http://localhost:3250";
const GW_CHAIN_ID = BigInt(process.env.GW_CHAIN_ID ?? "506");

async function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");

  // Source 
  const providerl2 = new Provider("http://localhost:3050");
  const providerl1 = new Provider("http://localhost:8545");
  const wallet = new Wallet(PRIVATE_KEY, providerl2, providerl1);

  const providerDst = new Provider(DST_L2_RPC);
  const dstWallet   = new Wallet(PRIVATE_KEY, providerDst, providerl1);
  const gw          = new ethers.JsonRpcProvider(GW_RPC);

  console.log("Using signer:", wallet.address);
  const balance = await ethers.provider.getBalance(wallet.address);
  console.log("Signer balance:", ethers.formatEther(balance));

  const L1Messenger = new Contract(utils.L1_MESSENGER_ADDRESS, utils.L1_MESSENGER, wallet);

  // Send message to L1 and wait until it gets there.
  const message = ethers.toUtf8Bytes("Some L2->L1 message");
  const tx = await L1Messenger.sendToL1(message);
  console.log("waiting for receipt...");
  const receipt = await (await wallet.provider.getTransaction(tx.hash)).waitFinalize();
  console.log("got tx receipt");

  // Find the exact interop log: sender=0x…8008, key=pad32(EOA), value=keccak(message)
  const paddedEOA = ethers.zeroPadValue(wallet.address, 32);
  const msgHash = ethers.keccak256(message);
  const l2ToL1LogIndex = receipt.l2ToL1Logs.findIndex((log: any) =>
    log.sender.toLowerCase() === utils.L1_MESSENGER_ADDRESS.toLowerCase() &&
    log.key.toLowerCase()    === paddedEOA.toLowerCase() &&
    log.value.toLowerCase()  === msgHash.toLowerCase()
  );
  console.log("l2ToL1LogIndex", l2ToL1LogIndex);
  if (l2ToL1LogIndex < 0) throw new Error("Could not find our interop log in receipt.l2ToL1Logs");

  // (Optional) L1 verification
  // await waitForL2ToL1LogProof(wallet, receipt.blockNumber, tx.hash);
  // const params = await wallet.finalizeWithdrawalParams(tx.hash);
  // const msgProof = await wallet.provider.getLogProof(tx.hash, l2ToL1LogIndex);
  // const { id, proof } = msgProof!;
  // const chainContract = await wallet.getMainContract();
  // const result = await chainContract.proveL2MessageInclusion(
  //   receipt.l1BatchNumber!, id,
  //   { txNumberInBatch: receipt.l1BatchTxIndex!, sender: wallet.address, data: message },
  //   proof
  // );
  // console.log("included on l1:", result);

  // fetch the gw proof
  const gwProofResp = await wallet.provider.send("zks_getL2ToL1LogProof", [
    tx.hash,
    l2ToL1LogIndex,
    "proof_based_gw",
  ]);
  if (!gwProofResp?.proof) throw new Error("Gateway proof not ready yet");
  const gwProof: string[] = gwProofResp.proof;
  console.log("GW proof nodes:", gwProof.length);

  // fetch executeTxHash
  async function getGwBlockForBatch(batch: bigint): Promise<bigint> {
    while (true) {
      const details = await wallet.provider.send("zks_getL1BatchDetails", [Number(batch)]);
      const execTx: string | null =
        details?.executeTxHash &&
        details.executeTxHash !== "0x0000000000000000000000000000000000000000000000000000000000000000"
          ? details.executeTxHash
          : null;
      if (execTx) {
        const gwRcpt = await gw.getTransactionReceipt(execTx);
        if (gwRcpt?.blockNumber !== undefined) return BigInt(gwRcpt.blockNumber);
      }
      await sleep(1000);
    }
  }
  const gwBlock = await getGwBlockForBatch(BigInt(receipt.l1BatchNumber!));

  // fetch the interop root from destiination chain
  const INTEROP_ROOT_STORAGE = "0x0000000000000000000000000000000000010008";
  const InteropRootStorage = new Contract(
    INTEROP_ROOT_STORAGE,
    ["function interopRoots(uint256,uint256) view returns (bytes32)"],
    dstWallet
  );
  async function waitDstHasGwRoot(timeoutMs = 120_000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const root: string = await InteropRootStorage.interopRoots(GW_CHAIN_ID, gwBlock);
      if (root && root !== "0x" + "0".repeat(64)) return root;
      // send tx just to get dst to seal batch
      const t = await dstWallet.sendTransaction({ to: dstWallet.address, value: BigInt(1) });
      await (await dstWallet.provider.getTransaction(t.hash)).waitFinalize();
    }
    throw new Error(`DST did not import interop root for (${GW_CHAIN_ID}, ${gwBlock}) in time`);
  }
  const dstRoot = await waitDstHasGwRoot();
  console.log(`DST interop root ready: interopRoots(${GW_CHAIN_ID}, ${gwBlock}) = ${dstRoot}`);

  // verify on DST using source chain
  const L2_MESSAGE_VERIFICATION_ADDRESS = "0x0000000000000000000000000000000000010009";
  const l2MessageVerification = new Contract(
    L2_MESSAGE_VERIFICATION_ADDRESS,
    L2_MESSAGE_V_JSON.abi,
    dstWallet
  );

  const srcChainId = (await wallet.provider.getNetwork()).chainId;
  const included = await l2MessageVerification.proveL2MessageInclusionShared(
    srcChainId,
    receipt.l1BatchNumber!,
    receipt.l1BatchTxIndex!,                             // mask/index
    { txNumberInBatch: receipt.l1BatchTxIndex!, sender: wallet.address, data: message },
    gwProof
  );
  console.log("l2 proved:", included);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
