import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { materialIcons } from './material-icon-paths';

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

function fromMaterial(name: keyof typeof materialIcons) {
  const glyph = materialIcons[name];
  return function MaterialIcon({ size = 20, color }: CommonIconProps) {
    return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      <Path d={glyph.path} fill={color ?? glyph.fill} />
    </Svg>;
  };
}

export const BackIcon = fromMaterial('BackIcon');
export const VoiceIcon = fromMaterial('VoiceIcon');
export const SettingsIcon = fromMaterial('SettingsIcon');
export const PlusIcon = fromFeather('plus');
export const ScanIcon = fromMaterial('ScanIcon');
export const ChevronRightIcon = fromMaterial('ChevronRightIcon');
export const ChevronLeftIcon = fromFeather('chevron-left');
export const RefreshIcon = fromMaterial('RefreshIcon');
export const TrashIcon = fromMaterial('TrashIcon');
export const PowerIcon = fromMaterial('PowerIcon');
export const WarningIcon = fromFeather('alert-triangle');
export const CheckIcon = fromFeather('check');
export const CloseIcon = fromFeather('x');
export const ServerIcon = fromFeather('server');
export const ChatIcon = fromMaterial('ChatIcon');
export const WifiIcon = fromFeather('wifi');
export const ClockIcon = fromFeather('clock');
export const DocsIcon = fromFeather('file-text');
export const ImageIcon = fromFeather('image');
export const FolderIcon = fromMaterial('FolderIcon');
export const FolderOpenIcon = fromMaterial('FolderOpenIcon');
export const ChevronDownIcon = fromMaterial('ChevronDownIcon');
export const ChevronUpIcon = fromMaterial('ChevronUpIcon');
export const ExpandCircleDownIcon = fromMaterial('ExpandCircleDownIcon');
export const ExpandCircleUpIcon = fromMaterial('ExpandCircleUpIcon');
export const ShareIcon = fromFeather('share-2');
export const TerminalIcon = fromFeather('terminal');
export const SearchIcon = fromFeather('search');
export const UsersIcon = fromFeather('users');

export const BranchIcon = fromMaterial('BranchIcon');
export const UsageIcon = fromMaterial('UsageIcon');
export const ThumbUpIcon = fromMaterial('ThumbUpIcon');
export const ThumbDownIcon = fromMaterial('ThumbDownIcon');
export const CopyIcon = fromMaterial('CopyIcon');
export const SelectTextIcon = fromFeather('type');
