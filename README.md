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

In these instructions we will assume the chain name is `zk_chain_1`, but you can name your chain anything - just make sure to update the commands later on.
Select `yes` to enable the EVM emulator.
You can select the default prompt options for all other options.
Before starting the containers, make sure Docker is already running.

```bash
zkstack ecosystem create
```

### Initialize the Ecosystem and Chain

```bash
cd <YOUR ECOSYSTEM>
zkstack ecosystem init --dev
```

### Create & Init a Second Chain

```bash
zkstack chain create \
    --chain-name zk_chain_2 \
    --chain-id 5394 \
    --prover-mode no-proofs \
    --wallet-creation localhost \
    --l1-batch-commit-data-generator-mode rollup \
    --base-token-address 0x0000000000000000000000000000000000000001 \
    --base-token-price-nominator 1 \
    --base-token-price-denominator 1 \
    --set-as-default false \
    --evm-emulator true \
    --ignore-prerequisites --update-submodules false 
```

```bash
zkstack chain init \
    --deploy-paymaster \
    --l1-rpc-url=http://localhost:8545 \
    --chain zk_chain_2 \
    --update-submodules false
```

You can select the default options for the remaining prompts.

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
zkstack chain gateway migrate-to-gateway --chain zk_chain_1 --gateway-chain-name gateway
```

```bash
zkstack chain gateway migrate-to-gateway --chain zk_chain_2 --gateway-chain-name gateway
```

### Start the Other Chain Servers

Start the first chain's server:

```bash
zkstack server --ignore-prerequisites --chain zk_chain_1
```

Open a new terminal in the ecosystem folder and start the second chain's server:

```bash
zkstack server --ignore-prerequisites --chain zk_chain_2
```

### Bridge funds to each chain

Use a pre-configured rich wallet to bridge some ETH to `zk_chain_1` and `zk_chain_2`.
Open a new terminal to run the commands.

```bash
zkstack dev rich-account --chain zk_chain_1
```

```bash
zkstack dev rich-account --chain zk_chain_2
```

### Update the RPC Endpoints in the script

In the `scripts/interop-test.ts` file, update the RPC endpoints to match those from the previous step.
Make sure to also check the RPC endpoint for gateway in `<YOUR_ECOSYSTEM_FOLDER>/zksync-era/chains/gateway/configs/general.yaml`.

### Install the local dependencies and run the test

```bash
npm install
npm run interop
```

You should see an output like this:

```txt
Sent on source chain: { txHash: '0x...'}
Status: QUEUED
Status: PROVING
Status: EXECUTED
Interop root is updated: 0x...
Message is verified: true
```
