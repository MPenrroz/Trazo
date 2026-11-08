#! python3
# -*- coding: utf-8 -*-
"""
Trazo -> Rhino 8 / Grasshopper
==============================

Reconstruye un producto Trazo a partir de su especificación (`*.trazo-spec.json`,
pestaña Exportar) con los MISMOS generadores paramétricos de la app web, para
seguir trabajando en Rhino (uniones, cantos, herrajes) sin perder los parámetros.

Uso en Rhino 8
--------------
  1. Comando `ScriptEditor` -> abrir este archivo -> Run (o `_-RunPythonScript`).
  2. Elegir el .trazo-spec.json. Se crean capas `Trazo::<rol>` con sólidos y UserText.
  3. Para regenerar con otros valores, vuelve a correrlo: pregunta si sobrescribir parámetros.

Uso en Grasshopper (componente "Python 3 Script")
-------------------------------------------------
  Entradas:  spec (str, ruta al json)   overrides (list[str], ej. "w=1500", "n=6")
  Salidas:   breps, names, roles, report
  Conecta sliders a un panel con "w={0}" (Format) para variar parámetros en vivo.
  Así el producto queda listo para ShapeDiver / Rhino.Compute (tienda con Grasshopper).

Unidades: milímetros. Z arriba.
"""
import json
import math

import Rhino.Geometry as rg

TOL = 0.01


# --------------------------------------------------------------------------- geometría
def rect(w, h):
    return [(0, 0), (w, 0), (w, h), (0, h)]


def box_part(pid, name, role, material, o, size, axis):
    dx, dy, dz = size
    if axis == "z":
        return dict(id=pid, name=name, role=role, material=material, thickness=dz,
                    plane=dict(o=o, x=(1, 0, 0), y=(0, 1, 0)), profile=rect(dx, dy))
    if axis == "x":
        return dict(id=pid, name=name, role=role, material=material, thickness=dx,
                    plane=dict(o=o, x=(0, 1, 0), y=(0, 0, 1)), profile=rect(dy, dz))
    return dict(id=pid, name=name, role=role, material=material, thickness=dy,
                plane=dict(o=o, x=(0, 0, 1), y=(1, 0, 0)), profile=rect(dz, dx))


def poly_area(pts):
    return sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(pts, pts[1:] + pts[:1])) / 2.0


# --------------------------------------------------------------------------- plantillas (espejo de src/core/templates.ts)
DEFAULT_PROFILE = [(0, 0), (60, 0), (80, 380), (360, 400), (380, 0), (440, 0), (430, 450), (10, 450)]


def build_estanteria(v, mat, profile=None):
    W, H, D, T = float(v["w"]), float(v["h"]), float(v["d"]), float(v["t"])
    n, cols = int(round(float(v["n"]))), max(1, int(round(float(v["cols"]))))
    plinth, back = float(v["plinth"]), bool(v["back"])
    bt = T if back else 0.0
    inner_w, d_shelf = W - 2 * T, D - bt
    P = [box_part("lat-izq", "Lateral izquierdo", "Lateral", mat, (0, 0, 0), (T, D, H), "x"),
         box_part("lat-der", "Lateral derecho", "Lateral", mat, (W - T, 0, 0), (T, D, H), "x"),
         box_part("techo", "Techo", "Cubierta", mat, (T, 0, H - T), (inner_w, D, T), "z"),
         box_part("base", "Base", "Base", mat, (T, 0, plinth), (inner_w, D, T), "z")]
    if plinth > 0:
        P.append(box_part("zocalo", "Zócalo", "Zócalo", mat, (T, T, 0), (inner_w, T, plinth), "y"))
    col_w = (inner_w - (cols - 1) * T) / cols
    z0, z1 = plinth + T, H - T
    for c in range(1, cols):
        x = T + c * col_w + (c - 1) * T
        P.append(box_part("div-%d" % c, "División %d" % c, "División", mat, (x, 0, z0), (T, d_shelf, z1 - z0), "x"))
    gap = (z1 - z0 - n * T) / (n + 1)
    for c in range(cols):
        x = T + c * (col_w + T)
        for i in range(1, n + 1):
            z = z0 + i * gap + (i - 1) * T
            P.append(box_part("rep-%d-%d" % (c + 1, i), "Repisa %d.%d" % (c + 1, i), "Repisa", mat, (x, 0, z), (col_w, d_shelf, T), "z"))
    if back:
        P.append(box_part("fondo", "Fondo", "Fondo", mat, (T, D - bt, plinth + T), (inner_w, bt, H - plinth - 2 * T), "y"))
    return P


