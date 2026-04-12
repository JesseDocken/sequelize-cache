import 'sequelize';

declare module 'sequelize' {
  interface FindOptions<TAttributes = any> {
    cache?: CacheOptions;
  }

  interface NonNullFindOptions<TAttributes = any> {
    cache?: CacheOptions;
  }

  interface CacheOptions {
    enabled: boolean;
    fallback: 'fail' | 'database';
  }

  interface GetAttribOptions {
    plain?: boolean;
    clone?: boolean;
    raw?: boolean;
  }

  interface Model<TModelAttributes extends {} = any, TCreationAttributes extends {} = TModelAttributes> {
    get<K extends keyof TModelAttributes, T = TModelAttributes[K]>(
      key: K,
      options?: GetAttribOptions
    ): T;

    get(options?: GetAttribOptions): TModelAttributes;
  }
}
