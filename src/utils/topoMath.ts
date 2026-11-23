import Delaunator from 'delaunator';

export function parseOptionalFloat(val: string | number | null | undefined): number | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parseFloatSafe(val: string | number | null | undefined): number {
  const res = parseOptionalFloat(val);
  return res !== null ? res : 0.0;
}

export function roundTo(val: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round((val + Number.EPSILON) * factor) / factor;
}

export function mod360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

export function gmsParaDec(g: string | number, m: string | number = 0, s: string | number = 0): number {
  const gVal = parseFloatSafe(g);
  const mVal = parseFloatSafe(m);
  const sVal = parseFloatSafe(s);
  const sinal = gVal < 0 || String(g).trim().startsWith('-') ? -1.0 : 1.0;
  return sinal * (Math.abs(gVal) + mVal / 60.0 + sVal / 3600.0);
}

export function decParaGmsTuple(decDeg: number, casasSeg = 1, wrap360 = true): [number, number, number] {
  const base = wrap360 ? mod360(decDeg) : Math.abs(decDeg);
  let g = Math.floor(base);
  const mFull = (base - g) * 60.0;
  let m = Math.floor(mFull);
  let s = roundTo((mFull - m) * 60.0, casasSeg);
  if (s >= 60.0) {
    s = 0.0;
    m += 1;
  }
  if (m >= 60) {
    m = 0;
    g = wrap360 ? (g + 1) % 360 : g + 1;
  }
  return [g, m, s];
}

export function decParaGmsStr(decDeg: number, casasSeg = 1, wrap360 = true): string {
  const [g, m, s] = decParaGmsTuple(decDeg, casasSeg, wrap360);
  const mStr = String(m).padStart(2, '0');
  if (Math.abs(s - Math.round(s)) < 1e-3) {
    return `${g}° ${mStr}' ${String(Math.round(s)).padStart(2, '0')}"`;
  }
  const sStr = s.toFixed(casasSeg).padStart(casasSeg + 3, '0');
  return `${g}° ${mStr}' ${sStr}"`;
}

export function decParaGmsAssinado(decDeg: number, casasSeg = 1): string {
  const prefix = decDeg < -1e-9 ? '-' : '';
  return prefix + decParaGmsStr(Math.abs(decDeg), casasSeg, false);
}

export function camposGms(decDeg: number, casasSeg = 4): [string, string, string] {
  const neg = decDeg < 0;
  const [g, m, s] = decParaGmsTuple(Math.abs(decDeg), casasSeg, false);
  const sClean = Number(s.toFixed(casasSeg)).toString();
  return [neg ? `-${g}` : String(g), String(m), sClean];
}

export function azimuteParaRumoDms(azDeg: number): string {
  const az = mod360(azDeg);
  let rumoVal: number;
  let quad: string;
  if (az >= 0 && az < 90) {
    rumoVal = az;
    quad = 'NE';
  } else if (az >= 90 && az < 180) {
    rumoVal = 180.0 - az;
    quad = 'SE';
  } else if (az >= 180 && az < 270) {
    rumoVal = az - 180.0;
    quad = 'SW';
  } else {
    rumoVal = 360.0 - az;
    quad = 'NW';
  }
  return `${decParaGmsStr(rumoVal)} ${quad}`;
}

export function areaGauss(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 3) return 0;
  let soma1 = 0;
  let soma2 = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    soma1 += x[i] * y[j];
    soma2 += y[i] * x[j];
  }
  return Math.abs(soma1 - soma2) / 2.0;
}

export function fmtDx(valor: number, casas: number): string {
  const v = Number(valor.toFixed(casas));
  const txt = Math.abs(v).toFixed(casas);
  const sufixo = v > 0 ? ' E' : v < 0 ? ' W' : '';
  return txt + sufixo;
}

export function fmtDy(valor: number, casas: number): string {
  const v = Number(valor.toFixed(casas));
  const txt = Math.abs(v).toFixed(casas);
  const sufixo = v > 0 ? ' N' : v < 0 ? ' S' : '';
  return txt + sufixo;
}

export function fmtXEw(valor: number, casas: number): string {
  const letra = valor >= 0 ? 'E' : 'W';
  return `${Math.abs(valor).toFixed(casas)} ${letra}`;
}

