import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Box,
  Calculator,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Grid3X3,
  HardHat,
  Info,
  Layers,
  Map as MapIcon,
  Mountain,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Ruler,
  Save,
  Scale,
  Search,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react';
import {
  calcularCaderneta,
  encontrarCotaCompensacao,
  extrairSecoesTerraplenagem,
  interpolarCurvasEntrePontos,
  LeituraCaderneta,
  normalizePointName,
  parseFloatSafe,
  parseOptionalFloat,
  PontoMalha,
  prepararMalhaInterpolada,
  ResultadoInterpolacaoTrecho,
  roundTo,
  SecaoTerraplenagem,
} from '../utils/topoMath';
import { criarCadernetaUfcg, criarMalhaUfcg, UFCG_CONFIG } from '../data/ufcgProject';
import { exportAltimetriaExcel } from '../utils/excelExport';
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

interface Props {
  theme: ThemeMode;
  onCountChange?: (count: number) => void;
}

const STORAGE_KEY = 'toposuite_altimetria_v1';

const TERRAIN_COLORSCALE: [number, string][] = [
  [0.0, '#333399'],
  [0.18, '#0099cc'],
  [0.38, '#55bb66'],
  [0.62, '#eeee88'],
  [0.82, '#c89b6e'],
  [1.0, '#f7f4f0'],
];

const FORMULAS_BY_TAB: Record<'nivelamento' | 'malha' | 'terraplenagem', { title: string; summary: string; items: FormulaItemSpec[] }> = {
  nivelamento: {
    title: 'Guia & Fórmulas — Nivelamento Geométrico Composto',
    summary: 'Em cada estação instalada, a primeira leitura é uma Visada de Ré em um ponto de cota conhecida (RN ou ponto anterior) para achar a Altura do Instrumento (AI). Todas as visadas seguintes subtraem a mira da AI para obter as cotas.',
    items: [
      {
        title: 'Altura do Instrumento (AI)',
        equation: 'AI = Cota_Referência + Leitura_Ré',
        description: 'Define o plano horizontal de visada do nível óptico em cada estação (ex.: E1 e E2).',
      },
      {
        title: 'Cota do Ponto Visado',
        equation: 'Cota_Ponto = AI − Leitura_Vante',
        description: 'Aplica-se tanto para Vante Intermediária quanto para Vante de Mudança.',
      },
      {
        title: 'Prova de Cálculo',
        equation: 'Σ Ré − Σ Vante_Mud = Cota_Final − Cota_Inicial',
        description: 'Garante que não houve erro aritmético no transporte de cotas entre estações de mudança.',
      },
    ],
  },
  malha: {
    title: 'Guia & Fórmulas — Malha 3D & Curvas de Nível',
    summary: 'A superfície é reconstruída por triangulação de Delaunay sobre os pontos (X, Y, Cota), suavizada com filtro Gaussiano e recortada pelo contorno real do terreno. As curvas mestras são destacadas a cada 5 equidistâncias.',
    items: [
      {
        title: 'Interpolação Linear em Trecho',
        equation: 'x = DH_AB · (Cota_Curva − Cota_A) / (Cota_B − Cota_A)',
        description: 'Semelhança de triângulos usada na calculadora rápida para posicionar curvas exatas entre 2 pontos.',
      },
      {
        title: 'Curvas Mestras & Intermediárias',
        equation: 'Passo Mestra = 5 × Equidistância',
        description: 'Linhas mais espessas facilitam a leitura imediata do relevo na planta 2D.',
      },
      {
        title: 'Vínculo com a Aba 1',
        equation: 'Sincronização automática por Nome do Ponto',
        description: 'Ao editar cotas na Caderneta (Aba 1), clique em "Sincronizar Aba 1" para atualizar a malha preservando (X, Y).',
      },
    ],
  },
  terraplenagem: {
    title: 'Guia & Fórmulas — Terraplenagem & Cubagem',
    summary: 'Arraste o controle de Cota do Platô ou use o botão "Compensação (Corte = Aterro)" para equilibrar o movimento de terra automaticamente. Áreas acima do platô geram Corte (vermelho) e abaixo geram Aterro (azul).',
    items: [
      {
        title: 'Áreas na Seção Transversal',
        equation: 'A_trap = ((h1 + h2) / 2) · L  |  Ponto de Passagem exato',
        description: 'Quando o terreno cruza a cota do platô dentro de um trecho, o sistema divide exatamente nos dois triângulos de corte e aterro.',
      },
      {
        title: 'Método das Áreas Médias',
        equation: 'V = ((A_S1 + A_S2) / 2) · Distância_entre_Seções',
        description: 'Calcula o volume de corte e de aterro entre cada par consecutivo de seções transversais.',
      },
      {
        title: 'Balanço de Massa',
        equation: 'Saldo = Vol_Aterro − Vol_Corte',
        description: 'Saldo positivo indica necessidade de empréstimo de solo; negativo indica excesso de corte (bota-fora).',
      },
    ],
  },
};

function buildCutFillSeries(dists: number[], cotas: number[], plato: number) {
  const fineD: number[] = [];
  const fineZ: number[] = [];
  for (let i = 0; i < dists.length - 1; i++) {
    const d1 = dists[i],
      d2 = dists[i + 1];
    const z1 = cotas[i],
      z2 = cotas[i + 1];
    fineD.push(d1);
    fineZ.push(z1);
    const h1 = z1 - plato;
    const h2 = z2 - plato;
    if ((h1 > 0 && h2 < 0) || (h1 < 0 && h2 > 0)) {
      const t = Math.abs(h1) / (Math.abs(h1) + Math.abs(h2));
      fineD.push(d1 + t * (d2 - d1));
      fineZ.push(plato);
    }
  }
  if (dists.length) {
    fineD.push(dists[dists.length - 1]);
    fineZ.push(cotas[cotas.length - 1]);
  }
  return {
    fineD,
    fineZ,
    yPlato: fineD.map(() => plato),
    yCorte: fineZ.map((z) => Math.max(z, plato)),
    yAterro: fineZ.map((z) => Math.min(z, plato)),
  };
}

