import type { ReactNode } from 'react';
import type { AppState, BackgroundImage } from './bridge';
import { Dashboard } from './components/Dashboard';
import { DiscordMark, DiscordPanel } from './components/DiscordPanel';
import { MagicChatbox } from './components/MagicChatbox';
import { GamerHub } from './components/GamerHub';
import { VrchatPanel } from './components/VrchatPanel';
import { GamesPanel, SteamMark } from './components/GamesPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Wizard } from './components/Wizard';

/**
 * The sidebar is generated from this list, so adding a tab is one entry here
 * instead of edits in three files. Order here is the order in the sidebar.
 */

export type TabId = 'hub' | 'vrchat' | 'chatbox' | 'setup' | 'mixer' | 'games' | 'browser' | 'discord' | 'settings';

export interface TabContext {
  state: AppState;
  patchState: (patch: Partial<AppState>) => Promise<AppState>;
  /** Live meter peaks by endpoint id. */
  peaks: Record<string, number>;
  /** Resolved custom background, or null for the default theme. */
  background: BackgroundImage | null;
  /** Currently active section, for Magic Chatbox context integrations. */
  activeTab?: string;
  refreshBackground: () => Promise<void>;
}

export interface TabDef {
  id: TabId;
  label: string;
  icon: ReactNode;
  /** Sidebar group. `system` sits above Settings at the bottom. */
  section: 'workspace' | 'system';
  /** True when the view should own the whole workspace (no content padding). */
  immersive?: boolean;
  render: (ctx: TabContext) => ReactNode;
}

/** Microphone glyph for the Live mixer tab. */
const MicrophoneMark = (
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M12 14a2 2 0 0 0 2-2V5a2 2 0 0 0-4 0v6a2 2 0 0 0 2 2Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z"
    />
  </svg>
);

export const TABS: TabDef[] = [
  {
    id: 'hub',
    label: 'Gamer hub',
    icon: '🎮',
    section: 'workspace',
    render: () => <GamerHub />
  },
  {
    id: 'vrchat',
    label: 'VRChat tools',
    icon: '🕶️',
    section: 'workspace',
    render: () => <VrchatPanel />
  },
  {
    id: 'chatbox',
    label: 'Magic Chatbox',
    icon: '✨',
    section: 'workspace',
    render: ({ activeTab }) => <MagicChatbox activeTab={activeTab ?? 'Magic Chatbox'} />
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: '⚡',
    section: 'workspace',
    render: ({ state, patchState, peaks }) => (
      <Wizard state={state} setState={patchState} peaks={peaks} />
    )
  },
  {
    id: 'mixer',
    label: 'Live mixer',
    icon: '🎙️',
    section: 'workspace',
    render: ({ state, patchState, peaks }) => (
      <Dashboard state={state} setState={patchState} peaks={peaks} />
    )
  },
  {
    id: 'games',
    label: 'Games',
    icon: '🕹️',
    section: 'workspace',
    render: () => <GamesPanel />
  },
  // The Browser tab is deliberately NOT registered while its native replacement is finished.
  // It used to be an Electron <webview>; it is now a main-process WebContentsView that has
  // never been run (see app/main/browserView.ts and components/BrowserPanel.tsx). Hiding the
  // entry keeps that unverified surface out of the shipped build without deleting the work.
  // Re-register it by restoring this entry and the BrowserPanel import above:
  //   { id: 'browser', label: 'Browser', icon: '🧭', section: 'workspace', immersive: true, render: () => <BrowserPanel /> },
  {
    id: 'discord',
    label: 'Discord',
    icon: '💬',
    section: 'workspace',
    immersive: true,
    render: () => <DiscordPanel />
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    section: 'system',
    render: ({ background, refreshBackground }) => (
      <SettingsPanel background={background} refreshBackground={refreshBackground} />
    )
  }
];

export const TAB_IDS = TABS.map((tab) => tab.id);