import 'sequelize';

declare module 'sequelize' {
  interface FindOptions<TAttributes = any> {
    cache?: boolean | FindCacheOptions;
  }

  interface NonNullFindOptions<TAttributes = any> {
    cache?: FindCacheOptions;
  }

  interface FindCacheOptions {
    enabled: boolean;
    fallback?: 'fail' | 'database';
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
