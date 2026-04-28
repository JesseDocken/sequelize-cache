import { clone, identity, invert, isArray, isEqual, isFunction, isNil, transform } from 'lodash';
import { DataTypes } from 'sequelize';

import { createEngineClient } from './engines';
import { CouldNotBuildIdentifierError } from './errors/CouldNotBuildIdentifierError';
import { InvalidIdentifierError } from './errors/InvalidIdentifierError';

import type { BaseClient } from './engines/EngineClient';
import type { PeerContext } from './peers';
import type { GlobalCacheOptions } from './SequelizeCache';
import type {
  AbstractDataType,
  AbstractDataTypeConstructor,
  Attributes,
  CreationAttributes,
  Identifier,
  Model,
  ModelAttributeColumnOptions,
  ModelStatic,
  WhereOptions,
} from 'sequelize';

export type KeyType = 'primary' | 'unique';

const KeyPrefix: Record<KeyType, string> = {
  primary: 'pk',
  unique: 'uq',
};

const prefixLookup = invert(KeyPrefix) as Record<string, KeyType>;

export type CacheOptions = Pick<GlobalCacheOptions, 'engine' | 'caching'> & {
  modelOptions: {
    uniqueKeys?: string[][];
    timeToLive: number;
  };
};

type KeyColumnType = typeof String | typeof Number | typeof BigInt | typeof Date;
type KeyColumnValue = string | number | bigint | Date;
type KeyColumnDefinition = {
  [k: string]: ModelAttributeColumnOptions<Model<any, any>>;
};

/**
 * The supported key groupings that the cache supports for looking up values.
 */
export type ModelKeyLookup = {
  primary: string[];
  unique: string[][];
};

/**
 * Provides the capability to look up or invalidate a Sequelize model from the cache through a supported
 * combination of keys. If the model has not yet been cached, it will automatically be retrieved from the
 * underlying database table, stored in the cache, and returned as a Sequelize model instance.
 */
export class CachedModelInstance<T extends object, M extends Model<T>> {
  private ctx: PeerContext;
  private cache: BaseClient;
  private prefix: string;
  private repository: ModelStatic<M>;
  private lookupTypes: {
    primary: KeyColumnType | Record<string, KeyColumnType>;
    unique: undefined | Record<string, KeyColumnType>[];
  };
  private keyNames: ModelKeyLookup;
  private modelTtl: number;
  private typeMapping: Record<string, (v: any) => KeyColumnValue>;

  /**
   * Constructs an instance of SequelizeModelCache for the provided model.
   *
   * @param modelCtor the model to cache for
   * @param options the options to configure caching behavior
   */
  constructor(options: CacheOptions, context: PeerContext, modelCtor: ModelStatic<M>) {
    this.ctx = context;

    this.cache = createEngineClient({
      engine: options.engine,
      caching: options.caching,
      metricPrefix: `model-cache-${modelCtor.name}`,
      codecs: {
        serializer: this.serializeCachedValue.bind(this),
        deserializer: this.deserializeCachedValue.bind(this),
      },
    }, context);

    this.prefix = modelCtor.name;
    this.repository = modelCtor;

    const [primaryKeys, uniqueKeys] = getKeys(modelCtor, options.modelOptions.uniqueKeys);

    this.lookupTypes = {
      primary: resolveType(primaryKeys) as KeyColumnType | Record<string, KeyColumnType>,
      unique: uniqueKeys?.map?.((keys) => {
        const resolved = resolveType(keys);
        // resolveType collapses single-column definitions to a bare constructor.
        // Unique keys always need a record so decodeIdentifier can match by field name.
        if (typeof resolved === 'function') {
          return { [Object.keys(keys)[0]]: resolved } as Record<string, KeyColumnType>;
        }
        return resolved as Record<string, KeyColumnType>;
      }),
    };

    this.typeMapping = buildTypeMapping(modelCtor);

    this.keyNames = {
      primary: Object.keys(primaryKeys).sort(),
      unique: uniqueKeys?.map((uK) => Object.keys(uK)).sort() ?? [],
    };

    this.modelTtl = options.modelOptions.timeToLive;
  }

  /**
   * Specifies what keys are considered supported by the cache.
   */
  get modelKeys() {
    return clone(this.keyNames);
  }

