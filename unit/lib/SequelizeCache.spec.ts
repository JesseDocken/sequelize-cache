import { DataTypes, Model, Op, Sequelize } from 'sequelize';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCachedModels, keysMatchCandidates, SequelizeCache, shouldUseCache } from '../../lib/SequelizeCache';

import type { ModelKeyLookup } from '../../lib/CachedModelInstance';
import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';

vi.mock('../../lib/CachedModelInstance', () => ({ CachedModelInstance: class { } }));
vi.mock('../../lib/peers', () => ({ PeerContext: class { } }));

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

describe('SequelizeCache', () => {
  beforeEach(() => {
    SingleColPk.init({
      id: { type: DataTypes.UUID, primaryKey: true },
      name: { type: DataTypes.STRING },
    }, {
      sequelize,
      modelName: 'SingleColPk',
      timestamps: false,
      scopes: {
        test: function () { return {}; },
      },
    });
  });

  afterEach(() => {
    clearCachedModels();
  })

  it('constructor returns instance', () => {
    const inst = new SequelizeCache({
      engine: {
        connection: null as any,
        type: 'redis',
      },
    });
    expect(inst).to.be.instanceOf(SequelizeCache);
  });

  describe('cacheModel', () => {
    it('replaces findOne and findByPk', () => {
      const originalFindOne = SingleColPk.findOne;
      const originalFindByPk = SingleColPk.findByPk;

      const cache = new SequelizeCache({
        engine: {
          connection: null as any,
          type: 'redis',
        },
      });

      cache.cacheModel(SingleColPk);

      expect(SingleColPk.findOne).to.not.equal(originalFindOne);
      expect(SingleColPk.findByPk).to.not.equal(originalFindByPk);
    });

    it('registers after hooks for update and destroy', () => {
      const cache = new SequelizeCache({
        engine: {
          connection: null as any,
          type: 'redis',
        },
      });

      cache.cacheModel(SingleColPk);

      expect(SingleColPk.hasHook('afterUpdate')).toBeTruthy();
      expect(SingleColPk.hasHook('afterDestroy')).toBeTruthy();
      expect(SingleColPk.hasHook('afterBulkUpdate')).toBeTruthy();
      expect(SingleColPk.hasHook('afterBulkDestroy')).toBeTruthy();

      const hooks = SingleColPk.options.hooks as any;
      expect(hooks).toBeDefined();
      expect(hooks.afterUpdate).toHaveLength(1);
      expect(hooks.afterUpdate[0].name).toEqual('model-cache-update');
      expect(hooks.afterDestroy).toHaveLength(1);
      expect(hooks.afterDestroy[0].name).toEqual('model-cache-destroy');
      expect(hooks.afterBulkUpdate).toHaveLength(1);
      expect(hooks.afterBulkUpdate[0].name).toEqual('model-cache-bulk-update');
      expect(hooks.afterBulkDestroy).toHaveLength(1);
      expect(hooks.afterBulkDestroy[0].name).toEqual('model-cache-bulk-destroy');
    });

    it('throws an error if called against the same model twice', () => {
      const cache = new SequelizeCache({
        engine: {
          connection: null as any,
          type: 'redis',
        },
      });

      cache.cacheModel(SingleColPk);

      expect(() => cache.cacheModel(SingleColPk)).toThrow('Model SingleColPk has already been cached');
    });
  });

  describe('keysMatchCandidates', () => {
    it('[] does not match with any candidates', () => {
      const keys: string[] = [];
      const candidates: ModelKeyLookup = {
        primary: ['id', 'test'],
        unique: [['test'], ['ab', 'bc'], []],
      };

      const result = keysMatchCandidates(keys, candidates);

      expect(result).toBeUndefined();
    });

    it("matches ['test'] against primary ['test'] and unique []", () => {
      const keys = ['test'];
      const candidates: ModelKeyLookup = {
        primary: ['test'],
        unique: [],
      };

      const result = keysMatchCandidates(keys, candidates);

      expect(result).toBeDefined();
      expect(result).toEqual({
        type: 'primary',
        match: ['test'],
      });
    });

    it("matches ['test'] against primary ['id'] and unique ['test']", () => {
      const keys = ['test'];
      const candidates: ModelKeyLookup = {
        primary: ['id'],
        unique: [['test']],
      };

      const result = keysMatchCandidates(keys, candidates);

      expect(result).toBeDefined();
      expect(result).toEqual({
        type: 'unique',
        match: ['test'],
      });
    });

    it("matches ['def'] against primary ['id'] and unique [['abc'], ['def']]", () => {
      const keys = ['def'];
      const candidates: ModelKeyLookup = {
        primary: ['id'],
        unique: [['abc'], ['def']],
      };

      const result = keysMatchCandidates(keys, candidates);

      expect(result).toBeDefined();
      expect(result).toEqual({
        type: 'unique',
        match: ['def'],
      });
    });

    it("matches ['id', 'test'] against primary ['id', 'test'] and unique []", () => {
      const keys = ['id', 'test'];
      const candidates: ModelKeyLookup = {
        primary: ['id', 'test'],
        unique: [],
      };

      const result = keysMatchCandidates(keys, candidates);

      expect(result).toBeDefined();
      expect(result).toEqual({
        type: 'primary',
        match: ['id', 'test'],
      });
    });

    it("['abc'] does not match against primary ['id'] and unique [['test'], ['def']]", () => {
      const keys = ['abc'];
      const candidates: ModelKeyLookup = {
        primary: ['id'],
        unique: [['test'], ['def']],
      };

      const result = keysMatchCandidates(keys, candidates);

      expect(result).toBeUndefined();
    });
  });

  describe('shouldUseCache', () => {
    it('returns false if cache is not set on the query', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys);
      expect(result).toBeFalsy();
    });

    it('returns false if cache is false on the query', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: false,
      });
      expect(result).toBeFalsy();
    });

    it('returns false if cache is disabled on the query', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: {
          enabled: false,
        },
      });
      expect(result).toBeFalsy();
    });

    it('returns false if cache is disabled on the query and fallback is fail', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: {
          enabled: false,
          fallback: 'fail',
        },
      });
      expect(result).toBeFalsy();
    });

    it('returns false if model is scoped', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk.scope({ method: ['test'] }), keys, undefined, {
        cache: true,
      });
      expect(result).toBeFalsy();
    });

    it('throws if model is scoped and fallback is fail', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      expect(() => shouldUseCache(SingleColPk.scope({ method: ['test'] }), keys, undefined, {
        cache: {
          enabled: true,
          fallback: 'fail',
        },
      })).toThrow('Query is nonconformant');
    });

    it('returns false if illegal attribute is included', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: true,
        include: ['Test'],
      });
      expect(result).toBeFalsy();
    });

    it('throws if illegal attribute is included', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      expect(() => shouldUseCache(SingleColPk, keys, undefined, {
        cache: {
          enabled: true,
          fallback: 'fail',
        },
        include: ['Test'],
      })).toThrow('Query is nonconformant');
    });

    it('returns false if where clause uses unsupported operator', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: true,
        where: {
          id: {
            [Op.in]: ['abc', 'def'],
          }
        },
      });
      expect(result).toBeFalsy();
    });

    it('throws if where clause uses unsupported operator and fallback is fail', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      expect(() => shouldUseCache(SingleColPk, keys, undefined, {
        cache: {
          enabled: true,
          fallback: 'fail',
        },
        where: {
          id: {
            [Op.in]: ['abc', 'def'],
          }
        },
      })).toThrow('Query is nonconformant');
    });

    it('returns true if identifier included and no where clause', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, 'abc', {
        cache: true,
      });
      expect(result).toBeTruthy();
    });

    it('returns true if where included with matching keys', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: true,
        where: {
          id: 'abc',
        },
      });
      expect(result).toBeTruthy();
    });

    it('returns true if where included with matching keys and eq operator', () => {
      const keys = {
        primary: ['id'],
        unique: [],
      };
      const result = shouldUseCache(SingleColPk, keys, undefined, {
        cache: true,
        where: {
          id: {
            [Op.eq]: 'abc',
          },
        },
      });
      expect(result).toBeTruthy();
    });
  });
});