def build_mesa(v, mat, profile=None):
    L, A, H, T = float(v["l"]), float(v["a"]), float(v["h"]), float(v["t"])
    inset, beam = float(v["inset"]), float(v["beam"])
    leg_h, leg_w = H - T, A - 2 * min(inset / 2.0, 80)
    y0 = (A - leg_w) / 2.0
    P = [box_part("cubierta", "Cubierta", "Cubierta", mat, (0, 0, leg_h), (L, A, T), "z"),
         box_part("pata-1", "Pata izquierda", "Pata", mat, (inset, y0, 0), (T, leg_w, leg_h), "x"),
         box_part("pata-2", "Pata derecha", "Pata", mat, (L - inset - T, y0, 0), (T, leg_w, leg_h), "x")]
    if beam > 0:
        bl = L - 2 * inset - 2 * T
        P.append(box_part("travesano", "Travesaño", "Travesaño", mat, (inset + T, A / 2.0 - T / 2.0, leg_h - beam), (bl, T, beam), "y"))
    return P


def build_costillas(v, mat, profile=None):
    L, n, T = float(v["l"]), max(1, int(round(float(v["n"])))), float(v["t"])
    s, slats = float(v["scale"]) / 100.0, int(round(float(v["slats"])))
    raw = [tuple(p) for p in (profile if profile and len(profile) >= 3 else DEFAULT_PROFILE)]
    if poly_area(raw) < 0:
        raw.reverse()
    x0, y0 = min(p[0] for p in raw), min(p[1] for p in raw)
    prof = [((x - x0) * s, (y - y0) * s) for x, y in raw]
    pw, ph = max(p[0] for p in prof), max(p[1] for p in prof)
    span = (max(L, n * T) - T) / (n - 1) if n > 1 else 0
    P = [dict(id="cost-%d" % (i + 1), name="Costilla %d" % (i + 1), role="Costilla", material=mat, thickness=T,
              plane=dict(o=(i * span, 0, 0), x=(0, 1, 0), y=(0, 0, 1)), profile=prof) for i in range(n)]
    if n > 1 and slats > 0:
        total, sw = (n - 1) * span + T, 60.0
        for k in range(slats):
            y = pw * (k + 1) / (slats + 1) - sw / 2
            P.append(box_part("larg-%d" % (k + 1), "Larguero %d" % (k + 1), "Larguero", mat, (0, y, ph), (total, sw, T), "z"))
    return P


