# png-merkle-distributor
A program that can repeatedly add airdrops based on [saber merkle-distributor](https://github.com/saber-hq/merkle-distributor).

## Rationale
Although the Merkle tree-based airdrop method can help developers save a lot of gas fees.
the Merkle tree method will encounter some problems when developers need to make multiple airdrops (assuming once a day)  
Users cannot claim all the rewards at one time, and because the amount of front-end proof data is too large, multiple claims cannot be packaged.   
We have developed a program that can update the root of the Merkle tree. The developer only needs to update the latest Merkle tree root every day, so that users can claim all the rewards with just one claim.

## License
The Png Merkle distributor program is distributed under the GPL v3.0 license.

to run testcase  
1.anchor build  
2.yarn idl:generate  
3.yarn run test  
