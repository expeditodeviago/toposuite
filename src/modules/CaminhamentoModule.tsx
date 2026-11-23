import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CheckCircle2,
  Compass,
  Eye,
  FileSpreadsheet,
  GitCommitHorizontal,
  Info,
  Maximize2,
  Navigation,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  areaGauss,
  azimuteParaRumoDms,
  calcularCorrecoesInteirasSec,
  calcularDhFios,
  camposGms,
  decParaGmsAssinado,
  decParaGmsStr,
  fmtXEw,
  fmtYNs,
  formatarDescricaoCorrecaoAngular,
  gmsParaDec,
  lerAnguloVertical,
  mod360,
  parseFloatSafe,
  parseOptionalFloat,
  resolverFiosComAviso,
  roundTo,
  validarAngulo,
} from '../utils/topoMath';
import { exportCaminhamentoExcel } from '../utils/excelExport';
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

interface AlinhamentoRaw {
  id: number;
  estacao: string;
  vante: string;
  trecho: string;
  angLidoDec: number;
  dh: number;
  fs: number;
  fm: number;
  fi: number;
  g: number;
  vDec: number;
  tipoAngV: 'zenital' | 'alpha';
  modoDh: 'direta' | 'fios';
  modoDistDesc: string;
}

interface AlinhamentoRow {
  orig: AlinhamentoRaw;
  corrSec: number;
  angCompDec: number;
  azDec: number;
  dxBruto: number;
  dyBruto: number;
  cx: number;
  cy: number;
  dxComp: number;
  dyComp: number;
  xPartida: number;
  yPartida: number;
  angLidoStr: string;
  angCompStr: string;
  azCorrStr: string;
  rumoCorrStr: string;
}

interface Props {
  theme: ThemeMode;
  onCountChange?: (count: number) => void;
}

const STORAGE_KEY = 'toposuite_caminhamento_v1';

const FORMULAS_CAM: FormulaItemSpec[] = [
  {
    title: 'Fechamento Angular (EA)',
    equation: 'Σ_teor = (n ∓ 2) · 180°  |  EA = Σ_lidos − Σ_teor',
    description: 'Sinal (−) para ângulos internos e (+) para externos. Tolerância: EAt = precisão · √n.',
  },
  {
    title: 'Transporte de Azimutes',
    equation: 'Az_i = (Az_{i-1} ± α_comp + 180°) mod 360°',
    description: 'Sinal (−) para caminhamento horário e (+) para anti-horário. O resto da correção em segundos vai aos maiores ângulos.',
  },
  {
    title: 'Fechamento Linear (EL)',
    equation: 'ex = ΣΔX  |  ey = ΣΔY  |  EL = √(ex² + ey²)',
    description: 'Precisão relativa calculada em metros por quilômetro (EL / Perímetro × 1000) e escala 1 : N.',
  },
  {
    title: 'Compensação Proporcional',
    equation: 'fc_x = ex / Σ|ΔX|  |  ΔX_comp = ΔX − |ΔX| · fc_x',
    description: 'Mesmo procedimento aplicado em Y (fc_y = ey / Σ|ΔY|) garantindo o fechamento exato da poligonal.',
  },
];

