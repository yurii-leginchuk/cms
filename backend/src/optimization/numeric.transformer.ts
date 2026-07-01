import { ValueTransformer } from 'typeorm';

/**
 * TypeORM value transformer for Postgres `bigint` columns.
 *
 * pg returns bigint as a STRING (to avoid precision loss beyond 2^53). Image
 * byte sizes are always well under 2^53, so we safely round-trip them as JS
 * numbers for the app layer while storing them as bigint (int8) so a bulk run
 * over a large library can't overflow int4 (analyst P1-2).
 */
export const bigintTransformer: ValueTransformer = {
  to(value: number | null | undefined): string | null {
    return value === null || value === undefined ? null : String(value);
  },
  from(value: string | null | undefined): number | null {
    return value === null || value === undefined ? null : Number(value);
  },
};
