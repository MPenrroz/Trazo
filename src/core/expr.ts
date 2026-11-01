// Evaluador de fórmulas seguro (sin eval) para medidas paramétricas: "ancho + 2*t", "baranda ? 300 : 0", "floor(l / paso)".

export type Scope = Record<string, number>;

const FN: Record<string, (...a: number[]) => number> = {
  min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt,
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180),
};
const CONST: Scope = { pi: Math.PI };

type Tok = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  const re = /\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_áéíóúñÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]*)|(<=|>=|==|!=|&&|\|\||[-+*/%()?:<>,!]))/gy;
  let m: RegExpExecArray | null;
  let i = 0;
  while (i < src.length) {
    re.lastIndex = i;
    if (/^\s*$/.test(src.slice(i))) break;
    m = re.exec(src);
    if (!m) throw new Error(`símbolo no válido cerca de "${src.slice(i).trim().slice(0, 8)}"`);
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'id', v: m[2] });
    else out.push({ k: 'op', v: m[3] });
    i = re.lastIndex;
  }
  return out;
}

/** Evalúa una fórmula. Booleanos: verdadero = 1, falso = 0. Lanza Error con mensaje en español. */
export function evalExpr(src: string | number, scope: Scope): number {
  if (typeof src === 'number') return src;
  const toks = tokenize(String(src));
  if (!toks.length) throw new Error('fórmula vacía');
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === 'op' && peek()!.v === v;
  const opv = (): string => { const t = toks[p++]; return t && t.k === 'op' ? t.v : ''; };
  const eat = (v: string) => { if (!isOp(v)) throw new Error(`se esperaba "${v}"`); p++; };

  const ternary = (): number => {
    const c = or();
    if (isOp('?')) { p++; const a = ternary(); eat(':'); const b = ternary(); return c ? a : b; }
    return c;
  };
  const or = (): number => { let a = and(); while (isOp('||')) { p++; const b = and(); a = a || b ? 1 : 0; } return a; };
  const and = (): number => { let a = cmp(); while (isOp('&&')) { p++; const b = cmp(); a = a && b ? 1 : 0; } return a; };
  const cmp = (): number => {
    let a = add();
    while (peek()?.k === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(String(peek()!.v))) {
      const o = opv(), b = add();
      a = (o === '<' ? a < b : o === '>' ? a > b : o === '<=' ? a <= b : o === '>=' ? a >= b : o === '==' ? Math.abs(a - b) < 1e-9 : Math.abs(a - b) >= 1e-9) ? 1 : 0;
    }
    return a;
  };
  const add = (): number => {
    let a = mul();
    while (isOp('+') || isOp('-')) { const o = opv(); const b = mul(); a = o === '+' ? a + b : a - b; }
    return a;
  };
  const mul = (): number => {
    let a = unary();
    while (isOp('*') || isOp('/') || isOp('%')) {
      const o = opv(), b = unary();
      if ((o === '/' || o === '%') && b === 0) throw new Error('división por cero');
      a = o === '*' ? a * b : o === '/' ? a / b : a % b;
    }
    return a;
  };
  const unary = (): number => {
    if (isOp('-')) { p++; return -unary(); }
    if (isOp('+')) { p++; return unary(); }
    if (isOp('!')) { p++; return unary() ? 0 : 1; }
    return primary();
  };
  const primary = (): number => {
    const t = toks[p++];
    if (!t) throw new Error('fórmula incompleta');
    if (t.k === 'num') return t.v;
    if (t.k === 'op' && t.v === '(') { const v = ternary(); eat(')'); return v; }
    if (t.k === 'id') {
      if (isOp('(')) {
        const fn = FN[t.v.toLowerCase()];
        if (!fn) throw new Error(`función desconocida "${t.v}"`);
        p++;
        const args: number[] = [];
        if (!isOp(')')) { args.push(ternary()); while (isOp(',')) { p++; args.push(ternary()); } }
        eat(')');
        return fn(...args);
      }
      if (t.v in scope) return scope[t.v];
      if (t.v in CONST) return CONST[t.v];
      throw new Error(`"${t.v}" no es un parámetro`);
    }
    throw new Error(`"${t.v}" fuera de lugar`);
  };
  const v = ternary();
  if (p < toks.length) throw new Error(`sobra "${String(toks[p].v)}"`);
  if (!Number.isFinite(v)) throw new Error('resultado no numérico');
  return v;
}
