// Deploys Rewind + MockUSDC and writes addresses + ABIs to the frontend.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const isLocal = network.name === "localhost" || network.name === "hardhat";
  // short windows so a demo can watch a payment settle: 2 min locally, 5 min on testnets
  const baseWindow = Number(process.env.BASE_WINDOW ?? (isLocal ? 120 : 300));

  const rewind = await ethers.deployContract("Rewind", [baseWindow]);
  await rewind.waitForDeployment();
  const usdc = await ethers.deployContract("MockUSDC");
  await usdc.waitForDeployment();

  const { chainId } = await ethers.provider.getNetwork();
  console.log(`network   ${network.name} (${chainId})`);
  console.log(`Rewind    ${await rewind.getAddress()}  baseWindow=${baseWindow}s`);
  console.log(`MockUSDC  ${await usdc.getAddress()}`);

  if (isLocal) {
    // fund the demo accounts with test dollars
    const signers = await ethers.getSigners();
    for (const s of signers.slice(0, 6)) await (await usdc.faucet(s.address, 10_000n * 10n ** 6n)).wait();
  }

  const out = path.join(__dirname, "..", "..", "app", "src", "deployments.json");
  const existing = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : {};
  existing[chainId.toString()] = {
    network: network.name,
    rewind: await rewind.getAddress(),
    usdc: await usdc.getAddress(),
    baseWindow,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(existing, null, 2));

  const abiOut = path.join(__dirname, "..", "..", "app", "src", "abi.json");
  const abi = {
    Rewind: (await hre.artifacts.readArtifact("Rewind")).abi,
    MockUSDC: (await hre.artifacts.readArtifact("MockUSDC")).abi,
  };
  fs.writeFileSync(abiOut, JSON.stringify(abi, null, 2));
  console.log(`wrote ${path.relative(process.cwd(), out)} and abi.json`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
