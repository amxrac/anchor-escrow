import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { AnchorEscrow } from "../target/types/anchor_escrow";
import { publicKey } from "@coral-xyz/anchor/dist/cjs/utils";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  ASSOCIATED_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@coral-xyz/anchor/dist/cjs/utils/token";
import { expect } from "chai";
import { getAccount } from "@solana/spl-token";

describe("anchor_escrow", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  // const payer = provider.wallet as anchor.Wallet;
  const maker = anchor.web3.Keypair.generate();
  const taker = anchor.web3.Keypair.generate();
  const program = anchor.workspace.anchorEscrow as Program<AnchorEscrow>;

  before(async () => {
    const sig_a = await provider.connection.requestAirdrop(
      maker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const bh_a = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature: sig_a,
        blockhash: bh_a.blockhash,
        lastValidBlockHeight: bh_a.lastValidBlockHeight,
      },
      "confirmed"
    );

    const sig_b = await provider.connection.requestAirdrop(
      taker.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    const bh_b = await provider.connection.getLatestBlockhash();
    await provider.connection.confirmTransaction(
      {
        signature: sig_b,
        blockhash: bh_b.blockhash,
        lastValidBlockHeight: bh_b.lastValidBlockHeight,
      },
      "confirmed"
    );
  });

  it("makes the offer", async () => {
    const seed = new anchor.BN(1);
    const [escrowAddress] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("escrow"),
        maker.publicKey.toBuffer(),
        seed.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );
    const receive = new anchor.BN(10);
    const amount = new anchor.BN(20);
    const mintA = await createMint(
      provider.connection,
      maker,
      maker.publicKey,
      null,
      6
    );
    const mintB = await createMint(
      provider.connection,
      taker,
      taker.publicKey,
      null,
      6
    );
    const makerAtaA = await createAssociatedTokenAccount(
      provider.connection,
      maker,
      mintA,
      maker.publicKey
    );
    const vaultAddress = await getAssociatedTokenAddress(
      mintA,
      escrowAddress,
      true
    );
    await mintTo(provider.connection, maker, mintA, makerAtaA, maker, 100_000);

    const tx = await program.methods
      .make(seed, receive, amount)
      .accountsPartial({
        maker: maker.publicKey,
        escrow: escrowAddress,
        mintA: mintA,
        mintB: mintB,
        makerAtaA: makerAtaA,
        vault: vaultAddress,
        associatedTokenProgram: ASSOCIATED_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([maker])
      .rpc();

    const escrowAccount = await program.account.escrow.fetch(escrowAddress);
    expect(escrowAccount.seed.toNumber()).to.equal(seed.toNumber());
    expect(escrowAccount.receive.toNumber()).to.equal(receive.toNumber());
    expect(escrowAccount.maker.toBase58()).to.equal(maker.publicKey.toBase58());
    expect(escrowAccount.mintA.toBase58()).to.equal(mintA.toBase58());
    expect(escrowAccount.mintB.toBase58()).to.equal(mintB.toBase58());

    const vault = await getAccount(provider.connection, vaultAddress);
    expect(Number(vault.amount)).to.equal(amount.toNumber());

    console.log("make transaction signature", tx);
  });
});
