import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BookOpen,
  Crosshair,
  Eye,
  FileSpreadsheet,
  Info,
  Pencil,
  Plus,
  RotateCcw,
  Ruler,
  Save,
  Sparkles,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import {
  camposGms,
  decParaGmsAssinado,
  decParaGmsStr,
  gmsParaDec,
  parseFloatSafe,
  parseOptionalFloat,
  resolverFiosComAviso,
} from '../utils/topoMath';
import { exportTaqueometriaExcel } from '../utils/excelExport';
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
import { getPlotTheme, PlotlyChart, ThemeMode } from '../components/PlotlyChart';

export interface TaqueoRawPoint {
  id: number;
  nome: string;
  modoDh: 'fios' | 'direta';
  fs: number;
  fm: number;
  fi: number;
  dhInput: number;
  tipoAng: 'zenital' | 'alpha';
  sentido: 'aclive' | 'declive';
  angG: string;
  angM: string;
  angS: string;
}

interface TaqueoComputed {
  raw: TaqueoRawPoint;
  g: number;
  zDec: number;
  alphaDec: number;
  sentidoStr: string;
  dh: number;
  dv: number;
  deltaH: number | null;
  di: number | null;
  cotaPonto: number | null;
  modoDesc: string;
}

interface Props {
  theme: ThemeMode;
  onCountChange?: (count: number) => void;
}

const STORAGE_KEY = 'toposuite_taqueometria_v1';

const FORMULAS_TAQUEO: FormulaItemSpec[] = [
  {
    title: 'Gerador da Mira (g)',
    equation: 'g = FS − FI  |  FM = (FS + FI) / 2',
    description: 'Se apenas 2 dos 3 fios forem digitados, o terceiro fio é deduzido automaticamente.',
  },
  {
    title: 'Distância Horizontal (DH)',
    equation: 'DH = 100 · g · sen²(Z)',
    description: 'Projeção horizontal da visada estadimétrica com constante multiplicativa K = 100.',
  },
  {
    title: 'Distância Vertical (DV)',
    equation: 'DV = 100 · (g / 2) · sen(2Z)',
    description: 'No modo DH Direta, calcula-se por DV = DH / tan(Z). Positivo em aclive e negativo em declive.',
  },
  {
    title: 'Desnível, DI & Cota',
    equation: 'ΔH = DV + hi − FM  |  Cota = Cota_Est + ΔH',
    description: 'Distância inclinada real no terreno dada por DI = √(DH² + ΔH²).',
  },
];

function proximoNomeDisponivel(pontos: TaqueoRawPoint[]): string {
  let num = 1;
  const set = new Set(pontos.map((p) => p.nome));
  while (set.has(`P${num}`)) num += 1;
  return `P${num}`;
}

