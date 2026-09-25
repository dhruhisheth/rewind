// Seeds a local chain with the demo story:
//   Alice has paid Bob (her landlord) three times  -> Bob is trusted, payments are instant
//   Carol, Dave and Erin each got scammed by Mallory and rewound -> Mallory's window is 4x
// Run after deploy.js against the same network.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers } = hre;
  const { chainId } = await ethers.provider.getNetwork();
  const deployments = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "app", "src", "deployments.json"), "utf8"),
  );
  const rewind = await ethers.getContractAt("Rewind", deployments[chainId.toString()].rewind);
  const [alice, bob, carol, dave, erin, mallory] = await ethers.getSigners();
  const eth = (x) => ethers.parseEther(x);
  const send = async (from, to, value, memo) => {
    await (await rewind.connect(from).send(to.address, ethers.ZeroAddress, 0, 0, memo, { value })).wait();
    return rewind.paymentCount();
  };

  for (const month of ["July", "August", "September"]) {
    const id = await send(alice, bob, eth("0.8"), `${month} rent`);
    await (await rewind.connect(alice).release(id)).wait();
  }
  for (const [victim, memo] of [
    [carol, "wallet support fee"],
    [dave, "airdrop unlock gas"],
    [erin, "USDT arbitrage deposit"],
  ]) {
    const id = await send(victim, mallory, eth("1.5"), memo);
    await (await rewind.connect(victim).rewind(id)).wait();
  }

  const rep = await rewind.reputationOf(mallory.address);
  console.log(`Alice -> Bob window: ${await rewind.windowFor(alice.address, bob.address)}s (trusted)`);
  console.log(`Mallory: ${rep.rewinds} rewinds from ${rep.distinctRewinders} senders, window ${await rewind.windowFor(alice.address, mallory.address)}s`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
