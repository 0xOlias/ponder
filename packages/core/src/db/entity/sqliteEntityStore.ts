import type Sqlite from "better-sqlite3";

import type { Ponder } from "@/Ponder";
import {
  DerivedField,
  FieldKind,
  PonderSchema,
  ScalarField,
} from "@/schema/types";

import { EntityFilter, EntityStore } from "./entityStore";
import { sqlOperatorsForFilterType } from "./utils";

export class SqliteEntityStore implements EntityStore {
  db: Sqlite.Database;
  ponder: Ponder;
  schema?: PonderSchema;

  constructor({ db, ponder }: { db: Sqlite.Database; ponder: Ponder }) {
    this.db = db;
    this.ponder = ponder;
  }

  errorWrapper<T extends (...args: any) => any>(func: T) {
    return (...args: any) => {
      try {
        return func(...args);
      } catch (err) {
        this.ponder.emit("indexer_taskError", { error: err as Error });
        return undefined as unknown as T;
      }
    };
  }

  migrate(schema: PonderSchema) {
    try {
      schema.entities.forEach((entity) => {
        // Drop the table if it already exists
        this.db.prepare(`DROP TABLE IF EXISTS "${entity.name}"`).run();

        // Build the create table statement using field migration fragments.
        // TODO: Update this so the generation of the field migration fragments happens here
        // instead of when the PonderSchema gets built.
        const columnStatements = entity.fields
          .filter(
            // This type guard is wrong, could actually be any FieldKind that's not derived (obvs)
            (field): field is ScalarField => field.kind !== FieldKind.DERIVED
          )
          .map((field) => field.migrateUpStatement);

        this.db
          .prepare(
            `CREATE TABLE "${entity.name}" (${columnStatements.join(", ")})`
          )
          .run();
      });

      this.schema = schema;
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });
    }
  }

  getEntity(entityName: string, id: string) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      const statement = `SELECT "${entityName}".* FROM "${entityName}" WHERE "${entityName}"."id" = @id`;
      const instance = this.db.prepare(statement).get({ id });

      if (!instance) return null;

      return this.deserialize(entityName, instance);
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return null;
    }
  }

  insertEntity(
    entityName: string,
    id: string,
    instance: Record<string, unknown>
  ) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      // If `instance.id` is defined, replace it with the id passed as a parameter.
      // Should also log a warning here.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      instance.id = id;

      const columnStatements = Object.entries(instance).map(
        ([fieldName, value]) => ({
          column: `"${fieldName}"`,
          value: `'${value}'`,
        })
      );

      const insertFragment = `(${columnStatements
        .map((s) => s.column)
        .join(", ")}) VALUES (${columnStatements
        .map((s) => s.value)
        .join(", ")})`;

      const statement = `INSERT INTO "${entityName}" ${insertFragment} RETURNING *`;

      const insertedEntity = this.db.prepare(statement).get();

      return this.deserialize(entityName, insertedEntity);
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return {};
    }
  }

  updateEntity(
    entityName: string,
    id: string,
    instance: Record<string, unknown>
  ) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      const columnStatements = Object.entries(instance).map(
        ([fieldName, value]) => ({
          column: `"${fieldName}"`,
          value: `'${value}'`,
        })
      );

      const updateFragment = columnStatements
        .filter(({ column }) => column !== "id") // Ignore `instance.id` field for update fragment
        .map(({ column, value }) => `${column} = ${value}`)
        .join(", ");

      const statement = `UPDATE "${entityName}" SET ${updateFragment} WHERE "id" = @id RETURNING *`;
      const updatedEntity = this.db.prepare(statement).get({ id });

      return this.deserialize(entityName, updatedEntity);
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return {};
    }
  }

  upsertEntity(
    entityName: string,
    id: string,
    instance: Record<string, unknown>
  ) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      // If `instance.id` is defined, replace it with the id passed as a parameter.
      // Should also log a warning here.
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore
      instance.id = id;

      const columnStatements = Object.entries(instance).map(
        ([fieldName, value]) => ({
          column: `"${fieldName}"`,
          value: `'${value}'`,
        })
      );

      const insertFragment = `(${columnStatements
        .map((s) => s.column)
        .join(", ")}) VALUES (${columnStatements
        .map((s) => s.value)
        .join(", ")})`;

      const updateFragment = columnStatements
        .filter(({ column }) => column !== "id") // Ignore `instance.id` field for update fragment
        .map(({ column, value }) => `${column} = ${value}`)
        .join(", ");

      const statement = `INSERT INTO "${entityName}" ${insertFragment} ON CONFLICT("id") DO UPDATE SET ${updateFragment} RETURNING *`;

      const upsertedEntity = this.db.prepare(statement).get({ id });

      return this.deserialize(entityName, upsertedEntity);
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return {};
    }
  }

  deleteEntity(entityName: string, id: string) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      const statement = `DELETE FROM "${entityName}" WHERE "id" = @id`;

      const { changes } = this.db.prepare(statement).run({ id: id });

      // `changes` is equal to the number of rows that were updated/inserted/deleted by the query.
      return changes === 1;
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return false;
    }
  }

  getEntities(entityName: string, filter?: EntityFilter) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      const where = filter?.where;
      const first = filter?.first;
      const skip = filter?.skip;
      const orderBy = filter?.orderBy;
      const orderDirection = filter?.orderDirection;

      const fragments = [];

      if (where) {
        const whereFragments: string[] = [];

        for (const [field, value] of Object.entries(where)) {
          const [fieldName, rawFilterType] = field.split(/_(.*)/s);

          // This is a hack to handle the = operator, which the regex above doesn't handle
          const filterType = rawFilterType === undefined ? "" : rawFilterType;

          const sqlOperators = sqlOperatorsForFilterType[filterType];
          if (!sqlOperators) {
            throw new Error(
              `SQL operators not found for filter type: ${filterType}`
            );
          }

          const { operator, patternPrefix, patternSuffix, isList } =
            sqlOperators;

          let finalValue = value;

          if (patternPrefix) finalValue = patternPrefix + finalValue;
          if (patternSuffix) finalValue = finalValue + patternSuffix;

          if (isList) {
            finalValue = `(${(finalValue as (string | number)[]).join(",")})`;
          } else {
            finalValue = `'${finalValue}'`;
          }

          whereFragments.push(`"${fieldName}" ${operator} ${finalValue}`);
        }

        fragments.push(`WHERE ${whereFragments.join(" AND ")}`);
      }

      if (orderBy) {
        fragments.push(`ORDER BY "${orderBy}"`);
      }

      if (orderDirection) {
        fragments.push(`${orderDirection}`);
      }

      if (first) {
        fragments.push(`LIMIT ${first}`);
      }

      if (skip) {
        if (!first) {
          fragments.push(`LIMIT -1`); // Must add a no-op limit for SQLite to handle offset
        }
        fragments.push(`OFFSET ${skip}`);
      }

      const statement = `SELECT * FROM "${entityName}" ${fragments.join(" ")}`;

      const instances = this.db.prepare(statement).all();

      return instances.map((instance) =>
        this.deserialize(entityName, instance)
      );
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return [];
    }
  }

  getEntityDerivedField(
    entityName: string,
    id: string,
    derivedFieldName: string
  ) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      const entity = this.schema.entityByName[entityName];
      if (!entity) {
        throw new Error(`Entity not found in schema: ${entityName}`);
      }

      const derivedField = entity.fields.find(
        (field): field is DerivedField =>
          field.kind === FieldKind.DERIVED && field.name === derivedFieldName
      );

      if (!derivedField) {
        throw new Error(
          `Derived field not found: ${entityName}.${derivedFieldName}`
        );
      }

      const derivedFieldInstances = this.getEntities(
        derivedField.derivedFromEntityName,
        {
          where: {
            [`${derivedField.derivedFromFieldName}`]: id,
          },
        }
      );

      return derivedFieldInstances;
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return [];
    }
  }

  deserialize(entityName: string, instance: Record<string, unknown>) {
    try {
      if (!this.schema) {
        throw new Error(
          `EntityStore has not been initialized with a schema yet`
        );
      }

      const entity = this.schema.entityByName[entityName];
      if (!entity) {
        throw new Error(`Entity not found in schema: ${entityName}`);
      }

      const deserializedInstance = { ...instance };

      // For each property on the instance, look for a field defined on the entity
      // with the same name and apply any required deserialization transforms.
      Object.entries(instance).forEach(([fieldName, value]) => {
        const field = entity.fieldByName[fieldName];
        if (!field) return;

        switch (field.kind) {
          case FieldKind.LIST: {
            deserializedInstance[fieldName] = (value as string).split(",");
            break;
          }
          default: {
            deserializedInstance[fieldName] = value;
          }
        }
      });

      return deserializedInstance as Record<string, unknown>;
    } catch (err) {
      this.ponder.emit("indexer_taskError", { error: err as Error });

      return {};
    }
  }
}