def build_nicho(v, mat, profile=None):
    T, H, D, P = float(v["t"]), float(v["h"]), float(v["d"]), float(v["plinth"])
    libr, cojin = bool(v["libr"]), bool(v["cojin"])
    wb = float(v["wb"]) if libr else 0.0
    n = max(4, int(round(float(v["list"]))))
    gd = max(0.0, min(float(v.get("gd", 6)), T - 6))
    ts, foam, margin = T, 40.0, 80.0
    lip, clr = (15.0 if gd > 0 else 0.0), 0.5
    Hb = H - P
    R = min(float(v["ws"]) / 2.0, Hb - T - lip - ts - 30)
    Rs = R + lip
    Ls = 2 * R + 2 * margin
    L = T + Ls + T + (wb if libr else 0)
    cx = T + Ls / 2.0
    arc = [(cx + R * math.cos(-math.pi * i / 36.0), Hb + R * math.sin(-math.pi * i / 36.0)) for i in range(37)]
    prof = [(0, 0), (L, 0), (L, Hb)] + arc + [(0, Hb)]

    # ranura curva en la cara interior de los costados (anillo que cubre la banda de los listones)
    r_in, r_out = Rs * math.cos(math.pi / (2 * n)) - clr, Rs + ts + 1 + clr
    groove = [(cx + r_out * math.cos(math.pi + math.pi * i / 48.0), Hb + r_out * math.sin(math.pi + math.pi * i / 48.0)) for i in range(49)]
    groove += [(cx + r_in * math.cos(2 * math.pi - math.pi * i / 48.0), Hb + r_in * math.sin(2 * math.pi - math.pi * i / 48.0)) for i in range(49)]

    def side(pid, name, y, face):
        d = dict(id=pid, name=name, role="Costado", material=mat, thickness=T,
                 plane=dict(o=(0, y, P), x=(1, 0, 0), y=(0, 0, 1)), profile=prof)
        if gd > 0:
            d["pockets"] = [dict(name="Ranura curva listones", outline=groove, depth=gd, face=face)]
        return d

    P_ = [side("costado-frente", "Costado frontal", T, "base"), side("costado-tras", "Costado trasero", D, "top")]
    yi, di = T, D - 2 * T
    P_.append(box_part("cabezal", "Cabezal izquierdo", "Cabezal", mat, (0, yi, P), (T, di, Hb), "x"))
    P_.append(box_part("base", "Base", "Base", mat, (T, yi, P), (L - T - (0 if libr else T), di, T), "z"))
    if libr:
        x0 = T + Ls
        P_.append(box_part("division", "División librero", "División", mat, (x0, yi, P + T), (T, di, Hb - T), "x"))
        P_.append(box_part("techo-libr", "Techo librero", "Cubierta", mat, (x0 + T, yi, H - T), (wb, di, T), "z"))
        zr = P + T + (Hb - 2 * T) / 2.0 - T / 2.0
        P_.append(box_part("repisa-libr", "Repisa librero", "Repisa", mat, (x0 + T, yi, zr), (wb, di, T), "z"))
    else:
        P_.append(box_part("cabezal-der", "Cabezal derecho", "Cabezal", mat, (L - T, yi, P), (T, di, Hb), "x"))
    if P > 0:
        r = 40.0
        P_.append(box_part("zoc-frente", "Zócalo frontal", "Zócalo", mat, (r, r, 0), (L - 2 * r, T, P), "y"))
        P_.append(box_part("zoc-tras", "Zócalo trasero", "Zócalo", mat, (r, D - r - T, 0), (L - 2 * r, T, P), "y"))
        P_.append(box_part("zoc-izq", "Zócalo izquierdo", "Zócalo", mat, (r, r + T, 0), (T, D - 2 * r - 2 * T, P), "x"))
        P_.append(box_part("zoc-der", "Zócalo derecho", "Zócalo", mat, (L - r - T, r + T, 0), (T, D - 2 * r - 2 * T, P), "x"))

    ext = gd - clr if gd > 0 else 0.0

    def facets(rad, prefix, name, role, material, thick, process=None, extend=0.0):
        for i in range(n):
            a0, a1 = math.pi + math.pi * i / n, math.pi + math.pi * (i + 1) / n
            A = (cx + rad * math.cos(a0), H + rad * math.sin(a0))
            B = (cx + rad * math.cos(a1), H + rad * math.sin(a1))
            w = math.hypot(B[0] - A[0], B[1] - A[1])
            part = dict(id="%s-%d" % (prefix, i + 1), name="%s %d" % (name, i + 1), role=role, material=material,
                        thickness=thick, plane=dict(o=(A[0], yi - extend, A[1]), x=(0, 1, 0), y=((B[0] - A[0]) / w, 0, (B[1] - A[1]) / w)),
                        profile=rect(di + 2 * extend, w))
            if process:
                part["process"] = process
            P_.append(part)

    facets(Rs, "liston", "Listón", "Listón asiento", mat, ts, extend=ext)
    if cojin:
        facets(Rs - foam, "cojin", "Cojín", "Cojín", "tapiz", foam, "tapiz")
    return P_


