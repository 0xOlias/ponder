import type { Entity } from "@ponder/core";
import { FieldKind } from "@ponder/core";
import {
  GraphQLFieldConfig,
  GraphQLFieldResolver,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLString,
} from "graphql";

import type { Context, Source } from "./buildGqlSchema";

type WhereInputArg = {
  [key: string]: number | string;
};
type PluralArgs = {
  where?: WhereInputArg;
  first?: number;
  skip?: number;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
};
type PluralResolver = GraphQLFieldResolver<Source, Context, PluralArgs>;

const operators = {
  universal: ["", "_not"],
  singular: ["_in", "_not_in"],
  plural: [
    "_contains",
    "_not_contains",
    "_contains_nocase",
    "_not_contains_nocase",
  ],
  numeric: ["_gt", "_lt", "_gte", "_lte"],
  string: [
    "_contains",
    "_contains_nocase",
    "_not_contains",
    "_not_contains_nocase",
    "_starts_with",
    "_starts_with_nocase",
    "_ends_with",
    "_ends_with_nocase",
    "_not_starts_with",
    "_not_starts_with_nocase",
    "_not_ends_with",
    "_not_ends_with_nocase",
  ],
};

const buildPluralField = (
  entity: Entity,
  entityType: GraphQLObjectType<Source, Context>
): GraphQLFieldConfig<Source, Context> => {
  const filterFields: Record<string, { type: GraphQLInputType }> = {};

  entity.fields.forEach((field) => {
    switch (field.kind) {
      case FieldKind.ID: {
        // ID fields => universal, singular, numeric
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.baseGqlType),
          };
        });

        operators.numeric.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: field.baseGqlType,
          };
        });
        break;
      }
      case FieldKind.SCALAR: {
        // Scalar fields => universal, singular, numeric OR string depending on base type
        // Note: Booleans => universal and singular only.
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
        });

        operators.numeric.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: field.baseGqlType,
          };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.baseGqlType),
          };
        });

        if (["String"].includes(field.baseGqlType.name)) {
          operators.string.forEach((suffix) => {
            filterFields[`${field.name}${suffix}`] = {
              type: field.baseGqlType,
            };
          });
        }

        break;
      }
      case FieldKind.ENUM: {
        // Enum fields => universal, singular
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(field.baseGqlType),
          };
        });
        break;
      }
      case FieldKind.LIST: {
        // List fields => universal, plural
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
        });

        operators.plural.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: field.baseGqlType };
        });
        break;
      }
      case FieldKind.RELATIONSHIP: {
        // Relationship fields => universal, numeric, singular, string ALL with ID basetype
        operators.universal.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = { type: GraphQLID };
        });

        operators.numeric.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: GraphQLID,
          };
        });

        operators.singular.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: new GraphQLList(GraphQLID),
          };
        });

        operators.string.forEach((suffix) => {
          filterFields[`${field.name}${suffix}`] = {
            type: GraphQLID,
          };
        });

        // TODO: Add complex "{fieldName}_" filter field.
        break;
      }
      case FieldKind.DERIVED: {
        // TODO: Add derived filter fields.
        break;
      }
    }
  });

  const filterType = new GraphQLInputObjectType({
    name: `${entity.name}Filter`,
    fields: filterFields,
  });

  const resolver: PluralResolver = async (_, args, context) => {
    const { store } = context;

    const filter = args;

    return await store.getEntities(entity.name, filter);
  };

  return {
    type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(entityType))),
    args: {
      where: { type: filterType },
      first: { type: GraphQLInt },
      skip: { type: GraphQLInt },
      orderBy: { type: GraphQLString },
      orderDirection: { type: GraphQLString },
    },
    resolve: resolver,
  };
};

export { buildPluralField };
