const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const WINDOW = 3600n;
const ETH = ethers.parseEther("1");
const USD = (n) => BigInt(n) * 10n ** 6n;
const Status = { None: 0n, Pending: 1n, Claimed: 2n, Released: 3n, Rewound: 4n, Refused: 5n };

async function deploy() {
  const [alice, bob, carol, scammer, dave, keeper] = await ethers.getSigners();
  const rewind = await ethers.deployContract("Rewind", [WINDOW]);
  const usdc = await ethers.deployContract("MockUSDC");
  for (const s of [alice, carol, dave]) {
    await usdc.faucet(s.address, USD(1000));
    await usdc.connect(s).approve(await rewind.getAddress(), ethers.MaxUint256);
  }
  return { rewind, usdc, alice, bob, carol, scammer, dave, keeper };
}

const sendEth = (rewind, from, to, value = ETH, minWindow = 0) =>
  rewind.connect(from).send(to.address, ethers.ZeroAddress, 0, minWindow, "", { value });

describe("Rewind", () => {
  it("holds a payment for the base window, then anyone can settle it", async () => {
    const { rewind, alice, bob, keeper } = await loadFixture(deploy);
    await sendEth(rewind, alice, bob);
    const p = await rewind.getPayment(1);
    expect(p.status).to.equal(Status.Pending);
    expect(p.unlockAt - p.createdAt).to.equal(WINDOW);

    await expect(rewind.connect(keeper).claim(1)).to.be.revertedWithCustomError(rewind, "WindowOpen");
    await time.increase(WINDOW);
    await expect(rewind.connect(keeper).claim(1)).to.changeEtherBalances([bob, rewind], [ETH, -ETH]);
    expect((await rewind.getPayment(1)).status).to.equal(Status.Claimed);
  });

  it("lets the sender rewind inside the window and refunds them", async () => {
    const { rewind, alice, scammer } = await loadFixture(deploy);
    await sendEth(rewind, alice, scammer);
    await expect(rewind.connect(alice).rewind(1)).to.changeEtherBalances([alice, rewind], [ETH, -ETH]);
    expect((await rewind.getPayment(1)).status).to.equal(Status.Rewound);
    await expect(rewind.connect(scammer).claim(1)).to.be.revertedWithCustomError(rewind, "NotPending");
  });

  it("refuses rewinds after the window or from anyone but the sender", async () => {
    const { rewind, alice, bob } = await loadFixture(deploy);
    await sendEth(rewind, alice, bob);
    await expect(rewind.connect(bob).rewind(1)).to.be.revertedWithCustomError(rewind, "NotSender");
    await time.increase(WINDOW);
    await expect(rewind.connect(alice).rewind(1)).to.be.revertedWithCustomError(rewind, "WindowClosed");
  });

  it("lets the recipient bounce a payment and records it in their favour", async () => {
    const { rewind, alice, bob } = await loadFixture(deploy);
    await sendEth(rewind, alice, bob);
    await expect(rewind.connect(alice).refuse(1)).to.be.revertedWithCustomError(rewind, "NotRecipient");
    await expect(rewind.connect(bob).refuse(1)).to.changeEtherBalance(alice, ETH);
    const rep = await rewind.reputationOf(bob.address);
    expect(rep.refused).to.equal(1n);
    expect(rep.rewinds).to.equal(0n);
  });

  it("lets the sender release early", async () => {
    const { rewind, alice, bob } = await loadFixture(deploy);
    await sendEth(rewind, alice, bob);
    await expect(rewind.connect(bob).release(1)).to.be.revertedWithCustomError(rewind, "NotSender");
    await expect(rewind.connect(alice).release(1)).to.changeEtherBalance(bob, ETH);
    expect((await rewind.getPayment(1)).status).to.equal(Status.Released);
  });

  it("makes payments instant once a pair is trusted", async () => {
    const { rewind, alice, bob } = await loadFixture(deploy);
    for (let i = 1; i <= 3; i++) {
      await sendEth(rewind, alice, bob);
      await rewind.connect(alice).release(i);
    }
    expect(await rewind.windowFor(alice.address, bob.address)).to.equal(0n);
    await expect(sendEth(rewind, alice, bob)).to.changeEtherBalance(bob, ETH);
    expect((await rewind.getPayment(4)).status).to.equal(Status.Claimed);
  });

  it("still honours a longer window the sender asks for, even when trusted", async () => {
    const { rewind, alice, bob } = await loadFixture(deploy);
    for (let i = 1; i <= 3; i++) {
      await sendEth(rewind, alice, bob);
      await rewind.connect(alice).release(i);
    }
    await sendEth(rewind, alice, bob, ETH, 600);
    const p = await rewind.getPayment(4);
    expect(p.status).to.equal(Status.Pending);
    expect(p.unlockAt - p.createdAt).to.equal(600n);
  });

  it("stretches the window for addresses that many different senders rewound", async () => {
    const { rewind, alice, carol, dave, scammer } = await loadFixture(deploy);
    expect(await rewind.windowFor(dave.address, scammer.address)).to.equal(WINDOW);

    await sendEth(rewind, alice, scammer);
    await rewind.connect(alice).rewind(1);
    await sendEth(rewind, alice, scammer);
    await rewind.connect(alice).rewind(2); // same sender twice: counted once as distinct
    await sendEth(rewind, carol, scammer);
    await rewind.connect(carol).rewind(3);

    const rep = await rewind.reputationOf(scammer.address);
    expect(rep.rewinds).to.equal(3n);
    expect(rep.distinctRewinders).to.equal(2n);
    expect(await rewind.windowFor(dave.address, scammer.address)).to.equal(WINDOW * 3n);
  });

  it("caps the window at seven days", async () => {
    const rewind = await ethers.deployContract("Rewind", [12n * 3600n]);
    const signers = await ethers.getSigners();
    const target = signers[19];
    for (const s of signers.slice(0, 18)) {
      await sendEth(rewind, s, target, 1n);
      const id = await rewind.paymentCount();
      await rewind.connect(s).rewind(id);
    }
    expect(await rewind.windowFor(signers[18].address, target.address)).to.equal(7n * 24n * 3600n);
  });

  it("never trusts a pair where the sender has rewound on the recipient", async () => {
    const { rewind, alice, bob } = await loadFixture(deploy);
    await sendEth(rewind, alice, bob);
    await rewind.connect(alice).rewind(1);
    for (let i = 2; i <= 4; i++) {
      await sendEth(rewind, alice, bob);
      await rewind.connect(alice).release(i);
    }
    expect(await rewind.settledBetween(alice.address, bob.address)).to.equal(3n);
    expect(await rewind.windowFor(alice.address, bob.address)).to.be.greaterThan(0n);
  });

  it("works with ERC-20 tokens", async () => {
    const { rewind, usdc, alice, bob } = await loadFixture(deploy);
    const addr = await usdc.getAddress();
    await rewind.connect(alice).send(bob.address, addr, USD(250), 0, "rent");
    expect(await usdc.balanceOf(await rewind.getAddress())).to.equal(USD(250));
    await rewind.connect(alice).rewind(1);
    expect(await usdc.balanceOf(alice.address)).to.equal(USD(1000));

    // alice rewound on bob once, so bob's window has doubled
    expect(await rewind.windowFor(alice.address, bob.address)).to.equal(WINDOW * 2n);
    await rewind.connect(alice).send(bob.address, addr, USD(100), 0, "coffee");
    await time.increase(WINDOW * 2n);
    await rewind.claim(2);
    expect(await usdc.balanceOf(bob.address)).to.equal(USD(100));
  });

  it("rejects bad inputs", async () => {
    const { rewind, usdc, alice } = await loadFixture(deploy);
    await expect(sendEth(rewind, alice, alice)).to.be.revertedWithCustomError(rewind, "InvalidRecipient");
    await expect(
      rewind.connect(alice).send(ethers.ZeroAddress, ethers.ZeroAddress, 0, 0, "", { value: 1 }),
    ).to.be.revertedWithCustomError(rewind, "InvalidRecipient");
    await expect(
      rewind.connect(alice).send((await ethers.getSigners())[1].address, ethers.ZeroAddress, 0, 0, ""),
    ).to.be.revertedWithCustomError(rewind, "InvalidAmount");
    await expect(
      rewind
        .connect(alice)
        .send((await ethers.getSigners())[1].address, await usdc.getAddress(), 5, 0, "", { value: 1 }),
    ).to.be.revertedWithCustomError(rewind, "InvalidAmount");
  });

  it("indexes payments per account", async () => {
    const { rewind, alice, bob, carol } = await loadFixture(deploy);
    await sendEth(rewind, alice, bob);
    await sendEth(rewind, carol, bob);
    await sendEth(rewind, alice, carol);
    expect(await rewind.outgoingOf(alice.address)).to.deep.equal([1n, 3n]);
    expect(await rewind.incomingOf(bob.address)).to.deep.equal([1n, 2n]);
  });
});