TEMPLATES = {"estanteria": build_estanteria, "mesa": build_mesa, "costillas": build_costillas, "nicho": build_nicho}


# --------------------------------------------------------------------------- diseño libre (espejo de src/core/expr.ts y free.ts)
import re as _re

_TOK = _re.compile(r"\s*(?:(\d+(?:\.\d+)?|\.\d+)|([A-Za-z_áéíóúñÁÉÍÓÚÑ][\wáéíóúñÁÉÍÓÚÑ]*)|(<=|>=|==|!=|&&|\|\||[-+*/%()?:<>,!]))")
_FN = {"min": min, "max": max, "round": lambda x: math.floor(x + 0.5), "floor": math.floor, "ceil": math.ceil,
       "abs": abs, "sqrt": math.sqrt, "sin": lambda d: math.sin(math.radians(d)), "cos": lambda d: math.cos(math.radians(d))}


def eval_expr(src, scope):
    """Evalúa una fórmula de Trazo (sin eval de Python). Verdadero = 1, falso = 0."""
    if isinstance(src, (int, float)):
        return float(src)
    toks, i, src = [], 0, str(src)
    while i < len(src):
        if not src[i:].strip():
            break
        m = _TOK.match(src, i)
        if not m:
            raise ValueError("símbolo no válido cerca de '%s'" % src[i:].strip()[:8])
        toks.append(("num", float(m.group(1))) if m.group(1) else ("id", m.group(2)) if m.group(2) else ("op", m.group(3)))
        i = m.end()
    pos = [0]

    def peek():
        return toks[pos[0]] if pos[0] < len(toks) else (None, None)

    def is_op(v):
        return peek() == ("op", v)

    def take():
        t = peek(); pos[0] += 1; return t

    def ternary():
        c = orr()
        if is_op("?"):
            take(); a = ternary()
            if not is_op(":"):
                raise ValueError("se esperaba ':'")
            take(); b = ternary()
            return a if c else b
        return c

    def orr():
        a = andd()
        while is_op("||"):
            take(); b = andd(); a = 1.0 if (a or b) else 0.0
        return a

    def andd():
        a = cmp()
        while is_op("&&"):
            take(); b = cmp(); a = 1.0 if (a and b) else 0.0
        return a

    def cmp():
        a = add()
        while peek()[0] == "op" and peek()[1] in ("<", ">", "<=", ">=", "==", "!="):
            o = take()[1]; b = add()
            a = 1.0 if {"<": a < b, ">": a > b, "<=": a <= b, ">=": a >= b, "==": abs(a - b) < 1e-9, "!=": abs(a - b) >= 1e-9}[o] else 0.0
        return a

    def add():
        a = mul()
        while is_op("+") or is_op("-"):
            o = take()[1]; b = mul(); a = a + b if o == "+" else a - b
        return a

    def mul():
        a = unary()
        while is_op("*") or is_op("/") or is_op("%"):
            o = take()[1]; b = unary()
            if o in "/%" and b == 0:
                raise ValueError("división por cero")
            a = a * b if o == "*" else a / b if o == "/" else math.fmod(a, b)
        return a

    def unary():
        if is_op("-"):
            take(); return -unary()
        if is_op("+"):
            take(); return unary()
        if is_op("!"):
            take(); return 0.0 if unary() else 1.0
        return primary()

    def primary():
        k, v = take()
        if k == "num":
            return v
        if (k, v) == ("op", "("):
            r = ternary()
            if not is_op(")"):
                raise ValueError("se esperaba ')'")
            take(); return r
        if k == "id":
            if is_op("("):
                fn = _FN.get(v.lower())
                if not fn:
                    raise ValueError("función desconocida '%s'" % v)
                take(); args = []
                if not is_op(")"):
                    args.append(ternary())
                    while is_op(","):
                        take(); args.append(ternary())
                take()
                return float(fn(*args))
            if v in scope:
                return float(scope[v])
            if v == "pi":
                return math.pi
            raise ValueError("'%s' no es un parámetro" % v)
        raise ValueError("fórmula incompleta" if k is None else "'%s' fuera de lugar" % v)

    r = ternary()
    if pos[0] < len(toks):
        raise ValueError("sobra '%s'" % toks[pos[0]][1])
    return r