export const CaminhamentoModule: React.FC<Props> = ({ theme, onCountChange }) => {
  const loadSaved = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch {
      return {};
    }
  };
  const saved = useMemo(loadSaved, []);

  const [x0Str, setX0Str] = useState<string>(saved.x0Str ?? '');
  const [y0Str, setY0Str] = useState<string>(saved.y0Str ?? '');
  const [precTeodStr, setPrecTeodStr] = useState<string>(saved.precTeodStr ?? '');
  const [tipoPoligonal, setTipoPoligonal] = useState<'fechada' | 'aberta'>(
    saved.tipoPoligonal ?? 'fechada'
  );
  const [tipoAzInicial, setTipoAzInicial] = useState<'direto' | 're'>(
    saved.tipoAzInicial ?? 'direto'
  );
  const [az1G, setAz1G] = useState<string>(saved.az1G ?? '');
  const [az1M, setAz1M] = useState<string>(saved.az1M ?? '');
  const [az1S, setAz1S] = useState<string>(saved.az1S ?? '');
  const [tipoAngulo, setTipoAngulo] = useState<'interno' | 'externo'>(
    saved.tipoAngulo ?? 'interno'
  );
  const [sentido, setSentido] = useState<'horario' | 'anti_horario'>(
    saved.sentido ?? 'horario'
  );
  const [alinhamentos, setAlinhamentos] = useState<AlinhamentoRaw[]>(
    Array.isArray(saved.alinhamentos) ? saved.alinhamentos : []
  );

  const [casasBrutas, setCasasBrutas] = useState(4);
  const [casasComp, setCasasComp] = useState(4);
  const [showGuide, setShowGuide] = useState(false);

  // Form
  const [est, setEst] = useState('P1');
  const [vant, setVant] = useState('P2');
  const [angG, setAngG] = useState('');
  const [angM, setAngM] = useState('');
  const [angS, setAngS] = useState('');
  const [modoDh, setModoDh] = useState<'direta' | 'fios'>('direta');
  const [dhStr, setDhStr] = useState('');
  const [fsStr, setFsStr] = useState('');
  const [fmStr, setFmStr] = useState('');
  const [fiStr, setFiStr] = useState('');
  const [tipoAngV, setTipoAngV] = useState<'zenital' | 'alpha'>('zenital');
  const [vG, setVG] = useState('');
  const [vM, setVM] = useState('');
  const [vS, setVS] = useState('');

  const [statusMsg, setStatusMsg] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const [inspectRow, setInspectRow] = useState<AlinhamentoRow | null>(null);

  // Edit modal
  const [editId, setEditId] = useState<number | null>(null);
  const [edEst, setEdEst] = useState('');
  const [edVant, setEdVant] = useState('');
  const [edG, setEdG] = useState('');
  const [edM, setEdM] = useState('');
  const [edS, setEdS] = useState('');
  const [edModoDh, setEdModoDh] = useState<'direta' | 'fios'>('direta');
  const [edDh, setEdDh] = useState('');
  const [edFs, setEdFs] = useState('');
  const [edFm, setEdFm] = useState('');
  const [edFi, setEdFi] = useState('');
  const [edTipoAngV, setEdTipoAngV] = useState<'zenital' | 'alpha'>('zenital');
  const [edVG, setEdVG] = useState('');
  const [edVM, setEdVM] = useState('');
  const [edVS, setEdVS] = useState('');
  const [edError, setEdError] = useState<string | null>(null);

  const chartRef = useRef<PlotlyChartHandle | null>(null);

  useEffect(() => {
    onCountChange?.(alinhamentos.length);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          x0Str,
          y0Str,
          precTeodStr,
          tipoPoligonal,
          tipoAzInicial,
          az1G,
          az1M,
          az1S,
          tipoAngulo,
          sentido,
          alinhamentos,
        })
      );
    } catch {
      // ignore
    }
  }, [
    x0Str,
    y0Str,
    precTeodStr,
    tipoPoligonal,
    tipoAzInicial,
    az1G,
    az1M,
    az1S,
    tipoAngulo,
    sentido,
    alinhamentos,
    onCountChange,
  ]);

  const handleCarregarExemplo = () => {
    setX0Str('1000');
    setY0Str('1000');
    setPrecTeodStr('20');
    setTipoPoligonal('fechada');
    setTipoAzInicial('direto');
    setAz1G('42');
    setAz1M('15');
    setAz1S('0');
    setTipoAngulo('interno');
    setSentido('horario');

    // Realistic 4-vertex closed traverse with +12" angular error and small linear closure error
    const ex: AlinhamentoRaw[] = [
      { id: 1, estacao: 'P1', vante: 'P2', trecho: 'P1 → P2', angLidoDec: gmsParaDec(89, 59, 55), dh: 52.42, fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDh: 'direta', modoDistDesc: 'Distância Horizontal Direta (DH)' },
      { id: 2, estacao: 'P2', vante: 'P3', trecho: 'P2 → P3', angLidoDec: gmsParaDec(94, 12, 10), dh: 46.85, fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDh: 'direta', modoDistDesc: 'Distância Horizontal Direta (DH)' },
      { id: 3, estacao: 'P3', vante: 'P4', trecho: 'P3 → P4', angLidoDec: gmsParaDec(86, 28, 0), dh: 55.98, fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDh: 'direta', modoDistDesc: 'Distância Horizontal Direta (DH)' },
      { id: 4, estacao: 'P4', vante: 'P1', trecho: 'P4 → P1', angLidoDec: gmsParaDec(89, 20, 7), dh: 43.35, fs: 0, fm: 0, fi: 0, g: 0, vDec: 90, tipoAngV: 'zenital', modoDh: 'direta', modoDistDesc: 'Distância Horizontal Direta (DH)' },
    ];
    setAlinhamentos(ex);
    setEst('P1');
    setVant('P2');
    setStatusMsg({
      variant: 'info',
      text: 'Poligonal fechada de exemplo carregada (4 vértices com erro angular de +12" dentro da tolerância de 40").',
    });
  };

  const calc = useMemo(() => {
    if (!alinhamentos.length) return null;

    const n = alinhamentos.length;
    const x0 = parseFloatSafe(x0Str);
    const y0 = parseFloatSafe(y0Str);
    const precTeodSec = parseFloatSafe(precTeodStr);

    const angulosBrutos = alinhamentos.map((a) => a.angLidoDec);
    const somaAngLidos = angulosBrutos.reduce((acc, v) => acc + v, 0);

    let somaTeorica = 0;
    let erroAngularDec = 0;
    let erroAngularSec = 0;
    let toleranciaAngularSec = 0;
    let satisfazAngular = true;
    let correcoesSec: number[] = new Array(n).fill(0);
    let descCorrecaoAngular = 'N/A (Poligonal Aberta)';

    if (tipoPoligonal === 'fechada') {
      somaTeorica = tipoAngulo === 'interno' ? (n - 2) * 180.0 : (n + 2) * 180.0;
      erroAngularDec = somaAngLidos - somaTeorica;
      erroAngularSec = erroAngularDec * 3600.0;
      toleranciaAngularSec = precTeodSec > 0 ? precTeodSec * Math.sqrt(n) : 0;
      satisfazAngular =
        precTeodSec > 0
          ? roundTo(Math.abs(erroAngularSec), 2) <= roundTo(toleranciaAngularSec, 2)
          : true;
      correcoesSec = calcularCorrecoesInteirasSec(erroAngularSec, angulosBrutos);
      descCorrecaoAngular = formatarDescricaoCorrecaoAngular(correcoesSec);
    }

    const azInicialDec = gmsParaDec(az1G, az1M, az1S);
    let azAtu = azInicialDec;
    let somaDh = 0;
    let somaDxBruto = 0;
    let somaDyBruto = 0;

    const intermediate = alinhamentos.map((pt, i) => {
      const cSec = correcoesSec[i];
      const angCompDec = pt.angLidoDec + cSec / 3600.0;
      let azLado: number;
      if (i === 0 && tipoAzInicial === 'direto') {
        azLado = mod360(azInicialDec);
      } else {
        const azBruto =
          sentido === 'anti_horario'
            ? azAtu + angCompDec + 180.0
            : azAtu - angCompDec + 180.0;
        azLado = mod360(azBruto);
      }
      azAtu = azLado;
      somaDh += pt.dh;
      const azRad = (azLado * Math.PI) / 180.0;
      const dxBruto = roundTo(pt.dh * Math.sin(azRad), casasBrutas);
      const dyBruto = roundTo(pt.dh * Math.cos(azRad), casasBrutas);
      somaDxBruto += dxBruto;
      somaDyBruto += dyBruto;

      return { pt, cSec, angCompDec, azLado, dxBruto, dyBruto };
    });

    let ex = 0,
      ey = 0,
      somaAbsX = 0,
      somaAbsY = 0,
      erroLinearAbsoluto = 0,
      fcX = 0,
      fcY = 0;
    let precisaoRelativaStr = 'N/A (Poligonal Aberta)';

    if (tipoPoligonal === 'fechada') {
      ex = somaDxBruto;
      ey = somaDyBruto;
      erroLinearAbsoluto = Math.hypot(ex, ey);
      somaAbsX = intermediate.reduce((acc, p) => acc + Math.abs(p.dxBruto), 0);
      somaAbsY = intermediate.reduce((acc, p) => acc + Math.abs(p.dyBruto), 0);
      fcX = somaAbsX > 0 ? roundTo(ex / somaAbsX, 11) : 0;
      fcY = somaAbsY > 0 ? roundTo(ey / somaAbsY, 11) : 0;

      if (erroLinearAbsoluto > 0 && somaDh > 0) {
        const num1000 = (erroLinearAbsoluto / somaDh) * 1000.0;
        const escala1toN = Math.round(somaDh / erroLinearAbsoluto);
        precisaoRelativaStr = `${num1000.toFixed(2).replace('.', ',')} / 1000 m (1 : ${escala1toN})`;
      } else {
        precisaoRelativaStr = '0,00 / 1000 m (Exato)';
      }
    }

    let xAtual = x0;
    let yAtual = y0;
    const xCoords: number[] = [x0];
    const yCoords: number[] = [y0];
    const nomesVertices: string[] = [alinhamentos[0].estacao];

    let somaDxComp = 0;
    let somaDyComp = 0;

    const rows: AlinhamentoRow[] = intermediate.map((item) => {
      const cx = Math.abs(item.dxBruto) * fcX;
      const cy = Math.abs(item.dyBruto) * fcY;
      const dxComp = roundTo(item.dxBruto - cx, casasComp);
      const dyComp = roundTo(item.dyBruto - cy, casasComp);
      somaDxComp += dxComp;
      somaDyComp += dyComp;

      const xPartida = xAtual;
      const yPartida = yAtual;
      xAtual = roundTo(xAtual + dxComp, casasComp);
      yAtual = roundTo(yAtual + dyComp, casasComp);
      xCoords.push(xAtual);
      yCoords.push(yAtual);
      nomesVertices.push(item.pt.vante);

      return {
        orig: item.pt,
        corrSec: item.cSec,
        angCompDec: item.angCompDec,
        azDec: item.azLado,
        dxBruto: item.dxBruto,
        dyBruto: item.dyBruto,
        cx,
        cy,
        dxComp,
        dyComp,
        xPartida,
        yPartida,
        angLidoStr: decParaGmsStr(item.pt.angLidoDec, 1, false),
        angCompStr: decParaGmsStr(item.angCompDec, 1, false),
        azCorrStr: decParaGmsStr(item.azLado),
        rumoCorrStr: azimuteParaRumoDms(item.azLado),
      };
    });

    const xPlot = tipoPoligonal === 'fechada' ? xCoords.slice(0, -1) : xCoords;
    const yPlot = tipoPoligonal === 'fechada' ? yCoords.slice(0, -1) : yCoords;
    const nomesPlot = tipoPoligonal === 'fechada' ? nomesVertices.slice(0, -1) : nomesVertices;

    const areaM2 =
      tipoPoligonal === 'fechada' && n >= 3
        ? areaGauss(xCoords.slice(0, -1), yCoords.slice(0, -1))
        : null;

    const erroAngStr =
      tipoPoligonal === 'fechada'
        ? `${erroAngularSec >= 0 ? '+' : ''}${erroAngularSec.toFixed(2)}" (${decParaGmsAssinado(erroAngularDec)})`
        : 'N/A';

    const tolStr =
      tipoPoligonal === 'fechada'
        ? precTeodSec > 0
          ? `${toleranciaAngularSec.toFixed(2)}" (${satisfazAngular ? 'Dentro do permitido' : 'Fora da tolerância'})`
          : 'Não informada'
        : 'N/A';

    return {
      x0,
      y0,
      xFinal: xAtual,
      yFinal: yAtual,
      precTeodSec,
      somaDh,
      somaAngLidosStr: decParaGmsStr(somaAngLidos, 1, false),
      somaTeoricaStr: decParaGmsStr(somaTeorica, 1, false),
      erroAngStr,
      tolStr,
      satisfazAngular,
      descCorrecaoAngular,
      ex,
      ey,
      erroLinearAbsoluto,
      precisaoRelativaStr,
      somaAbsX,
      somaAbsY,
      fcX,
      fcY,
      somaDxBruto,
      somaDyBruto,
      somaDxComp,
      somaDyComp,
      areaM2,
      rows,
      xPlot,
      yPlot,
      nomesPlot,
    };
  }, [
    alinhamentos,
    x0Str,
    y0Str,
    precTeodStr,
    tipoPoligonal,
    tipoAzInicial,
    az1G,
    az1M,
    az1S,
    tipoAngulo,
    sentido,
    casasBrutas,
    casasComp,
  ]);

  const handleAdicionar = (e: React.FormEvent) => {
    e.preventDefault();
    const estNome = est.trim() || `P${alinhamentos.length + 1}`;
    const vantNome = vant.trim() || `P${alinhamentos.length + 2}`;
    const trecho = `${estNome} → ${vantNome}`;

    const angRes = validarAngulo(angG, angM, angS, 'ângulo horizontal');
    if (angRes.error || angRes.value === null) {
      setStatusMsg({ variant: 'danger', text: angRes.error || 'Informe o ângulo horizontal lido.' });
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
      modoDesc = 'Fios Estadimétricos (FS, FM, FI)';
    }

    const novo: AlinhamentoRaw = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      estacao: estNome,
      vante: vantNome,
      trecho,
      angLidoDec: angRes.value,
      dh: dhVal,
      fs,
      fm,
      fi,
      g,
      vDec,
      tipoAngV: tipoV,
      modoDh,
      modoDistDesc: modoDesc,
    };

    const next = [...alinhamentos, novo];
    setAlinhamentos(next);
    setEst(vantNome);
    const digits = vantNome.replace(/\D/g, '');
    setVant(digits ? `P${Number(digits) + 1}` : `P${next.length + 2}`);
    setDhStr('');
    setFsStr('');
    setFmStr('');
    setFiStr('');
    setAngG('');
    setAngM('');
    setAngS('');
    setVG('');
    setVM('');
    setVS('');
    setStatusMsg({
      variant: 'success',
      text: `Alinhamento '${trecho}' adicionado (DH = ${dhVal.toFixed(4)} m).`,
    });
  };

  const openEdit = (pt: AlinhamentoRaw) => {
    setEditId(pt.id);
    setEdEst(pt.estacao);
    setEdVant(pt.vante);
    const [g, m, s] = camposGms(pt.angLidoDec, 4);
    setEdG(g);
    setEdM(m);
    setEdS(s);
    setEdModoDh(pt.modoDh);
    setEdDh(pt.modoDh === 'direta' ? pt.dh.toFixed(6) : '');
    setEdFs(pt.fs > 0 ? pt.fs.toFixed(6) : '');
    setEdFm(pt.fm > 0 ? pt.fm.toFixed(6) : '');
    setEdFi(pt.fi > 0 ? pt.fi.toFixed(6) : '');
    setEdTipoAngV(pt.tipoAngV);
    const [vg, vm, vs] = camposGms(pt.vDec, 4);
    setEdVG(pt.modoDh === 'fios' ? vg : '');
    setEdVM(pt.modoDh === 'fios' ? vm : '');
    setEdVS(pt.modoDh === 'fios' ? vs : '');
    setEdError(null);
  };

  const handleSaveEdit = () => {
    if (editId === null) return;
    const angRes = validarAngulo(edG, edM, edS, 'ângulo horizontal');
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
      modoDesc = 'Fios Estadimétricos (FS, FM, FI)';
    }

    const estNome = edEst.trim() || 'P1';
    const vantNome = edVant.trim() || 'P2';
    const trecho = `${estNome} → ${vantNome}`;

    setAlinhamentos((prev) =>
      prev.map((a) =>
        a.id === editId
          ? {
              ...a,
              estacao: estNome,
              vante: vantNome,
              trecho,
              angLidoDec: angRes.value!,
              dh: dhVal,
              fs,
              fm,
              fi,
              g,
              vDec,
              tipoAngV: tipoV,
              modoDh: edModoDh,
              modoDistDesc: modoDesc,
            }
          : a
      )
    );
    setEditId(null);
    setStatusMsg({ variant: 'success', text: `Alinhamento '${trecho}' atualizado.` });
  };

  const handleDelete = (id: number) => {
    const target = alinhamentos.find((a) => a.id === id);
    if (!target) return;
    setAlinhamentos((prev) => prev.filter((a) => a.id !== id));
    setEst(target.estacao);
    setVant(target.vante);
    setStatusMsg({ variant: 'info', text: `Alinhamento '${target.trecho}' removido.` });
  };

  const handleLimpar = () => {
    setAlinhamentos([]);
    setEst('P1');
    setVant('P2');
    setX0Str('');
    setY0Str('');
    setPrecTeodStr('');
    setAz1G('');
    setAz1M('');
    setAz1S('');
    setDhStr('');
    setFsStr('');
    setFmStr('');
    setFiStr('');
    setAngG('');
    setAngM('');
    setAngS('');
    setVG('');
    setVM('');
    setVS('');
    setStatusMsg({ variant: 'info', text: 'Todo o caminhamento foi resetado.' });
  };

  const handleExportExcel = async () => {
    if (!calc) return;
    const chartPng = await chartRef.current?.toPng(920, 680);
    await exportCaminhamentoExcel({
      x0: calc.x0,
      y0: calc.y0,
      xFinal: calc.xFinal,
      yFinal: calc.yFinal,
      tipo: tipoPoligonal,
      tipoAnguloDesc: tipoAngulo === 'interno' ? 'Ângulos Internos' : 'Ângulos Externos',
      sentidoDesc: sentido === 'horario' ? 'Horário' : 'Anti-Horário',
      casasBrutas,
      casasComp,
      somaDh: calc.somaDh,
      areaM2: calc.areaM2,
      somaAngLidosStr: calc.somaAngLidosStr,
      somaTeoricaStr: calc.somaTeoricaStr,
      erroAngularStr: calc.erroAngStr,
      toleranciaAngularStr: calc.tolStr,
      descCorrecaoAngular: calc.descCorrecaoAngular,
      ex: calc.ex,
      ey: calc.ey,
      erroLinearAbsoluto: calc.erroLinearAbsoluto,
      precisaoRelativaStr: calc.precisaoRelativaStr,
      somaAbsX: calc.somaAbsX,
      somaAbsY: calc.somaAbsY,
      fcX: calc.fcX,
      fcY: calc.fcY,
      somaDxBruto: calc.somaDxBruto,
      somaDyBruto: calc.somaDyBruto,
      tabela: calc.rows.map((r) => ({
        trecho: r.orig.trecho,
        estacao: r.orig.estacao,
        vante: r.orig.vante,
        angLidoStr: r.angLidoStr,
        corrSec: r.corrSec,
        angCompStr: r.angCompStr,
        azCorrigidoStr: r.azCorrStr,
        rumoCorrigidoStr: r.rumoCorrStr,
        dh: r.orig.dh,
        dxBruto: r.dxBruto,
        dyBruto: r.dyBruto,
        cx: r.cx,
        cy: r.cy,
        dxComp: r.dxComp,
        dyComp: r.dyComp,
        x: r.xPartida,
        y: r.yPartida,
        modoDistDesc: r.orig.modoDistDesc,
        fs: r.orig.fs,
        fm: r.orig.fm,
        fi: r.orig.fi,
        g: r.orig.g,
        angVStr: decParaGmsAssinado(r.orig.vDec),
      })),
      chartPng,
    });
  };

  const chartSpec = useMemo(() => {
    const pt = getPlotTheme(theme);
    if (!calc || calc.xPlot.length < 2) return null;
    const { xPlot, yPlot, nomesPlot } = calc;

    const traces: Record<string, unknown>[] = [];
    if (tipoPoligonal === 'fechada' && xPlot.length >= 3) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: [...xPlot, xPlot[0]],
        y: [...yPlot, yPlot[0]],
        fill: 'toself',
        fillcolor: pt.accentFill,
        line: { color: pt.accent, width: 2.5 },
        name: 'Poligonal Fechada',
      });
    } else {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: xPlot,
        y: yPlot,
        line: { color: pt.accent, width: 2.5, dash: 'dash' },
        name: 'Poligonal Aberta',
      });
    }

    traces.push({
      type: 'scatter',
      mode: 'markers+text',
      x: xPlot,
      y: yPlot,
      text: nomesPlot.map(
        (nm, i) =>
          `${nm} (${xPlot[i].toFixed(Math.min(casasComp, 2))}, ${yPlot[i].toFixed(Math.min(casasComp, 2))})`
      ),
      textposition: 'top center',
      textfont: { size: 10.5, color: pt.text },
      marker: { size: 9, color: pt.accent, line: { color: pt.paperBg, width: 1.5 } },
      name: 'Vértices',
    });

    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: [xPlot[0]],
      y: [yPlot[0]],
      marker: {
        size: 12,
        color: pt.danger,
        symbol: 'diamond',
        line: { color: pt.paperBg, width: 1.5 },
      },
      name: `Estação Inicial (${nomesPlot[0]})`,
    });

    const xSpan = Math.max(Math.max(...xPlot) - Math.min(...xPlot), 1);
    const ySpan = Math.max(Math.max(...yPlot) - Math.min(...yPlot), 1);

    return {
      data: traces,
      layout: {
        title: {
          text: 'Planta Planimétrica da Poligonal',
          font: { size: 14.5, color: pt.title },
          y: 0.97,
        },
        paper_bgcolor: pt.paperBg,
        plot_bgcolor: pt.plotBg,
        font: { color: pt.text },
        hovermode: 'closest',
        xaxis: {
          title: { text: 'Coordenada X (m)', standoff: 10 },
          range: [Math.min(...xPlot) - xSpan * 0.18, Math.max(...xPlot) + xSpan * 0.18],
          gridcolor: pt.grid,
          zerolinecolor: pt.zeroLine,
        },
        yaxis: {
          title: { text: 'Coordenada Y (m)', standoff: 10 },
          range: [Math.min(...yPlot) - ySpan * 0.16, Math.max(...yPlot) + ySpan * 0.18],
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
  }, [calc, tipoPoligonal, theme, casasComp]);

  return (
    <>
      <div className="module-header">
        <div className="module-title-group">
          <div className="module-icon-box">
            <Navigation size={23} />
          </div>
          <div>
            <h1 className="module-title">Planimetria — Método do Caminhamento</h1>
            <p className="module-desc">
              Cálculo completo de poligonais fechadas e abertas com fechamento angular, compensação linear, coordenadas finais e área.
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
            disabled={!calc}
          >
            <FileSpreadsheet size={15} />
            <span>Excel</span>
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={handleLimpar}>
            <RotateCcw size={15} />
            <span>Resetar</span>
          </button>
        </div>
      </div>

      <FormulaDrawer
        open={showGuide}
        title="Guia Rápido & Fórmulas — Caminhamento Poligonal"
        summary="Configure os dados de partida no Passo 1 (coordenadas X0/Y0, azimute inicial, tipo de ângulo e sentido) e adicione os alinhamentos em ordem sequencial no Passo 2. Todos os parâmetros recalculam a planilha instantaneamente."
        items={FORMULAS_CAM}
        onClose={() => setShowGuide(false)}
      />

      <SectionDivider icon={<Settings2 size={13} />} label="Entrada de Dados" />

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <span className="step-chip">Passo 1</span>
              <span>Configuração de Partida & Teodolito</span>
            </h2>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>X0 Inicial (m)</label>
              <input className="input mono" value={x0Str} onChange={(e) => setX0Str(e.target.value)} placeholder="0.000" />
            </div>
            <div className="field">
              <label>Y0 Inicial (m)</label>
              <input className="input mono" value={y0Str} onChange={(e) => setY0Str(e.target.value)} placeholder="0.000" />
            </div>
            <div className="field">
              <label>Precisão Teodolito (&quot;)</label>
              <input
                className="input mono"
                value={precTeodStr}
                onChange={(e) => setPrecTeodStr(e.target.value)}
                placeholder="Ex: 20"
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Poligonal</label>
              <SegmentedControl
                value={tipoPoligonal}
                onChange={setTipoPoligonal}
                options={[
                  { label: 'Fechada', value: 'fechada' },
                  { label: 'Aberta', value: 'aberta' },
                ]}
              />
            </div>
            <div className="field">
              <label>Ângulos Lidos</label>
              <SegmentedControl
                value={tipoAngulo}
                onChange={setTipoAngulo}
                options={[
                  { label: 'Internos', value: 'interno' },
                  { label: 'Externos', value: 'externo' },
                ]}
              />
            </div>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Sentido do Caminhamento</label>
              <SegmentedControl
                value={sentido}
                onChange={setSentido}
                options={[
                  { label: 'Horário', value: 'horario' },
                  { label: 'Anti-Horário', value: 'anti_horario' },
                ]}
              />
            </div>
            <div className="field">
              <label>Azimute Inicial</label>
              <SegmentedControl
                value={tipoAzInicial}
                onChange={setTipoAzInicial}
                options={[
                  { label: '1º Lado (Az1-2)', value: 'direto' },
                  { label: 'De Ré (Az0)', value: 're' },
                ]}
              />
            </div>
          </div>

          <div className="field">
            <label>Valor do Azimute Inicial (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input className="input mono" value={az1G} onChange={(e) => setAz1G(e.target.value)} placeholder="Graus (°)" />
              <input className="input mono" value={az1M} onChange={(e) => setAz1M(e.target.value)} placeholder="Minutos (')" />
              <input className="input mono" value={az1S} onChange={(e) => setAz1S(e.target.value)} placeholder='Segundos (")' />
            </div>
          </div>
        </div>

        <form className="card" onSubmit={handleAdicionar}>
          <div className="card-header">
            <h2 className="card-title">
              <span className="step-chip">Passo 2</span>
              <span>Adicionar Alinhamento / Vértice</span>
            </h2>
          </div>

          <div className="form-grid">
            <div className="field">
              <label>Estação (Est)</label>
              <input className="input mono" value={est} onChange={(e) => setEst(e.target.value)} />
            </div>
            <div className="field">
              <label>Vante (Pv)</label>
              <input className="input mono" value={vant} onChange={(e) => setVant(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label>Modo de Distância</label>
            <SegmentedControl
              value={modoDh}
              onChange={setModoDh}
              options={[
                { label: 'Distância Horizontal Direta (DH)', value: 'direta' },
                { label: 'Fios Estadimétricos (FS / FM / FI)', value: 'fios' },
              ]}
            />
          </div>

          <div className="field">
            <label>Ângulo Horizontal Lido no Vértice (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input className="input mono" value={angG} onChange={(e) => setAngG(e.target.value)} placeholder="Graus (°)" />
              <input className="input mono" value={angM} onChange={(e) => setAngM(e.target.value)} placeholder="Minutos (')" />
              <input className="input mono" value={angS} onChange={(e) => setAngS(e.target.value)} placeholder='Segundos (")' />
            </div>
          </div>

          {modoDh === 'direta' ? (
            <div className="field">
              <label>Distância Horizontal — DH (m)</label>
              <input
                className="input mono"
                value={dhStr}
                onChange={(e) => setDhStr(e.target.value)}
                placeholder="Ex: 54,320"
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
                  <label>Ângulo Vertical</label>
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

          <div className="form-row">
            <button type="submit" className="btn btn-success">
              <Plus size={16} />
              <span>Adicionar Alinhamento</span>
            </button>
          </div>
        </form>
      </div>

      {statusMsg && (
        <AlertBanner variant={statusMsg.variant} onDismiss={() => setStatusMsg(null)}>
          {statusMsg.text}
        </AlertBanner>
      )}

      <SectionDivider icon={<ShieldCheck size={13} />} label="Fechamento, Planilha & Planta" />

      {calc && (
        <>
          <div className="kpi-grid">
            <div className="kpi-card">
              <div className="kpi-icon">
                <Maximize2 size={18} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Perímetro & Área</span>
                <span className="kpi-value mono">{calc.somaDh.toFixed(4)} m</span>
                <span className="kpi-sub mono">
                  {calc.areaM2 !== null
                    ? `${calc.areaM2.toFixed(casasComp + 2)} m² (${(calc.areaM2 / 10000).toFixed(6)} ha)`
                    : 'Área: N/A'}
                </span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon">
                <Compass size={18} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Fechamento Angular (EA)</span>
                <span className="kpi-value mono">{calc.erroAngStr}</span>
                <span className="kpi-sub">
                  {tipoPoligonal === 'fechada' ? (
                    calc.precTeodSec > 0 ? (
                      <span className={`pill ${calc.satisfazAngular ? 'pill-success' : 'pill-danger'}`}>
                        {calc.satisfazAngular ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        <span>{calc.tolStr}</span>
                      </span>
                    ) : (
                      `Lidos: ${calc.somaAngLidosStr} | Teór.: ${calc.somaTeoricaStr}`
                    )
                  ) : (
                    'Sem compensação angular'
                  )}
                </span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon">
                <Target size={18} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Fechamento Linear (EL)</span>
                <span className="kpi-value mono">
                  {tipoPoligonal === 'fechada'
                    ? `${calc.erroLinearAbsoluto.toFixed(casasComp)} m`
                    : `ΔX ${calc.somaDxBruto.toFixed(casasBrutas)} | ΔY ${calc.somaDyBruto.toFixed(casasBrutas)}`}
                </span>
                <span className="kpi-sub mono">
                  {tipoPoligonal === 'fechada'
                    ? `ex: ${calc.ex >= 0 ? '+' : ''}${calc.ex.toFixed(casasComp)} | ey: ${calc.ey >= 0 ? '+' : ''}${calc.ey.toFixed(casasComp)}`
                    : 'Deslocamento acumulado'}
                </span>
              </div>
            </div>

            <div className="kpi-card">
              <div className="kpi-icon">
                <ShieldCheck size={18} />
              </div>
              <div className="kpi-body">
                <span className="kpi-label">Precisão Relativa (ELFt)</span>
                <span className="kpi-value mono">{calc.precisaoRelativaStr}</span>
                <span className="kpi-sub">{calc.descCorrecaoAngular}</span>
              </div>
            </div>
          </div>

          {tipoPoligonal === 'fechada' && (
            <AlertBanner variant="info">
              <strong>Fatores de Compensação Linear:</strong>{' '}
              <span className="mono">
                Σ|ΔX| = {calc.somaAbsX.toFixed(casasBrutas)} m (fc_x = {calc.fcX.toFixed(11)}) · Σ|ΔY| ={' '}
                {calc.somaAbsY.toFixed(casasBrutas)} m (fc_y = {calc.fcY.toFixed(11)})
              </span>
            </AlertBanner>
          )}
        </>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <GitCommitHorizontal size={17} />
            <span>Planilha de Cálculo do Caminhamento ({alinhamentos.length})</span>
          </h2>
          <div className="precision-bar">
            <PrecisionStepper label="ΔX/ΔY Bruto" value={casasBrutas} onChange={setCasasBrutas} />
            <PrecisionStepper label="Comp. & Coord." value={casasComp} onChange={setCasasComp} />
          </div>
        </div>

        {!calc ? (
          <EmptyGuide
            icon={<Navigation size={22} />}
            title="Nenhum alinhamento cadastrado"
            description="Configure a partida da poligonal e lance cada alinhamento sequencialmente, ou carregue um exemplo completo de poligonal fechada para testar a compensação angular e linear."
            steps={['Configure X0, Y0 e Azimute Inicial', 'Lance os alinhamentos P1→P2...', 'Analise fechamento e planta']}
            onLoadExample={handleCarregarExemplo}
            exampleLabel="Carregar Poligonal Fechada de Exemplo"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Trecho</th>
                  <th>Âng. Lido</th>
                  <th>Âng. Comp.</th>
                  <th>Az. Corr.</th>
                  <th>Rumo Corrigido</th>
                  <th>DH (m)</th>
                  <th>ΔX Bruto</th>
                  <th>ΔY Bruto</th>
                  <th>ΔX Comp.</th>
                  <th>ΔY Comp.</th>
                  <th>Coord. X</th>
                  <th>Coord. Y</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {calc.rows.map((row) => (
                  <tr key={row.orig.id}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {row.orig.trecho}
                    </td>
                    <td className="mono">{row.angLidoStr}</td>
                    <td className="mono">{row.angCompStr}</td>
                    <td className="mono">{row.azCorrStr}</td>
                    <td className="mono">{row.rumoCorrStr}</td>
                    <td className="mono">{row.orig.dh.toFixed(4)}</td>
                    <td className="mono">{fmtXEw(row.dxBruto, casasBrutas)}</td>
                    <td className="mono">{fmtYNs(row.dyBruto, casasBrutas)}</td>
                    <td className="mono">{fmtXEw(row.dxComp, casasComp)}</td>
                    <td className="mono">{fmtYNs(row.dyComp, casasComp)}</td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {row.xPartida.toFixed(casasComp)}
                    </td>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {row.yPartida.toFixed(casasComp)}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          title="Analisar alinhamento"
                          onClick={() => setInspectRow(row)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Editar alinhamento"
                          onClick={() => openEdit(row.orig)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon danger"
                          title="Apagar alinhamento"
                          onClick={() => handleDelete(row.orig.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>TOTAIS / FECHAMENTO</td>
                  <td className="mono">{calc.somaDh.toFixed(4)}</td>
                  <td className="mono">{fmtXEw(calc.somaDxBruto, casasBrutas)}</td>
                  <td className="mono">{fmtYNs(calc.somaDyBruto, casasBrutas)}</td>
                  <td className="mono">{fmtXEw(calc.somaDxComp, casasComp)}</td>
                  <td className="mono">{fmtYNs(calc.somaDyComp, casasComp)}</td>
                  <td className="mono">{calc.xFinal.toFixed(casasComp)}</td>
                  <td className="mono">{calc.yFinal.toFixed(casasComp)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {chartSpec && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Navigation size={17} />
              <span>Planta Planimétrica da Poligonal</span>
            </h2>
            <span className="chart-hint">
              <Info size={13} />
              <span>Proporção real 1:1 · Vértice inicial destacado em losango</span>
            </span>
          </div>
          <PlotlyChart ref={chartRef} data={chartSpec.data} layout={chartSpec.layout} height={500} />
        </div>
      )}

      {/* Inspect Modal */}
      {inspectRow && (
        <Modal
          title={`Análise do Alinhamento ${inspectRow.orig.trecho}`}
          icon={<Eye size={18} />}
          onClose={() => setInspectRow(null)}
        >
          <div className="detail-grid">
            <div className="detail-item">
              <span>Estação / Vante</span>
              <span className="mono">
                {inspectRow.orig.estacao} → {inspectRow.orig.vante}
              </span>
            </div>
            <div className="detail-item">
              <span>Tipo de Ângulo</span>
              <span>{tipoAngulo === 'interno' ? 'Ângulo Interno' : 'Ângulo Externo'}</span>
            </div>
            <div className="detail-item">
              <span>Ângulo Lido</span>
              <span className="mono">
                {inspectRow.angLidoStr} ({inspectRow.orig.angLidoDec.toFixed(6)}°)
              </span>
            </div>
            <div className="detail-item">
              <span>Correção Angular</span>
              <span className="mono">
                {inspectRow.corrSec >= 0 ? '+' : ''}
                {inspectRow.corrSec}&quot; → {inspectRow.angCompStr}
              </span>
            </div>
            <div className="detail-item">
              <span>Azimute / Rumo Corrigido</span>
              <span className="mono">
                {inspectRow.azCorrStr} | {inspectRow.rumoCorrStr}
              </span>
            </div>
            <div className="detail-item">
              <span>Modo de Distância</span>
              <span>{inspectRow.orig.modoDistDesc}</span>
            </div>
            <div className="detail-item">
              <span>ΔX / ΔY Brutos</span>
              <span className="mono">
                {fmtXEw(inspectRow.dxBruto, casasBrutas)} | {fmtYNs(inspectRow.dyBruto, casasBrutas)}
              </span>
            </div>
            <div className="detail-item">
              <span>Correções Cx / Cy (m)</span>
              <span className="mono">
                {inspectRow.cx.toFixed(6)} | {inspectRow.cy.toFixed(6)}
              </span>
            </div>
            <div className="detail-item">
              <span>ΔX / ΔY Compensados</span>
              <span className="mono">
                {fmtXEw(inspectRow.dxComp, casasComp)} | {fmtYNs(inspectRow.dyComp, casasComp)}
              </span>
            </div>
            <div className="detail-item">
              <span>DH (m)</span>
              <span className="mono">{inspectRow.orig.dh.toFixed(6)} m</span>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editId !== null && (
        <Modal
          title={`Editar Alinhamento ${edEst} → ${edVant}`}
          icon={<Pencil size={18} />}
          onClose={() => setEditId(null)}
        >
          {edError && <AlertBanner variant="danger">{edError}</AlertBanner>}
          <div className="form-grid">
            <div className="field">
              <label>Estação</label>
              <input className="input mono" value={edEst} onChange={(e) => setEdEst(e.target.value)} />
            </div>
            <div className="field">
              <label>Vante</label>
              <input className="input mono" value={edVant} onChange={(e) => setEdVant(e.target.value)} />
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
            <label>Ângulo Horizontal Lido (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input className="input mono" value={edG} onChange={(e) => setEdG(e.target.value)} />
              <input className="input mono" value={edM} onChange={(e) => setEdM(e.target.value)} />
              <input className="input mono" value={edS} onChange={(e) => setEdS(e.target.value)} />
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
