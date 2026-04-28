import { pick } from 'lodash';
import { DataTypes, Model, Sequelize } from 'sequelize';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildId, CachedModelInstance, decodeIdentifier, resolveType } from '../../lib/CachedModelInstance';
import * as engineFactory from '../../lib/engines';
import { PeerContext } from '../../lib/peers';

import type { BaseClient } from '../../lib/engines/EngineClient';
import type { CreationOptional, InferAttributes, InferCreationAttributes, ModelStatic } from 'sequelize';

// Test Models
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: ':memory:',
  logging: false,
});

class SingleColPk extends Model<InferAttributes<SingleColPk>, InferCreationAttributes<SingleColPk>> {
  declare id: CreationOptional<string>;
  declare name: string;
}
SingleColPk.init({
  id: { type: DataTypes.UUID, primaryKey: true },
  name: { type: DataTypes.STRING },
}, { sequelize, modelName: 'SingleColPk', timestamps: false });

class CompositePk extends Model<InferAttributes<CompositePk>, InferCreationAttributes<CompositePk>> {
  declare type: number;
  declare name: string;
  declare baz: number;
}
CompositePk.init({
  type: { type: DataTypes.SMALLINT, primaryKey: true },
  name: { type: DataTypes.STRING, primaryKey: true },
  baz: { type: DataTypes.INTEGER },
}, { sequelize, modelName: 'CompositePk', timestamps: false });

class SingleColPkUniq1 extends Model<InferAttributes<SingleColPkUniq1>, InferCreationAttributes<SingleColPkUniq1>> {
  declare id: bigint;
  declare mac: string;
}
SingleColPkUniq1.init({
  id: { type: DataTypes.BIGINT, primaryKey: true },
  mac: { type: DataTypes.STRING },
}, { sequelize, modelName: 'SingleColPkUniq1', timestamps: false });

class SingleColPkUniq2 extends Model<InferAttributes<SingleColPkUniq2>, InferCreationAttributes<SingleColPkUniq2>> {
  declare id: bigint;
  declare mac: string;
  declare name: string;
}
SingleColPkUniq2.init({
  id: { type: DataTypes.BIGINT, primaryKey: true },
  mac: { type: DataTypes.STRING },
  name: { type: DataTypes.STRING },
}, { sequelize, modelName: 'SingleColPkUniq2', timestamps: false });

// Setup Mocks
const mockEngine = {
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
  delMany: vi.fn(),
  delAll: vi.fn(),
};

const ctx = new PeerContext({ engine: { connection: {} as any, type: 'redis' } });

function createCache(model: ModelStatic<any>, opts?: { uniqueKeys?: string[][] }) {
  return new CachedModelInstance({
    engine: { connection: {} as any, type: 'redis' },
    modelOptions: { uniqueKeys: opts?.uniqueKeys, timeToLive: 3600 },
  }, ctx, model);
}