def _keep_hole(hh, w, h, size):
    """Calado sin deformar: centro estirado con la pieza, forma escalada uniformemente (espejo de keepHole)."""
    if not size or size[0] <= 0 or size[1] <= 0:
        return [(u * w, v * h) for u, v in hh]
    us, vs = [p[0] for p in hh], [p[1] for p in hh]
    cu, cv = (min(us) + max(us)) / 2.0, (min(vs) + max(vs)) / 2.0
    s = min(w / size[0], h / size[1])
    return [(cu * w + (u - cu) * size[0] * s, cv * h + (v - cv) * size[1] * s) for u, v in hh]


def _corners(pts, closed=True, deg=50.0):
    """Esquinas automáticas: el contorno gira más que `deg` grados (espejo de corners en curve.ts)."""
    n = len(pts)
    out = []
    for i, p in enumerate(pts):
        if not closed and (i == 0 or i == n - 1):
            out.append(True); continue
        a, c = pts[(i - 1) % n], pts[(i + 1) % n]
        t1 = math.atan2(p[1] - a[1], p[0] - a[0])
        t2 = math.atan2(c[1] - p[1], c[0] - p[0])
        turn = abs(t2 - t1) * 180.0 / math.pi
        if turn > 180:
            turn = 360 - turn
        out.append(turn > deg)
    return out


def to_beziers(pts, closed=True):
    """Tramos Bézier cúbicos de la curva suave que pasa por los puntos (Catmull-Rom con esquinas). Espejo de toBeziers."""
    n = len(pts)
    if n < 2:
        return []
    cor = _corners(pts, closed)
    P = (lambda i: pts[i % n]) if closed else (lambda i: pts[max(0, min(n - 1, i))])
    out = []
    for i in range(n if closed else n - 1):
        p1, p2 = P(i), P(i + 1)
        m1 = (p2[0] - p1[0], p2[1] - p1[1]) if cor[i % n] else ((p2[0] - P(i - 1)[0]) / 2.0, (p2[1] - P(i - 1)[1]) / 2.0)
        m2 = (p2[0] - p1[0], p2[1] - p1[1]) if cor[(i + 1) % n] else ((P(i + 2)[0] - p1[0]) / 2.0, (P(i + 2)[1] - p1[1]) / 2.0)
        out.append((p1, (p1[0] + m1[0] / 3.0, p1[1] + m1[1] / 3.0), (p2[0] - m2[0] / 3.0, p2[1] - m2[1] / 3.0), p2))
    return out


def _plane_for(orient, x, y, z, t):
    if orient == "XZ":
        return dict(o=(x, y + t, z), x=(1, 0, 0), y=(0, 0, 1))
    if orient == "YZ":
        return dict(o=(x, y, z), x=(0, 1, 0), y=(0, 0, 1))
    return dict(o=(x, y, z), x=(1, 0, 0), y=(0, 1, 0))


