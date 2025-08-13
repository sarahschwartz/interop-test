import { ethers } from "hardhat";
import { Contract, Provider, types, utils, Wallet } from "zksync-ethers";
import { getGWBlockNumber, waitForInteropRootNonZero, waitForL2ToL1LogProof } from "../utils/interop-utils";
import * as L2_MESSAGE_V_JSON from "../utils/L2MessageVerification.json"
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
  const L1Messenger = new Contract(utils.L1_MESSENGER_ADDRESS, utils.L1_MESSENGER, wallet);

  // Send message to L1 and wait until it gets there.
  const message = ethers.toUtf8Bytes("Some L2->L1 message");
  const tx = await L1Messenger.sendToL1(message);
  console.log('waiting for receipt...')
  const receipt = await (
    await wallet.provider.getTransaction(tx.hash)
  ).waitFinalize();
  console.log("got tx receipt");

  // Get the proof for the sent message from the server, expect it to exist.
  const l2ToL1LogIndex = receipt.l2ToL1Logs.findIndex(
    (log: types.L2ToL1Log) => log.sender == utils.L1_MESSENGER_ADDRESS
  );
  console.log("l2ToL1LogIndex", l2ToL1LogIndex);
  await waitForL2ToL1LogProof(wallet, receipt.blockNumber, tx.hash);

  const params = await wallet.finalizeWithdrawalParams(tx.hash);
  console.log("params:", params)
  
  const msgProof = await wallet.provider.getLogProof(tx.hash, l2ToL1LogIndex);

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

  console.log("included on l1:", result);

  // Needed else the L2's view of GW's MessageRoot won't be updated
  await waitForInteropRootNonZero(wallet.provider, wallet, getGWBlockNumber(params));
  console.log('interop root is non zero')

  const L2_MESSAGE_VERIFICATION_ADDRESS = '0x0000000000000000000000000000000000010009';
  
  const l2MessageVerificationAbi = L2_MESSAGE_V_JSON.abi;
   const l2MessageVerification = new Contract(
            L2_MESSAGE_VERIFICATION_ADDRESS,
            l2MessageVerificationAbi,
            wallet
        );

console.log("requesting...")

  const included = await l2MessageVerification.proveL2MessageInclusionShared(
    (await wallet.provider.getNetwork()).chainId,
    params.l1BatchNumber,
    params.l2MessageIndex,
    { txNumberInBatch: params.l2TxNumberInBlock, sender: params.sender, data: params.message },
    params.proof
);
  console.log("l2 proved:", included)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
