import { ethers } from "hardhat";
import { types, utils } from "zksync-ethers";

// Address of the contract to interact with
const L1_MESSENGER_CONTRACT_ADDRESS =
  "0x0000000000000000000000000000000000008008";
const L2_MESSAGE_VERIFICATION_ADDRESS =
  "0x0000000000000000000000000000000000010009";

const payload = "0x1234";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using signer:", signer.address);
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Signer balance:", ethers.formatEther(balance));

  const hash = await sendPayloadToL1Messenger(signer);
  console.log("Transaction hash:", hash);

  // wait for batch
  console.log("looking for batch number and transaction index...");
  const { batchNumber, txIndex } = await getBatchNumber(hash);
  if(!batchNumber || txIndex === null || txIndex === undefined) {
    throw new Error("Failed to get batch number or transaction index");
  }
  console.log('got batch number:', batchNumber, 'and transaction index:', txIndex);
  await waitForBatchToBeReady(batchNumber);
  console.log("Batch is ready, retrieving proof...");

  const proof = await getProof(hash);
  console.log("Proof retrieved successfully:", proof);

  await waitForInteropRootNonZero(signer, batchNumber);
  console.log("Interop root is non-zero, proceeding to verification...");

  const value = await getVerificationResponse(
    signer,
    batchNumber,
    txIndex,
    proof
  );
  console.log("Value returned from the verifier:", value);
}

async function getL2ToL1LogProof(txHash: string) {
  const l2ToL1LogProofResponse = await ethers.provider.send(
    "zks_getL2ToL1LogProof",
    [txHash, 0, "proof_based_gw"]
  );
  return l2ToL1LogProofResponse;
}

async function getBatchDetails(batchNumber: number) {
  const batchDetailsResponse = await ethers.provider.send(
    "zks_getL1BatchDetails",
    [batchNumber]
  );
  if (!batchDetailsResponse) {
    throw new Error("Failed to get batch details");
  }
  return batchDetailsResponse;
}

async function sendPayloadToL1Messenger(signer: any) {
  const L1Messenger = await ethers.getContractAt(
    "IL1Messenger",
    L1_MESSENGER_CONTRACT_ADDRESS
  );
  L1Messenger.connect(signer);

  const response = await L1Messenger.sendToL1(payload);
  const tx = await response.wait();
  console.log("message sent in block", tx.blockNumber);
  return tx.hash;
}

async function getBatchNumber(hash: string) {
  let foundInfo = false;
  let batchNumber;
  let txIndex;
  while (!foundInfo) {
  const txReceipt = (await ethers.provider.getTransactionReceipt(
    hash
  )) as types.TransactionReceipt;
  console.log('tx receipt: ', txReceipt);

  if (txReceipt && txReceipt.l1BatchNumber) {
    console.log('found batch number')
    console.log('tx receipt: ', txReceipt)
    batchNumber = txReceipt.l1BatchNumber;
    txIndex = txReceipt.l1BatchTxIndex;
    foundInfo = true;
  } else {
    console.log("Batch number not found yet, retrying...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}
  return { batchNumber, txIndex };
}

async function waitForBatchToBeReady(batchNumber: number) {
  let batchDetails;
  let isBatchExecuted = false;
  while (!isBatchExecuted) {
    batchDetails = await getBatchDetails(batchNumber);
    console.log("Batch details:", batchDetails);
    if (batchDetails.executeTxHash) {
      isBatchExecuted = true;
      console.log("Batch executed");
    } else {
      console.log("Batch not executed yet, waiting...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

async function getProof(hash: string) {
  let proofResponse;
  let proof;
  let gotProofInfo = false;
  while (!gotProofInfo) {
    proofResponse = await getL2ToL1LogProof(hash);
    console.log("Proof response:", proofResponse);
    if (proofResponse && proofResponse.proof) {
      gotProofInfo = true;
      proof = proofResponse.proof;
    } else {
      console.log("Proof not found yet, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  console.log("Proof retrieved successfully");
  return proof;
}

async function getVerificationResponse(
  signer: any,
  batchNumber: number,
  txIndex: number,
  proof: string[]
) {
  const l2MessageVerificationAbi = [
    "function proveL2MessageInclusionShared(uint256,uint256,uint256,(uint16,address,bytes),bytes32[])",
  ];

  const l2MessageVerificationContract = new ethers.Contract(
    L2_MESSAGE_VERIFICATION_ADDRESS,
    l2MessageVerificationAbi,
    signer
  );

  const chainID = (await ethers.provider.getNetwork()).chainId;
  const interopSender = signer.address;

  const verifierResponse =
    await l2MessageVerificationContract.proveL2MessageInclusionShared(
      chainID,
      batchNumber,
      txIndex,
      [txIndex, interopSender, payload],
      proof
    );
  return verifierResponse.value;
}

async function waitForInteropRootNonZero(signer: any, l1BatchNumber: number) {
  const GATEWAY_CHAIN_ID = 505;
  const L2_INTEROP_ROOT_STORAGE_ADDRESS =
    "0x0000000000000000000000000000000000010008";

  const l2InteropRootStorageAbi = [
    "function interopRoots(uint256 chainId, uint256 blockOrBatchNumber) external view returns (bytes32)",
  ];
  const l2InteropRootStorage = await ethers.getContractAt(
    l2InteropRootStorageAbi,
    L2_INTEROP_ROOT_STORAGE_ADDRESS
  );
  l2InteropRootStorage.connect(signer);
  let currentRoot = ethers.ZeroHash;

  while (currentRoot === ethers.ZeroHash) {
    console.log('interop root is 0....')
    // We make repeated transactions to force the L2 to update the interop root.
    const tx = await signer.transfer({
      to: signer.address,
      amount: 1,
    });
    await tx.wait();
    await sendPayloadToL1Messenger(signer);

    currentRoot = await l2InteropRootStorage.interopRoots(
      GATEWAY_CHAIN_ID,
      l1BatchNumber
    );
    await utils.sleep(signer.provider.pollingInterval);
  }
  console.log("Interop root is non-zero:", currentRoot);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
