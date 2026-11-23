import ExcelJS from 'exceljs';
import {
  PontoMalha,
  RelatorioProvaCaderneta,
  ResultadoLinhaCaderneta,
  ResultadoTerraplenagem,
  roundTo,
} from './topoMath';

const COLORS = {
  navy: 'FF1F4E78',
  navyLight: 'FFE6ECF5',
  zebra: 'FFF4F6F9',
  border: 'FFDCDFE6',
  white: 'FFFFFFFF',
  text: 'FF1A202C',
  subtext: 'FF555555',
  dangerText: 'FFB03A2E',
  dangerBg: 'FFFDEDEC',
};

function fmtNumExcel(casas: number): string {
  return casas <= 0 ? '0' : '0.' + '0'.repeat(casas);
}

function nowFormatted(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function styleBanner(
  ws: ExcelJS.Worksheet,
  endColLetter: string,
  title: string,
  subtitle?: string
) {
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  ws.getRow(1).height = 34;
  ws.mergeCells(`A1:${endColLetter}1`);
  const c1 = ws.getCell('A1');
  c1.value = title;
  c1.font = { name: 'Calibri', size: 16, bold: true, color: { argb: COLORS.white } };
  c1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  c1.alignment = { vertical: 'middle', horizontal: 'center' };

  if (subtitle) {
    ws.getRow(2).height = 20;
    ws.mergeCells(`A2:${endColLetter}2`);
    const c2 = ws.getCell('A2');
    c2.value = subtitle;
    c2.font = { name: 'Calibri', size: 10, italic: true, color: { argb: COLORS.subtext } };
    c2.alignment = { vertical: 'middle', horizontal: 'center' };
  }
}

function styleSectionHeader(ws: ExcelJS.Worksheet, rowIdx: number, endCol: number, text: string) {
  ws.mergeCells(rowIdx, 1, rowIdx, endCol);
  const cell = ws.getCell(rowIdx, 1);
  cell.value = text;
  cell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: COLORS.navy } };
  cell.alignment = { vertical: 'middle', horizontal: 'left' };
  for (let c = 1; c <= endCol; c++) {
    ws.getCell(rowIdx, c).border = { bottom: { style: 'medium', color: { argb: COLORS.navy } } };
  }
  ws.getRow(rowIdx).height = 24;
}

function styleTableHeader(ws: ExcelJS.Worksheet, rowIdx: number, headers: string[]) {
  ws.getRow(rowIdx).height = 30;
  headers.forEach((h, i) => {
    const cell = ws.getCell(rowIdx, i + 1);
    cell.value = h;
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.navy } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyLight } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: COLORS.border } },
      bottom: { style: 'medium', color: { argb: COLORS.navy } },
      left: { style: 'thin', color: { argb: COLORS.border } },
      right: { style: 'thin', color: { argb: COLORS.border } },
    };
  });
}

function applyDataCell(
  cell: ExcelJS.Cell,
  zebra: boolean,
  opts?: { bold?: boolean; numFmt?: string; align?: 'left' | 'center' | 'right' }
) {
  cell.font = {
    name: 'Calibri',
    size: 11,
    bold: Boolean(opts?.bold),
    color: { argb: COLORS.text },
  };
  if (zebra) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.zebra } };
  }
  cell.alignment = { vertical: 'middle', horizontal: opts?.align ?? 'center' };
  cell.border = {
    top: { style: 'thin', color: { argb: COLORS.border } },
    bottom: { style: 'thin', color: { argb: COLORS.border } },
    left: { style: 'thin', color: { argb: COLORS.border } },
    right: { style: 'thin', color: { argb: COLORS.border } },
  };
  if (opts?.numFmt) {
    cell.numFmt = opts.numFmt;
  }
}

function styleSummaryRow(
  ws: ExcelJS.Worksheet,
  rowIdx: number,
  lblEndCol: number,
  valEndCol: number,
  label: string,
  value: string | number,
  numFmt?: string
) {
  ws.mergeCells(rowIdx, 1, rowIdx, lblEndCol);
  ws.mergeCells(rowIdx, lblEndCol + 1, rowIdx, valEndCol);
  const cLbl = ws.getCell(rowIdx, 1);
  cLbl.value = label;
  cLbl.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.text } };
  cLbl.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyLight } };
  cLbl.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };

  const cVal = ws.getCell(rowIdx, lblEndCol + 1);
  cVal.value = value;
  cVal.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.text } };
  cVal.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  if (numFmt) cVal.numFmt = numFmt;

  for (let c = 1; c <= valEndCol; c++) {
    ws.getCell(rowIdx, c).border = {
      top: { style: 'thin', color: { argb: COLORS.border } },
      bottom: { style: 'thin', color: { argb: COLORS.border } },
      left: { style: 'thin', color: { argb: COLORS.border } },
      right: { style: 'thin', color: { argb: COLORS.border } },
    };
  }
  ws.getRow(rowIdx).height = 22;
}

