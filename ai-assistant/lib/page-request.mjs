const materialFields = {
  type: 'string',
  purpose: 'string',
  material: 'string',
  description: 'string',
  manufacturer: 'string',
  partNo: 'string',
  dimensionMm: 'string',
  weightKg: 'number',
  unitPrice: 'number',
  minimumOrderQuantity: 'number',
  orderMeasurement: 'string',
  packaging: 'string',
  source: 'string',
};

export async function answerPageRequest(adapter, { prompt, page, catalog }) {
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 12000 ||
      typeof page !== 'string' || page.length > 200 ||
      (catalog !== undefined && (typeof catalog !== 'string' || catalog.length > 100))) {
    throw Error('Invalid page assistant request');
  }

  const properties = Object.fromEntries(Object.entries(materialFields).map(([key, type]) => [
    key, { type: key === 'type' ? type : [type, 'null'] },
  ]));
  const response = await adapter.analyze({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['answer', 'materials'],
      properties: {
        answer: { type: 'string' },
        materials: {
          type: 'array',
          items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
        },
      },
    },
    input: [
      { role: 'developer', content: [{ type: 'input_text', text:
        'Answer in the language of the user. The application supplies trusted page and catalog context. ' +
        'You have no access to live records. Never claim any changes were made. ' +
        'Return materials only for an explicit instruction to add new items to the supplied catalog. ' +
        'Use type as the item name. Copy only supplied material facts, keep identifiers exact, ' +
        'Map orderMeasurement to pcs, pack or meters and packaging to m, Package, Box, Drum or pcs. ' +
        'Set source only to an exact http:// or https:// link supplied in the user message. Use null for document names, vendor names, and missing links. ' +
        'Use null for unknown optional fields. Combine neither different items nor different part numbers. ' +
        'If any requested row is ambiguous, unnamed, destined for another catalog, or the batch exceeds 25 items, ' +
        'return an empty materials array and explain what is needed. ' +
        'For questions, examples, requests to modify existing items, and when no catalog is supplied, return an empty array.' }] },
      { role: 'developer', content: [{ type: 'input_text', text: JSON.stringify({ page, catalog }) }] },
      { role: 'user', content: [{ type: 'input_text', text: prompt }] },
    ],
  });
  return {
    answer: response.analysis.answer.trim().slice(0, 4000),
    materials: catalog ? response.analysis.materials : [],
  };
}