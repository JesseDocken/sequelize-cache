import { clone, invert, isArray, isEqual, isFunction, isNil, transform } from 'lodash';
import { DataTypes } from 'sequelize';

import { EngineClient } from './engines/EngineClient';

import type {
  AbstractDataType,
  AbstractDataTypeConstructor,
  Attributes,
  Identifier,
  Model,
  ModelAttributeColumnOptions,
  ModelStatic,
  WhereOptions,
} from 'sequelize';
import { PeerContext } from './peers';
import { GlobalCacheOptions } from '.';

const DEFAULT_TTL = 3600; // Default TTL of 1 hour

export type KeyType = 'primary' | 'unique';

const KeyPrefix: Record<KeyType, string> = {
  primary: 'pk',
  unique: 'uq',
};

const prefixLookup = invert(KeyPrefix) as Record<string, KeyType>;

export type CacheOptions = Pick<GlobalCacheOptions, 'connection' | 'caching'> & {
  modelOptions: {
    uniqueKeys?: string[][];
    timeToLive?: number;
  };
};

type KeyColumnType = typeof String | typeof Number | typeof BigInt | typeof Date;
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
export class SequelizeModelCache<T extends object, M extends Model<T>> {
  private ctx: PeerContext;
  private cache: EngineClient;
  private prefix: string;
  private repository: ModelStatic<M>;
  private lookupTypes: {
    primary: KeyColumnType | Record<string, KeyColumnType>;
    unique: undefined | Record<string, KeyColumnType>[];
  };
  private keyNames: ModelKeyLookup;
  private modelTtl: number;
  private typeMapping: Record<string, (v: any) => any>;

  /**
   * Constructs an instance of SequelizeModelCache for the provided model.
   *
   * @param modelCtor the model to cache for
   * @param options the options to configure caching behavior
   */
  constructor(options: CacheOptions, context: PeerContext, modelCtor: ModelStatic<M>) {
    this.ctx = context;

    this.cache = EngineClient.get({
      connection: options.connection,
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
      unique: uniqueKeys?.map?.((keys) => resolveType(keys)) as Record<string, KeyColumnType>[],
    };

    this.typeMapping = buildTypeMapping(modelCtor);

    this.keyNames = {
      primary: Object.keys(primaryKeys),
      unique: uniqueKeys?.map?.((uK) => Object.keys(uK)) ?? [],
    };

    this.modelTtl = options.modelOptions.timeToLive ?? DEFAULT_TTL;
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
      this.ctx.metrics.hydrateFunctionGet.inc({
        component: `model-cache-${this.prefix}`,
      });
      await this.cache.set(this.prefix, id, setValues, {
        expiresIn: this.modelTtl,
      });
      return setValues as T;
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
    const model = this.repository.build(cached as any, {
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
    const values = instance.dataValues as Record<string, any>;
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

  serializeCachedValue(_: string, value: any) {
    // The only type we need to take care of here is BigInt, since JSON.stringify doesn't handle that natively (for some reason).
    return typeof value === 'bigint' ? value.toString() : value;
  }

  deserializeCachedValue(key: string, value: any) {
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
 * @throws {Error} if `ids` is empty
 * @throws {Error} if `fields` is not provided but `type` equals `unique`
 * @throws {Error} if `fields` is provided but differs in length from `ids`
 */
function buildId(type: KeyType, ids: Identifier[], fields?: string[]) {
  if (fields && fields.length !== ids.length) {
    throw new Error(`Expected ${ids.length} field(s), but got ${fields.length}`);
  }
  if (ids.length === 0) {
    throw new Error('At least one identifier must be specified');
  }
  if ((type === 'unique' || ids.length > 1) && !fields) {
    throw new Error('Fields required when multiple identifiers provided or using unique key');
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
 */
function decodeIdentifier(
  id: string,
  typeLookup: {
    primary: KeyColumnType | Record<string, KeyColumnType>;
    unique: undefined | Record<string, KeyColumnType>[];
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
    throw new Error('Invalid identifier type');
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
        throw new Error('Invalid identifier structure');
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
          throw new Error('Invalid identifier structure');
        }
        result.lookups[currentKey] = id.slice(index, upTo);
      }
      currentKey = '';
      parsing = 'key';
      index = upTo + KEY_SEPARATOR.length;
    } else {
      throw new Error('Invalid identifier structure');
    }
  }

  if (!result.type) {
    throw new Error('Invalid identifier type');
  }

  if (!result.lookup && !result.lookups) {
    throw new Error('Invalid identifier structure');
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
  const potentials = result.type === 'primary' ? [typeLookup.primary] : (typeLookup.unique ?? []);

  for (const candidate of potentials) {
    if (typeof candidate === 'function') continue;
    const candidateKeys = Object.keys(candidate).sort();
    if (isEqual(keyNames, candidateKeys)) {
      // Found a matching candidate, coerce values to the types we were provided.
      for (const key of candidateKeys) {
        result.lookups[key] = candidate[key](result.lookups[key]!);
      }
    }
  }
  return result as DecodedIdentifier;
}

function getKeys<M extends Model>(
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

function resolveType(
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

function buildTypeMapping<M extends Model>(model: ModelStatic<M>) {
  const attributes = Object.entries(model.getAttributes());
  const result: Record<string, (v: any) => any> = {};

  for (const [key, defn] of attributes) {
    result[key] = getDataTypeConverter(defn.type);
  }

  return result;
}

function getDataTypeConverter(
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
    return Date;
  } else if (type instanceof DataTypes.VIRTUAL) {
    // Ignore virtual fields.
    return (v) => v;
  } else if (typeof type === 'string' && type.startsWith('BIT')) {
    // Bitfields are serialized into objects, so we need to convert them back
    // into buffers.
    return (v) => {
      return Buffer.from(v.data);
    };
  } else {
    // Use string as a default.
    return String;
  }
}

/**
 * Exported for testing purposes only. Do not use, as they are liable to change over
 * time.
 */
export const __test = {
  buildId,
  decodeIdentifier,
  resolveType,
};
