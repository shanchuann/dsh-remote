import { ActivityIndicator } from 'react-native';
import { useResolveClassNames } from 'uniwind';

import { Button, type ButtonSize, type ButtonVariant } from '../button';
import type { IconSource } from '../../primitives/render-icon';

/**
 * Full-width button used across the app. Wraps beUI's Button with a loading
 * state and the primary/secondary variants the screens use.
 */
export function AppButton({
  children,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  startIcon,
  endIcon,
  className = '',
  accessibilityLabel,
}: {
  children: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: Exclude<ButtonSize, 'icon'>;
  loading?: boolean;
  disabled?: boolean;
  startIcon?: IconSource;
  endIcon?: IconSource;
  className?: string;
  accessibilityLabel?: string;
}) {
  const { color } = useResolveClassNames(variant === 'primary' ? 'text-on-primary' : 'text-foreground');
  const indicator = <ActivityIndicator size="small" color={typeof color === 'string' ? color : undefined} />;
  return (
    <Button
      variant={variant}
      size={size}
      disabled={disabled || loading}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? children}
      className={'w-full ' + className}
      startIcon={loading ? indicator : startIcon}
      endIcon={loading ? undefined : endIcon}
    >
      {children}
    </Button>
  );
}