function addBase64Png(
  wb: ExcelJS.Workbook,
  ws: ExcelJS.Worksheet,
  dataUrl: string | null | undefined,
  tlCol: number,
  tlRow: number,
  widthPx: number,
  heightPx: number
) {
  if (!dataUrl || !dataUrl.includes('base64,')) return;
  const base64 = dataUrl.split('base64,')[1];
  const imgId = wb.addImage({ base64, extension: 'png' });
  ws.addImage(imgId, {
    tl: { col: tlCol, row: tlRow },
    ext: { width: widthPx, height: heightPx },
  });
}

async function downloadWorkbook(wb: ExcelJS.Workbook, filename: string) {
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ============================================================================
// 1. TAQUEOMETRIA
// ============================================================================

export interface ExportTaqueoRow {
  ponto: string;
  modoDesc: string;
  fs: number;
  fm: number;
  fi: number;
  g: number;
  zenitalStr: string;
  alphaStr: string;
  sentido: string;
  dv: number;
  dh: number;
  deltaH: number | null;
  di: number | null;
  cotaPonto: number | null;
}

export async function exportTaqueometriaExcel(params: {
  cotaEst: number | null;
  hi: number | null;
  casas: number;
  rows: ExportTaqueoRow[];
}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Taqueometria');
  const nf = fmtNumExcel(params.casas);

  ws.columns = [
    { width: 12 }, { width: 28 }, { width: 14 }, { width: 14 },
    { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 },
    { width: 16 }, { width: 16 }, { width: 16 }, { width: 16 },
    { width: 16 },
  ];

  styleBanner(ws, 'M', 'RELATÓRIO TAQUEOMÉTRICO — CÁLCULO ESTADIMÉTRICO', `Gerado em ${nowFormatted()}`);

  let row = 4;
  styleSectionHeader(ws, row, 13, '1. DADOS DA ESTAÇÃO OCUPADA');
  row += 1;
  styleSummaryRow(ws, row++, 3, 6, 'Cota da Estação (m)', params.cotaEst !== null ? roundTo(params.cotaEst, params.casas) : 'Não informada', params.cotaEst !== null ? nf : undefined);
  styleSummaryRow(ws, row++, 3, 6, 'Altura do Instrumento hi (m)', params.hi !== null ? roundTo(params.hi, params.casas) : 'Não informada', params.hi !== null ? nf : undefined);
  styleSummaryRow(ws, row++, 3, 6, 'Número de Pontos Visados', params.rows.length, '0');

  row += 1;
  styleSectionHeader(ws, row, 13, '2. TABELA DE PONTOS TAQUEOMÉTRICOS');
  row += 1;
  styleTableHeader(ws, row, [
    'Ponto', 'Modo Distância', 'FS (m)', 'FM (m)', 'FI (m)', 'Gerador g (m)',
    'Zenital (Z)', 'Inclinação (α)', 'DV (m)', 'DH (m)', 'ΔH Solo (m)', 'DI (m)', 'Cota Ponto (m)',
  ]);
  row += 1;

  params.rows.forEach((r, idx) => {
    const z = idx % 2 === 1;
    const vals: (string | number)[] = [
      r.ponto,
      r.modoDesc,
      r.fs > 0 ? roundTo(r.fs, params.casas) : '-',
      r.fm > 0 ? roundTo(r.fm, params.casas) : '-',
      r.fi > 0 ? roundTo(r.fi, params.casas) : '-',
      r.g > 0 ? roundTo(r.g, params.casas) : '-',
      r.zenitalStr,
      r.alphaStr,
      roundTo(r.dv, params.casas),
      roundTo(r.dh, params.casas),
      r.deltaH !== null ? roundTo(r.deltaH, params.casas) : '-',
      r.di !== null ? roundTo(r.di, params.casas) : '-',
      r.cotaPonto !== null ? roundTo(r.cotaPonto, params.casas) : '-',
    ];
    vals.forEach((v, cIdx) => {
      const cell = ws.getCell(row, cIdx + 1);
      cell.value = v;
      const isNum = typeof v === 'number';
      applyDataCell(cell, z, {
        bold: cIdx === 0 || cIdx === 12,
        numFmt: isNum ? (cIdx === 8 || cIdx === 10 ? `+${nf};-${nf};${nf}` : nf) : undefined,
      });
    });
    row += 1;
  });

  await downloadWorkbook(wb, 'planilha_taqueometria.xlsx');
}

// ============================================================================
// 2. PLANIMETRIA — IRRADIAÇÃO
// ============================================================================

export interface ExportIrradiacaoPayload {
  x0: number;
  y0: number;
  tipo: 'fechada' | 'aberta';
  casasDelta: number;
  casasCoord: number;
  areaM2: number | null;
  perimetro: number;
  avisos: string[];
  tabela: {
    ponto: string;
    reOrigem: string;
    angLidoStr: string;
    azimuteDms: string;
    rumoDms: string;
    dh: number;
    dx: number;
    dy: number;
    x: number;
    y: number;
    modoDistDesc: string;
    fs: number;
    fm: number;
    fi: number;
    g: number;
    tipoAngVDesc: string;
    angVStr: string;
  }[];
  alinhamentos: { trecho: string; distancia: number }[];
  chartPng?: string | null;
}

export async function exportIrradiacaoExcel(r: ExportIrradiacaoPayload) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Irradiação');
  const cd = r.casasDelta;
  const cc = r.casasCoord;
  const nd = fmtNumExcel(cd);
  const nc = fmtNumExcel(cc);
  const ndEw = `${nd}" E";${nd}" W";${nd}`;
  const ndNs = `${nd}" N";${nd}" S";${nd}`;

  ws.columns = [
    { width: 14 }, { width: 28 }, { width: 16 }, { width: 16 }, { width: 20 },
    { width: 15 }, { width: 20 }, { width: 20 }, { width: 20 }, { width: 20 },
  ];

  styleBanner(
    ws,
    'J',
    'RELATÓRIO DE IRRADIAÇÃO — CALCULADORA PLANIMÉTRICA',
    `Poligonal ${r.tipo.toUpperCase()}  •  Gerado em ${nowFormatted()}`
  );

  let row = 4;
  styleSectionHeader(ws, row++, 10, '1. DADOS GERAIS');
  styleSummaryRow(ws, row++, 2, 5, 'Estação Central — X0 (m)', roundTo(r.x0, cc), nc);
  styleSummaryRow(ws, row++, 2, 5, 'Estação Central — Y0 (m)', roundTo(r.y0, cc), nc);
  styleSummaryRow(ws, row++, 2, 5, 'Tipo de poligonal', r.tipo === 'fechada' ? 'Fechada' : 'Aberta');
  styleSummaryRow(ws, row++, 2, 5, 'Número de pontos', r.tabela.length, '0');
  if (r.areaM2 !== null) {
    styleSummaryRow(ws, row++, 2, 5, 'Área (m²)', roundTo(r.areaM2, cc), nc);
    styleSummaryRow(ws, row++, 2, 5, 'Área (ha)', roundTo(r.areaM2 / 10000.0, cc), nc);
    styleSummaryRow(ws, row++, 2, 5, 'Perímetro (m)', roundTo(r.perimetro, cc), nc);
  } else {
    styleSummaryRow(ws, row++, 2, 5, 'Área', 'N/A (Poligonal Aberta ou menos de 3 pontos)');
    if (r.alinhamentos.length) {
      styleSummaryRow(ws, row++, 2, 5, 'Extensão total (m)', roundTo(r.perimetro, cc), nc);
    }
  }
  for (const aviso of r.avisos) {
    ws.mergeCells(row, 1, row, 2);
    ws.mergeCells(row, 3, row, 10);
    ws.getCell(row, 1).value = 'Aviso';
    ws.getCell(row, 1).font = { name: 'Calibri', size: 11, bold: true };
    ws.getCell(row, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyLight } };
    const ca = ws.getCell(row, 3);
    ca.value = aviso;
    ca.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.dangerText } };
    ca.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.dangerBg } };
    ca.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 1 };
    ws.getRow(row).height = 28;
    row++;
  }

  row += 1;
  styleSectionHeader(ws, row++, 10, '2. PONTOS IRRADIADOS (COORDENADAS E VISADAS DA ESTAÇÃO CENTRAL)');
  styleTableHeader(ws, row++, [
    'Ponto', 'Ré de Origem', 'Ângulo Lido', 'Azimute (DMS)', 'Rumo (DMS)',
    'DH Est. (m)', `ΔX (m)\n${cd} dec`, `ΔY (m)\n${cd} dec`,
    `Coord. X (m)\n${cc} dec`, `Coord. Y (m)\n${cc} dec`,
  ]);

  r.tabela.forEach((item, i) => {
    const z = i % 2 === 1;
    const vals: (string | number)[] = [
      item.ponto, item.reOrigem, item.angLidoStr, item.azimuteDms, item.rumoDms,
      roundTo(item.dh, 6), roundTo(item.dx, cd), roundTo(item.dy, cd),
      roundTo(item.x, cc), roundTo(item.y, cc),
    ];
    vals.forEach((v, c) => {
      const cell = ws.getCell(row, c + 1);
      cell.value = v;
      let nf: string | undefined;
      if (c === 5) nf = '0.000000';
      else if (c === 6) nf = ndEw;
      else if (c === 7) nf = ndNs;
      else if (c === 8 || c === 9) nf = nc;
      applyDataCell(cell, z, { bold: c === 0, numFmt: nf });
    });
    row++;
  });

  if (r.alinhamentos.length) {
    row += 1;
    styleSectionHeader(ws, row++, 10, '3. DISTÂNCIAS ENTRE PONTOS EM SEQUÊNCIA (TRECHOS)');
    ws.mergeCells(row, 1, row, 2);
    ws.mergeCells(row, 3, row, 4);
    const h1 = ws.getCell(row, 1);
    const h2 = ws.getCell(row, 3);
    h1.value = 'Trecho';
    h2.value = `Distância (m) — ${cc} dec`;
    [h1, h2].forEach((c) => {
      c.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.navy } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyLight } };
      c.alignment = { vertical: 'middle', horizontal: 'center' };
    });
    ws.getRow(row).height = 24;
    row++;
    r.alinhamentos.forEach((al, i) => {
      const z = i % 2 === 1;
      ws.mergeCells(row, 1, row, 2);
      ws.mergeCells(row, 3, row, 4);
      const c1 = ws.getCell(row, 1);
      const c2 = ws.getCell(row, 3);
      c1.value = al.trecho;
      c2.value = roundTo(al.distancia, cc);
      applyDataCell(c1, z, { bold: true });
      applyDataCell(c2, z, { numFmt: nc });
      row++;
    });
  }

  if (r.chartPng) {
    row += 1;
    styleSectionHeader(ws, row++, 10, '4. PLANTA PLANIMÉTRICA');
    addBase64Png(wb, ws, r.chartPng, 0, row, 640, 500);
  }

  // Sheet 2: Dados de entrada
  const ws2 = wb.addWorksheet('Dados de entrada');
  ws2.columns = [
    { width: 14 }, { width: 28 }, { width: 16 }, { width: 34 }, { width: 15 },
    { width: 14 }, { width: 14 }, { width: 14 }, { width: 15 }, { width: 24 },
  ];
  styleBanner(ws2, 'J', 'DADOS DE ENTRADA (MEDIÇÕES)');
  styleTableHeader(ws2, 3, [
    'Ponto', 'Ré de Origem', 'Ângulo Lido', 'Modo de Distância',
    'DH (m)', 'FS (m)', 'FM (m)', 'FI (m)', 'Gerador g (m)', 'Ângulo Vertical',
  ]);
  r.tabela.forEach((item, i) => {
    const z = i % 2 === 1;
    const ln = 4 + i;
    const vals: (string | number)[] = [
      item.ponto,
      item.reOrigem,
      item.angLidoStr,
      item.modoDistDesc,
      roundTo(item.dh, 6),
      item.fs > 0 ? roundTo(item.fs, 6) : '-',
      item.fm > 0 ? roundTo(item.fm, 6) : '-',
      item.fi > 0 ? roundTo(item.fi, 6) : '-',
      item.g > 0 ? roundTo(item.g, 6) : '-',
      item.g > 0 ? `${item.tipoAngVDesc}: ${item.angVStr}` : '-',
    ];
    vals.forEach((v, c) => {
      const cell = ws2.getCell(ln, c + 1);
      cell.value = v;
      applyDataCell(cell, z, {
        bold: c === 0,
        numFmt: typeof v === 'number' ? '0.000000' : undefined,
      });
    });
  });

  await downloadWorkbook(wb, 'planilha_irradiacao.xlsx');
}

