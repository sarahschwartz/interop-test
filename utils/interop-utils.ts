import { ethers } from "ethers";
import { types, Provider, Wallet, Contract, utils } from "zksync-ethers";
import * as L2_INEROP_ROOT_STORAGE_JSON from "../utils/L2InteropRootStorage.json"

export async function waitUntilBlockFinalized(wallet: Wallet, blockNumber: number) {
    // console.log('Waiting for block to be finalized...', blockNumber);
    while (true) {
        const block = await wallet.provider.getBlock('finalized');
        if (blockNumber <= block.number) {
            break;
        } else {
            await utils.sleep(wallet.provider.pollingInterval);
        }
    }
}

export async function waitForL2ToL1LogProof(wallet: Wallet, blockNumber: number, txHash: string) {
    // First, we wait for block to be finalized.
    await waitUntilBlockFinalized(wallet, blockNumber);

    // Second, we wait for the log proof.
    while ((await wallet.provider.getLogProof(txHash)) == null) {
        // console.log('Waiting for log proof...');
        await utils.sleep(wallet.provider.pollingInterval);
    }
}

    export function getGWBlockNumber(params: types.FinalizeWithdrawalParams): number {
        /// see hashProof in MessageHashing.sol for this logic.
        let gwProofIndex =
            1 + parseInt(params.proof[0].slice(4, 6), 16) + 1 + parseInt(params.proof[0].slice(6, 8), 16);
        return parseInt(params.proof[gwProofIndex].slice(2, 34), 16);
    }

    export async function waitForInteropRootNonZero(provider: Provider, alice: Wallet, l1BatchNumber: number) {
      const L2_INTEROP_ROOT_STORAGE_ADDRESS = '0x0000000000000000000000000000000000010008';
      // from the interop test constants
      const GATEWAY_CHAIN_ID_1 = 505;
      // what I see in the gateway chain config
      const GATEWAY_CHAIN_ID_2 = 506;

        const l2InteropRootStorage = new Contract(
            L2_INTEROP_ROOT_STORAGE_ADDRESS,
            L2_INEROP_ROOT_STORAGE_JSON.abi,
            provider
        );
        let currentRoot = ethers.ZeroHash;

        while (currentRoot === ethers.ZeroHash) {
            // We make repeated transactions to force the L2 to update the interop root.
            const tx = await alice.transfer({
                to: alice.address,
                amount: 1
            });
            await tx.wait();

            currentRoot = await l2InteropRootStorage.interopRoots(GATEWAY_CHAIN_ID_1, l1BatchNumber);
            if(currentRoot === ethers.ZeroHash){
              currentRoot = await l2InteropRootStorage.interopRoots(GATEWAY_CHAIN_ID_2, l1BatchNumber);
            }
            await utils.sleep(alice.provider.pollingInterval);
        }
    }
