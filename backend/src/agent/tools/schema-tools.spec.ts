import { createSchemaTools } from './schema-tools';
import { SchemaService } from '../../schema/schema.service';
import { SchemaAiService } from '../../schema/schema-ai.service';
import { SchemaSyncService } from '../../schema/schema-sync.service';
import { SchemaQcService } from '../../schema/schema-qc.service';

function build(overrides: {
  schema?: Partial<SchemaService>;
  ai?: Partial<SchemaAiService>;
  sync?: Partial<SchemaSyncService>;
  qc?: Partial<SchemaQcService>;
} = {}) {
  const schema = {
    // Defaults to "no managed schemas" so the addManagedSchema duplicate-guard
    // (which calls listManaged) works in tests that don't stub it explicitly.
    listManaged: jest.fn().mockResolvedValue([]),
    detectForPage: jest.fn(),
    validate: jest.fn(),
    pendingChanges: jest.fn(),
    createManaged: jest.fn(),
    updateManaged: jest.fn(),
    ...overrides.schema,
  } as unknown as SchemaService;
  const ai = {
    analyze: jest.fn(),
    ...overrides.ai,
  } as unknown as SchemaAiService;
  const sync = {
    getHistory: jest.fn(),
    ...overrides.sync,
  } as unknown as SchemaSyncService;
  const qc = {
    qc: jest.fn(),
    ...overrides.qc,
  } as unknown as SchemaQcService;
  const tools = createSchemaTools(schema, ai, sync, qc, 'site-1');
  return { tools, schema, ai, sync, qc };
}

describe('createSchemaTools — read tools', () => {
  it('listPageSchemas returns the managed set from the service', async () => {
    const listManaged = jest.fn().mockResolvedValue([{ id: 's1' }]);
    const { tools } = build({ schema: { listManaged } });
    const out: any = await (tools.listPageSchemas as any).execute({ pageId: 'p1' });
    expect(listManaged).toHaveBeenCalledWith('p1');
    expect(out.type).toBe('schema_data');
    expect(out.action).toBe('list_managed');
    expect(out.schemas).toEqual([{ id: 's1' }]);
  });

  it('detectSchemas calls detectForPage and returns the result', async () => {
    const detectForPage = jest.fn().mockResolvedValue({ summary: { total: 3 } });
    const { tools } = build({ schema: { detectForPage } });
    const out: any = await (tools.detectSchemas as any).execute({ pageId: 'p1' });
    expect(detectForPage).toHaveBeenCalledWith('p1');
    expect(out.action).toBe('detect');
    expect(out.result.summary.total).toBe(3);
  });

  it('getSchemaValidation parses valid JSON and validates it', async () => {
    const validate = jest.fn().mockReturnValue({ ok: true, validity: 'valid' });
    const { tools } = build({ schema: { validate } });
    const out: any = await (tools.getSchemaValidation as any).execute({
      jsonld: '{"@type":"FAQPage"}',
    });
    expect(validate).toHaveBeenCalledWith({ '@type': 'FAQPage' });
    expect(out.validation.ok).toBe(true);
  });

  it('getSchemaValidation reports a parse error without calling validate', async () => {
    const validate = jest.fn();
    const { tools } = build({ schema: { validate } });
    const out: any = await (tools.getSchemaValidation as any).execute({
      jsonld: '{not json',
    });
    expect(validate).not.toHaveBeenCalled();
    expect(out.validation.ok).toBe(false);
    expect(out.validation.parseError).toBeTruthy();
  });

  it('runSchemaQc delegates to the qc service with siteId from closure', async () => {
    const qcFn = jest.fn().mockResolvedValue({ summary: { inSync: 1, issues: 0 } });
    const { tools } = build({ qc: { qc: qcFn } });
    const out: any = await (tools.runSchemaQc as any).execute({ pageId: 'p1' });
    expect(qcFn).toHaveBeenCalledWith('site-1', 'p1');
    expect(out.action).toBe('qc');
  });
});