export function fmtYNs(valor: number, casas: number): string {
  const letra = valor >= 0 ? 'N' : 'S';
  return `${Math.abs(valor).toFixed(casas)} ${letra}`;
}

export function resolverFiosComAviso(
  fsIn: number,
  fmIn: number,
  fiIn: number
): { fs: number; fm: number; fi: number; msg: string | null } {
  let fs = fsIn;
  let fm = fmIn;
  let fi = fiIn;
  let msg: string | null = null;
  const informados = [fs, fm, fi].filter((f) => f > 0);
  if (informados.length === 2) {
    if (fs > 0 && fi > 0 && fm === 0) {
      fm = roundTo((fs + fi) / 2.0, 6);
      msg = `Fio Médio (FM) calculado automaticamente: FM = (FS + FI) / 2 = ${fm.toFixed(6)} m`;
    } else if (fs > 0 && fm > 0 && fi === 0) {
      fi = roundTo(2.0 * fm - fs, 6);
      msg = `Fio Inferior (FI) calculado automaticamente: FI = 2·FM - FS = ${fi.toFixed(6)} m`;
    } else if (fm > 0 && fi > 0 && fs === 0) {
      fs = roundTo(2.0 * fm - fi, 6);
      msg = `Fio Superior (FS) calculado automaticamente: FS = 2·FM - FI = ${fs.toFixed(6)} m`;
    }
  } else if (informados.length === 3 && fm === 0) {
    fm = roundTo((fs + fi) / 2.0, 6);
  }
  return { fs, fm, fi, msg };
}

export function validarAngulo(
  g: string,
  m: string,
  s: string,
  nome = 'ângulo'
): { value: number | null; error: string | null } {
  const campos = [String(g).trim(), String(m).trim(), String(s).trim()];
  if (!campos.some(Boolean)) {
    return {
      value: null,
      error: `Informe o ${nome} lido (digite 0 se a visada for na própria ré).`,
    };
  }
  for (const c of campos) {
    if (c && parseOptionalFloat(c) === null) {
      return {
        value: null,
        error: `Valor inválido no ${nome}: '${c}'. Use apenas números.`,
      };
    }
  }
  const mv = parseFloatSafe(m);
  const sv = parseFloatSafe(s);
  if (!(mv >= 0 && mv < 60) || !(sv >= 0 && sv < 60)) {
    return {
      value: null,
      error: `Minutos e segundos do ${nome} devem estar entre 0 e 59,999.`,
    };
  }
  return { value: gmsParaDec(g, m, s), error: null };
}

export function lerAnguloVertical(
  g: string,
  m: string,
  s: string,
  tipo: 'zenital' | 'alpha'
): { value: number | null; error: string | null } {
  if (!String(g).trim() && !String(m).trim() && !String(s).trim()) {
    return { value: tipo === 'zenital' ? 90.0 : 0.0, error: null };
  }
  return validarAngulo(g, m, s, 'ângulo vertical');
}

export function calcularDhFios(
  fs: number,
  fi: number,
  vDec: number,
  tipoAngV: 'zenital' | 'alpha'
): number {
  const z = tipoAngV === 'zenital' ? vDec : 90.0 - vDec;
  const sinZ = Math.sin((z * Math.PI) / 180.0);
  return 100.0 * (fs - fi) * sinZ * sinZ;
}

function segmentosSeCruzam(
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  p4: [number, number]
): boolean {
  const orient = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  return (
    orient(p1, p2, p3) * orient(p1, p2, p4) < 0 &&
    orient(p3, p4, p1) * orient(p3, p4, p2) < 0
  );
}

export function poligonoSeCruza(xs: number[], ys: number[]): boolean {
  const n = xs.length;
  if (n < 4) return false;
  const pts: [number, number][] = xs.map((x, i) => [x, ys[i]]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if ((i + 1) % n === j || (j + 1) % n === i) continue;
      if (segmentosSeCruzam(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) {
        return true;
      }
    }
  }
  return false;
}