  /**
   * This is not a public function; it is only exposed for testing purposes.
   */
  async _hydrate(id?: string): Promise<T | null> {
    if (!id) {
      return null;
    }

    this.ctx.log.debug('hydrating %s', id);

    const lookup = decodeIdentifier(id, this.lookupTypes);

    this.ctx.log.debug('query: %O', lookup);

    let model: M | null;

    if ('lookup' in lookup) {
      model = await this.repository.findByPk(lookup.lookup);
    } else {
      model = await this.repository.findOne({
        where: lookup.lookups as WhereOptions<Attributes<M>>,
      });
    }

    const values = model?.get?.({ plain: true, raw: true });

    if (values) {
      const setValues = transform(
        values,
        (t, v, k) => {
          if (!isNil(v)) {
            t[k] = v;
          }
        },
        {} as T
      );
      this.ctx.log.debug('storing value in cache: %O', setValues);
      // We have to increment this metric here since the underlying class doesn't really have a concept of a cache "miss".
      this.ctx.metrics.hydrateCacheMiss.inc({
        component: `model-cache-${this.prefix}`,
      });
      await this.cache.set(this.prefix, id, setValues, {
        expiresIn: this.modelTtl,
      });
      return setValues;
    }
    return null;
  }

  /**
   * Returns a Sequelize model instance based on the field names and/or identifiers provided.
   *
   * @param type the type of lookup being used
   * @param ids the key identifiers to query with
   * @param fieldNames the names of the fields that match the provided ids
   * @returns the matching instance if it exists, or `null` if it does not exist
   */
  async getModel(type: KeyType, ids: Identifier[], fieldNames?: string[]): Promise<M | null> {
    if (ids.length === 0) {
      return null;
    }

    const coalescedId = buildId(type, ids, fieldNames);
    let cached = await this.cache.get(this.prefix, coalescedId);

    // If no value was found, attempt to hydrate the value.
    if (!cached) {
      cached = await this._hydrate(coalescedId);

      if (!cached) {
        return null;
      }
    }

    this.ctx.log.debug('retrieved model: %O', cached);

    // Regardless of whether the model was retrieved from the cache or not, it's just a grab-bag of
    // values in an object. We need to rebuild the Sequelize model so it behaves in an expected fashion.
    const model = this.repository.build(cached as CreationAttributes<M>, {
      isNewRecord: false,
      raw: true,
    });

    return model;
  }

  /**
   * Invalidates a model instance from the cache. When invoked, a best effort will be made to invalidate
   * all potential cached data respective to that instance, however only the cached data for the primary
   * key is guaranteed to be invalidated.
   *
   * This method is guaranteed not to throw if the instance provided is not cached.
   *
   * @param instance the model instance to invalidate
   */
  async invalidate(instance: M) {
    const identifiers: string[] = [];
    const values = instance.dataValues as Record<string, Identifier>;
    if (this.keyNames.primary.length === 1) {
      identifiers.push(
        buildId(
          'primary',
          this.keyNames.primary.map((k) => values[k])
        )
      );
    } else {
      identifiers.push(
        buildId(
          'primary',
          this.keyNames.primary.map((pk) => values[pk]),
          this.keyNames.primary
        )
      );
    }
    for (const unique of this.keyNames.unique) {
      identifiers.push(
        buildId(
          'unique',
          unique.map((uk) => values[uk]),
          unique
        )
      );
    }

    await this.cache.delMany(this.prefix, identifiers);
  }

  /**
   * Invalidates all model instances from the cache. This should be used if a large amount of model
   * instances have been transformed, or if it cannot be determined what model instances have been
   * affected by a database statement.
   */
  async invalidateAll() {
    await this.cache.delAll(this.prefix);
  }

  serializeCachedValue(_: string, value: KeyColumnValue) {
    // The only type we need to take care of here is BigInt, since JSON.stringify doesn't handle that natively (for some reason).
    return typeof value === 'bigint' ? value.toString() : value;
  }

  deserializeCachedValue(key: string, value: undefined | string | number) {
    return key in this.typeMapping && !isNil(value) ? this.typeMapping[key](value) : value;
  }
}

const KEY_SEPARATOR = '»key»';
const VALUE_SEPARATOR = '§val§';

