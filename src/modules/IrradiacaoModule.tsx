import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Compass,
  Crosshair,
  Eye,
  FileSpreadsheet,
  Info,
  Layers,
  MapPin,
  Maximize2,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  areaGauss,
  azimuteParaRumoDms,
  calcularDhFios,
  camposGms,
  decParaGmsAssinado,
  decParaGmsStr,
  fmtDx,
  fmtDy,
  gmsParaDec,
  lerAnguloVertical,
  mod360,
  parseFloatSafe,
  parseOptionalFloat,
  poligonoSeCruza,
  resolverFiosComAviso,
  roundTo,
  validarAngulo,
} from '../utils/topoMath';
import { exportIrradiacaoExcel } from '../utils/excelExport';
import {
  AlertBanner,
  EmptyGuide,
  FormulaDrawer,
  FormulaItemSpec,
  Modal,
  PrecisionStepper,
  SectionDivider,
  SegmentedControl,
} from '../components/UIPrimitives';
import {
  getPlotTheme,
  PlotlyChart,
  PlotlyChartHandle,
  ThemeMode,
} from '../components/PlotlyChart';

interface IrradPoint {
  id: number;
  ponto: string;
  reId: number;
  reAzFixo: number;
  dh: number;
  angLidoDec: number;
  modoDh: 'direta' | 'fios';
  fs: number;
  fm: number;
  fi: number;
  g: number;
  vDec: number;
  tipoAngV: 'zenital' | 'alpha';
  modoDistDesc: string;
}

interface ComputedRow {
  orig: IrradPoint;
  reOrigem: string;
  reAz: number;
  azDec: number;
  azDms: string;
  rumoDms: string;
  dx: number;
  dy: number;
  x: number;
  y: number;
}

interface Props {
  theme: ThemeMode;
  onCountChange?: (count: number) => void;
}

const STORAGE_KEY = 'toposuite_irradiacao_v1';

const FORMULAS_IRRAD: FormulaItemSpec[] = [
  {
    title: 'Azimute Encadeado',
    equation: 'Az_ponto = (Az_ré + Ângulo_lido) mod 360°',
    description: 'Se a ré for o Norte, Az_ré = 0°. Se for outro ponto, herda dinamicamente o azimute dele.',
  },
  {
    title: 'Projeções Relativas',
    equation: 'ΔX = DH · sen(Az)  |  ΔY = DH · cos(Az)',
    description: 'ΔX positivo aponta para Leste (E) e negativo para Oeste (W). ΔY positivo aponta para Norte (N) e negativo para Sul (S).',
  },
  {
    title: 'Coordenadas Totais',
    equation: 'X = X0 + ΔX  |  Y = Y0 + ΔY',
    description: 'A partir da estação central E0(X0, Y0). Se X0/Y0 ficarem em branco, assume-se 1000,000 m.',
  },
  {
    title: 'Área por Gauss (Poligonal Fechada)',
    equation: 'S = |Σ(X_i · Y_{i+1}) − Σ(Y_i · X_{i+1})| / 2',
    description: 'Exige os vértices em ordem sequencial ao redor do perímetro (o sistema avisa automaticamente se houver cruzamento).',
  },
];

function lerCoordenada(texto: string, nome: string): { val: number; aviso: string | null } {
  const t = texto.trim();
  if (!t) return { val: 1000.0, aviso: `${nome} não informado: usando 1000 como padrão.` };
  const v = parseOptionalFloat(t);
  if (v === null) {
    return { val: 1000.0, aviso: `${nome} inválido ('${t}'): usando 1000 como padrão.` };
  }
  return { val: v, aviso: null };
}

function resolverBaseRe(
  pt: IrradPoint,
  all: IrradPoint[],
  visitados = new Set<number>()
): number {
  if (pt.reId === 0) return 0.0;
  if (pt.reId === -1) return pt.reAzFixo;
  const ref = all.find((p) => p.id === pt.reId);
  if (!ref || visitados.has(pt.id)) return pt.reAzFixo;
  const nextVis = new Set(visitados);
  nextVis.add(pt.id);
  return mod360(resolverBaseRe(ref, all, nextVis) + ref.angLidoDec);
}

function dependeDe(pt: IrradPoint, alvoId: number, all: IrradPoint[]): boolean {
  const visto = new Set<number>();
  let atual: IrradPoint | undefined = pt;
  while (atual && atual.reId > 0 && !visto.has(atual.id)) {
    visto.add(atual.id);
    if (atual.reId === alvoId) return true;
    atual = all.find((p) => p.id === atual!.reId);
  }
  return false;
}

