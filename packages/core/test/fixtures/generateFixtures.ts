import { StaticJsonRpcProvider } from "@ethersproject/providers";
import { BigNumber } from "ethers";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { format } from "prettier";

type FixtureConfig = {
  name: string;
  sources: {
    chainId: number;
    rpcUrl: string;
    address: string;
    startBlock: number;
    endBlock: number;
    blockLimit: number;
  }[];
};

const getBlockRanges = (start: number, end: number, limit: number) => {
  const results: [number, number][] = [];

  let from = start;
  let to = Math.min(from + limit, end);

  // Handle special case for a one block range. Probably shouldn't need this.
  if (from === to) {
    results.push([from, to]);
    return results;
  }

  while (from < end) {
    results.push([from, to]);

    from = to + 1;
    to = Math.min(from + limit, end);
  }

  return results;
};

const generateFixture = async (config: FixtureConfig) => {
  const { name, sources } = config;

  for (const source of sources) {
    const { chainId, rpcUrl, address, startBlock, endBlock, blockLimit } =
      source;

    const provider = new StaticJsonRpcProvider(rpcUrl, chainId);

    const blockRanges = getBlockRanges(startBlock, endBlock, blockLimit);

    const logs: any[] = [];
    const blocks: any[] = [];

    // Get all logs in the requested range, also get the block at toBlock
    // because it is required by the Ponder indexer.
    await Promise.all(
      blockRanges.map(async ([fromBlock, toBlock]) => {
        const [rawLogs, rawToBlock] = await Promise.all([
          provider.send("eth_getLogs", [
            {
              address: [address],
              fromBlock: BigNumber.from(fromBlock).toHexString(),
              toBlock: BigNumber.from(toBlock).toHexString(),
            },
          ]),
          provider.send("eth_getBlockByNumber", [
            BigNumber.from(toBlock).toHexString(),
            true,
          ]),
        ]);

        logs.push(...rawLogs);
        blocks.push(rawToBlock);
      })
    );

    const fetchedBlockHashes = new Set(blocks.map((b) => b.hash));

    const requiredBlockHashes = [
      ...new Set(logs.map((l) => l.blockHash)),
    ].filter((h) => !fetchedBlockHashes.has(h));

    // Get the blocks for each log, including transactions.
    await Promise.all(
      requiredBlockHashes.map(async (blockHash) => {
        const rawBlock = await provider.send("eth_getBlockByHash", [
          blockHash,
          true,
        ]);

        blocks.push(rawBlock);
      })
    );

    console.log({
      name,
      logCount: logs.length,
      blockCount: blocks.length,
    });

    const filename = `./test/fixtures/__fixtures__/${name}.ts`;
    const contents =
      "export default " +
      format(
        JSON.stringify({
          name,
          logs,
          blocks,
        }),
        {
          parser: "json",
        }
      );

    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, contents);
  }
};

const main = async () => {
  if (!process.env.PONDER_RPC_URL_1) {
    throw new Error(`Missing env var: PONDER_RPC_URL_1`);
  }

  await Promise.all([
    generateFixture({
      name: "ArtGobblers",
      sources: [
        {
          chainId: 1,
          rpcUrl: process.env.PONDER_RPC_URL_1,
          address: "0x60bb1e2aa1c9acafb4d34f71585d7e959f387769",
          startBlock: 16342200,
          endBlock: 16343200, // 1000 blocks
          blockLimit: 250,
        },
      ],
    }),
  ]);
};

main();
