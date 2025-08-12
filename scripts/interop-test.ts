import { ethers } from "hardhat";
import { Provider, types, Wallet } from "zksync-ethers";
import { L1_MESSENGER_CONTRACT_ADDRESS, waitForL2ToL1LogProof } from "../utils/interop-utils";



const PRIVATE_KEY = process.env.WALLET_PRIVATE_KEY;

async function main() {
  if (!PRIVATE_KEY) {
    throw new Error("Missing PRIVATE_KEY");
  }
  const providerl2 = new Provider("http://localhost:3050");
  const providerl1 = new Provider("http://localhost:8545");
  const wallet = new Wallet(PRIVATE_KEY, providerl2, providerl1);
  console.log("Using signer:", wallet.address);
  const balance = await ethers.provider.getBalance(wallet.address);
  console.log("Signer balance:", ethers.formatEther(balance));
  const L1Messenger = await ethers.getContractAt(
    "IL1Messenger",
    L1_MESSENGER_CONTRACT_ADDRESS,
    wallet
  );

  // Send message to L1 and wait until it gets there.
  const message = ethers.toUtf8Bytes("Some L2->L1 message");
  const tx = await L1Messenger.sendToL1(message);
  const receipt = await (
    await wallet.provider.getTransaction(tx.hash)
  ).waitFinalize();
  console.log("got tx receipt");

  // Get the proof for the sent message from the server, expect it to exist.
  const l2ToL1LogIndex = receipt.l2ToL1Logs.findIndex(
    (log: types.L2ToL1Log) => log.sender == L1_MESSENGER_CONTRACT_ADDRESS
  );
  console.log("l2ToL1LogIndex", l2ToL1LogIndex);
  await waitForL2ToL1LogProof(wallet, receipt.blockNumber, tx.hash);
  const msgProof = await wallet.provider.getLogProof(tx.hash, l2ToL1LogIndex);
  console.log("msg proof", msgProof);

  const { id, proof } = msgProof!;

  // Ensure that provided proof is accepted by the main ZKsync contract.
  const chainContract = await wallet.getMainContract();
  const result = await chainContract.proveL2MessageInclusion(
    receipt.l1BatchNumber!,
    id,
    {
      txNumberInBatch: receipt.l1BatchTxIndex!,
      sender: wallet.address,
      data: message,
    },
    proof
  );

  console.log("result:", result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
