import fs from 'node:fs';

const source = fs.readFileSync(new URL('../sdk/7.130.0/viewer3D.min.js', import.meta.url), 'utf8');
export function sdkDeclaration(signature, after = 0) {
  const start = source.indexOf(signature, after);
  if (start < 0) throw new Error(`Pinned SDK declaration missing: ${signature}`);
  const open = source.indexOf('{', start);
  let depth = 1,
    end = open + 1;
  for (; depth && end < source.length; end++) {
    if (source[end] === '{') depth++;
    else if (source[end] === '}') depth--;
  }
  if (depth) throw new Error(`Unbalanced SDK declaration: ${signature}`);
  return source.slice(start, end);
}

// Execute the installed SDK's real tree builder/storage/access/tree classes.
// Only log sinks and immutable enum values are supplied by this offline harness.
const enumText =
  'const Pm={NODE_TYPE_ASSEMBLY:0,NODE_TYPE_INSERT:1,NODE_TYPE_LAYER:2,NODE_TYPE_COLLECTION:3,NODE_TYPE_COMPOSITE:4,NODE_TYPE_MODEL:5,NODE_TYPE_GEOMETRY:6,NODE_TYPE_BITS:7};';
if (!source.includes(enumText)) throw new Error('Pinned object-tree node kinds changed.');
const declarations = [
  sdkDeclaration('function eo('),
  sdkDeclaration('function Zs('),
  sdkDeclaration('function Bm('),
  sdkDeclaration('function Em('),
  sdkDeclaration('class Mm{'),
  sdkDeclaration('class Tm{'),
  sdkDeclaration('class Im{'),
  enumText,
  'const Sm={LEAF_OBJECT:0,FIRST_OBJECT:1,LAST_OBJECT:2};const Lm=1073741824,Dm=2147483648,Um=4096,Fm=new Array(6);',
  sdkDeclaration('function Rm('),
  sdkDeclaration('class Om{'),
  sdkDeclaration('function*TL('),
  sdkDeclaration('class BL{'),
].join('\n');
export const nativeTreeSdk = Function(
  'ni',
  declarations + '\nreturn {ObjectTreeBuilder:BL,ObjectTree:Om};',
)({
  warn() {},
  error: (message) => {
    throw new Error(message);
  },
});
export const nativeSetObjectTree = Function(
  'Hp',
  'ni',
  `return ({${sdkDeclaration('setObjectTree(e){')}}).setObjectTree;`,
)('object-tree-created', { warn() {} });
export const nativeSetDbId = Function(`return ({${sdkDeclaration('setDbId(e,t=0)')}}).setDbId;`)();
export const nativeFragmentIds = Function(
  `return ({${sdkDeclaration('_dbIdToInstanceIds(e){')}})._dbIdToInstanceIds;`,
)();
export const sdkSource = source;
