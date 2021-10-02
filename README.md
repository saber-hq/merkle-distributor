# merkle-distributor

![Merkle Distributor](/images/merkle-distributor.png)

A program for distributing tokens according to a [Merkle root](https://en.wikipedia.org/wiki/Merkle_tree).

This program is largely based off of [Uniswap's Merkle Distributor](https://github.com/Uniswap/merkle-distributor).

## Rationale

Although Solana has low fees for executing transactions, it requires staking tokens to pay for storage costs, also known as "rent". These rent costs can add up when sending tokens to thousands or tens of thousands of wallets, making it economically unreasonable to distribute tokens to everyone.

The Merkle distributor, pioneered by [Uniswap](https://github.com/Uniswap/merkle-distributor), solves this issue by deriving a 256-bit "root hash" from a tree of balances. This puts the gas cost on the claimer. Solana has the additional advantage of being able to reclaim rent from closed token accounts, so the net cost to the user should be around `0.000010 SOL` (at the time of writing).

The Merkle distributor is also significantly easier to manage from an operations perspective, since one does not need to send a transaction to each individual address that may be redeeming tokens.
