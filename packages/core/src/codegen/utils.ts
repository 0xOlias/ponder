import prettier from "prettier";

import { logger } from "@/common/logger";

let prettierConfig: prettier.Options = { parser: "typescript" };

const loadPrettierConfig = async () => {
  if (prettierConfig) return prettierConfig;

  const configFilePath = await prettier.resolveConfigFile();
  if (configFilePath) {
    const foundConfig = await prettier.resolveConfig(configFilePath);
    if (foundConfig) {
      logger.trace(`found prettier config at: ${configFilePath}`);
      prettierConfig = foundConfig;
    }
  }
};

// Just call this once on process start
loadPrettierConfig();

export const formatPrettier = (
  source: string,
  configOverrides?: Partial<prettier.Options>
) => {
  return prettier.format(source, { ...prettierConfig, ...configOverrides });
};

// These methods are used in the cached interval calculations
// From https://stackoverflow.com/a/33857786/12841788