// ============================================================================
// 3. PLANIMETRIA — CAMINHAMENTO
// ============================================================================

export interface ExportCaminhamentoPayload {
  x0: number;
  y0: number;
  xFinal: number;
  yFinal: number;
  tipo: 'fechada' | 'aberta';
  tipoAnguloDesc: string;
  sentidoDesc: string;
  casasBrutas: number;
  casasComp: number;
  somaDh: number;
  areaM2: number | null;
  somaAngLidosStr: string;
  somaTeoricaStr: string;
  erroAngularStr: string;
  toleranciaAngularStr: string;
  descCorrecaoAngular: string;
  ex: number;
  ey: number;
  erroLinearAbsoluto: number;
  precisaoRelativaStr: string;
  somaAbsX: number;
  somaAbsY: number;
  fcX: number;
  fcY: number;
  somaDxBruto: number;
  somaDyBruto: number;
  tabela: {
    trecho: string;
    estacao: string;
    vante: string;
    angLidoStr: string;
    corrSec: number;
    angCompStr: string;
    azCorrigidoStr: string;
    rumoCorrigidoStr: string;
    dh: number;
    dxBruto: number;
    dyBruto: number;
    cx: number;
    cy: number;
    dxComp: number;
    dyComp: number;
    x: number;
    y: number;
    modoDistDesc: string;
    fs: number;
    fm: number;
    fi: number;
    g: number;
    angVStr: string;
  }[];
  chartPng?: string | null;
}

