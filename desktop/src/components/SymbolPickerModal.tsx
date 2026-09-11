import { useState } from 'react';
import { X } from 'lucide-react';

interface SymbolPickerModalProps {
  onInsert: (symbol: string) => void;
  onClose: () => void;
}

const CATEGORIES: Record<string, string[]> = {
  'Greek (lowercase)': [
    'α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ',
    'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω',
    'ϐ', 'ϑ', 'ϕ', 'ϖ', 'ϱ', 'ς', 'ϵ', 'ϰ', 'ϝ', 'ϛ', 'ϙ', 'ϟ', 'ϡ',
  ],
  'Greek (uppercase)': [
    'Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ',
    'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω',
    'Ϝ', 'Ϛ', 'Ϙ', 'Ϟ', 'Ϡ', 'ϴ',
  ],
  'Math operators': [
    '±', '∓', '×', '÷', '√', '∛', '∜', '∑', '∏', '∐', '∫', '∬', '∭', '∮',
    '∂', '∇', '∞', '≈', '≃', '≅', '≌', '≡', '≠', '≤', '≥', '≪', '≫',
    '∝', '∴', '∵', '∈', '∉', '∋', '⊂', '⊃', '⊆', '⊇', '∪', '∩', '∅',
    '→', '←', '↔', '↑', '↓', '↕', '⇒', '⇐', '⇔', '⇑', '⇓',
    '∀', '∃', '∄', '¬', '∧', '∨', '⊕', '⊗', '⊙', '⊥', '∥', '∠', '∟',
    '⋅', '∘', '∼', '≐', '⌊', '⌋', '⌈', '⌉', '□', '∎', 'ℵ', 'ℏ', 'ℓ', '℘',
  ],
  'Sub/superscript': [
    '⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹',
    '⁺', '⁻', '⁼', '⁽', '⁾', 'ⁿ', 'ⁱ',
    '₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉',
    '₊', '₋', '₌', '₍', '₎',
    'ₐ', 'ₑ', 'ₒ', 'ₓ', 'ₔ', 'ₕ', 'ₖ', 'ₗ', 'ₘ', 'ₙ', 'ₚ', 'ₛ', 'ₜ',
  ],
  'Units & engineering': [
    'Ω', '℧', 'µ', 'Å', '°', '℃', '℉', '′', '″', '‴', '⁗', '∆',
    '‰', '‱', 'ℓ', '㎡', '㎥', '№',
  ],
};

export default function SymbolPickerModal({ onInsert, onClose }: SymbolPickerModalProps) {
  const [activeCategory, setActiveCategory] = useState(Object.keys(CATEGORIES)[0]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-surface border border-border rounded-md w-[480px] max-h-[70vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-border flex-shrink-0">
          <h3 className="text-section-header font-ui font-semibold">Insert Symbol</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary">
            <X size={18} />
          </button>
        </div>

        <div className="flex border-b border-border flex-shrink-0 overflow-x-auto">
          {Object.keys(CATEGORIES).map((category) => (
            <button
              key={category}
              onClick={() => setActiveCategory(category)}
              className={`px-3 py-2 text-xs whitespace-nowrap transition-colors border-b-2 ${
                activeCategory === category
                  ? 'text-accent border-accent'
                  : 'text-text-secondary border-transparent hover:text-text-primary'
              }`}
            >
              {category}
            </button>
          ))}
        </div>

        <div className="p-4 overflow-y-auto">
          <div className="grid grid-cols-8 gap-1.5">
            {CATEGORIES[activeCategory].map((symbol) => (
              <button
                key={symbol}
                onClick={() => onInsert(symbol)}
                className="aspect-square flex items-center justify-center bg-surface-raised border border-border rounded-sm hover:border-accent hover:text-accent transition-colors text-lg font-mono"
                title={symbol}
              >
                {symbol}
              </button>
            ))}
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-border text-xs text-text-secondary flex-shrink-0">
          Click a symbol to insert it at your cursor.
        </div>
      </div>
    </div>
  );
}