export function calcularCorrecoesInteirasSec(
  erroAngularSec: number,
  angulosBrutosDec: number[]
): number[] {
  const n = angulosBrutosDec.length;
  if (n === 0) return [];

  const cTotal = Math.round(-erroAngularSec);
  const baseFlt = cTotal / n;

  let valMenor: number;
  let valMaior: number;
  let qtdMaior: number;

  if (cTotal >= 0) {
    valMenor = Math.floor(baseFlt);
    valMaior = valMenor + 1;
    qtdMaior = cTotal - valMenor * n;
  } else {
    valMaior = Math.ceil(baseFlt);
    valMenor = Math.floor(baseFlt);
    qtdMaior = cTotal - n * valMenor;
  }

  const indicesOrdenados = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => angulosBrutosDec[b] - angulosBrutosDec[a]
  );

  const correcoes = new Array<number>(n).fill(valMenor);
  if (cTotal >= 0) {
    for (let idx = 0; idx < n; idx++) {
      const origI = indicesOrdenados[idx];
      correcoes[origI] = idx < qtdMaior ? valMaior : valMenor;
    }
  } else {
    const qtdMaiorMod = n - qtdMaior;
    for (let idx = 0; idx < n; idx++) {
      const origI = indicesOrdenados[idx];
      correcoes[origI] = idx < qtdMaiorMod ? valMenor : valMaior;
    }
  }
  return correcoes;
}

export function formatarDescricaoCorrecaoAngular(correcoesSec: number[]): string {
  if (!correcoesSec.length) return 'Nenhuma correção aplicada.';
  const unicos = Array.from(new Set(correcoesSec)).sort((a, b) => b - a);
  if (unicos.length === 1) {
    const sinal = unicos[0] > 0 ? '+' : '';
    return `${sinal}${unicos[0]}" por vértice.`;
  }
  const maxVal = Math.max(...unicos);
  return unicos
    .map((val) => {
      const qtd = correcoesSec.filter((v) => v === val).length;
      const sinal = val > 0 ? '+' : '';
      return val === maxVal
        ? `${qtd} vértice(s) com ${sinal}${val}" (maiores ângulos)`
        : `${qtd} vértice(s) com ${sinal}${val}" (menores ângulos)`;
    })
    .join(' | ');
}

export function normalizePointName(nome: string | null | undefined): string {
  if (!nome) return '';
  let s = String(nome).trim().toUpperCase();
  if (s.includes('(')) {
    s = s.split('(')[0].trim();
  }
  return s;
}

// ============================================================================
// ALTIMETRIA — CADERNETA COMPOSTA
// ============================================================================

export interface LeituraCaderneta {
  id: number;
  estacao: string;
  ponto: string;
  re: number | null;
  vante_inter: number | null;
  vante_mudanca: number | null;
  ponto_ref_re: string;
}

export interface ResultadoLinhaCaderneta {
  idx: number;
  id: number;
  estacao: string;
  ponto: string;
  tipo: string;
  re: number | null;
  vante_inter: number | null;
  vante_mudanca: number | null;
  ai: number | null;
  cota: number | null;
}

export interface PontoPerfil {
  ponto: string;
  estacao: string;
  cota: number;
}

export interface RelatorioProvaCaderneta {
  cota_inicial: number;
  soma_re: number;
  soma_vante_mudanca: number;
  diff_visadas: number;
  diff_cotas: number;
  houve_mudanca: boolean;
  status: boolean;
  obs: string;
  cotas_mapa: Record<string, number>;
}

