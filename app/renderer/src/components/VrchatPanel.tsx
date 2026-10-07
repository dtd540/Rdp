import { useState, type FC } from 'react';
import { parseWorldLink, validateChatText, worldUrl, type RecentWorld } from '@shared/gaming';
import { bridge } from '../bridge';
import { saveGamerPreferences, useGamerPreferences } from '../gamerStore';

export const VrchatPanel: FC = () => {
  const preferences = useGamerPreferences();
  const [note, setNote] = useState('');
  const [worldInput, setWorldInput] = useState('');
  const [worldName, setWorldName] = useState('');
  const [recent, setRecent] = useState<RecentWorld[] | null>(null);
  const [scanDetail, setScanDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [oscEnabled, setOscEnabled] = useState(false);
  const [sound, setSound] = useState(false);
  const [sending, setSending] = useState(false);
  const [lastSend, setLastSend] = useState(0);
  const [preset, setPreset] = useState('');
  const count = Array.from(text).length;

  const update = (patch: Parameters<typeof saveGamerPreferences>[0]) => {
    try { saveGamerPreferences(patch); } catch (error) { setNote(`Could not save: ${String(error)}`); }
  };
  const act = async (op: string, arg?: string) => {
    try {
      const result = await bridge.op(op, arg);
      setNote(result.ok ? result.detail ?? 'Opened on your desktop.' : result.detail ?? 'Action unavailable.');
    } catch (error) { setNote(String(error)); }
  };
  const saveWorld = (world: RecentWorld, name = world.name) => {
    const url = worldUrl(world);
    if (preferences.worlds.some((saved) => saved.url === url)) { setNote('This world link is already saved.'); return; }
    if (preferences.worlds.length >= 100) { setNote('You can save up to 100 world links.'); return; }
    update({ worlds: [...preferences.worlds, { ...world, name: name.trim() || world.name, id: url, url, savedAt: Date.now() }] });
    setNote('World saved locally.');
  };
  const addWorld = () => {
    const parsed = parseWorldLink(worldInput);
    if (!parsed) { setNote('Paste an official VRChat world/launch link or a wrld_ id.'); return; }
    saveWorld(parsed, worldName);
    setWorldInput(''); setWorldName('');
  };
  const scan = async () => {
    setBusy(true);
    try {
      const result = await bridge.op('recentWorlds');
      if (!result.ok) throw new Error(result.detail ?? 'Could not read local VRChat logs.');
      setRecent(result.worlds ?? []); setScanDetail(result.detail ?? '');
    } catch (error) { setNote(String(error)); } finally { setBusy(false); }
  };
  const send = async () => {
    if (!oscEnabled || Date.now() - lastSend < 1500) return;
    try { validateChatText(text); } catch (error) { setNote(String(error)); return; }
    setSending(true);
    try {
      const result = await bridge.op('sendChatbox', JSON.stringify({ text, sound }));
      setNote(result.detail ?? (result.ok ? 'OSC packet sent. VRChat receipt cannot be confirmed.' : 'Could not send.'));
      if (result.ok) setLastSend(Date.now());
    } catch (error) { setNote(String(error)); } finally { setSending(false); }
  };

  return <div className="vrchat-tools">
    <div className="gamer-hero"><div><span className="section-kicker">SOCIAL, WITHOUT THE FRICTION</span><h1>Your VRChat <em>toolkit.</em></h1><p>Keep your favourite places close. Speak with the chatbox. No VRChat login, mods, or avatar access required.</p></div><span className="gamer-hero-orbit" aria-hidden="true">◈</span></div>
    <div className="gamer-quick-grid"><button className="gamer-quick" onClick={() => void act('launchGame', '438100')}><span>▶</span><div><b>Launch VRChat</b><small>Steam handles desktop / VR mode</small></div></button><button className="gamer-quick" onClick={() => void act('openVrchatLogs')}><span>▤</span><div><b>Open log folder</b><small>Inspect locally in Explorer</small></div></button><button className="gamer-quick" onClick={() => void act('openExternal', 'https://vrchat.com/home')}><span>◎</span><div><b>VRChat home</b><small>Official website</small></div></button><button className="gamer-quick" onClick={() => void act('openExternal', 'https://docs.vrchat.com/docs/osc-overview')}><span>?</span><div><b>OSC setup guide</b><small>Official documentation</small></div></button></div>
    {note && <div className="inline-notice" role="status">{note}</div>}
    <div className="gamer-columns">
      <div className="card"><div className="section-heading"><div><span className="section-kicker">YOUR PLACES</span><h2>Saved worlds</h2></div><span className="pill">{preferences.worlds.length} / 100</span></div><div className="world-form"><label className="field-label">World or launch link<input value={worldInput} onChange={(e) => setWorldInput(e.target.value)} placeholder="https://vrchat.com/home/world/wrld_…" /></label><label className="field-label">Name (optional)<input value={worldName} maxLength={100} onChange={(e) => setWorldName(e.target.value)} placeholder="Friday night hangout" /></label><button className="primary" onClick={addWorld}>Save world</button></div><div className="world-list">{preferences.worlds.length === 0 && <p className="hint">Save a world page or launch link. Launch links with an instance id get a Join button; access rules still apply.</p>}{preferences.worlds.map((world) => <article className="world-row" key={world.id}><div><b>{world.name}</b><small title={world.url}>{world.worldId}{world.instanceId ? ' · instance link' : ''}</small></div><div className="row"><button className="small" onClick={() => void act('openExternal', world.url)}>View</button>{world.instanceId && <button className="small primary" onClick={() => void act('joinVrchatWorld', world.url)}>Join</button>}<button className="small ghost" aria-label={`Remove ${world.name}`} onClick={() => update({ worlds: preferences.worlds.filter((item) => item.id !== world.id) })}>×</button></div></article>)}</div><div className="divider" /><div className="section-heading"><h2>Recent worlds from this PC</h2><button className="small" disabled={busy} onClick={() => void scan()}>{busy ? 'Reading…' : 'Read latest log'}</button></div><p className="hint">Only read when you ask. Extracts world transitions from at most 2 MB of the latest VRChat session log, never chat or account tokens.</p>{scanDetail && <p className="hint">{scanDetail}</p>}{recent?.length === 0 && <p className="hint">No recent world transitions found in the latest log.</p>}{recent?.map((world, index) => <div className="world-row" key={`${world.worldId}:${index}`}><div><b>{world.name}</b><small>{world.worldId}</small></div><button className="small" onClick={() => saveWorld(world)}>Save</button></div>)}</div>
      <div className="card"><span className="section-kicker">MANUAL · LOCAL · NO SPAM</span><h2>OSC chatbox</h2><p className="sub">Enable OSC in VRChat’s Action Menu → Options → OSC. Sends only to this PC, on VRChat’s default port 9000.</p><label className="check-row"><input type="checkbox" checked={oscEnabled} onChange={(e) => setOscEnabled(e.target.checked)} />I enabled OSC and want to send chatbox messages</label><label className="field-label">Message<textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Say hello, share your status, or let friends know you're on a break…" /></label><div className="chatbox-footer"><span className={count > 144 ? 'text-warn' : 'hint'}>{count} / 144 characters · {text.split('\n').length} / 9 lines</span><label className="check-row"><input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} />Notification sound</label></div><button className="primary" disabled={!oscEnabled || sending || !text.trim() || count > 144 || text.split('\n').length > 9} onClick={() => void send()}>{sending ? 'Sending…' : 'Send to chatbox'}</button><p className="hint">Manual send only, with a 1.5-second rate limit. UDP can’t confirm delivery. Your message may be visible to nearby players.</p><div className="divider" /><h2>Quick phrases</h2><div className="chat-presets">{preferences.chatPresets.map((message) => <div className="preset-row" key={message}><button className="ghost" onClick={() => setText(message)}>{message}</button><button className="small ghost" aria-label={`Remove phrase ${message}`} onClick={() => update({ chatPresets: preferences.chatPresets.filter((item) => item !== message) })}>×</button></div>)}</div><label className="field-label">New quick phrase<input value={preset} onChange={(e) => setPreset(e.target.value)} maxLength={144} /></label><button className="small" disabled={!preset.trim() || preferences.chatPresets.length >= 12} onClick={() => { try { validateChatText(preset); update({ chatPresets: [...preferences.chatPresets, preset] }); setPreset(''); } catch (error) { setNote(String(error)); } }}>Save phrase</button></div>
    </div>
  </div>;
};
