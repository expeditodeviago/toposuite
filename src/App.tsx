import React, { useEffect, useState } from 'react';
import {
  Compass,
  Menu,
  Moon,
  Mountain,
  Navigation,
  Ruler,
  Sun,
  X,
} from 'lucide-react';
import { ThemeMode } from './components/PlotlyChart';
import { TaqueometriaModule } from './modules/TaqueometriaModule';
import { IrradiacaoModule } from './modules/IrradiacaoModule';
import { CaminhamentoModule } from './modules/CaminhamentoModule';
import { AltimetriaModule } from './modules/AltimetriaModule';

type ActiveModule = 'taqueometria' | 'irradiacao' | 'caminhamento' | 'altimetria';

const THEME_KEY = 'toposuite_theme';

const BrandEmblem = () => (
  <div className="brand">
    <div className="brand-mark" aria-hidden="true">
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 17c3-4 5-10 9-10s5 6 9 10" />
        <path d="M5 20c3-2.5 5-6 7-6s4 3.5 7 6" opacity="0.72" />
        <circle cx="12" cy="7" r="1.5" fill="currentColor" stroke="none" />
      </svg>
    </div>
    <div>
      <div className="brand-title">TopoSuite</div>
      <div className="brand-subtitle">Engenharia Topográfica</div>
    </div>
  </div>
);

export function App() {
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [activeModule, setActiveModule] = useState<ActiveModule>('altimetria');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [counts, setCounts] = useState({
    taqueometria: 0,
    irradiacao: 0,
    caminhamento: 0,
    altimetria: 72,
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const selectModule = (id: ActiveModule) => {
    setActiveModule(id);
    setMobileMenuOpen(false);
  };

  return (
    <div className="studio-layout">
      <div
        className={`sidebar-overlay ${mobileMenuOpen ? 'open' : ''}`}
        onClick={() => setMobileMenuOpen(false)}
      />

      <aside className={`sidebar ${mobileMenuOpen ? 'open' : ''}`} aria-label="Navegação Principal">
        <div className="sidebar-brand">
          <BrandEmblem />
          {mobileMenuOpen && (
            <button
              type="button"
              className="btn-icon"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Fechar menu"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav">
          <div className="nav-group">
            <div className="nav-group-label">Altimetria & Terreno</div>
            <button
              type="button"
              className={`sidebar-item ${activeModule === 'altimetria' ? 'active' : ''}`}
              onClick={() => selectModule('altimetria')}
            >
              <span className="sidebar-item-icon">
                <Mountain size={17} />
              </span>
              <span className="sidebar-item-text">
                <div className="sidebar-item-title">Altimetria & Terraplenagem</div>
                <div className="sidebar-item-sub">Nivelamento, Curvas 2D/3D e Cubagem</div>
              </span>
              {counts.altimetria > 0 && <span className="nav-badge mono">{counts.altimetria}</span>}
            </button>

            <button
              type="button"
              className={`sidebar-item ${activeModule === 'taqueometria' ? 'active' : ''}`}
              onClick={() => selectModule('taqueometria')}
            >
              <span className="sidebar-item-icon">
                <Ruler size={17} />
              </span>
              <span className="sidebar-item-text">
                <div className="sidebar-item-title">Taqueometria</div>
                <div className="sidebar-item-sub">Fios estadimétricos, Z/α, DH, DV e Cota</div>
              </span>
              {counts.taqueometria > 0 && (
                <span className="nav-badge mono">{counts.taqueometria}</span>
              )}
            </button>
          </div>

          <div className="nav-group">
            <div className="nav-group-label">Planimetria</div>
            <button
              type="button"
              className={`sidebar-item ${activeModule === 'irradiacao' ? 'active' : ''}`}
              onClick={() => selectModule('irradiacao')}
            >
              <span className="sidebar-item-icon">
                <Compass size={17} />
              </span>
              <span className="sidebar-item-text">
                <div className="sidebar-item-title">Irradiação</div>
                <div className="sidebar-item-sub">Estação central, ré dinâmica e Gauss</div>
              </span>
              {counts.irradiacao > 0 && <span className="nav-badge mono">{counts.irradiacao}</span>}
            </button>

            <button
              type="button"
              className={`sidebar-item ${activeModule === 'caminhamento' ? 'active' : ''}`}
              onClick={() => selectModule('caminhamento')}
            >
              <span className="sidebar-item-icon">
                <Navigation size={17} />
              </span>
              <span className="sidebar-item-text">
                <div className="sidebar-item-title">Caminhamento</div>
                <div className="sidebar-item-sub">Poligonal, fechamento angular e linear</div>
              </span>
              {counts.caminhamento > 0 && (
                <span className="nav-badge mono">{counts.caminhamento}</span>
              )}
            </button>
          </div>
        </nav>

        <div className="sidebar-footer">
          <div className="theme-segment" role="group" aria-label="Aparência">
            <button
              type="button"
              className={`theme-seg-btn ${theme === 'light' ? 'active' : ''}`}
              onClick={() => setTheme('light')}
            >
              <Sun size={14} />
              <span>Claro</span>
            </button>
            <button
              type="button"
              className={`theme-seg-btn ${theme === 'dark' ? 'active' : ''}`}
              onClick={() => setTheme('dark')}
            >
              <Moon size={14} />
              <span>Escuro</span>
            </button>
          </div>
          <div className="sidebar-note">Salvamento automático local • Exportação Excel (.xlsx)</div>
        </div>
      </aside>

      <div className="workspace-column">
        <header className="mobile-topbar">
          <button
            type="button"
            className="btn-icon"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu"
          >
            <Menu size={18} />
          </button>
          <BrandEmblem />
          <button
            type="button"
            className="btn-icon"
            onClick={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
            aria-label="Alternar tema"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </header>

        <main className="main-content">
          {activeModule === 'taqueometria' && (
            <TaqueometriaModule
              theme={theme}
              onCountChange={(c) => setCounts((prev) => ({ ...prev, taqueometria: c }))}
            />
          )}
          {activeModule === 'irradiacao' && (
            <IrradiacaoModule
              theme={theme}
              onCountChange={(c) => setCounts((prev) => ({ ...prev, irradiacao: c }))}
            />
          )}
          {activeModule === 'caminhamento' && (
            <CaminhamentoModule
              theme={theme}
              onCountChange={(c) => setCounts((prev) => ({ ...prev, caminhamento: c }))}
            />
          )}
          {activeModule === 'altimetria' && (
            <AltimetriaModule
              theme={theme}
              onCountChange={(c) => setCounts((prev) => ({ ...prev, altimetria: c }))}
            />
          )}
        </main>

        <footer className="footer-bar">
          <span>TopoSuite — Plataforma Integrada de Cálculos Topográficos e Terraplenagem</span>
          <span>Precisão configurável • Gráficos interativos 2D/3D</span>
        </footer>
      </div>
    </div>
  );
}

export default App;