export async function exportCaminhamentoExcel(r: ExportCaminhamentoPayload) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Caminhamento');
  const cb = r.casasBrutas;
  const cc = r.casasComp;
  const nb = fmtNumExcel(cb);
  const nc = fmtNumExcel(cc);
  const nbEw = `${nb}" E";${nb}" W";${nb}`;
  const nbNs = `${nb}" N";${nb}" S";${nb}`;
  const ncEw = `${nc}" E";${nc}" W";${nc}`;
  const ncNs = `${nc}" N";${nc}" S";${nc}`;

  ws.columns = [
    { width: 14 }, { width: 15 }, { width: 15 }, { width: 16 }, { width: 18 },
    { width: 15 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
    { width: 18 }, { width: 18 },
  ];

  styleBanner(
    ws,
    'L',
    'RELATÓRIO DE CAMINHAMENTO — CALCULADORA PLANIMÉTRICA',
    `Poligonal ${r.tipo.toUpperCase()}  •  Gerado em ${nowFormatted()}`
  );

  let row = 4;
  styleSectionHeader(ws, row++, 12, '1. DADOS GERAIS E FECHAMENTO');
  styleSummaryRow(ws, row++, 3, 7, 'Estação Inicial — X0 (m)', roundTo(r.x0, cc), nc);
  styleSummaryRow(ws, row++, 3, 7, 'Estação Inicial — Y0 (m)', roundTo(r.y0, cc), nc);
  styleSummaryRow(ws, row++, 3, 7, 'Tipo de poligonal', r.tipo === 'fechada' ? 'Fechada' : 'Aberta');
  styleSummaryRow(ws, row++, 3, 7, 'Tipo de ângulo / Sentido', `${r.tipoAnguloDesc}  •  ${r.sentidoDesc}`);
  styleSummaryRow(ws, row++, 3, 7, 'Número de alinhamentos', r.tabela.length, '0');
  styleSummaryRow(ws, row++, 3, 7, r.tipo === 'fechada' ? 'Perímetro Total (m)' : 'Extensão Total (m)', roundTo(r.somaDh, 6), '0.000000');

  if (r.areaM2 !== null) {
    styleSummaryRow(ws, row++, 3, 7, 'Área (m²)', roundTo(r.areaM2, cc + 2), fmtNumExcel(cc + 2));
    styleSummaryRow(ws, row++, 3, 7, 'Área (ha)', roundTo(r.areaM2 / 10000.0, 6), '0.000000');
  } else {
    styleSummaryRow(ws, row++, 3, 7, 'Área', 'N/A (Poligonal Aberta ou menos de 3 alinhamentos)');
  }

  if (r.tipo === 'fechada') {
    styleSummaryRow(ws, row++, 3, 7, 'Somatório dos Ângulos Lidos', r.somaAngLidosStr);
    styleSummaryRow(ws, row++, 3, 7, 'Somatório Angular Teórico', r.somaTeoricaStr);
    styleSummaryRow(ws, row++, 3, 7, 'Erro Angular (EA)', r.erroAngularStr);
    styleSummaryRow(ws, row++, 3, 7, 'Tolerância Angular (EAt)', r.toleranciaAngularStr);
    styleSummaryRow(ws, row++, 3, 7, 'Distribuição das Correções Angulares', r.descCorrecaoAngular);
    styleSummaryRow(ws, row++, 3, 7, 'Erro Linear em X (ex) (m)', roundTo(r.ex, cc), nc);
    styleSummaryRow(ws, row++, 3, 7, 'Erro Linear em Y (ey) (m)', roundTo(r.ey, cc), nc);
    styleSummaryRow(ws, row++, 3, 7, 'Erro Linear Absoluto (EL) (m)', roundTo(r.erroLinearAbsoluto, cc), nc);
    styleSummaryRow(ws, row++, 3, 7, 'Precisão Relativa Alcançada (ELFt)', r.precisaoRelativaStr);
    styleSummaryRow(ws, row++, 3, 7, 'Soma |ΔX| (m) / Fator fc_x', `${r.somaAbsX.toFixed(cb)} m  |  fc_x = ${r.fcX.toFixed(11)}`);
    styleSummaryRow(ws, row++, 3, 7, 'Soma |ΔY| (m) / Fator fc_y', `${r.somaAbsY.toFixed(cb)} m  |  fc_y = ${r.fcY.toFixed(11)}`);
  } else {
    styleSummaryRow(ws, row++, 3, 7, 'Deslocamento Acumulado ΔX (m)', roundTo(r.somaDxBruto, cb), nb);
    styleSummaryRow(ws, row++, 3, 7, 'Deslocamento Acumulado ΔY (m)', roundTo(r.somaDyBruto, cb), nb);
  }

  row += 1;
  styleSectionHeader(ws, row++, 12, '2. PLANILHA DE CÁLCULO DO CAMINHAMENTO');
  styleTableHeader(ws, row++, [
    'Trecho', 'Ângulo Lido', 'Ângulo Comp.', 'Azimute\nCorrigido', 'Rumo\nCorrigido',
    'DH (m)',
    `ΔX Bruto (m)\n${cb} dec`, `ΔY Bruto (m)\n${cb} dec`,
    `ΔX Comp. (m)\n${cc} dec`, `ΔY Comp. (m)\n${cc} dec`,
    `Coord. X (m)\n${cc} dec`, `Coord. Y (m)\n${cc} dec`,
  ]);

  let somaDxComp = 0;
  let somaDyComp = 0;
  r.tabela.forEach((item, i) => {
    const z = i % 2 === 1;
    somaDxComp += item.dxComp;
    somaDyComp += item.dyComp;
    const vals: (string | number)[] = [
      item.trecho, item.angLidoStr, item.angCompStr, item.azCorrigidoStr, item.rumoCorrigidoStr,
      roundTo(item.dh, 6), roundTo(item.dxBruto, cb), roundTo(item.dyBruto, cb),
      roundTo(item.dxComp, cc), roundTo(item.dyComp, cc),
      roundTo(item.x, cc), roundTo(item.y, cc),
    ];
    vals.forEach((v, c) => {
      const cell = ws.getCell(row, c + 1);
      cell.value = v;
      let nf: string | undefined;
      if (c === 5) nf = '0.000000';
      else if (c === 6) nf = nbEw;
      else if (c === 7) nf = nbNs;
      else if (c === 8) nf = ncEw;
      else if (c === 9) nf = ncNs;
      else if (c === 10 || c === 11) nf = nc;
      applyDataCell(cell, z, { bold: c === 0, numFmt: nf });
    });
    row++;
  });

  // Totals row
  ws.mergeCells(row, 1, row, 5);
  ws.getCell(row, 1).value = 'TOTAIS / FECHAMENTO';
  const totVals: [number, number, string][] = [
    [6, roundTo(r.somaDh, 6), '0.000000'],
    [7, roundTo(r.somaDxBruto, cb), nbEw],
    [8, roundTo(r.somaDyBruto, cb), nbNs],
    [9, roundTo(somaDxComp, cc), ncEw],
    [10, roundTo(somaDyComp, cc), ncNs],
    [11, roundTo(r.xFinal, cc), nc],
    [12, roundTo(r.yFinal, cc), nc],
  ];
  for (let c = 1; c <= 12; c++) {
    const cell = ws.getCell(row, c);
    cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.navy } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyLight } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'medium', color: { argb: COLORS.navy } },
      bottom: { style: 'medium', color: { argb: COLORS.navy } },
    };
  }
  totVals.forEach(([col, val, nf]) => {
    const cell = ws.getCell(row, col);
    cell.value = val;
    cell.numFmt = nf;
  });
  ws.getRow(row).height = 24;
  row++;

  if (r.chartPng) {
    row += 1;
    styleSectionHeader(ws, row++, 12, '3. PLANTA PLANIMÉTRICA DA POLIGONAL');
    addBase64Png(wb, ws, r.chartPng, 0, row, 640, 500);
  }

  // Sheet 2
  const ws2 = wb.addWorksheet('Dados de entrada');
  ws2.columns = [
    { width: 14 }, { width: 12 }, { width: 12 }, { width: 16 }, { width: 15 },
    { width: 32 }, { width: 15 }, { width: 14 }, { width: 14 }, { width: 14 },
    { width: 15 }, { width: 18 }, { width: 15 }, { width: 15 },
  ];
  styleBanner(ws2, 'N', 'DADOS DE ENTRADA (MEDIÇÕES E CORREÇÕES)');
  styleTableHeader(ws2, 3, [
    'Trecho', 'Estação', 'Vante', 'Ângulo Lido', 'Corr. Ang. (")',
    'Modo de Distância', 'DH (m)', 'FS (m)', 'FM (m)', 'FI (m)',
    'Gerador g (m)', 'Ângulo Vertical', 'Cx (m)', 'Cy (m)',
  ]);
  r.tabela.forEach((item, i) => {
    const z = i % 2 === 1;
    const ln = 4 + i;
    const vals: (string | number)[] = [
      item.trecho, item.estacao, item.vante, item.angLidoStr, item.corrSec,
      item.modoDistDesc, roundTo(item.dh, 6),
      item.fs > 0 ? roundTo(item.fs, 6) : '-',
      item.fm > 0 ? roundTo(item.fm, 6) : '-',
      item.fi > 0 ? roundTo(item.fi, 6) : '-',
      item.g > 0 ? roundTo(item.g, 6) : '-',
      item.g > 0 ? item.angVStr : '-',
      roundTo(item.cx, 6), roundTo(item.cy, 6),
    ];
    vals.forEach((v, c) => {
      const cell = ws2.getCell(ln, c + 1);
      cell.value = v;
      let nf: string | undefined;
      if (c === 4) nf = '+0;-0;0';
      else if (typeof v === 'number') nf = '0.000000';
      applyDataCell(cell, z, { bold: c === 0, numFmt: nf });
    });
  });

  await downloadWorkbook(wb, 'planilha_caminhamento.xlsx');
}

