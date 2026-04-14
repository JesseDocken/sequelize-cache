import Redis from 'ioredis';
import { DataTypes, Model, Sequelize } from 'sequelize';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SequelizeCache } from '../index';

import type { CreationOptional, InferAttributes, InferCreationAttributes } from 'sequelize';

// Two models: one with a short TTL to verify the TTL is applied, one with the
// default TTL to confirm it takes effect when no explicit ttl is given.

class ShortTtlModel extends Model<InferAttributes<ShortTtlModel>, InferCreationAttributes<ShortTtlModel>> {
  declare id: CreationOptional<number>;
  declare name: string;
}

class DefaultTtlModel extends Model<InferAttributes<DefaultTtlModel>, InferCreationAttributes<DefaultTtlModel>> {
  declare id: CreationOptional<number>;
  declare name: string;
}

let sequelize: Sequelize;
let redis: Redis;

const NAMESPACE = 'expiration-test';
const SHORT_TTL = 30; // seconds — short enough to check, but long enough to not expire mid-test

beforeAll(async () => {
  redis = new Redis({ host: '127.0.0.1', port: 6379, lazyConnect: true });
  await redis.connect();

  sequelize = new Sequelize({
    dialect: 'postgres',
    host: '127.0.0.1',
    port: 5432,
    username: 'test',
    password: 'test',
    database: 'test',
    logging: false,
  });

  ShortTtlModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
  }, { sequelize, modelName: 'ShortTtlModel', timestamps: false });

  DefaultTtlModel.init({
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    name: { type: DataTypes.STRING, allowNull: false },
  }, { sequelize, modelName: 'DefaultTtlModel', timestamps: false });

  await sequelize.sync({ force: true });

  const cache = new SequelizeCache({
    engine: { connection: redis, type: 'redis' },
    caching: { namespace: NAMESPACE },
  });

  cache.cacheModel(ShortTtlModel, { ttl: SHORT_TTL });
  cache.cacheModel(DefaultTtlModel); // uses default (3600s)
});

beforeEach(async () => {
  const keys = await redis.keys(`${NAMESPACE}:*`);
  if (keys.length > 0) {
    await redis.del(keys);
  }
  await ShortTtlModel.destroy({ where: {}, hooks: false });
  await DefaultTtlModel.destroy({ where: {}, hooks: false });
});

afterAll(async () => {
  await sequelize.close();
  redis.disconnect();
});

describe('key expiration', () => {
  it('sets the configured TTL on the Redis key', async () => {
    const inst = await ShortTtlModel.create({ name: 'Widget' });

    // Populate cache.
    await ShortTtlModel.findByPk(inst.id, { cache: { enabled: true } });

    const keys = await redis.keys(`${NAMESPACE}:ShortTtlModel:*`);
    expect(keys).toHaveLength(1);

    const ttl = await redis.ttl(keys[0]);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(SHORT_TTL);
  });

  it('applies the default TTL (3600s) when no ttl option is specified', async () => {
    const inst = await DefaultTtlModel.create({ name: 'Gadget' });

    await DefaultTtlModel.findByPk(inst.id, { cache: { enabled: true } });

    const keys = await redis.keys(`${NAMESPACE}:DefaultTtlModel:*`);
    expect(keys).toHaveLength(1);

    const ttl = await redis.ttl(keys[0]);
    // Should be close to 3600; allow a few seconds of drift.
    expect(ttl).toBeGreaterThan(3590);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('re-hydrates from the database after the key expires', async () => {
    const inst = await ShortTtlModel.create({ name: 'Ephemeral' });

    // Populate cache.
    await ShortTtlModel.findByPk(inst.id, { cache: { enabled: true } });
    let keys = await redis.keys(`${NAMESPACE}:ShortTtlModel:*`);
    expect(keys).toHaveLength(1);

    // Simulate expiry by deleting the key directly.
    await redis.del(keys);

    keys = await redis.keys(`${NAMESPACE}:ShortTtlModel:*`);
    expect(keys).toHaveLength(0);

    // findByPk re-hydrates from the database.
    const fresh = await ShortTtlModel.findByPk(inst.id, { cache: { enabled: true } });
    expect(fresh).not.toBeNull();
    expect(fresh!.name).toBe('Ephemeral');

    // And re-populates the cache.
    keys = await redis.keys(`${NAMESPACE}:ShortTtlModel:*`);
    expect(keys).toHaveLength(1);
  });

  it('returns fresh data after expiry, not stale cached data', async () => {
    const inst = await ShortTtlModel.create({ name: 'Original' });

    // Populate cache with the original value.
    await ShortTtlModel.findByPk(inst.id, { cache: { enabled: true } });

    // Update the record directly in the DB — bypass Sequelize hooks to simulate
    // an external write that the cache layer doesn't know about.
    await sequelize.query(
      `UPDATE "ShortTtlModels" SET "name" = 'Updated' WHERE "id" = ${inst.id}`
    );

    // While the key is alive, we still get the stale value.
    const stale = await ShortTtlModel.findByPk(inst.id, { cache: { enabled: true } });
    expect(stale!.name).toBe('Original');

    // Simulate expiry.
    const keys = await redis.keys(`${NAMESPACE}:ShortTtlModel:*`);
    await redis.del(keys);

    // After expiry, re-hydration returns the updated value.
    const fresh = await ShortTtlModel.findByPk(inst.id, { cache: { enabled: true } });
    expect(fresh!.name).toBe('Updated');
  });
});