export function calcularCaderneta(
  dados: LeituraCaderneta[],
  cotaInicial: number
): {
  linhas: ResultadoLinhaCaderneta[];
  perfil: PontoPerfil[];
  prova: RelatorioProvaCaderneta | null;
} {
  if (!dados.length) {
    return { linhas: [], perfil: [], prova: null };
  }

  const linhas: ResultadoLinhaCaderneta[] = [];
  const perfil: PontoPerfil[] = [];
  const cotasCalculadas: Record<string, number> = {};

  let cotaReferencia = Number(cotaInicial);
  let aiAtual: number | null = null;
  let somaRe = 0.0;
  let somaVanteMudanca = 0.0;
  let cotaUltimaMudanca = Number(cotaInicial);
  let houveMudanca = false;

  dados.forEach((linha, idx) => {
    const pNorm = normalizePointName(linha.ponto);
    const temRe = linha.re !== null && Number.isFinite(linha.re);
    const temVi = linha.vante_inter !== null && Number.isFinite(linha.vante_inter);
    const temVm = linha.vante_mudanca !== null && Number.isFinite(linha.vante_mudanca);
    const pontoRefRe = (linha.ponto_ref_re || '').trim();

    let cotaPonto: number | null = null;
    let tipoLeitura = 'Intermediária';

    if (temRe) {
      if (pontoRefRe) {
        const refNorm = normalizePointName(pontoRefRe);
        if (refNorm in cotasCalculadas) {
          cotaReferencia = cotasCalculadas[refNorm];
        }
      } else if (pNorm in cotasCalculadas) {
        cotaReferencia = cotasCalculadas[pNorm];
      }
      aiAtual = cotaReferencia + Number(linha.re);
      somaRe += Number(linha.re);
      cotasCalculadas[pNorm] = cotaReferencia;
      cotaPonto = cotaReferencia;
      tipoLeitura = 'Ré (Início/Mudança)';
    }

    if (temVm && aiAtual !== null) {
      cotaPonto = aiAtual - Number(linha.vante_mudanca);
      cotaReferencia = cotaPonto;
      cotaUltimaMudanca = cotaPonto;
      somaVanteMudanca += Number(linha.vante_mudanca);
      houveMudanca = true;
      cotasCalculadas[pNorm] = cotaPonto;
      tipoLeitura = 'Vante de Mudança';
    } else if (temVi && aiAtual !== null) {
      cotaPonto = aiAtual - Number(linha.vante_inter);
      cotasCalculadas[pNorm] = cotaPonto;
      tipoLeitura = 'Vante Intermediária';
    }

    linhas.push({
      idx,
      id: linha.id,
      estacao: linha.estacao,
      ponto: linha.ponto,
      tipo: tipoLeitura,
      re: temRe ? Number(linha.re) : null,
      vante_inter: temVi ? Number(linha.vante_inter) : null,
      vante_mudanca: temVm ? Number(linha.vante_mudanca) : null,
      ai: aiAtual,
      cota: cotaPonto,
    });

    if (cotaPonto !== null) {
      perfil.push({
        ponto: linha.ponto,
        estacao: linha.estacao,
        cota: cotaPonto,
      });
    }
  });

  let diffVisadas = somaRe - somaVanteMudanca;
  let diffCotas = 0.0;
  let statusProva = true;
  let obsProva = 'Levantamento por estações com visadas intermediárias (sem vantes de mudança).';

  if (houveMudanca) {
    diffCotas = cotaUltimaMudanca - Number(cotaInicial);
    statusProva = Math.abs(diffVisadas - diffCotas) < 1e-4;
    obsProva =
      'Verificação entre estações de mudança (Σ Ré - Σ Vante Mudança = Cota Última Mudança - Cota Inicial).';
  }

  return {
    linhas,
    perfil,
    prova: {
      cota_inicial: Number(cotaInicial),
      soma_re: somaRe,
      soma_vante_mudanca: somaVanteMudanca,
      diff_visadas: diffVisadas,
      diff_cotas: diffCotas,
      houve_mudanca: houveMudanca,
      status: statusProva,
      obs: obsProva,
      cotas_mapa: cotasCalculadas,
    },
  };
}

// ============================================================================
// MALHA 3D, CURVAS DE NÍVEL & INTERPOLAÇÃO DE SUPERFÍCIE (DELAUNAY + GAUSS)
// ============================================================================

export interface PontoMalha {
  id: number;
  ponto: string;
  x: number;
  y: number;
  cota: number;
  tipo: 'grade' | 'borda' | 'vertice';
}

export interface ResultadoInterpolacaoTrecho {
  cotaCurva: number;
  distA: number;
  distB: number;
}

export function interpolarCurvasEntrePontos(
  cotaA: number,
  cotaB: number,
  dhAb: number,
  equidistancia: number
): ResultadoInterpolacaoTrecho[] {
  if (cotaA === cotaB || dhAb <= 0 || equidistancia <= 0) return [];
  const cMin = Math.min(cotaA, cotaB);
  const cMax = Math.max(cotaA, cotaB);
  const primeira = Math.ceil((cMin + 1e-9) / equidistancia) * equidistancia;
  const res: ResultadoInterpolacaoTrecho[] = [];
  for (let c = primeira; c < cMax - 1e-9; c += equidistancia) {
    const xDist = (dhAb * (c - cotaA)) / (cotaB - cotaA);
    res.push({
      cotaCurva: roundTo(c, 3),
      distA: roundTo(xDist, 3),
      distB: roundTo(dhAb - xDist, 3),
    });
  }
  return res;
}