// ============================================================================
// 4. ALTIMETRIA, MALHA, CURVAS DE NÍVEL & TERRAPLENAGEM (4 ABAS)
// ============================================================================

export async function exportAltimetriaExcel(params: {
  linhas: ResultadoLinhaCaderneta[];
  prova: RelatorioProvaCaderneta | null;
  malha: PontoMalha[];
  terraplenagem: ResultadoTerraplenagem | null;
  casasCota: number;
  chart2dPng?: string | null;
  chart3dPng?: string | null;
}) {
  const wb = new ExcelJS.Workbook();
  const nc = fmtNumExcel(params.casasCota);

  // ABA 1: Caderneta Altimétrica
  const ws1 = wb.addWorksheet('Caderneta_Altimetrica');
  ws1.columns = [
    { width: 16 }, { width: 16 }, { width: 22 }, { width: 16 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ];
  styleBanner(ws1, 'H', 'RELATÓRIO DE NIVELAMENTO GEOMÉTRICO — CADERNETA ALTIMÉTRICA', `Gerado em ${nowFormatted()}`);

  let ln = 4;
  styleSectionHeader(ws1, ln++, 8, '1. RESUMO E PROVA DE CÁLCULO');
  if (params.prova) {
    styleSummaryRow(ws1, ln++, 3, 6, 'Cota Inicial (RN / Partida) (m)', roundTo(params.prova.cota_inicial, params.casasCota), nc);
    styleSummaryRow(ws1, ln++, 3, 6, 'Total de Leituras Registradas', params.linhas.length, '0');
    styleSummaryRow(ws1, ln++, 3, 6, 'Σ Visadas de Ré (m)', roundTo(params.prova.soma_re, 4), '0.0000');
    styleSummaryRow(ws1, ln++, 3, 6, 'Σ Visadas de Vante Mudança (m)', roundTo(params.prova.soma_vante_mudanca, 4), '0.0000');
    styleSummaryRow(ws1, ln++, 3, 6, 'Status da Prova de Cálculo', params.prova.status ? 'VERIFICADO (Consistente)' : 'DIVERGÊNCIA DETECTADA');
  }

  ln += 1;
  styleSectionHeader(ws1, ln++, 8, '2. TABELA DE NIVELAMENTO');
  styleTableHeader(ws1, ln++, [
    'Estação', 'Ponto Visado', 'Tipo de Leitura', 'Visada Ré (m)',
    'Vante Inter. (m)', 'Vante Mud. (m)', 'AI (m)', `Cota (m)\n(${params.casasCota} dec)`,
  ]);
  params.linhas.forEach((r, i) => {
    const z = i % 2 === 1;
    const vals: (string | number)[] = [
      r.estacao,
      r.ponto,
      r.tipo,
      r.re !== null ? roundTo(r.re, 3) : '-',
      r.vante_inter !== null ? roundTo(r.vante_inter, 3) : '-',
      r.vante_mudanca !== null ? roundTo(r.vante_mudanca, 3) : '-',
      r.ai !== null ? roundTo(r.ai, params.casasCota) : '-',
      r.cota !== null ? roundTo(r.cota, params.casasCota) : '-',
    ];
    vals.forEach((v, c) => {
      const cell = ws1.getCell(ln, c + 1);
      cell.value = v;
      let nf: string | undefined;
      if (typeof v === 'number') nf = c >= 6 ? nc : '0.000';
      applyDataCell(cell, z, { bold: c === 1 || c === 7, numFmt: nf });
    });
    ln++;
  });

  // ABA 2: Malha Planialtimétrica
  const ws2 = wb.addWorksheet('Malha_Planialtimetrica');
  ws2.columns = [{ width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 20 }];
  styleBanner(ws2, 'E', 'MALHA PLANIALTIMÉTRICA (COORDENADAS X, Y, COTA)');
  styleTableHeader(ws2, 3, ['Ponto', 'Tipo', 'Coordenada X (m)', 'Coordenada Y (m)', `Cota (m) (${params.casasCota} dec)`]);
  params.malha.forEach((p, i) => {
    const z = i % 2 === 1;
    const rIdx = 4 + i;
    const vals: (string | number)[] = [p.ponto, p.tipo, roundTo(p.x, 3), roundTo(p.y, 3), roundTo(p.cota, params.casasCota)];
    vals.forEach((v, c) => {
      const cell = ws2.getCell(rIdx, c + 1);
      cell.value = v;
      applyDataCell(cell, z, {
        bold: c === 0 || c === 4,
        numFmt: c === 2 || c === 3 ? '0.000' : c === 4 ? nc : undefined,
      });
    });
  });

  // ABA 3: Terraplenagem & Volumes
  const ws3 = wb.addWorksheet('Terraplenagem_Volumes');
  ws3.columns = [
    { width: 26 }, { width: 16 }, { width: 18 }, { width: 18 },
    { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 },
  ];
  styleBanner(ws3, 'H', 'PROJETO DE TERRAPLENAGEM — ÁREAS E VOLUMES DE CORTE / ATERRO');

  if (params.terraplenagem) {
    const res = params.terraplenagem;
    let ln3 = 4;
    styleSectionHeader(ws3, ln3++, 8, '1. RESUMO DE VOLUMES');
    styleSummaryRow(ws3, ln3++, 3, 5, 'Cota do Platô / Projeto (m)', roundTo(res.cotaProjeto, params.casasCota), nc);
    styleSummaryRow(ws3, ln3++, 3, 5, 'Volume Total de Corte (m³)', res.volCorteTotal, '0.0000');
    styleSummaryRow(ws3, ln3++, 3, 5, 'Volume Total de Aterro (m³)', res.volAterroTotal, '0.0000');
    styleSummaryRow(ws3, ln3++, 3, 5, 'Diferença de Volumes (Aterro - Corte) (m³)', res.diferencaVolumes, '+0.0000;-0.0000;0.0000');

    ln3 += 1;
    styleSectionHeader(ws3, ln3++, 8, '2. ÁREAS DE CORTE E ATERRO POR SEÇÃO TRANSVERSAL');
    styleTableHeader(ws3, ln3++, ['Seção / Perfil', 'Y Ref. (m)', 'Extensão (m)', 'Área Corte (m²)', 'Área Aterro (m²)', 'Pontos do Perfil']);
    res.secoes.forEach((sec, i) => {
      const z = i % 2 === 1;
      const vals: (string | number)[] = [
        sec.secao, sec.yRef, sec.extensao, sec.areaCorte, sec.areaAterro, sec.pontos.join(' - '),
      ];
      vals.forEach((v, c) => {
        const cell = ws3.getCell(ln3, c + 1);
        cell.value = v;
        applyDataCell(cell, z, {
          bold: c === 0,
          align: c === 5 ? 'left' : 'center',
          numFmt: c === 2 ? '0.000' : c === 1 || c === 3 || c === 4 ? '0.0000' : undefined,
        });
      });
      ln3++;
    });

    ln3 += 1;
    styleSectionHeader(ws3, ln3++, 8, '3. CUBAGEM POR MÉTODO DAS ÁREAS MÉDIAS');
    styleTableHeader(ws3, ln3++, [
      'Trecho entre Seções', 'Distância (m)', 'Corte S1 (m²)', 'Corte S2 (m²)',
      'Vol. Corte (m³)', 'Aterro S1 (m²)', 'Aterro S2 (m²)', 'Vol. Aterro (m³)',
    ]);
    res.volumes.forEach((vr, i) => {
      const z = i % 2 === 1;
      const vals: (string | number)[] = [
        vr.trecho, vr.distancia, vr.corteS1, vr.corteS2, vr.volCorte, vr.aterroS1, vr.aterroS2, vr.volAterro,
      ];
      vals.forEach((v, c) => {
        const cell = ws3.getCell(ln3, c + 1);
        cell.value = v;
        applyDataCell(cell, z, {
          bold: c === 0 || c === 4 || c === 7,
          numFmt: c > 0 ? '0.0000' : undefined,
        });
      });
      ln3++;
    });

    ws3.mergeCells(ln3, 1, ln3, 4);
    ws3.mergeCells(ln3, 6, ln3, 7);
    ws3.getCell(ln3, 1).value = 'VOLUMES TOTAIS';
    ws3.getCell(ln3, 5).value = res.volCorteTotal;
    ws3.getCell(ln3, 5).numFmt = '0.0000';
    ws3.getCell(ln3, 8).value = res.volAterroTotal;
    ws3.getCell(ln3, 8).numFmt = '0.0000';
    for (let c = 1; c <= 8; c++) {
      const cell = ws3.getCell(ln3, c);
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.navy } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navyLight } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'medium', color: { argb: COLORS.navy } },
        bottom: { style: 'medium', color: { argb: COLORS.navy } },
      };
    }
    ws3.getRow(ln3).height = 24;
  }

  // ABA 4: Planta Topográfica 2D e MDT 3D
  if (params.chart2dPng || params.chart3dPng) {
    const ws4 = wb.addWorksheet('Planta_Curvas_Nivel');
    styleBanner(ws4, 'P', 'PLANTA TOPOGRÁFICA (CURVAS DE NÍVEL) E MODELO DIGITAL DO TERRENO (3D)');
    if (params.chart2dPng) addBase64Png(wb, ws4, params.chart2dPng, 0, 2, 620, 440);
    if (params.chart3dPng) addBase64Png(wb, ws4, params.chart3dPng, 9, 2, 620, 440);
  }

  await downloadWorkbook(wb, 'planilha_altimetria_terraplenagem.xlsx');
}
