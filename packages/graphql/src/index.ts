import type { PonderPlugin } from "@ponder/core";

import { generateSchema } from "./codegen/generateSchema";
import { generateSchemaTypes } from "./codegen/generateSchemaTypes";
import { GraphqlServer } from "./server";
import { buildGqlSchema } from "./server/buildGqlSchema";

export type PonderGraphqlPluginOptions = {
  port?: number;
};

export const graphqlPlugin: PonderPlugin<PonderGraphqlPluginOptions> = ({
  port = 42069,
} = {}) => {
  let server: GraphqlServer | undefined;

  return {
    name: "graphql",
    setup: async (ponder) => {
      if (!ponder.schema) {
        ponder.logger.error(
          "Cannot setup @ponder/graphql before building schema"
        );
        return;
      }

      const gqlSchema = buildGqlSchema(ponder.schema);

      // Build Express GraphQL server
      server = new GraphqlServer(port, ponder.entityStore, ponder.logger);
      server.start(gqlSchema, port);

      await generateSchemaTypes(gqlSchema, ponder);
      ponder.logger.debug(`Generated schema types`);

      generateSchema(gqlSchema, ponder);
      ponder.logger.debug(`Generated schema.graphql file`);
    },
    reload: async (ponder) => {
      if (!ponder.schema) {
        ponder.logger.error(
          "Cannot setup @ponder/graphql before building schema"
        );
        return;
      }

      const gqlSchema = buildGqlSchema(ponder.schema);

      server?.start(gqlSchema, port);
    },
    teardown: async () => {
      server?.teardown();
    },

    // additional properties available on return object to ease testing
    server,
  };
};
