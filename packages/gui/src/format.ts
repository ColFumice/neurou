import type { IREffect, LExpr, Value, WorldIR } from '@neurou/core';

/** 把图里的表达式还原成人话，供力迫弹层/力迫层使用。 */
export function formatExpr(world: WorldIR, e: LExpr): string {
  switch (e.k) {
    case 'const':
      return formatValue(e.v);
    case 'read':
      return nameOf(world, e.id);
    case 'un':
      return e.op === '非' ? `非 ${formatExpr(world, e.e)}` : `${e.op}${formatExpr(world, e.e)}`;
    case 'bin': {
      const l = e.l.k === 'bin' ? `(${formatExpr(world, e.l)})` : formatExpr(world, e.l);
      const r = e.r.k === 'bin' ? `(${formatExpr(world, e.r)})` : formatExpr(world, e.r);
      return `${l} ${e.op} ${r}`;
    }
    case 'call':
      return `${e.fn}(${e.args.map((a) => formatExpr(world, a)).join(', ')})`;
  }
}

export function formatEffect(world: WorldIR, e: IREffect): string {
  if (e.k === 'apply') {
    const name = e.chord.replace(/^chord:/, '');
    return `施加 和弦「${name}」`;
  }
  const name = nameOf(world, e.id);
  const op = e.k === 'set' ? '=' : e.k === 'add' ? '+=' : '-=';
  return `${name} ${op} ${formatExpr(world, e.value)}`;
}

export function nameOf(world: WorldIR, id: string): string {
  const s = world.strings.find((x) => x.id === id);
  return s ? s.id : id;
}

function formatValue(v: Value): string {
  if (Array.isArray(v)) return `{${v.join(', ')}}`;
  if (typeof v === 'boolean') return v ? '真' : '假';
  if (v === null) return '空';
  return String(v);
}
