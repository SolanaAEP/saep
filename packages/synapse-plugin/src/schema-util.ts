import type { z } from 'zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const def = (schema as z.ZodObject<z.ZodRawShape>)._def;
  const shape = def && 'shape' in def && typeof def.shape === 'function' ? def.shape() : {};
  const properties: Record<string, { type: string; description?: string }> = {};
  const required: string[] = [];

  for (const [key, val] of Object.entries(shape as Record<string, z.ZodTypeAny>)) {
    properties[key] = { type: inferType(val) };
    if (!val.isOptional()) required.push(key);
  }

  return { type: 'object', properties, required };
}

function inferType(val: z.ZodTypeAny): string {
  const typeName = (val._def as { typeName?: string }).typeName ?? '';
  if (typeName.includes('Number')) return 'number';
  if (typeName.includes('Boolean')) return 'boolean';
  if (typeName.includes('Array')) return 'array';
  if (typeName.includes('Object')) return 'object';
  return 'string';
}