export function obterPoligonoContorno(
  pontos: PontoMalha[],
  contornoPadrao: string[]
): [number, number][] | null {
  const mapa: Record<string, [number, number]> = {};
  for (const p of pontos) {
    mapa[normalizePointName(p.ponto)] = [p.x, p.y];
  }
  const coordsContorno: [number, number][] = [];
  for (const nome of contornoPadrao) {
    const key = normalizePointName(nome);
    if (key in mapa) {
      coordsContorno.push(mapa[key]);
    }
  }
  if (coordsContorno.length >= 4) {
    return coordsContorno;
  }

  // Convex hull fallback via angular sort of unique XY points
  const seen = new Set<string>();
  const uniq: [number, number][] = [];
  for (const p of pontos) {
    const k = `${p.x.toFixed(5)},${p.y.toFixed(5)}`;
    if (!seen.has(k)) {
      seen.add(k);
      uniq.push([p.x, p.y]);
    }
  }
  if (uniq.length < 3) return null;
  const cx = uniq.reduce((acc, v) => acc + v[0], 0) / uniq.length;
  const cy = uniq.reduce((acc, v) => acc + v[1], 0) / uniq.length;
  return uniq.sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
}

function pointToSegmentDistSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return (px - ax) * (px - ax) + (py - ay) * (py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  return (px - projX) * (px - projX) + (py - projY) * (py - projY);
}

function pointInPolygonWithRadius(
  px: number,
  py: number,
  poly: [number, number][],
  radius = 0.05
): boolean {
  const n = poly.length;
  let inside = false;
  const rSq = radius * radius;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (pointToSegmentDistSq(px, py, xj, yj, xi, yi) <= rSq) {
      return true;
    }
    const intersect = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function gaussianFilter2D(grid: number[][], sigma: number): number[][] {
  const rows = grid.length;
  const cols = grid[0].length;
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel: number[] = [];
  let sum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel.push(v);
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;

  // Horizontal pass
  const temp: number[][] = Array.from({ length: rows }, () => new Array<number>(cols));
  for (let r = 0; r < rows; r++) {
    const row = grid[r];
    const out = temp[r];
    for (let c = 0; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const cc = Math.max(0, Math.min(cols - 1, c + k));
        acc += row[cc] * kernel[k + radius];
      }
      out[c] = acc;
    }
  }

  // Vertical pass
  const res: number[][] = Array.from({ length: rows }, () => new Array<number>(cols));
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const rr = Math.max(0, Math.min(rows - 1, r + k));
        acc += temp[rr][c] * kernel[k + radius];
      }
      res[r][c] = acc;
    }
  }
  return res;
}

export interface MalhaInterpolada {
  xi: number[];
  yi: number[];
  ziMasked: (number | null)[][];
  polyVerts: [number, number][] | null;
  polyZ: number[] | null;
  niveis: number[];
  zMin: number;
  zMax: number;
  equidistancia: number;
}