describe('CachedModelInstance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockEngine.set.mockReset().mockResolvedValue(undefined);
    mockEngine.get.mockReset().mockResolvedValue(undefined);
    mockEngine.del.mockReset().mockResolvedValue(undefined);
    mockEngine.delMany.mockReset().mockResolvedValue(undefined);
    mockEngine.delAll.mockReset().mockResolvedValue(undefined);
    vi.spyOn(engineFactory, 'createEngineClient').mockReturnValue(mockEngine as unknown as BaseClient);
  });

  describe('modelKeys getter', () => {
    it('SingleColPk - one primary key, no unique keys', () => {
      const cache = createCache(SingleColPk);
      const keys = cache.modelKeys;
      expect(keys.primary).toEqual(['id']);
      expect(keys.unique).toEqual([]);
    });

    it('CompositePk - two-column primary key, no unique keys', () => {
      const cache = createCache(CompositePk);
      const keys = cache.modelKeys;
      expect(keys.primary).toEqual(['name', 'type']);
      expect(keys.unique).toEqual([]);
    });

    it('SingleColPkUniq1 - one primary key, one unique key', () => {
      const cache = createCache(SingleColPkUniq1, { uniqueKeys: [['mac']] });
      const keys = cache.modelKeys;
      expect(keys.primary).toEqual(['id']);
      expect(keys.unique).toEqual([['mac']]);
    });

    it('SingleColPkUniq2 - one primary key, two unique keys', () => {
      const cache = createCache(SingleColPkUniq2, { uniqueKeys: [['mac'], ['name']] });
      const keys = cache.modelKeys;
      expect(keys.primary).toEqual(['id']);
      expect(keys.unique).toEqual([['mac'], ['name']]);
    });
  });

  describe('hydrate', () => {
    it('returns null if id is undefined', async () => {
      const cache = createCache(SingleColPk);
      const result = await cache._hydrate(undefined);
      expect(result).toBeNull();
    });

    it('returns null if id is null', async () => {
      const cache = createCache(SingleColPk);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      const result = await cache._hydrate(null as any);
      expect(result).toBeNull();
    });

    it('calls findByPk if looking up with single-column PK, does not cache null value', async () => {
      const cache = createCache(SingleColPk);
      const findPkSpy = vi.spyOn(SingleColPk, 'findByPk').mockResolvedValue(null);
      const findOneSpy = vi.spyOn(SingleColPk, 'findOne');

      const result = await cache._hydrate('pk§val§123');
      expect(result).toBeNull();
      expect(findPkSpy).toHaveBeenCalledOnce();
      expect(findOneSpy).not.toHaveBeenCalled();
      expect(mockEngine.set).not.toHaveBeenCalled();
    });

    it('calls findByPk if looking up with single-column PK, caches returned value', async () => {
      const cache = createCache(SingleColPk);
      const instance = SingleColPk.build({ id: '123', name: 'Test' }, { isNewRecord: false });
      const findPkSpy = vi.spyOn(SingleColPk, 'findByPk').mockResolvedValue(instance);
      const findOneSpy = vi.spyOn(SingleColPk, 'findOne');

      const result = await cache._hydrate('pk§val§123');
      expect(result).toEqual(instance.toJSON());
      expect(findPkSpy).toHaveBeenCalledOnce();
      expect(findOneSpy).not.toHaveBeenCalled();
      expect(mockEngine.set).toHaveBeenCalledOnce();
      expect(mockEngine.set.mock.calls[0][0]).toBe('SingleColPk');
      expect(mockEngine.set.mock.calls[0][1]).toBe('pk§val§123');
      expect(mockEngine.set.mock.calls[0][2]).toEqual(instance.toJSON());
      expect(mockEngine.set.mock.calls[0][3]).toHaveProperty('expiresIn');
      expect(mockEngine.set.mock.calls[0][3].expiresIn).toBeGreaterThan(0);
    });

    it('calls findOne if looking up with composite PK, caches returned value', async () => {
      const cache = createCache(CompositePk);
      const instance = CompositePk.build(
        { type: 1, name: 'Test', baz: 444 },
        { isNewRecord: false },
      );
      const findPkSpy = vi.spyOn(CompositePk, 'findByPk').mockRejectedValue(new Error());
      const findOneSpy = vi.spyOn(CompositePk, 'findOne').mockResolvedValue(instance);

      const result = await cache._hydrate('pk»key»name§val§Test»key»type§val§1');
      expect(result).toEqual(instance.toJSON());
      expect(findPkSpy).not.toHaveBeenCalled();
      expect(findOneSpy).toHaveBeenCalledOnce();
      expect(mockEngine.set).toHaveBeenCalledOnce();
      expect(mockEngine.set.mock.calls[0][0]).toBe('CompositePk');
      expect(mockEngine.set.mock.calls[0][1]).toBe('pk»key»name§val§Test»key»type§val§1');
      expect(mockEngine.set.mock.calls[0][2]).toEqual(instance.toJSON());
      expect(mockEngine.set.mock.calls[0][3]).toHaveProperty('expiresIn');
      expect(mockEngine.set.mock.calls[0][3].expiresIn).toBeGreaterThan(0);
    });

    it('calls findOne if looking up with unique key, does not cache null value', async () => {
      const cache = createCache(SingleColPkUniq1, { uniqueKeys: [['mac']] });
      const findPkSpy = vi.spyOn(SingleColPkUniq1, 'findByPk').mockRejectedValue(new Error());
      const findOneSpy = vi.spyOn(SingleColPkUniq1, 'findOne').mockResolvedValue(null);

      const result = await cache._hydrate('uq»key»mac§val§00:11:22:33:44:55');
      expect(result).toBeNull();
      expect(findPkSpy).not.toHaveBeenCalled();
      expect(findOneSpy).toHaveBeenCalledOnce();
      expect(mockEngine.set).not.toHaveBeenCalled();
    });

    it('calls findOne if looking up with unique key, caches returned value', async () => {
      const cache = createCache(SingleColPkUniq1, { uniqueKeys: [['mac']] });
      const instance = SingleColPkUniq1.build(
        { id: 1n, mac: '00:01:02:03:04:05' },
        { isNewRecord: false },
      );
      const findPkSpy = vi.spyOn(SingleColPkUniq1, 'findByPk').mockRejectedValue(new Error());
      const findOneSpy = vi.spyOn(SingleColPkUniq1, 'findOne').mockResolvedValue(instance);

      const result = await cache._hydrate('uq»key»mac§val§00:11:22:33:44:55');
      expect(result).toEqual(instance.toJSON());
      expect(findPkSpy).not.toHaveBeenCalled();
      expect(findOneSpy).toHaveBeenCalledOnce();
      expect(mockEngine.set).toHaveBeenCalledOnce();
      expect(mockEngine.set.mock.calls[0][0]).toBe('SingleColPkUniq1');
      expect(mockEngine.set.mock.calls[0][1]).toBe('uq»key»mac§val§00:11:22:33:44:55');
      expect(mockEngine.set.mock.calls[0][2]).toEqual(instance.toJSON());
      expect(mockEngine.set.mock.calls[0][3]).toHaveProperty('expiresIn');
      expect(mockEngine.set.mock.calls[0][3].expiresIn).toBeGreaterThan(0);
    });
  });

  describe('getModel', () => {
    it('properly returns model from the cache', async () => {
      const cache = createCache(SingleColPk);
      const instance = SingleColPk.build({ id: '123', name: 'Test' });
      mockEngine.get.mockResolvedValue(instance.toJSON());

      const result = await cache.getModel('primary', ['123']);
      expect(result).toBeInstanceOf(SingleColPk);
      expect(result?.dataValues).toEqual(instance.dataValues);
      expect(result?.isNewRecord).toBe(false);
    });

    it('cache returns null, return null', async () => {
      const findPkSpy = vi.spyOn(SingleColPk, 'findByPk').mockResolvedValue(null);
      const cache = createCache(SingleColPk);
      mockEngine.get.mockResolvedValue(undefined);

      const result = await cache.getModel('primary', ['123']);
      expect(result).toBeNull();
      expect(findPkSpy).toHaveBeenCalled();
    });
  });

  describe('invalidate', () => {
    it('single-column primary key - invalidates 1 identifier', async () => {
      const cache = createCache(SingleColPk);
      const instance = SingleColPk.build({ id: 'abc', name: 'uwu' });

      await cache.invalidate(instance);
      expect(mockEngine.delMany).toHaveBeenCalledOnce();
      expect(mockEngine.delMany).toHaveBeenCalledWith('SingleColPk', ['pk§val§abc']);
    });

    it('multi-column primary key - invalidates 1 identifier', async () => {
      const cache = createCache(CompositePk);
      const instance = CompositePk.build({ type: 1, name: '(👉ﾟヮﾟ)👉', baz: 5 });

      await cache.invalidate(instance);
      expect(mockEngine.delMany).toHaveBeenCalledOnce();
      expect(mockEngine.delMany).toHaveBeenCalledWith('CompositePk', [
        'pk»key»name§val§(👉ﾟヮﾟ)👉»key»type§val§1',
      ]);
    });

    it('one unique key - invalidates 2 identifiers', async () => {
      const cache = createCache(SingleColPkUniq1, { uniqueKeys: [['mac']] });
      const instance = SingleColPkUniq1.build({ id: 123n, mac: '00:11:22:33:44:55' });

      await cache.invalidate(instance);
      expect(mockEngine.delMany).toHaveBeenCalledOnce();
      expect(mockEngine.delMany).toHaveBeenCalledWith('SingleColPkUniq1', [
        'pk§val§123',
        'uq»key»mac§val§00:11:22:33:44:55',
      ]);
    });

    it('two unique keys - invalidates 3 identifiers', async () => {
      const cache = createCache(SingleColPkUniq2, { uniqueKeys: [['name'], ['mac']] });
      const instance = SingleColPkUniq2.build({
        id: 123n,
        mac: '00:11:22:33:44:55',
        name: ':-D',
      });

      await cache.invalidate(instance);
      expect(mockEngine.delMany).toHaveBeenCalledOnce();
      expect(mockEngine.delMany).toHaveBeenCalledWith('SingleColPkUniq2', [
        'pk§val§123',
        'uq»key»mac§val§00:11:22:33:44:55',
        'uq»key»name§val§:-D',
      ]);
    });
  });

  describe('invalidateAll', () => {
    it('invalidates all cached keys', async () => {
      const cache = createCache(SingleColPk);
      await cache.invalidateAll();
      expect(mockEngine.delAll).toHaveBeenCalledOnce();
      expect(mockEngine.delAll).toHaveBeenCalledWith('SingleColPk');
    });
  });

  describe('buildId', () => {
    it('primary - single ID - no fields', () => {
      expect(buildId('primary', [123])).toBe('pk§val§123');
    });

    it('primary - single ID - one field', () => {
      expect(buildId('primary', [123], ['id'])).toBe('pk»key»id§val§123');
    });

    it('primary - mismatch between ID and field', () => {
      expect(() => buildId('primary', [123], ['id', 'oops']))
        .toThrow('Expected 1 field(s), but got 2');
    });

    it('primary - two IDs - no fields (throws)', () => {
      expect(() => buildId('primary', [123, '123']))
        .toThrow('Fields required when multiple identifiers provided or using unique key');
    });

    it('primary - two IDs - two fields', () => {
      expect(buildId('primary', [123, '123'], ['id1', 'id2']))
        .toBe('pk»key»id1§val§123»key»id2§val§123');
    });

    it('unique - single ID - no fields (throws)', () => {
      expect(() => buildId('unique', [123]))
        .toThrow('Fields required when multiple identifiers provided or using unique key');
    });

    it('unique - single ID - one field', () => {
      expect(buildId('unique', [123], ['id'])).toBe('uq»key»id§val§123');
    });

    it('unique - mismatch between ID and field', () => {
      expect(() => buildId('unique', [123], ['id', 'oops']))
        .toThrow('Expected 1 field(s), but got 2');
    });

    it('unique - two IDs - two fields', () => {
      expect(buildId('unique', [123, '123'], ['id1', 'id2']))
        .toBe('uq»key»id1§val§123»key»id2§val§123');
    });

    it('correctly serializes string, numeric, and array-like IDs', () => {
      const buffer = Buffer.from('0ab');
      const result = buildId(
        'primary',
        ['123', 456, 789n, buffer],
        ['id1', 'id2', 'id3', 'id4'],
      );
      expect(result).toBe('pk»key»id1§val§123»key»id2§val§456»key»id3§val§789»key»id4§val§0ab');
    });
  });

  describe('decodeIdentifier', () => {
    it('empty string - throws an error', () => {
      expect(() => decodeIdentifier('', { primary: String })).toThrow();
    });

    it('invalid identifier - bad type - throws an error', () => {
      expect(() => decodeIdentifier('abc', { primary: String }))
        .toThrow('Cache identifier is invalid: Invalid type');
    });

    it('invalid identifier - field, but no ID - throws an error', () => {
      expect(() => decodeIdentifier('pk»key»id', { primary: String }))
        .toThrow('Cache identifier is invalid: Invalid structure');
    });

    it('pk§val§123 - numeric - returns primary key of number 123', () => {
      const decoder = decodeIdentifier('pk§val§123', { primary: Number });
      expect(decoder.type).toBe('primary');
      expect(decoder).toHaveProperty('lookup', 123);
    });

    it('pk§val§123 - string - returns primary key of string 123', () => {
      const decoder = decodeIdentifier('pk§val§123', { primary: String });
      expect(decoder.type).toBe('primary');
      expect(decoder).toHaveProperty('lookup', '123');
    });

    it('pk§val§123 - bigint - returns primary key of int 123', () => {
      const decoder = decodeIdentifier('pk§val§123', { primary: BigInt });
      expect(decoder.type).toBe('primary');
      expect(decoder).toHaveProperty('lookup', 123n);
    });

    it('pk»key»id§val§123 - returns primary key of ID 123', () => {
      const decoder = decodeIdentifier('pk»key»id§val§123', {
        primary: { id: String },
      });
      expect(decoder.type).toBe('primary');
      expect(decoder).toHaveProperty(['lookups', 'id'], '123');
    });

    it('pk»key»id1§val§123»key»id2§val§123»key»id3§val§123 - returns primary key of IDs', () => {
      const decoder = decodeIdentifier(
        'pk»key»id1§val§123»key»id2§val§123»key»id3§val§123',
        { primary: { id1: String, id2: Number, id3: BigInt } },
      );
      expect(decoder.type).toBe('primary');
      expect(decoder).toHaveProperty(['lookups', 'id1'], '123');
      expect(decoder).toHaveProperty(['lookups', 'id2'], 123);
      expect(decoder).toHaveProperty(['lookups', 'id3'], 123n);
    });

    it('uq»key»id§val§123 - returns unique key of numeric ID 123', () => {
      const decoder = decodeIdentifier('uq»key»id§val§123', {
        primary: { id: String },
        unique: [{ id: Number }],
      });
      expect(decoder.type).toBe('unique');
      expect(decoder).toHaveProperty(['lookups', 'id'], 123);
    });

    it('uq»key»id1§val§123»key»id2§val§123 - correctly decodes using matching field list', () => {
      const decoder = decodeIdentifier('uq»key»id1§val§123»key»id2§val§123', {
        primary: { id: String },
        unique: [
          { id1: Number, id2: String },
          { id1: String, id2: String, id3: BigInt },
        ],
      });
      expect(decoder.type).toBe('unique');
      expect(decoder).toHaveProperty(['lookups', 'id1'], 123);
      expect(decoder).toHaveProperty(['lookups', 'id2'], '123');
    });
  });

  describe('resolveType', () => {
    it('single column - string type - returns String constructor', () => {
      const type = resolveType({ name: SingleColPk.getAttributes().name });
      expect(type).toBe(String);
    });

    it('single column - UUID type - returns String constructor', () => {
      const type = resolveType({ id: SingleColPk.getAttributes().id });
      expect(type).toBe(String);
    });

    it('single column - numeric - returns Number constructor', () => {
      const type = resolveType({ type: CompositePk.getAttributes().type });
      expect(type).toBe(Number);
    });

    it('single column - bigint - returns BigInt constructor', () => {
      const type = resolveType({ id: SingleColPkUniq1.getAttributes().id });
      expect(type).toBe(BigInt);
    });

    it('multi column - SingleColPk - returns { id: String, name: String }', () => {
      const type = resolveType(pick(SingleColPk.getAttributes(), ['id', 'name']));
      expect(type).toEqual({ id: String, name: String });
    });

    it('multi column - CompositePk - returns { type: Number, name: String, baz: Number }', () => {
      const type = resolveType(pick(CompositePk.getAttributes(), ['type', 'name', 'baz']));
      expect(type).toEqual({ type: Number, name: String, baz: Number });
    });

    it('multi keys - SingleColPkUniq2 - returns [{ mac: String }, { name: String }]', () => {
      const type = resolveType([
        pick(SingleColPkUniq2.getAttributes(), ['mac']),
        pick(SingleColPkUniq2.getAttributes(), ['name']),
      ]);
      expect(type).toEqual([{ mac: String }, { name: String }]);
    });
  });
});
