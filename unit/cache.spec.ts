import { expect } from 'chai';
import { pick } from 'lodash';
import {
  Column,
  DataType,
  Model,
  PrimaryKey,
  Scopes,
  Sequelize,
  Table,
} from 'sequelize-typescript';
import sinon from 'sinon';

import * as CCModule from '@base/util/cache/CacheClient';
import UnitTestHelper from '@unitBase/UnitTestHelper';

import type { SequelizeModelCache } from '@base/util/db/cache/SequelizeModelCache';
import type { CreationOptional, InferCreationAttributes } from 'sequelize';

describe('SequelizeModelCache', () => {
  let helper: UnitTestHelper;
  let modelCacheCtor: typeof SequelizeModelCache;
  let internal: any;
  const mocks: any = {};
  const originalCC = CCModule.CacheClient;
  const mockCC = sinon.stub(CCModule, 'CacheClient');

  beforeEach(() => {
    helper = new UnitTestHelper();
    mocks.cacheClient = sinon.createStubInstance(originalCC);
    mockCC.reset();
    mocks.cache = helper.stub('@base/util/cache/CacheClient', {
      CacheClient: mockCC.returns(mocks.cacheClient),
    });
    mocks.config = helper.stub('@base/util/config', {
      getBool: sinon.stub().returns(true),
      getNum: sinon.stub().returns(100),
    });
    const module = helper.instantiate('@base/util/db/cache/SequelizeModelCache');
    modelCacheCtor = module.SequelizeModelCache;
    internal = module.__test;
    new Sequelize({
      dialect: 'sqlite',
      storage: ':memory:',
      logging: false,
      models: [SingleColPk, CompositePk, SingleColPkUniq1, SingleColPkUniq2],
    });
  });

  afterEach(() => {
    if (helper) {
      helper.destroy();
    }
  });

  after(() => {
    mockCC.restore();
  });

  describe('modelKeys getter', () => {
    it('SingleColPk - one primary key, no unique keys', () => {
      const cache = new modelCacheCtor(SingleColPk);
      const keys = cache.modelKeys;
      expect(keys.primary, 'no primary key found').to.exist.and.not.be.empty;
      expect(keys.unique, 'unexpected unique key(s) found').to.exist.be.empty;
      expect(keys.primary).to.deep.equal(['id']);
    });

    it('CompositePk - two-column primary key, no unique keys', () => {
      const cache = new modelCacheCtor(CompositePk);
      const keys = cache.modelKeys;
      expect(keys.primary, 'no primary key found').to.exist.and.not.be.empty;
      expect(keys.unique, 'unexpected unique key(s) found').to.exist.and.be.empty;
      expect(keys.primary).to.deep.equal(['type', 'name']);
    });

    it('SingleColPkUniq1 - one primary key, one unique key', () => {
      const cache = new modelCacheCtor(SingleColPkUniq1, {
        uniqueKeys: [['mac']],
      });
      const keys = cache.modelKeys;
      expect(keys.primary, 'no primary key found').to.exist.and.not.be.empty;
      expect(keys.unique, 'no unique keys found').to.exist.and.not.be.empty;
      expect(keys.primary).to.deep.equal(['id']);
      expect(keys.unique).to.deep.equal([['mac']]);
    });

    it('SingleColPkUniq2 - one primary key, two unique keys', () => {
      const cache = new modelCacheCtor(SingleColPkUniq2, {
        uniqueKeys: [['mac'], ['name']],
      });
      const keys = cache.modelKeys;
      expect(keys.primary, 'no primary key found').to.exist.and.not.be.empty;
      expect(keys.unique, 'no unique keys found').to.exist.and.not.be.empty;
      expect(keys.primary).to.deep.equal(['id']);
      expect(keys.unique).to.deep.equal([['mac'], ['name']]);
    });
  });

  describe('hydrate', () => {
    it('returns null if id is undefined', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      const result = await cache._hydrate(undefined);
      expect(result).to.be.null;
    });

    it('returns null if id is null', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      const result = await cache._hydrate(null as any);
      expect(result).to.be.null;
    });

    it('calls findByPk if looking up with single-column PK, does not cache null value', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      const findPkStub = sinon.stub(SingleColPk, 'findByPk');
      const findOneStub = sinon.stub(SingleColPk, 'findOne');
      try {
        const result = await cache._hydrate('pk§val§123');
        expect(result).to.be.null;
        expect(findPkStub.calledOnce).to.be.true;
        expect(findOneStub.called).to.be.false;
        expect(mocks.cacheClient.set.called).to.be.false;
      } finally {
        findPkStub.restore();
        findOneStub.restore();
      }
    });

    it('calls findByPk if looking up with single-column PK, caches returned value', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      const instance = SingleColPk.build(
        {
          id: '123',
          name: 'Test',
        },
        {
          isNewRecord: false,
        }
      );
      const findPkStub = sinon.stub(SingleColPk, 'findByPk').resolves(instance);
      const findOneStub = sinon.stub(SingleColPk, 'findOne');
      try {
        const result = await cache._hydrate('pk§val§123');
        expect(result).to.deep.equal(instance.toJSON());
        expect(findPkStub.calledOnce).to.be.true;
        expect(findOneStub.called).to.be.false;
        expect(mocks.cacheClient.set.calledOnce).to.be.true;
        expect(mocks.cacheClient.set.args[0][0]).to.equal('model');
        expect(mocks.cacheClient.set.args[0][1]).to.equal('SingleColPk');
        expect(mocks.cacheClient.set.args[0][2]).to.equal('pk§val§123');
        expect(mocks.cacheClient.set.args[0][3]).to.deep.equal(instance.toJSON());
        expect(mocks.cacheClient.set.args[0][4]).to.haveOwnProperty('expiresIn');
        expect(mocks.cacheClient.set.args[0][4].expiresIn).to.be.greaterThan(0);
      } finally {
        findPkStub.restore();
        findOneStub.restore();
      }
    });

    it('calls findOne if looking up with composite PK, caches returned value', async () => {
      const cache = new modelCacheCtor(CompositePk);
      const instance = CompositePk.build(
        {
          type: 1,
          name: 'Test',
          baz: 444,
        },
        {
          isNewRecord: false,
        }
      );
      const findPkStub = sinon.stub(CompositePk, 'findByPk').rejects();
      const findOneStub = sinon.stub(CompositePk, 'findOne').resolves(instance);
      try {
        const result = await cache._hydrate('pk»key»type§val§1»key»name§val§Test');
        expect(result).to.deep.equal(instance.toJSON());
        expect(findPkStub.called).to.be.false;
        expect(findOneStub.calledOnce).to.be.true;
        expect(mocks.cacheClient.set.calledOnce).to.be.true;
        expect(mocks.cacheClient.set.args[0][0]).to.equal('model');
        expect(mocks.cacheClient.set.args[0][1]).to.equal('CompositePk');
        expect(mocks.cacheClient.set.args[0][2]).to.equal('pk»key»type§val§1»key»name§val§Test');
        expect(mocks.cacheClient.set.args[0][3]).to.deep.equal(instance.toJSON());
        expect(mocks.cacheClient.set.args[0][4]).to.haveOwnProperty('expiresIn');
        expect(mocks.cacheClient.set.args[0][4].expiresIn).to.be.greaterThan(0);
      } finally {
        findPkStub.restore();
        findOneStub.restore();
      }
    });

    it('calls findOne if looking up with unique key, does not cache null value', async () => {
      const cache = new modelCacheCtor(SingleColPkUniq1);
      const findPkStub = sinon.stub(SingleColPkUniq1, 'findByPk').rejects();
      const findOneStub = sinon.stub(SingleColPkUniq1, 'findOne').resolves(null);
      try {
        const result = await cache._hydrate('uq»key»mac§val§00:11:22:33:44:55');
        expect(result).to.be.null;
        expect(findPkStub.called).to.be.false;
        expect(findOneStub.calledOnce).to.be.true;
        expect(mocks.cacheClient.set.called).to.be.false;
      } finally {
        findPkStub.restore();
        findOneStub.restore();
      }
    });

    it('calls findOne if looking up with unique key, caches returned value', async () => {
      const cache = new modelCacheCtor(SingleColPkUniq1);
      const instance = SingleColPkUniq1.build(
        {
          id: 1n,
          mac: '00:01:02:03:04:05',
        },
        {
          isNewRecord: false,
        }
      );
      const findPkStub = sinon.stub(SingleColPkUniq1, 'findByPk').rejects();
      const findOneStub = sinon.stub(SingleColPkUniq1, 'findOne').resolves(instance);
      try {
        const result = await cache._hydrate('uq»key»mac§val§00:11:22:33:44:55');
        expect(result).to.deep.equal(instance.toJSON());
        expect(findPkStub.called).to.be.false;
        expect(findOneStub.calledOnce).to.be.true;
        expect(mocks.cacheClient.set.calledOnce).to.be.true;
        expect(mocks.cacheClient.set.args[0][0]).to.equal('model');
        expect(mocks.cacheClient.set.args[0][1]).to.equal('SingleColPkUniq1');
        expect(mocks.cacheClient.set.args[0][2]).to.equal('uq»key»mac§val§00:11:22:33:44:55');
        expect(mocks.cacheClient.set.args[0][3]).to.deep.equal(instance.toJSON());
        expect(mocks.cacheClient.set.args[0][4]).to.haveOwnProperty('expiresIn');
        expect(mocks.cacheClient.set.args[0][4].expiresIn).to.be.greaterThan(0);
      } finally {
        findPkStub.restore();
        findOneStub.restore();
      }
    });
  });

  describe('getModel', () => {
    it('properly returns model from the cache', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      const instance = SingleColPk.build({
        id: '123',
        name: 'Test',
      });
      mocks.cacheClient.get.resolves(instance.toJSON());
      const result = await cache.getModel('primary', ['123']);
      expect(result).to.exist.and.be.instanceOf(SingleColPk);
      expect(result?.dataValues).to.deep.equal(instance.dataValues);
      expect(result?.isNewRecord).to.be.false;
    });

    it('cache returns null, return null', async () => {
      const findPkStub = sinon.stub(SingleColPk, 'findByPk').resolves(null);
      try {
        const cache = new modelCacheCtor(SingleColPk);
        mocks.cacheClient.get.resolves(null);
        const result = await cache.getModel('primary', ['123']);
        expect(result).to.be.null;
      } finally {
        findPkStub.restore();
      }
    });
  });

  describe('invalidate', () => {
    it('single-column primary key - invalidates 1 identifier', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      const instance = SingleColPk.build({
        id: 'abc',
        name: 'uwu',
      });
      await cache.invalidate(instance);
      expect(mocks.cacheClient.delMany.calledOnce).to.be.true;
      expect(mocks.cacheClient.delMany.args[0][0]).to.equal('model');
      expect(mocks.cacheClient.delMany.args[0][1]).to.equal('SingleColPk');
      expect(mocks.cacheClient.delMany.args[0][2]).to.deep.equal(['pk§val§abc']);
    });

    it('multi-column primary key - invalidates 1 identifier', async () => {
      const cache = new modelCacheCtor(CompositePk);
      const instance = CompositePk.build({
        type: 1,
        name: '(👉ﾟヮﾟ)👉',
        baz: 5,
      });
      await cache.invalidate(instance);
      expect(mocks.cacheClient.delMany.calledOnce).to.be.true;
      expect(mocks.cacheClient.delMany.args[0][0]).to.equal('model');
      expect(mocks.cacheClient.delMany.args[0][1]).to.equal('CompositePk');
      expect(mocks.cacheClient.delMany.args[0][2]).to.deep.equal([
        'pk»key»type§val§1»key»name§val§(👉ﾟヮﾟ)👉',
      ]);
    });

    it('one unique key - invalidates 2 identifiers', async () => {
      const cache = new modelCacheCtor(SingleColPkUniq1, {
        uniqueKeys: [['mac']],
      });
      const instance = SingleColPkUniq1.build({
        id: 123n,
        mac: '00:11:22:33:44:55',
      });
      await cache.invalidate(instance);
      expect(mocks.cacheClient.delMany.calledOnce).to.be.true;
      expect(mocks.cacheClient.delMany.args[0][0]).to.equal('model');
      expect(mocks.cacheClient.delMany.args[0][1]).to.equal('SingleColPkUniq1');
      expect(mocks.cacheClient.delMany.args[0][2]).to.deep.equal([
        'pk§val§123',
        'uq»key»mac§val§00:11:22:33:44:55',
      ]);
    });

    it('two unique keys - invalidates 3 identifiers', async () => {
      const cache = new modelCacheCtor(SingleColPkUniq2, {
        uniqueKeys: [['name'], ['mac']],
      });
      const instance = SingleColPkUniq2.build({
        id: 123n,
        mac: '00:11:22:33:44:55',
        name: ':-D',
      });
      await cache.invalidate(instance);
      expect(mocks.cacheClient.delMany.calledOnce).to.be.true;
      expect(mocks.cacheClient.delMany.args[0][0]).to.equal('model');
      expect(mocks.cacheClient.delMany.args[0][1]).to.equal('SingleColPkUniq2');
      expect(mocks.cacheClient.delMany.args[0][2]).to.deep.equal([
        'pk§val§123',
        'uq»key»name§val§:-D',
        'uq»key»mac§val§00:11:22:33:44:55',
      ]);
    });
  });

  describe('invalidateAll', () => {
    it('invalidates all cached keys', async () => {
      const cache = new modelCacheCtor(SingleColPk);
      await cache.invalidateAll();
      expect(mocks.cacheClient.delAll.calledOnce).to.be.true;
      expect(mocks.cacheClient.delAll.args[0][0]).to.equal('model');
      expect(mocks.cacheClient.delAll.args[0][1]).to.equal('SingleColPk');
    });
  });

  describe('buildId', () => {
    it('primary - single ID - no fields', () => {
      const result = internal.buildId('primary', [123]);
      expect(result).to.equal('pk§val§123');
    });

    it('primary - single ID - one field', () => {
      const result = internal.buildId('primary', [123], ['id']);
      expect(result).to.equal('pk»key»id§val§123');
    });

    it('primary - mismatch between ID and field', () => {
      let err;
      try {
        internal.buildId('primary', [123], ['id', 'oops']);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal('Expected 1 field(s), but got 2');
    });

    it('primary - two IDs - no fields (throws)', () => {
      let err;
      try {
        internal.buildId('primary', [123, '123']);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal(
        'Fields required when multiple identifiers provided or using unique key'
      );
    });

    it('primary - two IDs - two fields', () => {
      const result = internal.buildId('primary', [123, '123'], ['id1', 'id2']);
      expect(result).to.equal('pk»key»id1§val§123»key»id2§val§123');
    });

    it('unique - single ID - no fields (throws)', () => {
      let err;
      try {
        internal.buildId('unique', [123]);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal(
        'Fields required when multiple identifiers provided or using unique key'
      );
    });

    it('unique - single ID - one field', () => {
      const result = internal.buildId('unique', [123], ['id']);
      expect(result).to.equal('uq»key»id§val§123');
    });

    it('unique - mismatch between ID and field', () => {
      let err;
      try {
        internal.buildId('unique', [123], ['id', 'oops']);
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal('Expected 1 field(s), but got 2');
    });

    it('unique - two IDs - two fields', () => {
      const result = internal.buildId('unique', [123, '123'], ['id1', 'id2']);
      expect(result).to.equal('uq»key»id1§val§123»key»id2§val§123');
    });

    it('correctly serializes string, numeric, and array-like IDs', () => {
      const buffer = Buffer.from('0ab');
      const result = internal.buildId(
        'primary',
        ['123', 456, 789n, buffer],
        ['id1', 'id2', 'id3', 'id4']
      );
      expect(result).to.equal('pk»key»id1§val§123»key»id2§val§456»key»id3§val§789»key»id4§val§0ab');
    });
  });

  describe('decodeIdentifier', () => {
    it('empty string - throws an error', () => {
      let err;
      try {
        internal.decodeIdentifier('', {
          primary: String,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
    });

    it('invalid identifier - bad type - throws an error', () => {
      let err;
      try {
        internal.decodeIdentifier('abc', {
          primary: String,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal('Invalid identifier type');
    });

    it('invalid identifier - field, but no ID - throws an error', () => {
      let err;
      try {
        internal.decodeIdentifier('pk»key»id', {
          primary: String,
        });
      } catch (e) {
        err = e;
      }
      expect(err).to.exist;
      expect(err.message).to.equal('Invalid identifier structure');
    });

    it('pk§val§123 - numeric - returns primary key of number 123', () => {
      const decoder = internal.decodeIdentifier('pk§val§123', {
        primary: Number,
      });
      expect(decoder.type).to.equal('primary');
      expect(decoder.lookup).to.equal(123);
    });

    it('pk§val§123 - string - returns primary key of string 123', () => {
      const decoder = internal.decodeIdentifier('pk§val§123', {
        primary: String,
      });
      expect(decoder.type).to.equal('primary');
      expect(decoder.lookup).to.equal('123');
    });

    it('pk§val§123 - bigint - returns primary key of int 123', () => {
      const decoder = internal.decodeIdentifier('pk§val§123', {
        primary: BigInt,
      });
      expect(decoder.type).to.equal('primary');
      expect(decoder.lookup).to.equal(123n);
    });

    it('pk»key»id§val§123 - returns primary key of ID 123', () => {
      const decoder = internal.decodeIdentifier('pk»key»id§val§123', {
        primary: {
          id: String,
        },
      });
      expect(decoder.type).to.equal('primary');
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id');
      expect(decoder.lookups.id).to.equal('123');
    });

    it('pk»key»id1§val§123»key»id2§val§123»key»id3§val§123 - returns primary key of IDs', () => {
      const decoder = internal.decodeIdentifier(
        'pk»key»id1§val§123»key»id2§val§123»key»id3§val§123',
        {
          primary: {
            id1: String,
            id2: Number,
            id3: BigInt,
          },
        }
      );
      expect(decoder.type).to.equal('primary');
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id1');
      expect(decoder.lookups.id1).to.equal('123');
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id2');
      expect(decoder.lookups.id2).to.equal(123);
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id3');
      expect(decoder.lookups.id3).to.equal(123n);
    });

    it('uq»key»id§val§123 - returns unique key of numeric ID 123', () => {
      const decoder = internal.decodeIdentifier('uq»key»id§val§123', {
        primary: {
          id: String,
        },
        unique: [
          {
            id: Number,
          },
        ],
      });
      expect(decoder.type).to.equal('unique');
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id');
      expect(decoder.lookups.id).to.equal(123);
    });

    it('uq»key»id1§val§123»key»id2§val§123 - correctly decodes using matching field list', () => {
      const decoder = internal.decodeIdentifier('uq»key»id1§val§123»key»id2§val§123', {
        primary: {
          id: String,
        },
        unique: [
          {
            id1: Number,
            id2: String,
          },
          {
            id1: String,
            id2: String,
            id3: BigInt,
          },
        ],
      });
      expect(decoder.type).to.equal('unique');
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id1');
      expect(decoder.lookups.id1).to.equal(123);
      expect(decoder.lookups).to.exist.and.haveOwnProperty('id2');
      expect(decoder.lookups.id2).to.equal('123');
    });
  });

  describe('resolveType', () => {
    it('single column - string type - returns String constructor', () => {
      const type = internal.resolveType({
        name: SingleColPk.getAttributes().name,
      });
      expect(type).to.equal(String);
    });

    it('single column - UUID type - returns String constructor', () => {
      const type = internal.resolveType({
        id: SingleColPk.getAttributes().id,
      });
      expect(type).to.equal(String);
    });

    it('single column - numeric - returns Number constructor', () => {
      const type = internal.resolveType({
        type: CompositePk.getAttributes().type,
      });
      expect(type).to.equal(Number);
    });

    it('single column - bigint - returns BigInt constructor', () => {
      const type = internal.resolveType({
        id: SingleColPkUniq1.getAttributes().id,
      });
      expect(type).to.equal(BigInt);
    });

    it('multi column - SingleColPk - returns [String, String]', () => {
      const type = internal.resolveType(pick(SingleColPk.getAttributes(), ['id', 'name']));
      expect(type).to.deep.equal({
        id: String,
        name: String,
      });
    });

    it('multi column - CompositePk - returns [Number, String, Number]', () => {
      const type = internal.resolveType(pick(CompositePk.getAttributes(), ['type', 'name', 'baz']));
      expect(type).to.deep.equal({
        type: Number,
        name: String,
        baz: Number,
      });
    });

    it('multi keys - SingleColPkUniq2 - returns [[String], [String]]', () => {
      const type = internal.resolveType([
        pick(SingleColPkUniq2.getAttributes(), ['mac']),
        pick(SingleColPkUniq2.getAttributes(), ['name']),
      ]);
      expect(type).to.deep.equal([
        {
          mac: String,
        },
        {
          name: String,
        },
      ]);
    });
  });
});

@Scopes(() => ({
  test: () => {
    return {};
  },
}))
@Table
class SingleColPk extends Model<SingleColPk, InferCreationAttributes<SingleColPk>> {
  @PrimaryKey
  @Column(DataType.UUIDV1)
  declare id: CreationOptional<string>;

  @Column(DataType.STRING)
  declare name: string;
}

@Table
class CompositePk extends Model<CompositePk, InferCreationAttributes<CompositePk>> {
  @PrimaryKey
  @Column(DataType.SMALLINT)
  declare type: number;

  @PrimaryKey
  @Column(DataType.STRING)
  declare name: string;

  @Column(DataType.NUMBER)
  declare baz: number;
}

@Table
class SingleColPkUniq1 extends Model<SingleColPkUniq1, InferCreationAttributes<SingleColPkUniq1>> {
  @PrimaryKey
  @Column(DataType.BIGINT)
  declare id: bigint;

  @Column(DataType.MACADDR)
  declare mac: string;
}

@Table
class SingleColPkUniq2 extends Model<SingleColPkUniq2, InferCreationAttributes<SingleColPkUniq2>> {
  @PrimaryKey
  @Column(DataType.BIGINT)
  declare id: bigint;

  @Column(DataType.MACADDR)
  declare mac: string;

  @Column(DataType.STRING)
  declare name: string;
}
