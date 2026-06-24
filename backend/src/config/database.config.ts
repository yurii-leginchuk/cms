import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    type: 'postgres',
    host: config.get('POSTGRES_HOST', 'localhost'),
    port: config.get<number>('POSTGRES_PORT', 5432),
    username: config.get('POSTGRES_USER', 'cms_user'),
    password: config.get('POSTGRES_PASSWORD', 'cms_password'),
    database: config.get('POSTGRES_DB', 'cms_db'),
    entities: [__dirname + '/../**/*.entity{.ts,.js}'],
    migrations: [__dirname + '/../migrations/*{.ts,.js}'],
    synchronize: config.get('NODE_ENV') !== 'production',
    logging: config.get('NODE_ENV') === 'development',
  }),
};
