import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from '../schema-util.js';

describe('zodToJsonSchema', () => {
  it('converts simple object schema', () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect(json.required).toEqual(['name', 'age', 'active']);
    const props = json.properties as Record<string, { type: string }>;
    expect(props.name.type).toBe('string');
    expect(props.age.type).toBe('number');
    expect(props.active.type).toBe('boolean');
  });

  it('marks optional fields as not required', () => {
    const schema = z.object({
      required_field: z.string(),
      optional_field: z.string().optional(),
    });
    const json = zodToJsonSchema(schema);
    expect(json.required).toEqual(['required_field']);
  });

  it('detects array type', () => {
    const schema = z.object({
      items: z.array(z.number()),
    });
    const json = zodToJsonSchema(schema);
    const props = json.properties as Record<string, { type: string }>;
    expect(props.items.type).toBe('array');
  });
});