describe('createSchemaTools — generation', () => {
  it('analyzeSchemas returns a schema_proposal with the AI proposals', async () => {
    const analyze = jest.fn().mockResolvedValue({ proposals: [{ id: 'pr1', kind: 'add' }] });
    const { tools } = build({ ai: { analyze } });
    const out: any = await (tools.analyzeSchemas as any).execute({ pageId: 'p1' });
    expect(analyze).toHaveBeenCalledWith('site-1', 'p1');
    expect(out.type).toBe('schema_proposal');
    expect(out.action).toBe('schema_proposals');
    expect(out.proposals).toHaveLength(1);
  });
});

describe('createSchemaTools — additive mutations', () => {
  it('addManagedSchema parses jsonld and calls createManaged', async () => {
    const createManaged = jest
      .fn()
      .mockResolvedValue({ id: 'm1', type: 'FAQPage', validationStatus: 'valid' });
    const { tools } = build({ schema: { createManaged } });
    const out: any = await (tools.addManagedSchema as any).execute({
      pageId: 'p1',
      type: 'FAQPage',
      jsonld: '{"@type":"FAQPage"}',
      rationale: 'because FAQ section',
    });
    expect(createManaged).toHaveBeenCalledWith('site-1', 'p1', {
      type: 'FAQPage',
      jsonld: { '@type': 'FAQPage' },
      aiRationale: 'because FAQ section',
    });
    expect(out.type).toBe('schema_result');
    expect(out.action).toBe('schema_added');
    expect(out.schemaId).toBe('m1');
  });

  it('addManagedSchema returns an error result on invalid JSON (no service call)', async () => {
    const createManaged = jest.fn();
    const { tools } = build({ schema: { createManaged } });
    const out: any = await (tools.addManagedSchema as any).execute({
      pageId: 'p1',
      type: 'FAQPage',
      jsonld: '{bad',
      rationale: null,
    });
    expect(createManaged).not.toHaveBeenCalled();
    expect(out.action).toBe('schema_add_failed');
    expect(out.error).toContain('Invalid JSON');
  });

  it('editManagedSchema updates type only when jsonld is null', async () => {
    const updateManaged = jest
      .fn()
      .mockResolvedValue({ id: 'm1', type: 'Article', validationStatus: 'valid' });
    const { tools } = build({ schema: { updateManaged } });
    const out: any = await (tools.editManagedSchema as any).execute({
      schemaId: 'm1',
      type: 'Article',
      jsonld: null,
    });
    expect(updateManaged).toHaveBeenCalledWith('m1', { type: 'Article' });
    expect(out.action).toBe('schema_edited');
  });
});

describe('createSchemaTools — destructive (confirmation cards, never execute)', () => {
  it('removeManagedSchema returns a confirm card and does NOT mutate', async () => {
    const { tools } = build();
    const out: any = await (tools.removeManagedSchema as any).execute({
      pageId: 'p1',
      schemaId: 'm1',
      schemaType: 'FAQPage',
    });
    expect(out.type).toBe('schema_confirm');
    expect(out.action).toBe('remove_schema');
    expect(out.siteId).toBe('site-1');
    expect(out.schemaId).toBe('m1');
  });

  it('applySchemas returns a confirm card with the pending count', async () => {
    const pendingChanges = jest.fn().mockResolvedValue({ pending: 2 });
    const { tools } = build({ schema: { pendingChanges } });
    const out: any = await (tools.applySchemas as any).execute({ pageId: 'p1' });
    expect(out.type).toBe('schema_confirm');
    expect(out.action).toBe('apply_schemas');
    expect(out.pending).toBe(2);
  });

  it('unpublishSchemas returns a confirm card', async () => {
    const { tools } = build();
    const out: any = await (tools.unpublishSchemas as any).execute({ pageId: 'p1' });
    expect(out.type).toBe('schema_confirm');
    expect(out.action).toBe('unpublish_schemas');
    expect(out.pageId).toBe('p1');
  });
});
