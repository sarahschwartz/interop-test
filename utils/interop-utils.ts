import type { JsonRpcProvider } from "ethers";
import { type Provider, type Wallet, utils, Contract } from "zksync-ethers";

// fetch gateway block number from executeTxHash
export async function getGwBlockForBatch(
  batch: bigint,
  provider: Provider,
  gw: JsonRpcProvider
): Promise<bigint> {
  while (true) {
    const details = await provider.send("zks_getL1BatchDetails", [
      Number(batch),
    ]);
    const execTx: string | null =
      details?.executeTxHash &&
      details.executeTxHash !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
        ? details.executeTxHash
        : null;
    if (execTx) {
      const gwRcpt = await gw.getTransactionReceipt(execTx);
      if (gwRcpt?.blockNumber !== undefined) return BigInt(gwRcpt.blockNumber);
    }
    await utils.sleep(1000);
  }
}

// wait for the interop root to update on chain 2
export async function waitForGatewayInteropRoot(
  GW_CHAIN_ID: bigint,
  walletChain2: Wallet,
  gwBlock: bigint,
  timeoutMs = 120_000
): Promise<string> {
  // fetch the interop root from destiination chain
  const INTEROP_ROOT_STORAGE = "0x0000000000000000000000000000000000010008";
  const InteropRootStorage = new Contract(
    INTEROP_ROOT_STORAGE,
    ["function interopRoots(uint256,uint256) view returns (bytes32)"],
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
