import { ethers } from "hardhat";
import { Contract, Provider, utils, Wallet } from "zksync-ethers";
import * as L2_MESSAGE_V_JSON from "../utils/L2MessageVerification.json";
import { getGwBlockForBatch, waitForGatewayInteropRoot } from '../utils/interop-utils'

const PRIVATE_KEY = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

// verify these endpoints in zksync-era/chains/<CHAIN>/configs/general.yaml
const CHAIN1_RPC = "http://localhost:3050"; // era
const CHAIN2_RPC = "http://localhost:3150"; // zk_chain_2
const GW_RPC     = "http://localhost:3250"; // gateway
// verify this value in zksync-era/chains/gateway/ZkStack.yaml
const GW_CHAIN_ID = BigInt("506");

async function main() {
  if (!PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");

  // Chain 1
  const providerChain1 = new Provider(CHAIN1_RPC);
  const providerl1 = new Provider("http://localhost:8545");
  const walletChain1 = new Wallet(PRIVATE_KEY, providerChain1, providerl1);

  // Chain 2
  const providerChain2 = new Provider(CHAIN2_RPC);
  const walletChain2 = new Wallet(PRIVATE_KEY, providerChain2, providerl1);

  // ZKsync Gateway
  const gw = new ethers.JsonRpcProvider(GW_RPC);

  // Send message to L1 and wait until it gets there.
  const message = ethers.toUtf8Bytes("Some L2->L1 message");
  const L1Messenger = new Contract(utils.L1_MESSENGER_ADDRESS, utils.L1_MESSENGER, walletChain1);
  const tx = await L1Messenger.sendToL1(message);
  console.log("waiting for receipt...");
  const receipt = await (await walletChain1.provider.getTransaction(tx.hash)).waitFinalize();
  console.log("got tx receipt");
  if(receipt.l1BatchNumber === null || receipt.l1BatchTxIndex === null) throw new Error("Could not find l1BatchNumber or l1BatchTxIndex in receipt");

  // Find the exact interop log: sender=0x…8008, key=pad32(EOA), value=keccak(message)
  const paddedEOA = ethers.zeroPadValue(walletChain1.address, 32);
  const msgHash = ethers.keccak256(message);
  const l2ToL1LogIndex = receipt.l2ToL1Logs.findIndex((log: any) =>
    log.sender.toLowerCase() === utils.L1_MESSENGER_ADDRESS.toLowerCase() &&
    log.key.toLowerCase()    === paddedEOA.toLowerCase() &&
    log.value.toLowerCase()  === msgHash.toLowerCase()
  );
  console.log("got l2ToL1LogIndex");
  if (l2ToL1LogIndex < 0) throw new Error("Could not find our interop log in receipt.l2ToL1Logs");

  // fetch the gw proof
  const gwProofResp = await walletChain1.provider.send("zks_getL2ToL1LogProof", [
    tx.hash,
    l2ToL1LogIndex,
    "proof_based_gw",
  ]);
  if (!gwProofResp?.proof) throw new Error("Gateway proof not ready yet");
  const gwProof: string[] = gwProofResp.proof;
  console.log("gw proof ready");

  // wait for the interop root to update
  const gwBlock = await getGwBlockForBatch(BigInt(receipt.l1BatchNumber), walletChain1.provider, gw);
  await waitForGatewayInteropRoot(GW_CHAIN_ID, walletChain2, gwBlock);
  console.log('interop root is updated');

  // verify the message on Chain 2
  const L2_MESSAGE_VERIFICATION_ADDRESS = "0x0000000000000000000000000000000000010009";
  const l2MessageVerification = new Contract(
    L2_MESSAGE_VERIFICATION_ADDRESS,
    L2_MESSAGE_V_JSON.abi,
    walletChain2
  );
  const srcChainId = (await walletChain1.provider.getNetwork()).chainId;
  const included: boolean = await l2MessageVerification.proveL2MessageInclusionShared(
    srcChainId,
    receipt.l1BatchNumber,
    receipt.l1BatchTxIndex,
    { txNumberInBatch: receipt.l1BatchTxIndex, sender: walletChain1.address, data: message },
    gwProof
  );
  console.log("message is verified on chain 2:", included);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
