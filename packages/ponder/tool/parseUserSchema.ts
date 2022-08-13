import fs from "fs/promises";
import { buildSchema, GraphQLSchema } from "graphql";

import { toolConfig } from "./config";

const schemaHeader = `
"Directs the executor to process this type as a Ponder entity."
directive @entity(
  immutable: Boolean = false
) on OBJECT
`;

const parseUserSchema = async (): Promise<GraphQLSchema> => {
  const schemaBody = await fs.readFile(toolConfig.pathToSchemaFile);
  const schemaSource = schemaHeader + schemaBody.toString();
  const schema = buildSchema(schemaSource);

  return schema;
};

export { parseUserSchema };