export function prepararMalhaInterpolada(
  pontos: PontoMalha[],
  equidistancia: number,
  recortarContorno: boolean,
  contornoPadrao: string[],
  gridResolution = 140
): MalhaInterpolada | null {
  if (pontos.length < 3) return null;

  // Deduplicate exact identical XY points (averaging their elevation) for clean Delaunay triangulation
  const grouped = new Map<string, { x: number; y: number; sumZ: number; count: number }>();
  for (const p of pontos) {
    const key = `${p.x.toFixed(5)}_${p.y.toFixed(5)}`;
    const cur = grouped.get(key);
    if (cur) {
      cur.sumZ += p.cota;
      cur.count += 1;
    } else {
      grouped.set(key, { x: p.x, y: p.y, sumZ: p.cota, count: 1 });
    }
  }
  const uniqPts = Array.from(grouped.values()).map((g) => ({
    x: g.x,
    y: g.y,
    z: g.sumZ / g.count,
  }));

  const xs = uniqPts.map((p) => p.x);
  const ys = uniqPts.map((p) => p.y);
  const zs = uniqPts.map((p) => p.z);

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  if (uniqPts.length < 3 || maxX - minX < 1e-6 || maxY - minY < 1e-6) {
    return null;
  }

  const padX = (maxX - minX) * 0.03;
  const padY = (maxY - minY) * 0.03;
  const xStart = minX - padX;
  const xEnd = maxX + padX;
  const yStart = minY - padY;
  const yEnd = maxY + padY;

  const xi: number[] = Array.from(
    { length: gridResolution },
    (_, i) => xStart + ((xEnd - xStart) * i) / (gridResolution - 1)
  );
  const yi: number[] = Array.from(
    { length: gridResolution },
    (_, i) => yStart + ((yEnd - yStart) * i) / (gridResolution - 1)
  );

  const dxStep = (xEnd - xStart) / (gridResolution - 1);
  const dyStep = (yEnd - yStart) / (gridResolution - 1);

  const ziLinear: number[][] = Array.from({ length: gridResolution }, () =>
    new Array<number>(gridResolution).fill(NaN)
  );

  const delaunay = Delaunator.from(uniqPts.map((p) => [p.x, p.y]));
  const tris = delaunay.triangles;

  for (let t = 0; t < tris.length; t += 3) {
    const i0 = tris[t];
    const i1 = tris[t + 1];
    const i2 = tris[t + 2];
    const x0 = xs[i0],
      y0 = ys[i0],
      z0 = zs[i0];
    const x1 = xs[i1],
      y1 = ys[i1],
      z1 = zs[i1];
    const x2 = xs[i2],
      y2 = ys[i2],
      z2 = zs[i2];

    const denom = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2);
    if (Math.abs(denom) < 1e-12) continue;

    const cMin = Math.max(0, Math.floor((Math.min(x0, x1, x2) - xStart) / dxStep));
    const cMax = Math.min(gridResolution - 1, Math.ceil((Math.max(x0, x1, x2) - xStart) / dxStep));
    const rMin = Math.max(0, Math.floor((Math.min(y0, y1, y2) - yStart) / dyStep));
    const rMax = Math.min(gridResolution - 1, Math.ceil((Math.max(y0, y1, y2) - yStart) / dyStep));

    for (let r = rMin; r <= rMax; r++) {
      const py = yi[r];
      for (let c = cMin; c <= cMax; c++) {
        const px = xi[c];
        const w0 = ((y1 - y2) * (px - x2) + (x2 - x1) * (py - y2)) / denom;
        if (w0 < -1e-7) continue;
        const w1 = ((y2 - y0) * (px - x2) + (x0 - x2) * (py - y2)) / denom;
        if (w1 < -1e-7) continue;
        const w2 = 1.0 - w0 - w1;
        if (w2 < -1e-7) continue;
        ziLinear[r][c] = w0 * z0 + w1 * z1 + w2 * z2;
      }
    }
  }

  // Nearest-neighbor fill for cells outside the Delaunay convex hull
  for (let r = 0; r < gridResolution; r++) {
    const py = yi[r];
    for (let c = 0; c < gridResolution; c++) {
      if (Number.isNaN(ziLinear[r][c])) {
        const px = xi[c];
        let bestDist = Infinity;
        let bestZ = zs[0];
        for (let k = 0; k < uniqPts.length; k++) {
          const d = (px - xs[k]) * (px - xs[k]) + (py - ys[k]) * (py - ys[k]);
          if (d < bestDist) {
            bestDist = d;
            bestZ = zs[k];
          }
        }
        ziLinear[r][c] = bestZ;
      }
    }
  }

  const ziSmooth = gaussianFilter2D(ziLinear, 1.1);
  const polyVerts = obterPoligonoContorno(pontos, contornoPadrao);

  let ziMasked: (number | null)[][];
  if (recortarContorno && polyVerts && polyVerts.length >= 3) {
    ziMasked = ziSmooth.map((row, r) => {
      const py = yi[r];
      return row.map((val, c) =>
        pointInPolygonWithRadius(xi[c], py, polyVerts, 0.05) ? val : null
      );
    });
  } else {
    ziMasked = ziSmooth.map((row) => row.map((v) => v));
  }

  // Evaluate Z along perimeter contour for 3D rendering
  let polyZ: number[] | null = null;
  if (polyVerts && polyVerts.length >= 3) {
    polyZ = polyVerts.map(([px, py]) => {
      let bestDist = Infinity;
      let bestZ = zs[0];
      for (let k = 0; k < uniqPts.length; k++) {
        const d = (px - xs[k]) * (px - xs[k]) + (py - ys[k]) * (py - ys[k]);
        if (d < bestDist) {
          bestDist = d;
          bestZ = zs[k];
        }
      }
      return bestZ;
    });
  }

  const zMin = Math.min(...pontos.map((p) => p.cota));
  const zMax = Math.max(...pontos.map((p) => p.cota));
  const eq = Math.max(0.01, equidistancia);
  const zMinRound = Math.floor(zMin / eq) * eq;
  const zMaxRound = Math.ceil(zMax / eq) * eq;
  const niveis: number[] = [];
  for (let lv = zMinRound; lv <= zMaxRound + eq * 0.5; lv += eq) {
    niveis.push(roundTo(lv, 6));
  }

  return {
    xi,
    yi,
    ziMasked,
    polyVerts,
    polyZ,
    niveis,
    zMin,
    zMax,
    equidistancia: eq,
  };
}

