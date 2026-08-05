import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { FlareSealEscrow, MockERC20, MockFtsoV2 } from "../typechain-types";

const ZERO_ADDRESS = ethers.ZeroAddress;
const ZERO_BYTES32 = ethers.ZeroHash;

const FXRP_DECIMALS = 6n;
const FXRP_SCALE = 10n ** FXRP_DECIMALS;

const MAX_PRICE_AGE = 600n; // 10 minutes
const REFUND_GRACE_PERIOD = 7n * 24n * 60n * 60n; // 7 days

/** $0.50 per XRP, 18-decimal wei-USD. */
const PRICE_50_CENTS = ethers.parseEther("0.5");
/** $2.00 per XRP. */
const PRICE_2_USD = ethers.parseEther("2");

/** $100.00 expressed in integer cents. */
const USD_100 = 10_000n;

const COMMITMENT = ethers.keccak256(ethers.toUtf8Bytes("terms-commitment-v1"));
const ACTION_ID = ethers.keccak256(ethers.toUtf8Bytes("action-1"));
const SUBMISSION_TAG = "flareseal-invoice";

const ABI = ethers.AbiCoder.defaultAbiCoder();

const RESULT_SCHEMA = ["address", "address", "address", "uint256", "uint64", "bytes32"];

type ResultFields = {
  seller: string;
  buyer: string;
  escrowContract: string;
  usdAmountCents: bigint;
  dueAt: bigint;
  termsCommitment: string;
};

function encodeResultData(fields: ResultFields): string {
  return ABI.encode(RESULT_SCHEMA, [
    fields.seller,
    fields.buyer,
    fields.escrowContract,
    fields.usdAmountCents,
    fields.dueAt,
    fields.termsCommitment,
  ]);
}

/**
 * Reproduces the Flare FCC TEE signing scheme exactly as `FlareSealEscrow` verifies it:
 *   resultHash  = keccak256(abi.encodePacked(keccak256(data), actionId, keccak256(tag), status))
 *   payloadHash = keccak256(abi.encode(bytes32("TEE_ACTION_RESULT"), chainId, resultHash))
 *   signature   = personal_sign(payloadHash)      // EIP-191
 */
function buildPayloadHash(
  resultData: string,
  actionId: string,
  submissionTag: string,
  status: number,
  chainId: bigint,
): string {
  const resultHash = ethers.solidityPackedKeccak256(
    ["bytes32", "bytes32", "bytes32", "uint8"],
    [
      ethers.keccak256(resultData),
      actionId,
      ethers.keccak256(ethers.toUtf8Bytes(submissionTag)),
      status,
    ],
  );

  return ethers.keccak256(
    ABI.encode(
      ["bytes32", "uint256", "bytes32"],
      [ethers.encodeBytes32String("TEE_ACTION_RESULT"), chainId, resultHash],
    ),
  );
}

async function signTeeResult(
  signer: ethers.Wallet | HardhatEthersSigner,
  resultData: string,
  actionId: string,
  submissionTag: string,
  status: number,
  chainId: bigint,
): Promise<string> {
  const payloadHash = buildPayloadHash(resultData, actionId, submissionTag, status, chainId);
  return signer.signMessage(ethers.getBytes(payloadHash));
}