def build_libre(values, spec, errors=None):
    """Diseño libre: piezas definidas por fórmulas sobre los parámetros (`t`, `i`, `n` incluidos)."""
    errors = [] if errors is None else errors
    scope = {k: (1.0 if v is True else 0.0 if v is False else float(v)) for k, v in values.items()}
    shapes = spec.get("shapes") or {}
    mat = spec.get("materialId", "")
    P_ = []
    for c in (spec.get("free") or {}).get("components", []):
        try:
            if c.get("when", "").strip() and not eval_expr(c["when"], scope):
                continue
            n = int(round(eval_expr(c.get("count") or "1", scope)))
            for i in range(n):
                s = dict(scope, i=i, n=n)
                w, h, t, x, y, z = [eval_expr(c[k], s) for k in ("w", "h", "t", "x", "y", "z")]
                if w <= 0 or h <= 0 or t <= 0:
                    errors.append("%s: medidas deben ser > 0" % c["name"]); break
                outline, holes, curves = rect(w, h), [], None
                sh = shapes.get(c["shape"]) if c["shape"] != "rect" else None
                if sh:
                    # "tamaño desde el dibujo": la pieza mide lo que mide la silueta (cotas en mm reales)
                    if c.get("fit") == "sketch" and sh.get("size") and sh["size"][0] > 0 and sh["size"][1] > 0:
                        w, h = float(sh["size"][0]), float(sh["size"][1])
                    outline = [(u * w, v * h) for u, v in sh["outline"]]
                    if c.get("holes", True):
                        holes = [_keep_hole(hh, w, h, sh.get("size")) for hh in sh["holes"]]
                    # curvas suaves: los puntos son puntos de paso de una curva exacta (NURBS)
                    hsm = [bool((sh.get("holesSmooth") or [])[j]) if j < len(sh.get("holesSmooth") or []) else False for j in range(len(holes))]
                    if sh.get("smooth") or any(hsm):
                        curves = {"outline": outline if sh.get("smooth") else None, "holes": [hh if hsm[j] else None for j, hh in enumerate(holes)]}
                kind = c.get("kind", "tablero")
                part = dict(id=c["id"] if n == 1 else "%s-%d" % (c["id"], i + 1), name=c["name"] if n == 1 else "%s %d" % (c["name"], i + 1),
                            role=c.get("role") or c["name"], material=mat if kind == "tablero" else kind, thickness=t,
                            plane=_plane_for(c["orient"], x, y, z, t), profile=outline)
                if holes:
                    part["holes"] = holes
                if curves:
                    part["curves"] = curves
                if kind != "tablero":
                    part["process"] = kind
                P_.append(part)
        except ValueError as e:
            errors.append("%s: %s" % (c.get("name", "?"), e))
    return P_


# --------------------------------------------------------------------------- parámetros
def clamp(d, raw):
    t = d["type"]
    if t == "bool":
        return raw in (True, "true", "1", 1, "True")
    if t == "choice":
        opts = [o["value"] for o in d.get("options", [])]
        for o in opts:
            if str(o) == str(raw):
                return o
        return d["default"]
    try:
        x = float(raw)
    except (TypeError, ValueError):
        x = float(d["default"])
    if d.get("min") is not None:
        x = max(d["min"], x)
    if d.get("max") is not None:
        x = min(d["max"], x)
    if d.get("step"):
        mn = d.get("min") or 0
        x = round((x - mn) / d["step"]) * d["step"] + mn
    return int(round(x)) if t == "int" else x


def resolve(spec, overrides=None):
    vals = dict(spec.get("defaults", {}))
    for item in overrides or []:
        if "=" in str(item):
            k, val = str(item).split("=", 1)
            vals[k.strip()] = val.strip()
    return {d["key"]: clamp(d, vals.get(d["key"], d["default"])) for d in spec["params"]}


def build(spec, overrides=None):
    values = resolve(spec, overrides)
    if spec["template"] == "libre":
        return build_libre(values, spec), values
    fn = TEMPLATES.get(spec["template"], build_estanteria)
    return fn(values, spec.get("materialId", ""), spec.get("profile")), values


