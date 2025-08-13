import { Contract, Provider, Signer } from "ethers";
import { ethers } from "hardhat"
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

export const L1_MESSENGER_CONTRACT_ADDRESS =
  "0x0000000000000000000000000000000000008008";

// export function getGWBlockNumber(
//   params: types.FinalizeWithdrawalParams
// ): number {
//   /// see hashProof in MessageHashing.sol for this logic.
//   let gwProofIndex =
//     1 +
//     parseInt(params.proof[0].slice(4, 6), 16) +
//     1 +
//     parseInt(params.proof[0].slice(6, 8), 16);
//   return parseInt(params.proof[gwProofIndex].slice(2, 34), 16);
// }

export async function waitUntilBlockFinalized(signer: Signer, blockNumber: number) {
    // console.log('Waiting for block to be finalized...', blockNumber);
    while (true) {
        const block = await signer.provider?.getBlock('finalized');
        if (block && blockNumber <= block.number) {
            break;
        } else {
             await new Promise((resolve) => setTimeout(resolve, 5000));
        }
    }
}

async function getL2ToL1LogProof(txHash: string, index: number) {
  const l2ToL1LogProofResponse = await ethers.provider.send(
    "zks_getL2ToL1LogProof",
    [txHash, index, "proof_based_gw"]
  );
  return l2ToL1LogProofResponse;
}

export async function getProof(receipt: any) {
  let proofResponse;
  let gotProofInfo = false;
  const hash = receipt.hash;
  while (!gotProofInfo) {
      const l2ToL1LogIndex = receipt.l2ToL1Logs?.findIndex(
    (log: any) => log.sender == L1_MESSENGER_CONTRACT_ADDRESS
  );
  // console.log('l2ToL1Logs', receipt.l2ToL1Logs)
  // console.log('l2ToL1LogIndex', l2ToL1LogIndex)
    proofResponse = await getL2ToL1LogProof(hash, l2ToL1LogIndex);
    console.log("Proof response:", proofResponse);
    if (proofResponse && proofResponse.proof) {
      gotProofInfo = true;
    } else {
      console.log("Proof not found yet, retrying...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
  console.log("Proof retrieved successfully");
  return proofResponse;
}


export async function waitForInteropRootNonZero(
  signer: HardhatEthersSigner,
  l1BatchNumber: number
) {
  const GATEWAY_CHAIN_ID = 506;
  const L2_INTEROP_ROOT_STORAGE_ADDRESS =
    "0x0000000000000000000000000000000000010008";

  const l2InteropRootStorageAbi = [
    "function interopRoots(uint256 chainId, uint256 blockOrBatchNumber) external view returns (bytes32)",
  ];

  const l2InteropRootStorage =  (await ethers.getContractAt(
    l2InteropRootStorageAbi,
    L2_INTEROP_ROOT_STORAGE_ADDRESS,
  )).connect(signer) as Contract;
  let currentRoot = ethers.ZeroHash;

  while (currentRoot === ethers.ZeroHash) {
    // We make repeated transactions to force the L2 to update the interop root.
    const tx = await signer.sendTransaction({
      to: signer.address,
      value: 1,
    });
    await tx.wait();

    currentRoot = await l2InteropRootStorage.interopRoots(
      GATEWAY_CHAIN_ID,
      l1BatchNumber
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}


export async function getVerificationResponse(
  signer: HardhatEthersSigner,
  batchNumber: number,
  txIndex: number,
  proof: string[],
  payload: string
) {

  const L2_MESSAGE_VERIFICATION_ADDRESS =
  "0x0000000000000000000000000000000000010009";

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

  // const result = await chainContract.proveL2MessageInclusion(
//     receipt.l1BatchNumber!,
//     id,
//     {
//       txNumberInBatch: receipt.l1BatchTxIndex!,
//       sender: wallet.address,
//       data: message,
//     },
//     proof
//   );

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