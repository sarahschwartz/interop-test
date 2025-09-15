# Interop Demo Script

## Setup instructions

This guide assumes you already have `zkstackup` and the required system dependencies installed as detailed in the [ZKsync Chains quickstart](https://docs.zksync.io/zk-stack/running/quickstart).

### Install the latest version of `zkstack` CLI

```bash
zkstackup
```

### Update `zksync-foundry`

Update foundry-zksync to use the version from commit `27360d4c8`:

```bash
foundryup-zksync -C 27360d4c8
```

### Create a new ecosystem

You can select the default prompt options.
In these instructions we will assume the chain name is `era`, but you can name your chain anything - just make sure to update the commands later on.
Before starting the containers, make sure Docker is already running.

```bash
zkstack ecosystem create
```

### Initialize the Ecosystem and Era

```bash
zkstack ecosystem init --dev
```

### Create & Init a Second Chain

```bash
zkstack chain create \
    --chain-name zk_chain_2 \
    --chain-id 260 \
    --prover-mode no-proofs \
    --wallet-creation localhost \
    --l1-batch-commit-data-generator-mode rollup \
    --base-token-address 0x0000000000000000000000000000000000000001 \
    --base-token-price-nominator 1 \
    --base-token-price-denominator 1 \
    --set-as-default false \
    --evm-emulator false \
    --ignore-prerequisites --update-submodules false 
```

```bash
zkstack chain init \
    --deploy-paymaster \
    --l1-rpc-url=http://localhost:8545 \
    --server-db-url=postgres://postgres:notsecurepassword@localhost:5432 \
    --server-db-name=zksync_server_localhost_dut \
    --chain zk_chain_2 \
    --update-submodules false
```

### Create & Init Gateway Chain

```bash
zkstack chain create \
    --chain-name gateway \
    --chain-id 506 \
    --prover-mode no-proofs \
    --wallet-creation localhost \
    --l1-batch-commit-data-generator-mode rollup \
    --base-token-address 0x0000000000000000000000000000000000000001 \
    --base-token-price-nominator 1 \
    --base-token-price-denominator 1 \
    --set-as-default false \
    --evm-emulator false \
    --ignore-prerequisites --update-submodules false 
```

```bash
zkstack chain init \
    --deploy-paymaster \
    --l1-rpc-url=http://localhost:8545 \
    --server-db-url=postgres://postgres:notsecurepassword@localhost:5432 \
    --server-db-name=zksync_server_localhost_gateway \
    --chain gateway \
    --update-submodules false
```

### Setup the transaction filterer for gateway

```bash
zkstack chain gateway create-tx-filterer --chain gateway --ignore-prerequisites
```

### Convert gateway chain to gateway mode

```bash
zkstack chain gateway convert-to-gateway --chain gateway --ignore-prerequisites
```

### Start gateway server

```bash
zkstack server --ignore-prerequisites --chain gateway
```

### Migrate the Chains to Gateway

Open a new terminal in the ecosystem folder so the gateway server keeps running, and run the commands below to migrate the other chains to use gateway:

```bash
zkstack chain gateway migrate-to-gateway --chain era --gateway-chain-name gateway
```

```bash
zkstack chain gateway migrate-to-gateway --chain zk_chain_2 --gateway-chain-name gateway
```

### Start the Other Chain Servers

Start the era server:

```bash
zkstack server --ignore-prerequisites --chain era
```

Open a new terminal in the ecosystem folder and start the second chain's server:

```bash
zkstack server --ignore-prerequisites --chain zk_chain_2
```

### Bridge funds to each chain

Use a pre-configured rich wallet to bridge some ETH to `era` and `zk_chain_2`.
Double check the RPC endpoints for the chains inside `<YOUR_ECOSYSTEM_FOLDER>/zksync-era/chains/zk_chain_2/configs/general.yaml` and `<YOUR_ECOSYSTEM_FOLDER>/zksync-era/chains/era/configs/general.yaml` under `api.web3_json_rpc.http_url`.
The commands below assumes the chains are running at ports `3050` and `3150`.
Open a new terminal to run the commands.

```bash
npx zksync-cli bridge deposit --rpc=http://localhost:3050 --l1-rpc=http://localhost:8545 --amount 20 --to 0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --pk 0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110
```

```bash
npx zksync-cli bridge deposit --rpc=http://localhost:3150 --l1-rpc=http://localhost:8545 --amount 20 --to 0x36615Cf349d7F6344891B1e7CA7C72883F5dc049 --pk 0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110
```

### Update the RPC Endpoints in the script

In the `scripts/interop-test.ts` file, update the RPC endpoints to match those from the previous step.
Make sure to also check the RPC endpoint for gateway in `<YOUR_ECOSYSTEM_FOLDER>/zksync-era/chains/gateway/configs/general.yaml`, and it's chain ID in `<YOUR_ECOSYSTEM_FOLDER>/zksync-era/chains/gateway/ZkStack.yaml`.

### Install the local dependencies and run the test

```bash
npm install
npm run interop
```

You should see an output like this:

```txt
waiting for receipt...
got tx receipt
got l2ToL1LogIndex
gw proof ready
interop root is updated
message is verified on chain 2: true
```
