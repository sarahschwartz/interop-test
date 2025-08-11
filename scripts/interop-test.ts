import { parseEther } from "ethers";
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
  const { batchNumber: l1BatchNumber, txIndex: txNumberInBlock } = await getBatchNumber(hash);
  if(!l1BatchNumber || txNumberInBlock === null || txNumberInBlock === undefined) {
    throw new Error("Failed to get batch number or transaction index");
  }
  if (txNumberInBlock > 0xffff) throw new Error("tx index exceeds uint16");
  console.log('got l1 batch number:', l1BatchNumber, 'and transaction index in block:', txNumberInBlock);
  await waitForBatchToBeReady(l1BatchNumber);
  console.log("Batch is ready, retrieving proof...");

  const { proof, l2MessageIndex } = await getProof(hash);
  console.log("Proof retrieved successfully:", proof);
  console.log("L2 Message Index:", l2MessageIndex);

  const gwBlockNumber = getGWBlockNumber(proof);
  console.log("Gateway Block Number:", gwBlockNumber);

  await waitForInteropRootNonZero(signer, gwBlockNumber);
  console.log("Interop root is non-zero, proceeding to verification...");

  const value = await getVerificationResponse(
    signer,
    l1BatchNumber,
    l2MessageIndex!,
    txNumberInBlock,
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
    L1_MESSENGER_CONTRACT_ADDRESS,
    signer
  );

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

  if (txReceipt && txReceipt.l1BatchNumber) {
    console.log('found batch number')
    batchNumber = txReceipt.l1BatchNumber;
    txIndex = txReceipt.l2ToL1Logs[0].transactionIndex;
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
  let l2MessageIndex;
  let gotProofInfo = false;
  while (!gotProofInfo) {
    proofResponse = await getL2ToL1LogProof(hash);
    const index = proofResponse ? Number(proofResponse.id ?? proofResponse.l2MessageIndex) : undefined;
    if (proofResponse && proofResponse.proof && index !== undefined) {
      proof = proofResponse.proof;
      l2MessageIndex = index;
      gotProofInfo = true;
    } else {
      console.log("Proof not found yet, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  console.log("Proof retrieved successfully");
  return { proof, l2MessageIndex };
}

function getGWBlockNumber(proof: string[]): number {
  const a = 1 + parseInt(proof[0].slice(4, 6), 16);
  const b = 1 + parseInt(proof[0].slice(6, 8), 16);
  const gwProofIndex = a + b;
  return parseInt(proof[gwProofIndex].slice(2, 34), 16);
}

async function getVerificationResponse(
  signer: any,
  l1BatchNumber: number,
  l2MessageIndex: number,
  txIndexInBlock: number,
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

  const response =
    await l2MessageVerificationContract.proveL2MessageInclusionShared(
      chainID,
      l1BatchNumber,
      l2MessageIndex,
      [txIndexInBlock, signer.address, payload],
      proof
    );
  return response.value;
}

async function waitForInteropRootNonZero(signer: any, gwBlockNumber: number) {
  const GATEWAY_CHAIN_ID = 505;
  const L2_INTEROP_ROOT_STORAGE_ADDRESS =
    "0x0000000000000000000000000000000000010008";

  const l2InteropRootStorageAbi = [
    "function interopRoots(uint256 chainId, uint256 blockOrBatchNumber) external view returns (bytes32)",
  ];
  const l2InteropRootStorage = await ethers.getContractAt(
    l2InteropRootStorageAbi,
    L2_INTEROP_ROOT_STORAGE_ADDRESS,
    signer
  );
  let currentRoot = ethers.ZeroHash;

  while (currentRoot === ethers.ZeroHash) {
    console.log('interop root is 0....')
    // We make repeated transactions to force the L2 to update the interop root.
      const tx = await signer.sendTransaction({
      to: signer.address,
      value: parseEther("0.1"),
    });
    await tx.wait();

    currentRoot = await l2InteropRootStorage.interopRoots(
      GATEWAY_CHAIN_ID,
      gwBlockNumber
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