// ============================================================================
// TERRAPLENAGEM — PERFIS TRANSVERSAIS, ÁREAS DE CORTE/ATERRO E VOLUMES
// ============================================================================

export interface SecaoBordaSupConfig {
  pontos: string[];
  y_limite: number;
  y_medio: number;
  nome: string;
}

export interface SecaoTerraplenagem {
  secao: string;
  yRef: number;
  pontos: string[];
  xCoords: number[];
  distancias: number[];
  cotas: number[];
  extensao: number;
  areaCorte: number;
  areaAterro: number;
}

export interface VolumeTrechoTerraplenagem {
  trecho: string;
  distancia: number;
  corteS1: number;
  corteS2: number;
  volCorte: number;
  aterroS1: number;
  aterroS2: number;
  volAterro: number;
}

export interface ResultadoTerraplenagem {
  cotaProjeto: number;
  secoes: SecaoTerraplenagem[];
  volumes: VolumeTrechoTerraplenagem[];
  volCorteTotal: number;
  volAterroTotal: number;
  diferencaVolumes: number;
}

export function calcularAreasSecaoTransversal(
  distancias: number[],
  cotasTerreno: number[],
  cotaProjeto: number
): { areaCorte: number; areaAterro: number } {
  let areaCorte = 0.0;
  let areaAterro = 0.0;

  for (let i = 0; i < distancias.length - 1; i++) {
    const d1 = distancias[i];
    const d2 = distancias[i + 1];
    const L = d2 - d1;
    if (L <= 1e-9) continue;

    const h1 = cotasTerreno[i] - cotaProjeto;
    const h2 = cotasTerreno[i + 1] - cotaProjeto;

    if (h1 >= 0 && h2 >= 0) {
      areaCorte += ((h1 + h2) / 2.0) * L;
    } else if (h1 <= 0 && h2 <= 0) {
      areaAterro += ((Math.abs(h1) + Math.abs(h2)) / 2.0) * L;
    } else {
      const L1 = (L * Math.abs(h1)) / (Math.abs(h1) + Math.abs(h2));
      const L2 = L - L1;
      if (h1 > 0) {
        areaCorte += (h1 * L1) / 2.0;
        areaAterro += (Math.abs(h2) * L2) / 2.0;
      } else {
        areaAterro += (Math.abs(h1) * L1) / 2.0;
        areaCorte += (h2 * L2) / 2.0;
      }
    }
  }
  return { areaCorte, areaAterro };
}

