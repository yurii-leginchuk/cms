import 'reflect-metadata';
import { DataSource } from 'typeorm';

/**
 * Standalone DataSource for TypeORM CLI (migration:run / migration:revert).
 * Mirrors the runtime config in database.config.ts. Used in production where
 * synchronize is off; dev relies on synchronize:true and does not need this.
 */
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'cms_user',
  password: process.env.POSTGRES_PASSWORD || 'cms_password',
  database: process.env.POSTGRES_DB || 'cms_db',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/../migrations/*{.ts,.js}'],
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
});

export default AppDataSource;