export const AltimetriaModule: React.FC<Props> = ({ theme, onCountChange }) => {
  const loadSaved = () => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };
  const saved = useMemo(loadSaved, []);

  const [subTab, setSubTab] = useState<'nivelamento' | 'malha' | 'terraplenagem'>('nivelamento');
  const [showGuide, setShowGuide] = useState(false);

  // Core state
  const [cotaInicial, setCotaInicial] = useState<number>(
    saved?.cotaInicial ?? UFCG_CONFIG.cotaInicialRn
  );
  const [cotaPlato, setCotaPlato] = useState<number>(
    saved?.cotaPlato ?? UFCG_CONFIG.cotaPlatoProjeto
  );
  const [casasCota, setCasasCota] = useState<number>(
    saved?.casasCota ?? UFCG_CONFIG.casasDecimaisCota
  );
  const [dadosCampo, setDadosCampo] = useState<LeituraCaderneta[]>(
    Array.isArray(saved?.dadosCampo) ? saved.dadosCampo : criarCadernetaUfcg()
  );
  const [pontosMalha, setPontosMalha] = useState<PontoMalha[]>(
    Array.isArray(saved?.pontosMalha) ? saved.pontosMalha : criarMalhaUfcg()
  );

  // Filters
  const [cadSearch, setCadSearch] = useState('');
  const [cadEstFilter, setCadEstFilter] = useState('todas');
  const [malhaSearch, setMalhaSearch] = useState('');
  const [malhaTipoFilter, setMalhaTipoFilter] = useState<'todos' | 'grade' | 'borda' | 'vertice'>('todos');

  // Sub-tab 1 form
  const [estacao, setEstacao] = useState(UFCG_CONFIG.estacaoSugerida);
  const [pontoVisado, setPontoVisado] = useState('');
  const [tipoLeitura, setTipoLeitura] = useState<'inter' | 'mudanca' | 're'>('inter');
  const [leituraMira, setLeituraMira] = useState('');
  const [pontoRefRe, setPontoRefRe] = useState('');
  const [msgAba1, setMsgAba1] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);
  const [editCad, setEditCad] = useState<LeituraCaderneta | null>(null);

  // Sub-tab 2 form & plot controls
  const [gradeCols, setGradeCols] = useState(7);
  const [gradeRows, setGradeRows] = useState(7);
  const [gradeDx, setGradeDx] = useState(2.0);
  const [gradeDy, setGradeDy] = useState(2.0);

  const [offNome, setOffNome] = useState('');
  const [offBase, setOffBase] = useState('');
  const [offDir, setOffDir] = useState<'+X' | '-X' | '+Y' | '-Y'>('+X');
  const [offDist, setOffDist] = useState(0.0);
  const [offCota, setOffCota] = useState(UFCG_CONFIG.cotaInicialRn);

  const [manNome, setManNome] = useState('');
  const [manX, setManX] = useState(0.0);
  const [manY, setManY] = useState(0.0);
  const [manZ, setManZ] = useState(UFCG_CONFIG.cotaInicialRn);

  const [equidistancia, setEquidistancia] = useState(UFCG_CONFIG.equidistanciaCurvas);
  const [recortarContorno, setRecortarContorno] = useState(true);
  const [mostrarRotulos, setMostrarRotulos] = useState(true);
  const [exageroZ, setExageroZ] = useState(0.45);
  const [projBase3d, setProjBase3d] = useState(true);

  const [interpCotaA, setInterpCotaA] = useState(UFCG_CONFIG.interpolacaoExemplo.cotaA);
  const [interpCotaB, setInterpCotaB] = useState(UFCG_CONFIG.interpolacaoExemplo.cotaB);
  const [interpDhAb, setInterpDhAb] = useState(UFCG_CONFIG.interpolacaoExemplo.dhAb);
  const [interpRes, setInterpRes] = useState<ResultadoInterpolacaoTrecho[] | null>(null);

  const [msgAba2, setMsgAba2] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);

  // Sub-tab 3 state
  const [perfilSel, setPerfilSel] = useState<string>('todos');
  const [msgAba3, setMsgAba3] = useState<{
    variant: 'info' | 'success' | 'warning' | 'danger';
    text: string;
  } | null>(null);

  const chart2dRef = useRef<PlotlyChartHandle | null>(null);
  const chart3dRef = useRef<PlotlyChartHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    onCountChange?.(dadosCampo.length);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ cotaInicial, cotaPlato, casasCota, dadosCampo, pontosMalha })
      );
    } catch {
      // ignore
    }
  }, [cotaInicial, cotaPlato, casasCota, dadosCampo, pontosMalha, onCountChange]);

  useEffect(() => {
    if (pontosMalha.length && !pontosMalha.some((p) => p.ponto === offBase)) {
      setOffBase(pontosMalha[0].ponto);
    }
  }, [pontosMalha, offBase]);

  // Calculations
  const cadCalc = useMemo(
    () => calcularCaderneta(dadosCampo, cotaInicial),
    [dadosCampo, cotaInicial]
  );

  const estacoesUnicas = useMemo(
    () => Array.from(new Set(cadCalc.linhas.map((l) => l.estacao))).filter(Boolean),
    [cadCalc.linhas]
  );

  const linhasFiltradas = useMemo(() => {
    const q = cadSearch.trim().toLowerCase();
    return cadCalc.linhas.filter((l) => {
      if (cadEstFilter !== 'todas' && l.estacao !== cadEstFilter) return false;
      if (q && !l.ponto.toLowerCase().includes(q) && !l.estacao.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [cadCalc.linhas, cadSearch, cadEstFilter]);

  const malhaFiltrada = useMemo(() => {
    const q = malhaSearch.trim().toLowerCase();
    return pontosMalha.filter((p) => {
      if (malhaTipoFilter !== 'todos' && p.tipo !== malhaTipoFilter) return false;
      if (q && !p.ponto.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [pontosMalha, malhaSearch, malhaTipoFilter]);

  const malhaBounds = useMemo(() => {
    if (!pontosMalha.length) return { min: 519.8, max: 520.6 };
    const zs = pontosMalha.map((p) => p.cota);
    return {
      min: roundTo(Math.min(...zs) - 0.05, 3),
      max: roundTo(Math.max(...zs) + 0.05, 3),
    };
  }, [pontosMalha]);

  const malhaInterp = useMemo(
    () =>
      prepararMalhaInterpolada(
        pontosMalha,
        Math.max(0.01, equidistancia),
        recortarContorno,
        UFCG_CONFIG.contornoPerimetro,
        130
      ),
    [pontosMalha, equidistancia, recortarContorno]
  );

  const terraCalc = useMemo(
    () =>
      extrairSecoesTerraplenagem(
        pontosMalha,
        cotaPlato,
        UFCG_CONFIG.secaoBordaSuperior,
        UFCG_CONFIG.rotulosSecoesY
      ),
    [pontosMalha, cotaPlato]
  );

  // Handlers
  const handleAddLeitura = (e: React.FormEvent) => {
    e.preventDefault();
    const ptNome = pontoVisado.trim();
    const val = parseOptionalFloat(leituraMira);
    if (!ptNome || val === null) {
      setMsgAba1({
        variant: 'warning',
        text: 'Informe o nome do Ponto Visado e a leitura da mira (m).',
      });
      return;
    }
    const nova: LeituraCaderneta = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      estacao: estacao.trim() || 'Estação E1',
      ponto: ptNome,
      re: tipoLeitura === 're' ? val : null,
      vante_inter: tipoLeitura === 'inter' ? val : null,
      vante_mudanca: tipoLeitura === 'mudanca' ? val : null,
      ponto_ref_re: tipoLeitura === 're' ? pontoRefRe.trim() : '',
    };
    setDadosCampo((prev) => [...prev, nova]);
    setPontoVisado('');
    setLeituraMira('');
    setMsgAba1({
      variant: 'success',
      text: `Leitura de '${ptNome}' (${val.toFixed(3)} m) adicionada e salva automaticamente.`,
    });
  };

  const handleSaveEditCad = () => {
    if (!editCad) return;
    setDadosCampo((prev) => prev.map((item) => (item.id === editCad.id ? editCad : item)));
    setEditCad(null);
    setMsgAba1({ variant: 'success', text: `Leitura '${editCad.ponto}' atualizada.` });
  };

  const handleDeleteCad = (id: number, nome: string) => {
    setDadosCampo((prev) => prev.filter((item) => item.id !== id));
    setMsgAba1({ variant: 'info', text: `Leitura '${nome}' removida da caderneta.` });
  };

  const handleRestaurarUfcg = () => {
    const cad = criarCadernetaUfcg();
    const malha = criarMalhaUfcg();
    setDadosCampo(cad);
    setPontosMalha(malha);
    setCotaInicial(UFCG_CONFIG.cotaInicialRn);
    setCotaPlato(UFCG_CONFIG.cotaPlatoProjeto);
    setEquidistancia(UFCG_CONFIG.equidistanciaCurvas);
    setMsgAba1({
      variant: 'success',
      text: `${UFCG_CONFIG.nomeProjeto} restaurado (${cad.length} leituras + ${malha.length} pontos na malha).`,
    });
  };

  const handleLimparCaderneta = () => {
    setDadosCampo([]);
    setMsgAba1({ variant: 'info', text: 'Caderneta altimétrica limpa.' });
  };

  const handleExportJson = () => {
    const payload = {
      projeto: UFCG_CONFIG.nomeProjeto,
      exportadoEm: new Date().toISOString(),
      cotaInicial,
      cotaPlato,
      casasCota,
      equidistancia,
      dadosCampo,
      pontosMalha,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'topografia_projeto_backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsgAba1({ variant: 'success', text: 'Backup JSON exportado com sucesso.' });
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (Array.isArray(data.dadosCampo)) setDadosCampo(data.dadosCampo);
        if (Array.isArray(data.pontosMalha)) setPontosMalha(data.pontosMalha);
        if (typeof data.cotaInicial === 'number') setCotaInicial(data.cotaInicial);
        if (typeof data.cotaPlato === 'number') setCotaPlato(data.cotaPlato);
        setMsgAba1({ variant: 'success', text: `Projeto importado de '${file.name}'.` });
      } catch {
        setMsgAba1({ variant: 'danger', text: 'Arquivo JSON inválido.' });
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportExcel = async () => {
    const chart2dPng = await chart2dRef.current?.toPng(940, 620);
    const chart3dPng = await chart3dRef.current?.toPng(940, 620);
    await exportAltimetriaExcel({
      linhas: cadCalc.linhas,
      prova: cadCalc.prova,
      malha: pontosMalha,
      terraplenagem: terraCalc,
      casasCota,
      chart2dPng,
      chart3dPng,
    });
    setMsgAba1({
      variant: 'success',
      text: 'Planilha Excel (planilha_altimetria_terraplenagem.xlsx) gerada com 4 abas.',
    });
  };

  const handleGerarGrade = () => {
    const ncols = Math.max(2, Math.min(26, Math.floor(gradeCols)));
    const nrows = Math.max(2, Math.min(50, Math.floor(gradeRows)));
    const cotasMapa = cadCalc.prova?.cotas_mapa ?? {};
    const novos: PontoMalha[] = [];
    let idAcc = 1;
    for (let r = 1; r <= nrows; r++) {
      for (let c = 0; c < ncols; c++) {
        const letra = String.fromCharCode(65 + c);
        const nomePt = `${letra}${r}`;
        const cotaPt = cotasMapa[normalizePointName(nomePt)] ?? cotaInicial;
        novos.push({
          id: idAcc++,
          ponto: nomePt,
          x: roundTo(c * gradeDx, 4),
          y: roundTo((r - 1) * gradeDy, 4),
          cota: Number(cotaPt),
          tipo: 'grade',
        });
      }
    }
    setPontosMalha(novos);
    setMsgAba2({
      variant: 'success',
      text: `Grade ortogonal ${ncols}×${nrows} (${novos.length} nós) gerada e vinculada às cotas da Caderneta.`,
    });
  };

  const handleAddOffset = () => {
    const nomeNovo = offNome.trim();
    const basePt = pontosMalha.find((p) => p.ponto === offBase);
    if (!nomeNovo || !basePt) {
      setMsgAba2({
        variant: 'warning',
        text: 'Informe o nome do novo ponto e selecione um ponto base válido da malha.',
      });
      return;
    }
    let nx = basePt.x;
    let ny = basePt.y;
    if (offDir === '+X') nx += offDist;
    else if (offDir === '-X') nx -= offDist;
    else if (offDir === '+Y') ny += offDist;
    else if (offDir === '-Y') ny -= offDist;

    const cotasMapa = cadCalc.prova?.cotas_mapa ?? {};
    const cotaFinal = cotasMapa[normalizePointName(nomeNovo)] ?? offCota;

    setPontosMalha((prev) => {
      const idx = prev.findIndex(
        (p) => normalizePointName(p.ponto) === normalizePointName(nomeNovo)
      );
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = {
          ...copy[idx],
          ponto: nomeNovo,
          x: roundTo(nx, 4),
          y: roundTo(ny, 4),
          cota: cotaFinal,
          tipo: 'borda',
        };
        return copy;
      }
      return [
        ...prev,
        {
          id: Date.now(),
          ponto: nomeNovo,
          x: roundTo(nx, 4),
          y: roundTo(ny, 4),
          cota: cotaFinal,
          tipo: 'borda',
        },
      ];
    });
    setOffNome('');
    setMsgAba2({
      variant: 'success',
      text: `Ponto de borda '${nomeNovo}' calculado a partir de '${basePt.ponto}' (${offDir} ${offDist.toFixed(3)} m) -> X=${nx.toFixed(3)} m, Y=${ny.toFixed(3)} m, Cota=${cotaFinal.toFixed(4)} m.`,
    });
  };

  const handleAddManual3d = () => {
    const nm = manNome.trim() || `P${pontosMalha.length + 1}`;
    setPontosMalha((prev) => [
      ...prev,
      { id: Date.now(), ponto: nm, x: manX, y: manY, cota: manZ, tipo: 'borda' },
    ]);
    setManNome('');
    setMsgAba2({ variant: 'success', text: `Ponto manual '${nm}' adicionado à malha.` });
  };

  const handleSyncAba1 = () => {
    if (!cadCalc.prova) {
      setMsgAba2({ variant: 'warning', text: 'A Caderneta da Aba 1 está vazia.' });
      return;
    }
    const cotasMapa = cadCalc.prova.cotas_mapa;
    let atualizados = 0;
    setPontosMalha((prev) =>
      prev.map((pt) => {
        const norm = normalizePointName(pt.ponto);
        if (norm in cotasMapa) {
          atualizados++;
          return { ...pt, cota: cotasMapa[norm] };
        }
        return pt;
      })
    );
    setMsgAba2({
      variant: 'success',
      text: `Sincronização concluída: ${atualizados} pontos tiveram suas cotas atualizadas preservando (X, Y).`,
    });
  };

  const handleLimparMalha = () => {
    setPontosMalha([]);
    setMsgAba2({ variant: 'info', text: 'Malha 3D limpa.' });
  };

  const handleInterpolarTrecho = () => {
    setInterpRes(interpolarCurvasEntrePontos(interpCotaA, interpCotaB, interpDhAb, equidistancia));
  };

  const handleAdotarCotaMedia = () => {
    if (!pontosMalha.length) return;
    const media = pontosMalha.reduce((acc, p) => acc + p.cota, 0) / pontosMalha.length;
    const rounded = roundTo(media, 4);
    setCotaPlato(rounded);
    setMsgAba3({
      variant: 'info',
      text: `Cota média aritmética da malha aplicada como platô: ${rounded.toFixed(4)} m.`,
    });
  };

  const handleCompensarVolumes = () => {
    const ideal = encontrarCotaCompensacao(
      pontosMalha,
      UFCG_CONFIG.secaoBordaSuperior,
      UFCG_CONFIG.rotulosSecoesY
    );
    if (ideal === null) return;
    setCotaPlato(ideal);
    setMsgAba3({
      variant: 'success',
      text: `Cota de compensação encontrada: ${ideal.toFixed(4)} m — volumes de Corte e Aterro equilibrados.`,
    });
  };

  // ==========================================================================
  // PLOTLY SPECS
  // ==========================================================================

  const perfilChartSpec = useMemo(() => {
    const pt = getPlotTheme(theme);
    const { perfil } = cadCalc;
    if (perfil.length < 2) return null;
    const xs = perfil.map((_, i) => i);
    const labels = perfil.map((p) => p.ponto);
    const cotas = perfil.map((p) => p.cota);
    const minC = Math.min(...cotas, cotaPlato);
    const maxC = Math.max(...cotas, cotaPlato);
    const margin = maxC !== minC ? (maxC - minC) * 0.22 : 0.5;
    const yFloor = minC - margin;
    const yCeil = maxC + margin;

    // Thin X-axis ticks cleanly so 72 points never collide
    const step = Math.max(1, Math.ceil(xs.length / 22));
    const tickVals: number[] = [];
    const tickText: string[] = [];
    for (let i = 0; i < xs.length; i += step) {
      tickVals.push(xs[i]);
      tickText.push(labels[i]);
    }
    if (tickVals[tickVals.length - 1] !== xs[xs.length - 1]) {
      tickVals.push(xs[xs.length - 1]);
      tickText.push(labels[labels.length - 1]);
    }

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
          mode: 'lines+markers',
          x: xs,
          y: cotas,
          text: labels.map((l, i) => `${l} (${perfil[i].estacao})`),
          hovertemplate: '<b>%{text}</b><br>Cota: %{y:.4f} m<extra></extra>',
          line: { color: pt.accent, width: 2.3 },
          marker: { size: 5.5, color: pt.accent, line: { color: pt.paperBg, width: 1 } },
          fill: 'tonexty',
          fillcolor: pt.accentFill,
          name: 'Terreno Natural',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: [0, xs.length - 1],
          y: [cotaPlato, cotaPlato],
          line: { color: pt.danger, width: 2, dash: 'dash' },
          name: `Platô (${cotaPlato.toFixed(casasCota)} m)`,
        },
      ],
      layout: {
        title: {
          text: 'Perfil Altimétrico dos Pontos Nivelados',
          font: { size: 14, color: pt.title },
          y: 0.96,
        },
        paper_bgcolor: pt.paperBg,
        plot_bgcolor: pt.plotBg,
        font: { color: pt.text },
        hovermode: 'closest',
        xaxis: {
          title: { text: 'Sequência de Pontos Nivelados', standoff: 14 },
          tickmode: 'array',
          tickvals: tickVals,
          ticktext: tickText,
          tickangle: -40,
          tickfont: { size: 10 },
          gridcolor: pt.grid,
        },
        yaxis: {
          title: { text: 'Cota / Altitude (m)', standoff: 10 },
          range: [yFloor, yCeil],
          gridcolor: pt.grid,
        },
        legend: {
          orientation: 'h',
          x: 0.5,
          xanchor: 'center',
          y: 1.03,
          yanchor: 'bottom',
          bgcolor: 'transparent',
          borderwidth: 0,
        },
        margin: { l: 68, r: 24, t: 74, b: 78 },
      },
    };
  }, [cadCalc, cotaPlato, casasCota, theme]);

  const contour2dSpec = useMemo(() => {
    const pt = getPlotTheme(theme);
    if (!malhaInterp) return null;
    const { xi, yi, ziMasked, polyVerts, niveis, equidistancia: eq } = malhaInterp;

    const traces: Record<string, unknown>[] = [];

    traces.push({
      type: 'contour',
      x: xi,
      y: yi,
      z: ziMasked,
      colorscale: TERRAIN_COLORSCALE,
      connectgaps: false,
      contours: {
        coloring: 'heatmap',
        start: niveis[0],
        end: niveis[niveis.length - 1],
        size: eq,
        showlabels: true,
        labelfont: { size: 10, color: '#1b110d' },
      },
      line: { color: '#4e342e', width: 1.15 },
      colorbar: {
        title: { text: 'Cota (m)', font: { color: pt.text } },
        tickfont: { color: pt.text },
        thickness: 15,
        len: 0.85,
      },
      hovertemplate: 'X: %{x:.2f} m<br>Y: %{y:.2f} m<br>Cota: %{z:.4f} m<extra>Superfície</extra>',
      name: 'Curvas de Nível',
    });

    traces.push({
      type: 'contour',
      x: xi,
      y: yi,
      z: ziMasked,
      showscale: false,
      connectgaps: false,
      contours: {
        coloring: 'none',
        start: Math.floor(niveis[0] / (eq * 5)) * (eq * 5),
        end: niveis[niveis.length - 1],
        size: eq * 5,
        showlabels: true,
        labelfont: { size: 11, color: '#1b0000' },
      },
      line: { color: '#1b0000', width: 2.3 },
      hoverinfo: 'skip',
      name: 'Curvas Mestras',
    });

    const gradePts = pontosMalha.filter((p) => p.tipo === 'grade');
    const gridXLines: (number | null)[] = [];
    const gridYLines: (number | null)[] = [];
    const uniqueXs = Array.from(new Set(gradePts.map((p) => roundTo(p.x, 3)))).sort((a, b) => a - b);
    const uniqueYs = Array.from(new Set(gradePts.map((p) => roundTo(p.y, 3)))).sort((a, b) => a - b);

    uniqueXs.forEach((gx) => {
      const col = gradePts.filter((p) => Math.abs(p.x - gx) < 1e-3).sort((a, b) => a.y - b.y);
      if (col.length >= 2) {
        col.forEach((p) => {
          gridXLines.push(p.x);
          gridYLines.push(p.y);
        });
        gridXLines.push(null);
        gridYLines.push(null);
      }
    });
    uniqueYs.forEach((gy) => {
      const row = gradePts.filter((p) => Math.abs(p.y - gy) < 1e-3).sort((a, b) => a.x - b.x);
      if (row.length >= 2) {
        row.forEach((p) => {
          gridXLines.push(p.x);
          gridYLines.push(p.y);
        });
        gridXLines.push(null);
        gridYLines.push(null);
      }
    });
    if (gridXLines.length) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: gridXLines,
        y: gridYLines,
        line: { color: '#1f4e78', dash: 'dot', width: 1 },
        opacity: 0.55,
        hoverinfo: 'skip',
        name: 'Grade Ortogonal',
      });
    }

    if (polyVerts && polyVerts.length >= 3) {
      const closed = [...polyVerts, polyVerts[0]];
      traces.push({
        type: 'scatter',
        mode: 'lines',
        x: closed.map((v) => v[0]),
        y: closed.map((v) => v[1]),
        line: { color: pt.perimeter, width: 2.6 },
        name: 'Contorno do Terreno',
        hoverinfo: 'skip',
      });
    }

    // Deduplicate overlapping on-canvas point labels (e.g., V3 & A1 at (0,0), P1 & A2 at 3cm)
    // and render them as crisp translucent pills so contrast is 100% readable in both Light & Dark Mode
    const placedLabels: [number, number][] = [];
    const xsAll = pontosMalha.map((p) => p.x);
    const ysAll = pontosMalha.map((p) => p.y);
    const minDistLabel = Math.max(
      (Math.max(...xsAll) - Math.min(...xsAll)) * 0.048,
      (Math.max(...ysAll) - Math.min(...ysAll)) * 0.048,
      0.55
    );
    const pointAnnotations: Record<string, unknown>[] = [];
    if (mostrarRotulos) {
      pontosMalha.forEach((p) => {
        const tooClose = placedLabels.some(
          ([lx, ly]) => Math.hypot(p.x - lx, p.y - ly) < minDistLabel
        );
        if (tooClose) return;
        placedLabels.push([p.x, p.y]);
        pointAnnotations.push({
          x: p.x,
          y: p.y,
          text: p.ponto,
          showarrow: false,
          yshift: 11,
          font: {
            size: 9,
            color: theme === 'dark' ? '#f8fafc' : '#0f172a',
            family: 'Inter, sans-serif',
          },
          bgcolor: theme === 'dark' ? 'rgba(15, 23, 42, 0.78)' : 'rgba(255, 255, 255, 0.82)',
          borderpad: 2,
        });
      });
    }

    traces.push({
      type: 'scatter',
      mode: 'markers',
      x: xsAll,
      y: ysAll,
      customdata: pontosMalha.map((p) => [p.ponto, p.cota]),
      marker: { size: 6.5, color: '#ef4444', line: { color: '#ffffff', width: 1 } },
      hovertemplate:
        '<b>%{customdata[0]}</b><br>X: %{x:.3f} m<br>Y: %{y:.3f} m<br>Cota: %{customdata[1]:.4f} m<extra></extra>',
      name: 'Pontos Levantados',
    });

    const xSpan = Math.max(Math.max(...xsAll) - Math.min(...xsAll), 1);
    const ySpan = Math.max(Math.max(...ysAll) - Math.min(...ysAll), 1);

    return {
      data: traces,
      layout: {
        title: {
          text: `Planta Topográfica — Curvas de Nível (Equidistância = ${eq.toFixed(2)} m)`,
          font: { size: 14.5, color: pt.title },
          y: 0.97,
        },
        annotations: pointAnnotations,
        paper_bgcolor: pt.paperBg,
        plot_bgcolor: pt.plotBg,
        font: { color: pt.text },
        hovermode: 'closest',
        xaxis: {
          title: { text: 'Coordenada X (m)', standoff: 10 },
          range: [Math.min(...xsAll) - xSpan * 0.08, Math.max(...xsAll) + xSpan * 0.08],
          gridcolor: pt.grid,
        },
        yaxis: {
          title: { text: 'Coordenada Y (m)', standoff: 10 },
          range: [Math.min(...ysAll) - ySpan * 0.08, Math.max(...ysAll) + ySpan * 0.1],
          gridcolor: pt.grid,
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
        margin: { l: 64, r: 24, t: 78, b: 58 },
      },
    };
  }, [malhaInterp, pontosMalha, mostrarRotulos, theme]);

  const mdt3dSpec = useMemo(() => {
    const pt = getPlotTheme(theme);
    if (!malhaInterp) return null;
    const { xi, yi, ziMasked, polyVerts, polyZ, niveis, equidistancia: eq } = malhaInterp;

    const traces: Record<string, unknown>[] = [
      {
        type: 'surface',
        x: xi,
        y: yi,
        z: ziMasked,
        colorscale: TERRAIN_COLORSCALE,
        colorbar: {
          title: { text: 'Cota (m)', font: { color: pt.text } },
          tickfont: { color: pt.text },
          thickness: 15,
          len: 0.78,
        },
        hovertemplate: 'X: %{x:.2f} m<br>Y: %{y:.2f} m<br>Cota: %{z:.4f} m<extra>Superfície</extra>',
        contours: {
          z: {
            show: true,
            start: niveis[0],
            end: niveis[niveis.length - 1],
            size: eq,
            usecolormap: false,
            color: '#2c1810',
            width: 2,
            project: { z: projBase3d },
          },
        },
        name: 'Terreno Interpolado',
      },
    ];

    if (polyVerts && polyZ && polyVerts.length >= 3) {
      const closedXY = [...polyVerts, polyVerts[0]];
      const closedZ = [...polyZ, polyZ[0]];
      traces.push({
        type: 'scatter3d',
        mode: 'lines',
        x: closedXY.map((v) => v[0]),
        y: closedXY.map((v) => v[1]),
        z: closedZ.map((z) => z + 0.003),
        line: { color: pt.perimeter, width: 5 },
        name: 'Contorno do Terreno',
        hoverinfo: 'skip',
      });
    }

    traces.push({
      type: 'scatter3d',
      mode: mostrarRotulos ? 'markers+text' : 'markers',
      x: pontosMalha.map((p) => p.x),
      y: pontosMalha.map((p) => p.y),
      z: pontosMalha.map((p) => p.cota + 0.004),
      text: pontosMalha.map((p) => p.ponto),
      textposition: 'top center',
      textfont: { size: 9, color: pt.text },
      marker: { size: 3.8, color: '#ef4444', line: { color: '#ffffff', width: 0.5 } },
      hovertemplate: '<b>%{text}</b><br>X: %{x:.3f} m<br>Y: %{y:.3f} m<br>Cota: %{z:.4f} m<extra></extra>',
      name: 'Pontos Levantados',
    });

    const xs = pontosMalha.map((p) => p.x);
    const ys = pontosMalha.map((p) => p.y);
    const dxRange = Math.max(Math.max(...xs) - Math.min(...xs), 1.0);
    const dyRange = Math.max(Math.max(...ys) - Math.min(...ys), 1.0);
    const maxXY = Math.max(dxRange, dyRange);

    return {
      data: traces,
      layout: {
        title: {
          text: `Modelo Digital do Terreno — MDT 3D Interativo (Equidistância = ${eq.toFixed(2)} m)`,
          font: { size: 14.5, color: pt.title },
          y: 0.97,
        },
        uirevision: 'manter_camera_3d',
        paper_bgcolor: pt.paperBg,
        font: { color: pt.text },
        scene: {
          bgcolor: pt.plotBg,
          xaxis: { title: 'X (m)', gridcolor: pt.grid, backgroundcolor: pt.plotBg, showbackground: true },
          yaxis: { title: 'Y (m)', gridcolor: pt.grid, backgroundcolor: pt.plotBg, showbackground: true },
          zaxis: { title: 'Cota (m)', gridcolor: pt.grid, backgroundcolor: pt.plotBg, showbackground: true },
          aspectmode: 'manual',
          aspectratio: { x: dxRange / maxXY, y: dyRange / maxXY, z: exageroZ },
          camera: { eye: { x: -1.45, y: -1.55, z: 1.05 } },
        },
        legend: {
          orientation: 'h',
          x: 0.5,
          xanchor: 'center',
          y: 1.01,
          yanchor: 'bottom',
          bgcolor: 'transparent',
          borderwidth: 0,
        },
        margin: { l: 10, r: 10, t: 74, b: 10 },
      },
    };
  }, [malhaInterp, pontosMalha, mostrarRotulos, exageroZ, projBase3d, theme]);

  const buildPerfilTerraplenagemSpec = (sec: SecaoTerraplenagem, plato: number) => {
    const pt = getPlotTheme(theme);
    const { fineD, yPlato, yCorte, yAterro } = buildCutFillSeries(
      sec.distancias,
      sec.cotas,
      plato
    );

    const span = Math.max(sec.distancias[sec.distancias.length - 1] || 1, 1);
    const minY = Math.min(...sec.cotas, plato);
    const maxY = Math.max(...sec.cotas, plato);
    const ySpan = Math.max(maxY - minY, 0.12);

    // 1. De-collide X-axis ticks (skip micro-offsets like P1/A2 3cm apart or G4/P17 2.4cm apart)
    const minTickGap = span * 0.095;
    const tickVals: number[] = [];
    const tickText: string[] = [];
    sec.distancias.forEach((d, i) => {
      const label = `${sec.pontos[i]} (${d.toFixed(1)}m)`;
      if (tickVals.length === 0) {
        tickVals.push(d);
        tickText.push(label);
        return;
      }
      const prevD = tickVals[tickVals.length - 1];
      if (d - prevD >= minTickGap) {
        tickVals.push(d);
        tickText.push(label);
      } else if (i === sec.distancias.length - 1) {
        // Keep the very last boundary point label if close to the previous tick
        tickVals[tickVals.length - 1] = d;
        tickText[tickText.length - 1] = label;
      }
    });

    // 2. De-collide point annotations on the curve with elevation-aware staggering:
    // Whenever two adjacent points are horizontally close (< 9.5% of span),
    // the higher point is placed ABOVE ('top center') and the lower point BELOW ('bottom center')
    // so labels always diverge away from each other instead of crossing!
    const pointTexts: string[] = sec.pontos.map((nm, i) => `${nm}<br>${sec.cotas[i].toFixed(3)}`);
    const pointPositions: string[] = sec.cotas.map((z) => {
      const nearUnderPlato = z < plato && plato - z < ySpan * 0.16;
      return nearUnderPlato ? 'bottom center' : 'top center';
    });

    for (let i = 1; i < sec.distancias.length; i++) {
      const gap = sec.distancias[i] - sec.distancias[i - 1];
      if (gap < span * 0.095) {
        const zPrev = sec.cotas[i - 1];
        const zCurr = sec.cotas[i];
        if (zCurr > zPrev + 1e-6) {
          pointPositions[i - 1] = 'bottom center';
          pointPositions[i] = 'top center';
        } else if (zPrev > zCurr + 1e-6) {
          pointPositions[i - 1] = 'top center';
          pointPositions[i] = 'bottom center';
        } else {
          pointPositions[i - 1] = 'bottom center';
          pointPositions[i] = 'top center';
        }
      }
    }

    return {
      data: [
        {
          type: 'scatter',
          mode: 'lines',
          x: fineD,
          y: yPlato,
          line: { color: pt.accent, width: 2 },
          name: `Platô (${plato.toFixed(4)} m)`,
          hoverinfo: 'skip',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: fineD,
          y: yCorte,
          fill: 'tonexty',
          fillcolor: pt.cutFill,
          line: { width: 0 },
          name: `Corte (${sec.areaCorte.toFixed(4)} m²)`,
          hoverinfo: 'skip',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: fineD,
          y: yPlato,
          line: { width: 0 },
          showlegend: false,
          hoverinfo: 'skip',
        },
        {
          type: 'scatter',
          mode: 'lines',
          x: fineD,
          y: yAterro,
          fill: 'tonexty',
          fillcolor: pt.fillFill,
          line: { width: 0 },
          name: `Aterro (${sec.areaAterro.toFixed(4)} m²)`,
          hoverinfo: 'skip',
        },
        {
          type: 'scatter',
          mode: 'lines+markers+text',
          x: sec.distancias,
          y: sec.cotas,
          text: pointTexts,
          textposition: pointPositions,
          customdata: sec.pontos.map((nm, i) => [nm, sec.cotas[i]]),
          textfont: { size: 9.5, color: pt.text },
          line: { color: pt.danger, width: 2.3 },
          marker: { size: 6.5, color: pt.danger, line: { color: pt.paperBg, width: 1.2 } },
          hovertemplate:
            '<b>%{customdata[0]}</b><br>Distância: %{x:.3f} m<br>Cota: %{customdata[1]:.4f} m<extra>Terreno</extra>',
          name: 'Terreno Natural',
        },
      ],
      layout: {
        title: {
          text: `${sec.secao} — Corte: ${sec.areaCorte.toFixed(4)} m² | Aterro: ${sec.areaAterro.toFixed(4)} m²`,
          font: { size: 13, color: pt.title },
          y: 0.97,
          yanchor: 'top',
        },
        paper_bgcolor: pt.paperBg,
        plot_bgcolor: pt.plotBg,
        font: { color: pt.text },
        hovermode: 'closest',
        xaxis: {
          title: { text: 'Distância na Seção (m)', standoff: 14 },
          range: [-span * 0.09, span * 1.1],
          tickmode: 'array',
          tickvals: tickVals,
          ticktext: tickText,
          tickangle: -32,
          tickfont: { size: 9.5 },
          gridcolor: pt.grid,
        },
        yaxis: {
          title: { text: 'Cota (m)', standoff: 8 },
          range: [minY - ySpan * 0.36, maxY + ySpan * 0.36],
          gridcolor: pt.grid,
        },
        legend: {
          orientation: 'h',
          x: 0.5,
          xanchor: 'center',
          y: 1.02,
          yanchor: 'bottom',
          bgcolor: 'transparent',
          borderwidth: 0,
          font: { size: 10.5 },
        },
        margin: { l: 64, r: 22, t: 88, b: 84 },
      },
    };
  };

  const activeGuide = FORMULAS_BY_TAB[subTab];
  const cutPct = useMemo(() => {
    if (!terraCalc) return 50;
    const total = terraCalc.volCorteTotal + terraCalc.volAterroTotal;
    if (total <= 1e-9) return 50;
    return (terraCalc.volCorteTotal / total) * 100;
  }, [terraCalc]);

  return (
    <>
      <div className="module-header">
        <div className="module-title-group">
          <div className="module-icon-box">
            <Mountain size={23} />
          </div>
          <div>
            <h1 className="module-title">Altimetria, Curvas de Nível & Terraplenagem</h1>
            <p className="module-desc">
              Fluxo completo em 3 etapas: caderneta de nivelamento, geração da malha 3D / curvas de nível e cubagem de corte e aterro.
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
          <button type="button" className="btn btn-secondary" onClick={handleRestaurarUfcg}>
            <RotateCcw size={15} />
            <span>Restaurar UFCG</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExportExcel}>
            <FileSpreadsheet size={15} />
            <span>Excel (4 Abas)</span>
          </button>
          <button type="button" className="btn btn-secondary" onClick={handleExportJson}>
            <Download size={15} />
            <span>Backup</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload size={15} />
            <span>Importar</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            style={{ display: 'none' }}
            onChange={handleImportJson}
          />
        </div>
      </div>

      {/* 3-Step Workflow Sub-tabs */}
      <div className="subtabs">
        <button
          type="button"
          className={`subtab ${subTab === 'nivelamento' ? 'active' : ''}`}
          onClick={() => setSubTab('nivelamento')}
        >
          <Activity size={16} />
          <span>1. Nivelamento & Perfil</span>
          <span className="nav-badge mono" style={subTab === 'nivelamento' ? { background: 'rgba(255,255,255,0.2)', color: 'inherit' } : undefined}>
            {dadosCampo.length}
          </span>
        </button>
        <button
          type="button"
          className={`subtab ${subTab === 'malha' ? 'active' : ''}`}
          onClick={() => setSubTab('malha')}
        >
          <MapIcon size={16} />
          <span>2. Malha 3D & Curvas</span>
          <span className="nav-badge mono" style={subTab === 'malha' ? { background: 'rgba(255,255,255,0.2)', color: 'inherit' } : undefined}>
            {pontosMalha.length}
          </span>
        </button>
        <button
          type="button"
          className={`subtab ${subTab === 'terraplenagem' ? 'active' : ''}`}
          onClick={() => setSubTab('terraplenagem')}
        >
          <HardHat size={16} />
          <span>3. Terraplenagem & Volumes</span>
        </button>
      </div>

      <FormulaDrawer
        open={showGuide}
        title={activeGuide.title}
        summary={activeGuide.summary}
        items={activeGuide.items}
        onClose={() => setShowGuide(false)}
      />

      {/* ==================================================================== */}
      {/* SUB-ABA 1: NIVELAMENTO GEOMÉTRICO COMPOSTO                           */}
      {/* ==================================================================== */}
      {subTab === 'nivelamento' && (
        <>
          <form className="card" onSubmit={handleAddLeitura}>
            <div className="card-header">
              <h2 className="card-title">
                <span className="step-chip">Lançar</span>
                <span>Nova Leitura de Mira & Referência Inicial (RN)</span>
              </h2>
              <button
                type="button"
                className="btn btn-danger-ghost"
                onClick={handleLimparCaderneta}
              >
                <Trash2 size={15} />
                <span>Limpar Caderneta</span>
              </button>
            </div>

            <div className="form-grid">
              <div className="field">
                <label>Cota RN / Partida (m)</label>
                <input
                  className="input mono"
                  type="number"
                  step="0.0001"
                  value={cotaInicial}
                  onChange={(e) => setCotaInicial(parseFloatSafe(e.target.value))}
                />
              </div>
              <div className="field">
                <label>Estação</label>
                <input
                  className="input"
                  value={estacao}
                  onChange={(e) => setEstacao(e.target.value)}
                  placeholder="Ex: Estação E1"
                />
              </div>
              <div className="field">
                <label>Ponto Visado</label>
                <input
                  className="input mono"
                  value={pontoVisado}
                  onChange={(e) => setPontoVisado(e.target.value)}
                  placeholder="Ex: P22"
                />
              </div>
              <div className="field">
                <label>Leitura Mira (m)</label>
                <input
                  className="input mono"
                  value={leituraMira}
                  onChange={(e) => setLeituraMira(e.target.value)}
                  placeholder="Ex: 1,350"
                />
              </div>
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: tipoLeitura === 're' ? '2fr 1fr' : '1fr' }}>
              <div className="field">
                <label>Tipo de Visada</label>
                <SegmentedControl
                  value={tipoLeitura}
                  onChange={setTipoLeitura}
                  options={[
                    { label: 'Vante Intermediária', value: 'inter' },
                    { label: 'Vante de Mudança', value: 'mudanca' },
                    { label: 'Visada de Ré (Estação)', value: 're' },
                  ]}
                />
              </div>
              {tipoLeitura === 're' && (
                <div className="field">
                  <label>Ponto de Referência da Ré</label>
                  <input
                    className="input mono"
                    value={pontoRefRe}
                    onChange={(e) => setPontoRefRe(e.target.value)}
                    placeholder="Ex: V3 (se mudança)"
                  />
                </div>
              )}
            </div>

            <div className="form-row">
              <button type="submit" className="btn btn-success">
                <Plus size={16} />
                <span>Adicionar Leitura</span>
              </button>
            </div>
          </form>

          {msgAba1 && (
            <AlertBanner variant={msgAba1.variant} onDismiss={() => setMsgAba1(null)}>
              {msgAba1.text}
            </AlertBanner>
          )}

          {cadCalc.prova && (
            <div className="kpi-grid">
              <div className="kpi-card">
                <div className="kpi-icon">
                  <Layers size={18} />
                </div>
                <div className="kpi-body">
                  <span className="kpi-label">Leituras & Pontos</span>
                  <span className="kpi-value mono">
                    {cadCalc.linhas.length} leituras · {Object.keys(cadCalc.prova.cotas_mapa).length} pontos
                  </span>
                  <span className="kpi-sub mono">
                    RN Partida: {cadCalc.prova.cota_inicial.toFixed(casasCota)} m
                  </span>
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">
                  <Ruler size={18} />
                </div>
                <div className="kpi-body">
                  <span className="kpi-label">Somatórios de Visadas</span>
                  <span className="kpi-value mono">Σ Ré: {cadCalc.prova.soma_re.toFixed(3)} m</span>
                  <span className="kpi-sub mono">
                    Σ Vante Mud.: {cadCalc.prova.soma_vante_mudanca.toFixed(3)} m
                  </span>
                </div>
              </div>
              <div className="kpi-card">
                <div className="kpi-icon">
                  {cadCalc.prova.status ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                </div>
                <div className="kpi-body">
                  <span className="kpi-label">Prova de Cálculo</span>
                  <span style={{ marginTop: 2 }}>
                    <span className={`pill ${cadCalc.prova.status ? 'pill-success' : 'pill-danger'}`}>
                      {cadCalc.prova.status ? 'Verificado (Consistente)' : 'Divergência Detectada'}
                    </span>
                  </span>
                  <span className="kpi-sub">{cadCalc.prova.obs}</span>
                </div>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <Layers size={17} />
                <span>Caderneta Altimétrica ({linhasFiltradas.length} de {cadCalc.linhas.length})</span>
              </h2>
              <div className="precision-bar">
                <div className="search-box">
                  <Search size={14} />
                  <input
                    className="input"
                    value={cadSearch}
                    onChange={(e) => setCadSearch(e.target.value)}
                    placeholder="Buscar ponto (ex: V3, A1)..."
                  />
                </div>
                {estacoesUnicas.length > 1 && (
                  <select
                    className="select"
                    style={{ width: 'auto', minWidth: 145 }}
                    value={cadEstFilter}
                    onChange={(e) => setCadEstFilter(e.target.value)}
                  >
                    <option value="todas">Todas as Estações</option>
                    {estacoesUnicas.map((estName) => (
                      <option key={estName} value={estName}>
                        {estName}
                      </option>
                    ))}
                  </select>
                )}
                <PrecisionStepper
                  label="Cotas"
                  value={casasCota}
                  min={1}
                  max={8}
                  onChange={setCasasCota}
                />
              </div>
            </div>

            {cadCalc.linhas.length === 0 ? (
              <EmptyGuide
                icon={<Activity size={22} />}
                title="Caderneta altimétrica vazia"
                description="Lance sua primeira Visada de Ré na RN de partida ou restaure o projeto completo da UFCG (72 leituras em E1 e E2)."
                steps={['Defina a Cota RN inicial', 'Lance a Ré de abertura', 'Adicione as Vantes']}
                onLoadExample={handleRestaurarUfcg}
                exampleLabel="Carregar Projeto UFCG (72 Leituras)"
              />
            ) : (
              <div className="table-wrap table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Estação</th>
                      <th>Ponto</th>
                      <th>Tipo</th>
                      <th>Ré (m)</th>
                      <th>V. Inter (m)</th>
                      <th>V. Mud (m)</th>
                      <th>AI (m)</th>
                      <th>Cota (m)</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhasFiltradas.map((r) => (
                      <tr key={r.id}>
                        <td className="mono" style={{ color: 'var(--text-muted)' }}>
                          {r.idx + 1}
                        </td>
                        <td>{r.estacao}</td>
                        <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                          {r.ponto}
                        </td>
                        <td>
                          <span
                            className={`pill ${
                              r.re !== null
                                ? 'pill-info'
                                : r.vante_mudanca !== null
                                  ? 'pill-success'
                                  : 'pill-neutral'
                            }`}
                          >
                            {r.tipo}
                          </span>
                        </td>
                        <td className="mono">{r.re !== null ? r.re.toFixed(3) : '-'}</td>
                        <td className="mono">
                          {r.vante_inter !== null ? r.vante_inter.toFixed(3) : '-'}
                        </td>
                        <td className="mono">
                          {r.vante_mudanca !== null ? r.vante_mudanca.toFixed(3) : '-'}
                        </td>
                        <td className="mono">{r.ai !== null ? r.ai.toFixed(casasCota) : '-'}</td>
                        <td className="mono" style={{ fontWeight: 700 }}>
                          {r.cota !== null ? r.cota.toFixed(casasCota) : '-'}
                        </td>
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="btn-icon"
                              title="Editar leitura"
                              onClick={() => {
                                const orig = dadosCampo.find((d) => d.id === r.id);
                                if (orig) setEditCad({ ...orig });
                              }}
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon danger"
                              title="Apagar leitura"
                              onClick={() => handleDeleteCad(r.id, r.ponto)}
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

          {perfilChartSpec && (
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Activity size={17} />
                  <span>Perfil Longitudinal dos Pontos Nivelados</span>
                </h2>
                <span className="chart-hint">
                  <Info size={13} />
                  <span>Linha vermelha tracejada indica a Cota do Platô da Aba 3</span>
                </span>
              </div>
              <PlotlyChart
                data={perfilChartSpec.data}
                layout={perfilChartSpec.layout}
                height={400}
              />
            </div>
          )}
        </>
      )}

      {/* ==================================================================== */}
      {/* SUB-ABA 2: MALHA PLANIALTIMÉTRICA, CURVAS 2D & MDT 3D                */}
      {/* ==================================================================== */}
      {subTab === 'malha' && (
        <>
          <div className="grid-3">
            {/* A. Grade Regular */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Grid3X3 size={16} />
                  <span>A. Grade Ortogonal</span>
                </h2>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field">
                  <label>Colunas (A..)</label>
                  <input
                    className="input mono"
                    type="number"
                    min={2}
                    max={26}
                    value={gradeCols}
                    onChange={(e) => setGradeCols(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Linhas (1..)</label>
                  <input
                    className="input mono"
                    type="number"
                    min={2}
                    max={50}
                    value={gradeRows}
                    onChange={(e) => setGradeRows(Number(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>ΔX (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.5"
                    value={gradeDx}
                    onChange={(e) => setGradeDx(parseFloatSafe(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>ΔY (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.5"
                    value={gradeDy}
                    onChange={(e) => setGradeDy(parseFloatSafe(e.target.value))}
                  />
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={handleGerarGrade}>
                <Grid3X3 size={15} />
                <span>Gerar Grade Regular</span>
              </button>
            </div>

            {/* B. Offset de Borda */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Ruler size={16} />
                  <span>B. Borda por Offset</span>
                </h2>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field">
                  <label>Novo Ponto</label>
                  <input
                    className="input mono"
                    value={offNome}
                    onChange={(e) => setOffNome(e.target.value)}
                    placeholder="Ex: P19"
                  />
                </div>
                <div className="field">
                  <label>Ponto Base</label>
                  <select
                    className="select"
                    value={offBase}
                    onChange={(e) => setOffBase(e.target.value)}
                  >
                    {pontosMalha.length === 0 && <option value="">Nenhum ponto</option>}
                    {pontosMalha.map((p) => (
                      <option key={p.id} value={p.ponto}>
                        {p.ponto} ({p.x.toFixed(2)}, {p.y.toFixed(2)})
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Direção do Deslocamento</label>
                <SegmentedControl
                  value={offDir}
                  onChange={setOffDir}
                  options={[
                    { label: '+X', value: '+X' },
                    { label: '-X', value: '-X' },
                    { label: '+Y', value: '+Y' },
                    { label: '-Y', value: '-Y' },
                  ]}
                />
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field">
                  <label>Dist. Trena (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.01"
                    value={offDist}
                    onChange={(e) => setOffDist(parseFloatSafe(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Cota Padrão (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.001"
                    value={offCota}
                    onChange={(e) => setOffCota(parseFloatSafe(e.target.value))}
                  />
                </div>
              </div>
              <button type="button" className="btn btn-success" onClick={handleAddOffset}>
                <Plus size={15} />
                <span>Adicionar Ponto de Borda</span>
              </button>
            </div>

            {/* C. Manual 3D + Sync */}
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Box size={16} />
                  <span>C. Manual & Sincronia</span>
                </h2>
              </div>
              <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="field">
                  <label>Ponto</label>
                  <input
                    className="input mono"
                    value={manNome}
                    onChange={(e) => setManNome(e.target.value)}
                    placeholder="Ex: P22"
                  />
                </div>
                <div className="field">
                  <label>Cota (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.001"
                    value={manZ}
                    onChange={(e) => setManZ(parseFloatSafe(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>X (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.1"
                    value={manX}
                    onChange={(e) => setManX(parseFloatSafe(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Y (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.1"
                    value={manY}
                    onChange={(e) => setManY(parseFloatSafe(e.target.value))}
                  />
                </div>
              </div>
              <div className="form-row">
                <button type="button" className="btn btn-primary" onClick={handleAddManual3d}>
                  <Plus size={15} />
                  <span>Adicionar</span>
                </button>
                <button type="button" className="btn btn-secondary" onClick={handleSyncAba1}>
                  <RefreshCw size={15} />
                  <span>Sincronizar Aba 1</span>
                </button>
                <button
                  type="button"
                  className="btn btn-danger-ghost"
                  onClick={handleLimparMalha}
                  title="Limpar malha"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </div>

          {msgAba2 && (
            <AlertBanner variant={msgAba2.variant} onDismiss={() => setMsgAba2(null)}>
              {msgAba2.text}
            </AlertBanner>
          )}

          <SectionDivider icon={<MapIcon size={13} />} label="Visualização Cartográfica 2D & Relevo 3D" />

          {/* Chart 1: 2D Contours */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  <MapIcon size={17} />
                  <span>Planta Topográfica — Curvas de Nível 2D</span>
                </h2>
                <div className="chart-hint" style={{ marginTop: 3 }}>
                  <Info size={13} />
                  <span>Linhas espessas = curvas mestras (5× equidistância) · Contorno verde = perímetro real</span>
                </div>
              </div>
              <div className="form-row" style={{ alignItems: 'center' }}>
                <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <label style={{ whiteSpace: 'nowrap' }}>Equidistância (m):</label>
                  <input
                    className="input mono"
                    type="number"
                    min={0.01}
                    step={0.05}
                    style={{ width: 88 }}
                    value={equidistancia}
                    onChange={(e) =>
                      setEquidistancia(Math.max(0.01, parseFloatSafe(e.target.value) || 0.1))
                    }
                  />
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={recortarContorno}
                    onChange={(e) => setRecortarContorno(e.target.checked)}
                  />
                  <span>Recortar pelo contorno</span>
                </label>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={mostrarRotulos}
                    onChange={(e) => setMostrarRotulos(e.target.checked)}
                  />
                  <span>Exibir nomes</span>
                </label>
              </div>
            </div>

            {contour2dSpec ? (
              <PlotlyChart
                ref={chart2dRef}
                data={contour2dSpec.data}
                layout={contour2dSpec.layout}
                height={560}
              />
            ) : (
              <div className="empty-state">
                <p>Cadastre pelo menos 3 pontos não colineares na malha para gerar as curvas de nível.</p>
              </div>
            )}
          </div>

          {/* Chart 2: 3D Interactive MDT */}
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">
                  <Mountain size={17} />
                  <span>Modelo Digital do Terreno — MDT 3D Interativo</span>
                </h2>
                <div className="chart-hint" style={{ marginTop: 3 }}>
                  <Info size={13} />
                  <span>Arraste com o mouse para rotacionar em 360° · Scroll para aproximar</span>
                </div>
              </div>
              <div className="form-row" style={{ alignItems: 'center' }}>
                <div className="range-wrap">
                  <span>Exagero Vertical (Z):</span>
                  <input
                    type="range"
                    min={0.1}
                    max={1.5}
                    step={0.05}
                    value={exageroZ}
                    onChange={(e) => setExageroZ(Number(e.target.value))}
                  />
                  <span className="mono">{exageroZ.toFixed(2)}×</span>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={projBase3d}
                    onChange={(e) => setProjBase3d(e.target.checked)}
                  />
                  <span>Projetar curvas na base</span>
                </label>
              </div>
            </div>

            {mdt3dSpec ? (
              <PlotlyChart
                ref={chart3dRef}
                data={mdt3dSpec.data}
                layout={mdt3dSpec.layout}
                height={620}
              />
            ) : (
              <div className="empty-state">
                <p>Malha insuficiente para renderizar o Modelo Digital 3D.</p>
              </div>
            )}
          </div>

          {/* Analytical 2-point interpolation + Mesh Table */}
          <div className="grid-2">
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Calculator size={17} />
                  <span>Interpolação Analítica entre 2 Pontos</span>
                </h2>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Cota A (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.001"
                    value={interpCotaA}
                    onChange={(e) => setInterpCotaA(parseFloatSafe(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Cota B (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.001"
                    value={interpCotaB}
                    onChange={(e) => setInterpCotaB(parseFloatSafe(e.target.value))}
                  />
                </div>
                <div className="field">
                  <label>Distância AB (m)</label>
                  <input
                    className="input mono"
                    type="number"
                    step="0.01"
                    value={interpDhAb}
                    onChange={(e) => setInterpDhAb(parseFloatSafe(e.target.value))}
                  />
                </div>
              </div>
              <button type="button" className="btn btn-primary" onClick={handleInterpolarTrecho}>
                <Calculator size={15} />
                <span>Interpolar Trecho (Eq = {equidistancia.toFixed(2)} m)</span>
              </button>

              {interpRes !== null &&
                (interpRes.length === 0 ? (
                  <AlertBanner variant="info">
                    Nenhuma curva de nível cruza o segmento informado com essa equidistância.
                  </AlertBanner>
                ) : (
                  <div className="table-wrap table-scroll">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Cota da Curva (m)</th>
                          <th>Dist. de A (m)</th>
                          <th>Dist. de B (m)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {interpRes.map((r, i) => (
                          <tr key={i}>
                            <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                              {r.cotaCurva.toFixed(3)}
                            </td>
                            <td className="mono">{r.distA.toFixed(3)}</td>
                            <td className="mono">{r.distB.toFixed(3)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
            </div>

            <div className="card">
              <div className="card-header">
                <h2 className="card-title">
                  <Layers size={17} />
                  <span>Pontos na Malha ({malhaFiltrada.length} de {pontosMalha.length})</span>
                </h2>
                <div className="precision-bar">
                  <div className="search-box" style={{ minWidth: 155 }}>
                    <Search size={14} />
                    <input
                      className="input"
                      value={malhaSearch}
                      onChange={(e) => setMalhaSearch(e.target.value)}
                      placeholder="Filtrar ponto..."
                    />
                  </div>
                  <select
                    className="select"
                    style={{ width: 'auto' }}
                    value={malhaTipoFilter}
                    onChange={(e) =>
                      setMalhaTipoFilter(
                        e.target.value as 'todos' | 'grade' | 'borda' | 'vertice'
                      )
                    }
                  >
                    <option value="todos">Todos</option>
                    <option value="grade">Grade</option>
                    <option value="borda">Borda</option>
                    <option value="vertice">Vértice</option>
                  </select>
                </div>
              </div>
              {pontosMalha.length === 0 ? (
                <div className="empty-state">
                  <p>Nenhum ponto 3D na malha.</p>
                </div>
              ) : (
                <div className="table-wrap table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Ponto</th>
                        <th>Tipo</th>
                        <th>X (m)</th>
                        <th>Y (m)</th>
                        <th>Cota (m)</th>
                        <th>Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {malhaFiltrada.map((p) => (
                        <tr key={p.id}>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                            {p.ponto}
                          </td>
                          <td>
                            <span
                              className={`pill ${
                                p.tipo === 'vertice'
                                  ? 'pill-info'
                                  : p.tipo === 'borda'
                                    ? 'pill-success'
                                    : 'pill-neutral'
                              }`}
                            >
                              {p.tipo}
                            </span>
                          </td>
                          <td className="mono">{p.x.toFixed(3)}</td>
                          <td className="mono">{p.y.toFixed(3)}</td>
                          <td className="mono" style={{ fontWeight: 600 }}>
                            {p.cota.toFixed(casasCota)}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-icon danger"
                              title="Remover ponto da malha"
                              onClick={() =>
                                setPontosMalha((prev) => prev.filter((item) => item.id !== p.id))
                              }
                            >
                              <Trash2 size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ==================================================================== */}
      {/* SUB-ABA 3: TERRAPLENAGEM, PERFIS TRANSVERSAIS & CUBAGEM              */}
      {/* ==================================================================== */}
      {subTab === 'terraplenagem' && (
        <>
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">
                <HardHat size={17} />
                <span>Simulador de Cota do Platô & Balanceamento de Massa</span>
              </h2>
            </div>

            <div className="form-row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ width: 200 }}>
                <label>Cota do Platô / Projeto (m)</label>
                <input
                  className="input mono"
                  type="number"
                  step="0.005"
                  value={cotaPlato}
                  onChange={(e) => setCotaPlato(parseFloatSafe(e.target.value))}
                />
              </div>
              <div className="field" style={{ flex: 1, minWidth: 220 }}>
                <label>
                  Ajuste Interativo do Platô ({malhaBounds.min.toFixed(2)} m a {malhaBounds.max.toFixed(2)} m)
                </label>
                <input
                  type="range"
                  min={malhaBounds.min}
                  max={malhaBounds.max}
                  step={0.005}
                  value={Math.min(malhaBounds.max, Math.max(malhaBounds.min, cotaPlato))}
                  onChange={(e) => setCotaPlato(Number(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)', height: 34 }}
                />
              </div>
              <button type="button" className="btn btn-primary" onClick={handleCompensarVolumes}>
                <Sparkles size={15} />
                <span>Compensar (Corte = Aterro)</span>
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleAdotarCotaMedia}>
                <Scale size={15} />
                <span>Cota Média</span>
              </button>
            </div>

            {terraCalc && (
              <div className="balance-bar-wrap">
                <div className="balance-bar-legend">
                  <span style={{ color: 'var(--danger)' }}>
                    Corte: {cutPct.toFixed(1)}% ({terraCalc.volCorteTotal.toFixed(4)} m³)
                  </span>
                  <span style={{ color: 'var(--accent)' }}>
                    Aterro: {(100 - cutPct).toFixed(1)}% ({terraCalc.volAterroTotal.toFixed(4)} m³)
                  </span>
                </div>
                <div className="balance-bar-track">
                  <div className="balance-bar-cut" style={{ width: `${cutPct}%` }} />
                  <div className="balance-bar-fill" style={{ width: `${100 - cutPct}%` }} />
                </div>
              </div>
            )}
          </div>

          {msgAba3 && (
            <AlertBanner variant={msgAba3.variant} onDismiss={() => setMsgAba3(null)}>
              {msgAba3.text}
            </AlertBanner>
          )}

          {!terraCalc ? (
            <div className="empty-state">
              <p>Malha insuficiente para extrair seções transversais de terraplenagem.</p>
            </div>
          ) : (
            <>
              <div className="kpi-grid">
                <div className="kpi-card cut">
                  <div className="kpi-icon">
                    <ArrowUpFromLine size={18} />
                  </div>
                  <div className="kpi-body">
                    <span className="kpi-label">Volume Total de Corte</span>
                    <span className="kpi-value mono" style={{ color: 'var(--danger)' }}>
                      {terraCalc.volCorteTotal.toFixed(4)} m³
                    </span>
                    <span className="kpi-sub mono">
                      Platô: {terraCalc.cotaProjeto.toFixed(4)} m
                    </span>
                  </div>
                </div>
                <div className="kpi-card fill">
                  <div className="kpi-icon">
                    <ArrowDownToLine size={18} />
                  </div>
                  <div className="kpi-body">
                    <span className="kpi-label">Volume Total de Aterro</span>
                    <span className="kpi-value mono" style={{ color: 'var(--accent)' }}>
                      {terraCalc.volAterroTotal.toFixed(4)} m³
                    </span>
                    <span className="kpi-sub">{terraCalc.secoes.length} seções transversais</span>
                  </div>
                </div>
                <div className="kpi-card balance">
                  <div className="kpi-icon">
                    <Scale size={18} />
                  </div>
                  <div className="kpi-body">
                    <span className="kpi-label">Saldo (Aterro − Corte)</span>
                    <span className="kpi-value mono">
                      {terraCalc.diferencaVolumes >= 0 ? '+' : ''}
                      {terraCalc.diferencaVolumes.toFixed(4)} m³
                    </span>
                    <span className="kpi-sub">
                      {Math.abs(terraCalc.diferencaVolumes) < 0.05
                        ? 'Compensação equilibrada (Corte ≈ Aterro)'
                        : terraCalc.diferencaVolumes > 0
                          ? 'Necessidade de empréstimo (falta solo)'
                          : 'Excesso de corte (bota-fora)'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Table 1: Areas */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title">
                    <Layers size={17} />
                    <span>1. Áreas de Corte e Aterro por Seção Transversal</span>
                  </h2>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Seção / Perfil</th>
                        <th>Extensão (m)</th>
                        <th>Área de Corte (m²)</th>
                        <th>Área de Aterro (m²)</th>
                        <th>Sequência de Pontos</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terraCalc.secoes.map((s) => (
                        <tr key={s.secao}>
                          <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{s.secao}</td>
                          <td className="mono">{s.extensao.toFixed(3)}</td>
                          <td className="mono" style={{ color: 'var(--danger)', fontWeight: 600 }}>
                            {s.areaCorte.toFixed(4)}
                          </td>
                          <td className="mono" style={{ color: 'var(--accent)', fontWeight: 600 }}>
                            {s.areaAterro.toFixed(4)}
                          </td>
                          <td className="mono" style={{ textAlign: 'left', fontSize: '0.78rem' }}>
                            {s.pontos.join(' → ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Table 2: Volumes */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title">
                    <Calculator size={17} />
                    <span>2. Cubagem entre Seções Consecutivas (Método das Áreas Médias)</span>
                  </h2>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Trecho entre Seções</th>
                        <th>Distância (m)</th>
                        <th>Corte S1 (m²)</th>
                        <th>Corte S2 (m²)</th>
                        <th>Vol. Corte (m³)</th>
                        <th>Aterro S1 (m²)</th>
                        <th>Aterro S2 (m²)</th>
                        <th>Vol. Aterro (m³)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {terraCalc.volumes.map((v, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{v.trecho}</td>
                          <td className="mono">{v.distancia.toFixed(4)}</td>
                          <td className="mono">{v.corteS1.toFixed(4)}</td>
                          <td className="mono">{v.corteS2.toFixed(4)}</td>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--danger)' }}>
                            {v.volCorte.toFixed(4)}
                          </td>
                          <td className="mono">{v.aterroS1.toFixed(4)}</td>
                          <td className="mono">{v.aterroS2.toFixed(4)}</td>
                          <td className="mono" style={{ fontWeight: 700, color: 'var(--accent)' }}>
                            {v.volAterro.toFixed(4)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4}>VOLUMES TOTAIS</td>
                        <td className="mono" style={{ color: 'var(--danger)' }}>
                          {terraCalc.volCorteTotal.toFixed(4)} m³
                        </td>
                        <td colSpan={2} />
                        <td className="mono" style={{ color: 'var(--accent)' }}>
                          {terraCalc.volAterroTotal.toFixed(4)} m³
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              {/* Cross-section profile charts */}
              <div className="card">
                <div className="card-header">
                  <h2 className="card-title">
                    <Activity size={17} />
                    <span>3. Perfis Transversais com Hachura de Corte e Aterro</span>
                  </h2>
                  <select
                    className="select"
                    style={{ width: 'auto', minWidth: 250 }}
                    value={perfilSel}
                    onChange={(e) => setPerfilSel(e.target.value)}
                  >
                    <option value="todos">
                      Exibir Todos os Perfis em Grade ({terraCalc.secoes.length})
                    </option>
                    {terraCalc.secoes.map((s) => (
                      <option key={s.secao} value={s.secao}>
                        {s.secao}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid-2">
                  {(perfilSel === 'todos'
                    ? terraCalc.secoes
                    : terraCalc.secoes.filter((s) => s.secao === perfilSel)
                  ).map((sec) => {
                    const spec = buildPerfilTerraplenagemSpec(sec, terraCalc.cotaProjeto);
                    return (
                      <div
                        key={sec.secao}
                        style={perfilSel !== 'todos' ? { gridColumn: '1 / -1' } : undefined}
                      >
                        <PlotlyChart
                          data={spec.data}
                          layout={spec.layout}
                          height={perfilSel !== 'todos' ? 470 : 420}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {/* Edit Leveling Reading Modal */}
      {editCad && (
        <Modal
          title={`Editar Leitura — ${editCad.ponto}`}
          icon={<Pencil size={18} />}
          onClose={() => setEditCad(null)}
        >
          <div className="form-grid">
            <div className="field">
              <label>Estação</label>
              <input
                className="input"
                value={editCad.estacao}
                onChange={(e) => setEditCad({ ...editCad, estacao: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Ponto</label>
              <input
                className="input mono"
                value={editCad.ponto}
                onChange={(e) => setEditCad({ ...editCad, ponto: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Ref. da Ré</label>
              <input
                className="input mono"
                value={editCad.ponto_ref_re}
                onChange={(e) => setEditCad({ ...editCad, ponto_ref_re: e.target.value })}
              />
            </div>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>Visada Ré (m)</label>
              <input
                className="input mono"
                value={editCad.re ?? ''}
                onChange={(e) => setEditCad({ ...editCad, re: parseOptionalFloat(e.target.value) })}
              />
            </div>
            <div className="field">
              <label>Vante Intermediária (m)</label>
              <input
                className="input mono"
                value={editCad.vante_inter ?? ''}
                onChange={(e) =>
                  setEditCad({ ...editCad, vante_inter: parseOptionalFloat(e.target.value) })
                }
              />
            </div>
            <div className="field">
              <label>Vante de Mudança (m)</label>
              <input
                className="input mono"
                value={editCad.vante_mudanca ?? ''}
                onChange={(e) =>
                  setEditCad({ ...editCad, vante_mudanca: parseOptionalFloat(e.target.value) })
                }
              />
            </div>
          </div>
          <div className="form-row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setEditCad(null)}>
              Cancelar
            </button>
            <button type="button" className="btn btn-success" onClick={handleSaveEditCad}>
              <Save size={15} />
              <span>Salvar Alterações</span>
            </button>
          </div>
        </Modal>
      )}
    </>
  );
};