export function extrairSecoesTerraplenagem(
  malha: PontoMalha[],
  cotaProjeto: number,
  bordaSup: SecaoBordaSupConfig | null,
  rotulosSecoesY: Record<string, string>
): ResultadoTerraplenagem | null {
  if (!malha || malha.length < 3) return null;

  const nomesBorda = new Set(bordaSup ? bordaSup.pontos.map((n) => normalizePointName(n)) : []);
  const secoesMap = new Map<
    number,
    { nome: string; yRef: number; pontos: { ponto: string; x: number; y: number; cota: number }[] }
  >();

  for (const row of malha) {
    const pNorm = normalizePointName(row.ponto);
    const yVal = row.y;
    let chave: number;
    let nomeSecao: string;

    if (bordaSup && (nomesBorda.has(pNorm) || yVal > bordaSup.y_limite)) {
      chave = bordaSup.y_medio;
      nomeSecao = bordaSup.nome;
    } else {
      const ySnap = Math.round(yVal * 2.0) / 2.0;
      if (Math.abs(yVal - ySnap) > 0.25) continue;
      chave = ySnap;
      nomeSecao = rotulosSecoesY[String(ySnap)] || `Seção Y = ${ySnap.toFixed(2)} m`;
    }

    let sec = secoesMap.get(chave);
    if (!sec) {
      sec = { nome: nomeSecao, yRef: chave, pontos: [] };
      secoesMap.set(chave, sec);
    }
    if (!sec.pontos.some((p) => Math.abs(p.x - row.x) < 1e-4)) {
      sec.pontos.push({ ponto: row.ponto, x: row.x, y: row.y, cota: row.cota });
    }
  }

  const chavesOrdenadas = Array.from(secoesMap.keys()).sort((a, b) => a - b);
  const secoesOrdenadas: SecaoTerraplenagem[] = [];

  for (const chave of chavesOrdenadas) {
    const sec = secoesMap.get(chave)!;
    const ptsOrd = [...sec.pontos].sort((a, b) => a.x - b.x);
    if (ptsOrd.length < 2) continue;

    const xMin = ptsOrd[0].x;
    const dists = ptsOrd.map((p) => p.x - xMin);
    const cotas = ptsOrd.map((p) => p.cota);
    const nomes = ptsOrd.map((p) => p.ponto);
    const { areaCorte, areaAterro } = calcularAreasSecaoTransversal(dists, cotas, cotaProjeto);

    secoesOrdenadas.push({
      secao: sec.nome,
      yRef: sec.yRef,
      pontos: nomes,
      xCoords: ptsOrd.map((p) => p.x),
      distancias: dists,
      cotas,
      extensao: roundTo(dists[dists.length - 1], 3),
      areaCorte: roundTo(areaCorte, 4),
      areaAterro: roundTo(areaAterro, 4),
    });
  }

  if (!secoesOrdenadas.length) return null;

  const volumes: VolumeTrechoTerraplenagem[] = [];
  let volCorteTotal = 0.0;
  let volAterroTotal = 0.0;

  for (let i = 0; i < secoesOrdenadas.length - 1; i++) {
    const s1 = secoesOrdenadas[i];
    const s2 = secoesOrdenadas[i + 1];
    const dist = roundTo(s2.yRef - s1.yRef, 4);
    const vc = ((s1.areaCorte + s2.areaCorte) / 2.0) * dist;
    const va = ((s1.areaAterro + s2.areaAterro) / 2.0) * dist;
    volCorteTotal += vc;
    volAterroTotal += va;

    volumes.push({
      trecho: `${s1.secao.split(' (')[0]} → ${s2.secao.split(' (')[0]}`,
      distancia: dist,
      corteS1: s1.areaCorte,
      corteS2: s2.areaCorte,
      volCorte: roundTo(vc, 4),
      aterroS1: s1.areaAterro,
      aterroS2: s2.areaAterro,
      volAterro: roundTo(va, 4),
    });
  }

  return {
    cotaProjeto: Number(cotaProjeto),
    secoes: secoesOrdenadas,
    volumes,
    volCorteTotal: roundTo(volCorteTotal, 4),
    volAterroTotal: roundTo(volAterroTotal, 4),
    diferencaVolumes: roundTo(volAterroTotal - volCorteTotal, 4),
  };
}

export function encontrarCotaCompensacao(
  malha: PontoMalha[],
  bordaSup: SecaoBordaSupConfig | null,
  rotulosSecoesY: Record<string, string>
): number | null {
  if (!malha || malha.length < 3) return null;
  let lo = Math.min(...malha.map((p) => p.cota));
  let hi = Math.max(...malha.map((p) => p.cota));
  if (Math.abs(hi - lo) < 1e-6) return roundTo(lo, 4);

  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2.0;
    const res = extrairSecoesTerraplenagem(malha, mid, bordaSup, rotulosSecoesY);
    if (!res) return null;
    // diferencaVolumes = volAterro - volCorte
    // Higher plateau -> more fill (positive); lower plateau -> more cut (negative)
    if (res.diferencaVolumes > 0) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return roundTo((lo + hi) / 2.0, 4);
}