# --------------------------------------------------------------------------- RhinoCommon
def part_brep(p):
    pl = p["plane"]
    plane = rg.Plane(rg.Point3d(*pl["o"]), rg.Vector3d(*pl["x"]), rg.Vector3d(*pl["y"]))

    def crv(pts):
        P = [plane.PointAt(u, v) for u, v in pts]
        P.append(P[0])
        return rg.PolylineCurve(P)

    def smooth(pts):
        """NURBS grado 3 exacta: tramos Bézier unidos con nudos triples."""
        bz = to_beziers(pts, True)
        cps = [bz[0][0]] + [q for b in bz for q in b[1:]]
        nc = rg.NurbsCurve(3, False, 4, len(cps))
        for i, (u, v) in enumerate(cps):
            nc.Points.SetPoint(i, plane.PointAt(u, v))
        for k in range(len(bz) + 1):
            for j in range(3):
                nc.Knots[3 * k + j] = float(k)
        return nc

    cv = p.get("curves") or {}
    hc = cv.get("holes") or []
    curves = [smooth(cv["outline"]) if cv.get("outline") else crv(p["profile"])]
    curves += [smooth(hc[j]) if j < len(hc) and hc[j] else crv(h) for j, h in enumerate(p.get("holes") or [])]
    planar = rg.Brep.CreatePlanarBreps(curves, TOL)
    if not planar:
        return None
    T = float(p["thickness"])
    path = rg.LineCurve(plane.Origin, plane.Origin + plane.ZAxis * T)
    solid = planar[0].Faces[0].CreateExtrusion(path, True)
    # cajeados: se resta el volumen de cada ranura (con 1 mm extra hacia afuera para un corte limpio)
    for k in p.get("pockets") or []:
        d = float(k["depth"])
        w0, w1 = (-1.0, d) if k["face"] == "base" else (T - d, T + 1.0)
        pk = rg.Brep.CreatePlanarBreps([crv(k["outline"])], TOL)
        if not pk:
            continue
        pk[0].Translate(plane.ZAxis * w0)
        o0 = plane.Origin + plane.ZAxis * w0
        tool = pk[0].Faces[0].CreateExtrusion(rg.LineCurve(o0, o0 + plane.ZAxis * (w1 - w0)), True)
        res = rg.Brep.CreateBooleanDifference(solid, tool, TOL) if tool else None
        if res:
            solid = res[0]
    return solid


def report(parts, values):
    lines = ["%d piezas" % len(parts)]
    lines += ["%s = %s" % (k, v) for k, v in values.items()]
    return "\n".join(lines)


def run_grasshopper(spec_path, overrides):
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    parts, values = build(spec, overrides)
    breps = [part_brep(p) for p in parts]
    return breps, [p["name"] for p in parts], [p["role"] for p in parts], report(parts, values)


def run_rhino():
    import Rhino
    import rhinoscriptsyntax as rs
    import scriptcontext as sc

    path = rs.OpenFileName("Especificación Trazo", "Trazo spec (*.json)|*.json||")
    if not path:
        return
    with open(path, "r", encoding="utf-8") as f:
        spec = json.load(f)
    overrides = []
    if rs.GetString("¿Modificar parámetros? (s/n)", "n", ["s", "n"]) == "s":
        for d in spec["params"]:
            cur = spec["defaults"].get(d["key"], d["default"])
            rng = " [%s–%s]" % (d.get("min"), d.get("max")) if d["type"] in ("number", "int") else ""
            val = rs.GetString("%s%s" % (d["label"], rng), str(cur))
            if val is not None:
                overrides.append("%s=%s" % (d["key"], val))
    parts, values = build(spec, overrides)
    root = "Trazo"
    if not rs.IsLayer(root):
        rs.AddLayer(root)
    sc.doc.Strings.SetString("trazo:proyecto", spec.get("name", ""))
    for k, v in values.items():
        sc.doc.Strings.SetString("trazo:param:%s" % k, str(v))
    for p in parts:
        layer = "%s::%s%s" % (root, "Referencia::" if p.get("process") == "ref" else "", p["role"])
        if not rs.IsLayer(layer):
            rs.AddLayer(layer)
        b = part_brep(p)
        if b is None:
            print("No se pudo crear %s" % p["name"])
            continue
        attr = Rhino.DocObjects.ObjectAttributes()
        attr.LayerIndex = sc.doc.Layers.FindByFullPath(layer, -1)
        attr.Name = p["name"]
        attr.SetUserString("trazo:rol", p["role"])
        attr.SetUserString("trazo:espesor_mm", str(p["thickness"]))
        attr.SetUserString("trazo:material", str(p["material"]))
        sc.doc.Objects.AddBrep(b, attr)
    sc.doc.Views.Redraw()
    print("Trazo: %s" % report(parts, values).replace("\n", " · "))


if "ghenv" in globals():
    # Componente Grasshopper: variables de entrada `spec` y `overrides`
    breps, names, roles, report = run_grasshopper(spec, overrides if "overrides" in globals() else [])  # noqa: F821
elif __name__ == "__main__":
    run_rhino()
