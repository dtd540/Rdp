import { useEffect, useRef, useState, type FC } from 'react';
import { CHAT_TOKENS, DEFAULT_TEMPLATES, normaliseChatTemplates, renderChatTemplate, type ChatTemplate } from '@shared/chatbox';
import { validateChatText, type PcSnapshot } from '@shared/gaming';
import { importMagicStatuses } from '@shared/magicImport';
import { normaliseChatboxSettings, SETTINGS_VERSION } from '@shared/chatboxSettings';
import { CHAT_BORDER_STYLES, CHAT_BORDER_STYLE_DESCRIPTIONS, chatIntegrationValues, chatSourceRequest, CHAT_INTEGRATIONS, CHAT_MESSAGE_FRAMES, composeChatIntegrations, composeChatReport, composeCycleIntegrations, normaliseBorderStyle, SOURCE_BACKED_INTEGRATIONS, type ChatBorderStyleId, type ChatIntegrationId, type ChatIntegrationOptions, type ChatIntegrationSetting, type ChatLineSeparator, type ChatMessageFrameId } from '@shared/chatboxIntegrations';
import { applyChatIntegrationPreset, CHAT_INTEGRATION_PRESETS, matchingChatIntegrationPreset } from '@shared/chatboxPresets';
import { bridge } from '../bridge';

