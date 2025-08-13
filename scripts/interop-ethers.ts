import { ethers } from "hardhat";
import { L1_MESSENGER_CONTRACT_ADDRESS, getProof } from "../utils/interop-utils-ethers";
import { Contract } from "ethers";

async function main() {
    
const [signer] = await ethers.getSigners();

  const L1Messenger = (await ethers.getContractAt(
    "IL1Messenger",
    L1_MESSENGER_CONTRACT_ADDRESS,
  )).connect(signer) as Contract;

  // Send message to L1 and wait until it gets there.
  const message = ethers.toUtf8Bytes("Some L2->L1 message");
  const tx = await L1Messenger.sendToL1(message);
  const receipt = await tx.wait();
  console.log("got tx receipt", receipt);

  const msgProof = await getProof(receipt);

  const { id, proof } = msgProof!;

  console.log('id', id, "proof", proof);

//   // Ensure that provided proof is accepted by the main ZKsync contract.
//   const chainContract = await wallet.getMainContract();
//   const result = await chainContract.proveL2MessageInclusion(
//     receipt.l1BatchNumber!,
//     id,
//     {
//       txNumberInBatch: receipt.l1BatchTxIndex!,
//       sender: wallet.address,
//       data: message,
//     },
//     proof
//   );

//   console.log("result:", result);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
