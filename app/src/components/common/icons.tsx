import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';

/** Icon component signature accepted by beUI's renderIcon / Button icons. */
export type CommonIconProps = { size?: number; color?: ColorValue | undefined };

const FALLBACK = '#8b8f9a';

function fromFeather(name: ComponentProps<typeof Feather>['name']) {
  return function LibraryIcon({ size, color }: CommonIconProps) {
    return (
      <Feather
        name={name}
        size={size ?? 20}
        color={typeof color === 'string' ? color : FALLBACK}
      />
    );
  };
}

export const SettingsIcon = fromFeather('settings');
export const PlusIcon = fromFeather('plus');
export const ScanIcon = fromFeather('maximize');
export const ChevronRightIcon = fromFeather('chevron-right');
export const ChevronLeftIcon = fromFeather('chevron-left');
export const RefreshIcon = fromFeather('refresh-cw');
export const TrashIcon = fromFeather('trash-2');
export const PowerIcon = fromFeather('power');
export const WarningIcon = fromFeather('alert-triangle');
export const CheckIcon = fromFeather('check');
export const CloseIcon = fromFeather('x');
export const ServerIcon = fromFeather('server');
export const ChatIcon = fromFeather('message-circle');
export const WifiIcon = fromFeather('wifi');
export const ClockIcon = fromFeather('clock');
export const DocsIcon = fromFeather('file-text');