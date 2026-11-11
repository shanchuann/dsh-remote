import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';
import type { ColorValue } from 'react-native';

/** Icon component signature accepted by beUI's renderIcon / Button icons. */
export type CommonIconProps = { size?: number; color?: ColorValue | undefined };

const FALLBACK = '#8b8f9a';

function palette(color: ColorValue | undefined): string {
  return typeof color === 'string' ? color : FALLBACK;
}

function base(size: number | undefined) {
  return { width: size ?? 20, height: size ?? 20, viewBox: '0 0 24 24' } as const;
}

export function SettingsIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Circle cx={12} cy={12} r={3} stroke={c} strokeWidth={2} />
      <Path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function PlusIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Line x1={12} y1={5} x2={12} y2={19} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={5} y1={12} x2={19} y2={12} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function ScanIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path d="M4 8V6a2 2 0 0 1 2-2h2" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M16 4h2a2 2 0 0 1 2 2v2" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M20 16v2a2 2 0 0 1-2 2h-2" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8 20H6a2 2 0 0 1-2-2v-2" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Line x1={4} y1={12} x2={20} y2={12} stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function ChevronRightIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Polyline points="9 6 15 12 9 18" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Polyline points="15 6 9 12 15 18" stroke={c} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function RefreshIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path d="M20 11a8 8 0 1 0-2.34 5.66" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Polyline points="20 4 20 11 13 11" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function TrashIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path d="M4 7h16" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Line x1={10} y1={11} x2={10} y2={17} stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Line x1={14} y1={11} x2={14} y2={17} stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function PowerIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path d="M18.36 6.64a9 9 0 1 1-12.73 0" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={2} x2={12} y2={12} stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

export function WarningIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path
        d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Line x1={12} y1={9} x2={12} y2={13} stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={17} r={1} fill={c} />
    </Svg>
  );
}

export function CheckIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Polyline points="20 6 9 17 4 12" stroke={c} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function CloseIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Line x1={6} y1={6} x2={18} y2={18} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
      <Line x1={18} y1={6} x2={6} y2={18} stroke={c} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

export function ServerIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Rect x={3} y={4} width={18} height={7} rx={2} stroke={c} strokeWidth={2} />
      <Rect x={3} y={13} width={18} height={7} rx={2} stroke={c} strokeWidth={2} />
      <Circle cx={7} cy={7.5} r={1} fill={c} />
      <Circle cx={7} cy={16.5} r={1} fill={c} />
    </Svg>
  );
}

export function ChatIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path
        d="M21 11.5a8.38 8.38 0 0 1-8.5 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.1a8.4 8.4 0 0 1-.9-3.8A8.38 8.38 0 0 1 12.5 3a8.38 8.38 0 0 1 8.5 8.5Z"
        stroke={c}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WifiIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path d="M5 12.55a11 11 0 0 1 14 0" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Path d="M8.5 16.1a6 6 0 0 1 7 0" stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Circle cx={12} cy={19.5} r={1.2} fill={c} />
    </Svg>
  );
}

export function ClockIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Circle cx={12} cy={12} r={9} stroke={c} strokeWidth={2} />
      <Polyline points="12 7 12 12 16 14" stroke={c} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function DocsIcon({ size, color }: CommonIconProps) {
  const c = palette(color);
  return (
    <Svg {...base(size)} fill="none">
      <Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke={c} strokeWidth={2} strokeLinejoin="round" />
      <Polyline points="14 2 14 8 20 8" stroke={c} strokeWidth={2} strokeLinejoin="round" />
      <Line x1={8} y1={13} x2={16} y2={13} stroke={c} strokeWidth={2} strokeLinecap="round" />
      <Line x1={8} y1={17} x2={13} y2={17} stroke={c} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}