export const IrradiacaoModule: React.FC<Props> = ({ theme, onCountChange }) => {
  const [x0Str, setX0Str] = useState<string>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').x0Str ?? '';
    } catch {
      return '';
    }
  });
  const [y0Str, setY0Str] = useState<string>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').y0Str ?? '';
    } catch {
      return '';
    }
  });
  const [tipoPoligonal, setTipoPoligonal] = useState<'fechada' | 'aberta'>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').tipoPoligonal ?? 'fechada';
    } catch {
      return 'fechada';
    }
  });
  const [pontos, setPontos] = useState<IrradPoint[]>(() => {
    try {
      const arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}').pontos;
      return Array.isArray(arr) ? arr : [];
    } catch {
      return [];
    }
  });

  const [casasDelta, setCasasDelta] = useState(4);
  const [casasCoord, setCasasCoord] = useState(4);
  const [showGuide, setShowGuide] = useState(false);

  // Form states
  const [reId, setReId] = useState<number>(0);
  const [nome, setNome] = useState<string>(() => `P${pontos.length + 1}`);
  const [modoDh, setModoDh] = useState<'direta' | 'fios'>('direta');
  const [dhStr, setDhStr] = useState('');
  const [fsStr, setFsStr] = useState('');
  const [fmStr, setFmStr] = useState('');
  const [fiStr, setFiStr] = useState('');
  const [tipoAngV, setTipoAngV] = useState<'zenital' | 'alpha'>('zenital');
  const [vG, setVG] = useState('');
  const [vM, setVM] = useState('');
  const [vS, setVS] = useState('');
  const [azG, setAzG] = useState('');
  const [azM, setAzM] = useState('');
  const [azS, setAzS] = useState('');

  const [statusMsg, setStatusMsg] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const [inspectRow, setInspectRow] = useState<ComputedRow | null>(null);

  // Edit modal state
  const [editId, setEditId] = useState<number | null>(null);
  const [edNome, setEdNome] = useState('');
  const [edReId, setEdReId] = useState(0);
  const [edModoDh, setEdModoDh] = useState<'direta' | 'fios'>('direta');
  const [edDh, setEdDh] = useState('');
  const [edFs, setEdFs] = useState('');
  const [edFm, setEdFm] = useState('');
  const [edFi, setEdFi] = useState('');
  const [edAzG, setEdAzG] = useState('');
  const [edAzM, setEdAzM] = useState('');
  const [edAzS, setEdAzS] = useState('');
  const [edTipoAngV, setEdTipoAngV] = useState<'zenital' | 'alpha'>('zenital');
  const [edVG, setEdVG] = useState('');
  const [edVM, setEdVM] = useState('');
  const [edVS, setEdVS] = useState('');
  const [edError, setEdError] = useState<string | null>(null);

  const chartRef = useRef<PlotlyChartHandle | null>(null);

  useEffect(() => {
    onCountChange?.(pontos.length);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ x0Str, y0Str, tipoPoligonal, pontos })
      );
    } catch {
      // ignore
    }
  }, [x0Str, y0Str, tipoPoligonal, pontos, onCountChange]);

  const computed = useMemo(() => {
    const cX = lerCoordenada(x0Str, 'X0');
    const cY = lerCoordenada(y0Str, 'Y0');
    const avisos: string[] = [];
    if (pontos.length > 0) {
      if (cX.aviso) avisos.push(cX.aviso);
      if (cY.aviso) avisos.push(cY.aviso);
    }

    const rows: ComputedRow[] = pontos.map((pt) => {
      const base = resolverBaseRe(pt, pontos);
      const azDec = mod360(base + pt.angLidoDec);
      const azRad = (azDec * Math.PI) / 180.0;
      const dx = roundTo(pt.dh * Math.sin(azRad), casasDelta);
      const dy = roundTo(pt.dh * Math.cos(azRad), casasDelta);
      const x = cX.val + dx;
      const y = cY.val + dy;

      let reOrigem = 'Norte';
      if (pt.reId > 0) {
        const ref = pontos.find((p) => p.id === pt.reId);
        reOrigem = ref
          ? `Ponto ${ref.ponto} (Az: ${decParaGmsStr(base)})`
          : `Ré fixa (Az: ${decParaGmsStr(base)})`;
      } else if (pt.reId === -1) {
        reOrigem = `Ré fixa (Az: ${decParaGmsStr(base)})`;
      }

      return {
        orig: pt,
        reOrigem,
        reAz: base,
        azDec,
        azDms: decParaGmsStr(azDec),
        rumoDms: azimuteParaRumoDms(azDec),
        dx,
        dy,
        x,
        y,
      };
    });

    const n = rows.length;
    const alinhamentos: { trecho: string; distancia: number }[] = [];
    const limite = tipoPoligonal === 'fechada' && n >= 3 ? n : Math.max(0, n - 1);
    for (let i = 0; i < limite; i++) {
      const a = rows[i];
      const b = rows[(i + 1) % n];
      alinhamentos.push({
        trecho: `${a.orig.ponto} → ${b.orig.ponto}`,
        distancia: Math.hypot(b.x - a.x, b.y - a.y),
      });
    }

    const perimetro = alinhamentos.reduce((acc, al) => acc + al.distancia, 0);
    const xPts = rows.map((r) => r.x);
    const yPts = rows.map((r) => r.y);
    const areaM2 = tipoPoligonal === 'fechada' && n >= 3 ? areaGauss(xPts, yPts) : null;

    if (tipoPoligonal === 'fechada' && n >= 4 && poligonoSeCruza(xPts, yPts)) {
      avisos.push(
        'Os lados do polígono se cruzam: os pontos parecem estar fora de ordem. A área (Gauss) depende da sequência dos vértices.'
      );
    }

    return { x0: cX.val, y0: cY.val, rows, alinhamentos, perimetro, areaM2, avisos };
  }, [x0Str, y0Str, tipoPoligonal, pontos, casasDelta]);

  const opcoesRe = useMemo(() => {
    const list: { label: string; value: number }[] = [{ label: 'Norte (0° 00\' 00")', value: 0 }];
    computed.rows.forEach((r) => {
      list.push({ label: `Ponto ${r.orig.ponto} (Az: ${r.azDms})`, value: r.orig.id });
    });
    return list;
  }, [computed.rows]);

  // Live preview of Azimuth & Rumo while typing
  const liveAzPreview = useMemo(() => {
    if (!azG.trim() && !azM.trim() && !azS.trim()) return null;
    const ang = gmsParaDec(azG, azM, azS);
    const refRow = computed.rows.find((r) => r.orig.id === reId);
    const base = refRow ? refRow.azDec : 0.0;
    const az = mod360(base + ang);
    return {
      azStr: decParaGmsStr(az),
      rumoStr: azimuteParaRumoDms(az),
    };
  }, [azG, azM, azS, reId, computed.rows]);

  const handleCarregarExemplo = () => {
    setX0Str('1000');
    setY0Str('1000');
    setTipoPoligonal('fechada');
    const ex: IrradPoint[] = [
      { id: 1, ponto: 'P1', reId: 0, reAzFixo: 0, dh: 34.5, angLidoDec: 32.25, modoDh: 'direta', fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDistDesc: 'Distância Horizontal Direta (DH)' },
      { id: 2, ponto: 'P2', reId: 0, reAzFixo: 0, dh: 41.2, angLidoDec: 124.5, modoDh: 'direta', fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDistDesc: 'Distância Horizontal Direta (DH)' },
      { id: 3, ponto: 'P3', reId: 0, reAzFixo: 0, dh: 38.8, angLidoDec: 215.75, modoDh: 'direta', fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDistDesc: 'Distância Horizontal Direta (DH)' },
      { id: 4, ponto: 'P4', reId: 0, reAzFixo: 0, dh: 36.1, angLidoDec: 308.15, modoDh: 'direta', fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDistDesc: 'Distância Horizontal Direta (DH)' },
    ];
    setPontos(ex);
    setNome('P5');
    setStatusMsg({
      variant: 'info',
      text: 'Exemplo de lote fechado por irradiação carregado (4 vértices a partir de E0 = 1000, 1000).',
    });
  };

  const handleAdicionar = (e: React.FormEvent) => {
    e.preventDefault();
    const angRes = validarAngulo(azG, azM, azS, 'ângulo horizontal');
    if (angRes.error || angRes.value === null) {
      setStatusMsg({ variant: 'danger', text: angRes.error || 'Ângulo horizontal inválido.' });
      return;
    }

    let dhVal = 0,
      fs = 0,
      fm = 0,
      fi = 0,
      g = 0,
      vDec = 90.0;
    let tipoV: 'zenital' | 'alpha' = 'zenital';
    let modoDesc = 'Distância Horizontal Direta (DH)';

    if (modoDh === 'direta') {
      const parsed = parseOptionalFloat(dhStr);
      if (parsed === null || parsed <= 0) {
        setStatusMsg({
          variant: 'danger',
          text: 'Digite uma Distância Horizontal (DH) válida maior que zero.',
        });
        return;
      }
      dhVal = parsed;
    } else {
      const rf = resolverFiosComAviso(
        parseFloatSafe(fsStr),
        parseFloatSafe(fmStr),
        parseFloatSafe(fiStr)
      );
      fs = rf.fs;
      fm = rf.fm;
      fi = rf.fi;
      if (fs <= 0 || fi <= 0 || fs <= fi) {
        setStatusMsg({
          variant: 'danger',
          text: 'Informe pelo menos 2 fios estadimétricos válidos (FS > FI).',
        });
        return;
      }
      tipoV = tipoAngV;
      const vRes = lerAnguloVertical(vG, vM, vS, tipoV);
      if (vRes.error || vRes.value === null) {
        setStatusMsg({ variant: 'danger', text: vRes.error || 'Ângulo vertical inválido.' });
        return;
      }
      vDec = vRes.value;
      g = fs - fi;
      dhVal = calcularDhFios(fs, fi, vDec, tipoV);
      if (dhVal <= 0) {
        setStatusMsg({
          variant: 'danger',
          text: 'Com esse ângulo vertical a distância horizontal resulta em zero.',
        });
        return;
      }
      modoDesc = 'Fios Estadimétricos (FS, FM, FI)';
    }

    const nomePt = nome.trim() || `P${pontos.length + 1}`;
    const novo: IrradPoint = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      ponto: nomePt,
      reId: opcoesRe.some((o) => o.value === reId) ? reId : 0,
      reAzFixo: 0,
      dh: dhVal,
      angLidoDec: angRes.value,
      modoDh,
      fs,
      fm,
      fi,
      g,
      vDec,
      tipoAngV: tipoV,
      modoDistDesc: modoDesc,
    };

    const next = [...pontos, novo];
    setPontos(next);
    const digits = nomePt.replace(/\D/g, '');
    setNome(digits ? `P${Number(digits) + 1}` : `P${next.length + 1}`);
    setDhStr('');
    setFsStr('');
    setFmStr('');
    setFiStr('');
    setAzG('');
    setAzM('');
    setAzS('');
    setVG('');
    setVM('');
    setVS('');
    setStatusMsg({ variant: 'success', text: `Ponto '${nomePt}' adicionado com sucesso.` });
  };

  const openEditModal = (pt: IrradPoint) => {
    setEditId(pt.id);
    setEdNome(pt.ponto);
    setEdReId(pt.reId);
    setEdModoDh(pt.modoDh);
    setEdDh(pt.modoDh === 'direta' ? pt.dh.toFixed(6) : '');
    setEdFs(pt.fs > 0 ? pt.fs.toFixed(6) : '');
    setEdFm(pt.fm > 0 ? pt.fm.toFixed(6) : '');
    setEdFi(pt.fi > 0 ? pt.fi.toFixed(6) : '');
    const [gh, mh, sh] = camposGms(pt.angLidoDec, 4);
    setEdAzG(gh);
    setEdAzM(mh);
    setEdAzS(sh);
    setEdTipoAngV(pt.tipoAngV);
    if (pt.modoDh === 'fios') {
      const [gv, mv, sv] = camposGms(pt.vDec, 4);
      setEdVG(gv);
      setEdVM(mv);
      setEdVS(sv);
    } else {
      setEdVG('');
      setEdVM('');
      setEdVS('');
    }
    setEdError(null);
  };

  const handleSaveEdit = () => {
    if (editId === null) return;
    const target = pontos.find((p) => p.id === editId);
    if (!target) return;

    const angRes = validarAngulo(edAzG, edAzM, edAzS, 'ângulo horizontal');
    if (angRes.error || angRes.value === null) {
      setEdError(angRes.error || 'Ângulo horizontal inválido.');
      return;
    }

    let dhVal = 0,
      fs = 0,
      fm = 0,
      fi = 0,
      g = 0,
      vDec = 90.0;
    let tipoV: 'zenital' | 'alpha' = 'zenital';
    let modoDesc = 'Distância Horizontal Direta (DH)';

    if (edModoDh === 'direta') {
      const parsed = parseOptionalFloat(edDh);
      if (parsed === null || parsed <= 0) {
        setEdError('Digite uma Distância Horizontal (DH) válida maior que zero.');
        return;
      }
      dhVal = parsed;
    } else {
      const rf = resolverFiosComAviso(
        parseFloatSafe(edFs),
        parseFloatSafe(edFm),
        parseFloatSafe(edFi)
      );
      fs = rf.fs;
      fm = rf.fm;
      fi = rf.fi;
      if (fs <= 0 || fi <= 0 || fs <= fi) {
        setEdError('Informe pelo menos 2 fios estadimétricos válidos (FS > FI).');
        return;
      }
      tipoV = edTipoAngV;
      const vRes = lerAnguloVertical(edVG, edVM, edVS, tipoV);
      if (vRes.error || vRes.value === null) {
        setEdError(vRes.error || 'Ângulo vertical inválido.');
        return;
      }
      vDec = vRes.value;
      g = fs - fi;
      dhVal = calcularDhFios(fs, fi, vDec, tipoV);
      if (dhVal <= 0) {
        setEdError('Com esse ângulo vertical a distância horizontal resulta em zero.');
        return;
      }
      modoDesc = 'Fios Estadimétricos (FS, FM, FI)';
    }

    const nomeFinal = edNome.trim() || target.ponto;
    setPontos((prev) =>
      prev.map((p) =>
        p.id === editId
          ? {
              ...p,
              ponto: nomeFinal,
              reId: edReId,
              reAzFixo: edReId === -1 ? p.reAzFixo : 0,
              dh: dhVal,
              angLidoDec: angRes.value!,
              modoDh: edModoDh,
              fs,
              fm,
              fi,
              g,
              vDec,
              tipoAngV: tipoV,
              modoDistDesc: modoDesc,
            }
          : p
      )
    );
    setEditId(null);
    setStatusMsg({ variant: 'success', text: `Ponto '${nomeFinal}' atualizado com sucesso.` });
  };

  const handleDelete = (id: number) => {
    const rowRem = computed.rows.find((r) => r.orig.id === id);
    if (!rowRem) return;
    const dependentes: string[] = [];
    const next = pontos
      .filter((p) => p.id !== id)
      .map((p) => {
        if (p.reId === id) {
          dependentes.push(p.ponto);
          return { ...p, reId: -1, reAzFixo: rowRem.azDec };
        }
        return p;
      });
    setPontos(next);
    if (reId === id) setReId(0);
    setNome(rowRem.orig.ponto);
    const extra = dependentes.length
      ? ` ${dependentes.join(', ')} usava(m) este ponto como ré e agora mantém ré fixa em Az ${rowRem.azDms}.`
      : '';
    setStatusMsg({ variant: 'info', text: `Ponto '${rowRem.orig.ponto}' removido.${extra}` });
  };

  const handleLimpar = () => {
    setPontos([]);
    setX0Str('');
    setY0Str('');
    setTipoPoligonal('fechada');
    setReId(0);
    setNome('P1');
    setModoDh('direta');
    setDhStr('');
    setFsStr('');
    setFmStr('');
    setFiStr('');
    setAzG('');
    setAzM('');
    setAzS('');
    setVG('');
    setVM('');
    setVS('');
    setStatusMsg({ variant: 'info', text: 'Estação central e pontos removidos.' });
  };

  const handleExportExcel = async () => {
    if (!computed.rows.length) return;
    const chartPng = await chartRef.current?.toPng(920, 680);
    await exportIrradiacaoExcel({
      x0: computed.x0,
      y0: computed.y0,
      tipo: tipoPoligonal,
      casasDelta,
      casasCoord,
      areaM2: computed.areaM2,
      perimetro: computed.perimetro,
      avisos: computed.avisos,
      tabela: computed.rows.map((r) => ({
        ponto: r.orig.ponto,
        reOrigem: r.reOrigem,
        angLidoStr: decParaGmsStr(r.orig.angLidoDec),
        azimuteDms: r.azDms,
        rumoDms: r.rumoDms,
        dh: r.orig.dh,
        dx: r.dx,
        dy: r.dy,
        x: r.x,
        y: r.y,
        modoDistDesc: r.orig.modoDistDesc,
        fs: r.orig.fs,
        fm: r.orig.fm,
        fi: r.orig.fi,
        g: r.orig.g,
        tipoAngVDesc: r.orig.tipoAngV === 'zenital' ? 'Zenital Z' : 'Inclinação α',
        angVStr: decParaGmsAssinado(r.orig.vDec),
      })),
      alinhamentos: computed.alinhamentos,
      chartPng,
    });
  };

  const chartSpec = useMemo(() => {
    const pt = getPlotTheme(theme);
    const traces: Record<string, unknown>[] = [];
    const { x0, y0, rows } = computed;
    const xs = rows.map((r) => r.x);
    const ys = rows.map((r) => r.y);
    const nomes = rows.map((r) => r.orig.ponto);

    const rayX: (number | null)[] = [];
    const rayY: (number | null)[] = [];
    rows.forEach((r) => {
      rayX.push(x0, r.x, null);
      rayY.push(y0, r.y, null);
    });
    if (rows.length) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: rayX,
        y: rayY,
        line: { color: pt.ray, dash: 'dot', width: 1.5 },
        name: 'Visada por Irradiação',
        hoverinfo: 'skip',
      });
    }

    if (rows.length >= 2) {
      if (tipoPoligonal === 'fechada' && rows.length >= 3) {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: [...xs, xs[0]],
          y: [...ys, ys[0]],
          fill: 'toself',
          fillcolor: pt.accentFill,
          line: { color: pt.accent, width: 2.4 },
          name: 'Poligonal Fechada',
        });
      } else {
        traces.push({
          type: 'scatter',
          mode: 'lines',
          x: xs,
          y: ys,
          line: { color: pt.accent, width: 2.4, dash: 'dash' },
          name: 'Poligonal Aberta',
        });
      }
    }

    traces.push({
      type: 'scatter',
      mode: 'markers+text',
      x: xs,
      y: ys,
      text: nomes.map(
        (nm, i) =>
          `${nm} (${xs[i].toFixed(Math.min(casasCoord, 2))}, ${ys[i].toFixed(Math.min(casasCoord, 2))})`
      ),
      textposition: 'top center',
      textfont: { size: 10.5, color: pt.text },
      marker: { size: 9, color: pt.accent, line: { color: pt.paperBg, width: 1.5 } },
      hovertemplate: '<b>%{text}</b><extra>Ponto Irradiado</extra>',
      name: 'Pontos Irradiados',
    });

    traces.push({
      type: 'scatter',
      mode: 'markers+text',
      x: [x0],
      y: [y0],
      text: [`E0 (${x0.toFixed(Math.min(casasCoord, 2))}, ${y0.toFixed(Math.min(casasCoord, 2))})`],
      textposition: 'bottom center',
      textfont: { size: 11, color: pt.danger },
      marker: {
        size: 12,
        color: pt.danger,
        symbol: 'diamond',
        line: { color: pt.paperBg, width: 1.5 },
      },
      name: 'Estação Central (E0)',
    });

    const allX = [...xs, x0];
    const allY = [...ys, y0];
    const xSpan = Math.max(Math.max(...allX) - Math.min(...allX), 1);
    const ySpan = Math.max(Math.max(...allY) - Math.min(...allY), 1);

    return {
      data: traces,
      layout: {
        title: {
          text: 'Planta Planimétrica por Irradiação',
          font: { size: 14.5, color: pt.title },
          y: 0.97,
        },
        paper_bgcolor: pt.paperBg,
        plot_bgcolor: pt.plotBg,
        font: { color: pt.text },
        hovermode: 'closest',
        xaxis: {
          title: { text: 'Coordenada X (m)', standoff: 10 },
          range: [Math.min(...allX) - xSpan * 0.18, Math.max(...allX) + xSpan * 0.18],
          gridcolor: pt.grid,
          zerolinecolor: pt.zeroLine,
        },
        yaxis: {
          title: { text: 'Coordenada Y (m)', standoff: 10 },
          range: [Math.min(...allY) - ySpan * 0.16, Math.max(...allY) + ySpan * 0.18],
          gridcolor: pt.grid,
          zerolinecolor: pt.zeroLine,
          scaleanchor: 'x',
          scaleratio: 1,
        },
        legend: {
          orientation: 'h',
          x: 0.5,
          xanchor: 'center',
          y: 1.02,
          yanchor: 'bottom',
          bgcolor: 'transparent',
          borderwidth: 0,
          font: { size: 11 },
        },
        margin: { l: 68, r: 28, t: 78, b: 58 },
      },
    };
  }, [computed, tipoPoligonal, theme, casasCoord]);

  const editReOptions = useMemo(() => {
    if (editId === null) return [];
    const target = pontos.find((p) => p.id === editId);
    if (!target) return [];
    const opts: { label: string; value: number }[] = [{ label: 'Norte (0° 00\' 00")', value: 0 }];
    computed.rows.forEach((r) => {
      if (r.orig.id === editId || dependeDe(r.orig, editId, pontos)) return;
      opts.push({ label: `Ponto ${r.orig.ponto} (Az: ${r.azDms})`, value: r.orig.id });
    });
    if (target.reId === -1) {
      opts.push({ label: `Ré fixa (Az: ${decParaGmsStr(target.reAzFixo)})`, value: -1 });
    }
    return opts;
  }, [editId, pontos, computed.rows]);

  return (
    <>
      <div className="module-header">
        <div className="module-title-group">
          <div className="module-icon-box">
            <Compass size={23} />
          </div>
          <div>
            <h1 className="module-title">Planimetria — Método da Irradiação</h1>
            <p className="module-desc">
              Determine coordenadas (X, Y), azimutes, rumos, distâncias entre vértices e área por Gauss a partir de uma estação central.
            </p>
          </div>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setShowGuide((v) => !v)}
          >
            <BookOpen size={15} />
            <span>{showGuide ? 'Ocultar Fórmulas' : 'Fórmulas & Guia'}</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleCarregarExemplo}>
            <Sparkles size={15} />
            <span>Carregar Exemplo</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleExportExcel}
            disabled={!computed.rows.length}
          >
            <FileSpreadsheet size={15} />
            <span>Excel</span>
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={handleLimpar}>
            <RotateCcw size={15} />
            <span>Limpar</span>
          </button>
        </div>
      </div>

      <FormulaDrawer
        open={showGuide}
        title="Guia Rápido & Fórmulas — Irradiação"
        summary="Configure a Estação Central E0(X0, Y0) e escolha se os pontos formam uma poligonal fechada (calcula área) ou aberta. Em seguida escolha a Ré de origem (Norte ou outro ponto já lançado) e informe o ângulo horizontal + distância."
        items={FORMULAS_IRRAD}
        onClose={() => setShowGuide(false)}
      />

      <SectionDivider icon={<Crosshair size={13} />} label="Entrada de Dados" />

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(280px, 1fr) minmax(0, 1.35fr)' }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <span className="step-chip">Passo 1</span>
              <span>Estação Central & Orientação</span>
            </h2>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>X0 Estação (m)</label>
              <input
                className="input mono"
                value={x0Str}
                onChange={(e) => setX0Str(e.target.value)}
                placeholder="Padrão: 1000"
              />
            </div>
            <div className="field">
              <label>Y0 Estação (m)</label>
              <input
                className="input mono"
                value={y0Str}
                onChange={(e) => setY0Str(e.target.value)}
                placeholder="Padrão: 1000"
              />
            </div>
          </div>

          <div className="field">
            <label>Tipo de Poligonal</label>
            <SegmentedControl
              value={tipoPoligonal}
              onChange={setTipoPoligonal}
              options={[
                { label: 'Poligonal Fechada', value: 'fechada' },
                { label: 'Poligonal Aberta', value: 'aberta' },
              ]}
            />
          </div>

          <div className="field">
            <label>Orientação / Ré (Ângulo Zerado em)</label>
            <select
              className="select"
              value={opcoesRe.some((o) => o.value === reId) ? reId : 0}
              onChange={(e) => setReId(Number(e.target.value))}
            >
              {opcoesRe.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
            <span className="helper-text">
              Você pode zerar o equipamento no Norte ou em qualquer ponto já visado — o azimute encadeado é atualizado automaticamente.
            </span>
          </div>
        </div>

        <form className="card" onSubmit={handleAdicionar}>
          <div className="card-header">
            <h2 className="card-title">
              <span className="step-chip">Passo 2</span>
              <span>Dados do Ponto Visado</span>
            </h2>
          </div>

          <div className="form-grid">
            <div className="field" style={{ maxWidth: 145 }}>
              <label>Nome do Ponto</label>
              <input
                className="input mono"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="P1"
              />
            </div>
            <div className="field">
              <label>Modo de Distância</label>
              <SegmentedControl
                value={modoDh}
                onChange={setModoDh}
                options={[
                  { label: 'DH Direta', value: 'direta' },
                  { label: 'Fios (FS / FM / FI)', value: 'fios' },
                ]}
              />
            </div>
          </div>

          {modoDh === 'direta' ? (
            <div className="field">
              <label>Distância Horizontal — DH (m)</label>
              <input
                className="input mono"
                value={dhStr}
                onChange={(e) => setDhStr(e.target.value)}
                placeholder="Ex: 32,450"
              />
            </div>
          ) : (
            <>
              <div className="form-grid">
                <div className="field">
                  <label>FS (m)</label>
                  <input className="input mono" value={fsStr} onChange={(e) => setFsStr(e.target.value)} />
                </div>
                <div className="field">
                  <label>FM (m)</label>
                  <input className="input mono" value={fmStr} onChange={(e) => setFmStr(e.target.value)} placeholder="Auto" />
                </div>
                <div className="field">
                  <label>FI (m)</label>
                  <input className="input mono" value={fiStr} onChange={(e) => setFiStr(e.target.value)} />
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Ângulo Vertical (opcional)</label>
                  <SegmentedControl
                    value={tipoAngV}
                    onChange={setTipoAngV}
                    options={[
                      { label: 'Zenital (Z)', value: 'zenital' },
                      { label: 'Inclinação (α)', value: 'alpha' },
                    ]}
                  />
                </div>
                <div className="field">
                  <label>Leitura Vertical (G° M&apos; S&quot;)</label>
                  <div className="gms-group">
                    <input className="input mono" value={vG} onChange={(e) => setVG(e.target.value)} placeholder="G" />
                    <input className="input mono" value={vM} onChange={(e) => setVM(e.target.value)} placeholder="M" />
                    <input className="input mono" value={vS} onChange={(e) => setVS(e.target.value)} placeholder="S" />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="field">
            <label>Ângulo Horizontal Lido a partir da Ré (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input className="input mono" value={azG} onChange={(e) => setAzG(e.target.value)} placeholder="Graus (°)" />
              <input className="input mono" value={azM} onChange={(e) => setAzM(e.target.value)} placeholder="Minutos (')" />
              <input className="input mono" value={azS} onChange={(e) => setAzS(e.target.value)} placeholder='Segundos (")' />
            </div>
          </div>

          {liveAzPreview && (
            <div className="live-preview mono">
              <span>
                Prévia: <strong>Az = {liveAzPreview.azStr}</strong> ·{' '}
                <strong>Rumo = {liveAzPreview.rumoStr}</strong>
              </span>
            </div>
          )}

          <div className="form-row">
            <button type="submit" className="btn btn-success">
              <Plus size={16} />
              <span>Adicionar Ponto</span>
            </button>
          </div>
        </form>
      </div>

      {statusMsg && (
        <AlertBanner variant={statusMsg.variant} onDismiss={() => setStatusMsg(null)}>
          {statusMsg.text}
        </AlertBanner>
      )}

      {computed.avisos.map((av, i) => (
        <AlertBanner key={i} variant="warning">
          {av}
        </AlertBanner>
      ))}

      <SectionDivider icon={<Compass size={13} />} label="Resultados, Coordenadas & Planta" />

      {computed.rows.length > 0 && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-icon">
              <Crosshair size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Estação Central (E0)</span>
              <span className="kpi-value mono">
                {computed.x0.toFixed(casasCoord)}, {computed.y0.toFixed(casasCoord)}
              </span>
              <span className="kpi-sub">
                Poligonal {tipoPoligonal === 'fechada' ? 'Fechada' : 'Aberta'} · {computed.rows.length} pontos
              </span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <Maximize2 size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Área Calculada (Gauss)</span>
              <span className="kpi-value mono">
                {computed.areaM2 !== null ? `${computed.areaM2.toFixed(casasCoord)} m²` : 'N/A'}
              </span>
              <span className="kpi-sub mono">
                {computed.areaM2 !== null
                  ? `${(computed.areaM2 / 10000).toFixed(6)} ha`
                  : 'Requer poligonal fechada com 3+ pontos'}
              </span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <Ruler size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">
                {tipoPoligonal === 'fechada' ? 'Perímetro Total' : 'Extensão Total'}
              </span>
              <span className="kpi-value mono">
                {computed.alinhamentos.length
                  ? `${computed.perimetro.toFixed(casasCoord)} m`
                  : 'N/A'}
              </span>
              <span className="kpi-sub">{computed.alinhamentos.length} trecho(s) calculado(s)</span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <Layers size={17} />
            <span>Coordenadas e Visadas da Estação Central</span>
          </h2>
          <div className="precision-bar">
            <PrecisionStepper label="ΔX/ΔY" value={casasDelta} onChange={setCasasDelta} />
            <PrecisionStepper label="Coord. & Dist." value={casasCoord} onChange={setCasasCoord} />
          </div>
        </div>

        {computed.rows.length === 0 ? (
          <EmptyGuide
            icon={<Compass size={22} />}
            title="Nenhum ponto irradiado cadastrado"
            description="Lance os pontos visados a partir da estação central ou carregue um lote de exemplo para visualizar o cálculo de coordenadas, trechos e planta planimétrica."
            steps={['Defina X0, Y0 e Ré', 'Informe DH (ou Fios) e ângulo', 'Confira tabela e planta 2D']}
            onLoadExample={handleCarregarExemplo}
            exampleLabel="Carregar Lote de Exemplo (4 Vértices)"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ponto</th>
                  <th>Ré de Origem</th>
                  <th>Azimute (DMS)</th>
                  <th>Rumo (DMS)</th>
                  <th>DH Est. (m)</th>
                  <th>ΔX ({casasDelta} dec)</th>
                  <th>ΔY ({casasDelta} dec)</th>
                  <th>Coord. X</th>
                  <th>Coord. Y</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {computed.rows.map((row) => (
                  <tr key={row.orig.id}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {row.orig.ponto}
                    </td>
                    <td>{row.reOrigem}</td>
                    <td className="mono">{row.azDms}</td>
                    <td className="mono">{row.rumoDms}</td>
                    <td className="mono">{row.orig.dh.toFixed(4)}</td>
                    <td className="mono">{fmtDx(row.dx, casasDelta)}</td>
                    <td className="mono">{fmtDy(row.dy, casasDelta)}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {row.x.toFixed(casasCoord)}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {row.y.toFixed(casasCoord)}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          title="Analisar dados"
                          onClick={() => setInspectRow(row)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Editar ponto"
                          onClick={() => openEditModal(row.orig)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon danger"
                          title="Apagar ponto"
                          onClick={() => handleDelete(row.orig.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {computed.rows.length > 0 && (
        <div className="grid-2" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)' }}>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <MapPin size={17} />
                <span>Distâncias entre Pontos</span>
              </h2>
            </div>
            {computed.alinhamentos.length === 0 ? (
              <div className="empty-state">
                <p>Adicione pelo menos 2 pontos para calcular as distâncias entre trechos.</p>
              </div>
            ) : (
              <div className="table-wrap table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Trecho</th>
                      <th>Distância (m)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {computed.alinhamentos.map((al, i) => (
                      <tr key={i}>
                        <td className="mono" style={{ fontWeight: 600 }}>
                          {al.trecho}
                        </td>
                        <td className="mono">{al.distancia.toFixed(casasCoord)} m</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      <td className="mono">{computed.perimetro.toFixed(casasCoord)} m</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Compass size={17} />
                <span>Planta Planimétrica Interativa</span>
              </h2>
              <span className="chart-hint">
                <Info size={13} />
                <span>Escala 1:1 preservada · Arraste para zoom</span>
              </span>
            </div>
            <PlotlyChart ref={chartRef} data={chartSpec.data} layout={chartSpec.layout} height={480} />
          </div>
        </div>
      )}

      {/* Inspect Modal */}
      {inspectRow && (
        <Modal
          title={`Análise dos Dados — Ponto ${inspectRow.orig.ponto}`}
          icon={<Eye size={18} />}
          onClose={() => setInspectRow(null)}
        >
          <div className="detail-grid">
            <div className="detail-item">
              <span>Ponto</span>
              <span className="mono">{inspectRow.orig.ponto}</span>
            </div>
            <div className="detail-item">
              <span>Ré de Origem</span>
              <span>{inspectRow.reOrigem}</span>
            </div>
            <div className="detail-item">
              <span>Ângulo Lido a partir da Ré</span>
              <span className="mono">{decParaGmsStr(inspectRow.orig.angLidoDec)}</span>
            </div>
            <div className="detail-item">
              <span>Azimute Final</span>
              <span className="mono">
                {inspectRow.azDms} ({inspectRow.azDec.toFixed(6)}°)
              </span>
            </div>
            <div className="detail-item">
              <span>Rumo Formatado</span>
              <span className="mono">{inspectRow.rumoDms}</span>
            </div>
            <div className="detail-item">
              <span>Modo de Distância</span>
              <span>{inspectRow.orig.modoDistDesc}</span>
            </div>
            <div className="detail-item">
              <span>ΔX ({casasDelta} dec)</span>
              <span className="mono">{fmtDx(inspectRow.dx, casasDelta)}</span>
            </div>
            <div className="detail-item">
              <span>ΔY ({casasDelta} dec)</span>
              <span className="mono">{fmtDy(inspectRow.dy, casasDelta)}</span>
            </div>
            <div className="detail-item">
              <span>Coord. X Final</span>
              <span className="mono">{inspectRow.x.toFixed(casasCoord)} m</span>
            </div>
            <div className="detail-item">
              <span>Coord. Y Final</span>
              <span className="mono">{inspectRow.y.toFixed(casasCoord)} m</span>
            </div>
            <div className="detail-item">
              <span>DH da Estação</span>
              <span className="mono">{inspectRow.orig.dh.toFixed(6)} m</span>
            </div>
            {inspectRow.orig.modoDh === 'fios' && (
              <>
                <div className="detail-item">
                  <span>FS / FM / FI (m)</span>
                  <span className="mono">
                    {inspectRow.orig.fs.toFixed(4)} / {inspectRow.orig.fm.toFixed(4)} /{' '}
                    {inspectRow.orig.fi.toFixed(4)}
                  </span>
                </div>
                <div className="detail-item">
                  <span>Gerador Mira (g)</span>
                  <span className="mono">{inspectRow.orig.g.toFixed(6)} m</span>
                </div>
                <div className="detail-item">
                  <span>
                    Ângulo Vertical ({inspectRow.orig.tipoAngV === 'zenital' ? 'Z' : 'α'})
                  </span>
                  <span className="mono">{decParaGmsAssinado(inspectRow.orig.vDec)}</span>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editId !== null && (
        <Modal
          title={`Editar Ponto ${edNome}`}
          icon={<Pencil size={18} />}
          onClose={() => setEditId(null)}
        >
          {edError && <AlertBanner variant="danger">{edError}</AlertBanner>}
          <div className="form-grid">
            <div className="field">
              <label>Nome do Ponto</label>
              <input className="input mono" value={edNome} onChange={(e) => setEdNome(e.target.value)} />
            </div>
            <div className="field">
              <label>Zerar em (Ré)</label>
              <select
                className="select"
                value={edReId}
                onChange={(e) => setEdReId(Number(e.target.value))}
              >
                {editReOptions.map((op) => (
                  <option key={op.value} value={op.value}>
                    {op.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>Modo de Distância</label>
              <SegmentedControl
                value={edModoDh}
                onChange={setEdModoDh}
                options={[
                  { label: 'DH Direta', value: 'direta' },
                  { label: 'Fios', value: 'fios' },
                ]}
              />
            </div>
          </div>

          <div className="field">
            <label>Ângulo Horizontal Lido a partir da Ré (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input className="input mono" value={edAzG} onChange={(e) => setEdAzG(e.target.value)} />
              <input className="input mono" value={edAzM} onChange={(e) => setEdAzM(e.target.value)} />
              <input className="input mono" value={edAzS} onChange={(e) => setEdAzS(e.target.value)} />
            </div>
          </div>

          {edModoDh === 'direta' ? (
            <div className="field">
              <label>DH (m)</label>
              <input className="input mono" value={edDh} onChange={(e) => setEdDh(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="form-grid">
                <div className="field">
                  <label>FS (m)</label>
                  <input className="input mono" value={edFs} onChange={(e) => setEdFs(e.target.value)} />
                </div>
                <div className="field">
                  <label>FM (m)</label>
                  <input className="input mono" value={edFm} onChange={(e) => setEdFm(e.target.value)} />
                </div>
                <div className="field">
                  <label>FI (m)</label>
                  <input className="input mono" value={edFi} onChange={(e) => setEdFi(e.target.value)} />
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Tipo Ângulo Vertical</label>
                  <SegmentedControl
                    value={edTipoAngV}
                    onChange={setEdTipoAngV}
                    options={[
                      { label: 'Zenital (Z)', value: 'zenital' },
                      { label: 'Inclinação (α)', value: 'alpha' },
                    ]}
                  />
                </div>
                <div className="field">
                  <label>Ângulo Vertical (G° M&apos; S&quot;)</label>
                  <div className="gms-group">
                    <input className="input mono" value={edVG} onChange={(e) => setEdVG(e.target.value)} />
                    <input className="input mono" value={edVM} onChange={(e) => setEdVM(e.target.value)} />
                    <input className="input mono" value={edVS} onChange={(e) => setEdVS(e.target.value)} />
                  </div>
                </div>
              </div>
            </>
          )}

          <div className="form-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditId(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-success" onClick={handleSaveEdit}>
              <Save size={15} />
              <span>Salvar Alterações</span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
};
