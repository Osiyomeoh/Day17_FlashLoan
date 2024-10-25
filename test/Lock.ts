import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";

describe("FlashLoanArbitrage", function () {
  async function deployFlashLoanFixture() {
    // Constants for testing
    const INITIAL_LIQUIDITY = hre.ethers.parseEther("10000");
    const FLASH_LOAN_AMOUNT = hre.ethers.parseEther("1000");

    // Get signers
    const [owner, otherAccount] = await hre.ethers.getSigners();

    // Deploy mock tokens
    const MockToken = await hre.ethers.getContractFactory("MockToken");
    const dai = await MockToken.deploy("DAI", "DAI");
    const weth = await MockToken.deploy("WETH", "WETH");

    // Deploy mock DEXes
    const MockDEX = await hre.ethers.getContractFactory("MockDEX");
    const uniswapDEX = await MockDEX.deploy();
    const sushiswapDEX = await MockDEX.deploy();

    // Deploy Flash Loan contract
    const FlashLoanArbitrage = await hre.ethers.getContractFactory("FlashLoanArbitrage");
    const flashLoan = await FlashLoanArbitrage.deploy(owner.address); // Using owner as mock provider

    // Setup initial liquidity
    await dai.mint(uniswapDEX.target, INITIAL_LIQUIDITY);
    await weth.mint(uniswapDEX.target, INITIAL_LIQUIDITY);
    await dai.mint(sushiswapDEX.target, INITIAL_LIQUIDITY);
    await weth.mint(sushiswapDEX.target, INITIAL_LIQUIDITY);

    return { 
      flashLoan, 
      dai, 
      weth, 
      uniswapDEX, 
      sushiswapDEX, 
      owner, 
      otherAccount,
      FLASH_LOAN_AMOUNT,
      INITIAL_LIQUIDITY
    };
  }

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      const { flashLoan, owner } = await loadFixture(deployFlashLoanFixture);
      expect(await flashLoan.owner()).to.equal(owner.address);
    });

    it("Should initialize with zero balance", async function () {
      const { flashLoan, dai } = await loadFixture(deployFlashLoanFixture);
      expect(await dai.balanceOf(flashLoan.target)).to.equal(0);
    });
  });

  describe("Price Checking", function () {
    it("Should detect profitable arbitrage opportunities", async function () {
      const { flashLoan, uniswapDEX, sushiswapDEX, dai, weth } = await loadFixture(
        deployFlashLoanFixture
      );

      // Set different prices on DEXes to create arbitrage opportunity
      await uniswapDEX.setPrice(
        dai.target,
        weth.target,
        hre.ethers.parseEther("0.0004") // 1 DAI = 0.0004 WETH
      );
      await sushiswapDEX.setPrice(
        weth.target,
        dai.target,
        hre.ethers.parseEther("2600") // 1 WETH = 2600 DAI
      );

      const [uniswapPrice, sushiswapPrice, profitable] = await flashLoan.checkArbitrage();
      
      expect(profitable).to.be.true;
      expect(uniswapPrice).to.be.gt(0);
      expect(sushiswapPrice).to.be.gt(0);
    });

    it("Should detect unprofitable scenarios", async function () {
      const { flashLoan, uniswapDEX, sushiswapDEX, dai, weth } = await loadFixture(
        deployFlashLoanFixture
      );

      // Set similar prices on both DEXes
      await uniswapDEX.setPrice(
        dai.target,
        weth.target,
        hre.ethers.parseEther("0.0004")
      );
      await sushiswapDEX.setPrice(
        weth.target,
        dai.target,
        hre.ethers.parseEther("2500")
      );

      const [,, profitable] = await flashLoan.checkArbitrage();
      expect(profitable).to.be.false;
    });
  });

  describe("Arbitrage Execution", function () {
    it("Should execute profitable arbitrage", async function () {
      const { flashLoan, dai, FLASH_LOAN_AMOUNT, uniswapDEX, sushiswapDEX, weth } = 
        await loadFixture(deployFlashLoanFixture);

      // Set profitable prices
      await uniswapDEX.setPrice(
        dai.target,
        weth.target,
        hre.ethers.parseEther("0.0004")
      );
      await sushiswapDEX.setPrice(
        weth.target,
        dai.target,
        hre.ethers.parseEther("2600")
      );

      // Mint initial flash loan amount
      await dai.mint(flashLoan.target, FLASH_LOAN_AMOUNT);

      // Execute arbitrage
      await expect(flashLoan.executeArbitrage())
        .to.emit(flashLoan, "ArbitrageExecuted")
        .withArgs(anyValue, anyValue);
    });

    it("Should revert if arbitrage is not profitable", async function () {
      const { flashLoan, dai, FLASH_LOAN_AMOUNT, uniswapDEX, sushiswapDEX, weth } = 
        await loadFixture(deployFlashLoanFixture);

      // Set unprofitable prices
      await uniswapDEX.setPrice(
        dai.target,
        weth.target,
        hre.ethers.parseEther("0.0004")
      );
      await sushiswapDEX.setPrice(
        weth.target,
        dai.target,
        hre.ethers.parseEther("2500")
      );

      // Mint initial flash loan amount
      await dai.mint(flashLoan.target, FLASH_LOAN_AMOUNT);

      await expect(flashLoan.executeArbitrage())
        .to.be.revertedWith("No profit made");
    });

    it("Should emit SwapExecuted events for each swap", async function () {
      const { flashLoan, dai, FLASH_LOAN_AMOUNT, uniswapDEX, sushiswapDEX, weth } = 
        await loadFixture(deployFlashLoanFixture);

      // Set profitable prices
      await uniswapDEX.setPrice(
        dai.target,
        weth.target,
        hre.ethers.parseEther("0.0004")
      );
      await sushiswapDEX.setPrice(
        weth.target,
        dai.target,
        hre.ethers.parseEther("2600")
      );

      // Mint initial flash loan amount
      await dai.mint(flashLoan.target, FLASH_LOAN_AMOUNT);

      await expect(flashLoan.executeArbitrage())
        .to.emit(flashLoan, "SwapExecuted")
        .withArgs(anyValue, anyValue, anyValue)
        .to.emit(flashLoan, "SwapExecuted")
        .withArgs(anyValue, anyValue, anyValue);
    });
  });

  describe("Access Control", function () {
    it("Should allow only owner to execute arbitrage", async function () {
      const { flashLoan, otherAccount } = await loadFixture(deployFlashLoanFixture);
      
      await expect(flashLoan.connect(otherAccount).executeArbitrage())
        .to.be.revertedWith("Only owner");
    });
  });
});