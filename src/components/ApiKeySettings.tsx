import React, { useState, useEffect } from 'react';
import { Key, Eye, EyeOff, CheckCircle, Loader2, ExternalLink, X, Sparkles } from 'lucide-react';
import { getCoachioApiKey, setCoachioApiKey, removeCoachioApiKey, validateCoachioApiKey } from '../services/coachioService';
import { getGeminiApiKey, setGeminiApiKey, removeGeminiApiKey } from '../services/storageService';

interface ApiKeySettingsProps {
  onClose: () => void;
}

type Tab = 'google' | 'coachio';

export const ApiKeySettings: React.FC<ApiKeySettingsProps> = ({ onClose }) => {
  const [activeTab, setActiveTab] = useState<Tab>('google');

  // Google state
  const [googleKey, setGoogleKey] = useState('');
  const [googleShowKey, setGoogleShowKey] = useState(false);
  const [googleSaved, setGoogleSaved] = useState(false);

  // Coachio state
  const [coachioKey, setCoachioKey] = useState('');
  const [coachioShowKey, setCoachioShowKey] = useState(false);
  const [coachioStatus, setCoachioStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const [coachioSaved, setCoachioSaved] = useState(false);

  useEffect(() => {
    const existingGoogle = getGeminiApiKey();
    if (existingGoogle) {
      setGoogleKey(existingGoogle);
      setGoogleSaved(true);
    }
    const existingCoachio = getCoachioApiKey();
    if (existingCoachio) {
      setCoachioKey(existingCoachio);
      setCoachioSaved(true);
      setCoachioStatus('valid');
    }
  }, []);

  const handleGoogleSave = () => {
    if (!googleKey.trim()) return;
    setGeminiApiKey(googleKey.trim());
    setGoogleSaved(true);
  };

  const handleGoogleRemove = () => {
    removeGeminiApiKey();
    setGoogleKey('');
    setGoogleSaved(false);
  };

  const handleCoachioValidate = async () => {
    if (!coachioKey.trim()) return;
    setCoachioStatus('validating');
    const isValid = await validateCoachioApiKey(coachioKey.trim());
    setCoachioStatus(isValid ? 'valid' : 'invalid');
  };

  const handleCoachioSave = () => {
    if (!coachioKey.trim()) return;
    setCoachioApiKey(coachioKey.trim());
    setCoachioSaved(true);
  };

  const handleCoachioRemove = () => {
    removeCoachioApiKey();
    setCoachioKey('');
    setCoachioStatus('idle');
    setCoachioSaved(false);
  };

  const maskKey = (key: string) => key ? key.slice(0, 6) + '...' + key.slice(-4) : '';

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-surface border border-line rounded-2xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-line">
          <div className="flex items-center gap-3">
            <div className="bg-orange-500/10 p-2 rounded-lg">
              <Key size={20} className="text-orange-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-fg">API Settings</h2>
              <p className="text-xs text-subtle">Configure your API keys</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-raised transition-colors text-muted hover:text-fg"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-line">
          <button
            onClick={() => setActiveTab('google')}
            className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
              activeTab === 'google'
                ? 'text-indigo-400'
                : 'text-subtle hover:text-fg'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <Sparkles size={14} />
              Google Gemini
              {googleSaved && <span className="w-2 h-2 bg-success-fg rounded-full"></span>}
            </span>
            {activeTab === 'google' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-500" />
            )}
          </button>
          <button
            onClick={() => setActiveTab('coachio')}
            className={`flex-1 py-3 text-sm font-medium transition-colors relative ${
              activeTab === 'coachio'
                ? 'text-orange-400'
                : 'text-subtle hover:text-fg'
            }`}
          >
            <span className="flex items-center justify-center gap-2">
              <Sparkles size={14} />
              Coachio AI
              {coachioSaved && <span className="w-2 h-2 bg-success-fg rounded-full"></span>}
            </span>
            {activeTab === 'coachio' && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500" />
            )}
          </button>
        </div>

        {/* Google Tab */}
        {activeTab === 'google' && (
          <>
            <div className="p-6 space-y-5">
              <div className="bg-canvas border border-line rounded-lg p-4">
                <p className="text-xs text-muted leading-relaxed">
                  Enter your Google Gemini API key for direct Gemini backend generation.
                  This key is stored locally in your browser.
                </p>
                <a
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-indigo-400 hover:text-indigo-300 mt-2 inline-flex items-center gap-1 transition-colors"
                >
                  Get API Key from Google AI Studio <ExternalLink size={12} />
                </a>
              </div>

              <div>
                <label className="text-sm text-muted mb-2 block">Google API Key</label>
                <div className="relative">
                  <input
                    type={googleShowKey ? 'text' : 'password'}
                    value={googleKey}
                    onChange={(e) => {
                      setGoogleKey(e.target.value);
                      setGoogleSaved(false);
                    }}
                    placeholder="AIzaSy..."
                    className="w-full bg-canvas border border-line rounded-lg px-4 py-3 pr-12 text-sm text-fg font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                  <button
                    onClick={() => setGoogleShowKey(!googleShowKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-raised text-subtle hover:text-fg transition-colors"
                  >
                    {googleShowKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {googleSaved && googleKey && (
                <div className="bg-success-fg/5 border border-green-500/20 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle size={14} className="text-success" />
                  <span className="text-xs text-success">Saved: <span className="font-mono">{maskKey(googleKey)}</span></span>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-line flex items-center gap-3">
              {googleSaved && googleKey && (
                <button
                  onClick={handleGoogleRemove}
                  className="px-4 py-2.5 rounded-lg text-sm text-red-400 hover:bg-danger-fg/10 border border-red-500/20 transition-colors"
                >
                  Remove Key
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={handleGoogleSave}
                disabled={!googleKey.trim()}
                className="px-6 py-2.5 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </>
        )}

        {/* Coachio Tab */}
        {activeTab === 'coachio' && (
          <>
            <div className="p-6 space-y-5">
              <div className="bg-canvas border border-line rounded-lg p-4">
                <p className="text-xs text-muted leading-relaxed">
                  Enter your Coachio API key to use the Coachio AI backend for banner generation.
                  You can get your API key from the Coachio Studio dashboard.
                </p>
                <a
                  href="https://studio.coachio.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-orange-400 hover:text-orange-300 mt-2 inline-flex items-center gap-1 transition-colors"
                >
                  Open Coachio Studio <ExternalLink size={12} />
                </a>
              </div>

              <div>
                <label className="text-sm text-muted mb-2 block">Coachio API Key</label>
                <div className="relative">
                  <input
                    type={coachioShowKey ? 'text' : 'password'}
                    value={coachioKey}
                    onChange={(e) => {
                      setCoachioKey(e.target.value);
                      setCoachioStatus('idle');
                      setCoachioSaved(false);
                    }}
                    placeholder="lv_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    className="w-full bg-canvas border border-line rounded-lg px-4 py-3 pr-12 text-sm text-fg font-mono focus:outline-none focus:border-orange-500 transition-colors"
                  />
                  <button
                    onClick={() => setCoachioShowKey(!coachioShowKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md hover:bg-raised text-subtle hover:text-fg transition-colors"
                  >
                    {coachioShowKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {coachioStatus !== 'idle' && (
                <div className={`flex items-center gap-2 text-xs px-3 py-2 rounded-lg border ${
                  coachioStatus === 'validating' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                  coachioStatus === 'valid' ? 'bg-success-fg/10 border-green-500/20 text-success' :
                  'bg-red-500/10 border-red-500/20 text-red-400'
                }`}>
                  {coachioStatus === 'validating' && <><Loader2 size={14} className="animate-spin" /> Validating...</>}
                  {coachioStatus === 'valid' && <><CheckCircle size={14} /> API key is valid</>}
                  {coachioStatus === 'invalid' && <><X size={14} /> Invalid API key</>}
                </div>
              )}

              {coachioSaved && coachioKey && (
                <div className="bg-success-fg/5 border border-green-500/20 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle size={14} className="text-success" />
                  <span className="text-xs text-success">Saved: <span className="font-mono">{maskKey(coachioKey)}</span></span>
                </div>
              )}

              {/* Credits Info */}
              <div className="bg-canvas border border-line rounded-lg p-4">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">Credit Cost</h4>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-surface rounded-md p-2">
                    <p className="text-fg text-sm font-bold">3</p>
                    <p className="text-[10px] text-subtle">1K</p>
                  </div>
                  <div className="bg-surface rounded-md p-2">
                    <p className="text-fg text-sm font-bold">3</p>
                    <p className="text-[10px] text-subtle">2K</p>
                  </div>
                  <div className="bg-surface rounded-md p-2">
                    <p className="text-fg text-sm font-bold">4</p>
                    <p className="text-[10px] text-subtle">4K</p>
                  </div>
                </div>
                <p className="text-[10px] text-subtle mt-2">Credits per generation (Nano Banana Pro)</p>
              </div>
            </div>

            <div className="p-6 border-t border-line flex items-center gap-3">
              {coachioSaved && coachioKey && (
                <button
                  onClick={handleCoachioRemove}
                  className="px-4 py-2.5 rounded-lg text-sm text-red-400 hover:bg-danger-fg/10 border border-red-500/20 transition-colors"
                >
                  Remove Key
                </button>
              )}
              <div className="flex-1" />
              <button
                onClick={handleCoachioValidate}
                disabled={!coachioKey.trim() || coachioStatus === 'validating'}
                className="px-4 py-2.5 rounded-lg text-sm bg-raised text-fg hover:bg-raised-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Test Key
              </button>
              <button
                onClick={handleCoachioSave}
                disabled={!coachioKey.trim()}
                className="px-6 py-2.5 rounded-lg text-sm bg-orange-600 text-white hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
              >
                Save
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