const KEY = 'vcmb:magic-chatbox:v1';
function loadTemplates(): ChatTemplate[] {
  try { return normaliseChatTemplates(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return DEFAULT_TEMPLATES; }
}
const SETTINGS_KEY = 'vcmb:magic-chatbox-settings:v1';
function loadSettings() {
  try { return normaliseChatboxSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null')); } catch { return normaliseChatboxSettings(null); }
}
const EMOJI = ['✨', '💜', '🎮', '🎵', '💧', '👋', '😊', '🖥', '🎧', '🌙', '☕', '🔇'];
const INTEGRATION_EMOJI_PALETTE = ['✨', '💜', '🪟', '📍', '🕒', '🎵', '🎤', '🖥️', '📊', '🌎', '👥', '⏱️', '🔋', '📅', '🎮', '🎧', '🌙', '☕', '💤', '📶', '🧊', '🔥', '⚡', '🚀'];

export const MagicChatbox: FC<{ activeTab?: string }> = ({ activeTab = 'Magic Chatbox' }) => {
  const [templates, setTemplates] = useState(loadTemplates);
  const [selectedId, setSelectedId] = useState(() => loadTemplates()[0]?.id ?? '');
  const [name, setName] = useState(() => loadTemplates()[0]?.name ?? 'My template');
  const [text, setText] = useState(() => loadTemplates()[0]?.text ?? '');
  const [settings] = useState(loadSettings);
  const [integrationSettings, setIntegrationSettings] = useState<ChatIntegrationSetting[]>(settings.integrations);
  const [integrationSources, setIntegrationSources] = useState<import('@shared/rpc').BridgeOpResult | null>(null);
  const [sourcesRequested, setSourcesRequested] = useState(false);
  const [worldRequested, setWorldRequested] = useState(false);
  const [sourceError, setSourceError] = useState('');
  const [activeSection, setActiveSection] = useState<'Integrations' | 'Status' | 'Chatting' | 'Controls' | 'Options'>('Integrations');
  const [showIntegrations, setShowIntegrations] = useState(true);
  const [showBroadcastOptions, setShowBroadcastOptions] = useState(false);
  const [integrationOptions, setIntegrationOptions] = useState<ChatIntegrationOptions>(settings.integrationOptions);
  const [borderStyle, setBorderStyle] = useState<ChatBorderStyleId>(settings.borderStyle);
  const [borderLeft, setBorderLeft] = useState(settings.borderLeft);
  const [borderRight, setBorderRight] = useState(settings.borderRight);
  const [lineSeparator, setLineSeparator] = useState<ChatLineSeparator>(settings.lineSeparator);
  const [messageFrame, setMessageFrame] = useState<ChatMessageFrameId>(settings.messageFrame);
  const [frameTop, setFrameTop] = useState(settings.frameTop);
  const [frameBottom, setFrameBottom] = useState(settings.frameBottom);
  const [presetSelection, setPresetSelection] = useState(() => matchingChatIntegrationPreset(settings.integrations));
  const [integrationFilter, setIntegrationFilter] = useState<'all' | 'enabled' | 'available'>('all');
  const [emojiModal, setEmojiModal] = useState<ChatIntegrationId | null>(null);
  const [activity, setActivity] = useState(settings.activity);
  const [status, setStatus] = useState(settings.status);
  const [clock24h, setClock24h] = useState(settings.clock24h);
  const [clockSeconds, setClockSeconds] = useState(settings.clockSeconds);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [history, setHistory] = useState<Array<{ text: string; at: number; draft: boolean }>>([]);
  const [nextSendAt, setNextSendAt] = useState<number | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const [cyclePosition, setCyclePosition] = useState(0);
  const [previewScale, setPreviewScale] = useState(100);
  const [previewOpacity, setPreviewOpacity] = useState(85);
  const [previewPosition, setPreviewPosition] = useState<'above' | 'forward'>('above');
  const [showMessageEditor, setShowMessageEditor] = useState(true);
  const [smartFit, setSmartFit] = useState(settings.smartFit);
  const [now, setNow] = useState(new Date());
  const [pc, setPc] = useState<PcSnapshot | null>(null);
  const [consent, setConsent] = useState(false);
  const [sound, setSound] = useState(settings.sound);
  const [sending, setSending] = useState(false);
  const [broadcast, setBroadcast] = useState(false);
  const [intervalSeconds, setIntervalSeconds] = useState(settings.intervalSeconds);
  const [note, setNote] = useState('');
  const [port, setPort] = useState(settings.port);
  const [detectingPort, setDetectingPort] = useState(false);
  const [sendImmediately, setSendImmediately] = useState(settings.sendImmediately);
  const [typing, setTypingState] = useState(false);
  const [cycleMode, setCycleMode] = useState(false);
  const [loopDrafts, setLoopDrafts] = useState(['', '']);
  const broadcastRef = useRef(false);
  const [librarySort, setLibrarySort] = useState<'name' | 'starred'>('name');
  const [templateFilter, setTemplateFilter] = useState<'all' | 'favourite' | 'cycle'>('all');
  const cycleIndex = useRef(0);
  const startedAt = useRef(Date.now());
  const importRef = useRef<HTMLInputElement>(null);
  const [sentCount, setSentCount] = useState(0);
  const [cycleEnabled, setCycleEnabled] = useState(templates.map((template) => template.cycle === true));
  const cycleEnabledRef = useRef(cycleEnabled);
  cycleEnabledRef.current = cycleEnabled;
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const pending = useRef(false);
  const lastContextError = useRef('');
  const lastWorldError = useRef('');
  const mounted = useRef(true);
  const lastPayload = useRef('');
  const lastSend = useRef(0);
  const context = { now, cpuPercent: pc?.cpuPercent, memoryUsed: pc?.memoryUsed, memoryTotal: pc?.memoryTotal, activity, status, clock24h, clockSeconds };
  const renderedBase = renderChatTemplate(text, context);
  const source = integrationSources;
  const integrationInput = {
    context, activeTab,
    windowTitle: source?.windowTitle,
    media: source?.media,
    cpuPercent: pc?.cpuPercent,
    cpuName: pc?.cpuName,
    memoryUsed: pc?.memoryUsed,
    memoryTotal: pc?.memoryTotal,
    receiveBytesPerSecond: source?.receiveBytesPerSecond,
    sendBytesPerSecond: source?.sendBytesPerSecond,
    currentWorld: source?.currentWorld,
    vrchatRunning: source?.vrchatRunning,
    appUptimeSeconds: source?.appUptimeSeconds,
    battery: source?.battery,
    instanceOccupancy: source?.instanceOccupancy,
    lyricifyLyrics: source?.lyricifyLyrics
  };
  const integrationValues = chatIntegrationValues({ ...integrationInput, options: integrationOptions });
  const composeOptions = { separator: lineSeparator, frame: messageFrame, frameTop, frameBottom, borderStyle, borderLeft, borderRight, smartFit };
  const fitReport = composeChatReport(renderedBase, integrationSettings, integrationValues, composeOptions);
  const rendered = fitReport.text;
  const previewRendered = rendered || renderedBase || 'Your message appears here…';
  const savedTemplate = templates.find((template) => template.id === selectedId);
  const dirty = !savedTemplate || savedTemplate.text !== text || savedTemplate.name !== name || savedTemplate.cycle !== (cycleEnabled[templates.indexOf(savedTemplate)] ?? savedTemplate.cycle === true);
  const cooldown = Math.max(0, Math.ceil((lastSend.current + 1500 - now.getTime()) / 1000));
  let cycleError = '';
  let cyclePreview: ReturnType<typeof composeCycleIntegrations> = [];
  const currentCycleTemplates = templates.map((template, index) => ({ ...template, cycle: cycleEnabled[index] ?? template.cycle === true }));
  try { cyclePreview = composeCycleIntegrations(currentCycleTemplates, context, integrationSettings, integrationValues, composeOptions); } catch (error) { cycleError = error instanceof Error ? error.message : String(error); }
  const count = Array.from(rendered).length;
  const validPort = Number.isInteger(port) && port >= 1024 && port <= 65535;
  let validation = '';
  try { validateChatText(rendered); } catch (error) { validation = error instanceof Error ? error.message : String(error); }
  const latest = useRef({ rendered, consent, sound, validation, port, sendImmediately, cycleMode, templates, currentCycleTemplates, integrationSettings, integrationValues, integrationInput, integrationOptions, composeOptions, activity, status, pc, clock24h, clockSeconds, cycleError });
  latest.current = { rendered, consent, sound, validation, port, sendImmediately, cycleMode, templates, currentCycleTemplates, integrationSettings, integrationValues, integrationInput, integrationOptions, composeOptions, activity, status, pc, clock24h, clockSeconds, cycleError };

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ version: SETTINGS_VERSION, activity, status, port, sound, smartFit, sendImmediately, intervalSeconds, clock24h, clockSeconds, integrations: integrationSettings, integrationOptions, lineSeparator, messageFrame, frameTop, frameBottom, borderStyle, borderLeft, borderRight })); }
    catch (error) { setNote(`Could not save chatbox settings: ${String(error)}`); }
  }, [activity, status, port, sound, smartFit, sendImmediately, intervalSeconds, clock24h, clockSeconds, integrationSettings, integrationOptions, lineSeparator, messageFrame, frameTop, frameBottom, borderStyle, borderLeft, borderRight]);

  useEffect(() => {
    mounted.current = true;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => { mounted.current = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { broadcastRef.current = broadcast; }, [broadcast]);
  useEffect(() => {
    if (!broadcast) return;
    if (activeSection !== 'Controls') { setBroadcast(false); broadcastRef.current = false; setNote('Broadcast stopped after leaving Controls.'); }
  }, [activeSection, broadcast]);
  const needsPc = /\{(cpu|ram)\}/.test(text) || integrationSettings.some((item) => item.enabled && ['system_stats', 'component_and_network_stats'].includes(item.id)) || (cycleMode && templates.some((template, index) => (cycleEnabled[index] ?? template.cycle === true) && /\{(cpu|ram)\}/.test(template.text)));
  useEffect(() => {
    if (!needsPc) return;
    let stop = false;
    let busy = false;
    const sample = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await bridge.op('pcSnapshot');
        if (!stop && result.ok && result.pc) setPc(result.pc);
        else if (!stop) setNote(result.detail ?? 'PC data is unavailable. Placeholders show unavailable.');
      } catch (error) { if (!stop) setNote(`PC data unavailable: ${String(error)}`); }
      finally { busy = false; }
    };
    void sample();
    const timer = window.setInterval(() => { if (!document.hidden) void sample(); }, 15000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [needsPc]);
  const needsContext = integrationSettings.some((item) => item.enabled && ['window_activity', 'media_status', 'app_uptime', 'pc_battery', 'component_and_network_stats'].includes(item.id));
  const needsCurrentWorld = integrationSettings.some((item) => item.id === 'current_world' && item.enabled);
  useEffect(() => {
    if (!needsCurrentWorld) { setWorldRequested(false); return; }
    let stop = false;
    let busy = false;
    const refreshWorld = async () => {
      if (busy) return;
      busy = true;
      setWorldRequested(true);
      try {
        const result = await bridge.op('chatboxContext', JSON.stringify({ currentWorld: true }));
        if (!stop && result.ok) { lastWorldError.current = ''; setSourceError(''); setIntegrationSources((current) => ({ ...current, ...result })); }
        else if (!stop && result.detail) { setSourceError(result.detail); if (result.detail !== lastWorldError.current) { lastWorldError.current = result.detail; setNote(result.detail); } }
      } catch (error) { if (!stop) { const detail = `VRChat world data unavailable: ${String(error)}`; setSourceError(detail); setNote(detail); } }
      finally { busy = false; if (!stop) setWorldRequested(false); }
    };
    void refreshWorld();
    const timer = window.setInterval(() => { if (!document.hidden) void refreshWorld(); }, 10000);
    const onVisible = () => { if (!document.hidden) void refreshWorld(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [needsCurrentWorld]);
  const sourceRequest = JSON.stringify(chatSourceRequest(integrationSettings));
  useEffect(() => {
    if (!needsContext) { setSourcesRequested(false); return; }
    setSourcesRequested(true);
    let stop = false;
    let busy = false;
    const sample = async () => {
      if (busy) return;
      busy = true;
      setSourcesRequested(true);
      try {
        const result = await bridge.op('chatboxContext', sourceRequest);
        if (!stop && result.ok) { lastContextError.current = ''; setSourceError(''); setIntegrationSources((current) => ({ ...current, ...result })); }
        else if (!stop && result.detail) { setSourceError(result.detail); if (result.detail !== lastContextError.current) { lastContextError.current = result.detail; setNote(result.detail); } }
      } catch (error) { if (!stop) { const detail = `Local integration data unavailable: ${String(error)}`; setSourceError(detail); if (detail !== lastContextError.current) { lastContextError.current = detail; setNote(detail); } } }
      finally { busy = false; if (!stop) setSourcesRequested(false); }
    };
    void sample();
    const timer = window.setInterval(() => { if (!document.hidden) void sample(); }, 10000);
    const onVisible = () => { if (!document.hidden) void sample(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stop = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [needsContext, sourceRequest]);

  const send = async (automatic = false, forced?: string): Promise<boolean> => {
    const value = latest.current;
    if (pending.current || !value.consent || (!forced && (automatic && value.cycleMode ? !!value.cycleError : !!value.validation)) || !Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || Date.now() - lastSend.current < 1500) return false;
    if (!forced && automatic && !value.cycleMode && value.rendered === lastPayload.current) return true;
    pending.current = true;
    setSending(true);
    try {
      let output = forced ?? value.rendered;
      if (!forced && automatic && value.cycleMode) {
        const cycleContext = { now: new Date(), activity: value.activity, status: value.status, cpuPercent: value.pc?.cpuPercent, memoryUsed: value.pc?.memoryUsed, memoryTotal: value.pc?.memoryTotal, clock24h: value.clock24h, clockSeconds: value.clockSeconds };
        const cycleInput = { ...value.integrationInput, activeTab, context: cycleContext, options: value.integrationOptions };
        const cycle = composeCycleIntegrations(value.templates.map((template, index) => ({ ...template, cycle: cycleEnabledRef.current[index] ?? template.cycle === true })), cycleContext, value.integrationSettings, chatIntegrationValues(cycleInput), value.composeOptions);
        output = cycle[cycleIndex.current % cycle.length].text;
      }
      const result = await bridge.op('sendChatbox', JSON.stringify({ text: output, sound: value.sound, send: value.sendImmediately, port: value.port }));
      if (!mounted.current) return false;
      setNote(result.detail ?? (result.ok ? 'Sent locally via OSC; delivery not confirmed.' : 'OSC send failed.'));
      if (!result.ok) { setBroadcast(false); broadcastRef.current = false; return false; }
      lastPayload.current = output;
      lastSend.current = Date.now();
      setLastSentAt(Date.now()); setSentCount((count) => count + 1);
      setHistory((items) => [{ text: output, at: Date.now(), draft: !value.sendImmediately }, ...items].slice(0, 20));
      if (automatic && value.cycleMode) { cycleIndex.current++; setCyclePosition(cycleIndex.current); }
      return true;
    } catch (error) {
      if (mounted.current) { setNote(String(error)); setBroadcast(false); broadcastRef.current = false; }
      return false;
    } finally {
      pending.current = false;
      if (mounted.current) setSending(false);
    }
  };

  const sendTemplate = (template: ChatTemplate) => {
    const value = latest.current;
    if (!value.consent) { setNote('Tick the OSC consent checkbox before sending.'); return; }
    try {
      const output = composeChatIntegrations(renderChatTemplate(template.text, { now: new Date(), activity: value.activity, status: value.status, cpuPercent: value.pc?.cpuPercent, memoryUsed: value.pc?.memoryUsed, memoryTotal: value.pc?.memoryTotal, clock24h: value.clock24h, clockSeconds: value.clockSeconds }), value.integrationSettings, value.integrationValues, value.composeOptions);
      validateChatText(output);
      void send(false, output);
    } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
  };

  useEffect(() => {
    if (!broadcast) { setNextSendAt(null); return; }
    setNextSendAt(Date.now() + intervalSeconds * 1000);
    startedAt.current = Date.now();
    const timer = window.setInterval(() => {
      if (!latest.current.consent || (latest.current.cycleMode ? !!latest.current.cycleError : !!latest.current.validation) || Date.now() - startedAt.current >= 60 * 60 * 1000) {
        setBroadcast(false); broadcastRef.current = false; setNote('Broadcast stopped: consent removed, message invalid, or one-hour safety limit reached.'); return;
      }
      setNextSendAt(Date.now() + intervalSeconds * 1000);
      if (!document.hidden) void send(true);
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [broadcast, intervalSeconds]);

  const save = (next: ChatTemplate[]) => {
    try { localStorage.setItem(KEY, JSON.stringify(next)); setTemplates(next); setCycleEnabled((current) => next.map((template, index) => current[index] ?? template.cycle === true)); cycleEnabledRef.current = next.map((template, index) => cycleEnabledRef.current[index] ?? template.cycle === true); setNote('Templates saved on this device.'); return true; }
    catch (error) { setNote(`Could not save templates: ${String(error)}`); return false; }
  };
  const savePresetLoop = () => {
    try {
      const messages = loopDrafts.map((message) => message.trim()).filter(Boolean);
      if (messages.length < 2) throw new Error('Write at least two messages for your loop.');
      messages.forEach((message) => validateChatText(message));
      if (templates.length + messages.length > 30) throw new Error('Not enough template slots. Delete unused templates first (maximum 30).');
      const stamp = Date.now();
      const next = [...templates.map((template) => ({ ...template, cycle: false })), ...messages.map((message, index) => ({ id: `loop-${stamp}-${index}`, name: `Loop message ${index + 1}`, text: message, cycle: true }))];
      setBroadcast(false); broadcastRef.current = false;
      if (!save(next)) return;
      cycleEnabledRef.current = next.map((template) => template.cycle === true);
      setCycleEnabled(cycleEnabledRef.current);
      setCycleMode(true); cycleIndex.current = 0; setCyclePosition(0);
      setShowBroadcastOptions(true); setActiveSection('Controls');
      setNote('Loop saved and selected. Confirm OSC consent and press Start broadcast to rotate these messages. Nothing starts automatically.');
    } catch (error) { setNote(error instanceof Error ? error.message : String(error)); }
  };
  const select = (template: ChatTemplate) => { setBroadcast(false); broadcastRef.current = false; setSelectedId(template.id); setName(template.name); setText(template.text); };
  const updateIntegration = (id: ChatIntegrationId, update: Partial<ChatIntegrationSetting>) => {
    setBroadcast(false); broadcastRef.current = false;
    setIntegrationSettings((current) => current.map((item) => item.id === id ? { ...item, ...update } : item));
    setPresetSelection('custom');
  };
  const moveIntegration = (id: ChatIntegrationId, direction: -1 | 1) => {
    setBroadcast(false); broadcastRef.current = false;
    setIntegrationSettings((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
    setPresetSelection('custom');
  };
  const detectPort = async () => {
    setDetectingPort(true);
    try {
      const result = await bridge.op('detectVrchatOscPort');
      if (result.ok && typeof result.port === 'number') {
        setPort(result.port);
        setNote(result.detail ?? `Using VRChat OSC receive port ${result.port}.`);
      } else {
        setNote(result.detail ?? 'Could not detect the VRChat OSC receive port. Enter it manually.');
      }
    } catch (error) {
      setNote(`Could not detect the VRChat OSC receive port: ${String(error)}`);
    } finally {
      setDetectingPort(false);
    }
  };
  const setTyping = async (enabled: boolean) => {
    try {
      const result = await bridge.op('setChatboxTyping', JSON.stringify({ typing: enabled, port }));
      if (!result.ok) throw new Error(result.detail ?? 'Typing indicator unavailable.');
      setTypingState(enabled); setNote(result.detail ?? 'Typing packet sent.');
    } catch (error) { setNote(String(error)); }
  };
  useEffect(() => {
    if (!typing) return;
    const timer = window.setTimeout(() => void setTyping(false), 5000);
    return () => { window.clearTimeout(timer); void bridge.op('setChatboxTyping', JSON.stringify({ typing: false, port })).catch(() => {}); };
  }, [typing, port]);
  const clearChatbox = async () => {
    setBroadcast(false);
    try {
      const result = await bridge.op('sendChatbox', JSON.stringify({ clear: true, port }));
      setNote(result.detail ?? (result.ok ? 'Clear packet sent.' : 'Could not clear.'));
    } catch (error) { setNote(String(error)); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Status imports are limited to 2 MB.');
      const imported = importMagicStatuses(await file.text());
      const next = [...templates];
      let added = 0;
      for (const template of imported.templates) {
        if (next.length >= 30) break;
        if (next.some((item) => item.text.toLowerCase() === template.text.toLowerCase())) continue;
        next.push({ ...template, id: `import-${Date.now()}-${added++}` });
      }
      if (save(next)) { cycleEnabledRef.current = next.map((item, index) => index < templates.length ? (cycleEnabledRef.current[index] ?? item.cycle === true) : (item.cycle === true)); setCycleEnabled(cycleEnabledRef.current); setNote(`Imported ${added} statuses. ${imported.skipped} invalid/duplicate records skipped. Maximum 30 templates; no source files changed.`); }
    } catch (error) { setNote(String(error)); }
    finally { if (importRef.current) importRef.current.value = ''; }
  };
  const exportTemplates = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, templates }, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'magic-chatbox-templates.json'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const insert = (value: string) => {
    const editor = editorRef.current;
    const start = editor?.selectionStart ?? text.length;
    const end = editor?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + value + text.slice(end));    setBroadcast(false); broadcastRef.current = false;
    requestAnimationFrame(() => { editor?.focus(); editor?.setSelectionRange(start + value.length, start + value.length); });
  };
  const openEmojiPicker = (id: ChatIntegrationId) => {
    setBroadcast(false); broadcastRef.current = false;
    setEmojiModal(id);
  };
  const closeEmojiPicker = () => setEmojiModal(null);
  const setIntegrationEmoji = (id: ChatIntegrationId, emoji: string, showEmoji: boolean) => {
    setBroadcast(false); broadcastRef.current = false;
    setIntegrationSettings((current) => current.map((item) => item.id === id ? { ...item, emoji, showEmoji } : item));
    setPresetSelection('custom');
  };
  const duplicate = () => {
    if (templates.length >= 30) { setNote('Template limit reached.'); return; }
    try { validateChatText(text); } catch (error) { setNote(String(error)); return; }
    const template = { id: `template-${Date.now()}`, name: `${name} copy`.slice(0, 60), text, cycle: false, favourite: false };
    if (save([...templates, template])) { cycleEnabledRef.current = [...cycleEnabledRef.current, false]; setCycleEnabled(cycleEnabledRef.current); select(template); }
  };
  const saveCurrent = () => {
    try { validateChatText(text); } catch (error) { setNote(String(error)); return; }
    const id = selectedId || `template-${Date.now()}`;
    if (!selectedId && templates.length >= 30) { setNote('You can save up to 30 templates.'); return; }
    const existingIndex = templates.findIndex((template) => template.id === id);
    const existing = templates[existingIndex];
    const template = { ...existing, id, name: name.trim() || 'Untitled', text, cycle: cycleEnabled[existingIndex] ?? existing?.cycle ?? false };
    const next = templates.some((t) => t.id === id) ? templates.map((t) => t.id === id ? template : t) : [...templates, template];
    if (save(next)) { const savedIndex = next.findIndex((item) => item.id === id); cycleEnabledRef.current = next.map((item, index) => index === savedIndex ? (cycleEnabledRef.current[index] ?? item.cycle === true) : item.cycle === true); setCycleEnabled(cycleEnabledRef.current); setSelectedId(id); }
  };

  const lineCount = rendered.split('\n').length;
  const visibleTemplates = templates.filter((template) => `${template.name} ${template.text}`.toLowerCase().includes(libraryQuery.toLowerCase()) && (templateFilter === 'all' || (templateFilter === 'favourite' ? template.favourite : (cycleEnabled[templates.indexOf(template)] ?? template.cycle) === true))).sort((a, b) => (librarySort === 'starred' ? Number(b.favourite) - Number(a.favourite) : 0) || a.name.localeCompare(b.name));

  const actionsRef = useRef({ send: () => {}, save: () => {} });
  actionsRef.current = { send: () => void send(), save: saveCurrent };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) && key !== 'enter' && key !== 's') return;
      if (key === 'enter' && !event.repeat) { event.preventDefault(); actionsRef.current.send(); }
      else if (key === 's' && !event.repeat) { event.preventDefault(); actionsRef.current.save(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return    <div className="magic-chatbox" data-section={activeSection}>
    <div className="gamer-hero"><div><span className="section-kicker">A LITTLE MAGIC. YOUR WORDS.</span><h1>Magic <em>Chatbox</em></h1><p>Build a personal status card for VRChat. Mix text, emoji, clock and PC stats, then send through local OSC. No avatar mods or account login.</p></div><span className="gamer-hero-orbit" aria-hidden="true">✦</span></div>
    {emojiModal &&  (<div className="magic-emoji-modal-backdrop" aria-modal="true" role="dialog" aria-label={`Emoji for ${CHAT_INTEGRATIONS.find((d) => d.id === emojiModal)?.label}`} onClick={closeEmojiPicker}><div className="magic-emoji-modal" onClick={(event) => event.stopPropagation()} role="document"><div className="magic-emoji-modal-head"><div><h2>Emoji for {CHAT_INTEGRATIONS.find((d) => d.id === emojiModal)?.label}</h2><small>Pick an emoji to show in front of this line, or turn it off.</small></div><button className="small ghost" onClick={closeEmojiPicker} aria-label="Close emoji picker">Close</button></div><label className="magic-emoji-toggle-row"><input type="checkbox" id="magic-emoji-toggle" checked={integrationSettings.find((item) => item.id === emojiModal)?.showEmoji ?? true} onChange={(event) => setIntegrationEmoji(emojiModal, integrationSettings.find((item) => item.id === emojiModal)?.emoji ?? '', event.target.checked)} /><div><strong>Show emoji on this line</strong><small>Adds the selected emoji before the line text.</small></div></label>    <div className="magic-emoji-grid">{INTEGRATION_EMOJI_PALETTE.map((emoji) => { const current = integrationSettings.find((item) => item.id === emojiModal)?.emoji === emoji; return <button key={emoji} type="button" className={current ? 'is-current' : ''} aria-pressed={current} aria-label={`Use ${emoji}`} onClick={() => { setIntegrationEmoji(emojiModal, emoji, true); closeEmojiPicker(); }}>{emoji}</button>; })}</div><div className="magic-emoji-actions"><button className="small" onClick={() => { const item = integrationSettings.find((item) => item.id === emojiModal); setIntegrationEmoji(emojiModal, item?.emoji ?? '', false); }}>Remove emoji</button></div></div></div>)}
      <div className="magic-layout" data-section={activeSection}>
      <nav className="magic-section-tabs" aria-label="Magic Chatbox sections">{(['Integrations', 'Status', 'Chatting', 'Controls', 'Options'] as const).map((section) => <button key={section} type="button" className={`tab${activeSection === section ? ' active' : ''}`} aria-current={activeSection === section ? 'page' : undefined} onClick={() => setActiveSection(section)}>{section}</button>)}</nav>
      {note && <div className="inline-notice" role="status">{note}</div>}

      <aside className="card magic-templates magic-section-chatting"><div className="section-heading"><h2>Templates</h2><button className="small" onClick={() => { setBroadcast(false); broadcastRef.current = false; setSelectedId(''); setName('New template'); setText(''); }}>+ New</button></div><label className="field-label">Search templates<input type="search" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Name or message…" /></label><div className="tabs games-sorts"><button className={`tab${librarySort === 'name' ? ' active' : ''}`} onClick={() => setLibrarySort('name')}>Name</button><button className={`tab${librarySort === 'starred' ? ' active' : ''}`} onClick={() => setLibrarySort('starred')}>Starred</button></div><div className="tabs games-sorts"><button className={`tab${templateFilter === 'all' ? ' active' : ''}`} onClick={() => setTemplateFilter('all')}>All</button><button className={`tab${templateFilter === 'favourite' ? ' active' : ''}`} onClick={() => setTemplateFilter('favourite')}>Favourites</button><button className={`tab${templateFilter === 'cycle' ? ' active' : ''}`} onClick={() => setTemplateFilter('cycle')}>Cycle</button></div>{visibleTemplates.map((template) => <div className={`template-item${selectedId === template.id ? ' is-active' : ''}`} key={template.id}><button className="template-select" onClick={() => select(template)}><b>{template.favourite ? '★ ' : ''}{template.name}{cycleEnabled[templates.indexOf(template)] ?? template.cycle ? ' · ↻' : ''}</b><small>{template.text}</small></button><div className="template-actions"><button className="small ghost" aria-label={`Send ${template.name} now`} title="Send this template now" disabled={!consent || sending || cooldown > 0} onClick={() => sendTemplate(template)}>{cooldown > 0 ? `Wait ${cooldown}s` : 'Send'}</button></div></div>)}{visibleTemplates.length === 0 && <p className="hint">No templates match your search or filter.</p>}<p className="hint">Saved locally · {templates.length} / 30</p><div className="row"><button className="small" onClick={() => importRef.current?.click()}>Import statuses</button><button className="small" onClick={exportTemplates}>Export</button></div><input hidden ref={importRef} type="file" accept=".xml,.json" onChange={(event) => void importFile(event.target.files?.[0])} /><p className="hint">Supports MagicChatbox StatusList.xml and JSON. Reads only the file you choose.</p></aside>
      <section className={`card magic-editor magic-section-chatting${showMessageEditor ? ' is-open' : ''}`}>{showMessageEditor && <><div className="section-heading"><h2>Edit chatbox message</h2><span className="pill">{dirty ? 'Unsaved changes' : 'Saved'}</span></div><label className="field-label">Template name<input maxLength={60} value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-label">Message template<textarea ref={editorRef} rows={5} value={text} onChange={(event) => { setText(event.target.value); setBroadcast(false); broadcastRef.current = false; }} placeholder="{status}\n{activity} · {time}" /></label><div className="token-row">{CHAT_TOKENS.map((token) => <button className="small ghost" key={token} onClick={() => insert(token)}>{token}</button>)}</div><div className="emoji-row">{EMOJI.map((emoji) => <button className="small ghost" aria-label={`Insert ${emoji}`} key={emoji} onClick={() => insert(emoji)}>{emoji}</button>)}</div><div className="gamer-columns"><label className="field-label">Activity<input maxLength={60} value={activity} onChange={(event) => setActivity(event.target.value)} /></label><label className="field-label">Status<input maxLength={60} value={status} onChange={(event) => setStatus(event.target.value)} /></label></div>{selectedId && <div className="row"><label className="check-row"><input type="checkbox" checked={templates.find((template) => template.id === selectedId)?.favourite ?? false} onChange={(event) => save(templates.map((template) => template.id === selectedId ? { ...template, favourite: event.target.checked } : template))} />Starred status</label><label className="check-row"><input type="checkbox" checked={cycleEnabled[templates.findIndex((template) => template.id === selectedId)] ?? (templates.find((template) => template.id === selectedId)?.cycle ?? false)} onChange={(event) => { const index = templates.findIndex((template) => template.id === selectedId); setCycleEnabled((current) => { const next = current.map((enabled, itemIndex) => itemIndex === index ? event.target.checked : enabled); cycleEnabledRef.current = next; return next; }); }} />Include in cycle</label></div>}<div className="row"><button className="primary" onClick={saveCurrent}>Save template</button><button onClick={duplicate}>Duplicate</button>{selectedId && <button className="ghost" onClick={() => { if (!window.confirm(`Delete “${name}”?`)) return; setBroadcast(false); broadcastRef.current = false; if (save(templates.filter((template) => template.id !== selectedId))) { const nextCycle = cycleEnabledRef.current.filter((_, index) => templates[index].id !== selectedId); cycleEnabledRef.current = nextCycle; setCycleEnabled(nextCycle); setSelectedId(''); setName('New template'); setText(''); } }}>Delete template</button>}<button className="small ghost" onClick={() => setShowMessageEditor(false)}>Done editing</button></div></>}</section>
      <section className="card magic-preset-loop magic-section-chatting"><div className="section-heading"><div><span className="section-kicker">PRESET LOOP</span><h2>Rotate your messages</h2></div><span className="pill">Manual start only</span></div><p className="hint">Write one message per box. Save the loop, then start it in Controls. Messages rotate in order at your chosen interval using the same smart fitting and OSC safety checks.</p>{loopDrafts.map((message, index) => <div className="magic-loop-message" key={index}><label className="field-label" style={{ flex: 1 }}>Loop message {index + 1}<textarea aria-label={`Loop message ${index + 1}`} rows={2} value={message} onChange={(event) => setLoopDrafts((current) => current.map((entry, i) => i === index ? event.target.value : entry))} placeholder="Type a message or use {status}, {time}…" /><small>{Array.from(message).length} / 144 characters</small></label><button type="button" className="small ghost" disabled={loopDrafts.length <= 2} onClick={() => setLoopDrafts((current) => current.filter((_, i) => i !== index))} aria-label={`Remove loop message ${index + 1}`}>Remove</button></div>)}<div className="row"><button type="button" className="small" disabled={loopDrafts.length >= 10} onClick={() => setLoopDrafts((current) => [...current, ''])}>Add loop message</button><button type="button" className="primary" onClick={savePresetLoop}>Save loop &amp; open controls</button></div><p className="hint">Adds saved templates and replaces the selected cycle queue, not your existing templates. Up to 10 messages here and 30 saved templates total.</p></section>
      <section className="card magic-options-panel magic-section-options"><div className="section-heading"><div><span className="section-kicker">MESSAGE STYLE</span><h2>Options</h2></div><span className="pill">Saved on this device</span></div><div className="magic-option-grid"><label className="field-label">Line separator<select value={lineSeparator} onChange={(event) => setLineSeparator(event.target.value as ChatLineSeparator)}><option value="newline">New line</option><option value="pipe">Inline · ┆</option></select></label><label className="field-label">Inline border<select value={borderStyle} onChange={(event) => { setBorderStyle(event.target.value as ChatBorderStyleId); setBroadcast(false); broadcastRef.current = false; }}>{Object.entries(CHAT_BORDER_STYLES).map(([id, border]) => <option key={id} value={id}>{border.label}</option>)}<option key="custom" value="custom">Custom…</option></select></label></div>
      {borderStyle === 'custom' && <div className="inline-border-custom"><label className="field-label">Custom left wrap<input maxLength={12} value={borderLeft} onChange={(event) => { setBorderLeft(event.target.value); setBroadcast(false); broadcastRef.current = false; }} placeholder="e.g. <<" /></label><label className="field-label">Custom right wrap<input maxLength={12} value={borderRight} onChange={(event) => { setBorderRight(event.target.value); setBroadcast(false); broadcastRef.current = false; }} placeholder="e.g. >>" /></label></div>}
      <div className="magic-option-grid"><label className="field-label">Message frame<select value={messageFrame} onChange={(event) => setMessageFrame(event.target.value as ChatMessageFrameId)}>{Object.entries(CHAT_MESSAGE_FRAMES).map(([id, frame]) => <option key={id} value={id}>{frame.label}</option>)}<option value="custom">Custom…</option></select></label></div>{messageFrame === 'custom' && <div className="magic-option-grid"><label className="field-label">Frame top<input maxLength={24} value={frameTop} onChange={(event) => setFrameTop(event.target.value)} placeholder="Optional top border" /></label><label className="field-label">Frame bottom<input maxLength={24} value={frameBottom} onChange={(event) => setFrameBottom(event.target.value)} placeholder="Optional bottom border" /></label></div>}<div className="magic-options-group"><span className="section-kicker">INTEGRATION OUTPUT</span><div className="magic-option-grid"><label className="check-row"><input type="checkbox" checked={integrationOptions.timePrefix} onChange={(event) => setIntegrationOptions((value) => ({ ...value, timePrefix: event.target.checked }))} />Prefix time with “My time”</label><label className="check-row"><input type="checkbox" checked={integrationOptions.timeZoneName} onChange={(event) => setIntegrationOptions((value) => ({ ...value, timeZoneName: event.target.checked }))} />Show timezone</label><label className="check-row"><input type="checkbox" checked={integrationOptions.windowQuoted} onChange={(event) => setIntegrationOptions((value) => ({ ...value, windowQuoted: event.target.checked }))} />Describe foreground window</label><label className="check-row"><input type="checkbox" checked={integrationOptions.mediaOnlyPlaying} onChange={(event) => setIntegrationOptions((value) => ({ ...value, mediaOnlyPlaying: event.target.checked }))} />Hide media when paused</label><label className="check-row"><input type="checkbox" checked={integrationOptions.mediaDashFormat} onChange={(event) => setIntegrationOptions((value) => ({ ...value, mediaDashFormat: event.target.checked }))} />Format media as title – artist</label><label className="check-row"><input type="checkbox" checked={integrationOptions.mediaSource} onChange={(event) => setIntegrationOptions((value) => ({ ...value, mediaSource: event.target.checked }))} />Include media app/source</label><label className="check-row"><input type="checkbox" checked={integrationOptions.mediaProgress} onChange={(event) => setIntegrationOptions((value) => ({ ...value, mediaProgress: event.target.checked }))} />Include elapsed / duration</label><label className="check-row"><input type="checkbox" checked={integrationOptions.mediaProgressBar} onChange={(event) => setIntegrationOptions((value) => ({ ...value, mediaProgressBar: event.target.checked }))} />Include progress bar</label><label className="check-row"><input type="checkbox" checked={integrationOptions.worldPrefixed} onChange={(event) => setIntegrationOptions((value) => ({ ...value, worldPrefixed: event.target.checked }))} />Prefix world with “In”</label><label className="check-row"><input type="checkbox" checked={integrationOptions.uptimePrefixed} onChange={(event) => setIntegrationOptions((value) => ({ ...value, uptimePrefixed: event.target.checked }))} />Prefix uptime with “Up”</label><label className="check-row"><input type="checkbox" checked={integrationOptions.batteryPrefixed} onChange={(event) => setIntegrationOptions((value) => ({ ...value, batteryPrefixed: event.target.checked }))} />Prefix battery status</label><label className="check-row"><input type="checkbox" checked={integrationOptions.lyricifyOnlyPlaying} onChange={(event) => setIntegrationOptions((value) => ({ ...value, lyricifyOnlyPlaying: event.target.checked }))} />Show lyric line only when playing</label></div></div>{messageFrame === 'custom' && <div className="magic-option-grid"><label className="field-label">Frame top<input maxLength={24} value={frameTop} onChange={(event) => setFrameTop(event.target.value)} placeholder="Optional top border" /></label><label className="field-label">Frame bottom<input maxLength={24} value={frameBottom} onChange={(event) => setFrameBottom(event.target.value)} placeholder="Optional bottom border" /></label></div>}<p className="hint">{CHAT_BORDER_STYLE_DESCRIPTIONS[borderStyle]}</p><div className="magic-options-group"><span className="section-kicker">CLOCK</span><div className="magic-option-grid"><label className="check-row"><input type="checkbox" checked={clock24h} onChange={(event) => setClock24h(event.target.checked)} />24-hour clock</label><label className="check-row"><input type="checkbox" checked={clockSeconds} onChange={(event) => setClockSeconds(event.target.checked)} />Show seconds</label></div></div><div className="magic-options-group"><span className="section-kicker">SENDING</span><div className="magic-option-grid"><label className="check-row"><input type="checkbox" checked={sound} onChange={(event) => setSound(event.target.checked)} />Play notification sound when sending</label><label className="check-row"><input type="checkbox" checked={sendImmediately} onChange={(event) => { setSendImmediately(event.target.checked); setBroadcast(false); broadcastRef.current = false; }} />Send immediately (off = populate VRChat keyboard)</label></div></div><div className="magic-options-group"><span className="section-kicker">SMART MESSAGE FITTING</span><label className="check-row"><input type="checkbox" checked={smartFit} onChange={(event) => { setSmartFit(event.target.checked); setBroadcast(false); broadcastRef.current = false; }} />Fit optional integration lines within 144 characters and 9 lines</label><p className="hint">Your message is never clipped. Low-priority lines drop first; ties keep earlier lines. If your message and frame alone exceed the limit, sending stays blocked.</p></div><p className="hint">These preferences are local. Sending consent is never saved and must be re-confirmed each visit.</p></section>
      <section className="card magic-output magic-section-chatting"><div className="section-heading magic-preview"><div><span className="section-kicker">IN-WORLD CHATBOX</span><p className="hint">This is what your current message looks like in VRChat.</p></div><div className="row magic-preview-actions"><button className="small" onClick={() => { setShowMessageEditor((shown) => !shown); if (!showMessageEditor) setTimeout(() => document.querySelector('.magic-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }}>{showMessageEditor ? 'Close editor' : 'Edit message'}</button><button className="small ghost" onClick={() => void navigator.clipboard.writeText(rendered).then(() => setNote('Preview copied.')).catch((error) => setNote(`Could not copy: ${String(error)}`))}>Copy</button></div></div><div className="magic-preview-tuning magic-preview"><div className="magic-preview-position" role="group" aria-label="Chatbox position"><span>Position</span><button type="button" className={`small${previewPosition === 'above' ? ' active' : ''}`} aria-pressed={previewPosition === 'above'} onClick={() => setPreviewPosition('above')}>Above head</button><button type="button" className={`small${previewPosition === 'forward' ? ' active' : ''}`} aria-pressed={previewPosition === 'forward'} onClick={() => setPreviewPosition('forward')}>Forward</button></div><label>Chatbox size <input aria-label="Preview chatbox size" type="range" min="50" max="150" step="5" value={previewScale} onChange={(event) => setPreviewScale(Number(event.target.value))} /><output>{previewScale}%</output></label><label>Background opacity <input aria-label="Preview background opacity" type="range" min="25" max="100" step="5" value={previewOpacity} onChange={(event) => setPreviewOpacity(Number(event.target.value))} /><output>{previewOpacity}%</output></label><button className="small ghost" onClick={() => { setPreviewScale(100); setPreviewOpacity(85); setPreviewPosition('above'); }}>Reset preview</button></div><div className={`magic-vrchat-preview magic-preview${previewPosition === 'forward' ? ' is-forward' : ''}`} aria-label={`VRChat-style chatbox preview, ${previewPosition === 'above' ? 'above head' : 'forward'} position, ${previewScale}% size and ${previewOpacity}% background opacity`}><div className="magic-vrchat-bubble" style={{ transform: `scale(${previewScale / 100})`, backgroundColor: `rgba(12, 14, 19, ${previewOpacity / 100})` }}>{previewRendered}</div><div className="magic-preview-avatar" aria-hidden="true"><span className="magic-preview-avatar-head" /><span className="magic-preview-avatar-body" /></div><span className="magic-preview-world-label">AVATAR · {previewPosition === 'above' ? 'ABOVE-HEAD' : 'FORWARD'} POSITION</span></div>{fitReport.omitted.length > 0 && <div className="inline-notice magic-preview" role="status"><b>Smart fit · {fitReport.originalCharacters} → {count} characters</b><p>Left out: {fitReport.omitted.map((id) => CHAT_INTEGRATIONS.find((item) => item.id === id)?.label ?? id).join(', ')}. Your message is unchanged.</p></div>}<div className="chatbox-footer magic-preview"><div className="chat-meters"><div className="chat-meter"><span>Characters</span><div className="meter-track"><i className={count > 144 ? 'over' : count > 120 ? 'warn' : ''} style={{ width: `${Math.min(100, count / 144 * 100)}%` }} /></div><small>{count} / 144</small></div><div className="chat-meter"><span>Lines</span><div className="meter-track"><i className={lineCount > 9 ? 'over' : lineCount > 7 ? 'warn' : ''} style={{ width: `${Math.min(100, lineCount / 9 * 100)}%` }} /></div><small>{lineCount} / 9</small></div></div><span className="pill">OSC · 127.0.0.1:{port}</span></div>{validation && <p className="hint text-warn magic-preview">{validation}</p>}<p className="hint magic-preview">Preview is an approximation: VRChat’s font rendering, world lighting, avatar, and per-user settings affect the in-game result. Match the size, opacity, and position controls to your VRChat Chatbox settings.</p><section className="integration-panel magic-integration-view magic-section-integrations"><div className="section-heading"><div><h2>Integrations</h2><p className="hint">Add optional local context to the message. Off by default; enable only what you want shared.</p></div><button className="small" onClick={() => setShowIntegrations((shown) => !shown)}>{showIntegrations ? 'Hide' : 'Configure'}</button></div>{showIntegrations && <><div className="integration-presets"><label className="field-label">Integration preset<select aria-label="Integration preset" value={presetSelection} onChange={(event) => { const chosen = event.target.value; setPresetSelection(chosen); if (chosen !== 'custom') { setBroadcast(false); broadcastRef.current = false; setIntegrationSettings((current) => applyChatIntegrationPreset(chosen, current)); } }}><option value="custom">Custom selection</option>{CHAT_INTEGRATION_PRESETS.map((preset) => <option value={preset.id} key={preset.id}>{preset.label} — {preset.description}</option>)}</select></label></div><div className="integration-filters"><button className={`tab${integrationFilter === 'all' ? ' active' : ''}`} onClick={() => setIntegrationFilter('all')}>All {integrationSettings.length}</button><button className={`tab${integrationFilter === 'enabled' ? ' active' : ''}`} onClick={() => setIntegrationFilter('enabled')}>Enabled {integrationSettings.filter((item) => item.enabled).length}</button><button className={`tab${integrationFilter === 'available' ? ' active' : ''}`} onClick={() => setIntegrationFilter('available')}>Available</button></div><div className="integration-list">{integrationSettings.map((item, index) => { const definition = CHAT_INTEGRATIONS.find((entry) => entry.id === item.id)!; const available = definition.source === 'external' && ['lyricify_lyrics', 'instance_players'].includes(item.id) ? false : item.id === 'window_activity' ? !sourcesRequested && typeof source?.windowTitle === 'string' : item.id === 'media_status' ? !sourcesRequested && !!source?.media : item.id === 'pc_battery' ? !sourcesRequested && !!source?.battery : item.id === 'current_world' ? !sourcesRequested && !!source?.currentWorld : item.id === 'component_and_network_stats' ? pc?.memoryTotal != null : true; const showIntegration = integrationFilter === 'all' || (integrationFilter === 'enabled' && item.enabled) || (integrationFilter === 'available' && (definition.source === 'local' && !['window_activity', 'media_status', 'pc_battery', 'current_world', 'component_and_network_stats'].includes(item.id) || available)); return showIntegration ? <div className={`integration-item${item.enabled ? ' is-enabled' : ''}`} key={item.id}><label className="check-row"><input type="checkbox" checked={item.enabled} onChange={(event) => updateIntegration(item.id, { enabled: event.target.checked })} /><b>{definition.label}</b></label><span className="integration-description">{definition.description}</span><div className="integration-controls"><button className="magic-emoji-picker" aria-label={`Choose ${definition.label} emoji`} onClick={() => openEmojiPicker(item.id)} title="Choose emoji" type="button">{item.showEmoji !== false ? item.emoji : '⊘'}</button><select aria-label={`${definition.label} priority`} value={item.priority ?? 'normal'} onChange={(event) => updateIntegration(item.id, { priority: event.target.value as 'high' | 'normal' | 'low' })}><option value="high">High priority</option><option value="normal">Normal priority</option><option value="low">Low priority</option></select><input aria-label={`${definition.label} format`} value={item.format} maxLength={100} title="Use {emoji} and {value}" onChange={(event) => updateIntegration(item.id, { format: event.target.value })} /><button className="small" aria-label={`Move ${definition.label} up`} disabled={index === 0} onClick={() => moveIntegration(item.id, -1)}>↑</button><button className="small" aria-label={`Move ${definition.label} down`} disabled={index === integrationSettings.length - 1} onClick={() => moveIntegration(item.id, 1)}>↓</button><button className="small ghost" aria-label={`Restore ${definition.label} default`} title="Restore default emoji, format, and emoji-on" onClick={() => updateIntegration(item.id, { emoji: definition.emoji, format: definition.format, showEmoji: true })}>↺</button><span className={`pill ${item.enabled && available ? 'ok' : ''}`}>{item.enabled ? ((sourcesRequested && SOURCE_BACKED_INTEGRATIONS.includes(item.id)) || (worldRequested && item.id === 'current_world')) ? 'Loading' : available ? 'Ready' : 'Unavailable' : 'Off'}</span></div></div> : null; })}</div><p className="hint">Foreground window titles may expose document names; enabled titles are sent to VRChat and visible to nearby people. This integration remains off until you enable it. Local integration data refreshes every 10 seconds while needed.</p><p className="hint">Synchronized lyrics require an external provider not configured in this app. Instance player counts are not available from local logs; neither integration invents data.</p></>}</section><section className="card magic-status-view magic-section-status"><div className="section-heading"><div><span className="section-kicker">LIVE STATUS</span><h2>Integration health</h2></div><span className={`pill ${integrationSettings.some((item) => item.enabled) ? 'ok' : ''}`}>{integrationSettings.filter((item) => item.enabled).length} enabled</span></div><div className="magic-status-grid"><div><b>{sourcesRequested || worldRequested ? 'Refreshing local sources…' : integrationSources ? 'Local sources responded' : sourceError ? 'Local sources unavailable' : needsContext || needsCurrentWorld ? 'Waiting for local source data…' : 'No source probe needed yet'}</b><small>{sourceError || 'Windows context is sampled only when an enabled integration needs it.'}</small></div><div><b>{integrationSettings.filter((item) => item.enabled).length} / {integrationSettings.length} integrations on</b><small>Disabled integrations are not included in composed messages.</small></div><div><b>{lastSentAt ? new Date(lastSentAt).toLocaleTimeString() : 'No chatbox send this visit'}</b><small>{sentCount} OSC sends initiated; UDP cannot confirm VRChat delivery.</small></div><div><b>{integrationSources?.vrchatRunning ? 'VRChat running' : integrationSources?.vrchatRunning === false ? 'VRChat not detected' : 'VRChat state unknown'}</b><small>World names are shown only when VRChat is detected and a recent local log has one.</small></div></div><div className="magic-source-list">{integrationSettings.map((item) => { const definition = CHAT_INTEGRATIONS.find((entry) => entry.id === item.id)!; const value = integrationValues[item.id]?.trim(); const external = item.id === 'lyricify_lyrics' || item.id === 'instance_players'; const busy = (sourcesRequested && SOURCE_BACKED_INTEGRATIONS.includes(item.id)) || (worldRequested && item.id === 'current_world'); const ready = !external && (item.id === 'window_activity' ? !!source?.windowTitle : item.id === 'media_status' ? !!source?.media : item.id === 'pc_battery' ? !!source?.battery : item.id === 'current_world' ? !!source?.currentWorld : item.id === 'component_and_network_stats' ? pc?.memoryTotal != null : true); return <div className="magic-source-row" key={item.id}><span className={`magic-source-dot ${!item.enabled ? 'is-off' : external ? 'is-unavailable' : ready ? 'is-ready' : busy ? 'is-loading' : 'is-empty'}`} /><div><b>{definition.label}</b><small>{!item.enabled ? 'Off' : external ? 'Unavailable · source not connected' : busy ? 'Loading local data…' : ready ? value || 'Ready · no current value' : 'No current value'}</small></div><span className="pill">{!item.enabled ? 'Off' : external ? 'Unavailable' : ready ? 'Ready' : busy ? 'Loading' : 'No data'}</span></div>; })}</div></section><section className="card magic-control-panel magic-controls"><div className="magic-controls-header"><div><span className="section-kicker">VRCHAT OSC</span><h2>Chatbox controls</h2><p className="hint">Send, clear, or schedule your current message. This app sends only to localhost.</p></div><span className={`pill ${broadcast ? 'ok' : ''}`}>{broadcast ? 'Broadcast active' : 'Manual mode'}</span></div><label className="check-row magic-controls"><input type="checkbox" checked={consent} onChange={(event) => { setConsent(event.target.checked); if (!event.target.checked) { setBroadcast(false); broadcastRef.current = false; } }} />I enabled OSC and want to send these messages</label><button className="small ghost magic-controls" onClick={() => setShowBroadcastOptions((shown) => !shown)}>{showBroadcastOptions ? 'Hide broadcast options' : 'Broadcast options'}</button>{showBroadcastOptions && <div className="broadcast-advanced magic-controls"><label className="check-row"><input type="checkbox" checked={cycleMode} onChange={(event) => { setCycleMode(event.target.checked); setBroadcast(false); broadcastRef.current = false; cycleIndex.current = 0; }} />Cycle selected saved templates ({cycleEnabled.filter(Boolean).length})</label><label className="field-label">Broadcast interval<select value={intervalSeconds} disabled={broadcast} onChange={(event) => setIntervalSeconds(Number(event.target.value))}>{[15, 30, 60, 120].map((seconds) => <option value={seconds} key={seconds}>{seconds} seconds</option>)}</select></label>{cycleMode && <div className="cycle-preview"><h2>Cycle queue</h2>{cycleError ? <p className="hint text-warn">{cycleError}</p> : <ol>{cyclePreview.map((template, index) => <li key={template.id} className={index === cyclePosition % cyclePreview.length ? 'is-next' : ''}><b>{template.name}</b><span>{template.text}</span></li>)}</ol>}</div>}</div>}{cycleMode ? (cycleError && <p className="hint text-warn magic-controls">{cycleError}</p>) : (validation && <p className="hint text-warn magic-controls">{validation}</p>)}<div className="row magic-send magic-controls"><button className="primary" disabled={!consent || !!validation || !validPort || sending || cooldown > 0} onClick={() => void send()}>{sending ? 'Sending…' : cooldown > 0 ? `Wait ${cooldown}s` : sendImmediately ? 'Send now' : 'Populate VRChat keyboard'}</button>{broadcast ? <button className="danger-button" onClick={() => { setBroadcast(false); broadcastRef.current = false; }}>Stop broadcast</button> : <button disabled={!consent || (cycleMode ? !!cycleError : !!validation) || !validPort || sending || cooldown > 0 || !sendImmediately} onClick={() => { lastPayload.current = ''; cycleIndex.current = 0; setCyclePosition(0); setBroadcast(true); broadcastRef.current = true; void send(true); }}>Start broadcast</button>}</div><p className="hint magic-controls">Shortcuts · Ctrl+Enter sends the preview · Ctrl+S saves the template · cycle arrows change the queue order.</p><div className="row magic-controls"><button className="small" disabled={!consent || !validPort} onClick={() => void clearChatbox()}>Clear chatbox</button><button className="small" disabled={!consent || !validPort} onClick={() => void setTyping(!typing)}>{typing ? 'Stop typing indicator' : 'Typing indicator · 5s'}</button></div><div className="magic-osc-port-row magic-controls"><label className="field-label">Local OSC port<input type="number" min={1024} max={65535} value={port} disabled={broadcast || typing} onChange={(event) => setPort(Number(event.target.value))} /></label><button className="small" type="button" disabled={broadcast || typing || detectingPort} onClick={() => void detectPort()}>{detectingPort ? 'Detecting…' : 'Detect VRChat port'}</button></div>{!validPort && <p className="hint text-warn magic-controls">Enter a valid local port between 1024 and 65535.</p>}{!sendImmediately && <p className="hint magic-controls">Broadcast requires immediate send; draft mode is manual only.</p>}<div className="broadcast-status magic-controls"><span className={`pill ${broadcast ? 'ok' : ''}`}>{broadcast ? 'Broadcast running' : 'Broadcast stopped'}</span><small>{broadcast && nextSendAt ? `Next check in ${Math.max(0, Math.ceil((nextSendAt - now.getTime()) / 1000))}s · ` : ''}{sentCount} packets sent this visit{lastSentAt ? ` · last ${new Date(lastSentAt).toLocaleTimeString()}` : ''}</small></div><p className="hint magic-controls">Status mode sends only changed text; cycle mode rotates selected templates. Pauses while the app is hidden. Stops on tab change, error, invalid text, or after one hour. Never starts automatically. UDP send success does not prove VRChat received it.</p>{history.length > 0 && <div className="chat-history magic-controls"><div className="section-heading"><h2>Sent this visit</h2><button className="small ghost" onClick={() => setHistory([])}>Clear history</button></div>{history.map((item, index) => <div key={`${item.at}-${index}`}><small>{new Date(item.at).toLocaleTimeString()} · {item.draft ? 'Keyboard draft' : 'OSC packet'} · not delivery-confirmed</small><p>{item.text}</p><button type="button" className="small ghost" onClick={() => { setBroadcast(false); broadcastRef.current = false; setIntegrationSettings((current) => current.map((entry) => ({ ...entry, enabled: false }))); setPresetSelection('custom'); setMessageFrame('none'); setSelectedId(''); setName('From history'); setText(item.text); setShowMessageEditor(true); setActiveSection('Chatting'); setNote('History loaded as a new draft; integrations and frame turned off to avoid duplicating them.'); }}>Reuse as draft</button><button type="button" className="small ghost" onClick={() => void navigator.clipboard.writeText(item.text).then(() => setNote('History message copied.')).catch((error) => setNote(`Could not copy: ${String(error)}`))}>Copy message</button></div>)}<p className="hint">History is memory-only and disappears when you leave this tab.</p></div>}</section></section>
    </div>
  </div>;
};