/**
 * Constructs a cache identifier string based on the lookup type, the provided identifiers, and if
 * specified, the field names given.
 *
 * It is required that at least one identifier _must_ be provided. If `fields` is provided, the number
 * of fields must be identical to the number of identifiers. If the `type` is `unique`, you are
 * _required_ to specify the `fields` parameter.
 *
 * @param type the lookup type
 * @param ids the identifiers to use to build the cache identifier
 * @param fields the identifier field names
 * @returns the cache identifier
 * @throws {CouldNotBuildIdentifierError} if `ids` is empty
 * @throws {CouldNotBuildIdentifierError} if `fields` is not provided but `type` equals `unique`
 * @throws {CouldNotBuildIdentifierError} if `fields` is provided but differs in length from `ids`
 */
export function buildId(type: KeyType, ids: Identifier[], fields?: string[]) {
  if (fields && fields.length !== ids.length) {
    throw new CouldNotBuildIdentifierError(`Expected ${ids.length} field(s), but got ${fields.length}`);
  }
  if (ids.length === 0) {
    throw new CouldNotBuildIdentifierError('At least one identifier must be specified');
  }
  if ((type === 'unique' || ids.length > 1) && !fields) {
    throw new CouldNotBuildIdentifierError('Fields required when multiple identifiers provided or using unique key');
  }
  let lookup = `${KeyPrefix[type]}${fields ? KEY_SEPARATOR : VALUE_SEPARATOR}`;
  for (let i = 0; i < ids.length; i++) {
    const name = fields?.[i];
    const id = ids[i];
    lookup += name ? `${name}${VALUE_SEPARATOR}${String(id)}` : String(id);
    if (i + 1 < ids.length) {
      lookup += KEY_SEPARATOR;
    }
  }
  return lookup;
}

type DecodedIdentifier =
  | {
    type: KeyType;
    lookup: string | number | bigint;
  }
  | {
    type: KeyType;
    lookups: Record<string, string | number | bigint>;
  };

/**
 * Takes the provided cache identifier and decodes it into a key type along with either the primary
 * key identifier (properly typed to the model), or an object mapping the field name to the identifier
 * (properly typed to the model) for use with serialization or model querying.
 *
 * @param id the cache identifier
 * @param typeLookup the mapping of supported lookup methods to a type constructor
 * @returns the mapping between fields and the type constructor
 * @throws {InvalidIdentifierError} If the provided `id` cannot be decoded properly
 */
export function decodeIdentifier(
  id: string,
  typeLookup: {
    primary: KeyColumnType | Record<string, KeyColumnType>;
    unique?: Record<string, KeyColumnType>[];
  }
): DecodedIdentifier {
  const result: {
    type?: KeyType;
    lookup?: string | number | bigint;
    lookups?: Record<string, string | number | bigint | undefined>;
  } = {};
  let parsing = 'type';
  let currentKey = '';

  result.type = prefixLookup[id.slice(0, 2)];

  if (!result.type) {
    throw new InvalidIdentifierError('Invalid type');
  }

  let index = 2;

  if (id.startsWith(KEY_SEPARATOR, index)) {
    parsing = 'key';
    index += KEY_SEPARATOR.length;
  } else if (id.startsWith(VALUE_SEPARATOR, index)) {
    parsing = 'value';
    index += VALUE_SEPARATOR.length;
  }

  while (index < id.length) {
    if (parsing === 'key') {
      const upTo = id.indexOf(VALUE_SEPARATOR, index);
      if (upTo < 0) {
        throw new InvalidIdentifierError('Invalid structure');
      }
      currentKey = id.slice(index, upTo);
      result.lookups ??= {};
      result.lookups[currentKey] = undefined;
      index = upTo + VALUE_SEPARATOR.length;
      parsing = 'value';
    } else if (parsing === 'value') {
      const nextIndex = id.indexOf(KEY_SEPARATOR, index);
      const upTo = nextIndex >= 0 ? nextIndex : id.length;
      if (currentKey === '') {
        result.lookup = id.slice(index, upTo);
      } else {
        if (!result.lookups) {
          throw new InvalidIdentifierError('Invalid structure');
        }
        result.lookups[currentKey] = id.slice(index, upTo);
      }
      currentKey = '';
      parsing = 'key';
      index = upTo + KEY_SEPARATOR.length;
    } else {
      throw new InvalidIdentifierError('Invalid structure');
    }
  }

  if (!result.type) {
    throw new InvalidIdentifierError('Invalid type');
  }

  if (!result.lookup && !result.lookups) {
    throw new InvalidIdentifierError('Invalid structure');
  }

  // Now we want to convert the values to the types matching the columns provided. If no columns were given, then
  // this is a single-column primary key.
  if (result.lookup && isFunction(typeLookup.primary)) {
    // Single-column primary key
    result.lookup = typeLookup.primary(result.lookup);
    return result as DecodedIdentifier;
  }

  // In all other circumstances, we need to iterate the different column sets to find one that matches the keys we
  // got. If none match, we don't do any type coercion.
  if (!result.lookups) {
    return result as DecodedIdentifier;
  }
  const keyNames = Object.keys(result.lookups).sort();
  const potentials: Record<string, KeyColumnType>[] =
    result.type === 'primary' ? [typeLookup.primary as Record<string, KeyColumnType>] : (typeLookup.unique ?? []);

  for (const candidate of potentials) {
    const candidateKeys = Object.keys(candidate).sort();
    if (isEqual(keyNames, candidateKeys)) {
      // Found a matching candidate, coerce values to the types we were provided.
      for (const key of candidateKeys) {
        result.lookups[key] = candidate[key](result.lookups[key]!);
      }
      return result as DecodedIdentifier;
    }
  }

  throw new InvalidIdentifierError('Unsupported by model');
}