export const TaqueometriaModule: React.FC<Props> = ({ theme, onCountChange }) => {
  const [cotaEstStr, setCotaEstStr] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return saved.cotaEstStr ?? '';
    } catch {
      return '';
    }
  });
  const [hiStr, setHiStr] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return saved.hiStr ?? '';
    } catch {
      return '';
    }
  });
  const [pontos, setPontos] = useState<TaqueoRawPoint[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return Array.isArray(saved.pontos) ? saved.pontos : [];
    } catch {
      return [];
    }
  });
  const [casas, setCasas] = useState<number>(4);
  const [showGuide, setShowGuide] = useState(false);

  // Form states
  const [nome, setNome] = useState<string>(() => proximoNomeDisponivel(pontos));
  const [modoDh, setModoDh] = useState<'fios' | 'direta'>('fios');
  const [fsStr, setFsStr] = useState('');
  const [fmStr, setFmStr] = useState('');
  const [fiStr, setFiStr] = useState('');
  const [dhStr, setDhStr] = useState('');
  const [tipoAng, setTipoAng] = useState<'zenital' | 'alpha'>('zenital');
  const [sentido, setSentido] = useState<'aclive' | 'declive'>('aclive');
  const [angG, setAngG] = useState('');
  const [angM, setAngM] = useState('');
  const [angS, setAngS] = useState('');

  const [statusMsg, setStatusMsg] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    lines: string[];
  } | null>(null);
  const [inspectItem, setInspectItem] = useState<TaqueoComputed | null>(null);
  const [editRaw, setEditRaw] = useState<TaqueoRawPoint | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    onCountChange?.(pontos.length);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ cotaEstStr, hiStr, pontos }));
    } catch {
      // ignore
    }
  }, [cotaEstStr, hiStr, pontos, onCountChange]);

  const cotaEst = parseOptionalFloat(cotaEstStr);
  const hi = parseOptionalFloat(hiStr);

  // Live preview of what user is typing
  const livePreview = useMemo(() => {
    const hasAng = Boolean(angG.trim() || angM.trim() || angS.trim());
    if (!hasAng) return null;
    const vDec = gmsParaDec(angG, angM, angS);
    const zDec =
      tipoAng === 'zenital' ? vDec : 90.0 - (sentido === 'declive' ? -Math.abs(vDec) : Math.abs(vDec));
    const alphaDec = 90.0 - zDec;
    const zRad = (zDec * Math.PI) / 180.0;

    if (modoDh === 'fios') {
      const rf = resolverFiosComAviso(
        parseFloatSafe(fsStr),
        parseFloatSafe(fmStr),
        parseFloatSafe(fiStr)
      );
      if (rf.fs > 0 && rf.fi > 0 && rf.fs > rf.fi) {
        const g = rf.fs - rf.fi;
        const dh = 100 * g * Math.sin(zRad) ** 2;
        const dv = 100 * (g / 2) * Math.sin(2 * zRad);
        return {
          zStr: decParaGmsStr(zDec, 1),
          alphaStr: decParaGmsAssinado(alphaDec, 1),
          extra: `FM: ${rf.fm.toFixed(3)} m  |  g: ${g.toFixed(3)} m  |  DH prévia: ${dh.toFixed(3)} m  |  DV: ${dv >= 0 ? '+' : ''}${dv.toFixed(3)} m`,
        };
      }
    } else {
      const dhVal = parseOptionalFloat(dhStr);
      if (dhVal && dhVal > 0) {
        const tanZ = Math.tan(zRad);
        const dv = Math.abs(tanZ) > 1e-12 ? dhVal / tanZ : 0;
        return {
          zStr: decParaGmsStr(zDec, 1),
          alphaStr: decParaGmsAssinado(alphaDec, 1),
          extra: `DH: ${dhVal.toFixed(3)} m  |  DV prévia: ${dv >= 0 ? '+' : ''}${dv.toFixed(3)} m`,
        };
      }
    }
    return {
      zStr: decParaGmsStr(zDec, 1),
      alphaStr: decParaGmsAssinado(alphaDec, 1),
      extra: null,
    };
  }, [angG, angM, angS, tipoAng, sentido, modoDh, fsStr, fmStr, fiStr, dhStr]);

  const calculados: TaqueoComputed[] = useMemo(() => {
    const k = 100.0;
    return pontos.map((p) => {
      const vDec = gmsParaDec(p.angG, p.angM, p.angS);
      let zDec: number;
      let alphaDec: number;
      let sentidoStr: string;

      if (p.tipoAng === 'zenital') {
        zDec = vDec;
        alphaDec = 90.0 - zDec;
        sentidoStr =
          alphaDec > 0
            ? 'Ascendente / Aclive (+)'
            : alphaDec < 0
              ? 'Descendente / Declive (-)'
              : 'Horizontal (0°)';
      } else {
        alphaDec = p.sentido === 'declive' ? -Math.abs(vDec) : Math.abs(vDec);
        zDec = 90.0 - alphaDec;
        sentidoStr =
          p.sentido === 'declive' ? 'Descendente / Declive (-)' : 'Ascendente / Aclive (+)';
      }

      const zRad = (zDec * Math.PI) / 180.0;
      let g = 0.0;
      let dh = 0.0;
      let dv = 0.0;
      let fmEff = p.fm;
      let modoDesc = 'Fios Estadimétricos (FS, FM, FI)';

      if (p.modoDh === 'fios') {
        g = p.fs - p.fi;
        dh = k * g * Math.sin(zRad) ** 2;
        dv = k * (g / 2.0) * Math.sin(2.0 * zRad);
      } else {
        dh = p.dhInput;
        fmEff = 0.0;
        modoDesc = 'Distância Horizontal Direta (DH)';
        const tanZ = Math.tan(zRad);
        dv = Math.abs(tanZ) > 1e-12 ? dh / tanZ : 0.0;
      }

      let deltaH: number | null = null;
      let di: number | null = null;
      let cotaPonto: number | null = null;

      if (hi !== null) {
        deltaH = dv + hi - fmEff;
        di = Math.sqrt(dh * dh + deltaH * deltaH);
        if (cotaEst !== null) {
          cotaPonto = cotaEst + deltaH;
        }
      }

      return {
        raw: p,
        g,
        zDec,
        alphaDec,
        sentidoStr,
        dh,
        dv,
        deltaH,
        di,
        cotaPonto,
        modoDesc,
      };
    });
  }, [pontos, cotaEst, hi]);

  const handleCarregarExemplo = () => {
    setCotaEstStr('500.000');
    setHiStr('1.520');
    const exemplo: TaqueoRawPoint[] = [
      { id: 1, nome: 'P1', modoDh: 'fios', fs: 1.84, fm: 1.50, fi: 1.16, dhInput: 0, tipoAng: 'zenital', sentido: 'aclive', angG: '88', angM: '45', angS: '0' },
      { id: 2, nome: 'P2', modoDh: 'fios', fs: 2.12, fm: 1.65, fi: 1.18, dhInput: 0, tipoAng: 'zenital', sentido: 'aclive', angG: '91', angM: '20', angS: '30' },
      { id: 3, nome: 'P3', modoDh: 'fios', fs: 1.95, fm: 1.45, fi: 0.95, dhInput: 0, tipoAng: 'zenital', sentido: 'aclive', angG: '87', angM: '15', angS: '0' },
      { id: 4, nome: 'P4', modoDh: 'fios', fs: 1.76, fm: 1.40, fi: 1.04, dhInput: 0, tipoAng: 'zenital', sentido: 'aclive', angG: '90', angM: '50', angS: '15' },
    ];
    setPontos(exemplo);
    setNome('P5');
    setStatusMsg({
      variant: 'info',
      lines: ['Exemplo taqueométrico carregado (4 pontos visados a partir da estação com Cota 500,000 m e hi = 1,520 m).'],
    });
  };

  const handleAdicionar = (e: React.FormEvent) => {
    e.preventDefault();
    const nomePonto = nome.trim() || proximoNomeDisponivel(pontos);
    if (pontos.some((p) => p.nome === nomePonto)) {
      setStatusMsg({
        variant: 'warning',
        lines: [`Já existe um ponto cadastrado como '${nomePonto}'.`],
      });
      return;
    }

    const vDec = gmsParaDec(angG, angM, angS);
    const zDec =
      tipoAng === 'zenital'
        ? vDec
        : 90.0 - (sentido === 'declive' ? -Math.abs(vDec) : Math.abs(vDec));
    const alphaDec = 90.0 - zDec;

    const notices: string[] = [];
    let fs = 0,
      fm = 0,
      fi = 0,
      dhVal = 0;

    if (modoDh === 'fios') {
      const resolved = resolverFiosComAviso(
        parseFloatSafe(fsStr),
        parseFloatSafe(fmStr),
        parseFloatSafe(fiStr)
      );
      fs = resolved.fs;
      fm = resolved.fm;
      fi = resolved.fi;
      if (fs <= 0 || fi <= 0 || fs <= fi) {
        setStatusMsg({
          variant: 'danger',
          lines: ['Fios inválidos: informe pelo menos 2 fios positivos com FS > FI.'],
        });
        return;
      }
      if (resolved.msg) notices.push(resolved.msg);
    } else {
      const parsed = parseOptionalFloat(dhStr);
      if (parsed === null || parsed <= 0) {
        setStatusMsg({
          variant: 'danger',
          lines: ['Distância Horizontal (DH) inválida: informe um valor maior que zero.'],
        });
        return;
      }
      dhVal = parsed;
    }

    notices.push(
      `Z = ${decParaGmsStr(zDec, 2)}  |  α = ${decParaGmsAssinado(alphaDec, 2)}`
    );
    const novo: TaqueoRawPoint = {
      id: Date.now(),
      nome: nomePonto,
      modoDh,
      fs,
      fm,
      fi,
      dhInput: dhVal,
      tipoAng,
      sentido,
      angG: angG || '0',
      angM: angM || '0',
      angS: angS || '0',
    };
    const nextList = [...pontos, novo];
    setPontos(nextList);
    setNome(proximoNomeDisponivel(nextList));
    setFsStr('');
    setFmStr('');
    setFiStr('');
    setDhStr('');
    setAngG('');
    setAngM('');
    setAngS('');
    setStatusMsg({
      variant: 'success',
      lines: [`Ponto '${nomePonto}' adicionado com sucesso.`, ...notices],
    });
  };

  const handleSaveEdit = () => {
    if (!editRaw) return;
    setEditError(null);
    const nomeTrim = editRaw.nome.trim();
    if (!nomeTrim) {
      setEditError('Informe o nome do ponto.');
      return;
    }
    if (pontos.some((p) => p.id !== editRaw.id && p.nome === nomeTrim)) {
      setEditError(`Já existe outro ponto com o nome '${nomeTrim}'.`);
      return;
    }

    let updated = { ...editRaw, nome: nomeTrim };
    if (updated.modoDh === 'fios') {
      const res = resolverFiosComAviso(updated.fs, updated.fm, updated.fi);
      if (res.fs <= 0 || res.fi <= 0 || res.fs <= res.fi) {
        setEditError('Fios inválidos (FS deve ser maior que FI).');
        return;
      }
      updated = { ...updated, fs: res.fs, fm: res.fm, fi: res.fi };
    } else {
      if (!updated.dhInput || updated.dhInput <= 0) {
        setEditError('Distância Horizontal (DH) inválida.');
        return;
      }
      updated = { ...updated, fs: 0, fm: 0, fi: 0 };
    }

    setPontos((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setEditRaw(null);
    setStatusMsg({
      variant: 'success',
      lines: [`Ponto '${nomeTrim}' editado com sucesso.`],
    });
  };

  const handleDelete = (id: number, pNome: string) => {
    setPontos((prev) => prev.filter((p) => p.id !== id));
    setNome(pNome);
    setStatusMsg({ variant: 'info', lines: [`Ponto '${pNome}' removido da estação.`] });
  };

  const handleLimpar = () => {
    setPontos([]);
    setCotaEstStr('');
    setHiStr('');
    setNome('P1');
    setModoDh('fios');
    setFsStr('');
    setFmStr('');
    setFiStr('');
    setDhStr('');
    setTipoAng('zenital');
    setSentido('aclive');
    setAngG('');
    setAngM('');
    setAngS('');
    setStatusMsg({
      variant: 'info',
      lines: ['Estação zerada: todos os campos e pontos foram limpos.'],
    });
  };

  const handleExportExcel = async () => {
    if (!calculados.length) return;
    await exportTaqueometriaExcel({
      cotaEst,
      hi,
      casas,
      rows: calculados.map((c) => ({
        ponto: c.raw.nome,
        modoDesc: c.modoDesc,
        fs: c.raw.fs,
        fm: c.raw.fm,
        fi: c.raw.fi,
        g: c.g,
        zenitalStr: decParaGmsStr(c.zDec, 2),
        alphaStr: decParaGmsAssinado(c.alphaDec, 2),
        sentido: c.sentidoStr,
        dv: c.dv,
        dh: c.dh,
        deltaH: c.deltaH,
        di: c.di,
        cotaPonto: c.cotaPonto,
      })),
    });
  };

  const summary = useMemo(() => {
    if (!calculados.length) return null;
    const dhs = calculados.map((c) => c.dh);
    const cotas = calculados.map((c) => c.cotaPonto).filter((v): v is number => v !== null);
    return {
      dhMedia: dhs.reduce((a, b) => a + b, 0) / dhs.length,
      dhMax: Math.max(...dhs),
      cotaMin: cotas.length ? Math.min(...cotas) : null,
      cotaMax: cotas.length ? Math.max(...cotas) : null,
    };
  }, [calculados]);

  const chartSpec = useMemo(() => {
    const pt = getPlotTheme(theme);
    const hasCota = calculados.some((c) => c.cotaPonto !== null);
    const xs = calculados.map((c) => c.raw.nome);
    const ys = hasCota
      ? calculados.map((c) => c.cotaPonto ?? 0)
      : calculados.map((c) => c.dh);
    const minY = ys.length ? Math.min(...ys) : 0;
    const maxY = ys.length ? Math.max(...ys) : 1;
    const ySpan = Math.max(maxY - minY, 0.5);
    const yFloor = hasCota ? minY - ySpan * 0.25 : 0;
    const yCeil = maxY + ySpan * 0.28;

    return {
      data: [
        {
          type: 'scatter',
          mode: 'lines',
          x: xs,
          y: xs.map(() => yFloor),
          line: { width: 0 },
          showlegend: false,
          hoverinfo: 'skip',
        },
        {
          type: 'scatter',
          mode: 'lines+markers+text',
          x: xs,
          y: ys,
          text: ys.map((v) => v.toFixed(Math.min(casas, 4))),
          textposition: 'top center',
          textfont: { size: 11, color: pt.text },
          marker: { size: 9, color: pt.accent, line: { color: pt.paperBg, width: 1.5 } },
          line: { color: pt.accent, width: 2.5 },
          fill: 'tonexty',
          fillcolor: pt.accentFill,
          name: hasCota ? 'Cota do Ponto (m)' : 'Distância Horizontal (m)',
        },
      ],
      layout: {
        title: {
          text: hasCota
            ? 'Perfil Altimétrico dos Pontos Taqueométricos'
            : 'Distância Horizontal (DH) por Ponto Visado',
          font: { size: 14, color: pt.title },
          y: 0.96,
        },
        paper_bgcolor: pt.paperBg,
        plot_bgcolor: pt.plotBg,
        font: { color: pt.text },
        xaxis: { title: { text: 'Ponto', standoff: 10 }, gridcolor: pt.grid, linecolor: pt.zeroLine },
        yaxis: {
          title: { text: hasCota ? 'Cota (m)' : 'DH (m)', standoff: 10 },
          range: [yFloor, yCeil],
          gridcolor: pt.grid,
          linecolor: pt.zeroLine,
        },
        legend: {
          orientation: 'h',
          x: 0.5,
          xanchor: 'center',
          y: 1.02,
          yanchor: 'bottom',
          bgcolor: 'transparent',
        },
        margin: { l: 68, r: 28, t: 74, b: 56 },
      },
    };
  }, [calculados, theme, casas]);

  return (
    <>
      <div className="module-header">
        <div className="module-title-group">
          <div className="module-icon-box">
            <Ruler size={23} />
          </div>
          <div>
            <h1 className="module-title">Calculadora Taqueométrica</h1>
            <p className="module-desc">
              Calcule distâncias horizontal (DH), vertical (DV), inclinada (DI), desnível do solo (ΔH) e cotas a partir de leituras estadimétricas.
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
            disabled={!calculados.length}
          >
            <FileSpreadsheet size={15} />
            <span>Excel</span>
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={handleLimpar}>
            <RotateCcw size={15} />
            <span>Zerar</span>
          </button>
        </div>
      </div>

      <FormulaDrawer
        open={showGuide}
        title="Guia Rápido & Fórmulas — Taqueometria"
        summary="Preencha primeiro a Cota da Estação e a Altura do Instrumento (hi) se quiser obter ΔH, DI e Cota final. Depois lance cada ponto visado informando ao menos 2 fios (FS, FM, FI) ou a DH direta e o ângulo vertical."
        items={FORMULAS_TAQUEO}
        onClose={() => setShowGuide(false)}
      />

      <SectionDivider icon={<Crosshair size={13} />} label="Entrada de Dados" />

      <div className="grid-2" style={{ gridTemplateColumns: 'minmax(270px, 1fr) minmax(0, 1.45fr)' }}>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <span className="step-chip">Passo 1</span>
              <span>Estação Ocupada</span>
            </h2>
            <span className="pill pill-neutral mono">K = 100</span>
          </div>
          <div className="field">
            <label>Cota da Estação (m)</label>
            <input
              className="input mono"
              value={cotaEstStr}
              onChange={(e) => setCotaEstStr(e.target.value)}
              placeholder="Opcional (ex: 500,000)"
            />
          </div>
          <div className="field">
            <label>Altura do Instrumento — hi (m)</label>
            <input
              className="input mono"
              value={hiStr}
              onChange={(e) => setHiStr(e.target.value)}
              placeholder="Opcional (ex: 1,520)"
            />
          </div>
          <span className="helper-text">
            Sem hi, apenas DH e DV são calculados. Ao informar hi e a Cota da Estação, todos os pontos lançados atualizam ΔH, DI e Cota em tempo real.
          </span>
        </div>

        <form className="card" onSubmit={handleAdicionar}>
          <div className="card-header">
            <h2 className="card-title">
              <span className="step-chip">Passo 2</span>
              <span>Leitura do Ponto Visado</span>
            </h2>
          </div>

          <div className="form-grid">
            <div className="field" style={{ maxWidth: 150 }}>
              <label>Nome do Ponto</label>
              <input
                className="input mono"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="P1"
              />
            </div>
            <div className="field">
              <label>Método de Distância</label>
              <SegmentedControl
                value={modoDh}
                onChange={setModoDh}
                options={[
                  { label: 'Fios (FS / FM / FI)', value: 'fios' },
                  { label: 'DH Direta', value: 'direta' },
                ]}
              />
            </div>
          </div>

          {modoDh === 'fios' ? (
            <div className="form-grid">
              <div className="field">
                <label>Fio Superior — FS (m)</label>
                <input
                  className="input mono"
                  value={fsStr}
                  onChange={(e) => setFsStr(e.target.value)}
                  placeholder="Ex: 1,850"
                />
              </div>
              <div className="field">
                <label>Fio Médio — FM (m)</label>
                <input
                  className="input mono"
                  value={fmStr}
                  onChange={(e) => setFmStr(e.target.value)}
                  placeholder="Auto se vazio"
                />
              </div>
              <div className="field">
                <label>Fio Inferior — FI (m)</label>
                <input
                  className="input mono"
                  value={fiStr}
                  onChange={(e) => setFiStr(e.target.value)}
                  placeholder="Ex: 1,150"
                />
              </div>
            </div>
          ) : (
            <div className="field">
              <label>Distância Horizontal Direta — DH (m)</label>
              <input
                className="input mono"
                value={dhStr}
                onChange={(e) => setDhStr(e.target.value)}
                placeholder="Ex: 45,250"
              />
            </div>
          )}

          <div className="form-grid">
            <div className="field">
              <label>Tipo de Ângulo Vertical</label>
              <SegmentedControl
                value={tipoAng}
                onChange={setTipoAng}
                options={[
                  { label: 'Zenital (Z)', value: 'zenital' },
                  { label: 'Inclinação (α)', value: 'alpha' },
                ]}
              />
            </div>
            {tipoAng === 'alpha' && (
              <div className="field">
                <label>Sentido da Visada</label>
                <SegmentedControl
                  value={sentido}
                  onChange={setSentido}
                  options={[
                    { label: 'Aclive (+)', value: 'aclive' },
                    { label: 'Declive (-)', value: 'declive' },
                  ]}
                />
              </div>
            )}
          </div>

          <div className="field">
            <label>Leitura Angular (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input
                className="input mono"
                value={angG}
                onChange={(e) => setAngG(e.target.value)}
                placeholder="Graus (°)"
              />
              <input
                className="input mono"
                value={angM}
                onChange={(e) => setAngM(e.target.value)}
                placeholder="Minutos (')"
              />
              <input
                className="input mono"
                value={angS}
                onChange={(e) => setAngS(e.target.value)}
                placeholder='Segundos (")'
              />
            </div>
          </div>

          {livePreview && (
            <div className="live-preview mono">
              <span>
                Prévia: <strong>Z = {livePreview.zStr}</strong> ·{' '}
                <strong>α = {livePreview.alphaStr}</strong>
              </span>
              {livePreview.extra && <span>{livePreview.extra}</span>}
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
          {statusMsg.lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </AlertBanner>
      )}

      <SectionDivider icon={<TrendingUp size={13} />} label="Resultados & Análise" />

      {summary && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <div className="kpi-icon">
              <Crosshair size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Pontos Visados</span>
              <span className="kpi-value mono">{calculados.length}</span>
              <span className="kpi-sub">
                Estação: {cotaEst !== null ? `${cotaEst.toFixed(3)} m` : 'sem cota'} | hi:{' '}
                {hi !== null ? `${hi.toFixed(3)} m` : '-'}
              </span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <Ruler size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">DH Média / Máxima</span>
              <span className="kpi-value mono">{summary.dhMedia.toFixed(3)} m</span>
              <span className="kpi-sub mono">Maior alcance: {summary.dhMax.toFixed(3)} m</span>
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-icon">
              <Activity size={18} />
            </div>
            <div className="kpi-body">
              <span className="kpi-label">Amplitude de Cotas</span>
              <span className="kpi-value mono">
                {summary.cotaMin !== null && summary.cotaMax !== null
                  ? `${summary.cotaMin.toFixed(3)} a ${summary.cotaMax.toFixed(3)} m`
                  : 'Informe Cota Est. e hi'}
              </span>
              <span className="kpi-sub mono">
                {summary.cotaMin !== null && summary.cotaMax !== null
                  ? `Desnível total: ${(summary.cotaMax - summary.cotaMin).toFixed(4)} m`
                  : 'Cálculo de cota aguardando estação'}
              </span>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <h2 className="card-title">
            <TrendingUp size={17} />
            <span>Tabela de Resultados Taqueométricos ({calculados.length})</span>
          </h2>
          <PrecisionStepper label="Decimais" value={casas} min={1} max={8} onChange={setCasas} />
        </div>

        {calculados.length === 0 ? (
          <EmptyGuide
            icon={<Ruler size={22} />}
            title="Nenhum ponto taqueométrico lançado"
            description="Preencha os dados da estação e lance as visadas acima, ou carregue um exercício pronto para ver a tabela e o gráfico preenchidos."
            steps={['Informe Cota Est. e hi', 'Digite 2 ou 3 fios + ângulo Z/α', 'Clique em Adicionar Ponto']}
            onLoadExample={handleCarregarExemplo}
            exampleLabel="Carregar Exercício de Exemplo"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Ponto</th>
                  <th>Zenital (Z)</th>
                  <th>Alpha (α)</th>
                  <th>DV (m)</th>
                  <th>DH (m)</th>
                  <th>DI (m)</th>
                  <th>ΔH Solo (m)</th>
                  <th>Cota Ponto (m)</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {calculados.map((item) => (
                  <tr key={item.raw.id}>
                    <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                      {item.raw.nome}
                    </td>
                    <td className="mono">{decParaGmsStr(item.zDec, 2)}</td>
                    <td className="mono">{decParaGmsAssinado(item.alphaDec, 2)}</td>
                    <td className="mono">
                      {item.dv >= 0 ? '+' : ''}
                      {item.dv.toFixed(casas)}
                    </td>
                    <td className="mono">{item.dh.toFixed(casas)}</td>
                    <td className="mono">{item.di !== null ? item.di.toFixed(casas) : '-'}</td>
                    <td className="mono">
                      {item.deltaH !== null
                        ? `${item.deltaH >= 0 ? '+' : ''}${item.deltaH.toFixed(casas)}`
                        : '-'}
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {item.cotaPonto !== null ? item.cotaPonto.toFixed(casas) : '-'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn-icon"
                          title="Analisar dados"
                          onClick={() => setInspectItem(item)}
                        >
                          <Eye size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon"
                          title="Editar ponto"
                          onClick={() => {
                            setEditError(null);
                            setEditRaw({ ...item.raw });
                          }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon danger"
                          title="Apagar ponto"
                          onClick={() => handleDelete(item.raw.id, item.raw.nome)}
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

      {calculados.length >= 2 && (
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">
              <Activity size={17} />
              <span>Visualização Gráfica dos Pontos</span>
            </h2>
            <span className="chart-hint">
              <Info size={13} />
              <span>Passe o mouse para valores exatos · Clique duplo para resetar zoom</span>
            </span>
          </div>
          <PlotlyChart data={chartSpec.data} layout={chartSpec.layout} height={360} />
        </div>
      )}

      {/* Inspection Modal */}
      {inspectItem && (
        <Modal
          title={`Análise Detalhada — Ponto ${inspectItem.raw.nome}`}
          icon={<Eye size={18} />}
          onClose={() => setInspectItem(null)}
        >
          <div className="detail-grid">
            <div className="detail-item">
              <span>Cota da Estação</span>
              <span className="mono">
                {cotaEst !== null ? `${cotaEst.toFixed(casas)} m` : 'Não informada'}
              </span>
            </div>
            <div className="detail-item">
              <span>Altura do Instrumento (hi)</span>
              <span className="mono">
                {hi !== null ? `${hi.toFixed(casas)} m` : 'Não informada'}
              </span>
            </div>
            <div className="detail-item">
              <span>Modo de Distância</span>
              <span>{inspectItem.modoDesc}</span>
            </div>
            <div className="detail-item">
              <span>Sentido</span>
              <span>{inspectItem.sentidoStr}</span>
            </div>
            {inspectItem.raw.modoDh === 'fios' ? (
              <>
                <div className="detail-item">
                  <span>FS / FM / FI (m)</span>
                  <span className="mono">
                    {inspectItem.raw.fs.toFixed(4)} / {inspectItem.raw.fm.toFixed(4)} /{' '}
                    {inspectItem.raw.fi.toFixed(4)}
                  </span>
                </div>
                <div className="detail-item">
                  <span>Gerador da Mira (g)</span>
                  <span className="mono">{inspectItem.g.toFixed(6)} m</span>
                </div>
              </>
            ) : (
              <div className="detail-item">
                <span>DH Direta Informada</span>
                <span className="mono">{inspectItem.dh.toFixed(casas)} m</span>
              </div>
            )}
            <div className="detail-item">
              <span>Ângulo Zenital (Z)</span>
              <span className="mono">{decParaGmsStr(inspectItem.zDec, 2)}</span>
            </div>
            <div className="detail-item">
              <span>Ângulo de Inclinação (α)</span>
              <span className="mono">{decParaGmsAssinado(inspectItem.alphaDec, 2)}</span>
            </div>
            <div className="detail-item">
              <span>Distância Vertical (DV)</span>
              <span className="mono">
                {inspectItem.dv >= 0 ? '+' : ''}
                {inspectItem.dv.toFixed(casas)} m
              </span>
            </div>
            <div className="detail-item">
              <span>Distância Horizontal (DH)</span>
              <span className="mono">{inspectItem.dh.toFixed(casas)} m</span>
            </div>
            <div className="detail-item">
              <span>Desnível do Solo (ΔH)</span>
              <span className="mono">
                {inspectItem.deltaH !== null
                  ? `${inspectItem.deltaH >= 0 ? '+' : ''}${inspectItem.deltaH.toFixed(casas)} m`
                  : '-'}
              </span>
            </div>
            <div className="detail-item">
              <span>Distância Inclinada (DI)</span>
              <span className="mono">
                {inspectItem.di !== null ? `${inspectItem.di.toFixed(casas)} m` : '-'}
              </span>
            </div>
            <div className="detail-item">
              <span>Cota Calculada do Ponto</span>
              <span className="mono" style={{ color: 'var(--accent)' }}>
                {inspectItem.cotaPonto !== null ? `${inspectItem.cotaPonto.toFixed(casas)} m` : '-'}
              </span>
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Modal */}
      {editRaw && (
        <Modal
          title={`Editar Ponto ${editRaw.nome}`}
          icon={<Pencil size={18} />}
          onClose={() => setEditRaw(null)}
        >
          {editError && <AlertBanner variant="danger">{editError}</AlertBanner>}
          <div className="form-grid">
            <div className="field">
              <label>Nome do Ponto</label>
              <input
                className="input mono"
                value={editRaw.nome}
                onChange={(e) => setEditRaw({ ...editRaw, nome: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Modo de Distância</label>
              <SegmentedControl
                value={editRaw.modoDh}
                onChange={(val) => setEditRaw({ ...editRaw, modoDh: val })}
                options={[
                  { label: 'Fios', value: 'fios' },
                  { label: 'DH Direta', value: 'direta' },
                ]}
              />
            </div>
          </div>

          {editRaw.modoDh === 'fios' ? (
            <div className="form-grid">
              <div className="field">
                <label>FS (m)</label>
                <input
                  className="input mono"
                  type="number"
                  step="any"
                  value={editRaw.fs || ''}
                  onChange={(e) => setEditRaw({ ...editRaw, fs: parseFloatSafe(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>FM (m)</label>
                <input
                  className="input mono"
                  type="number"
                  step="any"
                  value={editRaw.fm || ''}
                  onChange={(e) => setEditRaw({ ...editRaw, fm: parseFloatSafe(e.target.value) })}
                />
              </div>
              <div className="field">
                <label>FI (m)</label>
                <input
                  className="input mono"
                  type="number"
                  step="any"
                  value={editRaw.fi || ''}
                  onChange={(e) => setEditRaw({ ...editRaw, fi: parseFloatSafe(e.target.value) })}
                />
              </div>
            </div>
          ) : (
            <div className="field">
              <label>DH Direta (m)</label>
              <input
                className="input mono"
                type="number"
                step="any"
                value={editRaw.dhInput || ''}
                onChange={(e) =>
                  setEditRaw({ ...editRaw, dhInput: parseFloatSafe(e.target.value) })
                }
              />
            </div>
          )}

          <div className="form-grid">
            <div className="field">
              <label>Tipo de Ângulo Vertical</label>
              <SegmentedControl
                value={editRaw.tipoAng}
                onChange={(nextTipo) => {
                  const curDec = gmsParaDec(editRaw.angG, editRaw.angM, editRaw.angS);
                  const [g, m, s] = camposGms(curDec, 4);
                  setEditRaw({ ...editRaw, tipoAng: nextTipo, angG: g, angM: m, angS: s });
                }}
                options={[
                  { label: 'Zenital (Z)', value: 'zenital' },
                  { label: 'Inclinação (α)', value: 'alpha' },
                ]}
              />
            </div>
            {editRaw.tipoAng === 'alpha' && (
              <div className="field">
                <label>Sentido</label>
                <SegmentedControl
                  value={editRaw.sentido}
                  onChange={(val) => setEditRaw({ ...editRaw, sentido: val })}
                  options={[
                    { label: 'Aclive (+)', value: 'aclive' },
                    { label: 'Declive (-)', value: 'declive' },
                  ]}
                />
              </div>
            )}
          </div>

          <div className="field">
            <label>Ângulo Vertical (G° M&apos; S&quot;)</label>
            <div className="gms-group">
              <input
                className="input mono"
                value={editRaw.angG}
                onChange={(e) => setEditRaw({ ...editRaw, angG: e.target.value })}
              />
              <input
                className="input mono"
                value={editRaw.angM}
                onChange={(e) => setEditRaw({ ...editRaw, angM: e.target.value })}
              />
              <input
                className="input mono"
                value={editRaw.angS}
                onChange={(e) => setEditRaw({ ...editRaw, angS: e.target.value })}
              />
            </div>
          </div>

          <div className="form-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditRaw(null)}>
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
