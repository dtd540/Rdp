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


export type TabId = 'hub' | 'vrchat' | 'chatbox' | 'setup' | 'mixer' | 'games' | 'browser' | 'discord' | 'settings';

export interface TabContext {
  state: AppState;
  patchState: (patch: Partial<AppState>) => Promise<AppState>;
  peaks: Record<string, number>;
  background: BackgroundImage | null;
  activeTab?: string;
  refreshBackground: () => Promise<void>;
}

export interface TabDef {
  id: TabId;
  label: string;
  icon: ReactNode;
  section: 'workspace' | 'system';
  immersive?: boolean;
  render: (ctx: TabContext) => ReactNode;
}

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