export function getKeys<M extends Model>(
  model: ModelStatic<M>,
  uniqueKeys?: string[][]
): [KeyColumnDefinition, KeyColumnDefinition[]?] {
  const attribs = model.getAttributes();

  const primaries = Object.fromEntries(
    Object.entries(attribs).filter(([_, column]) => {
      return column.primaryKey === true;
    })
  );

  if (!uniqueKeys) {
    return [primaries];
  }

  const uniques = uniqueKeys.map((names) => {
    return Object.fromEntries(names.map((name) => [name, attribs[name]]));
  });

  return [primaries, uniques];
}

export function resolveType(
  definition: KeyColumnDefinition | KeyColumnDefinition[]
): KeyColumnType | Record<string, KeyColumnType> | Record<string, KeyColumnType>[] {
  const definitions = isArray(definition) ? definition : [definition];

  let inspected = 0;
  const types = definitions.map((defn) => {
    return Object.fromEntries(
      Object.entries(defn).map(([name, column]) => {
        inspected++;
        return [name, getDataTypeConverter(column.type) as KeyColumnType];
      })
    );
  });

  if (definitions.length === 1) {
    return inspected > 1 ? types[0] : Object.values(types[0])[0];
  }
  return types;
}

export function buildTypeMapping<M extends Model>(model: ModelStatic<M>) {
  const attributes = Object.entries(model.getAttributes());
  const result: Record<string, (v: any) => any> = {};

  for (const [key, defn] of attributes) {
    result[key] = getDataTypeConverter(defn.type);
  }

  return result;
}

export function getDataTypeConverter(
  type: AbstractDataType | AbstractDataTypeConstructor | string
): (v: any) => any {
  if (type instanceof DataTypes.BIGINT) {
    return BigInt;
  } else if (type instanceof DataTypes.BOOLEAN) {
    return Boolean;
  } else if (type instanceof DataTypes.NUMBER) {
    return Number;
  } else if (
    type instanceof DataTypes.DATE ||
    type instanceof DataTypes.DATEONLY ||
    type instanceof DataTypes.TIME
  ) {
    // Date() without `new` ignores its argument and returns the current time as a string.
    return (v: string | number) => new Date(v);
  } else if (
    type instanceof DataTypes.VIRTUAL ||
    type instanceof DataTypes.JSON ||
    type instanceof DataTypes.JSONB
  ) {
    // No special handling — pass through whatever the driver returned.
    // VIRTUAL fields aren't stored at all; JSON/JSONB are dialect-dependent
    // (pg returns parsed objects, mariadb returns raw strings).
    return identity;
  } else if (typeof type === 'string' && type.startsWith('BIT')) {
    // Bitfields are serialized into objects, so we need to convert them back
    // into buffers.
    return (v: { data: number[] }) => {
      return Buffer.from(v.data);
    };
  } else {
    // Use string as a default.
    return String;
  }
}
