import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Sparkles,
  X,
} from 'lucide-react';

interface AlertProps {
  variant: 'info' | 'success' | 'warning' | 'danger';
  children: React.ReactNode;
  onDismiss?: () => void;
}

export const AlertBanner: React.FC<AlertProps> = ({ variant, children, onDismiss }) => {
  const Icon =
    variant === 'success'
      ? CheckCircle2
      : variant === 'warning'
        ? AlertTriangle
        : variant === 'danger'
          ? AlertCircle
          : Info;

  return (
    <div className={`alert alert-${variant}`}>
      <Icon size={17} />
      <div style={{ flex: 1 }}>{children}</div>
      {onDismiss && (
        <button
          type="button"
          className="btn-icon"
          onClick={onDismiss}
          aria-label="Fechar aviso"
          style={{ width: 24, height: 24, border: 'none', background: 'transparent' }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};

interface PrecisionStepperProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  onChange: (next: number) => void;
}

export const PrecisionStepper: React.FC<PrecisionStepperProps> = ({
  label,
  value,
  min = 0,
  max = 12,
  onChange,
}) => (
  <div className="stepper">
    <span>{label}:</span>
    <span className="stepper-val mono">{value} dec</span>
    <button
      type="button"
      className="stepper-btn"
      onClick={() => onChange(Math.min(max, value + 1))}
      disabled={value >= max}
      title="Aumentar casas decimais"
    >
      <ChevronUp size={14} />
    </button>
    <button
      type="button"
      className="stepper-btn"
      onClick={() => onChange(Math.max(min, value - 1))}
      disabled={value <= min}
      title="Diminuir casas decimais"
    >
      <ChevronDown size={14} />
    </button>
  </div>
);

interface SegmentedOption<T extends string> {
  label: string;
  value: T;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (val: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="segmented" role="tablist">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          className={`segmented-btn ${value === opt.value ? 'active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export interface FormulaItemSpec {
  title: string;
  equation: string;
  description: string;
}

interface FormulaDrawerProps {
  open: boolean;
  title: string;
  summary: string;
  items: FormulaItemSpec[];
  onClose: () => void;
}

export const FormulaDrawer: React.FC<FormulaDrawerProps> = ({
  open,
  title,
  summary,
  items,
  onClose,
}) => {
  if (!open) return null;
  return (
    <div className="formula-card">
      <div className="card-header" style={{ paddingBottom: '0.55rem' }}>
        <h3 className="card-title">
          <BookOpen size={17} />
          <span>{title}</span>
        </h3>
        <button type="button" className="btn-icon" onClick={onClose} title="Fechar guia">
          <X size={15} />
        </button>
      </div>
      <div className="helper-text" style={{ fontSize: '0.82rem' }}>
        {summary}
      </div>
      <div className="formula-grid">
        {items.map((it, i) => (
          <div key={i} className="formula-item">
            <span className="formula-item-title">{it.title}</span>
            <span className="formula-item-eq mono">{it.equation}</span>
            <span className="formula-item-desc">{it.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

interface SectionDividerProps {
  icon?: React.ReactNode;
  label: string;
}

export const SectionDivider: React.FC<SectionDividerProps> = ({ icon, label }) => (
  <div className="section-divider">
    <span className="section-divider-label">
      {icon}
      <span>{label}</span>
    </span>
    <span className="section-divider-line" />
  </div>
);

interface EmptyGuideProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  steps: string[];
  onLoadExample?: () => void;
  exampleLabel?: string;
}

export const EmptyGuide: React.FC<EmptyGuideProps> = ({
  icon,
  title,
  description,
  steps,
  onLoadExample,
  exampleLabel = 'Carregar Exemplo Pronto',
}) => (
  <div className="empty-state">
    <div className="empty-state-icon">{icon}</div>
    <h3>{title}</h3>
    <p>{description}</p>
    <div className="empty-steps">
      {steps.map((s, i) => (
        <span key={i} className="empty-step-pill">
          {i + 1}. {s}
        </span>
      ))}
    </div>
    {onLoadExample && (
      <button type="button" className="btn btn-primary" onClick={onLoadExample}>
        <Sparkles size={15} />
        <span>{exampleLabel}</span>
      </button>
    )}
  </div>
);

interface ModalProps {
  title: string;
  icon?: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
}

export const Modal: React.FC<ModalProps> = ({ title, icon, onClose, children }) => {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3 className="modal-title">
            {icon}
            <span>{title}</span>
          </h3>
          <button type="button" className="btn-icon" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};