describe("FlareSealEscrow", () => {
  async function deployFixture() {
    const [owner, seller, buyer, stranger] = await ethers.getSigners();

    // Deterministic TEE key so signature tests are reproducible.
    const teeWallet = new ethers.Wallet(
      "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    );
    const rogueWallet = new ethers.Wallet(
      "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
    );

    const now = BigInt(await time.latest());

    const MockERC20Factory = await ethers.getContractFactory("MockERC20");
    const fxrp = (await MockERC20Factory.deploy("Test FXRP", "FXRP", 6)) as unknown as MockERC20;
    await fxrp.waitForDeployment();

    const MockFtsoFactory = await ethers.getContractFactory("MockFtsoV2");
    const ftso = (await MockFtsoFactory.deploy(PRICE_50_CENTS, now)) as unknown as MockFtsoV2;
    await ftso.waitForDeployment();

    const EscrowFactory = await ethers.getContractFactory("FlareSealEscrow");
    const escrow = (await EscrowFactory.deploy(
      owner.address,
      await fxrp.getAddress(),
      await ftso.getAddress(),
      MAX_PRICE_AGE,
      REFUND_GRACE_PERIOD,
    )) as unknown as FlareSealEscrow;
    await escrow.waitForDeployment();

    // Buyer starts with 1,000,000 FXRP so balance is never the limiting factor by accident.
    await fxrp.mint(buyer.address, 1_000_000n * FXRP_SCALE);

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const escrowAddress = await escrow.getAddress();

    /** Re-stamps the mock feed to the current block time so it passes the freshness check. */
    async function refreshPrice(priceWei: bigint = PRICE_50_CENTS) {
      await ftso.setPrice(priceWei, BigInt(await time.latest()) + 1n);
    }

    /** Due date one hour ahead of the current block. */
    async function dueSoon(offsetSeconds = 3600n) {
      return BigInt(await time.latest()) + offsetSeconds;
    }

    return {
      owner,
      seller,
      buyer,
      stranger,
      teeWallet,
      rogueWallet,
      fxrp,
      ftso,
      escrow,
      escrowAddress,
      chainId,
      refreshPrice,
      dueSoon,
    };
  }

  /** Fixture with the TEE address configured and a valid signed result ready to relay. */
  async function confidentialFixture() {
    const base = await deployFixture();
    await base.escrow.connect(base.owner).setTeeAddress(base.teeWallet.address);

    const dueAt = await base.dueSoon(7n * 24n * 3600n);
    const fields: ResultFields = {
      seller: base.seller.address,
      buyer: base.buyer.address,
      escrowContract: base.escrowAddress,
      usdAmountCents: USD_100,
      dueAt,
      termsCommitment: COMMITMENT,
    };
    const resultData = encodeResultData(fields);
    const signature = await signTeeResult(
      base.teeWallet,
      resultData,
      ACTION_ID,
      SUBMISSION_TAG,
      1,
      base.chainId,
    );

    return { ...base, fields, resultData, signature, dueAt };
  }

  /** Creates a pending public invoice and returns its id. */
  async function createPendingInvoice(ctx: Awaited<ReturnType<typeof deployFixture>>) {
    const dueAt = await ctx.dueSoon(7n * 24n * 3600n);
    await ctx.escrow
      .connect(ctx.seller)
      .createPublicInvoice(ctx.buyer.address, COMMITMENT, USD_100, dueAt);
    return { invoiceId: 1n, dueAt };
  }

  /** Creates and funds an invoice, returning its id and the exact FXRP amount escrowed. */
  async function createFundedInvoice(ctx: Awaited<ReturnType<typeof deployFixture>>) {
    const { invoiceId, dueAt } = await createPendingInvoice(ctx);
    await ctx.refreshPrice();
    const required = (await ctx.escrow.connect(ctx.buyer).quoteInvoice.staticCall(invoiceId))[0];
    await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, required);
    await ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, required);
    return { invoiceId, dueAt, required };
  }

  // -------------------------------------------------------------------
  // Interface compatibility
  // -------------------------------------------------------------------

  describe("FTSOv2 interface compatibility", () => {
    it("minimal interface selector matches the official Flare periphery interface", async () => {
      const probe = await (await ethers.getContractFactory("FtsoSelectorProbe")).deploy();
      await probe.waitForDeployment();

      expect(await probe.minimalSelector()).to.equal(await probe.officialSelector());
    });
  });

  // -------------------------------------------------------------------
  // Deployment
  // -------------------------------------------------------------------

  describe("Deployment", () => {
    it("stores immutable configuration", async () => {
      const { escrow, owner, fxrp, ftso } = await loadFixture(deployFixture);

      expect(await escrow.owner()).to.equal(owner.address);
      expect(await escrow.FXRP()).to.equal(await fxrp.getAddress());
      expect(await escrow.FTSO_V2()).to.equal(await ftso.getAddress());
      expect(await escrow.maxPriceAge()).to.equal(MAX_PRICE_AGE);
      expect(await escrow.refundGracePeriod()).to.equal(REFUND_GRACE_PERIOD);
      expect(await escrow.fxrpScale()).to.equal(FXRP_SCALE);
      expect(await escrow.nextInvoiceId()).to.equal(1n);
      expect(await escrow.totalEscrowed()).to.equal(0n);
      expect(await escrow.teeAddress()).to.equal(ZERO_ADDRESS);
      expect(await escrow.XRP_USD_FEED_ID()).to.equal(
        "0x015852502f55534400000000000000000000000000",
      );
    });

    it("rejects a zero owner", async () => {
      const { fxrp, ftso } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("FlareSealEscrow");

      await expect(
        Factory.deploy(
          ZERO_ADDRESS,
          await fxrp.getAddress(),
          await ftso.getAddress(),
          MAX_PRICE_AGE,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "OwnableInvalidOwner");
    });

    it("rejects a zero FXRP address", async () => {
      const { owner, ftso } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("FlareSealEscrow");

      await expect(
        Factory.deploy(
          owner.address,
          ZERO_ADDRESS,
          await ftso.getAddress(),
          MAX_PRICE_AGE,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    });

    it("rejects a zero FTSO address", async () => {
      const { owner, fxrp } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("FlareSealEscrow");

      await expect(
        Factory.deploy(
          owner.address,
          await fxrp.getAddress(),
          ZERO_ADDRESS,
          MAX_PRICE_AGE,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    });

    it("rejects an externally owned account where a contract is required", async () => {
      const { owner, stranger, ftso } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("FlareSealEscrow");

      await expect(
        Factory.deploy(
          owner.address,
          stranger.address,
          await ftso.getAddress(),
          MAX_PRICE_AGE,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "NotAContract");
    });

    it("rejects a zero max price age", async () => {
      const { owner, fxrp, ftso } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("FlareSealEscrow");

      await expect(
        Factory.deploy(
          owner.address,
          await fxrp.getAddress(),
          await ftso.getAddress(),
          0n,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "InvalidMaxPriceAge");
    });

    it("rejects a max price age above the 24 hour ceiling", async () => {
      const { owner, fxrp, ftso } = await loadFixture(deployFixture);
      const Factory = await ethers.getContractFactory("FlareSealEscrow");

      await expect(
        Factory.deploy(
          owner.address,
          await fxrp.getAddress(),
          await ftso.getAddress(),
          24n * 3600n + 1n,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "InvalidMaxPriceAge");
    });

    it("rejects a token reporting more than 18 decimals", async () => {
      const { owner, ftso } = await loadFixture(deployFixture);
      const weird = await (
        await ethers.getContractFactory("MockERC20")
      ).deploy("Weird", "WRD", 20);
      await weird.waitForDeployment();

      const Factory = await ethers.getContractFactory("FlareSealEscrow");
      await expect(
        Factory.deploy(
          owner.address,
          await weird.getAddress(),
          await ftso.getAddress(),
          MAX_PRICE_AGE,
          REFUND_GRACE_PERIOD,
        ),
      ).to.be.revertedWithCustomError(Factory, "UnsupportedTokenDecimals");
    });
  });

  // -------------------------------------------------------------------
  // Public invoice creation
  // -------------------------------------------------------------------

  describe("createPublicInvoice", () => {
    it("creates a pending public invoice and emits InvoiceCreated", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .createPublicInvoice(ctx.buyer.address, COMMITMENT, USD_100, dueAt),
      )
        .to.emit(ctx.escrow, "InvoiceCreated")
        .withArgs(
          1n,
          ctx.seller.address,
          ctx.buyer.address,
          COMMITMENT,
          USD_100,
          dueAt,
          false,
          ZERO_BYTES32,
        );

      const invoice = await ctx.escrow.getInvoice(1n);
      expect(invoice.id).to.equal(1n);
      expect(invoice.seller).to.equal(ctx.seller.address);
      expect(invoice.buyer).to.equal(ctx.buyer.address);
      expect(invoice.usdAmountCents).to.equal(USD_100);
      expect(invoice.confidential).to.equal(false);
      expect(invoice.fccActionId).to.equal(ZERO_BYTES32);
      expect(invoice.status).to.equal(1n); // Pending
      expect(invoice.fxrpAmount).to.equal(0n);
      expect(await ctx.escrow.invoiceExists(1n)).to.equal(true);
    });

    it("increments the invoice id and updates both party indexes", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();

      await ctx.escrow
        .connect(ctx.seller)
        .createPublicInvoice(ctx.buyer.address, COMMITMENT, USD_100, dueAt);
      await ctx.escrow
        .connect(ctx.seller)
        .createPublicInvoice(ctx.buyer.address, COMMITMENT, USD_100 * 2n, dueAt);

      expect(await ctx.escrow.nextInvoiceId()).to.equal(3n);
      expect(await ctx.escrow.getSellerInvoiceIds(ctx.seller.address)).to.deep.equal([1n, 2n]);
      expect(await ctx.escrow.getBuyerInvoiceIds(ctx.buyer.address)).to.deep.equal([1n, 2n]);
    });

    it("rejects a zero buyer", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();

      await expect(
        ctx.escrow.connect(ctx.seller).createPublicInvoice(ZERO_ADDRESS, COMMITMENT, USD_100, dueAt),
      ).to.be.revertedWithCustomError(ctx.escrow, "ZeroAddress");
    });

    it("rejects the seller naming themselves as buyer", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .createPublicInvoice(ctx.seller.address, COMMITMENT, USD_100, dueAt),
      ).to.be.revertedWithCustomError(ctx.escrow, "SameSellerAndBuyer");
    });

    it("rejects a zero amount", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .createPublicInvoice(ctx.buyer.address, COMMITMENT, 0n, dueAt),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidAmount");
    });

    it("rejects a zero commitment", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .createPublicInvoice(ctx.buyer.address, ZERO_BYTES32, USD_100, dueAt),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidCommitment");
    });

    it("rejects a due date in the past", async () => {
      const ctx = await loadFixture(deployFixture);
      const past = BigInt(await time.latest()) - 1n;

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .createPublicInvoice(ctx.buyer.address, COMMITMENT, USD_100, past),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidDueDate");
    });

    it("reverts reading an invoice that does not exist", async () => {
      const ctx = await loadFixture(deployFixture);

      await expect(ctx.escrow.getInvoice(99n)).to.be.revertedWithCustomError(
        ctx.escrow,
        "InvoiceNotFound",
      );
      expect(await ctx.escrow.invoiceExists(99n)).to.equal(false);
    });
  });

  // -------------------------------------------------------------------
  // Confidential FCC relay
  // -------------------------------------------------------------------

  describe("relayConfidentialInvoice", () => {
    it("accepts a correctly signed TEE result and creates a confidential invoice", async () => {
      const ctx = await loadFixture(confidentialFixture);

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            1,
            ctx.signature,
          ),
      )
        .to.emit(ctx.escrow, "InvoiceCreated")
        .withArgs(
          1n,
          ctx.seller.address,
          ctx.buyer.address,
          COMMITMENT,
          USD_100,
          ctx.dueAt,
          true,
          ACTION_ID,
        );

      const invoice = await ctx.escrow.getInvoice(1n);
      expect(invoice.confidential).to.equal(true);
      expect(invoice.fccActionId).to.equal(ACTION_ID);
      expect(invoice.status).to.equal(1n); // Pending
      expect(invoice.usdAmountCents).to.equal(USD_100);
      expect(invoice.termsCommitment).to.equal(COMMITMENT);
      expect(await ctx.escrow.consumedFccActionIds(ACTION_ID)).to.equal(true);
    });

    it("rejects a signature bound to a different chain id", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const wrongChainSignature = await signTeeResult(
        ctx.teeWallet,
        ctx.resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId + 1n,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            1,
            wrongChainSignature,
          ),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidTeeSignature");
    });

    it("rejects a signature over a different submission tag", async () => {
      const ctx = await loadFixture(confidentialFixture);

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            "some-other-tag",
            1,
            ctx.signature,
          ),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidTeeSignature");
    });

    it("reverts before the TEE address is configured", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon(7n * 24n * 3600n);
      const resultData = encodeResultData({
        seller: ctx.seller.address,
        buyer: ctx.buyer.address,
        escrowContract: ctx.escrowAddress,
        usdAmountCents: USD_100,
        dueAt,
        termsCommitment: COMMITMENT,
      });
      const signature = await signTeeResult(
        ctx.teeWallet,
        resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(resultData, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "TeeNotConfigured");
    });

    it("rejects a status other than 1", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const failSignature = await signTeeResult(
        ctx.teeWallet,
        ctx.resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        0,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            0,
            failSignature,
          ),
      ).to.be.revertedWithCustomError(ctx.escrow, "TeeReportedFailure");
    });

    it("rejects a result signed by a wallet that is not the configured TEE", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const rogueSignature = await signTeeResult(
        ctx.rogueWallet,
        ctx.resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            1,
            rogueSignature,
          ),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidTeeSignature");
    });

    it("rejects a result addressed to a different escrow contract", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const resultData = encodeResultData({
        ...ctx.fields,
        escrowContract: ctx.stranger.address,
      });
      const signature = await signTeeResult(
        ctx.teeWallet,
        resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(resultData, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "ResultForWrongContract");
    });

    it("rejects relay by anyone other than the encoded seller", async () => {
      const ctx = await loadFixture(confidentialFixture);

      await expect(
        ctx.escrow
          .connect(ctx.stranger)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            1,
            ctx.signature,
          ),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidResultSeller");
    });

    it("rejects replay of an already consumed action id", async () => {
      const ctx = await loadFixture(confidentialFixture);

      await ctx.escrow
        .connect(ctx.seller)
        .relayConfidentialInvoice(ctx.resultData, ACTION_ID, SUBMISSION_TAG, 1, ctx.signature);

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            1,
            ctx.signature,
          ),
      ).to.be.revertedWithCustomError(ctx.escrow, "FccActionAlreadyConsumed");
    });

    it("rejects a zero action id", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const signature = await signTeeResult(
        ctx.teeWallet,
        ctx.resultData,
        ZERO_BYTES32,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(ctx.resultData, ZERO_BYTES32, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidActionId");
    });

    it("rejects malformed result data even when correctly signed", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const malformed = "0xdeadbeef";
      const signature = await signTeeResult(
        ctx.teeWallet,
        malformed,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(malformed, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.reverted;
    });

    it("rejects a signed result carrying a zero buyer", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const resultData = encodeResultData({ ...ctx.fields, buyer: ZERO_ADDRESS });
      const signature = await signTeeResult(
        ctx.teeWallet,
        resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(resultData, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "ZeroAddress");
    });

    it("rejects a signed result carrying a zero amount", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const resultData = encodeResultData({ ...ctx.fields, usdAmountCents: 0n });
      const signature = await signTeeResult(
        ctx.teeWallet,
        resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(resultData, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidAmount");
    });

    it("rejects a signed result carrying a past due date", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const resultData = encodeResultData({
        ...ctx.fields,
        dueAt: BigInt(await time.latest()) - 10n,
      });
      const signature = await signTeeResult(
        ctx.teeWallet,
        resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(resultData, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidDueDate");
    });

    it("rejects a signed result carrying a zero commitment", async () => {
      const ctx = await loadFixture(confidentialFixture);
      const resultData = encodeResultData({ ...ctx.fields, termsCommitment: ZERO_BYTES32 });
      const signature = await signTeeResult(
        ctx.teeWallet,
        resultData,
        ACTION_ID,
        SUBMISSION_TAG,
        1,
        ctx.chainId,
      );

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .relayConfidentialInvoice(resultData, ACTION_ID, SUBMISSION_TAG, 1, signature),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidCommitment");
    });

    it("does not consume the action id when the relay reverts", async () => {
      const ctx = await loadFixture(confidentialFixture);

      await expect(
        ctx.escrow
          .connect(ctx.stranger)
          .relayConfidentialInvoice(
            ctx.resultData,
            ACTION_ID,
            SUBMISSION_TAG,
            1,
            ctx.signature,
          ),
      ).to.be.reverted;

      expect(await ctx.escrow.consumedFccActionIds(ACTION_ID)).to.equal(false);

      // The legitimate seller can still relay the same result afterwards.
      await ctx.escrow
        .connect(ctx.seller)
        .relayConfidentialInvoice(ctx.resultData, ACTION_ID, SUBMISSION_TAG, 1, ctx.signature);
      expect(await ctx.escrow.consumedFccActionIds(ACTION_ID)).to.equal(true);
    });
  });

  // -------------------------------------------------------------------
  // Quote math
  // -------------------------------------------------------------------

  describe("quoteInvoice", () => {
    it("prices $100.00 at $0.50/XRP as exactly 200 FXRP", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice(PRICE_50_CENTS);

      const [required, priceWei] = await ctx.escrow.quoteInvoice.staticCall(invoiceId);
      expect(required).to.equal(200n * FXRP_SCALE);
      expect(priceWei).to.equal(PRICE_50_CENTS);
    });

    it("prices $100.00 at $2.00/XRP as exactly 50 FXRP", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice(PRICE_2_USD);

      const [required] = await ctx.escrow.quoteInvoice.staticCall(invoiceId);
      expect(required).to.equal(50n * FXRP_SCALE);
    });

    it("rounds a non-divisible amount upward so the escrow is never under-funded", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();
      // $0.01 at $0.30/XRP = 0.0333... XRP -> 33334 units at 6 decimals (ceiling).
      await ctx.escrow
        .connect(ctx.seller)
        .createPublicInvoice(ctx.buyer.address, COMMITMENT, 1n, dueAt);
      await ctx.refreshPrice(ethers.parseEther("0.3"));

      const [required] = await ctx.escrow.quoteInvoice.staticCall(1n);
      expect(required).to.equal(33_334n);

      // Floor would have been 33333; ceiling is strictly greater.
      const floorValue = (1n * 10n ** 16n * FXRP_SCALE) / ethers.parseEther("0.3");
      expect(required).to.equal(floorValue + 1n);
    });

    it("reverts on a zero price", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.ftso.setPrice(0n, BigInt(await time.latest()) + 1n);

      await expect(
        ctx.escrow.quoteInvoice.staticCall(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidPrice");
    });

    it("reverts on a stale price", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();
      await time.increase(MAX_PRICE_AGE + 60n);

      await expect(
        ctx.escrow.quoteInvoice.staticCall(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "StalePrice");
    });

    it("reverts on a timestamp in the future", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.ftso.setPrice(PRICE_50_CENTS, BigInt(await time.latest()) + 10_000n);

      await expect(
        ctx.escrow.quoteInvoice.staticCall(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidPrice");
    });

    it("reverts for an unknown invoice", async () => {
      const ctx = await loadFixture(deployFixture);

      await expect(ctx.escrow.quoteInvoice.staticCall(42n)).to.be.revertedWithCustomError(
        ctx.escrow,
        "InvoiceNotFound",
      );
    });

    it("reverts for an invoice that is no longer pending", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);

      await expect(
        ctx.escrow.quoteInvoice.staticCall(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidStatus");
    });
  });

  // -------------------------------------------------------------------
  // Funding
  // -------------------------------------------------------------------

  describe("fundInvoice", () => {
    it("transfers exactly the quoted amount and records the funding price", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();

      const expected = 200n * FXRP_SCALE;
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, expected);

      await expect(ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, expected))
        .to.emit(ctx.escrow, "InvoiceFunded")
        .withArgs(invoiceId, ctx.buyer.address, expected, PRICE_50_CENTS);

      expect(await ctx.fxrp.balanceOf(ctx.escrowAddress)).to.equal(expected);
      expect(await ctx.escrow.totalEscrowed()).to.equal(expected);

      const invoice = await ctx.escrow.getInvoice(invoiceId);
      expect(invoice.status).to.equal(2n); // Funded
      expect(invoice.fxrpAmount).to.equal(expected);
      expect(invoice.xrpUsdPriceWei).to.equal(PRICE_50_CENTS);
      expect(invoice.fundedAt).to.be.greaterThan(0n);
    });

    it("reads the price on-chain rather than trusting the caller", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();

      const before = await ctx.ftso.callCount();
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, 200n * FXRP_SCALE);
      await ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, 200n * FXRP_SCALE);

      expect(await ctx.ftso.callCount()).to.equal(before + 1n);
    });

    it("rejects funding by anyone other than the named buyer", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();
      await ctx.fxrp.mint(ctx.stranger.address, 1000n * FXRP_SCALE);
      await ctx.fxrp.connect(ctx.stranger).approve(ctx.escrowAddress, 1000n * FXRP_SCALE);

      await expect(
        ctx.escrow.connect(ctx.stranger).fundInvoice(invoiceId, 1000n * FXRP_SCALE),
      ).to.be.revertedWithCustomError(ctx.escrow, "NotBuyer");
    });

    it("rejects funding above the caller's slippage ceiling", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, 1000n * FXRP_SCALE);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, 200n * FXRP_SCALE - 1n),
      ).to.be.revertedWithCustomError(ctx.escrow, "SlippageExceeded");
    });

    it("reverts when the allowance is insufficient", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, 1n);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, 200n * FXRP_SCALE),
      ).to.be.revertedWithCustomError(ctx.fxrp, "ERC20InsufficientAllowance");
    });

    it("reverts when the buyer's balance is insufficient", async () => {
      const ctx = await loadFixture(deployFixture);
      const dueAt = await ctx.dueSoon();
      // $10,000,000.00 needs 20,000,000 FXRP; the buyer holds 1,000,000.
      await ctx.escrow
        .connect(ctx.seller)
        .createPublicInvoice(ctx.buyer.address, COMMITMENT, 1_000_000_000n, dueAt);
      await ctx.refreshPrice();
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, ethers.MaxUint256);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(1n, 20_000_000n * FXRP_SCALE),
      ).to.be.revertedWithCustomError(ctx.fxrp, "ERC20InsufficientBalance");
    });

    it("rejects funding after the due date", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId, dueAt } = await createPendingInvoice(ctx);
      await time.increaseTo(dueAt + 1n);
      await ctx.refreshPrice();
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, ethers.MaxUint256);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, 200n * FXRP_SCALE),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvoiceExpired");
    });

    it("rejects funding on a stale price", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);
      await ctx.refreshPrice();
      await time.increase(MAX_PRICE_AGE + 60n);
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, ethers.MaxUint256);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, ethers.MaxUint256),
      ).to.be.revertedWithCustomError(ctx.escrow, "StalePrice");
    });

    it("cannot fund the same invoice twice", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);
      await ctx.refreshPrice();
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, ethers.MaxUint256);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, ethers.MaxUint256),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidStatus");
    });

    it("reverts for an unknown invoice", async () => {
      const ctx = await loadFixture(deployFixture);

      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(7n, ethers.MaxUint256),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvoiceNotFound");
    });
  });

  // -------------------------------------------------------------------
  // Release
  // -------------------------------------------------------------------

  describe("releasePayment", () => {
    it("pays the seller the exact escrowed amount", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId, required } = await createFundedInvoice(ctx);
      const before = await ctx.fxrp.balanceOf(ctx.seller.address);

      await expect(ctx.escrow.connect(ctx.buyer).releasePayment(invoiceId))
        .to.emit(ctx.escrow, "InvoiceReleased")
        .withArgs(invoiceId, ctx.seller.address, required);

      expect(await ctx.fxrp.balanceOf(ctx.seller.address)).to.equal(before + required);
      expect(await ctx.fxrp.balanceOf(ctx.escrowAddress)).to.equal(0n);
      expect(await ctx.escrow.totalEscrowed()).to.equal(0n);

      const invoice = await ctx.escrow.getInvoice(invoiceId);
      expect(invoice.status).to.equal(3n); // Released
      expect(invoice.settledAt).to.be.greaterThan(0n);
    });

    it("rejects release by the seller", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);

      await expect(
        ctx.escrow.connect(ctx.seller).releasePayment(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "NotBuyer");
    });

    it("rejects release by an unrelated wallet", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);

      await expect(
        ctx.escrow.connect(ctx.stranger).releasePayment(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "NotBuyer");
    });

    it("cannot release twice", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);
      await ctx.escrow.connect(ctx.buyer).releasePayment(invoiceId);

      await expect(
        ctx.escrow.connect(ctx.buyer).releasePayment(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidStatus");
    });

    it("cannot release an invoice that was never funded", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);

      await expect(
        ctx.escrow.connect(ctx.buyer).releasePayment(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidStatus");
    });
  });

  // -------------------------------------------------------------------
  // Seller refund
  // -------------------------------------------------------------------

  describe("refundBuyer", () => {
    it("returns the exact amount to the buyer", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId, required } = await createFundedInvoice(ctx);
      const before = await ctx.fxrp.balanceOf(ctx.buyer.address);

      await expect(ctx.escrow.connect(ctx.seller).refundBuyer(invoiceId))
        .to.emit(ctx.escrow, "InvoiceRefunded")
        .withArgs(invoiceId, ctx.buyer.address, required, false);

      expect(await ctx.fxrp.balanceOf(ctx.buyer.address)).to.equal(before + required);
      expect(await ctx.escrow.totalEscrowed()).to.equal(0n);
      expect((await ctx.escrow.getInvoice(invoiceId)).status).to.equal(4n); // Refunded
    });

    it("rejects a buyer calling the seller refund path", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);

      await expect(
        ctx.escrow.connect(ctx.buyer).refundBuyer(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "NotSeller");
    });

    it("cannot refund twice", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);
      await ctx.escrow.connect(ctx.seller).refundBuyer(invoiceId);

      await expect(
        ctx.escrow.connect(ctx.seller).refundBuyer(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidStatus");
    });
  });

  // -------------------------------------------------------------------
  // Expired refund
  // -------------------------------------------------------------------

  describe("claimExpiredRefund", () => {
    it("rejects a claim before the grace period elapses", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId, dueAt } = await createFundedInvoice(ctx);
      await time.increaseTo(dueAt + REFUND_GRACE_PERIOD - 10n);

      await expect(
        ctx.escrow.connect(ctx.buyer).claimExpiredRefund(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "RefundNotAvailable");
    });

    it("allows the buyer to reclaim after the grace period", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId, dueAt, required } = await createFundedInvoice(ctx);
      const before = await ctx.fxrp.balanceOf(ctx.buyer.address);
      await time.increaseTo(dueAt + REFUND_GRACE_PERIOD + 1n);

      await expect(ctx.escrow.connect(ctx.buyer).claimExpiredRefund(invoiceId))
        .to.emit(ctx.escrow, "InvoiceRefunded")
        .withArgs(invoiceId, ctx.buyer.address, required, true);

      expect(await ctx.fxrp.balanceOf(ctx.buyer.address)).to.equal(before + required);
      expect(await ctx.escrow.totalEscrowed()).to.equal(0n);
    });

    it("rejects a claim by a non-buyer", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId, dueAt } = await createFundedInvoice(ctx);
      await time.increaseTo(dueAt + REFUND_GRACE_PERIOD + 1n);

      await expect(
        ctx.escrow.connect(ctx.stranger).claimExpiredRefund(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "NotBuyer");
    });
  });

  // -------------------------------------------------------------------
  // Cancellation
  // -------------------------------------------------------------------

  describe("cancelInvoice", () => {
    it("lets the seller cancel a pending invoice", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);

      await expect(ctx.escrow.connect(ctx.seller).cancelInvoice(invoiceId))
        .to.emit(ctx.escrow, "InvoiceCancelled")
        .withArgs(invoiceId);

      expect((await ctx.escrow.getInvoice(invoiceId)).status).to.equal(5n); // Cancelled
    });

    it("rejects cancellation by the buyer", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createPendingInvoice(ctx);

      await expect(
        ctx.escrow.connect(ctx.buyer).cancelInvoice(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "NotSeller");
    });

    it("cannot cancel a funded invoice", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);

      await expect(
        ctx.escrow.connect(ctx.seller).cancelInvoice(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "InvalidStatus");
    });
  });

  // -------------------------------------------------------------------
  // Administration
  // -------------------------------------------------------------------

  describe("Administration", () => {
    it("only the owner can set the TEE address", async () => {
      const ctx = await loadFixture(deployFixture);

      await expect(ctx.escrow.connect(ctx.stranger).setTeeAddress(ctx.teeWallet.address))
        .to.be.revertedWithCustomError(ctx.escrow, "OwnableUnauthorizedAccount")
        .withArgs(ctx.stranger.address);

      await expect(ctx.escrow.connect(ctx.owner).setTeeAddress(ctx.teeWallet.address))
        .to.emit(ctx.escrow, "TeeAddressUpdated")
        .withArgs(ZERO_ADDRESS, ctx.teeWallet.address);

      expect(await ctx.escrow.teeAddress()).to.equal(ctx.teeWallet.address);
    });

    it("rejects a zero TEE address", async () => {
      const ctx = await loadFixture(deployFixture);

      await expect(
        ctx.escrow.connect(ctx.owner).setTeeAddress(ZERO_ADDRESS),
      ).to.be.revertedWithCustomError(ctx.escrow, "ZeroAddress");
    });

    it("owner can pause and unpause, and mutating flows revert while paused", async () => {
      const ctx = await loadFixture(deployFixture);
      const { invoiceId } = await createFundedInvoice(ctx);
      const dueAt = await ctx.dueSoon();

      await ctx.escrow.connect(ctx.owner).pause();

      await expect(
        ctx.escrow
          .connect(ctx.seller)
          .createPublicInvoice(ctx.buyer.address, COMMITMENT, USD_100, dueAt),
      ).to.be.revertedWithCustomError(ctx.escrow, "EnforcedPause");
      await expect(
        ctx.escrow.connect(ctx.buyer).fundInvoice(invoiceId, ethers.MaxUint256),
      ).to.be.revertedWithCustomError(ctx.escrow, "EnforcedPause");
      await expect(
        ctx.escrow.connect(ctx.buyer).releasePayment(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "EnforcedPause");
      await expect(
        ctx.escrow.connect(ctx.seller).refundBuyer(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "EnforcedPause");
      await expect(
        ctx.escrow.connect(ctx.seller).cancelInvoice(invoiceId),
      ).to.be.revertedWithCustomError(ctx.escrow, "EnforcedPause");

      await ctx.escrow.connect(ctx.owner).unpause();
      await ctx.escrow.connect(ctx.buyer).releasePayment(invoiceId);
      expect((await ctx.escrow.getInvoice(invoiceId)).status).to.equal(3n);
    });

    it("only the owner can pause", async () => {
      const ctx = await loadFixture(deployFixture);

      await expect(
        ctx.escrow.connect(ctx.stranger).pause(),
      ).to.be.revertedWithCustomError(ctx.escrow, "OwnableUnauthorizedAccount");
    });

    it("the owner cannot withdraw escrowed FXRP", async () => {
      const ctx = await loadFixture(deployFixture);
      await createFundedInvoice(ctx);

      await expect(
        ctx.escrow
          .connect(ctx.owner)
          .recoverUnsupportedToken(ctx.escrowAddress, ctx.owner.address, 1n),
      ).to.be.reverted;

      await expect(
        ctx.escrow
          .connect(ctx.owner)
          .recoverUnsupportedToken(await ctx.fxrp.getAddress(), ctx.owner.address, 1n),
      ).to.be.revertedWithCustomError(ctx.escrow, "CannotRecoverEscrowToken");

      // The escrow still holds every unit the buyer deposited.
      expect(await ctx.fxrp.balanceOf(ctx.escrowAddress)).to.equal(
        await ctx.escrow.totalEscrowed(),
      );
    });

    it("recovers a genuinely unsupported token", async () => {
      const ctx = await loadFixture(deployFixture);
      const other = await (
        await ethers.getContractFactory("MockERC20")
      ).deploy("Other", "OTH", 18);
      await other.waitForDeployment();
      await other.mint(ctx.escrowAddress, 500n);

      await ctx.escrow
        .connect(ctx.owner)
        .recoverUnsupportedToken(await other.getAddress(), ctx.owner.address, 500n);

      expect(await other.balanceOf(ctx.owner.address)).to.equal(500n);
    });
  });

  // -------------------------------------------------------------------
  // Full lifecycle
  // -------------------------------------------------------------------

  describe("End-to-end confidential lifecycle", () => {
    it("relays a TEE result, funds, and releases with no plaintext on-chain", async () => {
      const ctx = await loadFixture(confidentialFixture);

      await ctx.escrow
        .connect(ctx.seller)
        .relayConfidentialInvoice(ctx.resultData, ACTION_ID, SUBMISSION_TAG, 1, ctx.signature);

      await ctx.refreshPrice();
      const [required] = await ctx.escrow.quoteInvoice.staticCall(1n);
      await ctx.fxrp.connect(ctx.buyer).approve(ctx.escrowAddress, required);
      await ctx.escrow.connect(ctx.buyer).fundInvoice(1n, required);

      const sellerBefore = await ctx.fxrp.balanceOf(ctx.seller.address);
      await ctx.escrow.connect(ctx.buyer).releasePayment(1n);

      expect(await ctx.fxrp.balanceOf(ctx.seller.address)).to.equal(sellerBefore + required);

      const invoice = await ctx.escrow.getInvoice(1n);
      expect(invoice.status).to.equal(3n); // Released
      expect(invoice.confidential).to.equal(true);
      expect(invoice.termsCommitment).to.equal(COMMITMENT);

      // The struct exposes no free-form text field that could carry line items.
      const invoiceKeys = Object.keys(ctx.escrow.interface.getFunction("getInvoice")!.outputs[0]
        .components!.reduce((acc: Record<string, true>, c) => ({ ...acc, [c.name]: true }), {}));
      expect(invoiceKeys).to.not.include("description");
      expect(invoiceKeys).to.not.include("items");
      expect(invoiceKeys).to.not.include("salt");
      expect(invoiceKeys).to.not.include("nonce");
    });
  });
});
