import * as anchor from '@project-serum/anchor';
import { AccountInfo } from '@solana/web3.js'
import { Coder, Program, web3 } from '@project-serum/anchor';
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { TOKEN_PROGRAM_ID } from '@project-serum/anchor/dist/cjs/utils/token';
import { RPC_URL } from '../config';
import { WalletContextState } from '@solana/wallet-adapter-react';
import { IDL } from './staking';
import { UserPool } from './type';

export const solConnection = new web3.Connection(RPC_URL);
const METAPLEX = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');

const USER_POOL_SIZE = 2056;
const GLOBAL_AUTHORITY_SEED = "global-authority";

const PROGRAM_ID = "8QEYpGm6kZFnY8MhPjgJKzwQqRgU3yihYgGr7o2iQQo6";

// Address of the deployed program.
const programId = new anchor.web3.PublicKey(PROGRAM_ID);

const initUserPoolTx = async (
    wallet: WalletContextState,
) => {
    if (wallet.publicKey === null) return;
    const userAddress = wallet.publicKey;
    const userFixedPoolAddr = await getUserFixedPoolAddr(wallet);
    const cloneWindow: any = window;
    const provider = new anchor.AnchorProvider(
        solConnection,
        cloneWindow["solana"],
        anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(
        IDL as anchor.Idl,
        PROGRAM_ID,
        provider
    );
    console.log("userFixedPoolAddr: ", userFixedPoolAddr);

    let tx = new Transaction();
    if (userFixedPoolAddr) {
        let ix = SystemProgram.createAccountWithSeed({
            fromPubkey: userAddress,
            basePubkey: userAddress,
            seed: "user-fixed-pool",
            newAccountPubkey: userFixedPoolAddr,
            lamports: await provider.connection.getMinimumBalanceForRentExemption(USER_POOL_SIZE),
            space: USER_POOL_SIZE,
            programId: program.programId,
        });

        tx.add(ix);
        tx.add(program.instruction.initializeFixedPool({
            accounts: {
                userFixedPool: userFixedPoolAddr,
                owner: userAddress
            }
        }));

        return tx;
    }
}

export const stakeNft = async (
    wallet: WalletContextState,
    mint: PublicKey,
    setLoading: Function
) => {
    if (wallet.publicKey === null) return;
    setLoading(true);
    const cloneWindow: any = window;
    const userAddress = wallet.publicKey;
    const provider = new anchor.AnchorProvider(
        solConnection,
        cloneWindow["solana"],
        anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(
        IDL as anchor.Idl,
        PROGRAM_ID,
        provider
    );
    try {
        console.log("NFT address: ", mint.toBase58());
        const user_ata = await getAssociatedTokenAccount(userAddress, mint);
        console.log("user ATA: ", user_ata.toBase58());

        const [globalAuthority, _] = await findGlobalAuthorityPDA(program);
        console.log("globalAuthority: ", globalAuthority.toBase58());

        const userFixedPoolAddr = await getUserFixedPoolAddr(wallet);
        if (userFixedPoolAddr) {
            let poolAccount = await solConnection.getAccountInfo(userFixedPoolAddr);

            if (poolAccount === null || poolAccount.data === null) {
                const intTx = await initUserPoolTx(wallet);
                if (intTx !== undefined) {
                    await provider.sendAndConfirm(intTx);
                }
            }
        }

        const { instructions, destinationAccounts } = await getATokenAccountsNeedCreate(
            solConnection,
            userAddress,
            globalAuthority,
            [mint]
        );
        console.log("staked_nft_pda: ", destinationAccounts[0].toBase58());

        const mint_metadata = await getMetadata(mint);
        console.log("Metadata: ", mint_metadata.toBase58());
        const tx = new Transaction();
        if (instructions.length !== 0) tx.add(...instructions);

        const ix = await program.methods.stakeNftToFixed()
            .accounts({
                owner: userAddress,
                userFixedPool: userFixedPoolAddr,
                globalAuthority,
                userTokenAccount: user_ata,
                destTokenAccount: destinationAccounts[0],
                nftMint: mint,
                mintMetadata: mint_metadata,
                tokenProgram: TOKEN_PROGRAM_ID,
                tokenMetadataProgram: METAPLEX,
            })
            .preInstructions(instructions)
            .instruction();
        tx.add(ix);
        tx.feePayer = userAddress;
        const { blockhash } = await solConnection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        if (wallet.signTransaction) {
            const signedTx = await wallet.signTransaction(tx);
            const txId = await provider.connection.sendRawTransaction(
                signedTx.serialize(),
                {
                    skipPreflight: true,
                    maxRetries: 3,
                    preflightCommitment: "finalized",
                }
            );
            console.log("Signature:", txId)
        }
        console.log("Your transaction signature: ", tx);
        setLoading(false);
    } catch (error) {
        console.log(error);
        setLoading(false);
    }
}

export const withdrawNft = async (
    wallet: WalletContextState,
    mint: PublicKey,
    setLoading: Function
) => {
    if (wallet.publicKey === null) return;
    setLoading(true);
    const cloneWindow: any = window;
    const userAddress = wallet.publicKey;
    const provider = new anchor.AnchorProvider(
        solConnection,
        cloneWindow["solana"],
        anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(
        IDL as anchor.Idl,
        PROGRAM_ID,
        provider
    );
    try {
        setLoading(true);
        console.log("NFT address: ", mint.toBase58());
        let user_ata = await getAssociatedTokenAccount(userAddress, mint);
        console.log("user ATA: ", user_ata.toBase58());

        const [globalAuthority, global_bump] = await findGlobalAuthorityPDA(program);
        console.log("globalAuthority: ", globalAuthority.toBase58());

        let userFixedPoolAddr = await getUserFixedPoolAddr(wallet);

        const { instructions, destinationAccounts } = await getATokenAccountsNeedCreate(
            solConnection,
            userAddress,
            globalAuthority,
            [mint]
        );
        console.log("staked_nft_pda: ", destinationAccounts[0].toBase58());
        const tx = new Transaction();
        if (instructions.length !== 0) tx.add(...instructions);

        const ix = await program.methods.withdrawNftFromFixed(global_bump)
            .accounts({
                owner: userAddress,
                userFixedPool: userFixedPoolAddr,
                globalAuthority,
                userTokenAccount: user_ata,
                destTokenAccount: destinationAccounts[0],
                nftMint: mint,
                tokenProgram: TOKEN_PROGRAM_ID
            })
            .instruction();
        tx.add(ix);
        tx.feePayer = userAddress;
        const { blockhash } = await solConnection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        if (wallet.signTransaction) {
            const signedTx = await wallet.signTransaction(tx);
            const txId = await provider.connection.sendRawTransaction(
                signedTx.serialize(),
                {
                    skipPreflight: true,
                    maxRetries: 3,
                    preflightCommitment: "finalized",
                }
            );
            console.log("Signature:", txId)
        }
        console.log("Your transaction signature: ", tx);
        setLoading(false);
        console.log("Your transaction signature: ", tx);
    } catch (error) {
        console.log(error);
        setLoading(false);
    }


}

export const getXpGained = async (wallet: WalletContextState) => {
    if (wallet.publicKey === null) return;
    const cloneWindow: any = window;
    const userAddress = wallet.publicKey;
    const provider = new anchor.AnchorProvider(
        solConnection,
        cloneWindow["solana"],
        anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(
        IDL as anchor.Idl,
        PROGRAM_ID,
        provider
    );
    const userFixedPoolAddr = await getUserFixedPoolAddr(wallet);
    if (userFixedPoolAddr) {
        const userFixedPool = await program.account.userPool.fetch(userFixedPoolAddr);
        return userFixedPool.xpGained;
    }
}

const getUserFixedPoolAddr = async (wallet: WalletContextState) => {

    if (wallet.publicKey === null) return;
    const cloneWindow: any = window;
    const userAddress = wallet.publicKey;
    const provider = new anchor.AnchorProvider(
        solConnection,
        cloneWindow["solana"],
        anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(
        IDL as anchor.Idl,
        PROGRAM_ID,
        provider
    );
    return await PublicKey.createWithSeed(
        userAddress,
        "user-fixed-pool",
        program.programId,
    );
}

const findGlobalAuthorityPDA = async (program: anchor.Program): Promise<[PublicKey, number]> => {
    return await PublicKey.findProgramAddress(
        [Buffer.from(GLOBAL_AUTHORITY_SEED)],
        program.programId
    );
}

const getMetadata = async (mint: PublicKey): Promise<PublicKey> => {
    return (
        await PublicKey.findProgramAddress([Buffer.from('metadata'), METAPLEX.toBuffer(), mint.toBuffer()], METAPLEX)
    )[0];
};

const getAssociatedTokenAccount = async (ownerPubkey: PublicKey, mintPk: PublicKey): Promise<PublicKey> => {
    let associatedTokenAccountPubkey = (await PublicKey.findProgramAddress(
        [
            ownerPubkey.toBuffer(),
            TOKEN_PROGRAM_ID.toBuffer(),
            mintPk.toBuffer(), // mint address
        ],
        ASSOCIATED_TOKEN_PROGRAM_ID
    ))[0];
    return associatedTokenAccountPubkey;
}

export const getATokenAccountsNeedCreate = async (
    connection: anchor.web3.Connection,
    walletAddress: anchor.web3.PublicKey,
    owner: anchor.web3.PublicKey,
    nfts: anchor.web3.PublicKey[],
) => {
    let instructions = [], destinationAccounts = [];
    for (const mint of nfts) {
        const destinationPubkey = await getAssociatedTokenAccount(owner, mint);
        let response = await connection.getAccountInfo(destinationPubkey);
        if (!response) {
            const createATAIx = createAssociatedTokenAccountInstruction(
                destinationPubkey,
                walletAddress,
                owner,
                mint,
            );
            instructions.push(createATAIx);
        }
        destinationAccounts.push(destinationPubkey);
        if (walletAddress != owner) {
            const userAccount = await getAssociatedTokenAccount(walletAddress, mint);
            response = await connection.getAccountInfo(userAccount);
            if (!response) {
                const createATAIx = createAssociatedTokenAccountInstruction(
                    userAccount,
                    walletAddress,
                    walletAddress,
                    mint,
                );
                instructions.push(createATAIx);
            }
        }
    }
    return {
        instructions,
        destinationAccounts,
    };
}
export function getParser<T>(program: { coder: Coder }, name: string) {
    return (info: AccountInfo<Buffer>) => program.coder.accounts.decode(name, info.data) as T;
}

export const getUserPoolState = async (
    wallet: WalletContextState
): Promise<UserPool | null> => {
    if (!wallet.publicKey) return null;
    const cloneWindow: any = window;
    const userAddress = wallet.publicKey;
    //This is  phantom wallet public address

    const provider = new anchor.AnchorProvider(
        solConnection,
        cloneWindow["solana"],
        anchor.AnchorProvider.defaultOptions()
    );
    const program = new anchor.Program(
        IDL as anchor.Idl,
        PROGRAM_ID,
        provider
    );
    const userPoolKey = await getUserFixedPoolAddr(wallet);
    if (userPoolKey) {
        const poolAccount = await solConnection.getAccountInfo(userPoolKey);
        if (poolAccount === null) return null;
        const poolState = getParser<UserPool>(program, 'UserPool')(poolAccount);
        console.log('User Pool: ', poolState);
        return poolState as unknown as UserPool;
    } else {
        return null
    }
}

export const createAssociatedTokenAccountInstruction = (
    associatedTokenAddress: anchor.web3.PublicKey,
    payer: anchor.web3.PublicKey,
    walletAddress: anchor.web3.PublicKey,
    splTokenMintAddress: anchor.web3.PublicKey
) => {
    const keys = [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: associatedTokenAddress, isSigner: false, isWritable: true },
        { pubkey: walletAddress, isSigner: false, isWritable: false },
        { pubkey: splTokenMintAddress, isSigner: false, isWritable: false },
        {
            pubkey: anchor.web3.SystemProgram.programId,
            isSigner: false,
            isWritable: false,
        },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        {
            pubkey: anchor.web3.SYSVAR_RENT_PUBKEY,
            isSigner: false,
            isWritable: false,
        },
    ];
    return new anchor.web3.TransactionInstruction({
        keys,
        programId: ASSOCIATED_TOKEN_PROGRAM_ID,
        data: Buffer.from([]),
    });
}
