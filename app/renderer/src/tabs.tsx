import type { ReactNode } from 'react';
import type { AppState } from './bridge';
import { Dashboard } from './components/Dashboard';
import { SettingsPanel } from './components/SettingsPanel';
import { Wizard } from './components/Wizard';

export type TabId = 'setup' | 'mixer' | 'settings';

export interface TabContext {
  state: AppState;
  patchState: (patch: Partial<AppState>) => Promise<AppState>;
  peaks: Record<string, number>;
}

export interface TabDef {
  id: TabId;
  label: string;
  icon: ReactNode;
  render: (ctx: TabContext) => ReactNode;
}

export const TABS: TabDef[] = [
  {
    id: 'setup',
    label: 'Setup audio',
    icon: '⚡',
    render: ({ state, patchState, peaks }) => (
      <Wizard state={state} setState={patchState} peaks={peaks} />
    ),
  },
  {
    id: 'mixer',
    label: 'Music & voice',
    icon: '🎙️',
    render: ({ state, patchState, peaks }) => (
      <Dashboard state={state} setState={patchState} peaks={peaks} />
    ),
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: '⚙️',
    render: ({ state, patchState }) => (
      <SettingsPanel
        background={
          state.backgroundPath
            ? { path: state.backgroundPath, name: 'background', url: '', animated: false }
            : null
        }
        refreshBackground={async () => { await patchState({}); }}
      />
    ),
  },
];
